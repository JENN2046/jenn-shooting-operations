import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { executeMigrationCommand } from './migrate-v1-to-v2.mjs';
import { buildMigrationPlan } from '../src/migration-v2.mjs';
import {
  readV1Source,
  resolveExistingPath,
  verifyV2Target,
} from '../src/migration-sqlite-v2.mjs';
import {
  verifyExistingBackup,
  verifyExistingRestore,
} from '../src/migration-recovery-sqlite-v2.mjs';
import { V1_SCHEMA_SQL } from '../src/sqlite-schema-v2.mjs';

const T0 = '2026-09-22T12:00:00.000Z';
const T1 = '2026-09-22T12:00:01.000Z';
const T2 = '2026-09-22T12:00:02.000Z';

function clockSequence(...timestamps) {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fixtureSnapshot() {
  const historical = JSON.parse(readFileSync(
    new URL('../fixtures/migration-v2/v1-single-session.json', import.meta.url),
    'utf8',
  ));
  return {
    ...historical,
    revision: 4,
    sessions: [],
  };
}

function createSource(root) {
  const source = join(root, 'source.sqlite');
  const snapshot = fixtureSnapshot();
  const db = new DatabaseSync(source);
  try {
    db.exec(V1_SCHEMA_SQL);
    db.prepare(`
      INSERT INTO schedule_state (id, revision, updated_at, snapshot_json)
      VALUES (1, ?, ?, ?)
    `).run(snapshot.revision, snapshot.updatedAt, JSON.stringify(snapshot));
    db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      'operation-wo06b-request-submit',
      'request.submit',
      JSON.stringify({ taskId: snapshot.tasks[0].id }),
      T0,
    );
  } finally {
    db.close();
  }
  return source;
}

function applyArgs(root, source) {
  return [
    '--apply',
    '--source', source,
    '--target', join(root, 'target.sqlite'),
    '--fixture-root', root,
    '--backup', join(root, 'backup.sqlite'),
    '--rollback-target', join(root, 'rollback.sqlite'),
    '--proof-seal', join(root, 'proof-seal.json'),
    '--business-time-zone', 'UTC',
    '--hash-uploads',
    '--acknowledge-isolated-target',
    '--acknowledge-offline-maintenance',
    '--format', 'json',
  ];
}

function dryRunArgs(source) {
  return [
    '--dry-run',
    '--source', source,
    '--business-time-zone', 'UTC',
    '--hash-uploads',
    '--format', 'json',
  ];
}

function artifactFacts(root) {
  const names = ['backup.sqlite', 'rollback.sqlite', 'target.sqlite', 'proof-seal.json'];
  return Object.fromEntries(names.map(name => {
    const path = join(root, name);
    assert.equal(existsSync(path), true, `${name} must exist`);
    const stat = statSync(path, { bigint: true });
    return [name, {
      sha256: hashFile(path),
      size: stat.size.toString(),
      inode: stat.ino.toString(),
    }];
  }));
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-migration-fixture-'));
  chmodSync(root, 0o700);
  try {
    const source = createSource(root);
    const sourceBefore = hashFile(source);

    const dryRun = await executeMigrationCommand(dryRunArgs(source), {
      clock: () => new Date(T0),
    });
    assert.equal(dryRun.exitCode, 0, dryRun.output);
    assert.ok(['PASS', 'PASS_WITH_WARNINGS'].includes(dryRun.report.result), dryRun.output);
    assert.equal(dryRun.report.switchReadiness, 'NOT_RUN');

    const sourceModel = readV1Source(resolveExistingPath(source));
    const plan = buildMigrationPlan({
      source: sourceModel,
      businessTimeZone: 'UTC',
      importedAt: T0,
    });
    assert.equal(plan.issues.some(issue => issue.severity === 'BLOCKER'), false);

    const args = applyArgs(root, source);
    const first = await executeMigrationCommand(args, {
      clock: clockSequence(T0, T1, T2),
    });
    assert.equal(first.exitCode, 0, first.output);
    assert.equal(first.report.result, 'APPLIED_VERIFIED');
    assert.equal(first.report.targetVerification.status, 'APPLIED_VERIFIED');
    assert.equal(first.report.switchReadiness, 'BLOCKED');
    assert.equal(hashFile(source), sourceBefore, 'source must remain unchanged');

    const backup = join(root, 'backup.sqlite');
    const rollbackTarget = join(root, 'rollback.sqlite');
    const target = join(root, 'target.sqlite');
    const proofSeal = join(root, 'proof-seal.json');

    const backupReceipt = verifyExistingBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
    });
    assert.equal(backupReceipt.status, 'BACKUP_VERIFIED');

    const rollbackReceipt = verifyExistingRestore({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt,
      expectedAttachmentDigest: backupReceipt.uploadManifestDigest,
    });
    assert.equal(rollbackReceipt.status, 'ROLLBACK_VERIFIED');

    const targetVerification = verifyV2Target(resolveExistingPath(target), plan);
    assert.equal(targetVerification.status, 'ALREADY_APPLIED_VERIFIED');

    const seal = JSON.parse(readFileSync(proofSeal, 'utf8'));
    assert.equal(seal.schemaVersion, 1);
    assert.equal(seal.batchIdentity, plan.batchIdentity);
    assert.equal(seal.backupProofIdentity, backupReceipt.backupProofIdentity);
    assert.equal(seal.rollbackProofIdentity, rollbackReceipt.rollbackProofIdentity);
    assert.match(seal.targetArtifactDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(seal.sourceAndUploadIdentityDigest, /^sha256:[a-f0-9]{64}$/u);

    const beforeReplay = artifactFacts(root);
    const replay = await executeMigrationCommand(args, {
      clock: clockSequence(T2, T2, T2),
    });
    assert.equal(replay.exitCode, 0, replay.output);
    assert.equal(replay.report.result, 'ALREADY_APPLIED_VERIFIED');
    assert.equal(replay.report.targetVerification.status, 'ALREADY_APPLIED_VERIFIED');
    assert.equal(replay.report.switchReadiness, 'BLOCKED');
    assert.deepEqual(artifactFacts(root), beforeReplay, 'completed replay must not rewrite artifacts');
    assert.equal(hashFile(source), sourceBefore, 'replay must not rewrite source');

    const targetDb = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(
        targetDb.prepare('SELECT status FROM migration_batches').get()?.status,
        'completed',
      );
      assert.equal(
        targetDb.prepare('SELECT COUNT(*) AS count FROM production_events').get().count,
        0,
      );
      assert.equal(
        targetDb.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count,
        0,
      );
    } finally {
      targetDb.close();
    }

    process.stdout.write(JSON.stringify({
      status: 'WO_06B_FRESH_ACCEPTANCE_PASS',
      dryRunResult: dryRun.report.result,
      applyResult: first.report.result,
      backupStatus: backupReceipt.status,
      rollbackStatus: rollbackReceipt.status,
      targetStatus: targetVerification.status,
      replayResult: replay.report.result,
      switchReadiness: replay.report.switchReadiness,
      sourceUnchanged: true,
      artifactsStableOnReplay: true,
    }) + '\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
