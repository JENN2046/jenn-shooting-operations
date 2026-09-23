import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  executeMigration,
  executeMigrationCommand,
  parseMigrationArgs,
} from '../scripts/migrate-v1-to-v2.mjs';
import {
  MIGRATION_VERSION,
  MigrationError,
  buildMigrationPlan,
  failureReport,
  parseResourceMap,
} from '../src/migration-v2.mjs';
import {
  readV1Source,
  resolveExistingPath,
  verifyUploadManifest,
} from '../src/migration-sqlite-v2.mjs';
import {
  V1_SCHEMA_SQL,
  initializeWritableSchema,
} from '../src/sqlite-schema-v2.mjs';
import { IS_WINDOWS } from '../src/platform-filesystem.mjs';

const fixtureRoot = new URL('../fixtures/migration-v2/', import.meta.url);
const FIXED_NOW = '2026-09-22T12:00:00.000Z';
const LATER_NOW = '2026-09-25T18:30:00.000Z';
const VALUE_OPTIONS_FOR_TEST = new Set([
  '--target', '--fixture-root', '--backup', '--rollback-target', '--proof-seal',
]);

function canCreateFileSymlink() {
  const root = mkdtempSync(join(tmpdir(), 'jso-symlink-probe-'));
  try {
    const target = join(root, 'target');
    const link = join(root, 'link');
    writeFileSync(target, 'probe');
    symlinkSync(target, link);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return false;
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CAN_CREATE_FILE_SYMLINK = canCreateFileSymlink();

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
}

test('existing path resolution accepts native absolute paths and rejects URL input', () => (
  withTempRoot(root => {
    const source = createSource(root, emptySnapshot());
    assert.equal(resolveExistingPath(source).realPath, realpathSync(source));
    assert.throws(
      () => resolveExistingPath(pathToFileURL(source).href),
      error => error.code === 'INVALID_PATH',
    );
  })
));

function emptySnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: '2026-09-22T00:00:00.000Z',
    products: [],
    tasks: [],
    sessions: [],
    ...overrides,
  };
}

function createSource(root, snapshot, { operations = [], uploads = [] } = {}) {
  const path = join(root, 'source.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(V1_SCHEMA_SQL);
    db.prepare(`
      INSERT INTO schedule_state (id, revision, updated_at, snapshot_json)
      VALUES (1, ?, ?, ?)
    `).run(snapshot.revision, snapshot.updatedAt, JSON.stringify(snapshot));
    const insertOperation = db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at)
      VALUES (?, ?, ?, ?)
    `);
    operations.forEach(operation => insertOperation.run(
      operation.operation_id,
      operation.kind,
      operation.response_json,
      operation.created_at ?? FIXED_NOW,
    ));
    const insertUpload = db.prepare(`
      INSERT INTO uploads (
        id, operation_id, original_name, content_type, kind, size, sha256,
        stored_name, claimed_task_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    uploads.forEach(upload => insertUpload.run(
      upload.id,
      upload.operation_id,
      upload.original_name,
      upload.content_type,
      upload.kind,
      upload.size,
      upload.sha256,
      upload.stored_name,
      upload.claimed_task_id,
      upload.created_at ?? FIXED_NOW,
    ));
  } finally {
    db.close();
  }
  return path;
}

function createResourceMap(root, places = { '主影棚': 'studio-main' }) {
  const path = join(root, 'resource-map.json');
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    mapVersion: 'fixture-map-v1',
    businessTimeZone: 'Asia/Shanghai',
    places,
  }));
  return path;
}

