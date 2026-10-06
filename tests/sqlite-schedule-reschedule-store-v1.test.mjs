import assert from 'node:assert/strict';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';
import { buildScheduleConfirmedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';
import { buildNotificationIntentV1 } from '../src/outbox-contract-v1.mjs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { SCHEDULE_RESCHEDULE_SCHEMA_SQL } from '../src/sqlite-schedule-reschedule-schema-v1.mjs';
import { createSqliteScheduleRescheduleStoreV1 } from '../src/sqlite-schedule-reschedule-store-v1.mjs';
import { normalizeSchedulingConfig } from '../src/scheduling-admin-contract-v2.mjs';
import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { digestResourceCapabilitiesV1, canonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';
import { refreshSqliteSnapshotProjectionsV2 } from '../src/sqlite-run-event-store-v2.mjs';
import { createSqliteSchedulingProposalStoreV1 } from '../src/sqlite-scheduling-proposal-store-v1.mjs';
import { assembleSchedulingInputFromSqliteV1 } from '../src/sqlite-scheduling-input-assembler-v1.mjs';
import { createSqliteSchedulingQuiescenceV1 } from '../src/sqlite-scheduling-quiescence-v1.mjs';

const at = '2026-10-01T00:00:00.000Z';
const principal = createTrustedPrincipal({ subjectId: 'Jenn', role: 'scheduler', resourceIds: ['PHOTO'] }).principal;
function fixture(options = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON'); initializeWritableSchema(db);
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'schedule_reschedule_operations'").get()) db.exec(SCHEDULE_RESCHEDULE_SCHEMA_SQL);
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] }, capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
  const configInput = { schemaVersion: 1, businessTimeZone: 'Asia/Shanghai',
    resourceCalendars: [{ resourceId: 'PHOTO', capabilityDigest, weeklyWindows: [
      { weekday: 5, start: '09:00', end: '12:00' }, { weekday: 5, start: '13:30', end: '18:00' }], dateOverrides: [] }],
    durationFallbackRules: [{ ruleId: 'flat-hour', productionType: '平面', shootingSubtype: null, durationMs: 3600000 }],
    bufferRules: [{ ruleId: 'buffer', productionType: '平面', shootingSubtype: null, bufferAfterMinutes: 10 }],
    softScoringWeights: { LIGHTING_SWITCH: 1, REFLECTIVITY_SEQUENCE: 1, IDLE_GAP: 1, EXPECTED_OVERRUN: 1, DESIRED_DATE_MISS: 1 },
    compatibleAlgorithmVersions: ['deterministic-scheduler-v1'] };
  if (options.useV2) {
    configInput.schemaVersion = 2;
    configInput.resourceCalendars = configInput.resourceCalendars.map(({ weeklyWindows, ...calendar }) => ({ ...calendar, rules: [{ effectiveFrom: '2026-10-01', weeklyWindows, alternatingSaturday: { workingAnchorDate: '2026-10-10', windows: [{ start: '09:00', end: '12:00' }] } }] }));
  }
  const config = normalizeSchedulingConfig(configInput); assert.equal(config.ok, true);
  db.prepare('INSERT INTO revision_counters VALUES (1, 3, 2, ?)').run(at);
  db.prepare('INSERT INTO scheduling_resources VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('PHOTO', 'Jenn', 'active', canonicalJsonSchedulingV1(capabilityJson), capabilityDigest, at, at, 'resource-op');
  db.prepare('INSERT INTO scheduling_config_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('config-1', configInput.schemaVersion, 'deterministic-scheduler-v1', options.useV2 ? 'calendar-compiler-v2' : 'calendar-compiler-v1', 'estimate-policy-v1', config.configJson, config.configDigest, 'Jenn', at, 'pub-op');
  db.prepare('INSERT INTO scheduling_active_config VALUES (1, ?, ?, ?, 3)').run('config-1', at, 'act-op');
  db.prepare(`INSERT INTO requests_v2 (id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,deliverable_count,aspect_ratio,requested_by,desired_date,note,sample_status,lighting_preset,reflectivity,priority)
    VALUES ('REQ',0,'SKU','Product','Client','Photo','细节','canonical','open','domain_command','submission',?,1,1,'平面','细节',1,'1:1','Jenn','2026-10-02','','arrivedVerified','SOFT','low','p1')`).run(at);
  function insertItem(id = 'ITEM', start = '2026-10-02T01:00:00.000Z', end = '2026-10-02T02:00:00.000Z', ordinal = 0) {
    db.prepare(`INSERT INTO schedule_items (id,source_ordinal,resource_id,resource_resolution_status,resource_mapping_version,planned_start,planned_end,buffer_after_minutes,buffer_source,schedule_status,schedule_status_provenance,lock_status,lock_status_provenance,note,allocation_mode,source,business_created_at,business_updated_at,imported_at)
      VALUES (?,?,'PHOTO','resolved','resource-catalog-v1',?,?,10,'config-1','confirmed','domain_command','unlocked','domain_command','','single','human',?,?,?)`).run(id, ordinal, start, end, at, at, at);
  }
  insertItem(); db.prepare('INSERT INTO schedule_item_tasks VALUES (?,?,0,?,?)').run('ITEM','REQ',at,at);
  const now = () => new Date(at);
  const refreshProjections = context => refreshSqliteSnapshotProjectionsV2({ ...context, businessTimeZone: 'Asia/Shanghai' });
  const store = createSqliteScheduleRescheduleStoreV1({ db, now, refreshProjections, ...options });
  const command = { operationId: 'MOVE-1', scheduleItemId: 'ITEM', resourceId: 'PHOTO', plannedStart: '2026-10-02T05:30:00.000Z', plannedEnd: '2026-10-02T06:30:00.000Z', expectedScheduleRevision: 2, expectedProjectionRevision: 3, configDigest: config.configDigest };
  const counts = () => ({ ...db.prepare('SELECT * FROM revision_counters').get(), receipts: db.prepare('SELECT count(*) AS n FROM schedule_reschedule_operations').get().n });
  return { db, store, command, insertItem, counts, now, config };
}

test('reschedule preserves identity/binding, advances both projections once, audits and immutable exact replay', () => {
  const f = fixture(); try {
    const bindings = f.db.prepare('SELECT * FROM schedule_item_tasks').all();
    const beforeOutbox = f.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n;
    const result = f.store.reschedule(f.command, principal); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.notificationStatus, 'NOT_WIRED_NO_EVENT_ENQUEUED');
    assert.deepEqual(f.db.prepare('SELECT * FROM schedule_item_tasks').all(), bindings);
    assert.equal(result.receipt.scheduleRevision, 3); assert.equal(result.receipt.projectionRevision, 4);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM snapshot_projections WHERE revision=4').get().n, 2);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n, beforeOutbox);
    const counts = f.counts(); assert.equal(f.store.reschedule(f.command, principal).exactReplay, true); assert.deepEqual(f.counts(), counts);
    assert.equal(f.store.reschedule({ ...f.command, plannedEnd: '2026-10-02T07:00:00.000Z' }, principal).code, 'IDEMPOTENCY_KEY_REUSE');
    assert.deepEqual(f.store.readOperation('MOVE-1', principal).receipt, result.receipt);
    assert.throws(() => f.db.exec("DELETE FROM schedule_reschedule_operations"), /immutable/);
    assert.throws(() => f.db.exec("INSERT OR REPLACE INTO schedule_reschedule_operations SELECT * FROM schedule_reschedule_operations"), /immutable/);
    assert.throws(() => f.db.exec("UPDATE schedule_reschedule_operations SET actor_id='X'"), /immutable/);
  } finally { f.db.close(); }
});

for (const [name, mutate, code] of [
  ['stale schedule', f => f.command.expectedScheduleRevision--, 'SCHEDULING_REVISION_CONFLICT'],
  ['stale projection', f => f.command.expectedProjectionRevision--, 'SCHEDULING_REVISION_CONFLICT'],
  ['stale config', f => f.command.configDigest = `sha256:${'0'.repeat(64)}`, 'RESCHEDULE_CONFIG_CONFLICT'],
  ['lunch buffer crossing', f => Object.assign(f.command, { plannedStart: '2026-10-02T03:00:00.000Z', plannedEnd: '2026-10-02T04:00:00.000Z' }), 'RESCHEDULE_OUTSIDE_WORK_WINDOW'],
  ['closed Saturday', f => Object.assign(f.command, { plannedStart: '2026-10-03T01:00:00.000Z', plannedEnd: '2026-10-03T02:00:00.000Z' }), 'RESCHEDULE_OUTSIDE_WORK_WINDOW'],
  ['cancelled', f => f.db.exec("UPDATE schedule_items SET schedule_status='cancelled'"), 'RESCHEDULE_ITEM_IMMUTABLE'],
  ['locked', f => f.db.exec("UPDATE schedule_items SET lock_status='locked'"), 'RESCHEDULE_ITEM_IMMUTABLE'],
  ['run history', f => f.db.prepare("INSERT INTO production_runs (id,schedule_item_id,scope,status,run_revision,created_at,updated_at) VALUES ('RUN','ITEM','block','cancelled',0,?,?)").run(at,at), 'RESCHEDULE_ITEM_IMMUTABLE'],
  ['inactive resource', f => f.db.exec("UPDATE scheduling_resources SET status='inactive'"), 'SCHEDULE_RESOURCE_INACTIVE'],
  ['other item overlap', f => f.insertItem('OTHER','2026-10-02T06:00:00.000Z','2026-10-02T07:00:00.000Z',1), 'SCHEDULE_RESOURCE_OVERLAP_OR_UNKNOWN'],
  ['other item buffer overlap', f => f.insertItem('OTHER','2026-10-02T05:00:00.000Z','2026-10-02T05:25:00.000Z',1), 'SCHEDULE_RESOURCE_OVERLAP_OR_UNKNOWN'],
]) test(`reject ${name} without receipt/revision mutation`, () => {
  const f = fixture(); try { mutate(f); const counts = f.counts(); const result = f.store.reschedule(f.command, principal); assert.equal(result.code, code, JSON.stringify(result)); assert.deepEqual(f.counts(), counts); } finally { f.db.close(); }
});

test('same-item overlap excluded; exact buffer boundary accepted', () => {
  const f = fixture(); try {
    Object.assign(f.command, { plannedStart: '2026-10-02T01:30:00.000Z', plannedEnd: '2026-10-02T03:50:00.000Z' });
    assert.equal(f.store.reschedule(f.command, principal).ok, true);
  } finally { f.db.close(); }
});

test('trusted role/resource scope and disabled admission are required', () => {
  const f = fixture(); try {
    for (const actor of [null, createTrustedPrincipal({ subjectId: 'viewer', role: 'viewer', resourceIds: ['PHOTO'] }).principal, createTrustedPrincipal({ subjectId: 'other', role: 'administrator', resourceIds: ['OTHER'] }).principal]) assert.equal(f.store.reschedule(f.command, actor).code, 'RESOURCE_FORBIDDEN');
  } finally { f.db.close(); }
  const disabled = fixture({ writeAdmission: () => false }); try { assert.equal(disabled.store.reschedule(disabled.command, principal).code, 'WRITE_ADMISSION_CLOSED'); } finally { disabled.db.close(); }
});

test('GF15 lease blocks even expired holder; transaction rolls back', () => {
  const f = fixture(); try {
    createSqliteSchedulingQuiescenceV1({ db: f.db, now: () => new Date(Date.parse(at) - 1000) }).acquire({ leaseId: 'lease', owner: 'other', ttlMs: 1 });
    assert.throws(() => f.store.reschedule(f.command, principal), /SCHEDULING_QUIESCENCE_HELD/);
    assert.equal(f.counts().receipts, 0); assert.equal(f.db.isTransaction, false);
  } finally { f.db.close(); }
});

test('projection failure rolls schedule/counters/receipts/audit back atomically', () => {
  const f = fixture({ refreshProjections: () => { throw new Error('synthetic projection failure'); } }); try {
    const before = f.db.prepare('SELECT * FROM schedule_items').all(), counts = f.counts();
    assert.throws(() => f.store.reschedule(f.command, principal), /synthetic projection failure/);
    assert.deepEqual(f.db.prepare('SELECT * FROM schedule_items').all(), before); assert.deepEqual(f.counts(), counts);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='rescheduleScheduleItem'").get().n, 0);
  } finally { f.db.close(); }
});


test('reschedule rejects an operation id already owned by proposal generation', () => {
  const f = fixture(); try {
    const proposals = createSqliteSchedulingProposalStoreV1({ db: f.db, now: f.now,
      assembleInput: assembleSchedulingInputFromSqliteV1 });
    const generated = proposals.generate({ operationId: f.command.operationId,
      planningWindowStart: '2026-10-02T00:00:00.000Z', planningWindowEnd: '2026-10-03T00:00:00.000Z',
      resourceScope: ['PHOTO'] }, principal.subjectId);
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const before = f.counts();
    assert.equal(f.store.reschedule(f.command, principal).code, 'IDEMPOTENCY_KEY_REUSE');
    assert.deepEqual(f.counts(), before);
    assert.equal(proposals.read(generated.proposal.proposalId).proposal.generationOperationId, f.command.operationId);
  } finally { f.db.close(); }
});

test('reschedule invalidates existing draft proposals with immutable stale decisions', () => {
  const f = fixture(); try {
    const proposals = createSqliteSchedulingProposalStoreV1({ db: f.db, now: f.now, assembleInput: assembleSchedulingInputFromSqliteV1 });
    const generated = proposals.generate({ operationId: 'GEN-MOVE', planningWindowStart: '2026-10-02T00:00:00.000Z', planningWindowEnd: '2026-10-03T00:00:00.000Z', resourceScope: ['PHOTO'] }, principal.subjectId);
    assert.equal(generated.ok, true, JSON.stringify(generated));
    assert.equal(f.store.reschedule(f.command, principal).ok, true);
    assert.equal(proposals.read(generated.proposal.proposalId).lifecycle.status, 'stale');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM scheduling_proposal_decisions').get().n, 1);
    f.store.reschedule(f.command, principal);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM scheduling_proposal_decisions').get().n, 1);
  } finally { f.db.close(); }
});


test('v2 alternating Saturdays continue beyond specimen horizon and respect off-week', () => {
  const f = fixture({ useV2: true }); try {
    Object.assign(f.command, { plannedStart: '2027-10-09T01:00:00.000Z', plannedEnd: '2027-10-09T02:00:00.000Z' });
    assert.equal(f.store.reschedule(f.command, principal).ok, true);
    const next = { ...f.command, operationId: 'MOVE-2', expectedScheduleRevision: 3, expectedProjectionRevision: 4, plannedStart: '2027-10-16T01:00:00.000Z', plannedEnd: '2027-10-16T02:00:00.000Z' };
    assert.equal(f.store.reschedule(next, principal).code, 'RESCHEDULE_OUTSIDE_WORK_WINDOW');
  } finally { f.db.close(); }
});


test('reschedule blocks every still-dispatchable old confirmation without rewriting the outbox', () => {
  for (const status of ['pending', 'leased', 'retryableFailed', 'sent', 'deadLetter']) {
    const f = fixture(); try {
      let token = 0;
      const outbox = createSqliteOutboxRepositoryV1({ db: f.db, tokenFactory: () => `LEASE-${++token}`, random: () => 0 });
      const card = buildScheduleConfirmedCardV1({ scheduleItemId: 'ITEM', resourceId: 'PHOTO', plannedStart: '2026-10-02T01:00:00.000Z', plannedEnd: '2026-10-02T02:00:00.000Z', taskCount: 1, scheduleRevision: 2 });
      assert.equal(card.ok, true);
      const intent = buildNotificationIntentV1({ outboxId: 'OLD-CONFIRMED', intentType: 'schedule.confirmed.v1', aggregateType: 'schedule_item', aggregateId: 'ITEM', routeKey: 'operations.default', aggregateRevisionScope: 'schedule', aggregateRevision: 2, cardSchemaVersion: card.cardSchemaVersion, payload: card.card, createdAt: at });
      assert.equal(intent.ok, true); f.db.exec('BEGIN IMMEDIATE'); assert.equal(outbox.enqueue(intent.intent).ok, true); f.db.exec('COMMIT');
      if (status !== 'pending') {
        const claimed = outbox.claimBatch({ workerId: 'local-fake', now: at, limit: 1 });
        assert.equal(claimed.ok, true); assert.equal(claimed.items.length, 1);
        if (status === 'retryableFailed') {
          assert.equal(outbox.settleDelivery({ outboxId: intent.intent.outboxId, leaseToken: claimed.items[0].leaseToken,
            result: { ok: false, code: 'DINGTALK_TIMEOUT' }, now: '2026-10-01T00:00:01.000Z' }).code, 'OUTBOX_RETRY_SCHEDULED');
        } else if (status === 'sent') {
          assert.equal(outbox.settleDelivery({ outboxId: intent.intent.outboxId, leaseToken: claimed.items[0].leaseToken,
            result: { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'dt:test/sent' }, now: '2026-10-01T00:00:01.000Z' }).code, 'OUTBOX_SENT');
        } else if (status === 'deadLetter') {
          assert.equal(outbox.settleDelivery({ outboxId: intent.intent.outboxId, leaseToken: claimed.items[0].leaseToken,
            result: { ok: false, code: 'DINGTALK_REQUEST_REJECTED' }, now: '2026-10-01T00:00:01.000Z' }).code, 'OUTBOX_DEAD_LETTERED');
        }
      }
      assert.equal(outbox.getById(intent.intent.outboxId).record.status, status);
      const before = f.db.prepare('SELECT * FROM notification_outbox').all();
      const result = f.store.reschedule(f.command, principal);
      if (['pending', 'retryableFailed', 'leased'].includes(status)) {
        assert.equal(result.code, 'RESCHEDULE_NOTIFICATION_IN_FLIGHT', status);
      } else {
        assert.equal(result.ok, true, status);
      }
      assert.deepEqual(f.db.prepare('SELECT * FROM notification_outbox').all(), before);
    } finally { f.db.close(); }
  }
});
