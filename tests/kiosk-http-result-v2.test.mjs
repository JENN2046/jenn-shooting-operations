import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateKioskCurrent,
  validateKioskRunEvent,
  validateKioskRunEventResult,
} from '../src/kiosk-contract-validator-v2.mjs';
import {
  KIOSK_HTTP_STATUS_BY_FAILURE_CODE,
  mapKioskCurrentHttpResult,
  mapKioskRunEventHttpResult,
} from '../src/kiosk-http-result-v2.mjs';

const rawApplied = {
  ok: true,
  code: 'RUN_EVENT_APPLIED',
  eventId: 'EVENT-0001',
  runId: 'RUN-0001',
  previousState: 'scheduled',
  resultingState: 'shooting',
  runRevision: 1,
  projectionRevision: 18,
  scheduleRevision: 7,
  startedAt: '2026-09-22T09:00:00.000Z',
  completedAt: null,
  grossDurationMs: null,
  blockedDurationMs: 0,
  netDurationMs: null,
  metricsAlgorithmVersion: null,
};

const rawReview = {
  ok: false,
  code: 'EVENT_TIME_REVIEW_REQUIRED',
  eventId: 'EVENT-0001',
  runId: 'RUN-0001',
  scheduleItemId: 'SCHEDULE-ITEM-0001',
  reviewStatus: 'pending',
  reviewReason: 'tooOld',
  policyVersion: 'kiosk-event-time-local-v1',
  receivedAt: '2026-09-22T09:30:00.000Z',
};

const current = {
  schemaVersion: 2,
  serverTime: '2026-09-22T09:30:00.000Z',
  projectionRevision: 17,
  resourceId: 'STUDIO-A',
  current: {
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    allocationMode: 'single',
    plannedStart: '2026-09-22T09:00:00.000Z',
    plannedEnd: '2026-09-22T10:00:00.000Z',
    runId: 'RUN-0001',
    runRevision: 1,
    runState: 'shooting',
    tasks: [{
      id: 'TASK-0001',
      sku: 'SKU-001',
      name: 'Single task',
      summary: 'A controlled production summary.',
    }],
    isGrouped: false,
    groupedNotice: null,
  },
  next: null,
};

function expectValidResult(mapped) {
  assert.equal(validateKioskRunEventResult(mapped.body).ok, true);
}

test('runtime contract validators compile all three Draft 2020 schemas and add current semantics', () => {
  assert.equal(validateKioskRunEvent({
    schemaVersion: 2,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    eventType: 'start',
    expectedRunRevision: 0,
    occurredAt: '2026-09-22T09:00:00.000Z',
    deviceId: 'KIOSK-0001',
    localSequence: 0,
    note: '😀'.repeat(1500),
  }).ok, true);
  assert.equal(validateKioskCurrent(current).ok, true);
  assert.equal(validateKioskRunEventResult({
    schemaVersion: 2,
    ok: false,
    code: 'FORBIDDEN',
    replayed: false,
  }).ok, true);

  const invalidCurrent = structuredClone(current);
  invalidCurrent.current.plannedEnd = invalidCurrent.current.plannedStart;
  assert.deepEqual(validateKioskCurrent(invalidCurrent), {
    ok: false,
    issues: [{ code: 'INVALID_PLANNED_RANGE', path: '/current/plannedEnd' }],
  });
  const unknownEvent = {
    schemaVersion: 2,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    eventType: 'start',
    expectedRunRevision: 0,
    occurredAt: '2026-09-22T09:00:00.000Z',
    deviceId: 'KIOSK-0001',
    localSequence: 0,
    actorId: 'must-not-cross-http-boundary',
  };
  const validation = validateKioskRunEvent(unknownEvent);
  assert.equal(validation.ok, false);
  assert.equal(validation.issues.some(issue => issue.path === '/actorId' && issue.keyword === 'additionalProperties'), true);
});

test('new accepted event maps to 201 and exact accepted replay maps to 200', () => {
  const applied = mapKioskRunEventHttpResult(rawApplied);
  assert.equal(applied.status, 201);
  assert.equal(applied.body.schemaVersion, 2);
  assert.equal(applied.body.replayed, false);
  expectValidResult(applied);

  const replayed = mapKioskRunEventHttpResult({ ...rawApplied, replayed: true });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  expectValidResult(replayed);
});

