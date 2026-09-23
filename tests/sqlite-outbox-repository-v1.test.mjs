import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { buildProductionRunCompletedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';
import {
  buildNotificationIntentV1,
  digestCanonicalJsonV1,
} from '../src/outbox-contract-v1.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';

const CREATED_AT = '2026-09-25T09:00:01.000Z';

function openDatabase(filename = ':memory:', { initialize = true, busyTimeout = 0 } = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeout};`);
  if (initialize) {
    initializeWritableSchema(db, { now: () => new Date(CREATED_AT) });
  }
  return db;
}

function buildIntent({
  outboxId = 'OUTBOX-0001',
  aggregateId = 'RUN-0001',
  aggregateRevision = 1,
  routeKey = 'operations.default',
  createdAt = CREATED_AT,
} = {}) {
  const card = buildProductionRunCompletedCardV1({
    runId: aggregateId,
    scheduleItemId: 'SCHEDULE-0001',
    resourceId: 'STUDIO-A',
    scope: 'task',
    taskCount: 1,
    completedAt: '2026-09-25T09:00:00.000Z',
    netDurationMs: 3_300_000,
    runRevision: aggregateRevision,
  });
  assert.equal(card.ok, true, card.code);
  const built = buildNotificationIntentV1({
    outboxId,
    intentType: 'production-run.completed.v1',
    aggregateType: 'production_run',
    aggregateId,
    routeKey,
    aggregateRevisionScope: 'run',
    aggregateRevision,
    cardSchemaVersion: card.cardSchemaVersion,
    payload: card.card,
    createdAt,
  });
  assert.equal(built.ok, true, built.code);
  return built.intent;
}

function enqueueCommitted(db, repository, intent) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = repository.enqueue(intent);
    if (!result.ok) {
      db.exec('ROLLBACK');
      return result;
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function plusMilliseconds(timestamp, milliseconds) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

test('enqueue joins the caller transaction and enforces exact no-op, mismatch and id reuse', () => {
  const db = openDatabase();
  try {
    const repository = createSqliteOutboxRepositoryV1({ db });
    const intent = buildIntent();
    assert.deepEqual(repository.enqueue(intent), {
      ok: false,
      code: 'OUTBOX_TRANSACTION_REQUIRED',
    });

    assert.deepEqual(enqueueCommitted(db, repository, intent), {
      ok: true,
      code: 'OUTBOX_ENQUEUED',
      outboxId: intent.outboxId,
      status: 'pending',
    });

    db.exec('BEGIN IMMEDIATE');
    assert.deepEqual(repository.enqueue({ ...intent, outboxId: 'OUTBOX-NOOP' }), {
      ok: true,
      code: 'OUTBOX_EXACT_NOOP',
      outboxId: intent.outboxId,
      status: 'pending',
    });
    assert.deepEqual(repository.enqueue({ ...intent, routeKey: 'operations.changed' }), {
      ok: false,
      code: 'OUTBOX_DEDUPE_MISMATCH',
    });
    assert.deepEqual(repository.enqueue(buildIntent({
      outboxId: intent.outboxId,
      aggregateId: 'RUN-0002',
      aggregateRevision: 2,
    })), {
      ok: false,
      code: 'OUTBOX_ID_REUSE',
    });
    db.exec('ROLLBACK');

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 1);
  } finally {
    db.close();
  }
});

test('160-code-point outbox id completes enqueue, claim and receipt-sealed settlement', () => {
  const db = openDatabase();
  try {
    const outboxId = 'O'.repeat(160);
    const intent = buildIntent({ outboxId });
    const repository = createSqliteOutboxRepositoryV1({
      db,
      tokenFactory: () => 'LEASE-ROUNDTRIP-1',
    });
    assert.equal(enqueueCommitted(db, repository, intent).ok, true);
    const claimed = repository.claimBatch({
      workerId: 'worker-roundtrip',
      now: CREATED_AT,
      limit: 1,
    });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.code, 'OUTBOX_CLAIMED');
    assert.equal(claimed.items.length, 1);
    assert.equal(claimed.items[0].outboxId, outboxId);
    assert.equal(claimed.items[0].attemptCount, 1);

    const sentAt = '2026-09-25T09:00:02.000Z';
    const settled = repository.settleDelivery({
      outboxId,
      leaseToken: claimed.items[0].leaseToken,
      result: { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'dt:card/ROUNDTRIP-1' },
      now: sentAt,
    });
    const expectedReceipt = digestCanonicalJsonV1({
      outboxId,
      dedupeKey: intent.dedupeKey,
      payloadDigest: intent.payloadDigest,
      attemptCount: 1,
      providerRef: 'dt:card/ROUNDTRIP-1',
      sentAt,
    });
    assert.deepEqual(settled, {
      ok: true,
      code: 'OUTBOX_SENT',
      outboxId,
      status: 'sent',
      attemptCount: 1,
      providerRef: 'dt:card/ROUNDTRIP-1',
      deliveryReceiptDigest: expectedReceipt,
    });
    const found = repository.getById(outboxId);
    assert.equal(found.ok, true);
    assert.equal(found.record.status, 'sent');
    assert.equal(found.record.deliveryReceiptDigest, expectedReceipt);
    assert.equal(found.record.leaseToken, null);
    assert.equal(Object.isFrozen(found.record), true);
  } finally {
    db.close();
  }
});

test('two connections exclude duplicate claims and recover an expired lease with a new token', () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-outbox-repository-'));
  const filename = join(root, 'outbox.sqlite');
  const dbA = openDatabase(filename);
  const dbB = openDatabase(filename, { initialize: false });
  try {
    const repoA = createSqliteOutboxRepositoryV1({ db: dbA, tokenFactory: () => 'LEASE-A' });
    const repoB = createSqliteOutboxRepositoryV1({ db: dbB, tokenFactory: () => 'LEASE-B' });
    const intent = buildIntent();
    assert.equal(enqueueCommitted(dbA, repoA, intent).ok, true);

    const first = repoA.claimBatch({ workerId: 'worker-a', now: CREATED_AT, limit: 1 });
    assert.equal(first.ok, true);
    assert.deepEqual(first.items.map(item => item.leaseToken), ['LEASE-A']);
    const contended = repoB.claimBatch({ workerId: 'worker-b', now: CREATED_AT, limit: 1 });
    assert.deepEqual(contended, {
      ok: true,
      code: 'OUTBOX_CLAIMED',
      items: [],
      expiredDeadLettered: 0,
    });

    const recoveredAt = plusMilliseconds(CREATED_AT, 30_001);
    const recovered = repoB.claimBatch({ workerId: 'worker-b', now: recoveredAt, limit: 1 });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.items[0].leaseToken, 'LEASE-B');
    assert.equal(recovered.items[0].attemptCount, 2);
    assert.deepEqual(repoA.settleDelivery({
      outboxId: intent.outboxId,
      leaseToken: 'LEASE-A',
      result: { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'dt:stale' },
      now: plusMilliseconds(recoveredAt, 1),
    }), { ok: false, code: 'OUTBOX_LEASE_MISMATCH' });
    assert.equal(repoB.settleDelivery({
      outboxId: intent.outboxId,
      leaseToken: 'LEASE-B',
      result: { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'dt:fresh' },
      now: plusMilliseconds(recoveredAt, 1),
    }).code, 'OUTBOX_SENT');
  } finally {
    dbB.close();
    dbA.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('retryable delivery uses bounded attempts and the fifth failure dead-letters directly', () => {
  const db = openDatabase();
  try {
    let token = 0;
    const repository = createSqliteOutboxRepositoryV1({
      db,
      tokenFactory: () => `LEASE-${++token}`,
      random: () => 0,
    });
    const intent = buildIntent();
    assert.equal(enqueueCommitted(db, repository, intent).ok, true);

    let claimAt = CREATED_AT;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = repository.claimBatch({ workerId: 'worker-retry', now: claimAt, limit: 1 });
      assert.equal(claimed.ok, true);
      assert.equal(claimed.items[0].attemptCount, attempt);
      const settledAt = plusMilliseconds(claimAt, 1);
      const settled = repository.settleDelivery({
        outboxId: intent.outboxId,
        leaseToken: claimed.items[0].leaseToken,
        result: { ok: false, code: 'DINGTALK_TIMEOUT' },
        now: settledAt,
      });
      if (attempt < 5) {
        assert.equal(settled.code, 'OUTBOX_RETRY_SCHEDULED');
        assert.equal(settled.attemptCount, attempt);
        claimAt = settled.availableAt;
      } else {
        assert.deepEqual(settled, {
          ok: true,
          code: 'OUTBOX_DEAD_LETTERED',
          outboxId: intent.outboxId,
          status: 'deadLetter',
          attemptCount: 5,
          lastErrorCode: 'DINGTALK_TIMEOUT',
        });
      }
    }
    const found = repository.getById(intent.outboxId);
    assert.equal(found.record.status, 'deadLetter');
    assert.equal(found.record.attemptCount, 5);
  } finally {
    db.close();
  }
});

test('an expired fifth lease becomes outcome-unknown instead of being delivered a sixth time', () => {
  const db = openDatabase();
  try {
    let token = 0;
    const repository = createSqliteOutboxRepositoryV1({
      db,
      tokenFactory: () => `LEASE-FINAL-${++token}`,
      random: () => 0,
    });
    const intent = buildIntent();
    assert.equal(enqueueCommitted(db, repository, intent).ok, true);

    let claimAt = CREATED_AT;
    let fifth;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = repository.claimBatch({ workerId: 'worker-expiry', now: claimAt, limit: 1 });
      assert.equal(claimed.items[0].attemptCount, attempt);
      if (attempt === 5) {
        fifth = claimed.items[0];
        break;
      }
      const settled = repository.settleDelivery({
        outboxId: intent.outboxId,
        leaseToken: claimed.items[0].leaseToken,
        result: { ok: false, code: 'DINGTALK_TIMEOUT' },
        now: plusMilliseconds(claimAt, 1),
      });
      claimAt = settled.availableAt;
    }
    const recovered = repository.claimBatch({
      workerId: 'worker-expiry-recovery',
      now: plusMilliseconds(claimAt, 30_001),
      limit: 1,
    });
    assert.deepEqual(recovered, {
      ok: true,
      code: 'OUTBOX_CLAIMED',
      items: [],
      expiredDeadLettered: 1,
    });
    const found = repository.getById(intent.outboxId);
    assert.equal(found.record.status, 'deadLetter');
    assert.equal(found.record.attemptCount, 5);
    assert.equal(found.record.lastErrorCode, 'OUTBOX_DELIVERY_OUTCOME_UNKNOWN');
    assert.deepEqual(repository.settleDelivery({
      outboxId: intent.outboxId,
      leaseToken: fifth.leaseToken,
      result: { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'dt:late' },
      now: plusMilliseconds(claimAt, 30_002),
    }), { ok: false, code: 'OUTBOX_LEASE_MISMATCH' });
  } finally {
    db.close();
  }
});

test('claim and settle reject non-UTC times, and busy results are stable and low-disclosure', () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-outbox-busy-'));
  const filename = join(root, 'outbox.sqlite');
  const holder = openDatabase(filename);
  const contender = openDatabase(filename, { initialize: false, busyTimeout: 0 });
  try {
    const holderRepo = createSqliteOutboxRepositoryV1({ db: holder });
    const contenderRepo = createSqliteOutboxRepositoryV1({ db: contender });
    const intent = buildIntent();
    assert.equal(enqueueCommitted(holder, holderRepo, intent).ok, true);

    assert.deepEqual(contenderRepo.claimBatch({
      workerId: 'worker-busy',
      now: '2026-09-25T17:00:01.000+08:00',
      limit: 1,
    }), { ok: false, code: 'OUTBOX_CLAIM_INVALID', items: [] });
    assert.deepEqual(contenderRepo.settleDelivery({
      outboxId: intent.outboxId,
      leaseToken: 'LEASE-1',
      result: { ok: false, code: 'DINGTALK_TIMEOUT' },
      now: '2026-09-25T17:00:01.000+08:00',
    }), { ok: false, code: 'OUTBOX_SETTLE_INVALID' });

    holder.exec('BEGIN IMMEDIATE');
    const busy = contenderRepo.claimBatch({ workerId: 'worker-busy', now: CREATED_AT, limit: 1 });
    assert.deepEqual(busy, { ok: false, code: 'STORE_BUSY', items: [] });
    assert.deepEqual(Object.keys(busy), ['ok', 'code', 'items']);
    assert.deepEqual(contenderRepo.settleDelivery({
      outboxId: intent.outboxId,
      leaseToken: 'LEASE-1',
      result: { ok: false, code: 'DINGTALK_TIMEOUT' },
      now: CREATED_AT,
    }), { ok: false, code: 'STORE_BUSY' });
    holder.exec('ROLLBACK');
  } finally {
    if (holder.isTransaction) holder.exec('ROLLBACK');
    contender.close();
    holder.close();
    rmSync(root, { recursive: true, force: true });
  }
});
