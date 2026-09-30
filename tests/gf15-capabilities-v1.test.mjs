import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gf15Fixture } from './support/gf15-fixture.mjs';
import { GF15_IDS as ids, GF15_REQUEST, bindGf15WindowV1 } from '../src/gf15-contract-v1.mjs';
import { createSqliteGf15RequestStoreV1 } from '../src/sqlite-gf15-request-store-v1.mjs';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';
import { readGf15Packet } from '../src/sqlite-scheduling-quiescence-v1.mjs';

function facts(db) {
  return Object.fromEntries(['requests_v2', 'scheduling_resources', 'scheduling_config_versions',
    'scheduling_proposals', 'scheduling_proposal_decisions', 'schedule_items', 'schedule_item_tasks',
    'notification_outbox', 'gf15_outbox_isolation', 'operations', 'audit_log'].map(table => [table,
    db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row }))]));
}

test('canonical migration history determines the next request ordinal; an unrelated open candidate fails before GF15 mutation', () => {
  for (const status of ['completed', 'pending']) {
    const root = mkdtempSync(join(tmpdir(), 'gf15-legacy-'));
    const f = gf15Fixture({ path: join(root, 'target.sqlite'), legacySnapshot: {
      schemaVersion: 1, revision: 3, updatedAt: '2026-09-29T00:00:00.000Z', products: [], sessions: [],
      tasks: [0, 1].map(index => ({ id: `LEGACY-${index}`, sku: `OLD-${index}`, name: 'Legacy product',
        client: 'Old client', deliver: 'Old deliverable', kind: '细节', status, source: 'workbench' })) } });
    try {
      const before = facts(f.db);
      if (status === 'pending') {
        assert.throws(() => f.service.begin(f.binding, f.lease, f.principal), /GF15_CANDIDATE_ISOLATION_FAILED/);
        assert.deepEqual(facts(f.db), before);
      } else {
        f.service.begin(f.binding, f.lease, f.principal);
        const result = f.service.forward(f.lease, f.principal);
        assert.equal(result.request.row.source_ordinal, 2);
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM requests_v2').get().n, 3);
      }
    } finally { f.db.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

for (const table of ['notification_outbox', 'gf15_outbox_isolation']) {
  test(`acceptance rolls back schedule, revisions, decision, audit and isolation on ${table} failure`, () => {
    const f = gf15Fixture({ checkpoint: step => { if (step === 'after-proposal') throw new Error('pause'); } });
    try {
      f.service.begin(f.binding, f.lease, f.principal);
      assert.throws(() => f.service.forward(f.lease, f.principal), /pause/);
      const before = facts(f.db);
      const revisions = f.db.prepare('SELECT * FROM revision_counters').get();
      f.db.exec(`CREATE TEMP TRIGGER acceptance_fault BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'injected-enqueue-fault'); END;`);
      const service = f.serviceWith({ checkpoint: undefined });
      assert.throws(() => service.forward(f.lease, f.principal), /OUTBOX_STORE_ERROR|injected-enqueue-fault/);
      assert.deepEqual(facts(f.db), before);
      assert.deepEqual(f.db.prepare('SELECT * FROM revision_counters').get(), revisions);
      f.db.exec('DROP TRIGGER acceptance_fault');
      assert.equal(service.forward(f.lease, f.principal).ok, true);
    } finally { f.db.close(); }
  });
}

test('bounded forward creates all 36 attested columns, one exact schedule and permanently unclaimable intent', () => {
  const f = gf15Fixture();
  try {
    f.service.begin(f.binding, f.lease, f.principal);
    const result = f.service.forward(f.lease, f.principal);
    assert.equal(result.ok, true);
    const row = { ...f.db.prepare('SELECT * FROM requests_v2').get() };
    assert.deepEqual(Object.keys(row), GF15_REQUEST.completePersistedColumns);
    assert.deepEqual(row, { ...GF15_REQUEST.fixedPersistedFields, source_ordinal: 0,
      business_created_at: f.now().toISOString(), business_updated_at: f.now().toISOString(),
      imported_at: f.now().toISOString(), desired_date: f.binding.desiredDate });
    for (const table of ['requests_v2', 'scheduling_resources', 'scheduling_proposals',
      'scheduling_proposal_decisions', 'schedule_items', 'schedule_item_tasks', 'notification_outbox', 'gf15_outbox_isolation']) {
      assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 1, table);
    }
    const schedule = f.db.prepare('SELECT * FROM schedule_items').get();
    assert.equal(schedule.resource_id, ids.resource);
    assert.equal(schedule.schedule_status, 'confirmed');
    assert.equal(Date.parse(schedule.planned_end) - Date.parse(schedule.planned_start), 900000);
    assert.equal(schedule.buffer_after_minutes, 5);
    assert.equal(f.db.prepare('SELECT task_id FROM schedule_item_tasks').get().task_id, ids.request);
    const outbox = createSqliteOutboxRepositoryV1({ db: f.db });
    assert.deepEqual(outbox.claimBatch({ workerId: 'test-worker', now: f.now().toISOString(), limit: 8 }).items, []);
    const before = facts(f.db);
    const revisions = f.db.prepare('SELECT * FROM revision_counters').get();
    f.setTime('2026-09-30T15:31:00.000Z');
    const replay = f.service.forward(f.lease, f.principal);
    assert.equal(replay.exactReplay, true);
    assert.deepEqual(replay.receipt, result.receipt);
    assert.deepEqual(facts(f.db), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM revision_counters').get(), revisions);
    f.quiescence.release(f.lease);
    assert.deepEqual(outbox.claimBatch({ workerId: 'test-worker', now: '2030-01-01T00:00:00.000Z', limit: 8 }).items, []);
  } finally { f.db.close(); }
});

test('materialization rejects command/digest/date/identity collisions and rolls back on projection failure', () => {
  const f = gf15Fixture();
  try {
    f.service.begin(f.binding, f.lease, f.principal);
    const command = { command: f.binding.requestCommand, commandDigest: f.binding.requestDigest,
      desiredDate: f.binding.desiredDate, expectedProjectionRevision: 0 };
    const store = createSqliteGf15RequestStoreV1({ db: f.db, now: f.now, schedulingLease: f.lease,
      refreshProjections: () => { throw new Error('projection-fault'); } });
    const before = facts(f.db);
    assert.throws(() => store.materialize(command, f.principal), /projection-fault/);
    assert.deepEqual(facts(f.db), before);
    assert.equal(f.db.prepare('SELECT projection_revision FROM revision_counters').get().projection_revision, 0);
    for (const bad of [
      { ...command, command: { ...command.command, name: 'other' } },
      { ...command, commandDigest: 'sha256:' + '0'.repeat(64) },
      { ...command, desiredDate: '2026-09-30' },
      { ...command, command: { ...command.command, operationId: 'different-operation' } },
      { ...command, command: { ...command.command, briefUrl: 'https://brief.example/x' } },
    ]) assert.throws(() => store.materialize(bad, f.principal), /GF15_REQUEST_BINDING_MISMATCH/);
    const good = createSqliteGf15RequestStoreV1({ db: f.db, now: f.now, schedulingLease: f.lease, refreshProjections: f.refreshProjections });
    good.materialize(command, f.principal);
    assert.equal(good.materialize(command, f.principal).exactReplay, true);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit_log').get().n, 1);
  } finally { f.db.close(); }
});

test('future date follows Asia/Shanghai and preflight rejects short/cross-day windows before any GF15 fact', () => {
  const f = gf15Fixture();
  try {
    assert.throws(() => bindGf15WindowV1({ desiredDate: '2026-10-01', start: '10:00', end: '10:19' }), /GF15_WINDOW_CAPACITY/);
    assert.throws(() => bindGf15WindowV1({ desiredDate: '2026-10-01', start: '23:55', end: '00:15' }), /GF15_CONFIG_INVALID/);
    f.setTime('2026-09-30T16:00:00.000Z');
    // Refresh lease for this test; the original lease expired while local date became Oct 1.
    const lease = f.quiescence.acquire({ leaseId: 'date-recovery', owner: f.principal.subjectId, purpose: 'rollback' });
    assert.throws(() => f.service.begin(f.binding, lease, f.principal), /GF15_FORWARD_LEASE_REQUIRED/);
    f.quiescence.release(lease);
    const forward = f.quiescence.acquire({ leaseId: 'date-forward', owner: f.principal.subjectId });
    assert.throws(() => f.service.begin(f.binding, forward, f.principal), /GF15_DATE_NOT_FUTURE/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM requests_v2').get().n, 0);
  } finally { f.db.close(); }
});

test('forward creates no GF15 domain facts when the bound future window becomes stale after begin', () => {
  const f = gf15Fixture();
  try {
    f.quiescence.release(f.lease);
    f.setTime('2026-09-30T15:59:30.000Z'); // Asia/Shanghai 23:59:30.
    const lease = f.quiescence.acquire({ leaseId: 'freshness-forward', owner: f.principal.subjectId });
    f.service.begin(f.binding, lease, f.principal);
    const before = facts(f.db);
    const revisions = { ...f.db.prepare('SELECT * FROM revision_counters WHERE id = 1').get() };
    assert.equal(readGf15Packet(f.db, ids.requestOperation), null);

    f.setTime('2026-09-30T16:00:00.000Z'); // Asia/Shanghai desired date is no longer future.
    assert.throws(() => f.service.forward(lease, f.principal), /GF15_DATE_NOT_FUTURE|GF15_WINDOW_NOT_FUTURE/);

    assert.equal(readGf15Packet(f.db, ids.requestOperation), null);
    assert.deepEqual(facts(f.db), before);
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM revision_counters WHERE id = 1').get() }, revisions);
  } finally { f.db.close(); }
});

test('partial forward retry stays freshness-gated until the decision completes', () => {
  const f = gf15Fixture();
  try {
    f.quiescence.release(f.lease);
    f.setTime('2026-09-30T15:59:30.000Z');
    const lease = f.quiescence.acquire({ leaseId: 'partial-forward-freshness', owner: f.principal.subjectId, ttlMs: 900000 });
    f.service.begin(f.binding, lease, f.principal);
    const paused = f.serviceWith({ checkpoint: step => { if (step === 'after-request') throw new Error('pause-after-request'); } });
    assert.throws(() => paused.forward(lease, f.principal), /pause-after-request/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM requests_v2').get().n, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM scheduling_resources').get().n, 0);
    const before = facts(f.db);
    const packets = f.db.prepare('SELECT * FROM gf15_command_packets ORDER BY packet_id').all();

    f.setTime('2026-09-30T16:00:00.000Z');
    assert.throws(() => f.service.forward(lease, f.principal), /GF15_DATE_NOT_FUTURE|GF15_WINDOW_NOT_FUTURE/);
    assert.deepEqual(facts(f.db), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM gf15_command_packets ORDER BY packet_id').all(), packets);
    assert.equal(f.service.rollback(lease, f.principal).ok, true);
  } finally { f.db.close(); }
});

test('fully completed decision replay may remain exact after the bound window becomes stale', () => {
  const f = gf15Fixture();
  try {
    f.quiescence.release(f.lease);
    f.setTime('2026-09-30T15:59:30.000Z');
    const lease = f.quiescence.acquire({ leaseId: 'completed-forward-replay', owner: f.principal.subjectId, ttlMs: 900000 });
    f.service.begin(f.binding, lease, f.principal);
    const first = f.service.forward(lease, f.principal);
    assert.equal(first.ok, true);
    const before = facts(f.db);
    const revisions = { ...f.db.prepare('SELECT * FROM revision_counters WHERE id = 1').get() };

    f.setTime('2026-09-30T16:00:00.000Z');
    const replay = f.service.forward(lease, f.principal);
    assert.equal(replay.ok, true);
    assert.equal(replay.exactReplay, true);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.deepEqual(facts(f.db), before);
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM revision_counters WHERE id = 1').get() }, revisions);
  } finally { f.db.close(); }
});


for (const prior of [false, true]) {
  for (const stop of ['before-forward', 'after-request', 'after-resource', 'before-config', 'after-config', 'after-proposal', 'after-decision']) {
    test(`rollback after ${stop}, prior=${prior}, preserves facts and retries exact commands`, () => {
      const f = gf15Fixture({ prior, checkpoint: step => { if (step === stop) throw new Error(`fault:${stop}`); } });
      try {
        f.service.begin(f.binding, f.lease, f.principal);
        if (stop !== 'before-forward') assert.throws(() => f.service.forward(f.lease, f.principal), new RegExp(`fault:${stop}`));
        const immutable = Object.fromEntries(['requests_v2', 'schedule_items', 'schedule_item_tasks', 'notification_outbox']
          .map(table => [table, f.db.prepare(`SELECT * FROM ${table}`).all()]));
        const rollback = f.service.rollback(f.lease, f.principal);
        assert.equal(rollback.ok, true);
        const before = facts(f.db);
        const packets = f.db.prepare('SELECT * FROM gf15_command_packets').all();
        assert.equal(f.service.rollback(f.lease, f.principal).ok, true);
        assert.deepEqual(facts(f.db), before);
        assert.deepEqual(f.db.prepare('SELECT * FROM gf15_command_packets').all(), packets);
        for (const [table, rows] of Object.entries(immutable)) assert.deepEqual(f.db.prepare(`SELECT * FROM ${table}`).all(), rows);
        if (!['before-forward', 'after-request'].includes(stop)) assert.equal(f.db.prepare('SELECT status FROM scheduling_resources').get().status, 'inactive');
        if (prior) assert.equal(f.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version, 'prior-config');
        else if (['after-config', 'after-proposal', 'after-decision'].includes(stop)) assert.equal(f.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version, ids.config);
        if (stop !== 'before-forward') assert.equal(readGf15Packet(f.db, ids.requestOperation).command.operationId, ids.requestOperation);
      } finally { f.db.close(); }
    });
  }
}
