import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ScheduleStore } from '../src/store.mjs';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  V1_SCHEMA_SQL,
  assertKnownSchema,
  applySchemaMigrations,
  initializeWritableSchema,
} from '../src/sqlite-schema-v2.mjs';

const execFileAsync = promisify(execFile);
const schemaModuleUrl = new URL('../src/sqlite-schema-v2.mjs', import.meta.url).href;
const storeModuleUrl = new URL('../src/store.mjs', import.meta.url).href;

function runWorkers(source, databasePath, count = 2) {
  const startAt = String(Date.now() + 300);
  return Promise.all(Array.from({ length: count }, () => execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', source, databasePath, startAt],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  )));
}

const initializeWorker = `
  import { DatabaseSync } from 'node:sqlite';
  import { initializeWritableSchema } from ${JSON.stringify(schemaModuleUrl)};
  const [databasePath, startAtText] = process.argv.slice(1);
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    const delay = Number(startAtText) - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    initializeWritableSchema(db);
  } finally {
    db.close();
  }
`;

const storeWorker = `
  import { ScheduleStore } from ${JSON.stringify(storeModuleUrl)};
  const [databasePath, startAtText] = process.argv.slice(1);
  const delay = Number(startAtText) - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  const store = new ScheduleStore({ filename: databasePath });
  store.close();
`;

function memoryDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function tableNames(db) {
  return db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(row => row.name);
}

test('historical migration 1-3 identities remain pinned', () => {
  assert.deepEqual(MIGRATIONS.slice(0, 3).map(({ version, name, checksum }) => ({
    version, name, checksum,
  })), [
    {
      version: 1,
      name: 'v2_normalized_core',
      checksum: 'sha256:b77dcddc0284a94a1dbc1e1a981fb7cbf3e4f2d41f8d6ccc999d37a298d1a3b5',
    },
    {
      version: 2,
      name: 'v1_compatibility_columns',
      checksum: 'sha256:b944e3ed4d77774e77aa378a3e04cce7a07ae744dd867d7b89aa4ac704d94670',
    },
    {
      version: 3,
      name: 'kiosk_run_event_review_ownership',
      checksum: 'sha256:20cbd2b8a992a888120fdaad41ddb7ec7f8aa4de65a2d7388c018c382e4e9476',
    },
  ]);
});

function insertPendingOutbox(db, {
  outboxId = 'OUTBOX-0001',
  dedupeKey = `dingtalk:dingtalk-card-v1:production-run.completed.v1:production_run:RUN-1:run:1`,
  availableAt = '2026-09-22T08:00:00.000Z',
  intentType = 'production-run.completed.v1',
  aggregateType = 'production_run',
  aggregateId = 'RUN-1',
  revisionScope = 'run',
} = {}) {
  db.prepare(`
    INSERT INTO notification_outbox (
      outbox_id, channel, dedupe_key, intent_type, aggregate_type, aggregate_id,
      aggregate_revision_scope, aggregate_revision, route_key, card_schema_version,
      delivery_policy_version, payload_json, payload_digest, status, attempt_count,
      available_at, created_at, updated_at
    ) VALUES (?, 'dingtalk', ?, ?, ?, ?,
      ?, 1, 'operations.default', 'dingtalk-card-v1', 'outbox-dispatch-v1',
      '{"runId":"RUN-1"}', ?, 'pending', 0, ?, ?, ?)
  `).run(
    outboxId,
    dedupeKey,
    intentType,
    aggregateType,
    aggregateId,
    revisionScope,
    'sha256:' + 'a'.repeat(64),
    availableAt,
    availableAt,
    availableAt,
  );
}

test('fresh schema applies the continuous migration prefix and known tables', () => {
  const db = memoryDatabase();
  try {
    const result = initializeWritableSchema(db, { now: () => new Date('2026-09-22T08:00:00.000Z') });
    assert.deepEqual(result, { version: LATEST_SCHEMA_VERSION, latestVersion: LATEST_SCHEMA_VERSION });
    assert.equal(LATEST_SCHEMA_VERSION, 5);
    assert.deepEqual(
      db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all().map(row => ({ ...row })),
      MIGRATIONS.map(({ version, name, checksum }) => ({ version, name, checksum })),
    );

    const tables = tableNames(db);
    for (const table of [
      'schedule_state', 'operations', 'audit_log', 'uploads', 'schema_migrations',
      'migration_batches', 'revision_counters', 'product_catalog_entries', 'requests_v2',
      'schedule_items', 'schedule_item_tasks', 'legacy_asset_entries', 'legacy_compat_fragments',
      'production_runs', 'production_events', 'snapshot_projections', 'run_event_id_owners',
      'run_event_reviews', 'notification_outbox', 'scheduling_resources',
      'scheduling_admin_operations',
      'scheduling_request_requirements',
      'scheduling_config_versions', 'scheduling_active_config',
      'scheduling_config_activations', 'scheduling_proposals', 'scheduling_proposal_decisions',
    ]) assert.ok(tables.includes(table), `expected ${table}`);

    assert.equal(db.prepare(`PRAGMA table_info(product_catalog_entries)`).all().find(row => row.name === 'id').type, 'TEXT');
    assert.ok(columns(db, 'uploads').includes('claimed_order'));
    assert.ok(columns(db, 'operations').includes('request_digest'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM revision_counters').get().count, 0);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('migration v4 upgrades an exact v3 prefix without changing prior markers', () => {
  const db = memoryDatabase();
  try {
    const v3Migrations = MIGRATIONS.slice(0, 3);
    assert.deepEqual(
      initializeWritableSchema(db, { migrations: v3Migrations }),
      { version: 3, latestVersion: 3 },
    );
    const before = db.prepare(`
      SELECT version, name, checksum, applied_at
      FROM schema_migrations ORDER BY version
    `).all().map(row => ({ ...row }));
    assert.equal(tableNames(db).includes('notification_outbox'), false);

    assert.deepEqual(initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 4) }),
      { version: 4, latestVersion: 4 });
    const after = db.prepare(`
      SELECT version, name, checksum, applied_at
      FROM schema_migrations ORDER BY version
    `).all().map(row => ({ ...row }));
    assert.deepEqual(after.slice(0, 3), before);
    assert.deepEqual(after[3], {
      version: 4,
      name: 'notification_outbox',
      checksum: MIGRATIONS[3].checksum,
      applied_at: after[3].applied_at,
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0);
    assert.deepEqual(assertKnownSchema(db, { migrations: MIGRATIONS.slice(0, 4) }),
      { version: 4, latestVersion: 4 });
  } finally {
    db.close();
  }
});

test('migration v5 upgrades v4 without changing historical markers and seals proposal facts', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 4) });
    const before = db.prepare(`SELECT version, name, checksum, applied_at
      FROM schema_migrations ORDER BY version`).all().map(row => ({ ...row }));
    assert.equal(tableNames(db).includes('scheduling_proposals'), false);
    assert.deepEqual(initializeWritableSchema(db), { version: 5, latestVersion: 5 });
    const after = db.prepare(`SELECT version, name, checksum, applied_at
      FROM schema_migrations ORDER BY version`).all().map(row => ({ ...row }));
    assert.deepEqual(after.slice(0, 4), before);
    assert.deepEqual(after[4], {
      version: 5, name: 'scheduling_proposals', checksum: MIGRATIONS[4].checksum,
      applied_at: after[4].applied_at,
    });
    db.prepare(`INSERT INTO scheduling_config_versions
      (config_version, schema_version, algorithm_version, calendar_compiler_version,
       estimate_policy_version, config_json, config_digest, published_by, published_at,
       publish_operation_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'config-v1', 'algorithm-v1', 'calendar-v1', 'estimate-v1', '{}',
      'sha256:' + 'a'.repeat(64), 'admin', '2026-09-22T08:00:00.000Z', 'PUBLISH-1',
    );
    assert.throws(() => db.exec(`UPDATE scheduling_config_versions SET config_json = '{}'
      WHERE config_version = 'config-v1'`), /immutable/);
    db.prepare(`INSERT INTO scheduling_proposals
      (proposal_id, proposal_json, generation_operation_id, generation_command_digest,
       input_digest, result_digest, base_schedule_revision, config_version, status,
       terminal_decision_id, created_at, lifecycle_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'draft', NULL, ?, ?)`).run(
      'PROPOSAL-1', '{}', 'GENERATE-1', 'sha256:' + 'b'.repeat(64),
      'sha256:' + 'c'.repeat(64), 'sha256:' + 'd'.repeat(64), 'config-v1',
      '2026-09-22T08:00:00.000Z', '2026-09-22T08:00:00.000Z',
    );
    assert.throws(() => db.exec(`UPDATE scheduling_proposals SET proposal_json = '{}'
      WHERE proposal_id = 'PROPOSAL-1'`), /immutable|invalid scheduling proposal transition/);
    assert.throws(() => db.exec(`UPDATE scheduling_proposals SET status = 'rejected',
      terminal_decision_id = 'DECISION-1' WHERE proposal_id = 'PROPOSAL-1'`), /invalid scheduling proposal transition/);
    db.prepare(`INSERT INTO scheduling_proposal_decisions
      (decision_id, proposal_id, decision_command_digest, decision_type,
       receipt_json, receipt_digest, decided_at) VALUES (?, ?, ?, 'reject', ?, ?, ?)`).run(
      'DECISION-1', 'PROPOSAL-1', 'sha256:' + 'e'.repeat(64), '{}',
      'sha256:' + 'f'.repeat(64), '2026-09-22T08:01:00.000Z',
    );
    db.exec(`UPDATE scheduling_proposals SET status = 'rejected',
      terminal_decision_id = 'DECISION-1', lifecycle_updated_at = '2026-09-22T08:01:00.000Z'
      WHERE proposal_id = 'PROPOSAL-1'`);
    assert.throws(() => db.exec(`UPDATE scheduling_proposals SET status = 'stale'
      WHERE proposal_id = 'PROPOSAL-1'`), /sealed|invalid scheduling proposal transition/);
    assert.throws(() => db.exec(`DELETE FROM scheduling_proposal_decisions
      WHERE decision_id = 'DECISION-1'`), /cannot be deleted/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('migration preserves all existing V1 rows and leaves compatibility columns nullable', () => {
  const db = memoryDatabase();
  try {
    db.exec(V1_SCHEMA_SQL);
    const snapshot = JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      updatedAt: '2026-09-22T08:00:00.000Z',
      products: [], tasks: [], sessions: [],
    });
    db.prepare('INSERT INTO schedule_state VALUES (1, 7, ?, ?)')
      .run('2026-09-22T08:00:00.000Z', snapshot);
    db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?)')
      .run('operation-preserved-0001', 'request.submit', '{"ok":true}', '2026-09-22T08:00:00.000Z');
    db.prepare('INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('request.submit', 'submitter', 'TASK-1', 7, 'success', '2026-09-22T08:00:00.000Z');
    db.prepare('INSERT INTO uploads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'UPLOAD-1', 'operation-preserved-0001', 'asset.png', 'image/png', 'image', 12,
      'a'.repeat(64), 'a'.repeat(64) + '.png', 'TASK-1', '2026-09-22T08:00:00.000Z',
    );
    const before = {
      schedule: db.prepare('SELECT * FROM schedule_state').all().map(row => ({ ...row })),
      operations: db.prepare('SELECT operation_id, kind, response_json, created_at FROM operations').all().map(row => ({ ...row })),
      audit: db.prepare('SELECT * FROM audit_log').all().map(row => ({ ...row })),
      uploads: db.prepare(`
        SELECT id, operation_id, original_name, content_type, kind, size, sha256,
               stored_name, claimed_task_id, created_at
        FROM uploads
      `).all().map(row => ({ ...row })),
    };

    initializeWritableSchema(db);

    assert.deepEqual(db.prepare('SELECT * FROM schedule_state').all().map(row => ({ ...row })), before.schedule);
    assert.deepEqual(
      db.prepare('SELECT operation_id, kind, response_json, created_at FROM operations').all().map(row => ({ ...row })),
      before.operations,
    );
    assert.deepEqual(db.prepare('SELECT * FROM audit_log').all().map(row => ({ ...row })), before.audit);
    assert.deepEqual(db.prepare(`
      SELECT id, operation_id, original_name, content_type, kind, size, sha256,
             stored_name, claimed_task_id, created_at
      FROM uploads
    `).all().map(row => ({ ...row })), before.uploads);
    assert.equal(db.prepare('SELECT request_digest FROM operations').get().request_digest, null);
    assert.equal(db.prepare('SELECT claimed_order FROM uploads').get().claimed_order, null);
  } finally {
    db.close();
  }
});

test('reapplying migrations is idempotent and does not add markers or business revisions', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);
    const beforeSchema = db.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all().map(row => ({ ...row }));
    const beforeMarkers = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all().map(row => ({ ...row }));

    initializeWritableSchema(db);

    assert.deepEqual(
      db.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `).all().map(row => ({ ...row })),
      beforeSchema,
    );
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all().map(row => ({ ...row })), beforeMarkers);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM revision_counters').get().count, 0);
  } finally {
    db.close();
  }
});