test('new and exact replayed pending reviews both map to 202', () => {
  for (const replayed of [false, true]) {
    const mapped = mapKioskRunEventHttpResult({ ...rawReview, replayed });
    assert.equal(mapped.status, 202);
    assert.equal(mapped.body.replayed, replayed);
    expectValidResult(mapped);
  }
});

test('revision conflict renames currentRevision and emits only frozen fields', () => {
  const mapped = mapKioskRunEventHttpResult({
    ok: false,
    code: 'REVISION_CONFLICT',
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scope: 'schedule',
    currentRevision: 4,
    message: 'secret internal context',
    details: { sql: 'select secret' },
  });
  assert.equal(mapped.status, 409);
  assert.deepEqual(mapped.body, {
    schemaVersion: 2,
    ok: false,
    code: 'REVISION_CONFLICT',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scope: 'run',
    currentRunRevision: 4,
  });
  expectValidResult(mapped);
});

test('every frozen ordinary failure code maps to its ADP-021 status and a valid low-disclosure body', () => {
  for (const [code, status] of Object.entries(KIOSK_HTTP_STATUS_BY_FAILURE_CODE)) {
    const mapped = mapKioskRunEventHttpResult({
      ok: false,
      code,
      message: 'do not disclose',
      stack: 'stack',
      sql: 'select secret',
      path: '/private/database.sqlite',
      details: { token: 'secret' },
    });
    assert.equal(mapped.status, status, code);
    assert.deepEqual(mapped.body, { schemaVersion: 2, ok: false, code, replayed: false }, code);
    expectValidResult(mapped);
  }
});

test('malformed special results and unrecognized outcomes fail closed as valid INTERNAL_ERROR', () => {
  const candidates = [
    null,
    new Error('database path and SQL'),
    { ok: false, code: 'UNKNOWN_FAILURE', message: 'secret' },
    { ok: true, code: 'UNKNOWN_SUCCESS', details: 'secret' },
    { ...rawApplied, replayed: 'true' },
    { ...rawApplied, eventId: 'short', stack: 'secret' },
    { ...rawReview, replayed: 1 },
    { ...rawReview, receivedAt: 'not-a-time', details: 'secret' },
    { ok: false, code: 'REVISION_CONFLICT', currentRevision: 4, message: 'secret' },
  ];
  for (const candidate of candidates) {
    const mapped = mapKioskRunEventHttpResult(candidate);
    assert.deepEqual(mapped, {
      status: 500,
      body: { schemaVersion: 2, ok: false, code: 'INTERNAL_ERROR', replayed: false },
    });
    expectValidResult(mapped);
  }
});

test('HTTP mapper never forwards message, stack, SQL, path, details, or unknown fields', () => {
  const mapped = mapKioskRunEventHttpResult({
    ...rawApplied,
    replayed: false,
    message: 'sensitive',
    stack: 'sensitive',
    sql: 'sensitive',
    path: 'sensitive',
    details: { sensitive: true },
    unexpected: 'sensitive',
  });
  assert.equal(mapped.status, 201);
  assert.equal(JSON.stringify(mapped).includes('sensitive'), false);
  expectValidResult(mapped);
});

test('current mapper uses an independent unchanged signal and emits no 304 body', () => {
  const changed = mapKioskCurrentHttpResult(current);
  assert.equal(changed.status, 200);
  assert.equal(changed.body, current);
  assert.equal(validateKioskCurrent(changed.body).ok, true);

  assert.deepEqual(mapKioskCurrentHttpResult({ not: 'validated' }, { unchanged: true }), {
    status: 304,
    body: null,
  });

  const invalid = mapKioskCurrentHttpResult({ ...current, unexpected: true });
  assert.deepEqual(invalid, {
    status: 500,
    body: { schemaVersion: 2, ok: false, code: 'INTERNAL_ERROR', replayed: false },
  });
  expectValidResult(invalid);
  assert.deepEqual(mapKioskCurrentHttpResult(current, { unchanged: 'yes' }), invalid);
});
