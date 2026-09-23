import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  V1_SCHEMA_SQL,
  applySchemaMigrations,
  assertKnownSchema,
  initializeWritableSchema,
} from '../src/sqlite-schema-v2.mjs';

const T0 = '2026-09-22T09:00:00.000Z';

function memoryDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function seedSchedule(db, scheduleItemId = 'SCHEDULE-REVIEW-01') {
  db.prepare(`
    INSERT INTO schedule_items (
      id, source_ordinal, resource_id, resource_resolution_status,
      planned_start, planned_end, buffer_source, schedule_status,
      schedule_status_provenance, lock_status_provenance, note, allocation_mode,
      source, imported_at
    ) VALUES (?, 0, 'STUDIO-A', 'resolved', ?, ?, 'domain_default', 'confirmed',
      'domain_command', 'domain_command', '', 'grouped_unallocated', 'human', ?)
  `).run(
    scheduleItemId,
    '2026-09-22T09:00:00.000Z',
    '2026-09-22T10:00:00.000Z',
    T0,
  );
}

function seedRun(db, {
  runId = 'RUN-REVIEW-01',
  scheduleItemId = 'SCHEDULE-REVIEW-01',
} = {}) {
  db.prepare(`
    INSERT INTO production_runs (
      id, schedule_item_id, scope, task_id, status, run_revision,
      blocked_duration_ms, created_at, updated_at
    ) VALUES (?, ?, 'block', NULL, 'scheduled', 0, 0, ?, ?)
  `).run(runId, scheduleItemId, T0, T0);
}

function insertAcceptedEvent(db, {
  eventId = 'EVENT-ACCEPTED-01',
  runId = 'RUN-REVIEW-01',
  resultingRunRevision = 1,
} = {}) {
  db.prepare(`
    INSERT INTO production_events (
      event_id, run_id, command_digest, response_digest, event_type, occurred_at,
      received_at, device_id, actor_id, previous_state, resulting_state,
      resulting_run_revision, resulting_projection_revision, resulting_schedule_revision
    ) VALUES (?, ?, ?, ?, 'start', ?, ?, 'DEVICE-01', 'ACTOR-01',
      'scheduled', 'shooting', ?, 1, 0)
  `).run(
    eventId,
    runId,
    `sha256:${'a'.repeat(64)}`,
    `sha256:${'b'.repeat(64)}`,
    T0,
    '2026-09-22T09:00:01.000Z',
    resultingRunRevision,
  );
}

function insertReview(db, {
  eventId = 'EVENT-REVIEW-0001',
  runId = 'RUN-CLIENT-0001',
  scheduleItemId = 'SCHEDULE-REVIEW-01',
} = {}) {
  db.prepare(`
    INSERT INTO run_event_reviews (
      event_id, run_id, schedule_item_id, command_digest, response_digest, event_type,
      expected_run_revision, occurred_at, received_at, device_id, actor_id, actor_role,
      reason_code, note, time_policy_version, review_reason, review_status,
      response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'start', 0, ?, ?, 'DEVICE-01', 'ACTOR-01', 'operator',
      NULL, NULL, 'kiosk-event-time-local-v1', 'tooFarFuture', 'pending', ?, ?)
  `).run(
    eventId,
    runId,
    scheduleItemId,
    `sha256:${'c'.repeat(64)}`,
    `sha256:${'d'.repeat(64)}`,
    '2026-09-23T09:00:00.000Z',
    '2026-09-22T09:00:00.000Z',
    JSON.stringify({ ok: false, code: 'EVENT_TIME_REVIEW_REQUIRED', eventId }),
    '2026-09-22T09:00:00.000Z',
  );
}

function insertOperation(db, eventId, kind) {
  db.prepare(`
    INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
    VALUES (?, ?, ?, ?, ?)
  `).run(eventId, kind, '{"ok":true}', T0, `sha256:${'e'.repeat(64)}`);
}

function insertRow(db, verb, table, row) {
  const columns = Object.keys(row);
  db.prepare(`
    ${verb} INTO ${table} (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `).run(...columns.map(column => row[column]));
}

