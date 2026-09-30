import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gf15Fixture } from './support/gf15-fixture.mjs';
import { GF15_IDS as ids, GF15_RESOURCE, GF15_ROLLBACK } from '../src/gf15-contract-v1.mjs';
import { normalizeSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';
import { createSqliteSchedulingAdminStoreV1 } from '../src/sqlite-scheduling-admin-store-v1.mjs';
import { createSqliteSchedulingProposalStoreV1, staleDraftProposalsInTransactionV1 } from '../src/sqlite-scheduling-proposal-store-v1.mjs';
import { assembleSchedulingInputFromSqliteV1 } from '../src/sqlite-scheduling-input-assembler-v1.mjs';
import { createSqliteRunEventStore } from '../src/sqlite-run-event-store-v2.mjs';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';
import { buildScheduleConfirmedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';
import { buildNotificationIntentV1 } from '../src/outbox-contract-v1.mjs';
import { createOutboxDispatcherV1 } from '../src/outbox-dispatcher-v1.mjs';
import { readGf15Packet, immediateGf15 } from '../src/sqlite-scheduling-quiescence-v1.mjs';
import { ScheduleStore } from '../src/store.mjs';

function revisions(db) {
  const row = db.prepare('SELECT * FROM revision_counters').get();
  return { expectedScheduleRevision: row.schedule_revision, expectedProjectionRevision: row.projection_revision };
}
function ordinaryProposal(f) {
  return createSqliteSchedulingProposalStoreV1({ db: f.db, now: f.now,
    assembleInput: assembleSchedulingInputFromSqliteV1, refreshProjections: f.refreshProjections,
    authorizeAcceptance: () => true });
}
function setupUnrelated(f) {
  f.quiescence.release(f.lease);
  const admin = createSqliteSchedulingAdminStoreV1({ db: f.db, now: f.now, refreshProjections: f.refreshProjections });
  assert.equal(admin.registerResource({ operationId: 'other-resource', ...revisions(f.db),
    resource: { ...GF15_RESOURCE, resourceId: 'OTHER-STUDIO', v1DisplayPlace: 'Other Studio' } }, f.principal.subjectId).ok, true);
  const c = structuredClone(f.binding.config); c.resourceCalendars[0].resourceId = 'OTHER-STUDIO';
  const normalized = normalizeSchedulingConfigV1(c);
  assert.equal(admin.publishConfig({ operationId: 'other-publish', configVersion: 'other-config',
    algorithmVersion: 'deterministic-scheduler-v1', calendarCompilerVersion: 'calendar-compiler-v1',
    estimatePolicyVersion: 'estimate-policy-v1', configJson: normalized.config, configDigest: normalized.configDigest }, f.principal.subjectId).ok, true);
  assert.equal(admin.activateConfig({ operationId: 'other-activate', configVersion: 'other-config',
    expectedProjectionRevision: revisions(f.db).expectedProjectionRevision }, f.principal.subjectId).ok, true);
  return { operationId: 'OTHER-GENERATE', planningWindowStart: f.binding.planningWindowStart,
    planningWindowEnd: f.binding.planningWindowEnd, resourceScope: ['OTHER-STUDIO'] };
}
function leaseAgain(f, purpose = 'forward', leaseId = 'next-lease') {
  return f.quiescence.acquire({ purpose, leaseId, owner: f.principal.subjectId });
}
function dump(db) {
  return JSON.stringify(['revision_counters', 'requests_v2', 'scheduling_resources', 'scheduling_admin_operations',
    'scheduling_active_config', 'scheduling_proposals', 'scheduling_proposal_decisions', 'operations', 'audit_log',
    'notification_outbox', 'gf15_outbox_isolation'].map(table => db.prepare(`SELECT * FROM ${table}`).all()));
}

test('legacy V1 snapshot and submission stores cannot mutate around the durable Scheduling lease', () => {
  const root = mkdtempSync(join(tmpdir(), 'gf15-v1-writers-'));
  const path = join(root, 'fixture.sqlite');
  const f = gf15Fixture({ path });
  const store = new ScheduleStore({ filename: path, clock: f.now, orphanCleanupMode: 'disabled' });
  try {
    const before = dump(f.db);
    const snapshot = store.getSnapshot();
    assert.throws(() => store.replaceSnapshot({ expectedRevision: snapshot.revision, snapshot,
      operationId: 'legacy-snapshot-test', role: 'scheduler' }), /SCHEDULING_QUIESCENCE_HELD/);
    assert.throws(() => store.submitRequest({ role: 'submitter', submission: { schemaVersion: 1,
      operationId: 'legacy-submit-test', productionType: '平面', sku: 'OTHER-SKU', name: 'Other request',
      kind: '细节', shootingSubtype: '细节', aspectRatio: '1:1', deliver: 'Other deliverable', requestedBy: 'Other' } }), /SCHEDULING_QUIESCENCE_HELD/);
    assert.equal(dump(f.db), before);
    assert.deepEqual(store.getSnapshot(), snapshot);
  } finally { store.close(); f.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('lease identity, exact acquisition/release, wrong owner, stale holder and durable recovery fail closed', () => {
  const f = gf15Fixture();
  try {
    assert.deepEqual(f.quiescence.acquire({ leaseId: f.lease.leaseId, owner: f.lease.owner }), f.lease);
    assert.throws(() => f.quiescence.acquire({ leaseId: f.lease.leaseId, owner: 'other-owner' }), /SCHEDULING_LEASE_REUSE/);
    assert.throws(() => f.quiescence.release({ ...f.lease, owner: 'other-owner' }), /SCHEDULING_LEASE_OWNER_MISMATCH/);
    assert.throws(() => f.quiescence.acquire({ leaseId: 'competing', owner: f.lease.owner }), /SCHEDULING_QUIESCENCE_HELD/);
    f.service.begin(f.binding, f.lease, f.principal);
    f.setTime('2026-09-30T15:36:00.000Z');
    assert.throws(() => f.service.forward(f.lease, f.principal), /SCHEDULING_LEASE_EXPIRED/);
    assert.throws(() => f.quiescence.release(f.lease), /SCHEDULING_LEASE_EXPIRED/);
    assert.throws(() => f.quiescence.acquire({ leaseId: 'hostile-recovery', owner: 'other', purpose: 'rollback' }), /SCHEDULING_LEASE_OWNER_MISMATCH/);
    const recovery = leaseAgain(f, 'rollback', 'recovery');
    assert.throws(() => f.service.forward(f.lease, f.principal), /SCHEDULING_QUIESCENCE_HELD/);
    assert.throws(() => f.service.forward(recovery, f.principal), /GF15_FORWARD_LEASE_REQUIRED/);
    assert.equal(f.service.rollback(recovery, f.principal).ok, true);
    assert.equal(f.quiescence.release(recovery).exactReplay, false);
    assert.equal(f.quiescence.release(recovery).exactReplay, true);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM gf15_control_receipts').get().n, 4);
  } finally { f.db.close(); }
});

test('all canonical Scheduling writers and run-fact mutations are excluded; the holder cannot submit unrelated commands', () => {
  const f = gf15Fixture({ checkpoint: step => { if (step === 'after-proposal') throw new Error('pause'); } });
  try {
    f.service.begin(f.binding, f.lease, f.principal);
    assert.throws(() => f.service.forward(f.lease, f.principal), /pause/);
    const ordinary = createSqliteSchedulingAdminStoreV1({ db: f.db, now: f.now, refreshProjections: f.refreshProjections });
    const proposal = ordinaryProposal(f);
    const before = dump(f.db);
    const decision = readGf15Packet(f.db, ids.decision);
    const resourceCommand = { operationId: 'UNRELATED-RESOURCE', ...revisions(f.db), resource: GF15_RESOURCE };
    const publish = { ...readGf15Packet(f.db, ids.publish), operationId: 'UNRELATED-PUBLISH', configVersion: 'new-config' };
    const attempts = [
      () => ordinary.registerResource(resourceCommand, f.principal.subjectId),
      () => ordinary.replaceResource(resourceCommand, f.principal.subjectId),
      () => ordinary.publishConfig(publish, f.principal.subjectId),
      () => ordinary.activateConfig({ operationId: 'UNRELATED-ACTIVATE', configVersion: ids.config,
        expectedProjectionRevision: revisions(f.db).expectedProjectionRevision }, f.principal.subjectId),
      () => ordinary.setRequestRequirements({ ...readGf15Packet(f.db, ids.requirements), operationId: 'UNRELATED-REQS' }, f.principal.subjectId),
      () => proposal.generate({ ...readGf15Packet(f.db, ids.proposal), operationId: 'UNRELATED-GEN' }, f.principal.subjectId),
      () => proposal.accept(decision, f.principal),
      () => proposal.reject({ ...decision, decisionId: 'UNRELATED-REJECT', decisionType: 'reject', selectedProposalItemIds: null }, f.principal.subjectId),
      () => proposal.stale({ proposalId: decision.proposalId, triggerOperationId: 'UNRELATED-STALE', reasonCode: 'RESOURCE_CHANGED' }),
      () => immediateGf15(f.db, () => staleDraftProposalsInTransactionV1({ db: f.db, now: f.now,
        triggerOperationId: 'UNRELATED-INVALIDATION', reasonCode: 'RESOURCE_CHANGED' })),
      () => createSqliteRunEventStore({ db: f.db, businessTimeZone: 'Asia/Shanghai' }).withImmediateTransaction(() => { throw new Error('must not run'); }),
    ];
    for (const attempt of attempts) { assert.throws(attempt, /SCHEDULING_QUIESCENCE_HELD/); assert.equal(dump(f.db), before); }
    const ownStore = createSqliteSchedulingAdminStoreV1({ db: f.db, now: f.now,
      refreshProjections: f.refreshProjections, schedulingLease: f.lease });
    assert.throws(() => ownStore.publishConfig(publish, f.principal.subjectId), /GF15_COMMAND_NOT_BOUND/);
    assert.equal(dump(f.db), before);
    assert.equal(f.serviceWith({ checkpoint: undefined }).forward(f.lease, f.principal).ok, true);
  } finally { f.db.close(); }
});

test('lease is acquired before the zero-draft gate; unrelated drafts survive rejected preparation', () => {
  const f = gf15Fixture();
  try {
    const command = setupUnrelated(f);
    const generated = ordinaryProposal(f).generate(command, f.principal.subjectId);
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const lease = leaseAgain(f);
    const before = dump(f.db);
    assert.throws(() => f.service.begin(f.binding, lease, f.principal), /GF15_DRAFT_GATE_FAILED/);
    assert.equal(dump(f.db), before);
    assert.equal(f.db.prepare('SELECT receipt_json FROM gf15_control_receipts WHERE receipt_id = ?').get(`acquire:${lease.token}`) !== undefined, true);
  } finally { f.db.close(); }
});

test('a pre-existing computation cannot persist a late draft after lease acquisition and zero-draft verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gf15-late-generation-'));
  const f = gf15Fixture({ path: join(root, 'fixture.sqlite') });
  let worker;
  try {
    const command = setupUnrelated(f);
    const shared = new SharedArrayBuffer(16);
    worker = new Worker(new URL('./support/gf15-race-worker.mjs', import.meta.url), {
      workerData: { mode: 'late-generation', path: join(root, 'fixture.sqlite'), shared, command, now: f.now().toISOString() } });
    const [ready] = await once(worker, 'message'); assert.equal(ready.ready, true);
    const lease = leaseAgain(f);
    f.service.begin(f.binding, lease, f.principal);
    const resultPromise = once(worker, 'message');
    Atomics.store(new Int32Array(shared), 0, 1); Atomics.notify(new Int32Array(shared), 0);
    const [result] = await resultPromise;
    assert.equal(result.error, 'SCHEDULING_QUIESCENCE_HELD');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM scheduling_proposals WHERE status = 'draft'").get().n, 0);
    assert.equal(f.service.forward(lease, f.principal).ok, true);
  } finally { await worker?.terminate(); f.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('racing real claimBatch sees no GF15 intent at enqueue commit; unrelated notification is claimable and delivery stays excluded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gf15-outbox-race-'));
  const shared = new Int32Array(new SharedArrayBuffer(16));
  let worker;
  const f = gf15Fixture({ path: join(root, 'fixture.sqlite') });
  const raceDb = new Proxy(f.db, { get(target, key) {
    if (key === 'prepare') return sql => {
      const statement = target.prepare(sql);
      if (!/INSERT INTO notification_outbox/u.test(sql)) return statement;
      return new Proxy(statement, { get(inner, method) {
        if (method === 'run') return (...args) => {
          const result = inner.run(...args);
          // Real intent is inserted but acceptance has not committed. Force a simultaneous
          // real claimBatch on another connection at this exact enqueue boundary.
          const busyBefore = Atomics.load(shared, 1);
          assert.notEqual(Atomics.wait(shared, 1, busyBefore, 3000), 'timed-out');
          assert.ok(Atomics.load(shared, 1) > busyBefore);
          return result;
        };
        const value = Reflect.get(inner, method, inner);
        return typeof value === 'function' ? value.bind(inner) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    const card = buildScheduleConfirmedCardV1({ scheduleItemId: 'UNRELATED-SCHEDULE', resourceId: 'OTHER-STUDIO',
      plannedStart: f.binding.planningWindowStart, plannedEnd: f.binding.planningWindowEnd, taskCount: 1, scheduleRevision: 1 });
    const intent = buildNotificationIntentV1({ outboxId: 'UNRELATED-OUTBOX', intentType: 'schedule.confirmed.v1',
      aggregateType: 'schedule_item', aggregateId: 'UNRELATED-SCHEDULE', routeKey: 'operations.default',
      aggregateRevisionScope: 'schedule', aggregateRevision: 1, cardSchemaVersion: card.cardSchemaVersion,
      payload: card.card, createdAt: f.now().toISOString() }).intent;
    const repo = createSqliteOutboxRepositoryV1({ db: f.db });
    immediateGf15(f.db, () => assert.equal(repo.enqueue(intent).ok, true));
    worker = new Worker(new URL('./support/gf15-race-worker.mjs', import.meta.url), { workerData: {
      mode: 'claim', path: join(root, 'fixture.sqlite'), shared: shared.buffer, now: f.now().toISOString() } });
    const [ready] = await once(worker, 'message'); assert.deepEqual(ready.ids, ['UNRELATED-OUTBOX']);
    f.service.begin(f.binding, f.lease, f.principal);
    f.serviceWith({ db: raceDb }).forward(f.lease, f.principal);
    const successBefore = Atomics.load(shared, 2);
    assert.notEqual(Atomics.wait(shared, 2, successBefore, 3000), 'timed-out');
    const donePromise = once(worker, 'message'); Atomics.store(shared, 0, 1);
    const [done] = await donePromise;
    assert.deepEqual(done.ids, ['UNRELATED-OUTBOX']); assert.ok(done.iterations > 2);
    f.quiescence.release(f.lease);
    let sends = 0;
    const dispatcher = createOutboxDispatcherV1({ repository: repo, dingTalkAdapter: {
      readiness: () => ({ ok: true }), sendCard: async () => { sends += 1; return { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'fake' }; }
    }, clock: f.now });
    // The unrelated leased row may become eligible; no GF15 card may be returned by any claim.
    assert.deepEqual(repo.claimBatch({ workerId: 'after-race', now: f.now().toISOString(), limit: 8 }).items, []);
    assert.equal((await dispatcher.dispatchOnce({ workerId: 'local-fake-delivery' })).claimedCount, 0);
    assert.equal(sends, 0);
    const freshCard = buildScheduleConfirmedCardV1({ scheduleItemId: 'FUTURE-UNRELATED', resourceId: 'OTHER-STUDIO',
      plannedStart: f.binding.planningWindowStart, plannedEnd: f.binding.planningWindowEnd, taskCount: 1, scheduleRevision: 2 });
    const freshIntent = buildNotificationIntentV1({ outboxId: 'FUTURE-UNRELATED-OUTBOX', intentType: 'schedule.confirmed.v1',
      aggregateType: 'schedule_item', aggregateId: 'FUTURE-UNRELATED', routeKey: 'operations.default',
      aggregateRevisionScope: 'schedule', aggregateRevision: 2, cardSchemaVersion: freshCard.cardSchemaVersion,
      payload: freshCard.card, createdAt: f.now().toISOString() }).intent;
    immediateGf15(f.db, () => assert.equal(repo.enqueue(freshIntent).ok, true));
    assert.equal((await dispatcher.dispatchOnce({ workerId: 'local-fake-delivery' })).sentCount, 1);
    assert.equal(sends, 1);
    const isolated = f.db.prepare('SELECT outbox_id FROM gf15_outbox_isolation').get().outbox_id;
    assert.equal(repo.getById(isolated).record.attemptCount, 0);
    assert.equal(repo.getById(isolated).record.isolation.decisionId, ids.decision);
    assert.equal(repo.getById(isolated).record.isolation.reason, 'GF15_ACCEPTANCE');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'gf15.outbox.isolate'").get().n, 1);
  } finally { await worker?.terminate(); f.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('canonical forward/partial rollback exercises exactly all ten frozen state pairs', () => {
  const seen = new Set();
  for (const prior of [false, true]) for (const stop of ['none', 'after-resource', 'after-config', 'after-decision']) {
    const f = gf15Fixture({ prior, checkpoint: step => { if (step === stop) throw new Error('forward-fault'); } });
    try {
      f.service.begin(f.binding, f.lease, f.principal);
      if (stop !== 'none') assert.throws(() => f.service.forward(f.lease, f.principal), /forward-fault/);
      seen.add(f.service.classify(f.lease, f.principal).pair);
      const partial = f.serviceWith({ checkpoint: step => { if (step === 'rollback-after-resource') throw new Error('rollback-fault'); } });
      assert.throws(() => partial.rollback(f.lease, f.principal), /rollback-fault/);
      seen.add(f.service.classify(f.lease, f.principal).pair);
      f.service.rollback(f.lease, f.principal);
      seen.add(f.service.classify(f.lease, f.principal).pair);
      const packets = f.db.prepare('SELECT * FROM gf15_command_packets').all();
      f.quiescence.release(f.lease);
      const recovery = leaseAgain(f, 'rollback', 'rollback-replay');
      const before = dump(f.db);
      f.service.rollback(recovery, f.principal);
      assert.equal(dump(f.db), before);
      assert.deepEqual(f.db.prepare('SELECT * FROM gf15_command_packets').all(), packets);
    } finally { f.db.close(); }
  }
  assert.deepEqual([...seen].sort(), [...GF15_ROLLBACK.rollbackStateMachine.validStatePairs].sort());
});

test('rollback binds before first attempt, retries unchanged after a transaction fault, and rejects later Scheduling ownership', () => {
  const f = gf15Fixture({ prior: true });
  try {
    f.service.begin(f.binding, f.lease, f.principal); f.service.forward(f.lease, f.principal);
    const before = dump(f.db);
    const fault = f.serviceWith({ refreshProjections: () => { throw new Error('rollback-projection-fault'); } });
    assert.throws(() => fault.rollback(f.lease, f.principal), /rollback-projection-fault/);
    assert.equal(dump(f.db), before);
    const packetBefore = readGf15Packet(f.db, ids.rollbackResource);
    f.service.rollback(f.lease, f.principal);
    assert.deepEqual(readGf15Packet(f.db, ids.rollbackResource), packetBefore);
    f.quiescence.release(f.lease);
    const admin = createSqliteSchedulingAdminStoreV1({ db: f.db, now: f.now, refreshProjections: f.refreshProjections });
    assert.equal(admin.replaceResource({ operationId: 'later-owner-change', ...revisions(f.db),
      resource: { ...GF15_RESOURCE, status: 'active' } }, f.principal.subjectId).ok, true);
    const recovery = leaseAgain(f, 'rollback', 'ownership-recovery');
    const changed = dump(f.db);
    assert.throws(() => f.service.rollback(recovery, f.principal), /GF15_ROLLBACK_STATE_REJECTED/);
    assert.equal(dump(f.db), changed);
    assert.deepEqual(readGf15Packet(f.db, ids.rollbackResource), packetBefore);
  } finally { f.db.close(); }
});

test('prior-config rollback binds its first projection revision after containment and reuses it after activation failure', () => {
  const f = gf15Fixture({ prior: true });
  try {
    f.service.begin(f.binding, f.lease, f.principal); f.service.forward(f.lease, f.principal);
    const fault = f.serviceWith({ refreshProjections: context => {
      if (f.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version === 'prior-config') throw new Error('config-restore-fault');
      return f.refreshProjections(context);
    } });
    assert.throws(() => fault.rollback(f.lease, f.principal), /config-restore-fault/);
    assert.equal(f.service.classify(f.lease, f.principal).pair, 'RESOURCE_ROLLBACK_APPLIED + CONFIG_FORWARD_APPLIED');
    const packet = readGf15Packet(f.db, ids.rollbackConfig);
    assert.equal(packet.expectedProjectionRevision, revisions(f.db).expectedProjectionRevision);
    f.service.rollback(f.lease, f.principal);
    assert.deepEqual(readGf15Packet(f.db, ids.rollbackConfig), packet);
    assert.equal(f.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version, 'prior-config');
    const before = dump(f.db);
    f.service.rollback(f.lease, f.principal);
    assert.equal(dump(f.db), before);
  } finally { f.db.close(); }
});

for (const attack of [
  "UPDATE scheduling_resources SET v1_display_place = 'forged value' WHERE resource_id = 'STUDIO-PROD-01'",
  "UPDATE scheduling_active_config SET activation_operation_id = 'forged-owner' WHERE id = 1",
  "UPDATE revision_counters SET projection_revision = projection_revision + 1 WHERE id = 1",
  "UPDATE requests_v2 SET note = 'forged request' WHERE id = 'REQ-GF15-ACCEPT-PROD-01'",
]) {
  test(`corrupt or later-owned mutable facts cause zero rollback mutations: ${attack.split(' ')[1]}`, () => {
    const f = gf15Fixture({ prior: true });
    try {
      f.service.begin(f.binding, f.lease, f.principal); f.service.forward(f.lease, f.principal);
      // Adversarial corruption only: never seed GF15 acceptance facts with SQL. All setup above
      // goes through the real domain commands. The injected mutation must be rejected.
      f.db.exec(attack);
      const before = dump(f.db);
      const packets = f.db.prepare('SELECT * FROM gf15_command_packets').all();
      assert.throws(() => f.service.rollback(f.lease, f.principal), /GF15_ROLLBACK_STATE_REJECTED|GF15_POSTSTATE_REVISION_CHANGED|GF15_REQUEST_ROW_MISMATCH/);
      assert.equal(dump(f.db), before);
      assert.deepEqual(f.db.prepare('SELECT * FROM gf15_command_packets').all(), packets);
    } finally { f.db.close(); }
  });
}

test('a corrupt forward receipt cannot be used to authorize rollback', () => {
  const f = gf15Fixture({ prior: true });
  try {
    f.service.begin(f.binding, f.lease, f.principal); f.service.forward(f.lease, f.principal);
    // Explicit hostile storage corruption, after canonical setup; ordinary SQL cannot edit this receipt.
    assert.throws(() => f.db.exec("UPDATE scheduling_admin_operations SET command_digest = 'forged' WHERE operation_id = 'PRODGF15-RESOURCE-R1'"), /immutable/);
    f.db.exec('DROP TRIGGER scheduling_admin_operations_no_update');
    f.db.exec("UPDATE scheduling_admin_operations SET command_digest = 'forged' WHERE operation_id = 'PRODGF15-RESOURCE-R1'");
    const before = dump(f.db);
    assert.throws(() => f.service.rollback(f.lease, f.principal), /GF15_RECEIPT_MISMATCH/);
    assert.equal(dump(f.db), before);
    assert.equal(readGf15Packet(f.db, ids.rollbackResource), null);
  } finally { f.db.close(); }
});