function baseArgs(source, resourceMap, extra = []) {
  return [
    '--dry-run',
    '--source', source,
    '--business-time-zone', 'Asia/Shanghai',
    ...(resourceMap ? ['--resource-map', resourceMap] : []),
    '--format', 'json',
    ...extra,
  ];
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function withTempRoot(action) {
  const root = mkdtempSync(join(tmpdir(), 'jso-migration-v2-'));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function withApplyFixture(action) {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-migration-fixture-'));
  chmodSync(root, 0o700);
  try {
    return await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function applyArgs(root, source, extra = []) {
  return [
    '--apply',
    '--source', source,
    '--target', join(root, 'target.sqlite'),
    '--fixture-root', root,
    '--backup', join(root, 'backup.sqlite'),
    '--rollback-target', join(root, 'rollback.sqlite'),
    '--proof-seal', join(root, 'proof.json'),
    '--business-time-zone', 'UTC',
    '--hash-uploads',
    '--acknowledge-isolated-target',
    '--acknowledge-offline-maintenance',
    '--format', 'json',
    ...extra,
  ];
}

function clockSequence(...timestamps) {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

test('CLI enforces one mode and apply-specific paths, hashing, and acknowledgements', () => {
  assert.throws(() => parseMigrationArgs([]), error => error.code === 'MIGRATION_MODE_REQUIRED');
  assert.throws(
    () => parseMigrationArgs(['--dry-run', '--verify-only', '--source', '/x', '--business-time-zone', 'UTC']),
    error => error.code === 'MIGRATION_MODE_REQUIRED',
  );
  const validApply = parseMigrationArgs([
    '--apply', '--source', '/source', '--target', '/target',
    '--fixture-root', '/fixture', '--backup', '/backup', '--rollback-target', '/rollback',
    '--proof-seal', '/proof', '--business-time-zone', 'UTC', '--hash-uploads',
    '--acknowledge-isolated-target', '--acknowledge-offline-maintenance',
  ]);
  assert.equal(validApply.mode, 'apply');
  assert.equal(validApply.hashUploads, true);
  assert.equal(validApply.acknowledgeIsolatedTarget, true);
  assert.equal(validApply.acknowledgeOfflineMaintenance, true);
  for (const [removed, code] of [
    ['--target', 'TARGET_REQUIRED'],
    ['--fixture-root', 'MISSING_REQUIRED_ARGUMENT'],
    ['--backup', 'MISSING_REQUIRED_ARGUMENT'],
    ['--rollback-target', 'ROLLBACK_TARGET_REQUIRED'],
    ['--proof-seal', 'MISSING_REQUIRED_ARGUMENT'],
    ['--hash-uploads', 'HASH_UPLOADS_REQUIRED'],
    ['--acknowledge-isolated-target', 'ISOLATED_TARGET_ACK_REQUIRED'],
    ['--acknowledge-offline-maintenance', 'OFFLINE_MAINTENANCE_ACK_REQUIRED'],
  ]) {
    const args = [
      '--apply', '--source', '/source', '--target', '/target',
      '--fixture-root', '/fixture', '--backup', '/backup', '--rollback-target', '/rollback',
      '--proof-seal', '/proof', '--business-time-zone', 'UTC', '--hash-uploads',
      '--acknowledge-isolated-target', '--acknowledge-offline-maintenance',
    ];
    const index = args.indexOf(removed);
    args.splice(index, VALUE_OPTIONS_FOR_TEST.has(removed) ? 2 : 1);
    assert.throws(() => parseMigrationArgs(args), error => error.code === code, removed);
  }
  for (const option of [
    ['--fixture-root', '/fixture'],
    ['--backup', '/backup'],
    ['--rollback-target', '/rollback'],
    ['--proof-seal', '/proof'],
    ['--acknowledge-isolated-target'],
    ['--acknowledge-offline-maintenance'],
  ]) {
    assert.throws(() => parseMigrationArgs([
      '--dry-run', '--source', '/x', '--business-time-zone', 'UTC', ...option,
    ]), error => error.code === 'APPLY_ARGUMENT_NOT_ALLOWED');
    assert.throws(() => parseMigrationArgs([
      '--verify-only', '--source', '/x', '--target', '/y', '--business-time-zone', 'UTC', ...option,
    ]), error => error.code === 'APPLY_ARGUMENT_NOT_ALLOWED');
  }
  assert.throws(
    () => parseMigrationArgs(['--dry-run', '--source', '/x', '--source', '/y', '--business-time-zone', 'UTC']),
    error => error.code === 'DUPLICATE_ARGUMENT',
  );
  assert.throws(
    () => parseMigrationArgs(['--dry-run', '--source', '/x', '--business-time-zone', 'UTC', '--mystery']),
    error => error.code === 'UNKNOWN_ARGUMENT',
  );
  for (const option of ['--force', '--report-json', '--overwrite-report']) {
    assert.throws(
      () => parseMigrationArgs(['--dry-run', '--source', '/x', '--business-time-zone', 'UTC', option]),
      error => error.code === 'FEATURE_NOT_AVAILABLE',
      option,
    );
  }
  assert.equal(parseMigrationArgs([
    '--dry-run', '--source', '/x', '--business-time-zone', 'UTC', '--hash-uploads',
  ]).hashUploads, true);
});

test('committed-but-unverified failures use target-blocking exit and report semantics', () => {
  const failure = failureReport(
    new MigrationError('TARGET_POST_COMMIT_PROOF_FAILED', 'COMMITTED_BUT_UNVERIFIED'),
    { mode: 'apply' },
  );
  assert.equal(failure.exitCode, 5);
  assert.equal(failure.report.result, 'COMMITTED_BUT_UNVERIFIED');
  assert.equal(failure.report.switchReadiness, 'BLOCKED');
  assert.equal(failure.report.targetVerification.status, 'COMMITTED_BUT_UNVERIFIED');
  assert.deepEqual(failure.report.issues, [{
    code: 'TARGET_POST_COMMIT_PROOF_FAILED', severity: 'BLOCKER', count: 1,
  }]);
});

test('resource map is strict, timezone-bound, and preserves exact place keys', () => {
  const valid = parseResourceMap(JSON.stringify({
    schemaVersion: 1,
    mapVersion: 'map-v1',
    businessTimeZone: 'Asia/Shanghai',
    places: { '棚 A': 'studio-a', '棚 A ': 'studio-a-space' },
  }), 'Asia/Shanghai');
  assert.equal(valid.places.get('棚 A'), 'studio-a');
  assert.equal(valid.places.get('棚 A '), 'studio-a-space');
  assert.throws(() => parseResourceMap(JSON.stringify({
    schemaVersion: 1,
    mapVersion: 'map-v1',
    businessTimeZone: 'UTC',
    places: {},
  }), 'Asia/Shanghai'), error => error.code === 'RESOURCE_MAP_TIME_ZONE_MISMATCH');
  assert.throws(() => parseResourceMap('{"schemaVersion":1,"mapVersion":"x","businessTimeZone":"UTC","places":{},"extra":true}', 'UTC'));
  assert.throws(() => parseResourceMap('{"schemaVersion":1,"mapVersion":"x","businessTimeZone":"UTC","places":{"__proto__":"x"}}', 'UTC'));
});

test('source reader uses query_only and leaves database bytes/stat/sidecars unchanged', () => withTempRoot(root => {
  const source = createSource(root, emptySnapshot());
  const beforeHash = hashFile(source);
  const beforeStat = statSync(source, { bigint: true });
  const beforeEntries = readdirSync(root).toSorted();
  const read = readV1Source(resolveExistingPath(source));
  const afterStat = statSync(source, { bigint: true });
  assert.equal(read.queryOnly, true);
  assert.equal(hashFile(source), beforeHash);
  assert.equal(afterStat.size, beforeStat.size);
  assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
  assert.deepEqual(readdirSync(root).toSorted(), beforeEntries);
}));

test('source family remains stable for an idle WAL reader and detects a real WAL writer', () => withTempRoot(root => {
  const source = createSource(root, emptySnapshot());
  const keeper = new DatabaseSync(source);
  try {
    assert.equal(keeper.prepare('PRAGMA journal_mode = WAL').get().journal_mode, 'wal');
    keeper.prepare(`
      INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
      VALUES ('fixture.start', 'test', NULL, 0, 'ok', ?)
    `).run(FIXED_NOW);
    const stable = readV1Source(resolveExistingPath(source));
    assert.equal(stable.queryOnly, true);

    assert.throws(() => readV1Source(resolveExistingPath(source), {
      duringScan: () => {
        const script = `
          const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(process.argv[1]);
          db.prepare("INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('fixture.concurrent', 'test', NULL, 0, 'ok', '2026-09-22T12:00:01.000Z')").run();
          db.close();
        `;
        const writer = spawnSync(process.execPath, ['-e', script, source], {
          encoding: 'utf8',
          timeout: 5000,
        });
        assert.equal(writer.status, 0, writer.stderr);
      },
    }), error => error.code === 'SOURCE_CHANGED_DURING_SCAN');
  } finally {
    keeper.close();
  }
}));

test('relational source facts participate in stable structural and batch identities', () => withTempRoot(root => {
  const sourcePath = createSource(root, emptySnapshot(), {
    operations: [{
      operation_id: 'operation-a',
      kind: 'request.submit',
      response_json: JSON.stringify({ taskId: 'TASK-NOT-IN-SNAPSHOT' }),
    }],
    uploads: [{
      id: 'UPLOAD-A',
      operation_id: 'operation-a',
      original_name: 'asset-a.png',
      content_type: 'image/png',
      kind: 'original',
      size: 1,
      sha256: '0'.repeat(64),
      stored_name: 'stored-a.png',
      claimed_task_id: null,
    }],
  });
  const pathInfo = resolveExistingPath(sourcePath);
  const read = () => readV1Source(pathInfo);
  const plan = source => buildMigrationPlan({
    source,
    businessTimeZone: 'UTC',
    importedAt: FIXED_NOW,
  });

  const initialSource = read();
  const initialPlan = plan(initialSource);
  const deterministicRead = read();
  const deterministicPlan = plan(deterministicRead);
  assert.equal(deterministicRead.structuralDigest, initialSource.structuralDigest);
  assert.equal(deterministicPlan.batchIdentity, initialPlan.batchIdentity);

  const writable = new DatabaseSync(sourcePath);
  writable.prepare('UPDATE operations SET operation_id = ? WHERE operation_id = ?')
    .run('operation-b', 'operation-a');
  writable.close();
  const operationChangedSource = read();
  const operationChangedPlan = plan(operationChangedSource);
  assert.notEqual(operationChangedSource.structuralDigest, initialSource.structuralDigest);
  assert.notEqual(operationChangedPlan.batchIdentity, initialPlan.batchIdentity);

  const uploadWritable = new DatabaseSync(sourcePath);
  uploadWritable.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
    .run('asset-b.png', 'UPLOAD-A');
  uploadWritable.close();
  const uploadChangedSource = read();
  const uploadChangedPlan = plan(uploadChangedSource);
  assert.notEqual(uploadChangedSource.structuralDigest, operationChangedSource.structuralDigest);
  assert.notEqual(uploadChangedPlan.batchIdentity, operationChangedPlan.batchIdentity);

  const privateAuditResult = 'PRIVATE-AUDIT-RESULT-MUST-NOT-BE-READ';
  const auditWritable = new DatabaseSync(sourcePath);
  auditWritable.prepare(`
    INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
    VALUES ('fixture.audit', 'test', NULL, 9, ?, ?)
  `).run(privateAuditResult, FIXED_NOW);
  auditWritable.close();
  const auditChangedSource = read();
  const auditChangedPlan = plan(auditChangedSource);
  assert.equal(auditChangedSource.auditSummary.count, 1);
  assert.equal(auditChangedSource.auditSummary.min_revision, 9);
  assert.equal(auditChangedSource.auditSummary.max_revision, 9);
  assert.notEqual(auditChangedSource.structuralDigest, uploadChangedSource.structuralDigest);
  assert.notEqual(auditChangedPlan.batchIdentity, uploadChangedPlan.batchIdentity);
  assert.equal(JSON.stringify(auditChangedSource).includes(privateAuditResult), false);

  const finalRepeatSource = read();
  const finalRepeatPlan = plan(finalRepeatSource);
  assert.equal(finalRepeatSource.structuralDigest, auditChangedSource.structuralDigest);
  assert.equal(finalRepeatPlan.batchIdentity, auditChangedPlan.batchIdentity);
}));

test('source structure and relational snapshot metadata fail closed on divergence', () => {
  withTempRoot(root => {
    const incomplete = join(root, 'incomplete.sqlite');
    const db = new DatabaseSync(incomplete);
    db.exec(`
      CREATE TABLE schedule_state (
        id INTEGER PRIMARY KEY, revision INTEGER, updated_at TEXT, snapshot_json TEXT
      );
    `);
    db.close();
    const result = executeMigration(baseArgs(incomplete, null));
    assert.equal(result.report.result, 'INVALID_SOURCE');
    assert.equal(result.report.issues[0].code, 'SOURCE_SCHEMA_MISSING');
  });
  withTempRoot(root => {
    const source = createSource(root, emptySnapshot({ revision: 3 }));
    const db = new DatabaseSync(source);
    db.prepare('UPDATE schedule_state SET revision = 4 WHERE id = 1').run();
    db.close();
    const result = executeMigration(baseArgs(source, null));
    assert.equal(result.report.result, 'INVALID_SOURCE');
    assert.equal(result.report.issues[0].code, 'SNAPSHOT_REVISION_MISMATCH');
  });
});

test('empty, single and grouped fixtures map in memory with frozen revision bootstrap', () => {
  for (const name of ['empty', 'v1-single-session.json', 'v1-grouped-session.json']) {
    withTempRoot(root => {
      const snapshot = name === 'empty' ? emptySnapshot({ revision: 7 }) : fixture(name);
      const sourcePath = createSource(root, snapshot);
      const mapPath = createResourceMap(root);
      const result = executeMigration(baseArgs(sourcePath, mapPath), {
        clock: () => new Date(FIXED_NOW),
      });
      assert.equal(result.exitCode, 0, result.output);
      assert.equal(result.report.result, 'PASS');
      assert.equal(result.report.revisions.proposedProjectionRevision, snapshot.revision);
      assert.equal(result.report.revisions.proposedScheduleRevision, 0);
      assert.equal(result.report.counts.wouldCreateProductionRuns, 0);
      assert.equal(result.report.counts.wouldCreateProductionEvents, 0);
      assert.equal(result.report.roundTrip.validatorStatus, 'PASS');
      assert.equal(result.report.roundTrip.v2ValidatorStatus, 'PASS');
      assert.equal(result.report.attachments.validationStatus, 'PASS_NO_FILES');
      assert.equal(result.report.switchReadiness, 'NOT_RUN');
      if (name === 'v1-grouped-session.json') {
        assert.equal(result.report.counts.groupedUnallocatedSessions, 1);
        assert.equal(result.report.counts.taskBindings, 2);
      }
    });
  }
});

test('L1 is preserved exactly while L2 and L3 stop materialization', () => {
  withTempRoot(root => {
    const l1Snapshot = fixture('v1-single-session.json');
    l1Snapshot.tasks[0].runtimeOnlyExtension = { opaque: true };
    const source = createSource(root, l1Snapshot);
    const result = executeMigration(baseArgs(source, createResourceMap(root)), {
      clock: () => new Date(FIXED_NOW),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.report.compatibility.classification, 'L1_GRANDFATHERED_OPAQUE');
    assert.equal(result.report.compatibility.legacyFragmentsPreserved, 1);
    assert.equal(result.report.roundTrip.sourceCanonicalDigest, result.report.roundTrip.roundTripCanonicalDigest);
  });
  withTempRoot(root => {
    const l1Timestamp = fixture('v1-single-session.json');
    l1Timestamp.tasks[0].createdAt = 'legacy-non-rfc3339-timestamp';
    const source = createSource(root, l1Timestamp);
    const result = executeMigration(baseArgs(source, createResourceMap(root)), {
      clock: () => new Date(FIXED_NOW),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.report.compatibility.classification, 'L1_GRANDFATHERED_OPAQUE');
    assert.equal(result.report.roundTrip.sourceCanonicalDigest, result.report.roundTrip.roundTripCanonicalDigest);
  });
  for (const [name, expected] of [
    ['legacy-repair-required-invalid-time.json', 'BLOCKED_MAPPING'],
    ['legacy-source-corrupt-unknown-task.json', 'INVALID_SOURCE'],
  ]) {
    withTempRoot(root => {
      const legacy = fixture(name);
      const source = createSource(root, legacy.sourceSnapshot);
      const result = executeMigration(baseArgs(source, createResourceMap(root)), {
        clock: () => new Date(FIXED_NOW),
      });
      assert.equal(result.report.result, expected);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.report.roundTrip.validatorStatus, 'NOT_RUN');
    });
  }
});

test('missing V1 task source is blocked and never guessed', () => withTempRoot(root => {
  const snapshot = fixture('v1-single-session.json');
  delete snapshot.tasks[0].source;
  const source = createSource(root, snapshot);
  const result = executeMigration(baseArgs(source, createResourceMap(root)), {
    clock: () => new Date(FIXED_NOW),
  });
  assert.equal(result.report.result, 'BLOCKED_MAPPING');
  assert.equal(result.report.issues[0].code, 'UNKNOWN_REQUIRED_V2_FIELD');
}));

test('unmapped and overlapping sessions remain lossless Shadow facts with Switch blockers', () => {
  withTempRoot(root => {
    const snapshot = fixture('v1-single-session.json');
    const sourcePath = createSource(root, snapshot);
    const source = readV1Source(resolveExistingPath(sourcePath));
    const plan = buildMigrationPlan({
      source,
      businessTimeZone: 'Asia/Shanghai',
      importedAt: FIXED_NOW,
      resourceMap: parseResourceMap(JSON.stringify({
        schemaVersion: 1,
        mapVersion: 'empty-map',
        businessTimeZone: 'Asia/Shanghai',
        places: {},
      }), 'Asia/Shanghai'),
    });
    assert.equal(plan.records.schedule_items[0].resource_id, null);
    assert.equal(plan.records.schedule_items[0].resource_resolution_status, 'unresolved');
    assert.equal(plan.projections.v1.sessions[0].place, snapshot.sessions[0].place);
    assert.equal(plan.issues.some(issue => issue.code === 'UNMAPPED_RESOURCE' && issue.severity === 'BLOCKER'), true);
    const result = executeMigration(baseArgs(sourcePath, createResourceMap(root, {})), {
      clock: () => new Date(FIXED_NOW),
    });
    assert.equal(result.report.result, 'BLOCKED_MAPPING');
    assert.equal(result.exitCode, 2);
    assert.equal(result.report.counts.unmappedRecords, 1);
  });

  withTempRoot(root => {
    const snapshot = fixture('v1-grouped-session.json');
    snapshot.sessions.push({
      ...snapshot.sessions[0],
      id: 'SESSION-GROUP-002',
      ids: ['TASK-GROUP-001'],
      start: '14:00',
      end: '16:00',
    });
    const source = readV1Source(resolveExistingPath(createSource(root, snapshot)));
    const map = parseResourceMap(readFileSync(createResourceMap(root), 'utf8'), 'Asia/Shanghai');
    const plan = buildMigrationPlan({
      source,
      businessTimeZone: 'Asia/Shanghai',
      importedAt: FIXED_NOW,
      resourceMap: map,
    });
    assert.equal(plan.records.schedule_items.length, 2);
    assert.equal(plan.projections.v1.sessions.length, 2);
    assert.equal(plan.issues.some(issue => issue.code === 'RESOURCE_OVERLAP' && issue.severity === 'BLOCKER'), true);
    assert.equal(plan.projections.v1.sessions[1].start, '14:00');
  });
});

test('attachment manifest supports no-files, fast, and hashed read-only validation', () => withTempRoot(root => {
  const payload = Buffer.from('manifest-fixture-bytes');
  const digest = createHash('sha256').update(payload).digest('hex');
  const storedName = `${digest}.bin`;
  const snapshot = fixture('v1-single-session.json');
  snapshot.tasks[0].assets = [{
    id: 'UPLOAD-MANIFEST-1',
    name: 'private-attachment-name.bin',
    contentType: 'application/octet-stream',
    kind: 'attachment',
    size: payload.length,
    sha256: digest,
  }];
  const source = createSource(root, snapshot, { uploads: [{
    id: 'UPLOAD-MANIFEST-1',
    operation_id: 'operation-upload-1',
    original_name: 'private-attachment-name.bin',
    content_type: 'application/octet-stream',
    kind: 'attachment',
    size: payload.length,
    sha256: digest,
    stored_name: storedName,
    claimed_task_id: snapshot.tasks[0].id,
  }] });
  const uploadRoot = join(root, 'uploads');
  mkdirSync(uploadRoot);
  writeFileSync(join(uploadRoot, storedName), payload);
  const map = createResourceMap(root);

  const missingRoot = executeMigration(baseArgs(source, map), { clock: () => new Date(FIXED_NOW) });
  assert.equal(missingRoot.report.result, 'INVALID_USAGE');
  assert.equal(missingRoot.report.issues[0].code, 'UPLOAD_ROOT_REQUIRED');

  const fast = executeMigration(baseArgs(source, map, ['--upload-root', uploadRoot]), {
    clock: () => new Date(FIXED_NOW),
  });
  assert.equal(fast.report.result, 'PASS_WITH_WARNINGS');
  assert.equal(fast.report.attachments.validationStatus, 'PASS_FAST');
  assert.equal(fast.report.attachments.filesChecked, 1);
  assert.equal(fast.report.attachments.hashesChecked, 0);
  assert.equal(fast.report.counts.claimedUploads, 1);
  assert.equal(fast.report.counts.managedAssetEntries, 1);
  assert.equal(fast.report.counts.orphanUploads, 0);
  assert.equal(fast.report.counts.operationsByRelevantKind, 0);
  assert.equal(fast.report.counts.auditRows, 0);
  assert.equal(fast.report.counts.legacyAssetEntries, 0);
  assert.equal(fast.report.counts.unmappedRecords, 0);
  assert.equal(fast.report.counts.overlapDiagnostics, 0);

  const hashed = executeMigration(baseArgs(source, map, [
    '--upload-root', uploadRoot, '--hash-uploads',
  ]), { clock: () => new Date(FIXED_NOW) });
  assert.equal(hashed.report.result, 'PASS');
  assert.equal(hashed.report.attachments.validationStatus, 'PASS_HASHED');
  assert.equal(hashed.report.attachments.hashesChecked, 1);
  for (const secret of [root, storedName, digest, 'private-attachment-name.bin']) {
    assert.equal(hashed.output.includes(secret), false);
  }
}));

test('attachment manifest rejects traversal and symlink files without disclosure', () => {
  const variants = ['traversal', ...(CAN_CREATE_FILE_SYMLINK ? ['symlink'] : [])];
  for (const variant of variants) withTempRoot(root => {
    const payload = Buffer.from('unsafe-manifest-fixture');
    const digest = createHash('sha256').update(payload).digest('hex');
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot);
    const storedName = variant === 'traversal' ? '../escape.bin' : 'linked.bin';
    if (variant === 'symlink') {
      const outside = join(root, 'outside.bin');
      writeFileSync(outside, payload);
      symlinkSync(outside, join(uploadRoot, storedName));
    }
    const source = createSource(root, emptySnapshot(), { uploads: [{
      id: 'UPLOAD-UNSAFE-1', operation_id: 'operation-unsafe', original_name: 'hidden.bin',
      content_type: 'application/octet-stream', kind: 'attachment', size: payload.length,
      sha256: digest, stored_name: storedName, claimed_task_id: null,
    }] });
    const result = executeMigration(baseArgs(source, null, ['--upload-root', uploadRoot]));
    assert.equal(result.report.result, 'INVALID_SOURCE');
    assert.equal(result.report.issues[0].code, 'UPLOAD_PATH_UNSAFE');
    assert.equal(result.report.attachments.validationStatus, 'FAILED');
    assert.equal(result.report.attachments.unsafePaths, 1);
    assert.equal(result.output.includes(root), false);
    assert.equal(result.output.includes(storedName), false);
  });
});

test('attachment manifest rejects a symlink swap between lstat and no-follow open', {
  skip: CAN_CREATE_FILE_SYMLINK ? false : 'file symlink creation is not available on this Windows host',
}, () => withTempRoot(root => {
  const payload = Buffer.from('no-follow-race-fixture');
  const digest = createHash('sha256').update(payload).digest('hex');
  const storedName = `${digest}.bin`;
  const uploadRoot = join(root, 'uploads');
  mkdirSync(uploadRoot);
  const candidate = join(uploadRoot, storedName);
  const outside = join(root, 'outside.bin');
  writeFileSync(candidate, payload);
  writeFileSync(outside, payload);
  const sourcePath = createSource(root, emptySnapshot(), { uploads: [{
    id: 'UPLOAD-RACE-1', operation_id: 'operation-race', original_name: 'private-race.bin',
    content_type: 'application/octet-stream', kind: 'attachment', size: payload.length,
    sha256: digest, stored_name: storedName, claimed_task_id: null,
  }] });
  const source = readV1Source(resolveExistingPath(sourcePath));
  const plan = buildMigrationPlan({
    source,
    businessTimeZone: 'Asia/Shanghai',
    importedAt: FIXED_NOW,
  });

  assert.throws(() => verifyUploadManifest(resolveExistingPath(uploadRoot, 'directory'), plan, {
    hashUploads: true,
    duringFileScan: () => {
      rmSync(candidate);
      symlinkSync(outside, candidate);
    },
  }), error => {
    assert.equal(error.code, 'UPLOAD_PATH_UNSAFE');
    assert.equal(error.attachmentManifest.unsafePaths, 1);
    assert.equal(error.attachmentManifest.hashesChecked, 0);
    return true;
  });
}));

test('attachment manifest reports missing, size, and hash failures truthfully', () => {
  for (const variant of ['missing', 'size', 'hash']) withTempRoot(root => {
    const payload = Buffer.from('manifest-negative');
    const storedName = 'controlled.bin';
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot);
    if (variant !== 'missing') writeFileSync(join(uploadRoot, storedName), payload);
    const expectedSize = variant === 'size' ? payload.length + 1 : payload.length;
    const expectedHash = variant === 'hash'
      ? '0'.repeat(64)
      : createHash('sha256').update(payload).digest('hex');
    const source = createSource(root, emptySnapshot(), { uploads: [{
      id: 'UPLOAD-NEGATIVE-1', operation_id: 'operation-negative', original_name: 'hidden.bin',
      content_type: 'application/octet-stream', kind: 'attachment', size: expectedSize,
      sha256: expectedHash, stored_name: storedName, claimed_task_id: null,
    }] });
    const extra = ['--upload-root', uploadRoot, ...(variant === 'hash' ? ['--hash-uploads'] : [])];
    const result = executeMigration(baseArgs(source, null, extra));
    const expectedCode = {
      missing: 'UPLOAD_FILE_MISSING',
      size: 'UPLOAD_SIZE_MISMATCH',
      hash: 'UPLOAD_HASH_MISMATCH',
    }[variant];
    assert.equal(result.report.result, 'INVALID_SOURCE');
    assert.equal(result.report.issues[0].code, expectedCode);
    assert.equal(result.report.attachments.validationStatus, 'FAILED');
    if (variant === 'missing') assert.equal(result.report.attachments.filesMissing, 1);
    if (variant === 'size') assert.equal(result.report.attachments.sizeMismatches, 1);
    if (variant === 'hash') {
      assert.equal(result.report.attachments.hashesChecked, 1);
      assert.equal(result.report.attachments.hashMismatches, 1);
    }
  });
});

test('attachment manifest blocks staged cleanup tombstones without recovery or disclosure', () => withTempRoot(root => {
  const payload = Buffer.from('staged-cleanup-tombstone');
  const digest = createHash('sha256').update(payload).digest('hex');
  const storedName = `${digest}.bin`;
  const tombstoneName = `${storedName}.cleanup-00000000-0000-4000-8000-000000000000`;
  const uploadRoot = join(root, 'uploads');
  const cleanupRoot = join(uploadRoot, '.cleanup');
  mkdirSync(cleanupRoot, { recursive: true });
  const tombstonePath = join(cleanupRoot, tombstoneName);
  writeFileSync(tombstonePath, payload);
  const source = createSource(root, emptySnapshot(), { uploads: [{
    id: 'UPLOAD-STAGED-1', operation_id: 'operation-staged', original_name: 'private-staged.bin',
    content_type: 'application/octet-stream', kind: 'attachment', size: payload.length,
    sha256: digest, stored_name: storedName, claimed_task_id: null,
  }] });
  const sourceBefore = hashFile(source);
  const tombstoneBefore = hashFile(tombstonePath);
  const rootEntriesBefore = readdirSync(uploadRoot).toSorted();
  const cleanupEntriesBefore = readdirSync(cleanupRoot).toSorted();

  const result = executeMigration(baseArgs(source, null, ['--upload-root', uploadRoot]));

  assert.equal(result.report.result, 'INVALID_SOURCE');
  assert.equal(result.report.issues[0].code, 'STAGED_UPLOAD_RECOVERY_REQUIRED');
  assert.equal(result.report.attachments.validationStatus, 'FAILED');
  assert.equal(result.report.attachments.stagedTombstonesObserved, 1);
  assert.equal(result.report.attachments.filesMissing, 0);
  assert.equal(hashFile(source), sourceBefore);
  assert.equal(hashFile(tombstonePath), tombstoneBefore);
  assert.deepEqual(readdirSync(uploadRoot).toSorted(), rootEntriesBefore);
  assert.deepEqual(readdirSync(cleanupRoot).toSorted(), cleanupEntriesBefore);
  for (const secret of [root, storedName, tombstoneName, digest, 'private-staged.bin']) {
    assert.equal(result.output.includes(secret), false, secret);
  }
}));

test('reports disclose no absolute paths, business body, attachment names, raw responses, or stack', () => withTempRoot(root => {
  const privateText = 'PRIVATE-BRIEF-CONTENT';
  const snapshot = emptySnapshot({
    tasks: [{
      id: 'TASK-PRIVATE', sku: 'SKU-PRIVATE', name: privateText, client: privateText,
      deliver: privateText, kind: '待定', source: 'submission',
    }],
  });
  const source = createSource(root, snapshot, {
    operations: [{
      operation_id: 'operation-private-0001',
      kind: 'request.submit',
      response_json: '{not-json-private-response',
    }],
  });
  const result = executeMigration(baseArgs(source, createResourceMap(root)), {
    clock: () => new Date(FIXED_NOW),
  });
  assert.equal(result.report.result, 'INVALID_SOURCE');
  for (const forbidden of [root, source, privateText, 'not-json-private-response', 'stack']) {
    assert.equal(result.output.includes(forbidden), false, forbidden);
  }
}));

function createVerifiedTarget(root, plan) {
  const target = join(root, 'target.sqlite');
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  initializeWritableSchema(db, { now: () => new Date(FIXED_NOW) });
  const batchId = 'MIGRATION-BATCH-TEST-0001';
  db.prepare(`
    INSERT INTO schedule_state (id, revision, updated_at, snapshot_json)
    VALUES (1, ?, ?, ?)
  `).run(
    plan.source.snapshot.revision,
    plan.source.snapshot.updatedAt,
    JSON.stringify(plan.source.snapshot),
  );
  db.prepare(`
    INSERT INTO migration_batches (
      id, identity_digest, migration_version, mapping_version,
      source_schema_version, source_revision, source_schema_digest,
      source_structural_digest, configuration_digest, resource_map_version,
      resource_map_digest, business_time_zone, status, started_at, completed_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
  `).run(
    batchId,
    plan.batchIdentity,
    plan.migrationVersion,
    MIGRATION_VERSION,
    plan.source.snapshot.revision,
    plan.source.schemaDigest,
    plan.source.structuralDigest,
    plan.configurationDigest,
    plan.resourceMap?.mapVersion ?? null,
    plan.resourceMap?.digest ?? null,
    plan.businessTimeZone,
    FIXED_NOW,
    FIXED_NOW,
  );
  const bindValue = value => (typeof value === 'boolean' ? Number(value) : value);
  const insertRows = (table, rows) => {
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
        .run(...columns.map(column => bindValue(row[column])));
    }
  };
  insertRows('operations', plan.source.operations.map(row => ({ ...row, request_digest: null })));
  insertRows('uploads', plan.records.uploads);
  insertRows('product_catalog_entries', plan.records.product_catalog_entries.map(row => ({
    ...row,
    migration_batch_id: batchId,
  })));
  insertRows('requests_v2', plan.records.requests_v2.map(row => ({
    ...row,
    migration_batch_id: batchId,
  })));
  insertRows('schedule_items', plan.records.schedule_items.map(row => ({
    ...row,
    migration_batch_id: batchId,
  })));
  insertRows('schedule_item_tasks', plan.records.schedule_item_tasks);
  insertRows('legacy_asset_entries', plan.records.legacy_asset_entries.map(row => ({
    ...row,
    migration_batch_id: batchId,
  })));
  insertRows('legacy_compat_fragments', plan.records.legacy_compat_fragments.map((row, index) => ({
    id: index + 1,
    ...row,
    migration_batch_id: batchId,
  })));
  db.prepare(`
    INSERT INTO revision_counters (id, projection_revision, schedule_revision, updated_at)
    VALUES (1, ?, ?, ?)
  `).run(
    plan.records.revision_counters.projection_revision,
    plan.records.revision_counters.schedule_revision,
    FIXED_NOW,
  );
  db.prepare(`
    INSERT INTO snapshot_projections (
      projection_name, schema_version, revision, schedule_revision,
      updated_at, payload_json, source_schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    'schedule-v1-compat',
    1,
    plan.records.revision_counters.projection_revision,
    null,
    plan.projections.v1.updatedAt,
    JSON.stringify(plan.projections.v1),
  );
  db.prepare(`
    INSERT INTO snapshot_projections (
      projection_name, schema_version, revision, schedule_revision,
      updated_at, payload_json, source_schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    'schedule-v2',
    2,
    plan.records.revision_counters.projection_revision,
    plan.records.revision_counters.schedule_revision,
    plan.projections.v2.updatedAt,
    JSON.stringify(plan.projections.v2),
  );
  db.close();
  return target;
}

function insertAcceptedEventReceipt(db, scheduleItemId, eventId) {
  const runId = 'RUN-PRESEEDED-ACCEPTED';
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO production_runs (
        id, schedule_item_id, scope, task_id, status, run_revision,
        blocked_duration_ms, created_at, updated_at
      ) VALUES (?, ?, 'block', NULL, 'shooting', 1, 0, ?, ?)
    `).run(runId, scheduleItemId, FIXED_NOW, FIXED_NOW);
    db.prepare(`
      INSERT INTO production_events (
        event_id, run_id, command_digest, response_digest, event_type, occurred_at,
        received_at, device_id, actor_id, previous_state, resulting_state,
        resulting_run_revision, resulting_projection_revision, resulting_schedule_revision
      ) VALUES (?, ?, 'command-digest', 'response-digest', 'start', ?, ?,
        'DEVICE-PRESEEDED', 'ACTOR-PRESEEDED', 'scheduled', 'shooting', 1, 1, 0)
    `).run(eventId, runId, FIXED_NOW, FIXED_NOW);
    db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
      VALUES (?, 'production.run-event', '{}', ?, 'command-digest')
    `).run(eventId, FIXED_NOW);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertPendingEventReviewReceipt(db, scheduleItemId, eventId) {
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO run_event_reviews (
        event_id, run_id, schedule_item_id, command_digest, response_digest,
        event_type, expected_run_revision, occurred_at, received_at, device_id,
        actor_id, actor_role, reason_code, note, time_policy_version,
        review_reason, review_status, response_json, created_at
      ) VALUES (
        ?, 'RUN-PRESEEDED-REVIEW', ?, 'command-digest', 'response-digest',
        'start', 0, ?, ?, 'DEVICE-PRESEEDED',
        'ACTOR-PRESEEDED', 'operator', NULL, NULL, 'kiosk-event-time-local-v1',
        'tooOld', 'pending', '{}', ?
      )
    `).run(eventId, scheduleItemId, FIXED_NOW, FIXED_NOW, FIXED_NOW);
    db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
      VALUES (?, 'production.run-event-review', '{}', ?, 'command-digest')
    `).run(eventId, FIXED_NOW);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

test('async migration command preserves dry-run and verify-only compatibility', async () => (
  withApplyFixture(async root => {
    const sourcePath = createSource(root, emptySnapshot({ revision: 4 }));
    const dryArgs = [
      '--dry-run', '--source', sourcePath,
      '--business-time-zone', 'UTC', '--format', 'json',
    ];
    const syncDry = executeMigration(dryArgs, { clock: () => new Date(FIXED_NOW) });
    const asyncDry = await executeMigrationCommand(dryArgs, { clock: () => new Date(FIXED_NOW) });
    assert.deepEqual(asyncDry, syncDry);

    const source = readV1Source(resolveExistingPath(sourcePath));
    const plan = buildMigrationPlan({
      source,
      businessTimeZone: 'UTC',
      importedAt: FIXED_NOW,
    });
    const target = createVerifiedTarget(root, plan);
    const verifyArgs = [
      '--verify-only', '--source', sourcePath, '--target', target,
      '--business-time-zone', 'UTC', '--format', 'json',
    ];
    const syncVerify = executeMigration(verifyArgs, { clock: () => new Date(FIXED_NOW) });
    const asyncVerify = await executeMigrationCommand(verifyArgs, { clock: () => new Date(FIXED_NOW) });
    assert.deepEqual(asyncVerify, syncVerify);
  })
));

test('apply parser failures for acknowledgements, hashing, and paths create zero artifacts', async () => (
  withApplyFixture(async root => {
    const source = createSource(root, emptySnapshot());
    const complete = applyArgs(root, source);
    for (const option of [
      '--target',
      '--fixture-root',
      '--backup',
      '--rollback-target',
      '--proof-seal',
      '--hash-uploads',
      '--acknowledge-isolated-target',
      '--acknowledge-offline-maintenance',
    ]) {
      const args = [...complete];
      const index = args.indexOf(option);
      args.splice(index, VALUE_OPTIONS_FOR_TEST.has(option) ? 2 : 1);
      const before = readdirSync(root).toSorted();
      const result = await executeMigrationCommand(args, {
        clock: clockSequence(FIXED_NOW, FIXED_NOW, LATER_NOW),
      });
      assert.equal(result.report.result, 'INVALID_USAGE', option);
      assert.deepEqual(readdirSync(root).toSorted(), before, option);
      assert.equal(result.output.includes(root), false, option);
    }
  })
));

test('apply rejects every root-external raw path before resolving or reading inputs', async () => (
  withApplyFixture(async root => {
    const source = createSource(root, emptySnapshot());
    const outside = mkdtempSync(join(tmpdir(), 'jso-migration-outside-'));
    const privateText = 'PRIVATE-OUTSIDE-PREFLIGHT-CONTENT';
    const outsideFile = join(outside, 'private-input');
    const outsideDirectory = join(outside, 'private-uploads');
    writeFileSync(outsideFile, privateText);
    mkdirSync(outsideDirectory);
    try {
      for (const [option, value] of [
        ['--source', outsideFile],
        ['--target', join(outside, 'target.sqlite')],
        ['--resource-map', outsideFile],
        ['--upload-root', outsideDirectory],
      ]) {
        const args = applyArgs(root, source);
        const existing = args.indexOf(option);
        if (existing === -1) args.push(option, value);
        else args[existing + 1] = value;
        const before = readdirSync(root).toSorted();

        const result = await executeMigrationCommand(args, {
          clock: clockSequence(FIXED_NOW, FIXED_NOW, LATER_NOW),
        });

        assert.equal(result.report.result, 'INVALID_USAGE', option);
        assert.equal(result.report.issues[0].code, 'UNSAFE_DESTINATION', option);
        assert.equal(Object.hasOwn(result.report.source, 'pathDigest'), false, option);
        assert.deepEqual(readdirSync(root).toSorted(), before, option);
        for (const forbidden of [root, outside, outsideFile, outsideDirectory, privateText]) {
          assert.equal(result.output.includes(forbidden), false, `${option}:${forbidden}`);
        }
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  })
));

test('isolated apply succeeds, verifies every artifact, and replays without rewriting', async () => (
  withApplyFixture(async root => {
    const historicalSnapshot = fixture('v1-single-session.json');
    const source = createSource(root, {
      ...historicalSnapshot,
      revision: 4,
      sessions: [],
    }, {
      operations: [{
        operation_id: 'operation-historical-request-submit',
        kind: 'request.submit',
        response_json: JSON.stringify({ taskId: historicalSnapshot.tasks[0].id }),
      }],
    });
    const args = applyArgs(root, source);
    const first = await executeMigrationCommand(args, {
      clock: clockSequence(FIXED_NOW, FIXED_NOW, LATER_NOW),
    });
    assert.equal(first.exitCode, 0, first.output);
    assert.equal(first.report.result, 'APPLIED_VERIFIED');
    assert.equal(first.report.targetVerification.status, 'APPLIED_VERIFIED');
    assert.equal(first.report.switchReadiness, 'BLOCKED');
    assert.equal(first.report.attachments.validationStatus, 'PASS_NO_FILES');

    const verifiedTarget = new DatabaseSync(join(root, 'target.sqlite'), { readOnly: true });
    try {
      assert.equal(
        verifiedTarget.prepare('SELECT COUNT(*) AS count FROM operations').get().count,
        1,
      );
      assert.equal(
        verifiedTarget.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count,
        0,
        'historical V1 operations must not be migrated or replayed as notifications',
      );
    } finally {
      verifiedTarget.close();
    }

    const artifacts = ['target.sqlite', 'backup.sqlite', 'rollback.sqlite', 'proof.json'];
    const beforeReplay = Object.fromEntries(artifacts.map(name => [name, hashFile(join(root, name))]));
    if (!IS_WINDOWS) {
      for (const name of artifacts) assert.equal(statSync(join(root, name)).mode & 0o777, 0o600, name);
    }

    const replay = await executeMigrationCommand(args, {
      clock: clockSequence(LATER_NOW, LATER_NOW, LATER_NOW),
    });
    assert.equal(replay.exitCode, 0, replay.output);
    assert.equal(replay.report.result, 'ALREADY_APPLIED_VERIFIED');
    assert.equal(replay.report.targetVerification.status, 'ALREADY_APPLIED_VERIFIED');
    assert.equal(replay.report.switchReadiness, 'BLOCKED');
    assert.deepEqual(
      Object.fromEntries(artifacts.map(name => [name, hashFile(join(root, name))])),
      beforeReplay,
    );
  })
));

test('direct apply output remains low-disclosure', async () => (
  withApplyFixture(async root => {
    const privateText = 'PRIVATE-APPLY-BUSINESS-CONTENT';
    const source = createSource(root, emptySnapshot({
      tasks: [{
        id: 'TASK-PRIVATE-APPLY', sku: 'SKU-PRIVATE', name: privateText,
        client: privateText, deliver: privateText, kind: '待定', source: 'submission',
      }],
    }));
    const command = spawnSync(process.execPath, [
      fileURLToPath(new URL('../scripts/migrate-v1-to-v2.mjs', import.meta.url)),
      ...applyArgs(root, source),
    ], { encoding: 'utf8', timeout: 15000 });
    assert.equal(command.status, 0, command.stderr || command.stdout);
    const report = JSON.parse(command.stdout);
    assert.equal(report.result, 'APPLIED_VERIFIED');
    assert.equal(report.switchReadiness, 'BLOCKED');
    for (const forbidden of [
      root,
      source,
      join(root, 'target.sqlite'),
      join(root, 'backup.sqlite'),
      join(root, 'rollback.sqlite'),
      join(root, 'proof.json'),
      privateText,
      'stack',
    ]) assert.equal(command.stdout.includes(forbidden), false, forbidden);
  })
));

test('verify-only reads a complete matching target and rejects batch mismatch without writes', () => withTempRoot(root => {
  const sourcePath = createSource(root, emptySnapshot({ revision: 4 }));
  const sourceInfo = resolveExistingPath(sourcePath);
  const source = readV1Source(sourceInfo);
  const plan = buildMigrationPlan({
    source,
    businessTimeZone: 'Asia/Shanghai',
    importedAt: FIXED_NOW,
  });
  const target = createVerifiedTarget(root, plan);
  const before = hashFile(target);
  const result = executeMigration([
    '--verify-only', '--source', sourcePath, '--target', target,
    '--business-time-zone', 'Asia/Shanghai', '--format', 'json',
  ], { clock: () => new Date(FIXED_NOW) });
  assert.equal(result.report.result, 'INVALID_TARGET');
  assert.equal(result.exitCode, 5);
  assert.equal(result.report.targetVerification.status, 'TARGET_FACTS_VERIFIED_UNSEALED');
  assert.equal(result.report.switchReadiness, 'BLOCKED');
  assert.deepEqual(
    result.report.issues.filter(issue => issue.code === 'PROOF_SEAL_NOT_VERIFIED'),
    [{ code: 'PROOF_SEAL_NOT_VERIFIED', severity: 'WARNING', count: 1 }],
  );
  assert.equal(hashFile(target), before);

  const writable = new DatabaseSync(target);
  writable.prepare('UPDATE migration_batches SET identity_digest = ?').run(`sha256:${'f'.repeat(64)}`);
  writable.close();
  const mismatch = executeMigration([
    '--verify-only', '--source', sourcePath, '--target', target,
    '--business-time-zone', 'Asia/Shanghai', '--format', 'json',
  ], { clock: () => new Date(FIXED_NOW) });
  assert.equal(mismatch.report.result, 'INVALID_TARGET');
  assert.equal(mismatch.report.issues[0].code, 'TARGET_BATCH_MISMATCH');
}));

test('verify-only rejects any notification intent added to an isolated migration target', () => withTempRoot(root => {
  const sourcePath = createSource(root, emptySnapshot({ revision: 4 }));
  const source = readV1Source(resolveExistingPath(sourcePath));
  const plan = buildMigrationPlan({
    source,
    businessTimeZone: 'Asia/Shanghai',
    importedAt: FIXED_NOW,
  });
  const target = createVerifiedTarget(root, plan);
  const payload = '{}';
  const payloadDigest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const writable = new DatabaseSync(target);
  writable.prepare(`
    INSERT INTO notification_outbox (
      outbox_id, channel, dedupe_key, intent_type, aggregate_type, aggregate_id,
      aggregate_revision_scope, aggregate_revision, route_key, card_schema_version,
      delivery_policy_version, payload_json, payload_digest, status, attempt_count,
      available_at, created_at, updated_at
    ) VALUES (?, 'dingtalk', ?, 'production-run.completed.v1', 'production_run', ?,
      'run', 1, 'fixture-route', 'dingtalk-card-v1', 'outbox-dispatch-v1', ?, ?,
      'pending', 0, ?, ?, ?)
  `).run(
    'OUTBOX-UNEXPECTED-HISTORICAL-INTENT',
    'dingtalk:dingtalk-card-v1:production-run.completed.v1:production_run:RUN-HISTORICAL:run:1',
    'RUN-HISTORICAL',
    payload,
    payloadDigest,
    FIXED_NOW,
    FIXED_NOW,
    FIXED_NOW,
  );
  writable.close();
  const before = hashFile(target);

  const result = executeMigration([
    '--verify-only', '--source', sourcePath, '--target', target,
    '--business-time-zone', 'Asia/Shanghai', '--format', 'json',
  ], { clock: () => new Date(FIXED_NOW) });

  assert.equal(result.report.result, 'INVALID_TARGET');
  assert.equal(result.exitCode, 5);
  assert.equal(result.report.issues[0].code, 'TARGET_BATCH_MISMATCH');
  assert.equal(result.report.switchReadiness, 'NOT_RUN');
  assert.equal(hashFile(target), before);
}));

test('verify-only rejects canonical fact tampering even when counts and stored projections still match', () => withTempRoot(root => {
  const snapshot = fixture('v1-single-session.json');
  const sourcePath = createSource(root, snapshot);
  const resourceMapPath = createResourceMap(root);
  const source = readV1Source(resolveExistingPath(sourcePath));
  const plan = buildMigrationPlan({
    source,
    businessTimeZone: 'Asia/Shanghai',
    resourceMap: parseResourceMap(readFileSync(resourceMapPath, 'utf8'), 'Asia/Shanghai'),
    importedAt: FIXED_NOW,
  });
  const target = createVerifiedTarget(root, plan);
  const verifyArgs = [
    '--verify-only', '--source', sourcePath, '--target', target,
    '--business-time-zone', 'Asia/Shanghai', '--resource-map', resourceMapPath,
    '--format', 'json',
  ];
  const laterVerification = executeMigration(verifyArgs, {
    clock: () => new Date(LATER_NOW),
  });
  assert.equal(laterVerification.report.result, 'INVALID_TARGET');
  assert.equal(laterVerification.exitCode, 5);
  assert.equal(laterVerification.report.targetVerification.status, 'TARGET_FACTS_VERIFIED_UNSEALED');
  assert.equal(laterVerification.report.switchReadiness, 'BLOCKED');

  const writable = new DatabaseSync(target);
  writable.prepare('UPDATE migration_batches SET completed_at = ?')
    .run('2026-09-22T11:59:59.000Z');
  writable.close();
  const invalidTime = executeMigration(verifyArgs, { clock: () => new Date(LATER_NOW) });
  assert.equal(invalidTime.report.result, 'INVALID_TARGET');
  assert.equal(invalidTime.report.issues[0].code, 'TARGET_BATCH_TIME_INVALID');

  const tamper = new DatabaseSync(target);
  tamper.prepare('UPDATE migration_batches SET completed_at = ?').run(FIXED_NOW);
  tamper.prepare('UPDATE schedule_state SET updated_at = ? WHERE id = 1').run(LATER_NOW);
  tamper.close();
  const scheduleMismatch = executeMigration(verifyArgs, { clock: () => new Date(LATER_NOW) });
  assert.equal(scheduleMismatch.report.issues[0].code, 'TARGET_FACT_MISMATCH');

  const auditTamper = new DatabaseSync(target);
  auditTamper.prepare('UPDATE schedule_state SET updated_at = ? WHERE id = 1')
    .run(snapshot.updatedAt);
  auditTamper.prepare(`
    INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
    VALUES ('tamper', 'test', NULL, 7, ?, ?)
  `).run('PRIVATE-AUDIT-RESULT', FIXED_NOW);
  auditTamper.close();
  const auditMismatch = executeMigration(verifyArgs, { clock: () => new Date(LATER_NOW) });
  assert.equal(auditMismatch.report.issues[0].code, 'TARGET_FACT_MISMATCH');
  assert.equal(auditMismatch.output.includes('PRIVATE-AUDIT-RESULT'), false);

  const projectionTamper = new DatabaseSync(target);
  projectionTamper.prepare('DELETE FROM audit_log').run();
  projectionTamper.prepare(`
    UPDATE snapshot_projections SET source_schema_version = 2
    WHERE projection_name = 'schedule-v1-compat'
  `).run();
  projectionTamper.close();
  const projectionMismatch = executeMigration(verifyArgs, { clock: () => new Date(LATER_NOW) });
  assert.equal(projectionMismatch.report.issues[0].code, 'TARGET_BATCH_MISMATCH');

  const factTamper = new DatabaseSync(target);
  factTamper.prepare(`
    UPDATE snapshot_projections SET source_schema_version = 1
    WHERE projection_name = 'schedule-v1-compat'
  `).run();
  factTamper.prepare('UPDATE requests_v2 SET name = ? WHERE id = ?')
    .run('tampered-but-count-preserved', snapshot.tasks[0].id);
  factTamper.close();

  const result = executeMigration(verifyArgs, { clock: () => new Date(LATER_NOW) });
  assert.equal(result.report.result, 'INVALID_TARGET');
  assert.equal(result.report.issues[0].code, 'TARGET_FACT_MISMATCH');
  assert.equal(result.output.includes('tampered-but-count-preserved'), false);
}));

test('verify-only rejects nonempty run-event owner and review facts without modifying the target', () => {
  withTempRoot(root => {
    const snapshot = fixture('v1-single-session.json');
    const sourcePath = createSource(root, snapshot);
    const resourceMapPath = createResourceMap(root);
    const source = readV1Source(resolveExistingPath(sourcePath));
    const plan = buildMigrationPlan({
      source,
      businessTimeZone: 'Asia/Shanghai',
      resourceMap: parseResourceMap(readFileSync(resourceMapPath, 'utf8'), 'Asia/Shanghai'),
      importedAt: FIXED_NOW,
    });
    const target = createVerifiedTarget(root, plan);
    const writable = new DatabaseSync(target);
    writable.exec('PRAGMA foreign_keys = ON');
    insertAcceptedEventReceipt(
      writable,
      plan.records.schedule_items[0].id,
      'EVENT-PRESEEDED-OWNER',
    );
    writable.close();
    const before = hashFile(target);

    const result = executeMigration([
      '--verify-only', '--source', sourcePath, '--target', target,
      '--business-time-zone', 'Asia/Shanghai', '--resource-map', resourceMapPath,
      '--format', 'json',
    ], { clock: () => new Date(FIXED_NOW) });

    assert.equal(result.report.result, 'INVALID_TARGET');
    assert.equal(result.report.issues[0].code, 'TARGET_BATCH_MISMATCH');
    assert.equal(hashFile(target), before);
  });

  withTempRoot(root => {
    const snapshot = fixture('v1-single-session.json');
    const sourcePath = createSource(root, snapshot);
    const resourceMapPath = createResourceMap(root);
    const source = readV1Source(resolveExistingPath(sourcePath));
    const plan = buildMigrationPlan({
      source,
      businessTimeZone: 'Asia/Shanghai',
      resourceMap: parseResourceMap(readFileSync(resourceMapPath, 'utf8'), 'Asia/Shanghai'),
      importedAt: FIXED_NOW,
    });
    const target = createVerifiedTarget(root, plan);
    const writable = new DatabaseSync(target);
    writable.exec('PRAGMA foreign_keys = ON');
    insertPendingEventReviewReceipt(
      writable,
      plan.records.schedule_items[0].id,
      'EVENT-PRESEEDED-REVIEW',
    );
    writable.close();
    const before = hashFile(target);

    const result = executeMigration([
      '--verify-only', '--source', sourcePath, '--target', target,
      '--business-time-zone', 'Asia/Shanghai', '--resource-map', resourceMapPath,
      '--format', 'json',
    ], { clock: () => new Date(FIXED_NOW) });

    assert.equal(result.report.result, 'INVALID_TARGET');
    assert.equal(result.report.issues[0].code, 'TARGET_BATCH_MISMATCH');
    assert.equal(hashFile(target), before);
  });
});

test('verify-only rejects a partial target and never repairs it', () => withTempRoot(root => {
  const source = createSource(root, emptySnapshot());
  const target = join(root, 'partial.sqlite');
  const db = new DatabaseSync(target);
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    );
  `);
  db.close();
  const before = hashFile(target);
  const result = executeMigration([
    '--verify-only', '--source', source, '--target', target,
    '--business-time-zone', 'Asia/Shanghai', '--format', 'json',
  ], { clock: () => new Date(FIXED_NOW) });
  assert.equal(result.report.result, 'INVALID_TARGET');
  assert.equal(result.report.issues[0].code, 'PARTIAL_TARGET_MIGRATION');
  assert.equal(result.report.targetVerification.status, 'PARTIAL_TARGET_MIGRATION');
  assert.equal(hashFile(target), before);
}));

test('relative and same-inode direct, hardlink, and symlink paths fail closed without leaking paths', () => {
  const relative = executeMigration([
    '--dry-run', '--source', 'relative.sqlite', '--business-time-zone', 'UTC', '--format', 'json',
  ]);
  assert.equal(relative.report.result, 'INVALID_USAGE');
  assert.equal(relative.output.includes('relative.sqlite'), false);

  withTempRoot(root => {
    const source = createSource(root, emptySnapshot());
    const hardlink = join(root, 'source-hardlink.sqlite');
    linkSync(source, hardlink);
    const targets = [source, hardlink];
    if (CAN_CREATE_FILE_SYMLINK) {
      const symlink = join(root, 'source-symlink.sqlite');
      symlinkSync(source, symlink);
      targets.push(symlink);
    }
    for (const target of targets) {
      const same = executeMigration([
        '--verify-only', '--source', source, '--target', target,
        '--business-time-zone', 'UTC', '--format', 'json',
      ]);
      assert.equal(same.report.result, 'INVALID_USAGE');
      assert.equal(same.report.issues[0].code, 'SOURCE_TARGET_CONFLICT');
      assert.equal(same.output.includes(root), false);
    }
  });
});
