import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { runCleanup } from '../scripts/cleanup-uploads.mjs';
import { createOrphanCleanupControl } from '../src/orphan-cleanup-control.mjs';
import { createOperationsServer } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';

async function listen(service) {
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
}

async function closeService(service) {
  if (!service) return;
  service.server.close();
  await once(service.server, 'close');
}

function cleanupControlRootFor(databasePath) {
  const namespace = createHash('sha256').update(resolve(databasePath)).digest('hex');
  return join(dirname(databasePath), '.orphan-cleanup-control', namespace);
}

test('disabled cleanup protects startup periodic saveUpload and submitRequest across restart', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-control-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const oldTime = new Date('2026-09-20T08:00:00.000Z');
  const laterTime = new Date('2026-09-22T08:00:00.000Z');
  let sequence = 0;
  let seed;
  let first;
  let restarted;

  try {
    seed = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      clock: () => oldTime,
      idFactory: () => 'cleanup-control-seed-' + (++sequence),
      orphanMaxAgeMs: 1000,
    });
    const orphan = seed.saveUpload({
      operationId: 'cleanup-control-old-0001',
      originalName: 'old.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('old orphan that must survive pre-cutover protection'),
    });
    assert.equal(orphan.ok, true);
    const oldPath = join(uploadRoot, orphan.upload.sha256 + '.txt');
    seed.close();
    seed = null;

    first = createOperationsServer({
      databasePath,
      uploadRoot,
      clock: () => laterTime,
      idFactory: () => 'cleanup-control-live-' + (++sequence),
      orphanMaxAgeMs: 1000,
      cleanupIntervalMs: 10,
      orphanCleanupMode: 'disabled',
    });
    await listen(first);

    const disabled = first.orphanCleanupControl.status();
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.markerValid, true);
    assert.equal(typeof disabled.epoch, 'string');
    assert.equal(existsSync(oldPath), true, 'startup cleanup must be blocked');

    const live = first.store.saveUpload({
      operationId: 'cleanup-control-live-0001',
      originalName: 'live.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('request-triggered cleanup must also stay disabled'),
    });
    assert.equal(live.ok, true);
    const livePath = join(uploadRoot, live.upload.sha256 + '.txt');

    const invalid = first.store.submitRequest({
      role: 'public-submitter',
      submission: {
        schemaVersion: 1,
        operationId: 'cleanup-control-live-0001',
        uploadIds: [live.upload.id],
      },
    });
    assert.equal(invalid.status, 422);
    assert.equal(existsSync(livePath), true, 'invalid submission must not delete upload while disabled');
    assert.ok(first.store.db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(live.upload.id));

    await delay(50);
    assert.equal(existsSync(oldPath), true, 'periodic cleanup must remain disabled');

    await closeService(first);
    first = null;

    restarted = createOperationsServer({
      databasePath,
      uploadRoot,
      clock: () => laterTime,
      idFactory: () => 'cleanup-control-restart-' + (++sequence),
      orphanMaxAgeMs: 1000,
      cleanupIntervalMs: 10,
      orphanCleanupMode: 'inherit',
    });
    await listen(restarted);

    const inherited = restarted.orphanCleanupControl.status();
    assert.equal(inherited.enabled, false, 'disabled state must persist across restart');
    assert.equal(inherited.epoch, disabled.epoch);
    await delay(30);
    assert.equal(existsSync(oldPath), true);

    const wrongEpoch = restarted.orphanCleanupControl.enable({ expectedEpoch: 'wrong-epoch' });
    assert.equal(wrongEpoch.ok, false);
    assert.equal(wrongEpoch.code, 'ORPHAN_CLEANUP_EPOCH_MISMATCH');
    assert.equal(restarted.orphanCleanupControl.status().enabled, false);

    const enabled = restarted.orphanCleanupControl.enable({ expectedEpoch: disabled.epoch });
    assert.equal(enabled.ok, true);
    assert.equal(enabled.enabled, true);

    const cleanup = restarted.store.cleanupOrphanUploads({ olderThanMs: 1000 });
    assert.equal(cleanup.skipped, undefined);
    assert.equal(cleanup.deleted >= 1, true);
    assert.equal(existsSync(oldPath), false);

    const disabledAgain = restarted.orphanCleanupControl.disable({ reason: 'test-re-disable', waitForDrainMs: 0 });
    assert.equal(disabledAgain.ok, true);
    assert.equal(disabledAgain.enabled, false);
    assert.notEqual(disabledAgain.epoch, disabled.epoch);
  } finally {
    try { seed?.close(); } catch {}
    if (first) {
      try { await closeService(first); } catch {}
    }
    if (restarted) {
      try { await closeService(restarted); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance apply cannot bypass a persisted disabled cleanup control', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-maintenance-control-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const oldTime = new Date('2026-09-20T08:00:00.000Z');
  const laterTime = new Date('2026-09-22T08:00:00.000Z');
  let store;

  try {
    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      clock: () => oldTime,
      idFactory: () => 'cleanup-maintenance-seed',
    });
    const orphan = store.saveUpload({
      operationId: 'cleanup-maintenance-0001',
      originalName: 'maintenance.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('maintenance must respect persisted disable'),
    });
    const storedPath = join(uploadRoot, orphan.upload.sha256 + '.txt');
    const disabled = store.disableOrphanCleanup({ reason: 'pre-cutover', waitForDrainMs: 0 });
    assert.equal(disabled.ok, true);
    store.close();
    store = null;

    const blocked = runCleanup({
      args: ['--apply', '--max-age-hours', '24'],
      databasePath,
      uploadRoot,
      clock: () => laterTime,
    });
    assert.equal(blocked.skipped, true);
    assert.equal(blocked.code, 'ORPHAN_CLEANUP_DISABLED');
    assert.equal(blocked.deleted, 0);
    assert.equal(existsSync(storedPath), true);

    store = new ScheduleStore({ filename: databasePath, uploadRoot, clock: () => laterTime });
    const enabled = store.enableOrphanCleanup({ expectedEpoch: disabled.epoch });
    assert.equal(enabled.ok, true);
    store.close();
    store = null;

    const applied = runCleanup({
      args: ['--apply', '--max-age-hours', '24'],
      databasePath,
      uploadRoot,
      clock: () => laterTime,
    });
    assert.equal(applied.deleted, 1);
    assert.equal(existsSync(storedPath), false);
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('disable stays fail-closed until every active cleanup marker is drained', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-drain-control-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({ filename: databasePath, uploadRoot });
    const runsRoot = join(cleanupControlRootFor(databasePath), 'runs');
    const fakeRun = join(runsRoot, 'synthetic-active-cleanup.json');
    writeFileSync(fakeRun, '{"runId":"synthetic-active-cleanup"}\n');

    const blocked = store.disableOrphanCleanup({ reason: 'pre-cutover', waitForDrainMs: 0 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'ORPHAN_CLEANUP_DRAIN_TIMEOUT');
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.activeRuns, 1);

    const prematureEnable = store.enableOrphanCleanup({ expectedEpoch: blocked.epoch });
    assert.equal(prematureEnable.ok, false);
    assert.equal(prematureEnable.code, 'ORPHAN_CLEANUP_DRAIN_REQUIRED');

    unlinkSync(fakeRun);
    const drained = store.disableOrphanCleanup({ reason: 'pre-cutover', waitForDrainMs: 0 });
    assert.equal(drained.ok, true);
    assert.equal(drained.activeRuns, 0);

    const enabled = store.enableOrphanCleanup({ expectedEpoch: drained.epoch });
    assert.equal(enabled.ok, true);
    assert.equal(enabled.enabled, true);
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('disabled startup restores referenced cleanup tombstones without deleting unreferenced staged files', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-recovery-control-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const cleanupRoot = join(uploadRoot, '.cleanup');
  let store;

  try {
    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      idFactory: () => 'cleanup-recovery-control',
    });
    const upload = store.saveUpload({
      operationId: 'cleanup-recovery-control-0001',
      originalName: 'restore.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('referenced bytes must be restored'),
    });
    const storedName = upload.upload.sha256 + '.txt';
    const storedPath = join(uploadRoot, storedName);
    const referencedStaged = join(
      cleanupRoot,
      storedName + '.cleanup-00000000-0000-4000-8000-000000000001',
    );
    const unreferencedStaged = join(
      cleanupRoot,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt.cleanup-00000000-0000-4000-8000-000000000002',
    );

    store.renameFile(storedPath, referencedStaged);
    writeFileSync(unreferencedStaged, 'do not delete while cleanup is disabled');
    const disabled = store.disableOrphanCleanup({ waitForDrainMs: 0 });
    assert.equal(disabled.ok, true);
    store.close();
    store = null;

    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      orphanCleanupMode: 'inherit',
    });
    assert.equal(store.getOrphanCleanupControlStatus().enabled, false);
    assert.equal(existsSync(storedPath), true, 'referenced staged bytes are restored for safety');
    assert.equal(existsSync(referencedStaged), false);
    assert.equal(existsSync(unreferencedStaged), true, 'unreferenced staged bytes are not destructively removed');
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});