test('name/checksum drift, an unknown higher version, and a marker hole fail closed', async t => {
  await t.test('name drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec('DROP TRIGGER schema_migrations_no_update;');
      db.prepare('UPDATE schema_migrations SET name = ? WHERE version = 1').run('renamed_migration');
      db.exec(`
        CREATE TRIGGER schema_migrations_no_update
        BEFORE UPDATE ON schema_migrations
        BEGIN
          SELECT RAISE(ABORT, 'schema migration markers are immutable');
        END;
      `);
      assert.throws(() => applySchemaMigrations(db), error => error.code === 'SCHEMA_MIGRATION_DRIFT');
    } finally {
      db.close();
    }
  });

  await t.test('checksum drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec('DROP TRIGGER schema_migrations_no_update;');
      db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('sha256:' + '0'.repeat(64));
      db.exec(`
        CREATE TRIGGER schema_migrations_no_update
        BEFORE UPDATE ON schema_migrations
        BEGIN
          SELECT RAISE(ABORT, 'schema migration markers are immutable');
        END;
      `);
      assert.throws(() => applySchemaMigrations(db), error => error.code === 'SCHEMA_MIGRATION_DRIFT');
    } finally {
      db.close();
    }
  });

  await t.test('unknown higher version', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)')
        .run(LATEST_SCHEMA_VERSION + 1, 'unknown_future', 'sha256:' + 'f'.repeat(64), '2026-09-22T08:00:00.000Z');
      assert.throws(() => applySchemaMigrations(db), error => error.code === 'SCHEMA_VERSION_TOO_NEW');
    } finally {
      db.close();
    }
  });

  await t.test('marker hole', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec('DROP TRIGGER schema_migrations_no_delete; DELETE FROM schema_migrations WHERE version = 1;');
      db.exec(`
        CREATE TRIGGER schema_migrations_no_delete
        BEFORE DELETE ON schema_migrations
        BEGIN
          SELECT RAISE(ABORT, 'schema migration markers are immutable');
        END;
      `);
      assert.throws(() => applySchemaMigrations(db), error => error.code === 'SCHEMA_MIGRATION_HOLE');
    } finally {
      db.close();
    }
  });
});