function insertAcceptedFactAndReceipt(db, options = {}) {
  const eventId = options.eventId ?? 'EVENT-ACCEPTED-01';
  db.exec('BEGIN IMMEDIATE');
  try {
    insertAcceptedEvent(db, options);
    insertOperation(db, eventId, 'production.run-event');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function insertReviewFactAndReceipt(db, options = {}) {
  const eventId = options.eventId ?? 'EVENT-REVIEW-0001';
  db.exec('BEGIN IMMEDIATE');
  try {
    insertReview(db, options);
    insertOperation(db, eventId, 'production.run-event-review');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

test('migration three creates the canonical review and event-id ownership schema', () => {
  const db = memoryDatabase();
  try {
    assert.deepEqual(initializeWritableSchema(db), {
      version: LATEST_SCHEMA_VERSION,
      latestVersion: LATEST_SCHEMA_VERSION,
    });
    assert.equal(LATEST_SCHEMA_VERSION, 3);
    assert.deepEqual(
      db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().map(row => ({ ...row })),
      [
        { version: 1, name: 'v2_normalized_core' },
        { version: 2, name: 'v1_compatibility_columns' },
        { version: 3, name: 'kiosk_run_event_review_ownership' },
      ],
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM run_event_reviews').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM run_event_id_owners').get().count, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(assertKnownSchema(db), { version: 3, latestVersion: 3 });
  } finally {
    db.close();
  }
});

test('migration three preserves V1 rows and is idempotent', () => {
  const db = memoryDatabase();
  try {
    db.exec(V1_SCHEMA_SQL);
    db.prepare('INSERT INTO schedule_state VALUES (1, 7, ?, ?)').run(
      T0,
      JSON.stringify({ schemaVersion: 1, revision: 7, updatedAt: T0, products: [], tasks: [], sessions: [] }),
    );
    db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?)')
      .run('V1-OPERATION-0001', 'request.submit', '{"ok":true}', T0);

    initializeWritableSchema(db);
    const beforeSchema = db.prepare(`
      SELECT type, name, sql FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all().map(row => ({ ...row }));
    const beforeV1 = db.prepare('SELECT * FROM schedule_state').all().map(row => ({ ...row }));
    const beforeOperation = db.prepare('SELECT * FROM operations').all().map(row => ({ ...row }));

    initializeWritableSchema(db);

    assert.deepEqual(db.prepare(`
      SELECT type, name, sql FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all().map(row => ({ ...row })), beforeSchema);
    assert.deepEqual(db.prepare('SELECT * FROM schedule_state').all().map(row => ({ ...row })), beforeV1);
    assert.deepEqual(db.prepare('SELECT * FROM operations').all().map(row => ({ ...row })), beforeOperation);
  } finally {
    db.close();
  }
});

test('migration three backfills old accepted event ownership without breaking receipt order', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 2) });
    seedSchedule(db);
    seedRun(db);
    insertAcceptedEvent(db);
    insertOperation(db, 'EVENT-ACCEPTED-01', 'production.run-event');

    assert.deepEqual(applySchemaMigrations(db), { version: 3, latestVersion: 3 });
    assert.deepEqual({ ...db.prepare('SELECT * FROM run_event_id_owners').get() }, {
      event_id: 'EVENT-ACCEPTED-01',
      owner_kind: 'accepted',
      created_at: '2026-09-22T09:00:01.000Z',
    });

    insertAcceptedFactAndReceipt(db, {
      eventId: 'EVENT-ACCEPTED-02',
      resultingRunRevision: 2,
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM run_event_id_owners').get().count, 2);
  } finally {
    db.close();
  }
});

test('migration three rejects operation-only accepted and review half states', async t => {
  for (const [kind, eventId] of [
    ['production.run-event', 'EVENT-ACCEPTED-ONLY'],
    ['production.run-event-review', 'EVENT-REVIEW-ONLY'],
  ]) await t.test(kind, () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 2) });
      insertOperation(db, eventId, kind);

      assert.throws(
        () => applySchemaMigrations(db),
        error => error.code === 'SCHEMA_MIGRATION_FAILED',
      );
      assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 2);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'run_event_reviews'").get().count,
        0,
      );
    } finally {
      db.close();
    }
  });
});

