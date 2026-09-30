import { createSqliteSchedulingAdminStoreV1 } from '../src/sqlite-scheduling-admin-store-v1.mjs';
import { normalizeSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { gf15Fixture } from './support/gf15-fixture.mjs';
import { createKioskServiceBindingV1 } from '../src/kiosk-service-context-v1.mjs';
import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createApplyKioskRunEvent } from '../src/kiosk-run-event-use-case-v2.mjs';
import { createSqliteKioskRunEventStore } from '../src/sqlite-kiosk-run-event-store-v2.mjs';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';
import { createKioskRuntimeOptionsFromEnv, createKioskV2Application, createOperationsServer } from '../src/server.mjs';
import { buildProductionRunCompletedNotificationV1 } from '../src/production-run-completed-notification-v1.mjs';

const START = '2026-10-01T02:01:00.000Z';
const END = '2026-10-01T02:10:00.000Z';
const principal = createTrustedPrincipal({ subjectId: 'KIOSK-PROD-01', role: 'operator', resourceIds: ['STUDIO-PROD-01'] }).principal;
function fixture(options = {}) {
  // Canonical Scheduling preparation, solely in disposable test storage.
  const f = gf15Fixture(options);
  f.service.begin(f.binding, f.lease, f.principal);
  assert.equal(f.service.forward(f.lease, f.principal).ok, true);
  f.quiescence.release(f.lease);
  const item = f.db.prepare('SELECT id FROM schedule_items').get().id;
  const binding = createKioskServiceBindingV1({ context: 'PROD11_PRODUCTION', expectedItem: item, start: START, end: END });
  f.setTime(START);
  const runId = `RUN-${randomUUID()}`;
  const start = { schemaVersion: 2, eventId: `EVENT-${randomUUID()}`, runId, scheduleItemId: item,
    deviceId: 'KIOSK-PROD-01', eventType: 'start', expectedRunRevision: 0, localSequence: 0, occurredAt: START };
  const complete = { ...start, eventId: `EVENT-${randomUUID()}`, eventType: 'complete', expectedRunRevision: 1, localSequence: 1,
    occurredAt: '2026-10-01T02:02:00.000Z' };
  function makeApply({ db = f.db, clock = f.now, serviceBinding = binding, store, ...rest } = {}) {
    return createApplyKioskRunEvent({ serviceBinding, clock,
      store: store ?? createSqliteKioskRunEventStore({ db, businessTimeZone: 'Asia/Shanghai', allowedBriefHosts: ['brief.example'] }), ...rest });
  }
  return { ...f, item, binding, start, complete, makeApply,
    apply(command, options) { return makeApply(options)({ command, principal }); } };
}
function facts(db) {
  return Object.fromEntries(['requests_v2', 'production_runs', 'production_events', 'run_event_reviews', 'operations',
    'audit_log', 'revision_counters', 'schedule_state', 'snapshot_projections', 'run_event_id_owners', 'notification_outbox', 'kiosk_smoke_phases', 'kiosk_smoke_outbox_isolation']
    .map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
}
function assertDenied(f, command = f.start, options) {
  const before = facts(f.db);
  assert.equal(f.apply(command, options).ok, false);
  assert.deepEqual(facts(f.db), before);
}

test('exact two-phase smoke and replay preserve facts; completion is permanently isolated across reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-smoke-'));
  const path = join(root, 'test.sqlite');
  const f = fixture({ path });
  try {
    assert.equal(f.apply(f.start).runRevision, 1);
    assert.throws(() => f.db.exec(`INSERT OR REPLACE INTO kiosk_smoke_phases
      SELECT 1, run_id, event_id, command_digest, command_json, received_at FROM kiosk_smoke_phases WHERE id = 0`), /cannot be replaced/);
    f.setTime(f.complete.occurredAt);
    assert.equal(f.apply(f.complete).runRevision, 2);
    const before = facts(f.db);
    f.setTime('2030-01-01T00:00:00.000Z');
    for (const command of [f.start, f.complete]) assert.equal(f.apply(command).replayed, true);
    assert.deepEqual(facts(f.db), before);
    assertDenied(f, { ...f.complete, eventId: `EVENT-${randomUUID()}` });
    const outbox = createSqliteOutboxRepositoryV1({ db: f.db });
    assert.equal(outbox.getById(f.complete.eventId).record.isolation.reason, 'PROD11_SMOKE');
    assert.deepEqual(outbox.claimBatch({ workerId: 'test-worker', now: f.now().toISOString(), limit: 8 }).items, []);
    const unrelated = buildProductionRunCompletedNotificationV1({ eventId: `EVENT-${randomUUID()}`, runId: 'RUN-unrelated',
      scheduleItemId: 'SCHEDULE-unrelated', resourceId: 'STUDIO-other', scope: 'task', taskCount: 1,
      completedAt: END, netDurationMs: 1000, runRevision: 2, createdAt: END });
    f.db.exec('BEGIN IMMEDIATE');
    assert.equal(outbox.enqueue(unrelated.intent).ok, true);
    f.db.exec('COMMIT');
    assert.equal(outbox.claimBatch({ workerId: 'test-worker', now: f.now().toISOString(), limit: 8 }).items.length, 1);
    for (const table of ['kiosk_smoke_binding', 'kiosk_smoke_phases', 'kiosk_smoke_outbox_isolation']) {
      assert.throws(() => f.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /cannot be replaced/);
      assert.throws(() => f.db.exec(`DELETE FROM ${table}`), /permanent/);
      assert.throws(() => f.db.exec(`UPDATE ${table} SET id = id`), /immutable/);
    }
    f.db.close();
    const reopened = new DatabaseSync(path);
    reopened.exec('PRAGMA foreign_keys = ON');
    try {
      assert.equal(f.makeApply({ db: reopened })({ command: f.complete, principal }).replayed, true);
      assert.deepEqual(createSqliteOutboxRepositoryV1({ db: reopened }).claimBatch({ workerId: 'new-worker', now: f.now().toISOString(), limit: 8 }).items, []);
    } finally { reopened.close(); }
  } finally { if (f.db.isOpen) f.db.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const [name, mutate] of Object.entries({
  block: c => ({ ...c, eventType: 'block', reasonCode: 'sampleWaiting' }),
  wrongSequence: c => ({ ...c, localSequence: 1 }),
  wrongRevision: c => ({ ...c, expectedRunRevision: 1 }),
  predictableRun: c => ({ ...c, runId: 'RUN-operator-authored' }),
  predictableEvent: c => ({ ...c, eventId: 'EVENT-operator-authored' }),
  wrongItem: c => ({ ...c, scheduleItemId: 'other-item' }),
  earlyClient: c => ({ ...c, occurredAt: '2026-10-01T02:00:59.999Z' }),
  lateClient: c => ({ ...c, occurredAt: '2026-10-01T02:10:00.001Z' }),
})) test(`smoke ${name} fails with zero business facts and cannot retry into authority`, () => {
  const f = fixture();
  try { assertDenied(f, mutate(f.start)); assertDenied(f); } finally { f.db.close(); }
});

