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

test('fresh schema applies a continuous migration prefix and only the WO-02A tables', () => {
  const db = memoryDatabase();
  try {
    const result = initializeWritableSchema(db, { now: () => new Date('2026-09-22T08:00:00.000Z') });
    assert.deepEqual(result, { version: LATEST_SCHEMA_VERSION, latestVersion: LATEST_SCHEMA_VERSION });
    assert.equal(LATEST_SCHEMA_VERSION, 2);
    assert.deepEqual(
      db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all().map(row => ({ ...row })),
      MIGRATIONS.map(({ version, name, checksum }) => ({ version, name, checksum })),
    );

    const tables = tableNames(db);
    for (const table of [
      'schedule_state', 'operations', 'audit_log', 'uploads', 'schema_migrations',
      'migration_batches', 'revision_counters', 'product_catalog_entries', 'requests_v2',
      'schedule_items', 'schedule_item_tasks', 'legacy_asset_entries', 'legacy_compat_fragments',
      'production_runs', 'production_events', 'snapshot_projections',
    ]) assert.ok(tables.includes(table), `expected ${table}`);
    for (const deferred of ['notification_outbox', 'scheduling_proposals', 'scheduling_config_versions']) {
      assert.equal(tables.includes(deferred), false);
    }

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
        .run(3, 'unknown_future', 'sha256:' + 'f'.repeat(64), '2026-09-22T08:00:00.000Z');
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

  await t.test('partial migration prefix lets concurrent processes resume at migration two', async () => {
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
          [1, 2],
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
