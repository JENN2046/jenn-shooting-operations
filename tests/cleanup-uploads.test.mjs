import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runCleanup } from '../scripts/cleanup-uploads.mjs';
import { ScheduleStore } from '../src/store.mjs';

function waitForMessage(child, expectedType) {
  return new Promise((resolve, reject) => {
    const onMessage = message => {
      if (message?.type !== expectedType) return;
      cleanup();
      resolve(message);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onExit = code => {
      cleanup();
      reject(new Error(`upload worker exited before ${expectedType} with code ${code}`));
    };
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

test('upload maintenance defaults to dry-run and requires explicit apply', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-cleanup-command-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const createdAt = new Date('2026-09-20T08:00:00.000Z');
  const cleanupAt = new Date('2026-09-22T08:00:00.000Z');
  const store = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock: () => createdAt,
    idFactory: () => 'cleanup-command-orphan',
  });
  try {
    const upload = store.saveUpload({
      operationId: 'cleanup-command-0001',
      originalName: 'orphan.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('orphaned upload'),
    });
    assert.equal(upload.ok, true);
    const storedPath = join(uploadRoot, `${upload.upload.sha256}.txt`);
    assert.equal(existsSync(storedPath), true);
    store.close();

    const preview = runCleanup({ databasePath, uploadRoot, clock: () => cleanupAt });
    assert.deepEqual(preview, {
      mode: 'dry-run',
      maxAgeHours: 24,
      ok: true,
      dryRun: true,
      candidates: 1,
      deleted: 0,
      filesDeleted: 0,
      fileErrors: 0,
    });
    assert.equal(existsSync(storedPath), true);

    const applied = runCleanup({
      args: ['--apply', '--max-age-hours', '24'],
      databasePath,
      uploadRoot,
      clock: () => cleanupAt,
    });
    assert.equal(applied.mode, 'apply');
    assert.equal(applied.candidates, 1);
    assert.equal(applied.deleted, 1);
    assert.equal(applied.filesDeleted, 1);
    assert.equal(existsSync(storedPath), false);
  } finally {
    try { store.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('upload maintenance rejects unsafe age and unknown arguments', () => {
  assert.throws(() => runCleanup({ args: ['--max-age-hours', '0'] }), /positive number/);
  assert.throws(() => runCleanup({ args: ['--everything'] }), /unknown argument/);
});

test('cleanup serializes with a live identical upload across processes', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-cleanup-race-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  const oldTime = new Date('2026-09-20T08:00:00.000Z');
  const liveTime = new Date('2026-09-22T08:00:00.000Z');
  let store = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock: () => oldTime,
    idFactory: () => 'expired-upload-old',
  });
  let blocker;
  let child;
  try {
    const expired = store.saveUpload({
      operationId: 'expired-upload-operation-0001',
      originalName: 'expired.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('identical attachment'),
    });
    const storedPath = join(uploadRoot, `${expired.upload.sha256}.txt`);
    store.close();
    store = null;

    child = fork(
      fileURLToPath(new URL('./fixtures/live-upload-process.mjs', import.meta.url)),
      [databasePath, uploadRoot, liveTime.toISOString()],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    const exitPromise = once(child, 'exit');
    await waitForMessage(child, 'ready');

    blocker = new DatabaseSync(databasePath);
    blocker.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
    const resultPromise = waitForMessage(child, 'result');
    child.send({ type: 'upload' });
    const stayedBlocked = await Promise.race([
      resultPromise.then(() => false),
      delay(150).then(() => true),
    ]);
    assert.equal(stayedBlocked, true, 'live upload must wait for the SQLite writer lock');
    blocker.exec('COMMIT');
    blocker.close();
    blocker = null;

    const message = await resultPromise;
    assert.equal(message.error, undefined);
    assert.equal(message.result.ok, true);
    await exitPromise;
    child = null;

    store = new ScheduleStore({ filename: databasePath, uploadRoot, clock: () => liveTime });
    const cleanup = store.cleanupOrphanUploads({ olderThanMs: 24 * 60 * 60 * 1000 });
    assert.equal(cleanup.candidates, 1);
    assert.equal(cleanup.deleted, 1);
    assert.equal(cleanup.filesDeleted, 0);
    assert.equal(existsSync(storedPath), true);
    const liveRow = store.db.prepare('SELECT id FROM uploads WHERE id = ?').get(message.result.upload.id);
    assert.equal(liveRow.id, message.result.upload.id);
  } finally {
    if (blocker) {
      try { blocker.exec('ROLLBACK'); } catch {}
      blocker.close();
    }
    if (child) child.kill();
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('startup restores a staged file after cleanup crashes before commit', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-cleanup-crash-'));
  const databasePath = join(root, 'operations.sqlite');
  const uploadRoot = join(root, 'uploads');
  let store = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock: () => new Date('2026-09-20T08:00:00.000Z'),
    idFactory: () => 'crash-recovery-upload',
  });
  let child;
  try {
    const upload = store.saveUpload({
      operationId: 'crash-recovery-operation-0001',
      originalName: 'recover.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('recoverable attachment'),
    });
    const storedPath = join(uploadRoot, `${upload.upload.sha256}.txt`);
    store.close();
    store = null;

    child = fork(
      fileURLToPath(new URL('./fixtures/crashed-cleanup-process.mjs', import.meta.url)),
      [databasePath, storedPath],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    const exitPromise = once(child, 'exit');
    const staged = await waitForMessage(child, 'staged');
    assert.equal(existsSync(storedPath), false);
    assert.equal(existsSync(staged.stagedPath), true);

    child.kill('SIGKILL');
    await exitPromise;
    child = null;

    const rolledBack = new DatabaseSync(databasePath, { readOnly: true });
    const row = rolledBack.prepare('SELECT id FROM uploads WHERE id = ?').get(upload.upload.id);
    rolledBack.close();
    assert.equal(row.id, upload.upload.id);
    assert.equal(existsSync(storedPath), false);

    store = new ScheduleStore({ filename: databasePath, uploadRoot });
    assert.equal(existsSync(storedPath), true);
    assert.equal(existsSync(staged.stagedPath), false);
    const recovered = store.db.prepare('SELECT id FROM uploads WHERE id = ?').get(upload.upload.id);
    assert.equal(recovered.id, upload.upload.id);
  } finally {
    if (child) child.kill('SIGKILL');
    try { store?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