for (const time of ['2026-10-01T02:00:59.999Z', '2026-10-01T02:10:00.001Z']) {
  test(`trusted transaction time ${time} denies even an in-window client`, () => {
    const f = fixture();
    try {
      let calls = 0;
      assertDenied(f, f.start, { clock() { calls++; assert.equal(f.db.isTransaction, true); return new Date(time); } });
      assert.equal(calls, 1);
      assertDenied(f);
    } finally { f.db.close(); }
  });
}

test('both inclusive window boundaries pass and receipt/audit use transaction clock', () => {
  const f = fixture();
  try {
    assert.equal(f.apply(f.start).ok, true);
    f.setTime(END);
    assert.equal(f.apply({ ...f.complete, occurredAt: END }).ok, true);
    assert.equal(f.db.prepare('SELECT received_at FROM production_events WHERE event_id = ?').get(f.complete.eventId).received_at, END);
    assert.equal(f.db.prepare('SELECT created_at FROM operations WHERE operation_id = ?').get(f.complete.eventId).created_at, END);
  } finally { f.db.close(); }
});

for (const table of ['production_events', 'notification_outbox', 'kiosk_smoke_outbox_isolation', 'operations']) {
  test(`completion ${table} fault rolls back all business facts and latches stop`, () => {
    const f = fixture();
    try {
      assert.equal(f.apply(f.start).ok, true);
      f.setTime(f.complete.occurredAt);
      f.db.exec(`CREATE TEMP TRIGGER smoke_fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'test fault'); END;`);
      assertDenied(f, f.complete);
      f.db.exec('DROP TRIGGER smoke_fault');
      assertDenied(f, f.complete);
      assert.equal(f.apply(f.start).replayed, true);
    } finally { f.db.close(); }
  });
}