test('disabled startup persists protection before upload path initialization can fail', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-pre-upload-path-gate-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads-as-file');
  writeFileSync(uploadRoot, 'not a directory');

  try {
    assert.equal(existsSync(databasePath), false);
    assert.throws(
      () => createOperationsServer({
        databasePath,
        uploadRoot,
        cleanupIntervalMs: 0,
        orphanCleanupMode: 'disabled',
      }),
    );

    const markerPath = join(cleanupControlRootFor(databasePath), 'disabled.json');
    assert.equal(
      existsSync(markerPath),
      true,
      'disabled marker must persist before upload-path initialization is attempted',
    );
    assert.equal(
      JSON.parse(readFileSync(markerPath, 'utf8')).state,
      'disabled',
    );
    assert.equal(
      existsSync(databasePath),
      false,
      'upload-path failure after disable must still occur before SQLite is opened',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('disabled startup drain failure occurs before SQLite is created', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-pre-sqlite-gate-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const runsRoot = join(cleanupControlRootFor(databasePath), 'runs');
  mkdirSync(runsRoot, { recursive: true });
  const activeRun = join(runsRoot, 'peer-cleanup-before-db.json');
  writeFileSync(activeRun, '{"runId":"peer-cleanup-before-db"}\n');

  try {
    assert.equal(existsSync(databasePath), false);
    assert.throws(
      () => createOperationsServer({
        databasePath,
        uploadRoot,
        cleanupIntervalMs: 0,
        orphanCleanupMode: 'disabled',
      }),
      error => error?.code === 'ORPHAN_CLEANUP_DRAIN_TIMEOUT',
    );

    assert.equal(existsSync(databasePath), false, 'failed disabled startup must not create or mutate SQLite');
    assert.equal(
      existsSync(join(cleanupControlRootFor(databasePath), 'disabled.json')),
      true,
      'fail-closed disabled marker must persist even though SQLite was never opened',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unchecked cleanup implementation is not a public ScheduleStore method', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-private-implementation-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({ filename: databasePath, uploadRoot });
    assert.equal(store.cleanupOrphanUploadsUnchecked, undefined);
    assert.equal(store.recoverStagedUploadCleanupLocked, undefined);
    assert.equal(store.orphanCleanupControl, undefined);
    assert.equal(
      Object.prototype.hasOwnProperty.call(ScheduleStore.prototype, 'cleanupOrphanUploadsUnchecked'),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(ScheduleStore.prototype, 'recoverStagedUploadCleanupLocked'),
      false,
    );

    const disabled = store.disableOrphanCleanup({ waitForDrainMs: 0 });
    assert.equal(disabled.ok, true);
    const result = store.cleanupOrphanUploads();
    assert.equal(result.skipped, true);
    assert.equal(result.code, 'ORPHAN_CLEANUP_DISABLED');
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup snapshots caller options once before dry-run gate evaluation', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-options-snapshot-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      idFactory: () => 'cleanup-options-snapshot',
    });
    const operationId = 'cleanup-options-snapshot-0001';
    const upload = store.saveUpload({
      operationId,
      originalName: 'snapshot.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('stateful getters cannot change dry-run after admission decision'),
    });
    const storedPath = join(uploadRoot, upload.upload.sha256 + '.txt');
    const disabled = store.disableOrphanCleanup({ waitForDrainMs: 0 });
    assert.equal(disabled.ok, true);

    let dryRunReads = 0;
    const result = store.cleanupOrphanUploads({
      operationId,
      get dryRun() {
        dryRunReads += 1;
        return dryRunReads === 1;
      },
    });

    assert.equal(dryRunReads, 1);
    assert.equal(result.dryRun, true);
    assert.equal(result.deleted, 0);
    assert.equal(existsSync(storedPath), true);
    assert.ok(store.db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(upload.upload.id));
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('truthy non-boolean dry-run values remain non-destructive after snapshotting', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-truthy-dry-run-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      idFactory: () => 'truthy-dry-run-upload',
    });
    const operationId = 'truthy-dry-run-0001';
    const upload = store.saveUpload({
      operationId,
      originalName: 'truthy.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('truthy dry-run values must never become apply mode'),
    });
    const storedPath = join(uploadRoot, upload.upload.sha256 + '.txt');

    for (const dryRun of ['true', 'false', new Boolean(false)]) {
      const result = store.cleanupOrphanUploads({ operationId, dryRun });
      assert.equal(result.dryRun, true);
      assert.equal(result.deleted, 0);
      assert.equal(existsSync(storedPath), true);
      assert.ok(store.db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(upload.upload.id));
    }
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('run completion can remove only markers admitted by the same control instance', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-run-ownership-'));
  const controlRoot = join(root, '.orphan-cleanup-control');
  const runsRoot = join(controlRoot, 'runs');
  const peerRunId = 'peer-cleanup-run';
  const peerMarker = join(runsRoot, peerRunId + '.json');

  try {
    const control = createOrphanCleanupControl({ controlRoot });
    assert.equal(existsSync(runsRoot), false, 'control construction must not create the run directory');
    mkdirSync(runsRoot, { recursive: true });
    writeFileSync(peerMarker, '{"runId":"peer-cleanup-run"}\n');

    const forgedPeerCompletion = control.endRun({ ok: true, runId: peerRunId });
    assert.equal(forgedPeerCompletion, false);
    assert.equal(existsSync(peerMarker), true, 'a foreign control instance cannot remove a peer marker');

    const admission = control.beginRun();
    assert.equal(admission.ok, true);
    const ownedMarker = join(runsRoot, admission.runId + '.json');
    assert.equal(existsSync(ownedMarker), true);

    const forgedOtherCompletion = control.endRun({ ok: true, runId: 'forged-other-run' });
    assert.equal(forgedOtherCompletion, false);
    assert.equal(existsSync(ownedMarker), true);

    assert.equal(control.endRun(admission), true);
    assert.equal(existsSync(ownedMarker), false);
    assert.equal(existsSync(peerMarker), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('disabled server startup fails until active cleanup markers are drained', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-startup-drain-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let seed;

  try {
    seed = new ScheduleStore({ filename: databasePath, uploadRoot });
    seed.close();
    seed = null;

    const runsRoot = join(cleanupControlRootFor(databasePath), 'runs');
    const activeRun = join(runsRoot, 'rolling-peer-cleanup.json');
    writeFileSync(activeRun, '{"runId":"rolling-peer-cleanup"}\n');

    assert.throws(
      () => createOperationsServer({
        databasePath,
        uploadRoot,
        cleanupIntervalMs: 0,
        orphanCleanupMode: 'disabled',
      }),
      error => error?.code === 'ORPHAN_CLEANUP_DRAIN_TIMEOUT',
    );

    const disabledMarker = join(cleanupControlRootFor(databasePath), 'disabled.json');
    assert.equal(existsSync(disabledMarker), true, 'startup failure must retain fail-closed disable marker');

    unlinkSync(activeRun);

    const service = createOperationsServer({
      databasePath,
      uploadRoot,
      cleanupIntervalMs: 0,
      orphanCleanupMode: 'disabled',
    });
    try {
      const status = service.orphanCleanupControl.status();
      assert.equal(status.enabled, false);
      assert.equal(status.activeRuns, 0);
    } finally {
      service.store.close();
    }
  } finally {
    try { seed?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed persisted control marker keeps destructive cleanup fail-closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-invalid-control-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({ filename: databasePath, uploadRoot });
    store.close();
    store = null;

    const marker = join(cleanupControlRootFor(databasePath), 'disabled.json');
    writeFileSync(marker, '{not-valid-json');

    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      orphanCleanupMode: 'inherit',
    });
    const status = store.getOrphanCleanupControlStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.markerValid, false);

    const cleanup = store.cleanupOrphanUploads();
    assert.equal(cleanup.skipped, true);
    assert.equal(cleanup.code, 'ORPHAN_CLEANUP_DISABLED');

    const enable = store.enableOrphanCleanup({ expectedEpoch: 'anything' });
    assert.equal(enable.ok, false);
    assert.equal(enable.code, 'ORPHAN_CLEANUP_CONTROL_INVALID');
    assert.equal(store.getOrphanCleanupControlStatus().enabled, false);
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI apply exits nonzero when persisted cleanup protection blocks deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-cli-control-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      clock: () => new Date('2026-09-20T08:00:00.000Z'),
      idFactory: () => 'cleanup-cli-control',
    });
    const upload = store.saveUpload({
      operationId: 'cleanup-cli-control-0001',
      originalName: 'cli.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('CLI cleanup must fail visibly while protected'),
    });
    const storedPath = join(uploadRoot, upload.upload.sha256 + '.txt');
    const disabled = store.disableOrphanCleanup({ waitForDrainMs: 0 });
    assert.equal(disabled.ok, true);
    store.close();
    store = null;

    const script = fileURLToPath(new URL('../scripts/cleanup-uploads.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--apply', '--max-age-hours', '24'], {
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        UPLOAD_ROOT: uploadRoot,
      },
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.skipped, true);
    assert.equal(output.code, 'ORPHAN_CLEANUP_DISABLED');
    assert.equal(existsSync(storedPath), true);
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});


test('transition lock serializes disable enable and destructive admission across processes', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-transition-lock-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({ filename: databasePath, uploadRoot });
    const lockPath = join(cleanupControlRootFor(databasePath), 'transition.lock');
    writeFileSync(lockPath, 'foreign-transition-owner\n', { flag: 'wx' });

    const disable = store.disableOrphanCleanup({ reason: 'pre-cutover', waitForDrainMs: 0 });
    assert.equal(disable.ok, false);
    assert.equal(disable.code, 'ORPHAN_CLEANUP_TRANSITION_BUSY');

    const enable = store.enableOrphanCleanup({ expectedEpoch: 'stale' });
    assert.equal(enable.ok, false);
    assert.equal(enable.code, 'ORPHAN_CLEANUP_TRANSITION_BUSY');

    const cleanup = store.cleanupOrphanUploads();
    assert.equal(cleanup.skipped, true);
    assert.equal(cleanup.code, 'ORPHAN_CLEANUP_TRANSITION_BUSY');

    unlinkSync(lockPath);

    const disabled = store.disableOrphanCleanup({ reason: 'pre-cutover', waitForDrainMs: 0 });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.enabled, false);
    assert.equal(typeof disabled.epoch, 'string');
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale enable cannot remove a replacement disable epoch', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-stale-enable-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store;

  try {
    store = new ScheduleStore({ filename: databasePath, uploadRoot });

    const first = store.disableOrphanCleanup({ reason: 'first-disable', waitForDrainMs: 0 });
    assert.equal(first.ok, true);

    const firstEnable = store.enableOrphanCleanup({ expectedEpoch: first.epoch });
    assert.equal(firstEnable.ok, true);

    const replacement = store.disableOrphanCleanup({ reason: 'replacement-disable', waitForDrainMs: 0 });
    assert.equal(replacement.ok, true);
    assert.notEqual(replacement.epoch, first.epoch);

    const staleEnable = store.enableOrphanCleanup({ expectedEpoch: first.epoch });
    assert.equal(staleEnable.ok, false);
    assert.equal(staleEnable.code, 'ORPHAN_CLEANUP_EPOCH_MISMATCH');

    const stillDisabled = store.getOrphanCleanupControlStatus();
    assert.equal(stillDisabled.enabled, false);
    assert.equal(stillDisabled.epoch, replacement.epoch);
  } finally {
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});


test('periodic cleanup retries after a startup-time transition lock clears', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-startup-transition-timer-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const oldTime = new Date('2026-09-20T08:00:00.000Z');
  const laterTime = new Date('2026-09-22T08:00:00.000Z');
  let seed;
  let service;

  try {
    seed = new ScheduleStore({
      filename: databasePath,
      uploadRoot,
      clock: () => oldTime,
      idFactory: () => 'startup-transition-timer-orphan',
    });
    const orphan = seed.saveUpload({
      operationId: 'startup-transition-timer-0001',
      originalName: 'startup-transition.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('periodic timer must retry after transition'),
    });
    const storedPath = join(uploadRoot, orphan.upload.sha256 + '.txt');
    seed.close();
    seed = null;

    const lockPath = join(cleanupControlRootFor(databasePath), 'transition.lock');
    writeFileSync(lockPath, 'foreign-enable-transition\n', { flag: 'wx' });

    service = createOperationsServer({
      databasePath,
      uploadRoot,
      clock: () => laterTime,
      orphanMaxAgeMs: 1000,
      cleanupIntervalMs: 10,
      orphanCleanupMode: 'inherit',
    });
    await listen(service);

    await delay(40);
    assert.equal(existsSync(storedPath), true, 'transition must block destructive periodic admission');

    unlinkSync(lockPath);
    await delay(60);
    assert.equal(existsSync(storedPath), false, 'existing interval must retry after transition clears');
  } finally {
    try { seed?.close(); } catch {}
    if (service) {
      try { await closeService(service); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed local disable does not strand the periodic cleanup timer', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-cleanup-disable-busy-timer-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let now = new Date('2026-09-22T08:00:00.000Z');
  let service;

  try {
    service = createOperationsServer({
      databasePath,
      uploadRoot,
      clock: () => now,
      idFactory: () => 'disable-busy-timer-orphan',
      orphanMaxAgeMs: 1000,
      cleanupIntervalMs: 10,
    });
    await listen(service);

    const orphan = service.store.saveUpload({
      operationId: 'disable-busy-timer-0001',
      originalName: 'disable-busy.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('timer must remain scheduled after transition busy'),
    });
    const storedPath = join(uploadRoot, orphan.upload.sha256 + '.txt');

    const lockPath = join(cleanupControlRootFor(databasePath), 'transition.lock');
    writeFileSync(lockPath, 'foreign-enable-transition\n', { flag: 'wx' });
    now = new Date(now.getTime() + 1001);

    const blocked = service.orphanCleanupControl.disable({ reason: 'pre-cutover', waitForDrainMs: 0 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'ORPHAN_CLEANUP_TRANSITION_BUSY');

    await delay(30);
    assert.equal(existsSync(storedPath), true, 'foreign transition still blocks destructive admission');

    unlinkSync(lockPath);
    await delay(60);
    assert.equal(existsSync(storedPath), false, 'timer must still exist after failed local disable');
  } finally {
    if (service) {
      try { await closeService(service); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});
