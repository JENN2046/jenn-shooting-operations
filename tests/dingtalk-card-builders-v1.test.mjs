import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DINGTALK_CARD_SCHEMA_V1,
  buildProductionRunCompletedCardV1,
  buildRequestSubmittedCardV1,
  buildScheduleConfirmedCardV1,
  validateDingTalkCardV1,
} from '../src/dingtalk-card-builders-v1.mjs';

test('builds the three frozen minimal-disclosure cards with exact fields', () => {
  const request = buildRequestSubmittedCardV1({
    requestId: 'REQUEST-0001',
    priority: 'p1',
    productionType: '平面',
    desiredDate: '2026-09-25',
  });
  assert.deepEqual(request, {
    ok: true,
    cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.requestSubmitted,
    card: {
      requestId: 'REQUEST-0001',
      priority: 'p1',
      productionType: '平面',
      desiredDate: '2026-09-25',
    },
  });

  const schedule = buildScheduleConfirmedCardV1({
    scheduleItemId: 'SCHEDULE-0001',
    resourceId: 'STUDIO-A',
    plannedStart: '2026-09-25T08:00:00.000Z',
    plannedEnd: '2026-09-25T09:00:00.000Z',
    taskCount: 2,
    scheduleRevision: 7,
  });
  assert.equal(schedule.ok, true);
  assert.deepEqual(Object.keys(schedule.card), [
    'scheduleItemId', 'resourceId', 'plannedStart', 'plannedEnd', 'taskCount', 'scheduleRevision',
  ]);

  const completed = buildProductionRunCompletedCardV1({
    runId: 'RUN-00000001',
    scheduleItemId: 'SCHEDULE-0001',
    resourceId: 'STUDIO-A',
    scope: 'task',
    taskCount: 1,
    completedAt: '2026-09-25T09:00:00.000Z',
    netDurationMs: 3_300_000,
    runRevision: 4,
  });
  assert.equal(completed.ok, true);
  assert.equal(Object.isFrozen(completed.card), true);
  assert.deepEqual(validateDingTalkCardV1(completed.card), {
    ok: true,
    cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.productionRunCompleted,
  });
});

test('card builders reject unknown or sensitive fields instead of silently projecting them', () => {
  for (const extra of [
    { requestedBy: 'PERSON' },
    { note: 'secret detail' },
    { briefUrl: 'https://example.invalid/private?token=x' },
    { attachmentName: 'private.png' },
  ]) {
    const result = buildRequestSubmittedCardV1({
      requestId: 'REQUEST-0001',
      priority: 'p1',
      productionType: '平面',
      desiredDate: '2026-09-25',
      ...extra,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DINGTALK_CARD_INVALID');
  }
});

test('card builders fail closed on invalid identifiers, dates, times, counters and scopes', () => {
  assert.equal(buildRequestSubmittedCardV1({
    requestId: 'REQUEST\n0001', priority: 'p1', productionType: '平面', desiredDate: '2026-09-25',
  }).code, 'DINGTALK_CARD_INVALID');
  assert.equal(buildRequestSubmittedCardV1({
    requestId: 'REQUEST-0001', priority: 'p3', productionType: '平面', desiredDate: '2026-09-25',
  }).code, 'DINGTALK_CARD_INVALID');
  assert.equal(buildRequestSubmittedCardV1({
    requestId: 'REQUEST-0001', priority: 'p1', productionType: '平面', desiredDate: '2026-02-30',
  }).code, 'DINGTALK_CARD_INVALID');

  assert.equal(buildScheduleConfirmedCardV1({
    scheduleItemId: 'SCHEDULE-0001', resourceId: 'STUDIO-A',
    plannedStart: '2026-09-25T09:00:00.000Z', plannedEnd: '2026-09-25T08:00:00.000Z',
    taskCount: 2, scheduleRevision: 7,
  }).code, 'DINGTALK_CARD_INVALID');

  assert.equal(buildProductionRunCompletedCardV1({
    runId: 'RUN-00000001', scheduleItemId: 'SCHEDULE-0001', resourceId: 'STUDIO-A',
    scope: 'task', taskCount: 2, completedAt: '2026-09-25T09:00:00.000Z',
    netDurationMs: 1, runRevision: 1,
  }).code, 'DINGTALK_CARD_INVALID');
  assert.equal(buildProductionRunCompletedCardV1({
    runId: 'RUN-00000001', scheduleItemId: 'SCHEDULE-0001', resourceId: 'STUDIO-A',
    scope: 'block', taskCount: 1, completedAt: '2026-09-25T09:00:00.000Z',
    netDurationMs: -1, runRevision: 1,
  }).code, 'DINGTALK_CARD_INVALID');
});

test('card validator rejects truncated, extended and non-card objects', () => {
  assert.equal(validateDingTalkCardV1(null).ok, false);
  assert.equal(validateDingTalkCardV1({ requestId: 'REQUEST-0001' }).ok, false);
  assert.equal(validateDingTalkCardV1({
    requestId: 'REQUEST-0001', priority: 'p1', productionType: '平面',
    desiredDate: '2026-09-25', rawProviderResponse: 'forbidden',
  }).ok, false);
});

test('card identifiers preserve the canonical 160-code-point boundary', () => {
  const base = {
    scheduleItemId: 'SCHEDULE-0001',
    resourceId: 'STUDIO-A',
    scope: 'task',
    taskCount: 1,
    completedAt: '2026-09-25T09:00:00.000Z',
    netDurationMs: 1,
    runRevision: 1,
  };
  assert.equal(buildProductionRunCompletedCardV1({ ...base, runId: 'R'.repeat(160) }).ok, true);
  assert.equal(buildProductionRunCompletedCardV1({ ...base, runId: 'R'.repeat(161) }).ok, false);
});

test('exact-key validation is independent of JSON object key order', () => {
  assert.deepEqual(validateDingTalkCardV1({
    desiredDate: '2026-09-25',
    productionType: '平面',
    priority: 'p1',
    requestId: 'REQUEST-0001',
  }), {
    ok: true,
    cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.requestSubmitted,
  });
});