test('review-required phase creates no review/receipt/audit and hard-stops subsequent attempts', () => {
  const f = fixture();
  try {
    assertDenied(f, f.start, { eventTimePolicy: () => ({ code: 'EVENT_TIME_REVIEW_REQUIRED', reviewReason: 'test', policyVersion: 'test' }) });
    assertDenied(f);
  } finally { f.db.close(); }
});

test('changed replay digest stops new phases, exact accepted replay remains available', () => {
  const f = fixture();
  try {
    assert.equal(f.apply(f.start).ok, true);
    assertDenied(f, { ...f.start, note: 'changed' });
    f.setTime(f.complete.occurredAt);
    assertDenied(f, f.complete);
    assert.equal(f.apply(f.start).replayed, true);
  } finally { f.db.close(); }
});

test('missing/unknown service signal never falls back; bindings are copied and immutable', () => {
  for (const context of [undefined, '', 'production', 'PROD11_SMOKE_ONLY']) {
    assert.throws(() => createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: context }), /CONTEXT_REQUIRED/);
  }
  assert.equal(createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'PROD11_PRODUCTION' }).kioskServiceBinding.mode, 'DISABLED');
  assert.throws(() => createKioskServiceBindingV1({ context: 'WO03_ISOLATED_ACCEPTANCE', expectedItem: 'item' }), /CROSS_CONTEXT/);
  for (const overrides of [{ expectedItem: undefined }, { start: undefined }, { end: undefined }, { start: END }, { end: START }, { start: '2026-10-01T02:01:00+00:00' }]) {
    assert.throws(() => createKioskServiceBindingV1({ context: 'PROD11_PRODUCTION', expectedItem: 'item', start: START, end: END, ...overrides }), /BINDING_REQUIRED/);
  }
  const source = { context: 'PROD11_PRODUCTION', expectedItem: 'item', start: START, end: END };
  const bound = createKioskServiceBindingV1(source);
  source.start = END;
  assert.equal(bound.start, START);
  assert.throws(() => { bound.start = END; }, TypeError);
});

for (const [name, mutate] of Object.entries({
  changedItem: db => db.exec("UPDATE schedule_items SET schedule_status = 'cancelled'"),
  wrongTask: db => db.exec('DELETE FROM schedule_item_tasks'),
  shortWindow: db => db.exec("UPDATE schedule_items SET planned_end = '2026-10-01T02:05:00.000Z'"),
  competingCandidate: db => {
    const item = db.prepare('SELECT * FROM schedule_items').get();
    item.id = 'COMPETING-ITEM'; item.source_ordinal += 1; item.source_ref = 'other';
    db.prepare(`INSERT INTO schedule_items (${Object.keys(item).join(',')}) VALUES (${Object.keys(item).map(() => '?').join(',')})`).run(...Object.values(item));
  },
  preExistingRun: db => {
    const item = db.prepare('SELECT id FROM schedule_items').get().id;
    db.prepare(`INSERT INTO production_runs (id, schedule_item_id, scope, task_id, status, run_revision,
      blocked_duration_ms, created_at, updated_at) VALUES ('RUN-unapproved', ?, 'task', 'REQ-GF15-ACCEPT-PROD-01', 'scheduled', 0, 0, ?, ?)`)
      .run(item, START, START);
  },
})) test(`atomic context rejects ${name} at the write boundary`, () => {
  const f = fixture();
  try {
    const base = createSqliteKioskRunEventStore({ db: f.db, businessTimeZone: 'Asia/Shanghai', allowedBriefHosts: ['brief.example'] });
    // Simulate facts changing after a device current GET but before admission.
    mutate(f.db);
    assertDenied(f, f.start, { store: base });
    assertDenied(f);
  } finally { f.db.close(); }
});

