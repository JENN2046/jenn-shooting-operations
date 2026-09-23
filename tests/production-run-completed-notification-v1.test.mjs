import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCTION_RUN_COMPLETED_ROUTE_KEY_V1,
  buildProductionRunCompletedNotificationV1,
} from '../src/production-run-completed-notification-v1.mjs';

const TASK_INPUT = Object.freeze({
  eventId: 'EVENT-COMPLETE-0001',
  runId: 'RUN-0001',
  scheduleItemId: 'SCHEDULE-0001',
  resourceId: 'STUDIO-A',
  scope: 'task',
  taskCount: 1,
  completedAt: '2026-09-25T09:00:00.000Z',
  netDurationMs: 3_300_000,
  runRevision: 4,
  createdAt: '2026-09-25T09:00:01.000Z',
});
test('builds the admitted completion intent with event id identity and default route', () => {
  const result = buildProductionRunCompletedNotificationV1(TASK_INPUT);
  assert.equal(result.ok, true, result.code);
  assert.equal(result.intent.outboxId, TASK_INPUT.eventId);
  assert.equal(result.intent.aggregateId, TASK_INPUT.runId);
  assert.equal(result.intent.aggregateRevision, TASK_INPUT.runRevision);
  assert.equal(result.intent.aggregateRevisionScope, 'run');
  assert.equal(result.intent.routeKey, PRODUCTION_RUN_COMPLETED_ROUTE_KEY_V1);
  assert.equal(result.intent.createdAt, TASK_INPUT.createdAt);
  assert.deepEqual(JSON.parse(result.intent.payloadJson), {
    completedAt: TASK_INPUT.completedAt,
    netDurationMs: TASK_INPUT.netDurationMs,
    resourceId: TASK_INPUT.resourceId,
    runId: TASK_INPUT.runId,
    runRevision: TASK_INPUT.runRevision,
    scheduleItemId: TASK_INPUT.scheduleItemId,
    scope: 'task',
    taskCount: 1,
  });
});

test('grouped completion is represented only as block scope and aggregate task count', () => {
  const result = buildProductionRunCompletedNotificationV1({
    ...TASK_INPUT,
    eventId: 'EVENT-COMPLETE-GROUP',
    runId: 'RUN-GROUP',
    scope: 'block',
    taskCount: 2,
  });
  assert.equal(result.ok, true, result.code);
  const card = JSON.parse(result.intent.payloadJson);
  assert.equal(card.scope, 'block');
  assert.equal(card.taskCount, 2);
  assert.deepEqual(Object.keys(card).toSorted(), [
    'completedAt', 'netDurationMs', 'resourceId', 'runId',
    'runRevision', 'scheduleItemId', 'scope', 'taskCount',
  ]);
  assert.equal(buildProductionRunCompletedNotificationV1({
    ...TASK_INPUT,
    scope: 'block',
    taskCount: 1,
  }).code, 'DINGTALK_CARD_INVALID');
});

test('preserves canonical 160-code-point outbox and business identifiers', () => {
  const result = buildProductionRunCompletedNotificationV1({
    ...TASK_INPUT,
    eventId: 'E'.repeat(160),
    runId: 'R'.repeat(160),
    scheduleItemId: 'S'.repeat(160),
    resourceId: 'U'.repeat(160),
  });
  assert.equal(result.ok, true, result.code);
  assert.equal([...result.intent.outboxId].length, 160);
  assert.equal([...result.intent.aggregateId].length, 160);
  assert.deepEqual(
    Object.values(JSON.parse(result.intent.payloadJson)).filter(value => typeof value === 'string' && value.length === 160),
    ['U'.repeat(160), 'R'.repeat(160), 'S'.repeat(160)],
  );
});