test('migration three rejects an accepted fact without its matching receipt', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 2) });
    seedSchedule(db);
    seedRun(db);
    insertAcceptedEvent(db);

    assert.throws(
      () => applySchemaMigrations(db),
      error => error.code === 'SCHEMA_FOREIGN_KEY_CHECK_FAILED',
    );
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'run_event_id_owners'").get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test('migration three fails closed and rolls back on preexisting cross-kind event-id collisions', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 2) });
    seedSchedule(db);
    seedRun(db);
    insertAcceptedEvent(db);
    insertOperation(db, 'EVENT-ACCEPTED-01', 'request.submit');

    assert.throws(
      () => applySchemaMigrations(db),
      error => error.code === 'SCHEMA_MIGRATION_FAILED',
    );
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'run_event_reviews'").get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test('accepted events and reviews claim one cross-table event-id owner', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);
    seedSchedule(db);
    seedRun(db);

    insertAcceptedFactAndReceipt(db);
    assert.equal(
      db.prepare("SELECT owner_kind FROM run_event_id_owners WHERE event_id = 'EVENT-ACCEPTED-01'").get().owner_kind,
      'accepted',
    );
    assert.throws(
      () => insertReview(db, { eventId: 'EVENT-ACCEPTED-01' }),
      /ownership conflict|UNIQUE constraint failed/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM run_event_reviews WHERE event_id = 'EVENT-ACCEPTED-01'").get().count, 0);

    insertReviewFactAndReceipt(db);
    assert.equal(
      db.prepare("SELECT owner_kind FROM run_event_id_owners WHERE event_id = 'EVENT-REVIEW-0001'").get().owner_kind,
      'review',
    );
    assert.throws(
      () => insertAcceptedEvent(db, { eventId: 'EVENT-REVIEW-0001', resultingRunRevision: 2 }),
      /ownership conflict|UNIQUE constraint failed/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM production_events WHERE event_id = 'EVENT-REVIEW-0001'").get().count, 0);
  } finally {
    db.close();
  }
});

test('operation admission requires fact-first ownership and deferred receipt completion', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);
    seedSchedule(db);
    seedRun(db);

    assert.throws(
      () => insertOperation(db, 'EVENT-ACCEPTED-FIRST', 'production.run-event'),
      /ownership conflict/,
    );
    assert.throws(
      () => insertOperation(db, 'EVENT-REVIEW-FIRST', 'production.run-event-review'),
      /ownership conflict/,
    );
    assert.throws(
      () => insertAcceptedEvent(db, { eventId: 'EVENT-ACCEPTED-FIRST' }),
      /FOREIGN KEY constraint failed/,
    );
    assert.throws(
      () => insertReview(db, { eventId: 'EVENT-REVIEW-FIRST' }),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operations WHERE operation_id IN ('EVENT-ACCEPTED-FIRST', 'EVENT-REVIEW-FIRST')").get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM production_events WHERE event_id = 'EVENT-ACCEPTED-FIRST'").get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM run_event_reviews WHERE event_id = 'EVENT-REVIEW-FIRST'").get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM run_event_id_owners WHERE event_id IN ('EVENT-ACCEPTED-FIRST', 'EVENT-REVIEW-FIRST')").get().count,
      0,
    );

    db.exec('BEGIN IMMEDIATE');
    insertAcceptedEvent(db, { eventId: 'EVENT-ACCEPTED-FIRST' });
    assert.equal(
      db.prepare("SELECT owner_kind FROM run_event_id_owners WHERE event_id = 'EVENT-ACCEPTED-FIRST'").get().owner_kind,
      'accepted',
    );
    insertOperation(db, 'EVENT-ACCEPTED-FIRST', 'production.run-event');
    db.exec('COMMIT');

    db.exec('BEGIN IMMEDIATE');
    insertReview(db, { eventId: 'EVENT-REVIEW-FIRST' });
    assert.equal(
      db.prepare("SELECT owner_kind FROM run_event_id_owners WHERE event_id = 'EVENT-REVIEW-FIRST'").get().owner_kind,
      'review',
    );
    insertOperation(db, 'EVENT-REVIEW-FIRST', 'production.run-event-review');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
});