test('complete refuses a different run and an altered immutable binding cannot reopen authority', () => {
  const f = fixture();
  try {
    assert.equal(f.apply(f.start).ok, true);
    f.setTime(f.complete.occurredAt);
    assertDenied(f, { ...f.complete, runId: `RUN-${randomUUID()}` });
    assertDenied(f, f.complete);
    assertDenied(f, f.start, { serviceBinding: createKioskServiceBindingV1({ context: 'PROD11_PRODUCTION',
      expectedItem: f.item, start: START, end: '2026-10-01T02:11:00.000Z' }) });
    const isolated = createKioskServiceBindingV1({ context: 'WO03_ISOLATED_ACCEPTANCE' });
    assertDenied(f, f.complete, { serviceBinding: isolated });
  } finally { f.db.close(); }
});

test('application composition cannot omit, forge or downgrade the independent service binding', () => {
  const f = fixture();
  try {
    const store = { db: f.db, writeAdmissionControl: { isDisabled: () => false, status: () => 'enabled' } };
    const options = { store, authenticate: () => principal, businessTimeZone: 'Asia/Shanghai',
      deviceId: 'KIOSK-PROD-01', authorizeDeviceId: () => true, clock: f.now, allowedBriefHosts: ['brief.example'] };
    for (const serviceBinding of [undefined, { ...f.binding }, createKioskServiceBindingV1({ context: 'WO03_ISOLATED_ACCEPTANCE' }),
      createKioskServiceBindingV1({ context: 'PROD11_PRODUCTION' })]) {
      assert.throws(() => createKioskV2Application({ ...options, serviceBinding }), /CONTEXT|IDENTITY/);
    }
    const kiosk = createKioskV2Application({ ...options, serviceBinding: f.binding });
    options.serviceBinding = createKioskServiceBindingV1({ context: 'WO03_ISOLATED_ACCEPTANCE' });
    assert.equal(kiosk.applyRunEvent({ command: f.start, principal }).ok, true);
  } finally { f.db.close(); }
});

function smokeWorker(f, path, command, gate, time) {
  const worker = new Worker(new URL('./support/kiosk-smoke-worker.mjs', import.meta.url), { workerData: {
    path, command, gate, time, binding: { context: f.binding.context, expectedItem: f.item, start: START, end: END },
  } });
  let resolveReady, resolveResult, rejectReady, rejectResult;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  worker.on('message', message => message.ready ? resolveReady() : resolveResult(message));
  worker.on('error', error => { rejectReady(error); rejectResult(error); });
  return { worker, ready, result };
}

