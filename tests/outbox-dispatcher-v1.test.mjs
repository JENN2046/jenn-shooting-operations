import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { buildProductionRunCompletedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';
import { buildNotificationIntentV1 } from '../src/outbox-contract-v1.mjs';
import { createOutboxDispatcherV1 } from '../src/outbox-dispatcher-v1.mjs';
import { createOutboxWorkerV1 } from '../src/outbox-worker-v1.mjs';
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

function enqueueCompletion(db, repository, { outboxId, index = 1 } = {}) {
  const completed = buildProductionRunCompletedCardV1(card(index));
  const built = buildNotificationIntentV1({
    outboxId,
    intentType: 'production-run.completed.v1',
    aggregateType: 'production_run',
    aggregateId: card(index).runId,
    routeKey: 'shooting-operations',
    aggregateRevisionScope: 'run',
    aggregateRevision: index,
    cardSchemaVersion: completed.cardSchemaVersion,
    payload: completed.card,
    createdAt: NOW,
  });
  assert.equal(built.ok, true, built.code);
  db.exec('BEGIN IMMEDIATE');
  assert.equal(repository.enqueue(built.intent).ok, true);
  db.exec('COMMIT');
  return built.intent;
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

test('claims once, sends the bounded batch concurrently outside repository calls, and settles every item', async () => {
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
  assert.equal(maximumActive, 3);
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
    sentCount: 1,
    retryableFailureCount: 0,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 1,
  });
  assert.equal(repository.calls.settle.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret|database|sqlite/iu);
});

