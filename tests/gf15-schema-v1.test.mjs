import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, initializeWritableSchema, assertKnownSchema } from '../src/sqlite-schema-v2.mjs';
import { gf15Fixture } from './support/gf15-fixture.mjs';

test('migration 7 preserves all six historical checksums and markers and adds only empty capability storage', () => {
  assert.deepEqual(MIGRATIONS.slice(0, 6).map(m => m.checksum), [
    'sha256:b77dcddc0284a94a1dbc1e1a981fb7cbf3e4f2d41f8d6ccc999d37a298d1a3b5',
    'sha256:b944e3ed4d77774e77aa378a3e04cce7a07ae744dd867d7b89aa4ac704d94670',
    'sha256:20cbd2b8a992a888120fdaad41ddb7ec7f8aa4de65a2d7388c018c382e4e9476',
    'sha256:f5d409d12418e71f2f90709488b0354cf0f0fc39cd6543888b7c7e4268be5fae',
    'sha256:9a2c749d55ced03953b24d50331cf4565cd253612207973865c95505510ac1a7',
    'sha256:15b0462915aa0cc12f3d0c06020f557cbaf2d1db22015d79aeb015f93abe5a5b',
  ]);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 6) });
    const markers = db.prepare('SELECT * FROM schema_migrations').all();
    assert.deepEqual(initializeWritableSchema(db), { version: 7, latestVersion: 7 });
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version <= 6').all(), markers);
    for (const table of ['gf15_scheduling_leases', 'gf15_control_receipts', 'gf15_command_packets', 'gf15_outbox_isolation']) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    }
    const all = db.prepare('SELECT * FROM schema_migrations').all();
    initializeWritableSchema(db);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), all);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('schema validation rejects GF15 isolation trigger drift and unmarked partial migration artifacts', () => {
  for (const partial of [false, true]) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      initializeWritableSchema(db, { migrations: partial ? MIGRATIONS.slice(0, 6) : MIGRATIONS });
      if (partial) {
        db.exec("CREATE TABLE gf15_control_receipts (receipt_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;");
        assert.throws(() => initializeWritableSchema(db), { code: 'SCHEMA_PARTIAL_MIGRATION' });
        assert.equal(db.prepare('SELECT max(version) AS n FROM schema_migrations').get().n, 6);
      } else {
        db.exec('DROP TRIGGER gf15_outbox_isolation_no_delete');
        assert.throws(() => assertKnownSchema(db), { code: 'SCHEMA_STRUCTURE_MISMATCH' });
      }
    } finally { db.close(); }
  }
});

test('lease, packet, receipt and isolation identity cannot be replaced, edited or removed with SQL conflict clauses', () => {
  const f = gf15Fixture();
  try {
    f.service.begin(f.binding, f.lease, f.principal); f.service.forward(f.lease, f.principal);
    for (const [table, id] of [['gf15_control_receipts', 'receipt_id'], ['gf15_command_packets', 'packet_id'], ['gf15_outbox_isolation', 'outbox_id']]) {
      const before = f.db.prepare(`SELECT * FROM ${table}`).all();
      assert.throws(() => f.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /immutable|permanent/);
      assert.throws(() => f.db.exec(`DELETE FROM ${table}`), /cannot be deleted|permanent/);
      assert.throws(() => f.db.exec(`UPDATE ${table} SET ${id} = 'forged'`), /immutable|permanent/);
      assert.deepEqual(f.db.prepare(`SELECT * FROM ${table}`).all(), before);
    }
    const leases = f.db.prepare('SELECT * FROM gf15_scheduling_leases').all();
    assert.throws(() => f.db.exec('INSERT OR REPLACE INTO gf15_scheduling_leases SELECT * FROM gf15_scheduling_leases'), /cannot replace/);
    assert.throws(() => f.db.exec("UPDATE gf15_scheduling_leases SET owner = 'forged'"), /immutable/);
    assert.deepEqual(f.db.prepare('SELECT * FROM gf15_scheduling_leases').all(), leases);
    assert.equal(assertKnownSchema(f.db).version, 7);
  } finally { f.db.close(); }
});
