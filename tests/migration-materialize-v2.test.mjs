import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { materializeMigrationPlan } from '../src/migration-materialize-sqlite-v2.mjs';
import { buildMigrationPlan, parseResourceMap } from '../src/migration-v2.mjs';
import {
  readV1Source,
  resolveExistingPath,
  verifyV2Target,
} from '../src/migration-sqlite-v2.mjs';
import {
  V1_SCHEMA_SQL,
  initializeWritableSchema,
} from '../src/sqlite-schema-v2.mjs';

const FIXED_STARTED = '2026-09-22T12:00:00.000Z';
const FIXED_COMPLETED = '2026-09-22T12:00:01.000Z';
const FIXTURE_ROOT = new URL('../fixtures/migration-v2/', import.meta.url);

const NORMALIZED_TABLES = Object.freeze([
  'migration_batches',
  'revision_counters',
  'product_catalog_entries',
  'requests_v2',
  'schedule_items',
  'schedule_item_tasks',
  'legacy_asset_entries',
  'legacy_compat_fragments',
  'production_runs',
  'production_events',
  'run_event_id_owners',
  'run_event_reviews',
  'snapshot_projections',
]);

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), 'utf8'));
}

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

function withTempRoot(action) {
  const root = mkdtempSync(join(tmpdir(), 'jso-materialize-v2-'));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createV1Source(root, snapshot, {
  name = 'source.sqlite',
  operations = [],
  uploads = [],
  audit = [],
} = {}) {
  const path = join(root, name);
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
    for (const row of operations) insertOperation.run(
      row.operation_id, row.kind, row.response_json, row.created_at,
    );
    const insertUpload = db.prepare(`
      INSERT INTO uploads (
        id, operation_id, original_name, content_type, kind, size, sha256,
        stored_name, claimed_task_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of uploads) insertUpload.run(
      row.id, row.operation_id, row.original_name, row.content_type, row.kind,
      row.size, row.sha256, row.stored_name, row.claimed_task_id, row.created_at,
    );
    const insertAudit = db.prepare(`
      INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of audit) insertAudit.run(
      row.action, row.role, row.entity_id, row.revision, row.result, row.created_at,
    );
  } finally {
    db.close();
  }
  return path;
}

function resourceMap() {
  return parseResourceMap(JSON.stringify({
    schemaVersion: 1,
    mapVersion: 'fixture-map-v1',
    businessTimeZone: 'Asia/Shanghai',
    places: { '主影棚': 'studio-main' },
  }), 'Asia/Shanghai');
}

function prepareTarget(root, snapshot, {
  prefix = 'case',
  operations = [],
  uploads = [],
  audit = [],
  map = snapshot.sessions.length ? resourceMap() : null,
} = {}) {
  const sourcePath = createV1Source(root, snapshot, {
    name: `${prefix}-source.sqlite`, operations, uploads, audit,
  });
  const source = readV1Source(resolveExistingPath(sourcePath));
  const plan = buildMigrationPlan({
    source,
    businessTimeZone: 'Asia/Shanghai',
    resourceMap: map,
    importedAt: FIXED_STARTED,
  });
  const targetPath = join(root, `${prefix}-target.sqlite`);
  copyFileSync(sourcePath, targetPath);
  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA foreign_keys = ON');
  initializeWritableSchema(db, { now: () => new Date(FIXED_STARTED) });
  return { db, plan, sourcePath, targetPath };
}

function assertNormalizedEmpty(db) {
  for (const table of NORMALIZED_TABLES) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  }
}

