import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCleanup } from '../scripts/cleanup-uploads.mjs';
import { ScheduleStore } from '../src/store.mjs';

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