test('unmarked partial structure fails closed and a late DDL failure rolls the migration back', async t => {
  await t.test('partial structure', () => {
    const db = memoryDatabase();
    try {
      db.exec(V1_SCHEMA_SQL);
      db.exec('CREATE TABLE requests_v2 (id TEXT PRIMARY KEY);');
      assert.throws(() => applySchemaMigrations(db), error => error.code === 'SCHEMA_PARTIAL_MIGRATION');
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
    } finally {
      db.close();
    }
  });

  await t.test('transaction rollback', () => {
    const db = memoryDatabase();
    try {
      db.exec(V1_SCHEMA_SQL);
      const sql = `
        CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY) STRICT;
        SELECT missing_migration_function();
      `;
      const migration = {
        version: 1,
        name: 'transaction_rollback_probe',
        sql,
        checksum: `sha256:${createHash('sha256').update(sql).digest('hex')}`,
      };
      assert.throws(
        () => applySchemaMigrations(db, { migrations: [migration] }),
        error => error.code === 'SCHEMA_MIGRATION_FAILED',
      );
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
      assert.equal(tableNames(db).includes('rollback_probe'), false);
    } finally {
      db.close();
    }
  });

  await t.test('unmarked migration v4 Outbox object', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 3) });
      db.exec('CREATE TABLE notification_outbox (outbox_id TEXT PRIMARY KEY) STRICT;');
      assert.throws(
        () => applySchemaMigrations(db),
        error => error.code === 'SCHEMA_PARTIAL_MIGRATION',
      );
      assert.deepEqual(
        db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version),
        [1, 2, 3],
      );
    } finally {
      db.close();
    }
  });
});

