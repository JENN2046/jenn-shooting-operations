import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { buildProductionRunCompletedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';
import { buildNotificationIntentV1 } from '../src/outbox-contract-v1.mjs';
import { createOutboxDispatcherV1 } from '../src/outbox-dispatcher-v1.mjs';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';

const NOW = '2026-09-22T12:00:00.000Z';

function card(index = 1) {
  return Object.freeze({
    runId: `RUN-0000000${index}`,
    scheduleItemId: `SCHEDULE-000${index}`,
    resourceId: 'STUDIO-A',
    scope: 'task',
    taskCount: 1,
    completedAt: '2026-09-22T11:00:00.000Z',
    netDurationMs: 1_000,
    runRevision: index,
  });
}

function item(index = 1) {
  return Object.freeze({
    outboxId: `OUTBOX-0000000${index}`,
    leaseToken: `LEASE-0000000${index}`,
    dedupeKey: `dingtalk:completion:${index}`,
    routeKey: 'shooting-operations',
    card: card(index),
  });
}

function fakeRepository({
  claimed = [],
  claimError = null,
  claimResult = null,
  settle = async () => ({ ok: true, code: 'OUTBOX_SENT' }),
} = {}) {
  const calls = { claim: [], settle: [] };
  return {
    calls,
    async claimBatch(input) {
      calls.claim.push(input);
      if (claimError) throw claimError;
      return claimResult ?? {
        ok: true,
        code: 'OUTBOX_CLAIMED',
        items: claimed,
        expiredDeadLettered: 0,
      };
    },
    async settleDelivery(input) {
      calls.settle.push(input);
      return settle(input);
    },
  };
}

function dispatcher(options) {
  return createOutboxDispatcherV1({
    clock: () => new Date(NOW),
    setTimer: (callback, _delay) => setTimeout(callback, 1_000),
    clearTimer: timer => clearTimeout(timer),
    ...options,
  });
}

test('readiness failure returns a stable summary and never claims or consumes attempts', async () => {
  const repository = fakeRepository({ claimed: [item()] });
  const service = dispatcher({
    repository,
    dingTalkAdapter: {
      readiness: () => ({ ok: false, code: 'DINGTALK_NOT_CONFIGURED' }),
      sendCard: () => { throw new Error('must not send'); },
    },
  });

  assert.deepEqual(await service.dispatchOnce({ workerId: 'WORKER-0001' }), {
    ok: false,
    code: 'DINGTALK_NOT_CONFIGURED',
    claimedCount: 0,
    sentCount: 0,
    retryableFailureCount: 0,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 0,
  });
  assert.equal(repository.calls.claim.length, 0);
  assert.equal(repository.calls.settle.length, 0);
});

test('claims once, sends sequentially outside repository calls, and settles every item', async () => {
  const repository = fakeRepository({ claimed: [item(1), item(2), item(3)] });
  let active = 0;
  let maximumActive = 0;
  const seenCards = [];
  const results = [
    { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-REF-1' },
    { ok: false, code: 'DINGTALK_TIMEOUT' },
    { ok: false, code: 'DINGTALK_REQUEST_REJECTED' },
  ];
  const service = dispatcher({
    repository,
    dingTalkAdapter: {
      readiness: () => ({ ok: true }),
      async sendCard(input) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        seenCards.push(input);
        await Promise.resolve();
        active -= 1;
        return results.shift();
      },
    },
  });

  assert.deepEqual(await service.dispatchOnce({ workerId: 'WORKER-0001' }), {
    ok: true,
    code: 'OUTBOX_DISPATCH_COMPLETED',
    claimedCount: 3,
    sentCount: 1,
    retryableFailureCount: 1,
    nonRetryableFailureCount: 1,
    settlementFailureCount: 0,
  });
  assert.equal(maximumActive, 1);
  assert.deepEqual(repository.calls.claim, [{ workerId: 'WORKER-0001', now: NOW, limit: 8 }]);
  assert.equal(repository.calls.settle.length, 3);
  assert.deepEqual(repository.calls.settle.map(call => call.result.code), [
    'DINGTALK_CARD_SENT', 'DINGTALK_TIMEOUT', 'DINGTALK_REQUEST_REJECTED',
  ]);
  assert.ok(repository.calls.settle.every(call => call.now === NOW));
  assert.deepEqual(Object.keys(seenCards[0]), ['dedupeKey', 'routeKey', 'card']);
});

test('normalizes thrown adapter errors and injected timeout, then settles both', async () => {
  const repository = fakeRepository({ claimed: [item(1), item(2)] });
  let call = 0;
  const timers = [];
  const service = createOutboxDispatcherV1({
    repository,
    dingTalkAdapter: {
      readiness: () => ({ ok: true }),
      sendCard() {
        call += 1;
        if (call === 1) throw new Error('token and raw provider response');
        return new Promise(() => {});
      },
    },
    clock: () => new Date(NOW),
    setTimer(callback, delay) {
      timers.push(delay);
      return setImmediate(callback);
    },
    clearTimer(timer) { clearImmediate(timer); },
  });

  const result = await service.dispatchOnce({ workerId: 'WORKER-0001' });
  assert.deepEqual(result, {
    ok: true,
    code: 'OUTBOX_DISPATCH_COMPLETED',
    claimedCount: 2,
    sentCount: 0,
    retryableFailureCount: 2,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 0,
  });
  assert.deepEqual(repository.calls.settle.map(entry => entry.result), [
    { ok: false, code: 'DINGTALK_TRANSPORT_ERROR' },
    { ok: false, code: 'DINGTALK_TIMEOUT' },
  ]);
  assert.deepEqual(timers, [8_000, 8_000]);
  assert.doesNotMatch(JSON.stringify(result), /token|provider response|OUTBOX-000|RUN-000/iu);
});

test('settlement failure is counted without preventing later settlements or leaking errors', async () => {
  let settleCalls = 0;
  const repository = fakeRepository({
    claimed: [item(1), item(2)],
    settle: async () => {
      settleCalls += 1;
      if (settleCalls === 1) throw new Error('SQL and absolute path /secret/database.sqlite');
      return { ok: true, code: 'OUTBOX_SENT' };
    },
  });
  const service = dispatcher({
    repository,
    dingTalkAdapter: {
      readiness: () => ({ ok: true }),
      sendCard: input => ({
        ok: true, code: 'DINGTALK_CARD_SENT', providerRef: `REF-${input.card.runRevision}`,
      }),
    },
  });

  const result = await service.dispatchOnce({ workerId: 'WORKER-0001' });
  assert.deepEqual(result, {
    ok: false,
    code: 'OUTBOX_SETTLEMENT_INCOMPLETE',
    claimedCount: 2,
    sentCount: 2,
    retryableFailureCount: 0,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 1,
  });
  assert.equal(repository.calls.settle.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret|database|sqlite/iu);
});

test('claim and settlement failure envelopes are handled instead of reported as success', async () => {
  const busyRepository = fakeRepository({
    claimResult: { ok: false, code: 'STORE_BUSY', items: [] },
  });
  const adapter = {
    readiness: () => ({ ok: true }),
    sendCard: () => ({ ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-1' }),
  };
  assert.equal((await dispatcher({
    repository: busyRepository,
    dingTalkAdapter: adapter,
  }).dispatchOnce({ workerId: 'WORKER-0001' })).code, 'OUTBOX_STORE_BUSY');

  const staleRepository = fakeRepository({
    claimed: [item()],
    settle: async () => ({ ok: false, code: 'OUTBOX_LEASE_MISMATCH' }),
  });
  const result = await dispatcher({
    repository: staleRepository,
    dingTalkAdapter: adapter,
  }).dispatchOnce({ workerId: 'WORKER-0001' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OUTBOX_SETTLEMENT_INCOMPLETE');
  assert.equal(result.settlementFailureCount, 1);
});

test('claim busy/error, malformed readiness and invalid worker fail closed with no raw data', async () => {
  const busy = Object.assign(new Error('database path /private'), { code: 'SQLITE_BUSY' });
  const busyRepository = fakeRepository({ claimError: busy });
  const readyAdapter = { readiness: () => ({ ok: true }), sendCard: () => ({}) };
  assert.deepEqual(await dispatcher({
    repository: busyRepository, dingTalkAdapter: readyAdapter,
  }).dispatchOnce({ workerId: 'WORKER-0001' }), {
    ok: false,
    code: 'OUTBOX_STORE_BUSY',
    claimedCount: 0,
    sentCount: 0,
    retryableFailureCount: 0,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 0,
  });

  const malformedRepository = fakeRepository();
  assert.equal((await dispatcher({
    repository: malformedRepository,
    dingTalkAdapter: { readiness: () => ({ ok: true, extra: true }), sendCard: () => ({}) },
  }).dispatchOnce({ workerId: 'WORKER-0001' })).code, 'DINGTALK_ADAPTER_PROTOCOL_ERROR');
  assert.equal(malformedRepository.calls.claim.length, 0);

  const throwingRepository = fakeRepository();
  assert.equal((await dispatcher({
    repository: throwingRepository,
    dingTalkAdapter: {
      readiness: () => { throw new Error('secret readiness state'); },
      sendCard: () => ({}),
    },
  }).dispatchOnce({ workerId: 'WORKER-0001' })).code, 'DINGTALK_TRANSPORT_ERROR');
  assert.equal(throwingRepository.calls.claim.length, 0);

  assert.equal((await dispatcher({
    repository: fakeRepository(), dingTalkAdapter: readyAdapter,
  }).dispatchOnce({ workerId: 'bad\nworker' })).code, 'OUTBOX_INVALID_WORKER');
});

test('empty claim returns an idle summary without send or settlement', async () => {
  const repository = fakeRepository();
  const service = dispatcher({
    repository,
    dingTalkAdapter: {
      readiness: () => ({ ok: true }),
      sendCard: () => { throw new Error('must not send'); },
    },
  });
  assert.deepEqual(await service.dispatchOnce({ workerId: 'WORKER-0001' }), {
    ok: true,
    code: 'OUTBOX_DISPATCH_IDLE',
    claimedCount: 0,
    sentCount: 0,
    retryableFailureCount: 0,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 0,
  });
});

test('real SQLite repository envelope completes enqueue, dispatch and settlement', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    initializeWritableSchema(db, { now: () => new Date(NOW) });
    const repository = createSqliteOutboxRepositoryV1({
      db,
      tokenFactory: () => 'LEASE-INTEGRATION-1',
    });
    const completed = buildProductionRunCompletedCardV1(card());
    const built = buildNotificationIntentV1({
      outboxId: 'O'.repeat(160),
      intentType: 'production-run.completed.v1',
      aggregateType: 'production_run',
      aggregateId: card().runId,
      routeKey: 'shooting-operations',
      aggregateRevisionScope: 'run',
      aggregateRevision: 1,
      cardSchemaVersion: completed.cardSchemaVersion,
      payload: completed.card,
      createdAt: NOW,
    });
    assert.equal(built.ok, true, built.code);
    db.exec('BEGIN IMMEDIATE');
    assert.equal(repository.enqueue(built.intent).ok, true);
    db.exec('COMMIT');

    const service = dispatcher({
      repository,
      dingTalkAdapter: {
        readiness: () => ({ ok: true }),
        sendCard: () => ({
          ok: true,
          code: 'DINGTALK_CARD_SENT',
          providerRef: 'CARD-INTEGRATION-1',
        }),
      },
    });
    assert.equal((await service.dispatchOnce({ workerId: 'WORKER-INTEGRATION-1' })).code,
      'OUTBOX_DISPATCH_COMPLETED');
    const found = repository.getById(built.intent.outboxId);
    assert.equal(found.ok, true);
    assert.equal(found.record.status, 'sent');
    assert.equal(found.record.attemptCount, 1);
  } finally {
    db.close();
  }
});
