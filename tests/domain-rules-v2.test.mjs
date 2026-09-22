import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkExpectedRunRevision,
  checkExpectedScheduleRevision,
  requestEffectsForRunEvent,
  revisionEffectsFor,
  transitionProductionRun,
  transitionRequest,
  transitionScheduleItem,
} from '../src/domain-rules-v2.mjs';

test('production run follows the regular ADP-007 transition path', () => {
  const path = [
    ['scheduled', 'start', 'shooting'],
    ['shooting', 'block', 'blocked'],
    ['blocked', 'resume', 'shooting'],
    ['shooting', 'complete', 'completed'],
  ];

  for (const [state, eventType, nextState] of path) {
    assert.deepEqual(transitionProductionRun({ state, eventType }), {
      ok: true,
      previousState: state,
      resultingState: nextState,
    });
  }
});

test('production run supports only the frozen cancellation paths', () => {
  assert.equal(transitionProductionRun({ state: 'scheduled', eventType: 'cancel' }).resultingState, 'cancelled');
  assert.equal(transitionProductionRun({ state: 'blocked', eventType: 'cancel' }).resultingState, 'cancelled');

  for (const [state, eventType] of [
    ['shooting', 'cancel'],
    ['blocked', 'complete'],
    ['completed', 'start'],
    ['completed', 'cancel'],
    ['cancelled', 'start'],
    ['cancelled', 'complete'],
  ]) {
    assert.deepEqual(transitionProductionRun({ state, eventType }), {
      ok: false,
      code: 'INVALID_RUN_TRANSITION',
      state,
      eventType,
    });
  }
});

test('unknown run state or event fails closed', () => {
  assert.equal(transitionProductionRun({ state: 'unknown', eventType: 'start' }).code, 'INVALID_RUN_STATE');
  assert.equal(transitionProductionRun({ state: 'scheduled', eventType: 'unknown' }).code, 'INVALID_RUN_EVENT');
});

test('schedule lifecycle is independent from production run completion', () => {
  assert.equal(transitionScheduleItem({ state: 'draft', commandType: 'confirm' }).resultingState, 'confirmed');
  assert.equal(transitionScheduleItem({ state: 'draft', commandType: 'cancel' }).resultingState, 'cancelled');
  assert.equal(transitionScheduleItem({ state: 'confirmed', commandType: 'cancel' }).resultingState, 'cancelled');

  const runResult = transitionProductionRun({ state: 'shooting', eventType: 'complete' });
  assert.equal(runResult.resultingState, 'completed');
  assert.equal(Object.hasOwn(runResult, 'scheduleState'), false);
  assert.equal(transitionScheduleItem({ state: 'confirmed', commandType: 'complete' }).code, 'INVALID_SCHEDULE_COMMAND');
  assert.equal(transitionScheduleItem({ state: 'cancelled', commandType: 'confirm' }).code, 'INVALID_SCHEDULE_TRANSITION');
});

test('request lifecycle permits only open to fulfilled or cancelled', () => {
  assert.equal(transitionRequest({ state: 'open', commandType: 'fulfill' }).resultingState, 'fulfilled');
  assert.equal(transitionRequest({ state: 'open', commandType: 'cancel' }).resultingState, 'cancelled');
  assert.equal(transitionRequest({ state: 'fulfilled', commandType: 'cancel' }).code, 'INVALID_REQUEST_TRANSITION');
  assert.equal(transitionRequest({ state: 'cancelled', commandType: 'fulfill' }).code, 'INVALID_REQUEST_TRANSITION');
});

test('grouped block completion never fulfills individual requests automatically', () => {
  assert.deepEqual(requestEffectsForRunEvent({
    scope: 'block',
    eventType: 'complete',
    requestIds: ['REQ-1', 'REQ-2'],
  }), []);

  assert.deepEqual(requestEffectsForRunEvent({
    scope: 'task',
    eventType: 'complete',
    requestIds: ['REQ-1'],
  }), [{ requestId: 'REQ-1', commandType: 'fulfill' }]);

  assert.deepEqual(requestEffectsForRunEvent({
    scope: 'task',
    eventType: 'block',
    requestIds: ['REQ-1'],
  }), []);
});

test('request effect derivation fails closed for malformed task scope', () => {
  assert.throws(
    () => requestEffectsForRunEvent({ scope: 'task', eventType: 'complete', requestIds: ['REQ-1', 'REQ-2'] }),
    error => error instanceof TypeError && error.code === 'INVALID_RUN_SCOPE_BINDING',
  );
  assert.throws(
    () => requestEffectsForRunEvent({ scope: 'unknown', eventType: 'complete', requestIds: [] }),
    error => error instanceof TypeError && error.code === 'INVALID_RUN_SCOPE',
  );
  assert.throws(
    () => requestEffectsForRunEvent({ scope: 'task', eventType: 'unknown', requestIds: ['REQ-1'] }),
    error => error instanceof TypeError && error.code === 'INVALID_RUN_EVENT',
  );
});

test('revision effects are explicit and scoped', () => {
  assert.deepEqual(revisionEffectsFor('scheduleCommand'), {
    scheduleRevision: 1,
    runRevision: 0,
    projectionRevision: 1,
  });
  assert.deepEqual(revisionEffectsFor('runEvent'), {
    scheduleRevision: 0,
    runRevision: 1,
    projectionRevision: 1,
  });
  assert.deepEqual(revisionEffectsFor('newRequest'), {
    scheduleRevision: 0,
    runRevision: 0,
    projectionRevision: 1,
  });

  for (const kind of ['outbox', 'noop', 'replay']) {
    assert.deepEqual(revisionEffectsFor(kind), {
      scheduleRevision: 0,
      runRevision: 0,
      projectionRevision: 0,
    });
  }
  assert.throws(() => revisionEffectsFor('unknown'), error => error.code === 'UNKNOWN_REVISION_EFFECT');
});

test('schedule revision checks never consult run revision', () => {
  assert.deepEqual(checkExpectedScheduleRevision({
    expectedScheduleRevision: 4,
    currentScheduleRevision: 4,
  }), { ok: true, scope: 'schedule', currentRevision: 4 });

  assert.deepEqual(checkExpectedScheduleRevision({
    expectedScheduleRevision: 3,
    currentScheduleRevision: 4,
  }), {
    ok: false,
    code: 'REVISION_CONFLICT',
    scope: 'schedule',
    currentRevision: 4,
  });
});

test('run revision checks are per target run and independent of schedule revision', () => {
  assert.deepEqual(checkExpectedRunRevision({
    expectedRunRevision: 7,
    currentRunRevision: 7,
  }), { ok: true, scope: 'run', currentRevision: 7 });

  assert.deepEqual(checkExpectedRunRevision({
    expectedRunRevision: 6,
    currentRunRevision: 7,
  }), {
    ok: false,
    code: 'REVISION_CONFLICT',
    scope: 'run',
    currentRevision: 7,
  });
});

test('revision checks reject invalid counters rather than coercing them', () => {
  assert.equal(checkExpectedScheduleRevision({
    expectedScheduleRevision: '4',
    currentScheduleRevision: 4,
  }).code, 'INVALID_REVISION');
  assert.equal(checkExpectedRunRevision({
    expectedRunRevision: -1,
    currentRunRevision: 0,
  }).code, 'INVALID_REVISION');
});
