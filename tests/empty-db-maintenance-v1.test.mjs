import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { writeFileSync, symlinkSync, renameSync, linkSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ScheduleStore } from '../src/store.mjs';
import { MIGRATIONS, initializeWritableSchema, assertKnownSchema } from '../src/sqlite-schema-v2.mjs';
import { maintenanceFixture, registerCommand, publishCommand, authorizationFor } from './support/empty-db-maintenance-fixture.mjs';
import { bindLocalEmptyDbMaintenanceTargetV1 } from '../src/empty-db-maintenance-v1.mjs';
import { digestSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';

function fixture(t) { const f = maintenanceFixture(); t.after(f.close); return f; }
function worker(packet, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/support/empty-db-maintenance-worker.mjs', JSON.stringify(packet), ...(mode ? [mode] : [])]);
    let output = ''; child.stdout.on('data', bytes => { output += bytes; });
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, response: output ? JSON.parse(output) : null }));
  });
}
function deniedWithoutLoss(f, packet, code, overrides = {}) {
  const before = f.state();
  assert.throws(() => f.execute(packet, overrides), { code });
  assert.equal(f.state(), before);
}
test('startup remains schema-only; explicit initialization seals counter/projections, audit and immutable exact replay', t => {
  const f = fixture(t);
  f.read(db => { assert.equal(assertKnownSchema(db).version, 10);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM revision_counters').get().n, 0); });
  const first = f.execute();
  assert.equal(first.exactReplay, false);
  const before = f.state();
  const replay = f.execute(); assert.equal(replay.exactReplay, true);
  assert.deepEqual({ ...replay, exactReplay: false }, first); assert.equal(f.state(), before);
  f.read(db => { assert.equal(db.prepare('SELECT COUNT(*) n FROM snapshot_projections').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 1); });
  f.write(db => {
    for (const sql of ['DELETE FROM empty_db_initialization', "UPDATE empty_db_initialization SET operation_id = 'other'",
      'INSERT OR REPLACE INTO empty_db_initialization SELECT * FROM empty_db_initialization']) assert.throws(() => db.exec(sql));
  });
  assert.equal(f.state(), before);
  deniedWithoutLoss(f, { ...f.packet(), operationId: 'OTHER-INIT' }, 'MAINTENANCE_ALREADY_INITIALIZED');
  deniedWithoutLoss(f, { ...f.packet(), approvalRef: 'other-review' }, 'MAINTENANCE_IDEMPOTENCY_CONFLICT');
});
test('resource, publication and explicit activation reuse services atomically with separate exact receipts', t => {
  const f = fixture(t); f.execute();
  const resource = f.packet('registerResource', registerCommand());
  assert.equal(f.execute(resource).result.scheduleRevision, 1);
  const publish = f.packet('publishConfig', publishCommand(), { scheduleRevision: 1, projectionRevision: 1 });
  assert.equal(f.execute(publish).result.configVersion, 'local-r1');
  f.read(db => assert.equal(db.prepare('SELECT COUNT(*) n FROM scheduling_active_config').get().n, 0));
  const activate = f.packet('activateConfig', { operationId: 'LOCAL-ACTIVATE-01', configVersion: 'local-r1',
    expectedProjectionRevision: 1 }, { scheduleRevision: 1, projectionRevision: 1 });
  assert.equal(f.execute(activate).result.projectionRevision, 2);
  const before = f.state();
  for (const packet of [f.packet(), resource, publish, activate]) assert.equal(f.execute(packet).exactReplay, true);
  assert.equal(f.state(), before);
  f.write(db => {
    for (const sql of ['DELETE FROM empty_db_maintenance_operations',
      "UPDATE empty_db_maintenance_operations SET packet_digest = 'forged'",
      'INSERT OR REPLACE INTO empty_db_maintenance_operations SELECT * FROM empty_db_maintenance_operations']) assert.throws(() => db.exec(sql));
  });
  const store = new ScheduleStore({ filename: join(f.root, 'synthetic.sqlite'), uploadRoot: join(f.root, 'uploads'),
    writeAdmissionMode: 'disabled', orphanCleanupMode: 'disabled' });
  try { assert.throws(() => store.db.exec("INSERT INTO operations VALUES ('forbidden', 'other', '{}', 'now', NULL)"), /not authorized/); }
  finally { store.close(); }
  assert.equal(f.state(), before);
});
for (const [label, sql] of [
  ['audit', "INSERT INTO audit_log (action, role, revision, result, created_at) VALUES ('old', 'old', 0, 'old', 'now')"],
  ['legacy receipt', "INSERT INTO operations VALUES ('old', 'old', '{}', 'now', NULL)"],
  ['counter', "INSERT INTO revision_counters VALUES (1, 7, 8, 'now')"],
  ['resource/control', "INSERT INTO scheduling_resources VALUES ('old', 'old', 'active', '{}', 'old', 'now', 'now', 'old')"],
  ['permanent smoke owner', "INSERT INTO kiosk_smoke_runtime_session VALUES (1, 'existing-owner')"],
]) test(`initializer rejects existing ${label} without modifying it`, t => {
  const f = fixture(t); f.write(db => db.exec(sql));
  deniedWithoutLoss(f, f.packet(), 'MAINTENANCE_DATABASE_NOT_EMPTY');
});
test('initializer rejects nonempty or extended legacy snapshot and upload/control paths', t => {
  const f = fixture(t);
  f.write(db => db.exec("UPDATE schedule_state SET snapshot_json = json_set(snapshot_json, '$.unexpected', 1)"));
  deniedWithoutLoss(f, f.packet(), 'MAINTENANCE_LEGACY_NOT_EMPTY');
  const other = fixture(t); writeFileSync(join(other.root, 'uploads', 'control-marker'), 'synthetic');
  deniedWithoutLoss(other, other.packet(), 'MAINTENANCE_UPLOADS_NOT_EMPTY');
  const third = fixture(t); mkdirSync(join(third.root, 'unclassified-control'));
  deniedWithoutLoss(third, third.packet(), 'MAINTENANCE_STORAGE_NOT_EMPTY');
});
test('schema10 preserves migration1–9 markers; receipt drift and partial objects fail closed', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); db.exec('PRAGMA foreign_keys = ON');
  initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 9) });
  const prior = db.prepare('SELECT * FROM schema_migrations').all(); initializeWritableSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version <= 9').all(), prior);
  db.exec('DROP TRIGGER empty_db_initialization_no_replace');
  assert.throws(() => assertKnownSchema(db), { code: 'SCHEMA_STRUCTURE_MISMATCH' });
  const partial = new DatabaseSync(':memory:'); t.after(() => partial.close()); partial.exec('PRAGMA foreign_keys = ON');
  initializeWritableSchema(partial, { migrations: MIGRATIONS.slice(0, 9) });
  partial.exec('CREATE TABLE empty_db_initialization (id INTEGER PRIMARY KEY) STRICT');
  assert.throws(() => initializeWritableSchema(partial), { code: 'SCHEMA_PARTIAL_MIGRATION' });
});
test('target mismatch, hardlinks, symlinks and nonlocal paths are rejected before DB writes', t => {
  const f = fixture(t);
  deniedWithoutLoss(f, { ...f.packet(), target: { ...f.target, database: { ...f.target.database, inode: '0' } } }, 'MAINTENANCE_TARGET_MISMATCH');
  deniedWithoutLoss(f, { ...f.packet(), target: { ...f.target, root: '/mnt/production' } }, 'MAINTENANCE_LOCAL_TARGET_REQUIRED');
  const before = f.state();
  const outside = join(f.root, '..', `jso-maintenance-link-${process.pid}`);
  linkSync(join(f.root, 'synthetic.sqlite'), outside); t.after(() => unlinkSync(outside));
  assert.throws(() => f.execute(), { code: 'MAINTENANCE_TARGET_AMBIGUOUS' }); assert.equal(f.state(), before);
  const other = fixture(t); const path = join(other.root, 'synthetic.sqlite');
  renameSync(path, `${path}.retained`); symlinkSync(`${path}.retained`, path);
  assert.throws(() => other.execute(), { code: 'MAINTENANCE_TARGET_AMBIGUOUS' });
});
test('wrong runtime, manifest, schema, approval, caller and enabled admission fail without effects', t => {
  const f = fixture(t), packet = f.packet();
  deniedWithoutLoss(f, packet, 'MAINTENANCE_RUNTIME_MISMATCH', { runtime: { ...f.runtime, sourceRevision: '3'.repeat(40) } });
  for (const bad of [{ ...packet, schemaDigest: 'wrong' }, { ...packet, extra: true },
    { ...packet, kind: 'prepareGf15' }, { ...packet, expected: { scheduleRevision: 1, projectionRevision: 0 } }]) {
    deniedWithoutLoss(f, bad, 'MAINTENANCE_PACKET_INVALID');
  }
  for (const change of [{ scope: 'PRODUCTION' }, { actor: 'other' }, { packetDigest: 'wrong' },
    { writeAdmission: 'enabled' }, { writersStopped: false }, { kiosk: 'enabled' }, { cleanup: 'enabled' }]) {
    deniedWithoutLoss(f, packet, 'MAINTENANCE_AUTHORIZATION_DENIED', { authorization: { ...authorizationFor(packet), ...change } });
  }
  f.write(db => db.exec('CREATE TABLE unreviewed (id INTEGER)'));
  deniedWithoutLoss(f, packet, 'SCHEMA_UNKNOWN_OBJECT');
});
test('configuration before bootstrap, revision conflict, mismatched command and direct unbound facts are rejected', t => {
  const f = fixture(t), register = f.packet('registerResource', registerCommand());
  deniedWithoutLoss(f, register, 'MAINTENANCE_INITIALIZATION_REQUIRED'); f.execute();
  const badRevision = { scheduleRevision: 1, projectionRevision: 1 };
  deniedWithoutLoss(f, f.packet('registerResource', registerCommand(badRevision), badRevision), 'MAINTENANCE_REVISION_CONFLICT');
  deniedWithoutLoss(f, { ...register, operationId: 'other' }, 'MAINTENANCE_COMMAND_INVALID');
  f.write(db => db.exec("INSERT INTO scheduling_admin_operations VALUES ('direct', 'direct', 'publishConfig', '{}', 'now')"));
  deniedWithoutLoss(f, register, 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
});
test('existing permanent controls after bootstrap prevent new configuration packets', t => {
  const f = fixture(t); f.execute();
  f.write(db => db.exec("INSERT INTO kiosk_smoke_runtime_session VALUES (1, 'existing-owner')"));
  deniedWithoutLoss(f, f.packet('registerResource', registerCommand()), 'MAINTENANCE_NONCONFIG_FACTS_EXIST');
  const before = f.state(); assert.equal(f.execute().exactReplay, true); assert.equal(f.state(), before);
});
test('fault after all initialization/config effects rolls back receipts, counters, projections and audit', t => {
  const f = fixture(t);
  for (const packet of [f.packet(), f.packet('registerResource', registerCommand())]) {
    if (packet.kind !== 'initialize') f.execute();
    const before = f.state();
    assert.throws(() => f.execute(packet, { beforeCommit: () => { throw new Error('synthetic fault'); } }), /synthetic fault/);
    assert.equal(f.state(), before); assert.equal(f.execute(packet).exactReplay, false);
  }
});
test('SIGKILL before commit rolls back on reopen for bootstrap and configuration', async t => {
  const f = fixture(t);
  for (const packet of [f.packet(), f.packet('registerResource', registerCommand())]) {
    if (packet.kind !== 'initialize') f.execute();
    const before = f.state(); const killed = await worker(packet, 'crash');
    assert.equal(killed.signal, 'SIGKILL'); assert.equal(f.state(), before);
    assert.equal(f.execute(packet).exactReplay, false);
  }
});
test('concurrent exact initialization/config packets commit once and replay once', async t => {
  const f = fixture(t);
  for (const packet of [f.packet(), f.packet('registerResource', registerCommand())]) {
    const outcomes = await Promise.all([worker(packet), worker(packet)]);
    assert.deepEqual(outcomes.map(r => r.code), [0, 0], JSON.stringify(outcomes));
    assert.deepEqual(outcomes.map(r => r.response.exactReplay).sort(), [false, true]);
  }
  f.read(db => { assert.equal(db.prepare('SELECT COUNT(*) n FROM empty_db_initialization').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM empty_db_maintenance_operations').get().n, 1); });
});
test('concurrent conflicting bootstrap IDs preserve one winner and reject the other', async t => {
  const f = fixture(t);
  const outcomes = await Promise.all([worker(f.packet()), worker({ ...f.packet(), operationId: 'LOCAL-OTHER-INIT' })]);
  assert.deepEqual(outcomes.map(r => r.code).sort(), [0, 1]);
  assert.equal(outcomes.find(r => r.code === 1).response.code, 'MAINTENANCE_ALREADY_INITIALIZED');
});
test('schema9 is refused without upgrade; cleanup marker mismatch or active cleanup blocks writes', t => {
  const f = fixture(t);
  const legacy = f.read(db => ({ ...db.prepare('SELECT * FROM schedule_state').get() }));
  const replacement = join(f.root, 'replacement.sqlite'); const db = new DatabaseSync(replacement);
  db.exec('PRAGMA foreign_keys = ON'); initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 9) });
  db.prepare('INSERT INTO schedule_state VALUES (?, ?, ?, ?)').run(legacy.id, legacy.revision, legacy.updated_at, legacy.snapshot_json);
  db.close(); renameSync(replacement, join(f.root, 'synthetic.sqlite'));
  const packet = { ...f.packet(), target: bindLocalEmptyDbMaintenanceTargetV1(f.root) };
  deniedWithoutLoss(f, packet, 'MAINTENANCE_SCHEMA_UNSUPPORTED');
  const other = fixture(t);
  const cleanupParent = join(other.root, '.orphan-cleanup-control');
  // Find the one namespace already created by disabled startup; never create a replacement owner.
  const cleanup = join(cleanupParent, requireCleanupNamespace(cleanupParent));
  writeFileSync(join(cleanup, 'disabled.json'), JSON.stringify({ state: 'disabled', epoch: 'replacement' }));
  deniedWithoutLoss(other, other.packet(), 'MAINTENANCE_TARGET_MISMATCH');
  mkdirSync(join(cleanup, 'runs')); writeFileSync(join(cleanup, 'runs', 'active.json'), '{}');
  assert.throws(() => other.execute(), { code: 'MAINTENANCE_CLEANUP_NOT_FENCED' });
});
function requireCleanupNamespace(parent) { return readdirSync(parent)[0]; }
test('config service rejection and conflicting same-ID packets preserve all committed facts', t => {
  const f = fixture(t); f.execute();
  deniedWithoutLoss(f, f.packet('registerResource', { ...registerCommand(), operationId: f.packet().operationId }),
    'MAINTENANCE_IDEMPOTENCY_CONFLICT');
  const resource = f.packet('registerResource', registerCommand()); f.execute(resource);
  const publish = f.packet('publishConfig', publishCommand(), { scheduleRevision: 1, projectionRevision: 1 });
  f.execute(publish);
  const conflicting = { ...publish, approvalRef: 'different-review' };
  deniedWithoutLoss(f, conflicting, 'MAINTENANCE_IDEMPOTENCY_CONFLICT');
  const activate = f.packet('activateConfig', { operationId: 'LOCAL-ACTIVATE-MISSING', configVersion: 'missing', expectedProjectionRevision: 1 },
    { scheduleRevision: 1, projectionRevision: 1 });
  deniedWithoutLoss(f, activate, 'CONFIG_VERSION_NOT_FOUND');
});
test('deleted audit history is not reclassified as a fresh database', t => {
  const f = fixture(t);
  f.write(db => db.exec("INSERT INTO audit_log (action, role, revision, result, created_at) VALUES ('old', 'old', 0, 'old', 'now'); DELETE FROM audit_log;"));
  deniedWithoutLoss(f, f.packet(), 'MAINTENANCE_DATABASE_NOT_EMPTY');
});
test('direct resource edits and unreceipted counters after bootstrap block new configuration', t => {
  const f = fixture(t); f.execute(); f.execute(f.packet('registerResource', registerCommand()));
  const packet = f.packet('publishConfig', publishCommand(), { scheduleRevision: 1, projectionRevision: 1 });
  f.write(db => db.exec("UPDATE scheduling_resources SET status = 'inactive'"));
  deniedWithoutLoss(f, packet, 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
  const other = fixture(t); other.execute();
  other.write(db => db.exec('UPDATE revision_counters SET schedule_revision = 7, projection_revision = 8'));
  deniedWithoutLoss(other, other.packet('registerResource', registerCommand({ scheduleRevision: 7, projectionRevision: 8 }),
    { scheduleRevision: 7, projectionRevision: 8 }), 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
});

function replaceSyntheticRow(db, table, row) {
  const keys = Object.keys(row);
  db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map(key => row[key]));
}
for (const field of ['valid-config-content', 'estimate_policy_version', 'algorithm_version',
  'calendar_compiler_version', 'published_by', 'published_at', 'publish_operation_id']) {
  test(`same-version config replacement (${field}) is refused before activation without new facts`, t => {
    const f = fixture(t); f.execute(); f.execute(f.packet('registerResource', registerCommand()));
    const command = publishCommand();
    f.execute(f.packet('publishConfig', command, { scheduleRevision: 1, projectionRevision: 1 }));
    const journal = f.read(db => JSON.stringify(db.prepare('SELECT * FROM empty_db_maintenance_operations').all()));
    f.write(db => {
      const row = { ...db.prepare('SELECT * FROM scheduling_config_versions WHERE config_version = ?').get(command.configVersion) };
      if (field === 'valid-config-content') {
        const config = JSON.parse(row.config_json); config.softScoringWeights.IDLE_GAP = 7;
        row.config_json = JSON.stringify(config); row.config_digest = digestSchedulingConfigV1(config);
      } else row[field] = field === 'published_at' ? '2026-10-01T03:00:00.000Z' : 'unapproved-replacement';
      replaceSyntheticRow(db, 'scheduling_config_versions', row);
    });
    assert.equal(f.read(db => JSON.stringify(db.prepare('SELECT * FROM empty_db_maintenance_operations').all())), journal);
    const packet = f.packet('activateConfig', { operationId: 'LOCAL-ACTIVATE-REPLACED', configVersion: command.configVersion,
      expectedProjectionRevision: 1 }, { scheduleRevision: 1, projectionRevision: 1 });
    deniedWithoutLoss(f, packet, 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    f.read(db => { assert.equal(db.prepare('SELECT COUNT(*) n FROM scheduling_config_activations').get().n, 0);
      assert.equal(db.prepare('SELECT projection_revision FROM revision_counters').get().projection_revision, 1); });
  });
}
for (const field of ['previous_config_version', 'config_version', 'command_digest',
  'activated_by', 'activated_at', 'projection_revision']) {
  test(`earlier activation-history replacement (${field}) is refused without new facts`, t => {
    const f = fixture(t); f.execute(); f.execute(f.packet('registerResource', registerCommand()));
    const first = publishCommand(), second = { ...publishCommand(), operationId: 'LOCAL-PUBLISH-02', configVersion: 'local-r2' };
    for (const command of [first, second]) f.execute(f.packet('publishConfig', command,
      { scheduleRevision: 1, projectionRevision: 1 }));
    for (const [index, version] of ['local-r1', 'local-r2'].entries()) f.execute(f.packet('activateConfig', {
      operationId: `LOCAL-ACTIVATE-0${index + 1}`, configVersion: version, expectedProjectionRevision: index + 1,
    }, { scheduleRevision: 1, projectionRevision: index + 1 }));
    f.write(db => {
      const row = { ...db.prepare("SELECT * FROM scheduling_config_activations WHERE operation_id = 'LOCAL-ACTIVATE-01'").get() };
      row[field] = field === 'previous_config_version' || field === 'config_version' ? 'local-r2'
        : field === 'projection_revision' ? 0 : field === 'activated_at' ? '2026-10-01T03:00:00.000Z' : 'unapproved-replacement';
      replaceSyntheticRow(db, 'scheduling_config_activations', row);
    });
    const next = { ...publishCommand(), operationId: 'LOCAL-PUBLISH-03', configVersion: 'local-r3' };
    deniedWithoutLoss(f, f.packet('publishConfig', next, { scheduleRevision: 1, projectionRevision: 3 }),
      'MAINTENANCE_UNBOUND_CONTROL_FACTS');
  });
}
test('replacing admin and config timestamps together cannot rewrite the sealed execution time', t => {
  const f = fixture(t); f.execute(); f.execute(f.packet('registerResource', registerCommand()));
  f.execute(f.packet('publishConfig', publishCommand(), { scheduleRevision: 1, projectionRevision: 1 }));
  f.write(db => {
    const config = { ...db.prepare('SELECT * FROM scheduling_config_versions').get() };
    config.published_at = '2026-10-01T03:00:00.000Z'; replaceSyntheticRow(db, 'scheduling_config_versions', config);
    const admin = { ...db.prepare("SELECT * FROM scheduling_admin_operations WHERE operation_id = 'LOCAL-PUBLISH-01'").get() };
    admin.created_at = config.published_at; replaceSyntheticRow(db, 'scheduling_admin_operations', admin);
  });
  deniedWithoutLoss(f, f.packet('activateConfig', { operationId: 'LOCAL-ACTIVATE-REPLACED', configVersion: 'local-r1', expectedProjectionRevision: 1 },
    { scheduleRevision: 1, projectionRevision: 1 }), 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
});
test('sealed admin timestamps support a ticking clock and exact replay across two activations', t => {
  const f = fixture(t); let tick = Date.parse('2026-10-01T04:00:00.000Z');
  const now = () => new Date(tick++);
  f.execute(f.packet(), { now }); f.execute(f.packet('registerResource', registerCommand()), { now });
  const first = publishCommand(), second = { ...publishCommand(), operationId: 'LOCAL-PUBLISH-02', configVersion: 'local-r2' };
  for (const command of [first, second]) f.execute(f.packet('publishConfig', command,
    { scheduleRevision: 1, projectionRevision: 1 }), { now });
  const packets = ['local-r1', 'local-r2'].map((version, index) => f.packet('activateConfig', {
    operationId: `LOCAL-ACTIVATE-0${index + 1}`, configVersion: version, expectedProjectionRevision: index + 1,
  }, { scheduleRevision: 1, projectionRevision: index + 1 }));
  const responses = packets.map(packet => f.execute(packet, { now }));
  assert.equal(responses[0].previousConfigVersion, null);
  assert.equal(responses[1].previousConfigVersion, 'local-r1');
  assert.notEqual(responses[0].adminCreatedAt, responses[0].completedAt);
  const next = { ...publishCommand(), operationId: 'LOCAL-PUBLISH-03', configVersion: 'local-r3' };
  f.execute(f.packet('publishConfig', next, { scheduleRevision: 1, projectionRevision: 3 }), { now });
  const before = f.state();
  for (const packet of packets) assert.equal(f.execute(packet, { now }).exactReplay, true);
  assert.equal(f.state(), before);
});