function normalizedCounts(db) {
  return Object.fromEntries(NORMALIZED_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function insertHumanScheduleItem(db, scheduleItemId) {
  db.prepare(`
    INSERT INTO schedule_items (
      id, source_ordinal, resource_id, resource_resolution_status,
      planned_start, planned_end, buffer_source, schedule_status,
      schedule_status_provenance, lock_status_provenance, note, allocation_mode,
      source, imported_at
    ) VALUES (?, 0, 'STUDIO-PRESEEDED', 'resolved', ?, ?, 'domain_default', 'confirmed',
      'domain_command', 'domain_command', '', 'grouped_unallocated', 'human', ?)
  `).run(
    scheduleItemId,
    '2026-09-22T09:00:00.000Z',
    '2026-09-22T10:00:00.000Z',
    FIXED_STARTED,
  );
}

function insertAcceptedEventReceipt(db, eventId) {
  const scheduleItemId = 'SCHEDULE-PRESEEDED-ACCEPTED';
  const runId = 'RUN-PRESEEDED-ACCEPTED';
  db.exec('BEGIN');
  try {
    insertHumanScheduleItem(db, scheduleItemId);
    db.prepare(`
      INSERT INTO production_runs (
        id, schedule_item_id, scope, task_id, status, run_revision,
        blocked_duration_ms, created_at, updated_at
      ) VALUES (?, ?, 'block', NULL, 'shooting', 1, 0, ?, ?)
    `).run(runId, scheduleItemId, FIXED_STARTED, FIXED_STARTED);
    db.prepare(`
      INSERT INTO production_events (
        event_id, run_id, command_digest, response_digest, event_type, occurred_at,
        received_at, device_id, actor_id, previous_state, resulting_state,
        resulting_run_revision, resulting_projection_revision, resulting_schedule_revision
      ) VALUES (?, ?, 'command-digest', 'response-digest', 'start', ?, ?,
        'DEVICE-PRESEEDED', 'ACTOR-PRESEEDED', 'scheduled', 'shooting', 1, 1, 0)
    `).run(eventId, runId, FIXED_STARTED, FIXED_STARTED);
    db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
      VALUES (?, 'production.run-event', '{}', ?, 'command-digest')
    `).run(eventId, FIXED_STARTED);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const owner = db.prepare(`
    SELECT event_id, owner_kind FROM run_event_id_owners WHERE event_id = ?
  `).get(eventId);
  assert.equal(owner.event_id, eventId);
  assert.equal(owner.owner_kind, 'accepted');
}

function insertPendingEventReviewReceipt(db, eventId) {
  const scheduleItemId = 'SCHEDULE-PRESEEDED-REVIEW';
  db.exec('BEGIN');
  try {
    insertHumanScheduleItem(db, scheduleItemId);
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
    `).run(eventId, scheduleItemId, FIXED_STARTED, FIXED_STARTED, FIXED_STARTED);
    db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
      VALUES (?, 'production.run-event-review', '{}', ?, 'command-digest')
    `).run(eventId, FIXED_STARTED);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const owner = db.prepare(`
    SELECT event_id, owner_kind FROM run_event_id_owners WHERE event_id = ?
  `).get(eventId);
  assert.equal(owner.event_id, eventId);
  assert.equal(owner.owner_kind, 'review');
}

function applyAndVerify(prepared, label = 'case') {
  const result = materializeMigrationPlan({
    db: prepared.db,
    plan: prepared.plan,
    startedAt: FIXED_STARTED,
    completedAt: FIXED_COMPLETED,
  });
  assert.equal(result.status, 'APPLIED');
  assert.match(result.batchId, /^MIG-[A-F0-9]{32}$/u);
  assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM run_event_id_owners').get().count, 0);
  assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM run_event_reviews').get().count, 0);
  prepared.db.close();
  let verified;
  try {
    verified = verifyV2Target(resolveExistingPath(prepared.targetPath), prepared.plan);
  } catch (error) {
    assert.fail(`${label}: ${error.code}`);
  }
  assert.equal(verified.status, 'ALREADY_APPLIED_VERIFIED');
}

test('materializes empty, single, grouped, and L1 plans as exact verifiable targets', () => {
  const cases = [
    ['empty', emptySnapshot({ revision: 4 })],
    ['single', fixture('v1-single-session.json')],
    ['grouped', fixture('v1-grouped-session.json')],
    ['l1', (() => {
      const snapshot = fixture('v1-single-session.json');
      snapshot.tasks[0].runtimeOnlyExtension = { opaque: true };
      return snapshot;
    })()],
  ];
  for (const [name, snapshot] of cases) {
    withTempRoot(root => {
      const prepared = prepareTarget(root, snapshot, { prefix: name });
      applyAndVerify(prepared, name);
    });
  }
});

test('materializes a request.submit operation and managed upload without changing upload metadata', () => withTempRoot(root => {
  const snapshot = fixture('v1-single-session.json');
  const bytes = Buffer.from('managed-upload-fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const asset = {
    id: 'UPLOAD-MANAGED-001',
    name: 'private-source-name.bin',
    contentType: 'application/octet-stream',
    kind: 'attachment',
    size: bytes.length,
    sha256: digest,
  };
  snapshot.tasks[0].assets = [asset];
  const operation = {
    operation_id: 'OP-MANAGED-001',
    kind: 'request.submit',
    response_json: JSON.stringify({ taskId: snapshot.tasks[0].id }),
    created_at: '2026-09-21T10:00:00.000Z',
  };
  const upload = {
    id: asset.id,
    operation_id: operation.operation_id,
    original_name: asset.name,
    content_type: asset.contentType,
    kind: asset.kind,
    size: asset.size,
    sha256: asset.sha256,
    stored_name: null,
    claimed_task_id: snapshot.tasks[0].id,
    created_at: '2026-09-21T10:00:01.000Z',
  };
  const prepared = prepareTarget(root, snapshot, {
    prefix: 'managed', operations: [operation], uploads: [upload],
  });
  const before = prepared.db.prepare(`
    SELECT id, operation_id, original_name, content_type, kind, size, sha256,
           stored_name, claimed_task_id, created_at
    FROM uploads WHERE id = ?
  `).get(asset.id);
  materializeMigrationPlan({
    db: prepared.db,
    plan: prepared.plan,
    startedAt: FIXED_STARTED,
    completedAt: FIXED_COMPLETED,
  });
  const after = prepared.db.prepare(`
    SELECT id, operation_id, original_name, content_type, kind, size, sha256,
           stored_name, claimed_task_id, created_at, claimed_order
    FROM uploads WHERE id = ?
  `).get(asset.id);
  assert.deepEqual(
    Object.fromEntries(Object.entries(after).filter(([key]) => key !== 'claimed_order')),
    { ...before },
  );
  assert.equal(after.claimed_order, 0);
  assert.equal(
    prepared.db.prepare('SELECT source_operation_id FROM requests_v2').get().source_operation_id,
    operation.operation_id,
  );
  prepared.db.close();
  assert.equal(
    verifyV2Target(resolveExistingPath(prepared.targetPath), prepared.plan).status,
    'ALREADY_APPLIED_VERIFIED',
  );
}));

test('every materialization stage rolls back batch, facts, counters, projections, and upload order', () => {
  const stages = [
    'after_begin',
    'after_preflight',
    'after_batch',
    'after_uploads',
    'after_catalog',
    'after_requests',
    'after_schedule_items',
    'after_bindings',
    'after_legacy_assets',
    'after_fragments',
    'after_counters',
    'after_projections',
    'after_v1_recheck',
    'before_commit',
  ];
  for (const stage of stages) {
    withTempRoot(root => {
      const snapshot = fixture('v1-single-session.json');
      const bytes = Buffer.from('rollback-upload');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const legacyDigest = createHash('sha256').update('legacy-rollback-asset').digest('hex');
      snapshot.tasks[0].runtimeOnlyExtension = { rollback: true };
      snapshot.tasks[0].assets = [
        {
          id: 'UPLOAD-ROLLBACK-001',
          name: 'rollback.bin',
          contentType: 'application/octet-stream',
          kind: 'attachment',
          size: bytes.length,
          sha256: digest,
        },
        {
          id: 'LEGACY-ASSET-ROLLBACK-001',
          name: 'legacy-rollback.bin',
          contentType: 'application/octet-stream',
          kind: 'attachment',
          size: 21,
          sha256: legacyDigest,
        },
      ];
      const prepared = prepareTarget(root, snapshot, {
        prefix: `fault-${stage}`,
        uploads: [{
          id: 'UPLOAD-ROLLBACK-001',
          operation_id: 'OP-ROLLBACK-001',
          original_name: 'rollback.bin',
          content_type: 'application/octet-stream',
          kind: 'attachment',
          size: bytes.length,
          sha256: digest,
          stored_name: null,
          claimed_task_id: snapshot.tasks[0].id,
          created_at: '2026-09-21T10:00:01.000Z',
        }],
      });
      assert.throws(() => materializeMigrationPlan({
        db: prepared.db,
        plan: prepared.plan,
        startedAt: FIXED_STARTED,
        completedAt: FIXED_COMPLETED,
        faultInjector(current) {
          if (current === stage) throw new Error('PRIVATE FAULT DETAILS');
        },
      }), error => (
        error.code === 'TARGET_APPLY_FAILED'
        && !error.message.includes('PRIVATE FAULT DETAILS')
      ), stage);
      assertNormalizedEmpty(prepared.db);
      assert.equal(
        prepared.db.prepare('SELECT claimed_order FROM uploads').get().claimed_order,
        null,
        stage,
      );
      prepared.db.close();
    });
  }
});

test('rejects invalid or plan-inconsistent migration times before writing', () => withTempRoot(root => {
  const prepared = prepareTarget(root, fixture('v1-single-session.json'), { prefix: 'times' });
  const attempts = [
    ['not-a-time', FIXED_COMPLETED, 'INVALID_MIGRATION_TIME'],
    [FIXED_STARTED, '2026-09-22T11:59:59.000Z', 'INVALID_MIGRATION_TIME'],
    ['2026-09-22T12:00:00Z', FIXED_COMPLETED, 'MIGRATION_TIME_MISMATCH'],
  ];
  for (const [startedAt, completedAt, code] of attempts) {
    assert.throws(() => materializeMigrationPlan({
      db: prepared.db,
      plan: prepared.plan,
      startedAt,
      completedAt,
    }), error => error.code === code);
    assertNormalizedEmpty(prepared.db);
  }
  prepared.db.close();
}));

test('rejects nonempty normalized or batch state without adding materialization rows', () => {
  withTempRoot(root => {
    const prepared = prepareTarget(root, emptySnapshot(), { prefix: 'counter-extra' });
    prepared.db.prepare(`
      INSERT INTO revision_counters (id, projection_revision, schedule_revision, updated_at)
      VALUES (1, 0, 0, ?)
    `).run(FIXED_STARTED);
    assert.throws(() => materializeMigrationPlan({
      db: prepared.db,
      plan: prepared.plan,
      startedAt: FIXED_STARTED,
      completedAt: FIXED_COMPLETED,
    }), error => error.code === 'TARGET_NOT_EMPTY');
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM migration_batches').get().count, 0);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM revision_counters').get().count, 1);
    prepared.db.close();
  });

  withTempRoot(root => {
    const prepared = prepareTarget(root, emptySnapshot(), { prefix: 'batch-extra' });
    prepared.db.prepare(`
      INSERT INTO migration_batches (
        id, identity_digest, migration_version, mapping_version,
        source_schema_version, source_revision, source_schema_digest,
        source_structural_digest, configuration_digest, resource_map_version,
        resource_map_digest, business_time_zone, status, started_at, completed_at
      ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, NULL, NULL, ?, 'completed', ?, ?)
    `).run(
      'MIG-UNRELATED', `sha256:${'1'.repeat(64)}`, 'unrelated', 'unrelated',
      `sha256:${'2'.repeat(64)}`, `sha256:${'3'.repeat(64)}`,
      `sha256:${'4'.repeat(64)}`, 'Asia/Shanghai', FIXED_STARTED, FIXED_COMPLETED,
    );
    assert.throws(() => materializeMigrationPlan({
      db: prepared.db,
      plan: prepared.plan,
      startedAt: FIXED_STARTED,
      completedAt: FIXED_COMPLETED,
    }), error => error.code === 'TARGET_NOT_EMPTY');
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM migration_batches').get().count, 1);
    prepared.db.close();
  });

  withTempRoot(root => {
    const prepared = prepareTarget(root, emptySnapshot(), { prefix: 'event-owner-extra' });
    insertAcceptedEventReceipt(prepared.db, 'EVENT-PRESEEDED-OWNER');
    const before = normalizedCounts(prepared.db);
    assert.throws(() => materializeMigrationPlan({
      db: prepared.db,
      plan: prepared.plan,
      startedAt: FIXED_STARTED,
      completedAt: FIXED_COMPLETED,
    }), error => error.code === 'TARGET_NOT_EMPTY');
    assert.deepEqual(normalizedCounts(prepared.db), before);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM migration_batches').get().count, 0);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM run_event_id_owners').get().count, 1);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM run_event_reviews').get().count, 0);
    prepared.db.close();
  });

  withTempRoot(root => {
    const prepared = prepareTarget(root, emptySnapshot(), { prefix: 'event-review-extra' });
    insertPendingEventReviewReceipt(prepared.db, 'EVENT-PRESEEDED-REVIEW');
    const before = normalizedCounts(prepared.db);
    assert.throws(() => materializeMigrationPlan({
      db: prepared.db,
      plan: prepared.plan,
      startedAt: FIXED_STARTED,
      completedAt: FIXED_COMPLETED,
    }), error => error.code === 'TARGET_NOT_EMPTY');
    assert.deepEqual(normalizedCounts(prepared.db), before);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM migration_batches').get().count, 0);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM run_event_id_owners').get().count, 1);
    assert.equal(prepared.db.prepare('SELECT COUNT(*) AS count FROM run_event_reviews').get().count, 1);
    prepared.db.close();
  });
});

test('rejects V1 schedule, operations, uploads, and audit tampering before the batch marker', () => {
  const cases = [
    ['schedule', db => db.prepare('UPDATE schedule_state SET revision = revision + 1').run()],
    ['operations', db => db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
      VALUES ('OP-EXTRA', 'other', '{}', ?, NULL)
    `).run(FIXED_STARTED)],
    ['uploads', db => db.prepare('UPDATE uploads SET size = size + 1').run()],
    ['audit', db => db.prepare(`
      INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
      VALUES ('tamper', 'test', NULL, 99, 'PRIVATE RESULT', ?)
    `).run(FIXED_STARTED)],
  ];
  for (const [name, tamper] of cases) {
    withTempRoot(root => {
      const snapshot = fixture('v1-single-session.json');
      const digest = createHash('sha256').update('v1-tamper').digest('hex');
      snapshot.tasks[0].assets = [{
        id: 'UPLOAD-TAMPER-001',
        name: 'tamper.bin',
        contentType: 'application/octet-stream',
        kind: 'attachment',
        size: 9,
        sha256: digest,
      }];
      const prepared = prepareTarget(root, snapshot, {
        prefix: `v1-${name}`,
        uploads: [{
          id: 'UPLOAD-TAMPER-001',
          operation_id: 'OP-TAMPER-001',
          original_name: 'tamper.bin',
          content_type: 'application/octet-stream',
          kind: 'attachment',
          size: 9,
          sha256: digest,
          stored_name: null,
          claimed_task_id: snapshot.tasks[0].id,
          created_at: FIXED_STARTED,
        }],
        audit: [{
          action: 'fixture', role: 'test', entity_id: null, revision: snapshot.revision,
          result: 'ok', created_at: FIXED_STARTED,
        }],
      });
      tamper(prepared.db);
      assert.throws(() => materializeMigrationPlan({
        db: prepared.db,
        plan: prepared.plan,
        startedAt: FIXED_STARTED,
        completedAt: FIXED_COMPLETED,
      }), error => (
        error.code === 'TARGET_V1_MISMATCH'
        && !error.message.includes('PRIVATE RESULT')
      ), name);
      assertNormalizedEmpty(prepared.db);
      prepared.db.close();
    });
  }
});
