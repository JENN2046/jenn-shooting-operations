import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDingTalkFailureV1,
  createMockDingTalkAdapterV1,
  createUnconfiguredDingTalkAdapterV1,
  normalizeDingTalkResultV1,
} from '../src/dingtalk-port-v1.mjs';
import { buildProductionRunCompletedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';

const card = buildProductionRunCompletedCardV1({
  runId: 'RUN-00000001', scheduleItemId: 'SCHEDULE-0001', resourceId: 'STUDIO-A',
  scope: 'task', taskCount: 1, completedAt: '2026-09-25T09:00:00.000Z',
  netDurationMs: 3_300_000, runRevision: 4,
}).card;
const sendInput = {
  dedupeKey: 'dingtalk:card:intent:aggregate:id:run:4',
  routeKey: 'shooting-operations',
  card,
};

test('unconfigured adapter is exact, deterministic and fail closed without network', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  try {
    const adapter = createUnconfiguredDingTalkAdapterV1();
    assert.deepEqual(adapter.readiness(), { ok: false, code: 'DINGTALK_NOT_CONFIGURED' });
    assert.deepEqual(await adapter.sendCard(sendInput), { ok: false, code: 'DINGTALK_NOT_CONFIGURED' });
    assert.deepEqual(await adapter.updateCard({ ...sendInput, providerRef: 'CARD-REF-1' }), {
      ok: false, code: 'DINGTALK_NOT_CONFIGURED',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mock must be explicitly injected and normalizes exact success results', async () => {
  assert.throws(() => createMockDingTalkAdapterV1(), /explicit sendCard handler/u);
  const calls = [];
  const adapter = createMockDingTalkAdapterV1({
    sendCard: input => { calls.push(input); return { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-REF-1' }; },
    updateCard: () => ({ ok: true, code: 'DINGTALK_CARD_UPDATED', providerRef: 'CARD-REF-1' }),
  });
  assert.deepEqual(adapter.readiness(), { ok: true });
  assert.deepEqual(await adapter.sendCard(sendInput), {
    ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-REF-1',
  });
  assert.equal(Object.isFrozen(calls[0]), true);
  assert.deepEqual(await adapter.updateCard({ ...sendInput, providerRef: 'CARD-REF-1' }), {
    ok: true, code: 'DINGTALK_CARD_UPDATED', providerRef: 'CARD-REF-1',
  });
});

test('result normalization rejects unknown, extended, truncated and operation-mismatched results', () => {
  for (const raw of [
    null,
    { ok: true, code: 'DINGTALK_CARD_SENT' },
    { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD-REF-1', raw: 'forbidden' },
    { ok: true, code: 'DINGTALK_CARD_UPDATED', providerRef: 'CARD-REF-1' },
    { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: '卡片-1' },
    { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'CARD REF 1' },
    { ok: true, code: 'DINGTALK_CARD_SENT', providerRef: 'A'.repeat(257) },
    { ok: false, code: 'UNKNOWN' },
    { ok: false, code: 'DINGTALK_TIMEOUT', message: 'secret' },
    { ok: false, code: 'DINGTALK_TIMEOUT', retryAfterMs: 10 },
    { ok: false, code: 'DINGTALK_RATE_LIMITED', retryAfterMs: 300_001 },
  ]) {
    assert.deepEqual(normalizeDingTalkResultV1(raw, { operation: 'sendCard' }), {
      ok: false, code: 'DINGTALK_ADAPTER_PROTOCOL_ERROR',
    });
  }
  assert.deepEqual(normalizeDingTalkResultV1({
    ok: false, code: 'DINGTALK_RATE_LIMITED', retryAfterMs: 30_000,
  }, { operation: 'sendCard' }), {
    ok: false, code: 'DINGTALK_RATE_LIMITED', retryAfterMs: 30_000,
  });
  assert.deepEqual(normalizeDingTalkResultV1({
    ok: false, code: 'DINGTALK_RATE_LIMITED',
  }, { operation: 'sendCard' }), {
    ok: false, code: 'DINGTALK_RATE_LIMITED',
  });
});

test('failure classification is fixed by the application contract', () => {
  for (const code of [
    'DINGTALK_TIMEOUT', 'DINGTALK_RATE_LIMITED', 'DINGTALK_UNAVAILABLE', 'DINGTALK_TRANSPORT_ERROR',
  ]) assert.deepEqual(classifyDingTalkFailureV1(code), { known: true, retryable: true });
  for (const code of [
    'DINGTALK_NOT_CONFIGURED', 'DINGTALK_AUTH_REJECTED', 'DINGTALK_REQUEST_REJECTED',
    'DINGTALK_RESPONSE_INVALID', 'DINGTALK_ADAPTER_PROTOCOL_ERROR',
  ]) assert.deepEqual(classifyDingTalkFailureV1(code), { known: true, retryable: false });
  assert.deepEqual(classifyDingTalkFailureV1('UNKNOWN'), { known: false, retryable: false });
});

test('mock converts thrown exceptions and invalid input without leaking causes', async () => {
  const adapter = createMockDingTalkAdapterV1({
    sendCard: () => { throw new Error('secret token and raw response'); },
    updateCard: () => { throw new Error('secret'); },
  });
  assert.deepEqual(await adapter.sendCard(sendInput), { ok: false, code: 'DINGTALK_TRANSPORT_ERROR' });
  assert.deepEqual(await adapter.sendCard({ ...sendInput, routeKey: 'bad\nroute' }), {
    ok: false, code: 'DINGTALK_REQUEST_REJECTED',
  });
  assert.deepEqual(await adapter.updateCard({ ...sendInput, providerRef: 'bad\nref' }), {
    ok: false, code: 'DINGTALK_REQUEST_REJECTED',
  });
});
