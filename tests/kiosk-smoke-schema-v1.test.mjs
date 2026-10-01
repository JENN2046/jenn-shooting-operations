import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeWritableSchema, assertKnownSchema, MIGRATIONS } from '../src/sqlite-schema-v2.mjs';

test('v8 preserves all v7 markers, upgrades idempotently and adds only empty control storage', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 7) });
    const previous = db.prepare('SELECT * FROM schema_migrations').all();
    assert.equal(initializeWritableSchema(db).version, 10);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version <= 7').all(), previous);
    for (const table of ['kiosk_smoke_binding', 'kiosk_smoke_phases', 'kiosk_smoke_stop', 'kiosk_smoke_outbox_isolation']) {
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    }
    const current = db.prepare('SELECT * FROM schema_migrations').all();
    initializeWritableSchema(db);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), current);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('v8 refuses unmarked partial objects and isolation trigger drift', () => {
  for (const partial of [true, false]) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      initializeWritableSchema(db, { migrations: partial ? MIGRATIONS.slice(0, 7) : MIGRATIONS });
      if (partial) {
        db.exec('CREATE TABLE kiosk_smoke_binding (id INTEGER PRIMARY KEY, binding_json TEXT NOT NULL) STRICT');
        assert.throws(() => initializeWritableSchema(db), { code: 'SCHEMA_PARTIAL_MIGRATION' });
      } else {
        db.exec('DROP TRIGGER kiosk_smoke_outbox_isolation_no_delete');
        assert.throws(() => assertKnownSchema(db), { code: 'SCHEMA_STRUCTURE_MISMATCH' });
      }
    } finally { db.close(); }
  }
});

test('v9 runtime ownership preserves v8 markers and refuses deletion, replacement and drift', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 8) });
    const markers = db.prepare('SELECT * FROM schema_migrations').all();
    assert.equal(initializeWritableSchema(db).version, 10);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version <= 8').all(), markers);
    db.exec("INSERT INTO kiosk_smoke_runtime_session VALUES (1, 'test-runtime')");
    assert.throws(() => db.exec('DELETE FROM kiosk_smoke_runtime_session'), /permanent/);
    assert.throws(() => db.exec("UPDATE kiosk_smoke_runtime_session SET session_id = 'replacement'"), /immutable/);
    assert.throws(() => db.exec("INSERT OR REPLACE INTO kiosk_smoke_runtime_session VALUES (1, 'replacement')"), /cannot be replaced/);
    db.exec('DROP TRIGGER kiosk_smoke_runtime_session_no_delete');
    assert.throws(() => assertKnownSchema(db), { code: 'SCHEMA_STRUCTURE_MISMATCH' });
  } finally { db.close(); }
});

test('v9 refuses partial unmarked runtime ownership storage', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 8) });
    db.exec('CREATE TABLE kiosk_smoke_runtime_session (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL) STRICT');
    assert.throws(() => initializeWritableSchema(db), { code: 'SCHEMA_PARTIAL_MIGRATION' });
  } finally { db.close(); }
});