test('review, ownership, and matching receipt facts are immutable and enforce foreign keys', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);
    seedSchedule(db);
    insertReviewFactAndReceipt(db);

    assert.throws(
      () => db.prepare(`UPDATE run_event_reviews SET note = 'changed' WHERE event_id = 'EVENT-REVIEW-0001'`).run(),
      /append-only/,
    );
    assert.throws(
      () => db.prepare(`DELETE FROM run_event_reviews WHERE event_id = 'EVENT-REVIEW-0001'`).run(),
      /append-only/,
    );
    assert.throws(
      () => db.prepare(`UPDATE run_event_id_owners SET owner_kind = 'accepted' WHERE event_id = 'EVENT-REVIEW-0001'`).run(),
      /ownership is immutable/,
    );
    assert.throws(
      () => db.prepare(`DELETE FROM run_event_id_owners WHERE event_id = 'EVENT-REVIEW-0001'`).run(),
      /ownership is immutable/,
    );
    for (const statement of [
      `UPDATE operations SET response_json = '{"forged":true}' WHERE operation_id = 'EVENT-REVIEW-0001'`,
      `UPDATE operations SET created_at = '2026-09-22T10:00:00.000Z' WHERE operation_id = 'EVENT-REVIEW-0001'`,
      `UPDATE operations SET request_digest = 'sha256:${'f'.repeat(64)}' WHERE operation_id = 'EVENT-REVIEW-0001'`,
      `UPDATE operations SET kind = 'request.submit' WHERE operation_id = 'EVENT-REVIEW-0001'`,
      `UPDATE operations SET operation_id = 'EVENT-FORGED' WHERE operation_id = 'EVENT-REVIEW-0001'`,
    ]) assert.throws(
      () => db.exec(statement),
      /run event operation (?:is immutable|ownership conflict)/,
    );
    assert.throws(
      () => db.prepare(`DELETE FROM operations WHERE operation_id = 'EVENT-REVIEW-0001'`).run(),
      /ownership is immutable/,
    );
    insertOperation(db, 'ORDINARY-OPERATION', 'request.submit');
    for (const statement of [
      `UPDATE operations SET kind = 'production.run-event' WHERE operation_id = 'ORDINARY-OPERATION'`,
      `UPDATE operations SET operation_id = 'EVENT-REVIEW-0001' WHERE operation_id = 'ORDINARY-OPERATION'`,
      `UPDATE operations SET operation_id = 'EVENT-NO-FACT', kind = 'production.run-event-review'
       WHERE operation_id = 'ORDINARY-OPERATION'`,
    ]) assert.throws(
      () => db.exec(statement),
      /ownership conflict/,
    );
    db.exec('BEGIN IMMEDIATE');
    insertReview(db, { eventId: 'EVENT-UPDATE-BYPASS' });
    assert.throws(
      () => db.prepare(`
        UPDATE operations
        SET operation_id = 'EVENT-UPDATE-BYPASS', kind = 'production.run-event-review'
        WHERE operation_id = 'ORDINARY-OPERATION'
      `).run(),
      /ownership conflict/,
    );
    db.exec('ROLLBACK');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM run_event_reviews WHERE event_id = 'EVENT-UPDATE-BYPASS'").get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT kind FROM operations WHERE operation_id = 'ORDINARY-OPERATION'").get().kind,
      'request.submit',
    );
    assert.throws(
      () => insertReview(db, { eventId: 'EVENT-REVIEW-0002', scheduleItemId: 'MISSING-SCHEDULE' }),
      /FOREIGN KEY constraint failed/,
    );
    assert.throws(
      () => db.prepare(`
        INSERT INTO run_event_id_owners (event_id, owner_kind, created_at)
        VALUES ('EVENT-ORPHAN-OWNER', 'review', ?)
      `).run(T0),
      /requires a review fact/,
    );
  } finally {
    db.close();
  }
});

