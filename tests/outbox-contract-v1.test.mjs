import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_INTENT_ADMISSION_V1,
  OUTBOX_DISPATCH_POLICY_V1,
  buildNotificationIntentV1,
  canonicalJsonV1,
  compareNotificationIntentV1,
  digestCanonicalJsonV1,
  validateNotificationIntentV1,
} from '../src/outbox-contract-v1.mjs';
import { buildProductionRunCompletedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';

const completedCard = buildProductionRunCompletedCardV1({
  runId: 'RUN-00000001',
  scheduleItemId: 'SCHEDULE-0001',
  resourceId: 'STUDIO-A',
  scope: 'task',
  taskCount: 1,
  completedAt: '2026-09-25T09:00:00.000Z',
  netDurationMs: 3_300_000,
  runRevision: 4,
});

test('canonical JSON is recursive, deterministic and rejects unsafe values', () => {
  assert.equal(canonicalJsonV1({ z: [3, { b: 2, a: 1 }], a: '文' }), '{"a":"文","z":[3,{"a":1,"b":2}]}');
  assert.equal(
    digestCanonicalJsonV1({ b: 2, a: 1 }),
    digestCanonicalJsonV1({ a: 1, b: 2 }),
  );
  assert.match(digestCanonicalJsonV1({ a: 1 }), /^sha256:[a-f0-9]{64}$/u);
  for (const value of [{ a: Number.NaN }, { a: Infinity }, { a: undefined }, [1, , 2], 1n]) {
    assert.throws(() => canonicalJsonV1(value), /CANONICAL_JSON_INVALID/u);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJsonV1(cyclic), /CANONICAL_JSON_INVALID/u);
});

test('freezes the exact outbox-dispatch-v1 policy', () => {
  assert.deepEqual(OUTBOX_DISPATCH_POLICY_V1, {
    policyVersion: 'outbox-dispatch-v1', batchSize: 8, leaseDurationMs: 30_000,
    deliveryTimeoutMs: 8_000, maxAttempts: 5, retryBaseDelayMs: 2_000,
    retryMaxDelayMs: 300_000, retryJitterRatio: 0.25, idlePollMs: 2_000,
    idlePollJitterRatio: 0.25, busyBaseDelayMs: 250, busyMaxDelayMs: 2_000,
    resultBusyTimeoutMs: 100, resultRetryMs: [50, 100, 200],
  });
  assert.equal(Object.isFrozen(OUTBOX_DISPATCH_POLICY_V1), true);
  assert.equal(Object.isFrozen(OUTBOX_DISPATCH_POLICY_V1.resultRetryMs), true);
});

test('request and schedule intent admission remains explicitly NOT_WIRED', () => {
  assert.deepEqual(NOTIFICATION_INTENT_ADMISSION_V1, {
    'request.submitted.v1': { status: 'NOT_WIRED', aggregateRevisionScope: null },
    'schedule.confirmed.v1': { status: 'NOT_WIRED', aggregateRevisionScope: 'schedule' },
    'production-run.completed.v1': { status: 'WIRED', aggregateRevisionScope: 'run' },
  });

  for (const [intentType, aggregateRevisionScope] of [
    ['request.submitted.v1', 'projection'],
    ['schedule.confirmed.v1', 'schedule'],
  ]) {
    const result = buildNotificationIntentV1({
      outboxId: 'OUTBOX-00000001', intentType, aggregateType: 'request', aggregateId: 'ENTITY-0001',
      routeKey: 'shooting-operations', aggregateRevisionScope, aggregateRevision: 1,
      cardSchemaVersion: 'unused-card-v1', payload: {}, createdAt: '2026-09-25T09:00:00.000Z',
    });
    assert.deepEqual(result, { ok: false, code: 'NOTIFICATION_INTENT_NOT_WIRED', intentType });
  }
});

test('builds an exact canonical completion intent and deterministic dedupe key', () => {
  assert.equal(completedCard.ok, true);
  const result = buildNotificationIntentV1({
    outboxId: 'OUTBOX-00000001',
    intentType: 'production-run.completed.v1',
    aggregateType: 'production_run',
    aggregateId: 'RUN-00000001',
    routeKey: 'shooting-operations',
    aggregateRevisionScope: 'run',
    aggregateRevision: 4,
    cardSchemaVersion: completedCard.cardSchemaVersion,
    payload: completedCard.card,
    createdAt: '2026-09-25T09:00:01.000Z',
  });
  assert.equal(result.ok, true, result.code);
  assert.deepEqual(Object.keys(result.intent), [
    'outboxId', 'dedupeKey', 'intentType', 'aggregateType', 'aggregateId', 'routeKey',
    'aggregateRevisionScope', 'aggregateRevision', 'cardSchemaVersion',
    'deliveryPolicyVersion', 'payloadJson', 'payloadDigest', 'createdAt',
  ]);
  assert.equal(result.intent.dedupeKey,
    'dingtalk:production-run-completed-card-v1:production-run.completed.v1:production_run:RUN-00000001:run:4');
  assert.equal(result.intent.payloadJson, canonicalJsonV1(completedCard.card));
  assert.equal(result.intent.payloadDigest, digestCanonicalJsonV1(completedCard.card));
  assert.equal(result.intent.deliveryPolicyVersion, 'outbox-dispatch-v1');
  assert.equal(Object.isFrozen(result.intent), true);
  assert.equal(validateNotificationIntentV1(result.intent).ok, true);
});

test('completion intent rejects unknown keys, wrong scope/card/aggregate and malformed identifiers', () => {
  const base = {
    outboxId: 'OUTBOX-00000001', intentType: 'production-run.completed.v1',
    aggregateType: 'production_run', aggregateId: 'RUN-00000001', routeKey: 'shooting-operations',
    aggregateRevisionScope: 'run', aggregateRevision: 4,
    cardSchemaVersion: completedCard.cardSchemaVersion, payload: completedCard.card,
    createdAt: '2026-09-25T09:00:01.000Z',
  };
  for (const input of [
    { ...base, extra: true },
    { ...base, aggregateRevisionScope: 'schedule' },
    { ...base, aggregateType: 'request' },
    { ...base, cardSchemaVersion: 'request-submitted-card-v1' },
    { ...base, routeKey: 'bad\nroute' },
    { ...base, aggregateRevision: -1 },
  ]) assert.equal(buildNotificationIntentV1(input).code, 'NOTIFICATION_INTENT_INVALID');
});

test('intent comparison distinguishes exact no-op from a dedupe mismatch', () => {
  const built = buildNotificationIntentV1({
    outboxId: 'OUTBOX-00000001', intentType: 'production-run.completed.v1',
    aggregateType: 'production_run', aggregateId: 'RUN-00000001', routeKey: 'shooting-operations',
    aggregateRevisionScope: 'run', aggregateRevision: 4,
    cardSchemaVersion: completedCard.cardSchemaVersion, payload: completedCard.card,
    createdAt: '2026-09-25T09:00:01.000Z',
  }).intent;
  assert.deepEqual(compareNotificationIntentV1(built, { ...built, outboxId: 'OUTBOX-OTHER' }), {
    ok: true, code: 'OUTBOX_EXACT_NOOP', outboxId: 'OUTBOX-00000001',
  });
  assert.deepEqual(compareNotificationIntentV1(built, { ...built, routeKey: 'other-route' }), {
    ok: false, code: 'OUTBOX_DEDUPE_MISMATCH',
  });
  assert.deepEqual(compareNotificationIntentV1(built, { ...built, payloadDigest: `sha256:${'0'.repeat(64)}` }), {
    ok: false, code: 'OUTBOX_DEDUPE_MISMATCH',
  });
});

test('builder and validator preserve canonical 160-character aggregate identifiers', () => {
  const runId = 'R'.repeat(160);
  const card = buildProductionRunCompletedCardV1({
    runId,
    scheduleItemId: 'SCHEDULE-0001',
    resourceId: 'STUDIO-A',
    scope: 'task',
    taskCount: 1,
    completedAt: '2026-09-25T09:00:00.000Z',
    netDurationMs: 1,
    runRevision: 4,
  });
  assert.equal(card.ok, true);
  const built = buildNotificationIntentV1({
    outboxId: 'O'.repeat(160),
    intentType: 'production-run.completed.v1',
    aggregateType: 'production_run',
    aggregateId: runId,
    routeKey: 'shooting-operations',
    aggregateRevisionScope: 'run',
    aggregateRevision: 4,
    cardSchemaVersion: card.cardSchemaVersion,
    payload: card.card,
    createdAt: '2026-09-25T09:00:01.000Z',
  });
  assert.equal(built.ok, true, built.code);
  assert.ok([...built.intent.dedupeKey].length > 160);
  assert.equal(validateNotificationIntentV1(built.intent).ok, true);
});

test('built intent validation requires canonical payload, exact dedupe and UTC toISOString time', () => {
  const input = {
    outboxId: 'OUTBOX-00000001', intentType: 'production-run.completed.v1',
    aggregateType: 'production_run', aggregateId: 'RUN-00000001', routeKey: 'shooting-operations',
    aggregateRevisionScope: 'run', aggregateRevision: 4,
    cardSchemaVersion: completedCard.cardSchemaVersion, payload: completedCard.card,
    createdAt: '2026-09-25T09:00:01.000Z',
  };
  const built = buildNotificationIntentV1(input).intent;
  for (const candidate of [
    { ...built, payloadJson: JSON.stringify({ ...completedCard.card, extra: true }) },
    { ...built, payloadDigest: `sha256:${'0'.repeat(64)}` },
    { ...built, dedupeKey: `${built.dedupeKey}:changed` },
    { ...built, createdAt: '2026-09-25T17:00:01.000+08:00' },
  ]) assert.deepEqual(validateNotificationIntentV1(candidate), {
    ok: false, code: 'NOTIFICATION_INTENT_INVALID',
  });
  assert.deepEqual(buildNotificationIntentV1({
    ...input, createdAt: '2026-09-25T17:00:01.000+08:00',
  }), { ok: false, code: 'NOTIFICATION_INTENT_INVALID' });
});