test('settlement busy retries are bounded, reuse the delivery result, and never resend', async () => {
  const settleResults = [
    Object.assign(new Error('locked database details'), { code: 'SQLITE_BUSY' }),
    { ok: false, code: 'STORE_BUSY' },
    { ok: true, code: 'OUTBOX_SENT' },
  ];
  let sendCount = 0;
  const repository = fakeRepository({
    claimed: [item()],
    settle: async () => {
      const next = settleResults.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  const scheduled = [];
  const service = createOutboxDispatcherV1({
    repository,
    dingTalkAdapter: {
      readiness: () => ({ ok: true }),
      sendCard: () => {
        sendCount += 1;
        return { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-BUSY-1' };
      },
    },
    clock: () => new Date(NOW),
    setTimer(callback, delay) {
      scheduled.push(delay);
      return setImmediate(callback);
    },
    clearTimer(token) { clearImmediate(token); },
  });

  const result = await service.dispatchOnce({ workerId: 'WORKER-0001' });
  assert.equal(result.ok, true);
  assert.equal(result.sentCount, 1);
  assert.equal(result.settlementFailureCount, 0);
  assert.equal(sendCount, 1);
  assert.equal(repository.calls.settle.length, 3);
  assert.ok(repository.calls.settle.every(call => call.leaseToken === item().leaseToken));
  assert.ok(repository.calls.settle.every(call => call.result.providerRef === 'CARD-BUSY-1'));
  assert.deepEqual(scheduled, [8_000, 50, 100]);
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

test('eight worst-latency sends stay within one lease, exclude a second worker, and leave foreground writes unlocked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-outbox-dispatch-batch-'));
  const filename = join(root, 'outbox.sqlite');
  const dbA = new DatabaseSync(filename);
  const dbB = new DatabaseSync(filename);
  let dispatchA;
  const deliveryResolvers = [];
  try {
    dbA.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0;');
    initializeWritableSchema(dbA, { now: () => new Date(NOW) });
    dbB.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0;');
    let tokenA = 0;
    const repositoryA = createSqliteOutboxRepositoryV1({
      db: dbA,
      tokenFactory: () => `LEASE-A-${++tokenA}`,
    });
    const repositoryB = createSqliteOutboxRepositoryV1({
      db: dbB,
      tokenFactory: () => 'LEASE-B-UNEXPECTED',
    });
    dbA.exec('BEGIN IMMEDIATE');
    for (let index = 1; index <= 8; index += 1) {
      const completed = buildProductionRunCompletedCardV1(card(index));
      const built = buildNotificationIntentV1({
        outboxId: `OUTBOX-BATCH-${index}`,
        intentType: 'production-run.completed.v1',
        aggregateType: 'production_run',
        aggregateId: card(index).runId,
        routeKey: 'shooting-operations',
        aggregateRevisionScope: 'run',
        aggregateRevision: index,
        cardSchemaVersion: completed.cardSchemaVersion,
        payload: completed.card,
        createdAt: NOW,
      });
      assert.equal(built.ok, true, built.code);
      assert.equal(repositoryA.enqueue(built.intent).ok, true);
    }
    dbA.exec('COMMIT');

    let currentTime = NOW;
    let startedCount = 0;
    let releaseCleanup = false;
    let resolveAllStarted;
    const allStarted = new Promise(resolve => { resolveAllStarted = resolve; });
    const inertSetTimer = (_callback, delay) => ({ delay });
    const serviceA = createOutboxDispatcherV1({
      repository: repositoryA,
      dingTalkAdapter: {
        readiness: () => ({ ok: true }),
        sendCard() {
          startedCount += 1;
          if (startedCount === 8) resolveAllStarted(true);
          if (releaseCleanup) {
            return { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: `CARD-CLEANUP-${startedCount}` };
          }
          return new Promise(resolve => { deliveryResolvers.push(resolve); });
        },
      },
      clock: () => new Date(currentTime),
      setTimer: inertSetTimer,
      clearTimer: () => {},
    });
    dispatchA = serviceA.dispatchOnce({ workerId: 'WORKER-A' });
    const batchStarted = await Promise.race([
      allStarted,
      new Promise(resolve => setImmediate(() => resolve(false))),
    ]);
    if (!batchStarted) {
      releaseCleanup = true;
      for (const [index, resolve] of deliveryResolvers.entries()) {
        resolve({ ok: true, code: 'DINGTALK_CARD_SENT', providerRef: `CARD-CLEANUP-${index + 1}` });
      }
    }
    assert.equal(batchStarted, true, 'all eight sends must start before the first result settles');

    dbB.exec('BEGIN IMMEDIATE');
    dbB.prepare(`
      INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('foreground.probe', 'dispatcher-test', 'BATCH-8', 0, 'ok', NOW);
    dbB.exec('COMMIT');

    currentTime = new Date(Date.parse(NOW) + 8_000).toISOString();
    let secondWorkerSends = 0;
    const serviceB = createOutboxDispatcherV1({
      repository: repositoryB,
      dingTalkAdapter: {
        readiness: () => ({ ok: true }),
        sendCard() {
          secondWorkerSends += 1;
          return { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-B-UNEXPECTED' };
        },
      },
      clock: () => new Date(currentTime),
      setTimer: inertSetTimer,
      clearTimer: () => {},
    });
    assert.equal((await serviceB.dispatchOnce({ workerId: 'WORKER-B' })).code, 'OUTBOX_DISPATCH_IDLE');
    assert.equal(secondWorkerSends, 0);

    deliveryResolvers.forEach((resolve, index) => resolve({
      ok: true,
      code: 'DINGTALK_CARD_SENT',
      providerRef: `CARD-BATCH-${index + 1}`,
    }));
    const result = await dispatchA;
    assert.equal(result.ok, true);
    assert.equal(result.claimedCount, 8);
    assert.equal(result.sentCount, 8);
    assert.equal(dbA.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE status = 'sent'").get().count, 8);
    assert.equal(dbA.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'foreground.probe'").get().count, 1);
  } finally {
    for (const resolve of deliveryResolvers) {
      resolve({ ok: false, code: 'DINGTALK_TIMEOUT' });
    }
    if (dispatchA) await dispatchA.catch(() => {});
    if (dbB.isTransaction) dbB.exec('ROLLBACK');
    if (dbA.isTransaction) dbA.exec('ROLLBACK');
    dbB.close();
    dbA.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('real SQLite settle busy is bounded, restored, non-overlapping, and never resends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-outbox-dispatch-busy-'));
  const filename = join(root, 'outbox.sqlite');
  const db = new DatabaseSync(filename);
  const holder = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 777;');
    initializeWritableSchema(db, { now: () => new Date(NOW) });
    holder.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0;');
    const sqliteRepository = createSqliteOutboxRepositoryV1({
      db,
      tokenFactory: () => 'LEASE-REAL-BUSY-1',
    });
    const intent = enqueueCompletion(db, sqliteRepository, { outboxId: 'OUTBOX-REAL-BUSY-1' });
    let settleCalls = 0;
    let activeSettles = 0;
    let maximumActiveSettles = 0;
    const repository = {
      claimBatch: input => sqliteRepository.claimBatch(input),
      async settleDelivery(input) {
        settleCalls += 1;
        activeSettles += 1;
        maximumActiveSettles = Math.max(maximumActiveSettles, activeSettles);
        try {
          return sqliteRepository.settleDelivery(input);
        } finally {
          activeSettles -= 1;
        }
      },
    };
    let sendCount = 0;
    const retryDelays = [];
    const service = createOutboxDispatcherV1({
      repository,
      dingTalkAdapter: {
        readiness: () => ({ ok: true }),
        sendCard() {
          sendCount += 1;
          holder.exec('BEGIN IMMEDIATE');
          return { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-REAL-BUSY-1' };
        },
      },
      clock: () => new Date(NOW),
      setTimer(callback, delay) {
        if (delay !== 8_000) retryDelays.push(delay);
        return setImmediate(callback);
      },
      clearTimer: token => clearImmediate(token),
    });

    const startedAt = performance.now();
    const result = await service.dispatchOnce({ workerId: 'WORKER-REAL-BUSY' });
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.code, 'OUTBOX_SETTLEMENT_INCOMPLETE');
    assert.equal(result.sentCount, 0);
    assert.equal(result.settlementFailureCount, 1);
    assert.equal(sendCount, 1);
    assert.equal(settleCalls, 4);
    assert.equal(maximumActiveSettles, 1);
    assert.deepEqual(retryDelays, [50, 100, 200]);
    assert.ok(elapsedMs >= 250, `expected bounded real SQLite waits, got ${elapsedMs}ms`);
    assert.ok(elapsedMs < 2_000, `dispatcher settlement exceeded its bound: ${elapsedMs}ms`);
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 777);
    assert.equal(sqliteRepository.getById(intent.outboxId).record.status, 'leased');
  } finally {
    if (holder.isTransaction) holder.exec('ROLLBACK');
    if (db.isTransaction) db.exec('ROLLBACK');
    holder.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('real dispatcher worker stop waits for bounded settlement and never claims again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-outbox-worker-stop-'));
  const filename = join(root, 'outbox.sqlite');
  const db = new DatabaseSync(filename);
  const holder = new DatabaseSync(filename);
  let worker;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 432;');
    initializeWritableSchema(db, { now: () => new Date(NOW) });
    holder.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0;');
    const sqliteRepository = createSqliteOutboxRepositoryV1({
      db,
      tokenFactory: () => 'LEASE-WORKER-STOP-1',
    });
    const intent = enqueueCompletion(db, sqliteRepository, { outboxId: 'OUTBOX-WORKER-STOP-1' });
    let claimCalls = 0;
    const repository = {
      claimBatch(input) {
        claimCalls += 1;
        return sqliteRepository.claimBatch(input);
      },
      settleDelivery: input => sqliteRepository.settleDelivery(input),
    };
    let resolveSendStarted;
    const sendStarted = new Promise(resolve => { resolveSendStarted = resolve; });
    let resolveDelivery;
    let sendCount = 0;
    const dispatcherService = createOutboxDispatcherV1({
      repository,
      dingTalkAdapter: {
        readiness: () => ({ ok: true }),
        sendCard() {
          sendCount += 1;
          holder.exec('BEGIN IMMEDIATE');
          resolveSendStarted();
          return new Promise(resolve => { resolveDelivery = resolve; });
        },
      },
      clock: () => new Date(NOW),
    });
    worker = createOutboxWorkerV1({ dispatcher: dispatcherService, workerId: 'WORKER-STOP-REAL' });
    assert.equal(worker.start().code, 'OUTBOX_WORKER_STARTED');
    await sendStarted;

    let stopped = false;
    const stopping = worker.stop().then(value => { stopped = true; return value; });
    assert.equal(stopped, false);
    const startedAt = performance.now();
    resolveDelivery({ ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-WORKER-STOP-1' });
    assert.deepEqual(await stopping, { ok: true, code: 'OUTBOX_WORKER_STOPPED' });
    const elapsedMs = performance.now() - startedAt;
    assert.ok(elapsedMs >= 500, `worker did not wait for bounded settle retries: ${elapsedMs}ms`);
    assert.ok(elapsedMs < 3_000, `worker stop exceeded its finite bound: ${elapsedMs}ms`);
    assert.equal(sendCount, 1);
    assert.equal(claimCalls, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(claimCalls, 1);
    assert.deepEqual(worker.status(), {
      code: 'OUTBOX_WORKER_STOPPED', running: false, inFlight: false, scheduled: false, wakePending: false,
    });
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 432);
    assert.equal(sqliteRepository.getById(intent.outboxId).record.status, 'leased');
  } finally {
    if (worker) await worker.stop().catch(() => {});
    if (holder.isTransaction) holder.exec('ROLLBACK');
    if (db.isTransaction) db.exec('ROLLBACK');
    holder.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