test('known schema rejects altered canonical DDL and unknown persistent objects', async t => {
  await t.test('V2 table with identical columns but removed constraints and STRICT', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TABLE migration_batches;
        CREATE TABLE migration_batches (
          id TEXT,
          identity_digest TEXT,
          migration_version TEXT,
          mapping_version TEXT,
          source_schema_version INTEGER,
          source_revision INTEGER,
          source_schema_digest TEXT,
          source_structural_digest TEXT,
          configuration_digest TEXT,
          resource_map_version TEXT,
          resource_map_digest TEXT,
          business_time_zone TEXT,
          status TEXT,
          started_at TEXT,
          completed_at TEXT
        );
      `);
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_STRUCTURE_MISMATCH'
          && /migration_batches/.test(error.message),
      );
    } finally {
      db.close();
    }
  });

  await t.test('uploads compatibility table rejects removed constraints and claimed_order type drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TABLE uploads;
        CREATE TABLE uploads (
          id TEXT PRIMARY KEY,
          operation_id TEXT,
          original_name TEXT,
          content_type TEXT,
          kind TEXT,
          size INTEGER,
          sha256 TEXT,
          stored_name TEXT,
          claimed_task_id TEXT,
          created_at TEXT,
          claimed_order TEXT
        );
        CREATE INDEX uploads_claimed_task_idx ON uploads(claimed_task_id);
        CREATE UNIQUE INDEX uploads_claimed_order_uq
          ON uploads(claimed_task_id, claimed_order)
          WHERE claimed_task_id IS NOT NULL AND claimed_order IS NOT NULL;
      `);
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_STRUCTURE_MISMATCH'
          && /uploads/.test(error.message),
      );
    } finally {
      db.close();
    }
  });

  await t.test('operations compatibility table rejects request_digest type drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TABLE operations;
        CREATE TABLE operations (
          operation_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          request_digest INTEGER
        );
      `);
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_STRUCTURE_MISMATCH'
          && /operations/.test(error.message),
      );
    } finally {
      db.close();
    }
  });

  await t.test('marker table with identical columns but removed constraints and STRICT', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TABLE schema_migrations;
        CREATE TABLE schema_migrations (
          version INTEGER,
          name TEXT,
          checksum TEXT,
          applied_at TEXT
        );
      `);
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_MARKER_DRIFT'
          && /schema_migrations/.test(error.message),
      );
    } finally {
      db.close();
    }
  });

  await t.test('unknown persistent schema object', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec('CREATE TABLE untracked_table (id INTEGER PRIMARY KEY) STRICT;');
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_UNKNOWN_OBJECT'
          && /untracked_table/.test(error.message),
      );
    } finally {
      db.close();
    }
  });

  await t.test('marker trigger', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TRIGGER schema_migrations_no_update;
        CREATE TRIGGER schema_migrations_no_update
        BEFORE UPDATE ON schema_migrations BEGIN SELECT 1; END;
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_MARKER_DRIFT');
    } finally {
      db.close();
    }
  });

  await t.test('production event append-only trigger', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TRIGGER production_events_no_delete;
        CREATE TRIGGER production_events_no_delete
        BEFORE DELETE ON production_events BEGIN SELECT 1; END;
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_STRUCTURE_MISMATCH');
    } finally {
      db.close();
    }
  });

  await t.test('revision counter monotonicity trigger', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TRIGGER revision_counters_no_decrease;
        CREATE TRIGGER revision_counters_no_decrease
        BEFORE UPDATE ON revision_counters BEGIN SELECT 1; END;
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_STRUCTURE_MISMATCH');
    } finally {
      db.close();
    }
  });

  await t.test('partial unique active-run index', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP INDEX production_runs_one_active_per_item_uq;
        CREATE INDEX production_runs_one_active_per_item_uq
          ON production_runs(schedule_item_id);
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_STRUCTURE_MISMATCH');
    } finally {
      db.close();
    }
  });

  await t.test('notification Outbox trigger drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TRIGGER notification_outbox_terminal_sealed;
        CREATE TRIGGER notification_outbox_terminal_sealed
        BEFORE UPDATE ON notification_outbox BEGIN SELECT 1; END;
      `);
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_STRUCTURE_MISMATCH'
          && /notification_outbox_terminal_sealed/.test(error.message),
      );
    } finally {
      db.close();
    }
  });
});

test('notification Outbox v1 constraints seal identity and terminal delivery states', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);

    assert.throws(() => insertPendingOutbox(db, {
      outboxId: 'OUTBOX-REQUEST',
      dedupeKey: 'dingtalk:dingtalk-card-v1:request.submitted.v1:request:REQUEST-1:run:1',
      intentType: 'request.submitted.v1',
      aggregateType: 'request',
      aggregateId: 'REQUEST-1',
    }), /CHECK constraint failed/);
    assert.throws(() => insertPendingOutbox(db, {
      outboxId: 'OUTBOX-BAD-SCOPE',
      dedupeKey: 'dingtalk:dingtalk-card-v1:schedule.confirmed.v1:production_run:RUN-1:run:1',
      intentType: 'schedule.confirmed.v1',
    }), /CHECK constraint failed/);

    insertPendingOutbox(db);
    assert.throws(
      () => db.prepare(`
        UPDATE notification_outbox
        SET status = 'leased', attempt_count = 6, available_at = NULL,
            lease_token = 'LEASE-TOO-MANY', lease_owner = 'WORKER-1',
            lease_expires_at = ?, updated_at = ?
        WHERE outbox_id = 'OUTBOX-0001'
      `).run('2026-09-22T08:01:00.000Z', '2026-09-22T08:00:01.000Z'),
      /CHECK constraint failed|invalid notification outbox transition/,
    );
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'leased', attempt_count = 1, available_at = NULL,
          lease_token = 'LEASE-1', lease_owner = 'WORKER-1',
          lease_expires_at = ?, updated_at = ?
      WHERE outbox_id = 'OUTBOX-0001'
    `).run('2026-09-22T08:01:00.000Z', '2026-09-22T08:00:01.000Z');
    assert.throws(
      () => db.prepare(`
        UPDATE notification_outbox
        SET status = 'sent', available_at = NULL,
            lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
            provider_ref = 'CARD:CHANGED', delivery_receipt_digest = ?,
            sent_at = ?, payload_json = '{"changed":true}', updated_at = ?
        WHERE outbox_id = 'OUTBOX-0001'
      `).run(
        'sha256:' + 'b'.repeat(64),
        '2026-09-22T08:00:02.000Z',
        '2026-09-22T08:00:02.000Z',
      ),
      /identity is immutable/,
    );
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'sent', available_at = NULL,
          lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
          provider_ref = 'CARD:0001', delivery_receipt_digest = ?,
          sent_at = ?, updated_at = ?
      WHERE outbox_id = 'OUTBOX-0001'
    `).run(
      'sha256:' + 'b'.repeat(64),
      '2026-09-22T08:00:03.000Z',
      '2026-09-22T08:00:03.000Z',
    );
    assert.throws(
      () => db.prepare(`
        UPDATE notification_outbox SET updated_at = ? WHERE outbox_id = 'OUTBOX-0001'
      `).run('2026-09-22T08:00:04.000Z'),
      /terminal notification outbox record is sealed|invalid notification outbox transition/,
    );
    assert.throws(
      () => db.exec(`DELETE FROM notification_outbox WHERE outbox_id = 'OUTBOX-0001'`),
      /cannot be deleted/,
    );

    insertPendingOutbox(db, {
      outboxId: 'OUTBOX-0002',
      dedupeKey: 'dingtalk:dingtalk-card-v1:production-run.completed.v1:production_run:RUN-2:run:1',
    });
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'leased', attempt_count = 1, available_at = NULL,
          lease_token = 'LEASE-2', lease_owner = 'WORKER-2',
          lease_expires_at = ?, updated_at = ?
      WHERE outbox_id = 'OUTBOX-0002'
    `).run('2026-09-22T08:01:00.000Z', '2026-09-22T08:00:01.000Z');
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'deadLetter', available_at = NULL,
          lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
          last_error_code = 'DINGTALK_AUTH_REJECTED', updated_at = ?
      WHERE outbox_id = 'OUTBOX-0002'
    `).run('2026-09-22T08:00:02.000Z');
    assert.throws(
      () => db.prepare(`
        UPDATE notification_outbox
        SET status = 'pending', attempt_count = 0, available_at = ?,
            last_error_code = NULL, updated_at = ?
        WHERE outbox_id = 'OUTBOX-0002'
      `).run('2026-09-22T08:00:03.000Z', '2026-09-22T08:00:03.000Z'),
      /terminal notification outbox record is sealed|attempt count cannot decrease|invalid notification outbox transition/,
    );
  } finally {
    db.close();
  }
});

test('marker rows and production events are append-only, and foreign keys remain enforced', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);
    assert.throws(() => db.exec(`UPDATE schema_migrations SET name = 'changed' WHERE version = 1;`), /immutable/);
    assert.throws(() => db.exec('DELETE FROM schema_migrations WHERE version = 1;'), /immutable/);
    assert.throws(
      () => db.prepare(`
        INSERT INTO schedule_item_tasks (schedule_item_id, task_id, display_order, created_at, imported_at)
        VALUES ('missing-item', 'missing-task', 0, '2026-09-22T08:00:00.000Z', '2026-09-22T08:00:00.000Z')
      `).run(),
      /FOREIGN KEY constraint failed/,
    );

    db.prepare(`
      INSERT INTO schedule_items (
        id, source_ordinal, resource_id, resource_resolution_status, resource_mapping_version,
        legacy_place_text, planned_start, planned_end, buffer_after_minutes, buffer_source,
        schedule_status, schedule_status_provenance, lock_status, note, allocation_mode, source,
        lock_status_provenance, source_ref, business_created_at, business_updated_at, imported_at, migration_batch_id
      ) VALUES (?, 0, ?, 'resolved', NULL, NULL, ?, ?, NULL, 'legacy_unknown',
        'confirmed', 'domain_command', NULL, '', 'grouped_unallocated', 'human',
        'domain_command', NULL, NULL, NULL, ?, NULL)
    `).run(
      'SCHEDULE-1', 'studio-a', '2026-09-22T08:00:00.000Z', '2026-09-22T09:00:00.000Z',
      '2026-09-22T07:00:00.000Z',
    );
    db.prepare(`
      INSERT INTO production_runs (
        id, schedule_item_id, scope, task_id, status, run_revision, blocked_duration_ms, created_at, updated_at
      ) VALUES ('RUN-1', 'SCHEDULE-1', 'block', NULL, 'shooting', 1, 0, ?, ?)
    `).run('2026-09-22T08:00:00.000Z', '2026-09-22T08:00:00.000Z');
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`
      INSERT INTO production_events (
        event_id, run_id, command_digest, response_digest, event_type, occurred_at, received_at,
        device_id, actor_id, previous_state, resulting_state, resulting_run_revision,
        resulting_projection_revision, resulting_schedule_revision
      ) VALUES ('EVENT-1', 'RUN-1', ?, ?, 'start', ?, ?, 'DEVICE-1', 'ACTOR-1',
        'scheduled', 'shooting', 1, 1, 0)
    `).run(
      'sha256:' + 'a'.repeat(64),
      'sha256:' + 'b'.repeat(64),
      '2026-09-22T08:00:00.000Z',
      '2026-09-22T08:00:01.000Z',
    );
    db.prepare(`
      INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
      VALUES ('EVENT-1', 'production.run-event', '{"ok":true}', ?, ?)
    `).run('2026-09-22T08:00:01.000Z', 'sha256:' + 'c'.repeat(64));
    db.exec('COMMIT');
    assert.throws(() => db.exec(`UPDATE production_events SET note = 'changed' WHERE event_id = 'EVENT-1';`), /append-only/);
    assert.throws(() => db.exec(`DELETE FROM production_events WHERE event_id = 'EVENT-1';`), /append-only/);
  } finally {
    db.close();
  }
});

test('concurrent independent processes safely initialize and migrate the same database', async t => {
  await t.test('fresh full initialization lets both processes succeed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-schema-concurrent-fresh-'));
    const databasePath = join(root, 'fresh.sqlite');
    try {
      await runWorkers(initializeWorker, databasePath);
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('PRAGMA foreign_keys = ON;');
        assert.deepEqual(assertKnownSchema(db), {
          version: LATEST_SCHEMA_VERSION,
          latestVersion: LATEST_SCHEMA_VERSION,
        });
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, MIGRATIONS.length);
      } finally {
        db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('prebuilt V1 and marker let concurrent migration processes safely no-op', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-schema-concurrent-migrate-'));
    const databasePath = join(root, 'migrate.sqlite');
    const bootstrap = new DatabaseSync(databasePath);
    try {
      bootstrap.exec('PRAGMA foreign_keys = ON;');
      assert.deepEqual(initializeWritableSchema(bootstrap, { migrations: [] }), { version: 0, latestVersion: 0 });
      assert.equal(bootstrap.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
    } finally {
      bootstrap.close();
    }

    try {
      await runWorkers(initializeWorker, databasePath);
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('PRAGMA foreign_keys = ON;');
        assert.deepEqual(assertKnownSchema(db), {
          version: LATEST_SCHEMA_VERSION,
          latestVersion: LATEST_SCHEMA_VERSION,
        });
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, MIGRATIONS.length);
      } finally {
        db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('partial migration prefix lets concurrent processes resume through the latest migration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-schema-concurrent-prefix-'));
    const databasePath = join(root, 'prefix.sqlite');
    const bootstrap = new DatabaseSync(databasePath);
    try {
      bootstrap.exec('PRAGMA foreign_keys = ON;');
      assert.deepEqual(
        initializeWritableSchema(bootstrap, { migrations: [MIGRATIONS[0]] }),
        { version: 1, latestVersion: 1 },
      );
      assert.deepEqual(
        bootstrap.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version),
        [1],
      );
    } finally {
      bootstrap.close();
    }

    try {
      await runWorkers(initializeWorker, databasePath);
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('PRAGMA foreign_keys = ON;');
        assert.deepEqual(assertKnownSchema(db), {
          version: LATEST_SCHEMA_VERSION,
          latestVersion: LATEST_SCHEMA_VERSION,
        });
        assert.deepEqual(
          db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version),
          MIGRATIONS.map(migration => migration.version),
        );
      } finally {
        db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('two first-open ScheduleStore processes create exactly one initial snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-store-concurrent-first-open-'));
    const databasePath = join(root, 'store.sqlite');
    try {
      await runWorkers(storeWorker, databasePath);
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('PRAGMA foreign_keys = ON;');
        assert.deepEqual(assertKnownSchema(db), {
          version: LATEST_SCHEMA_VERSION,
          latestVersion: LATEST_SCHEMA_VERSION,
        });
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schedule_state').get().count, 1);
        const row = db.prepare('SELECT id, revision, snapshot_json FROM schedule_state').get();
        assert.equal(row.id, 1);
        assert.equal(row.revision, 0);
        assert.deepEqual(JSON.parse(row.snapshot_json), {
          schemaVersion: 1,
          revision: 0,
          updatedAt: JSON.parse(row.snapshot_json).updatedAt,
          products: [],
          tasks: [],
          sessions: [],
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test('read-only ScheduleStore enables query_only and performs no DDL, cleanup recovery, or directory creation', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-schema-readonly-'));
  const databasePath = join(root, 'v1.sqlite');
  const absentUploadRoot = join(root, 'must-not-be-created');
  const writable = new DatabaseSync(databasePath);
  try {
    writable.exec(V1_SCHEMA_SQL);
  } finally {
    writable.close();
  }

  const store = new ScheduleStore({ filename: databasePath, uploadRoot: absentUploadRoot, readOnly: true });
  try {
    assert.equal(store.db.prepare('PRAGMA query_only').get().query_only, 1);
    assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(existsSync(absentUploadRoot), false);
    assert.equal(
      store.db.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'schema_migrations'`).get().count,
      0,
    );
    assert.throws(() => store.db.exec('CREATE TABLE forbidden_write (id INTEGER);'), /readonly|read-only|not authorized/i);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
