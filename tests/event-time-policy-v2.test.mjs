import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS,
  KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS,
  KIOSK_EVENT_TIME_POLICY,
  KIOSK_EVENT_TIME_POLICY_VERSION,
  evaluateKioskEventTime,
} from '../src/event-time-policy-v2.mjs';

const RECEIVED_AT = '2026-09-22T12:00:00.000Z';

function isoAt(deltaMs) {
  return new Date(Date.parse(RECEIVED_AT) + deltaMs).toISOString();
}

test('local-v1 policy exposes frozen five-minute and twenty-four-hour bounds', () => {
  assert.equal(KIOSK_EVENT_TIME_POLICY_VERSION, 'kiosk-event-time-local-v1');
  assert.equal(KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS, 5 * 60 * 1000);
  assert.equal(KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS, 24 * 60 * 60 * 1000);
  assert.deepEqual(KIOSK_EVENT_TIME_POLICY, {
    policyVersion: 'kiosk-event-time-local-v1',
    maximumFutureSkewMs: 5 * 60 * 1000,
    maximumOfflineAgeMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(Object.isFrozen(KIOSK_EVENT_TIME_POLICY), true);
});

test('equal time and both exact policy boundaries are allowed inclusively', () => {
  for (const occurredAt of [
    RECEIVED_AT,
    isoAt(KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS),
    isoAt(-KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS),
  ]) {
    assert.deepEqual(evaluateKioskEventTime({ occurredAt, receivedAt: RECEIVED_AT }), {
      ok: true,
      decision: 'allow',
      policyVersion: 'kiosk-event-time-local-v1',
    });
  }
});

test('one millisecond beyond either boundary requires review with a stable reason', () => {
  assert.deepEqual(evaluateKioskEventTime({
    occurredAt: isoAt(KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS + 1),
    receivedAt: RECEIVED_AT,
  }), {
    ok: false,
    code: 'EVENT_TIME_REVIEW_REQUIRED',
    reviewReason: 'tooFarFuture',
    policyVersion: 'kiosk-event-time-local-v1',
  });
  assert.deepEqual(evaluateKioskEventTime({
    occurredAt: isoAt(-KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS - 1),
    receivedAt: RECEIVED_AT,
  }), {
    ok: false,
    code: 'EVENT_TIME_REVIEW_REQUIRED',
    reviewReason: 'tooOld',
    policyVersion: 'kiosk-event-time-local-v1',
  });
});

test('offset timestamps are compared as instants without rewriting the input', () => {
  const input = {
    occurredAt: '2026-09-22T20:04:59.999+08:00',
    receivedAt: '2026-09-22T08:00:00.000-04:00',
  };
  const before = structuredClone(input);
  assert.equal(evaluateKioskEventTime(input).decision, 'allow');
  assert.deepEqual(input, before);
});

test('invalid occurredAt fails with a stable code and field without consulting a clock', () => {
  for (const occurredAt of [
    undefined,
    null,
    new Date(RECEIVED_AT),
    '',
    'not-a-time',
    '2026-02-29T12:00:00Z',
    '2026-09-22T24:00:00Z',
    '2026-09-22T12:00:00',
  ]) {
    assert.deepEqual(evaluateKioskEventTime({ occurredAt, receivedAt: RECEIVED_AT }), {
      ok: false,
      code: 'INVALID_EVENT_TIME',
      field: 'occurredAt',
      policyVersion: 'kiosk-event-time-local-v1',
    });
  }
});

test('invalid receivedAt fails with a distinct stable code and field', () => {
  for (const receivedAt of [undefined, null, '', '2026-02-30T12:00:00Z']) {
    assert.deepEqual(evaluateKioskEventTime({ occurredAt: RECEIVED_AT, receivedAt }), {
      ok: false,
      code: 'INVALID_RECEIVED_TIME',
      field: 'receivedAt',
      policyVersion: 'kiosk-event-time-local-v1',
    });
  }
  assert.deepEqual(evaluateKioskEventTime(), {
    ok: false,
    code: 'INVALID_EVENT_TIME',
    field: 'occurredAt',
    policyVersion: 'kiosk-event-time-local-v1',
  });
});