test('two database connections serialize simultaneous exact start retries into one fact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-smoke-concurrent-'));
  const path = join(root, 'test.sqlite');
  const f = fixture({ path });
  const gate = new SharedArrayBuffer(4), time = new SharedArrayBuffer(8);
  Atomics.store(new BigInt64Array(time), 0, BigInt(Date.parse(START)));
  const workers = [0, 1].map(() => smokeWorker(f, path, f.start, gate, time));
  try {
    await Promise.all(workers.map(w => w.ready));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    const results = await Promise.all(workers.map(w => w.result));
    assert.equal(results.every(r => r.result.ok), true, JSON.stringify(results));
    assert.equal(results.filter(r => r.result.replayed === true).length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_events').get().n, 1);
  } finally { await Promise.all(workers.map(w => w.worker.terminate())); f.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('clock admission uses post-lock time, not a pre-transaction device observation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-smoke-expiry-'));
  const path = join(root, 'test.sqlite');
  const f = fixture({ path });
  const gate = new SharedArrayBuffer(4), time = new SharedArrayBuffer(8);
  Atomics.store(new BigInt64Array(time), 0, BigInt(Date.parse(START)));
  const w = smokeWorker(f, path, f.start, gate, time);
  try {
    await w.ready;
    f.db.exec('BEGIN IMMEDIATE');
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    Atomics.store(new BigInt64Array(time), 0, BigInt(Date.parse(END) + 1));
    f.db.exec('COMMIT');
    const outcome = await w.result;
    assert.equal(outcome.clockInTransaction, true);
    assert.equal(outcome.result.ok, false);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_events').get().n, 0);
    assertDenied(f);
  } finally { await w.worker.terminate(); f.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('active Scheduling timezone is checked inside admission, independent of auth timezone', () => {
  const f = fixture();
  try {
    const active = JSON.parse(f.db.prepare('SELECT config_json FROM scheduling_config_versions').get().config_json);
    const config = normalizeSchedulingConfigV1({ ...active, businessTimeZone: 'UTC' });
    const admin = createSqliteSchedulingAdminStoreV1({ db: f.db, now: f.now, refreshProjections: f.refreshProjections });
    assert.equal(admin.publishConfig({ operationId: 'test-timezone-publish', configVersion: 'test-UTC',
      algorithmVersion: 'deterministic-scheduler-v1', calendarCompilerVersion: 'calendar-compiler-v1',
      estimatePolicyVersion: 'estimate-policy-v1', configJson: config.config, configDigest: config.configDigest }, f.principal.subjectId).ok, true);
    assert.equal(admin.activateConfig({ operationId: 'test-timezone-activate', configVersion: 'test-UTC',
      expectedProjectionRevision: f.db.prepare('SELECT projection_revision FROM revision_counters').get().projection_revision }, f.principal.subjectId).ok, true);
    assertDenied(f);
  } finally { f.db.close(); }
});

test('missing Scheduling prerequisites cannot be inferred or manufactured by smoke admission', () => {
  const f = gf15Fixture();
  try {
    f.quiescence.release(f.lease);
    const serviceBinding = createKioskServiceBindingV1({ context: 'PROD11_PRODUCTION', expectedItem: 'NOT-PREPARED', start: START, end: END });
    const apply = createApplyKioskRunEvent({ serviceBinding, clock: () => new Date(START),
      store: createSqliteKioskRunEventStore({ db: f.db, businessTimeZone: 'Asia/Shanghai' }) });
    const before = facts(f.db);
    const result = apply({ principal, command: { schemaVersion: 2, eventId: `EVENT-${randomUUID()}`, runId: `RUN-${randomUUID()}`,
      scheduleItemId: 'NOT-PREPARED', deviceId: 'KIOSK-PROD-01', eventType: 'start', expectedRunRevision: 0, localSequence: 0, occurredAt: START } });
    assert.equal(result.ok, false);
    assert.deepEqual(facts(f.db), before);
  } finally { f.db.close(); }
});

function authConfig(path, overrides = {}) {
  const contract = JSON.parse(readFileSync(new URL('../docs/operations/prod11-kiosk-deployment-contract.r1.json', import.meta.url), 'utf8'));
  const config = { ...contract.runtimeAuthConfig.filePayloadContract.payloadTemplate,
    allowedBriefHosts: ['brief.example'], credential: { algorithm: 'scrypt-v1',
      saltBase64: Buffer.alloc(16, 2).toString('base64'),
      hashBase64: scryptSync('isolated-test-credential-only', Buffer.alloc(16, 2), 32).toString('base64') }, ...overrides };
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
}
function runtimeEnv(path, item) {
  return { KIOSK_SERVICE_CONTEXT: 'PROD11_PRODUCTION', KIOSK_AUTH_CONFIG_PATH: path,
    KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID: item,
    KIOSK_SMOKE_ACCEPTANCE_RUN_START: START, KIOSK_SMOKE_ACCEPTANCE_RUN_END: END };
}

test('production auth config cannot choose isolated mode or omit any required immutable startup binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-smoke-config-'));
  const path = join(root, 'test-auth.json');
  try {
    authConfig(path);
    const env = runtimeEnv(path, 'BOUND-ITEM');
    for (const key of ['KIOSK_SERVICE_CONTEXT', 'KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID', 'KIOSK_SMOKE_ACCEPTANCE_RUN_START', 'KIOSK_SMOKE_ACCEPTANCE_RUN_END']) {
      assert.throws(() => createKioskRuntimeOptionsFromEnv({ ...env, [key]: undefined }), /REQUIRED/);
    }
    const runtime = createKioskRuntimeOptionsFromEnv(env);
    env.KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID = 'OTHER';
    env.KIOSK_SERVICE_CONTEXT = 'WO03_ISOLATED_ACCEPTANCE';
    assert.equal(runtime.kioskServiceBinding.expectedItem, 'BOUND-ITEM');
    assert.equal(runtime.kioskServiceBinding.context, 'PROD11_PRODUCTION');
    assert.throws(() => createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE', KIOSK_AUTH_CONFIG_PATH: path }), /CROSS_CONTEXT/);
    authConfig(path, { deviceId: 'TEST-DEVICE', principal: { subjectId: 'TEST-DEVICE', role: 'operator', resourceIds: ['TEST-STUDIO'] } });
    assert.throws(() => createKioskRuntimeOptionsFromEnv(runtimeEnv(path, 'BOUND-ITEM')), /IDENTITY_MISMATCH/);
    authConfig(path, { username: 'unfrozen-username' });
    assert.throws(() => createKioskRuntimeOptionsFromEnv(runtimeEnv(path, 'BOUND-ITEM')), /IDENTITY_MISMATCH/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real loopback HTTP uses frozen production bindings and denies/replays through the same store', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-smoke-http-'));
  const path = join(root, 'test.sqlite');
  const f = fixture({ path });
  const configPath = join(root, 'test-auth.json');
  authConfig(configPath);
  const runtime = createOperationsServer({ databasePath: path, uploadRoot: join(root, 'uploads'), tokens: {},
    orphanCleanupMode: 'disabled', cleanupIntervalMs: 0, clock: f.now,
    ...createKioskRuntimeOptionsFromEnv(runtimeEnv(configPath, f.item)) });
  try {
    await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${runtime.server.address().port}`;
    const authorization = `Basic ${Buffer.from('jso-kiosk-prod-01:isolated-test-credential-only').toString('base64')}`;
    const post = command => fetch(`${origin}/api/v2/schedule-items/${encodeURIComponent(f.item)}/events`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(command) });
    assert.equal((await fetch(`${origin}/api/v2/kiosk/current?resourceId=STUDIO-PROD-01`, { headers: { authorization } })).status, 200);
    assert.equal((await post(f.start)).status, 201);
    f.setTime(f.complete.occurredAt);
    assert.equal((await post(f.complete)).status, 201);
    assert.equal((await post(f.start)).status, 200);
    assert.equal((await post({ ...f.complete, eventId: `EVENT-${randomUUID()}` })).status, 409);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_events').get().n, 2);
  } finally {
    await new Promise(resolve => runtime.server.close(resolve));
    f.db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('malformed authenticated HTTP command permanently stops smoke without business writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-smoke-http-stop-'));
  const path = join(root, 'test.sqlite');
  const f = fixture({ path });
  const configPath = join(root, 'test-auth.json');
  authConfig(configPath);
  const runtime = createOperationsServer({ databasePath: path, uploadRoot: join(root, 'uploads'), tokens: {},
    orphanCleanupMode: 'disabled', cleanupIntervalMs: 0, clock: f.now,
    ...createKioskRuntimeOptionsFromEnv(runtimeEnv(configPath, f.item)) });
  try {
    await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${runtime.server.address().port}/api/v2/schedule-items/${encodeURIComponent(f.item)}/events`;
    const headers = { authorization: `Basic ${Buffer.from('jso-kiosk-prod-01:isolated-test-credential-only').toString('base64')}`, 'content-type': 'application/json' };
    const before = facts(f.db);
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(f.start) })).status, 409);
    assert.deepEqual(facts(f.db), before);
  } finally {
    await new Promise(resolve => runtime.server.close(resolve));
    f.db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('transaction admission failure cannot be retried into a new smoke phase in the same runtime', () => {
  const f = fixture();
  try {
    const base = createSqliteKioskRunEventStore({ db: f.db, businessTimeZone: 'Asia/Shanghai', allowedBriefHosts: ['brief.example'] });
    let busy = true;
    const apply = f.makeApply({ store: { withImmediateTransaction(action) {
      if (busy) { busy = false; throw Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' }); }
      return base.withImmediateTransaction(action);
    } } });
    const before = facts(f.db);
    assert.equal(apply({ command: f.start, principal }).code, 'STORE_BUSY');
    assert.equal(apply({ command: f.start, principal }).ok, false);
    assert.deepEqual(facts(f.db), before);
    assertDenied(f); // durable once write serialization is available again
  } finally { f.db.close(); }
});

test('programmatic server composition requires context even with Kiosk auth absent', () => {
  assert.throws(() => createOperationsServer({}), /KIOSK_SERVICE_CONTEXT_REQUIRED/);
  assert.throws(() => createOperationsServer({ kioskServiceBinding: { context: 'WO03_ISOLATED_ACCEPTANCE' } }), /KIOSK_SERVICE_CONTEXT_REQUIRED/);
});