test('replace syntax cannot rewrite owned receipts, owners, reviews, or accepted events', () => {
  const db = memoryDatabase();
  try {
    initializeWritableSchema(db);
    seedSchedule(db);
    seedRun(db);
    insertAcceptedFactAndReceipt(db);
    insertReviewFactAndReceipt(db);
    assert.equal(db.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0);

    const cases = [
      {
        table: 'operations',
        key: 'operation_id',
        id: 'EVENT-ACCEPTED-01',
        mutate: row => ({
          ...row,
          response_json: '{"forged":true}',
          request_digest: `sha256:${'f'.repeat(64)}`,
        }),
      },
      {
        table: 'run_event_id_owners',
        key: 'event_id',
        id: 'EVENT-ACCEPTED-01',
        mutate: row => ({ ...row, created_at: '2026-09-22T10:00:00.000Z' }),
      },
      {
        table: 'run_event_reviews',
        key: 'event_id',
        id: 'EVENT-REVIEW-0001',
        mutate: row => ({
          ...row,
          response_digest: `sha256:${'f'.repeat(64)}`,
          response_json: '{"forged":true}',
        }),
      },
      {
        table: 'production_events',
        key: 'event_id',
        id: 'EVENT-ACCEPTED-01',
        mutate: row => ({ ...row, response_digest: `sha256:${'f'.repeat(64)}`, note: 'forged' }),
      },
    ];

    for (const { table, key, id, mutate } of cases) {
      const original = { ...db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id) };
      for (const verb of ['INSERT OR REPLACE', 'REPLACE']) {
        db.exec('BEGIN IMMEDIATE');
        assert.throws(
          () => insertRow(db, verb, table, mutate(original)),
          /append-only|immutable/,
          `${verb} ${table}`,
        );
        assert.deepEqual(
          { ...db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id) },
          original,
          `${verb} ${table}`,
        );
        db.exec('ROLLBACK');
      }
      assert.deepEqual(
        { ...db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id) },
        original,
        table,
      );
    }

    const originalEvent = {
      ...db.prepare("SELECT * FROM production_events WHERE event_id = 'EVENT-ACCEPTED-01'").get(),
    };
    const aliasEvent = {
      ...originalEvent,
      event_id: 'EVENT-REPLACE-ALIAS',
      response_digest: `sha256:${'f'.repeat(64)}`,
    };
    for (const verb of ['INSERT OR REPLACE', 'REPLACE']) {
      assert.throws(
        () => insertRow(db, verb, 'production_events', aliasEvent),
        /append-only/,
      );
    }
    assert.deepEqual(
      { ...db.prepare("SELECT * FROM production_events WHERE event_id = 'EVENT-ACCEPTED-01'").get() },
      originalEvent,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM production_events WHERE event_id = 'EVENT-REPLACE-ALIAS'").get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test('review schema, indexes, triggers, and migration checksum drift fail closed', async t => {
  await t.test('table constraint drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec('DROP TABLE run_event_reviews; CREATE TABLE run_event_reviews (event_id TEXT PRIMARY KEY) STRICT;');
      assert.throws(
        () => assertKnownSchema(db),
        error => error.code === 'SCHEMA_STRUCTURE_MISMATCH' && /run_event_reviews/.test(error.message),
      );
    } finally {
      db.close();
    }
  });

  await t.test('index drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP INDEX run_event_reviews_pending_created_idx;
        CREATE INDEX run_event_reviews_pending_created_idx ON run_event_reviews(created_at);
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_STRUCTURE_MISMATCH');
    } finally {
      db.close();
    }
  });

  await t.test('trigger drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec(`
        DROP TRIGGER run_event_reviews_no_delete;
        CREATE TRIGGER run_event_reviews_no_delete
        BEFORE DELETE ON run_event_reviews BEGIN SELECT 1; END;
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_STRUCTURE_MISMATCH');
    } finally {
      db.close();
    }
  });

  await t.test('migration three checksum drift', () => {
    const db = memoryDatabase();
    try {
      initializeWritableSchema(db);
      db.exec('DROP TRIGGER schema_migrations_no_update;');
      db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 3')
        .run(`sha256:${'0'.repeat(64)}`);
      db.exec(`
        CREATE TRIGGER schema_migrations_no_update
        BEFORE UPDATE ON schema_migrations
        BEGIN
          SELECT RAISE(ABORT, 'schema migration markers are immutable');
        END;
      `);
      assert.throws(() => assertKnownSchema(db), error => error.code === 'SCHEMA_MIGRATION_DRIFT');
    } finally {
      db.close();
    }
  });
});
