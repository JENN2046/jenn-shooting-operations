import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { runCleanup } from '../scripts/cleanup-uploads.mjs';
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
    const runsRoot = join(root, '.orphan-cleanup-control', 'runs');
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
