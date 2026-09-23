import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { validateKioskCurrentRelationships } from '../src/kiosk-contract-rules-v2.mjs';

async function loadSchema(filename) {
  return JSON.parse(await readFile(new URL(`../contracts/${filename}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv, { mode: 'full' });

const validateCurrent = ajv.compile(await loadSchema('kiosk-current.v2.schema.json'));
const validateEvent = ajv.compile(await loadSchema('kiosk-run-event.v2.schema.json'));
const validateResult = ajv.compile(await loadSchema('kiosk-run-event-result.v2.schema.json'));

function expectValid(validate, value, message = 'expected contract to accept value') {
  assert.equal(validate(value), true, `${message}: ${ajv.errorsText(validate.errors)}`);
}

function expectInvalid(validate, value, message = 'expected contract to reject value') {
  assert.equal(validate(value), false, message);
}

const singleItem = {
  scheduleItemId: 'SCHEDULE-ITEM-0001',
  allocationMode: 'single',
  plannedStart: '2026-09-22T09:00:00.000Z',
  plannedEnd: '2026-09-22T10:00:00.000Z',
  runId: 'RUN-0001',
  runRevision: 3,
  runState: 'shooting',
  tasks: [{
    id: 'TASK-0001',
    sku: 'SKU-001',
    name: 'Single task',
    summary: 'A controlled, short production summary.',
    heroAssetId: 'ASSET-0001',
  }],
  isGrouped: false,
  groupedNotice: null,
};

const groupedItem = {
  ...singleItem,
  scheduleItemId: 'SCHEDULE-ITEM-0002',
  allocationMode: 'grouped_unallocated',
  plannedStart: '2026-09-22T10:00:00.000Z',
  plannedEnd: '2026-09-22T11:00:00.000Z',
  runId: null,
  runRevision: 0,
  runState: 'scheduled',
  tasks: [
    { id: 'TASK-0002', sku: 'SKU-002', name: 'Grouped task A', summary: 'First grouped task.' },
    { id: 'TASK-0003', sku: 'SKU-003', name: 'Grouped task B', summary: 'Second grouped task.' },
  ],
  isGrouped: true,
  groupedNotice: '组合场次，未拆分单任务工时',
};

const currentDto = {
  schemaVersion: 2,
  serverTime: '2026-09-22T09:30:00.000Z',
  projectionRevision: 17,
  resourceId: 'STUDIO-A',
  current: singleItem,
  next: groupedItem,
};

const startEvent = {
  schemaVersion: 2,
  eventId: 'EVENT-0001',
  runId: 'RUN-0001',
  scheduleItemId: 'SCHEDULE-ITEM-0001',
  eventType: 'start',
  expectedRunRevision: 0,
  occurredAt: '2026-09-22T09:00:00.000Z',
  deviceId: 'KIOSK-IPAD-01',
  localSequence: 0,
};

const appliedResult = {
  schemaVersion: 2,
  ok: true,
  code: 'RUN_EVENT_APPLIED',
  replayed: false,
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

test('kiosk current DTO is resource-scoped, compact, and supports empty slots', () => {
  expectValid(validateCurrent, currentDto);
  expectValid(validateCurrent, { ...currentDto, current: null, next: null });
  expectValid(validateCurrent, { ...currentDto, current: groupedItem, next: null });

  const missingResource = structuredClone(currentDto);
  delete missingResource.resourceId;
  expectInvalid(validateCurrent, missingResource, 'resourceId is mandatory');

  expectInvalid(validateCurrent, { ...currentDto, scheduleRevision: 9 }, 'schedule write revision is not exposed');
  expectInvalid(validateCurrent, { ...currentDto, resourceId: '   ' }, 'resourceId cannot be blank');
});

test('kiosk current distinguishes current candidates from active runs and keeps next candidate-only', () => {
  expectValid(validateCurrent, currentDto);
  expectValid(validateCurrent, { ...currentDto, current: groupedItem, next: null });

  for (const current of [
    { ...groupedItem, runId: 'RUN-CANDIDATE-0001' },
    { ...groupedItem, runRevision: 1 },
    { ...groupedItem, runState: 'shooting' },
    { ...singleItem, runId: null },
    { ...singleItem, runRevision: 0 },
    { ...singleItem, runState: 'completed' },
  ]) expectInvalid(validateCurrent, { ...currentDto, current }, 'invalid candidate/active combination');

  expectInvalid(validateCurrent, { ...currentDto, next: singleItem }, 'next cannot expose an active run');
});

test('kiosk item enforces grouped identity and the frozen grouped notice', () => {
  expectValid(validateCurrent, currentDto);

  expectInvalid(validateCurrent, {
    ...currentDto,
    current: { ...singleItem, isGrouped: true },
  }, 'single item cannot claim grouped state');
  expectInvalid(validateCurrent, {
    ...currentDto,
    current: { ...singleItem, tasks: [...singleItem.tasks, groupedItem.tasks[0]] },
  }, 'single item must bind exactly one task');
  expectInvalid(validateCurrent, {
    ...currentDto,
    next: { ...groupedItem, tasks: [groupedItem.tasks[0]] },
  }, 'grouped item requires multiple tasks');
  expectInvalid(validateCurrent, {
    ...currentDto,
    next: { ...groupedItem, groupedNotice: 'Grouped session' },
  }, 'grouped item cannot weaken the frozen warning');
});

test('kiosk current DTO bounds summaries, revisions, timestamps, and external data', () => {
  expectValid(validateCurrent, {
    ...currentDto,
    projectionRevision: Number.MAX_SAFE_INTEGER,
    current: {
      ...singleItem,
      runRevision: Number.MAX_SAFE_INTEGER,
      tasks: [{ ...singleItem.tasks[0], summary: 'x'.repeat(100) }],
    },
  });

  for (const invalid of [
    { ...currentDto, projectionRevision: -1 },
    { ...currentDto, projectionRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...currentDto, projectionRevision: 1.5 },
    { ...currentDto, serverTime: '2026-09-22' },
    { ...currentDto, serverTime: '2026-02-30T09:00:00Z' },
    { ...currentDto, current: { ...singleItem, plannedStart: '09:00' } },
    {
      ...currentDto,
      current: {
        ...singleItem,
        tasks: [{ ...singleItem.tasks[0], summary: 'x'.repeat(101) }],
      },
    },
    {
      ...currentDto,
      current: {
        ...singleItem,
        tasks: [{ ...singleItem.tasks[0], heroAssetUrl: 'https://external.example/asset.jpg' }],
      },
    },
    { ...currentDto, current: { ...singleItem, priority: 'p0' } },
  ]) expectInvalid(validateCurrent, invalid);
});

test('kiosk current relationship rules enforce time windows, order, and distinct slots without mutation', () => {
  const before = structuredClone(currentDto);
  assert.deepEqual(validateKioskCurrentRelationships(currentDto), { ok: true, issues: [] });
  assert.deepEqual(currentDto, before);

  const activeAfterPlan = {
    ...currentDto,
    serverTime: '2026-09-22T11:00:00.000Z',
    current: singleItem,
    next: { ...groupedItem, plannedStart: '2026-09-22T12:00:00.000Z', plannedEnd: '2026-09-22T13:00:00.000Z' },
  };
  assert.equal(validateKioskCurrentRelationships(activeAfterPlan).ok, true, 'active run remains current after its plan window');

  for (const [value, code] of [
    [{ ...currentDto, current: { ...singleItem, plannedEnd: singleItem.plannedStart } }, 'INVALID_PLANNED_RANGE'],
    [{ ...currentDto, next: { ...groupedItem, plannedEnd: groupedItem.plannedStart } }, 'INVALID_PLANNED_RANGE'],
    [{ ...currentDto, current: { ...groupedItem, plannedStart: '2026-09-22T10:00:00.000Z', plannedEnd: '2026-09-22T11:00:00.000Z' } }, 'CURRENT_CANDIDATE_OUTSIDE_WINDOW'],
    [{ ...currentDto, next: { ...groupedItem, plannedStart: currentDto.serverTime } }, 'NEXT_CANDIDATE_NOT_FUTURE'],
    [{
      ...currentDto,
      next: {
        ...groupedItem,
        tasks: [groupedItem.tasks[0], { ...groupedItem.tasks[1], id: groupedItem.tasks[0].id }],
      },
    }, 'DUPLICATE_KIOSK_TASK'],
    [{ ...currentDto, next: { ...groupedItem, scheduleItemId: singleItem.scheduleItemId } }, 'DUPLICATE_KIOSK_SLOT'],
    [{ ...currentDto, next: { ...groupedItem, plannedStart: '2026-09-22T09:45:00.000Z' } }, 'KIOSK_SLOT_ORDER_CONFLICT'],
  ]) {
    const result = validateKioskCurrentRelationships(value);
    assert.equal(result.ok, false, code);
    assert.ok(result.issues.some(entry => entry.code === code), code);
  }
});

test('kiosk run event accepts only the four regular event commands', () => {
  expectValid(validateEvent, startEvent);
  for (const eventType of ['start', 'resume', 'complete']) {
    expectValid(validateEvent, { ...startEvent, eventId: `EVENT-${eventType}-0001`, eventType, note: 'Operator note' });
  }
  for (const reasonCode of ['sampleWaiting', 'specConfirming', 'deviceIssue', 'talentWaiting', 'siteIssue']) {
    expectValid(validateEvent, {
      ...startEvent,
      eventId: `EVENT-${reasonCode}-0001`,
      eventType: 'block',
      reasonCode,
    });
  }
  expectValid(validateEvent, {
    ...startEvent,
    eventId: 'EVENT-other-0001',
    eventType: 'block',
    reasonCode: 'other',
    note: 'Waiting for an unlisted studio dependency.',
  });

  expectInvalid(validateEvent, { ...startEvent, eventType: 'cancel' }, 'Kiosk cannot cancel a run');
  expectInvalid(validateEvent, { ...startEvent, eventType: 'block' }, 'block requires a reason');
  expectInvalid(validateEvent, { ...startEvent, reasonCode: 'deviceIssue' }, 'non-block events cannot carry a reason');
  expectInvalid(validateEvent, { ...startEvent, eventType: 'block', reasonCode: 'unknown' });
  expectInvalid(validateEvent, { ...startEvent, eventType: 'block', reasonCode: 'other' }, 'other requires a note');
  expectInvalid(validateEvent, { ...startEvent, eventType: 'block', reasonCode: 'other', note: '   ' }, 'other note cannot be blank');
});

test('kiosk event body rejects authority fields, forged state, and extra properties', () => {
  for (const [property, value] of [
    ['actorId', 'ACTOR-01'],
    ['role', 'scheduler'],
    ['previousState', 'scheduled'],
    ['resultingState', 'shooting'],
    ['receivedAt', '2026-09-22T09:00:01Z'],
    ['scope', 'task'],
    ['taskId', 'TASK-0001'],
    ['scheduleRevision', 4],
    ['projectionRevision', 9],
    ['externalUrl', 'https://external.example/'],
  ]) expectInvalid(validateEvent, { ...startEvent, [property]: value }, property);

  const missingDevice = structuredClone(startEvent);
  delete missingDevice.deviceId;
  expectInvalid(validateEvent, missingDevice);
});

test('kiosk event enforces safe integer and RFC 3339 boundaries', () => {
  expectValid(validateEvent, {
    ...startEvent,
    expectedRunRevision: Number.MAX_SAFE_INTEGER,
    localSequence: Number.MAX_SAFE_INTEGER,
    occurredAt: '2026-09-22T09:00:00+08:00',
  });

  for (const invalid of [
    { ...startEvent, expectedRunRevision: -1 },
    { ...startEvent, expectedRunRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...startEvent, localSequence: -1 },
    { ...startEvent, localSequence: 0.5 },
    { ...startEvent, occurredAt: '2026-09-22' },
    { ...startEvent, occurredAt: '2026-13-22T09:00:00Z' },
    { ...startEvent, eventId: 'short' },
    { ...startEvent, runId: ' RUN-0001' },
  ]) expectInvalid(validateEvent, invalid);
});

test('kiosk event result is a strict applied/replayed/conflict/review union', () => {
  expectValid(validateResult, appliedResult);
  expectValid(validateResult, { ...appliedResult, replayed: true });
  expectValid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'REVISION_CONFLICT',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scope: 'run',
    currentRunRevision: 4,
  });
  expectValid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'IDEMPOTENCY_KEY_REUSE',
    replayed: false,
  });
  expectValid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'EVENT_TIME_REVIEW_REQUIRED',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    reviewStatus: 'pending',
    reviewReason: 'tooFarFuture',
    policyVersion: 'kiosk-event-time-local-v1',
    receivedAt: '2026-09-22T09:30:00.000Z',
  });

  expectValid(validateResult, {
    ...appliedResult,
    previousState: 'shooting',
    resultingState: 'completed',
    completedAt: '2026-09-22T10:00:00.000Z',
    grossDurationMs: 3600000,
    blockedDurationMs: 600000,
    netDurationMs: 3000000,
    metricsAlgorithmVersion: 'production-run-net-v1',
  });

  expectInvalid(validateResult, { ...appliedResult, replayed: 'false' });
  expectInvalid(validateResult, { ...appliedResult, code: 'RUN_EVENT_ACCEPTED' });
  const rawApplied = structuredClone(appliedResult);
  delete rawApplied.schemaVersion;
  delete rawApplied.replayed;
  expectInvalid(validateResult, rawApplied, 'HTTP adapter must add schemaVersion and replayed');
  expectInvalid(validateResult, { ...appliedResult, activeBlockStartedAt: '2026-09-22T09:10:00Z' }, 'result cannot grow unreviewed fields');
  expectInvalid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'REVISION_CONFLICT',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scope: 'run',
  }, 'conflict must disclose current run revision');
  expectInvalid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'REVISION_CONFLICT',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scope: 'run',
    currentRevision: 4,
  }, 'HTTP adapter must rename currentRevision to currentRunRevision');
  expectInvalid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'EVENT_TIME_REVIEW_REQUIRED',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    reviewStatus: 'pending',
    reviewReason: 'tooOld',
    policyVersion: 'kiosk-event-time-local-v1',
    receivedAt: '2026-09-22T09:30:00.000Z',
    details: 'raw internal policy output',
  }, 'review result cannot expose raw details');

  expectInvalid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'EVENT_TIME_REVIEW_REQUIRED',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    reviewStatus: 'pending',
    reviewReason: 'clockSkew',
    policyVersion: 'kiosk-event-time-local-v1',
    receivedAt: '2026-09-22T09:30:00.000Z',
  }, 'review reason is a frozen low-disclosure enum');
});

test('kiosk HTTP result envelope covers every frozen endpoint failure code without overlapping special variants', () => {
  const failureCodes = [
    'INVALID_JSON', 'INVALID_REQUEST',
    'UNAUTHENTICATED', 'AUTH_NOT_CONFIGURED', 'FORBIDDEN',
    'RESOURCE_NOT_FOUND', 'SCHEDULE_ITEM_NOT_FOUND', 'RUN_NOT_FOUND',
    'IDEMPOTENCY_KEY_REUSE', 'RUN_ID_MISMATCH', 'RUN_ID_REUSE',
    'SCHEDULE_ITEM_ID_MISMATCH', 'RUN_PREPARATION_REQUIRED',
    'MULTIPLE_ACTIVE_RUNS', 'MULTIPLE_CURRENT_CANDIDATES', 'MULTIPLE_NEXT_CANDIDATES',
    'INVALID_RUN_TRANSITION', 'EVENT_TIME_OUT_OF_ORDER',
    'INVALID_RUN_EVENT_COMMAND', 'INVALID_EVENT_ID', 'INVALID_EVENT_TIME',
    'INVALID_BLOCKING_REASON', 'BLOCKING_REASON_NOTE_REQUIRED',
    'EVENT_RECEIPT_INTEGRITY_ERROR', 'INTERNAL_ERROR',
    'STORE_BUSY', 'SERVICE_UNAVAILABLE',
  ];
  for (const code of failureCodes) {
    expectValid(validateResult, { schemaVersion: 2, ok: false, code, replayed: false }, code);
  }

  for (const code of ['RUN_EVENT_APPLIED', 'EVENT_TIME_REVIEW_REQUIRED', 'REVISION_CONFLICT', 'UNKNOWN_INTERNAL_ERROR']) {
    expectInvalid(validateResult, { schemaVersion: 2, ok: false, code, replayed: false }, code);
  }
  expectInvalid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'INTERNAL_ERROR',
    replayed: false,
    details: 'stack or SQL must not cross the adapter',
  });
});

test('kiosk result revision fields stay within the JavaScript safe integer range', () => {
  expectValid(validateResult, {
    ...appliedResult,
    runRevision: Number.MAX_SAFE_INTEGER,
    projectionRevision: Number.MAX_SAFE_INTEGER,
    scheduleRevision: Number.MAX_SAFE_INTEGER,
    grossDurationMs: Number.MAX_SAFE_INTEGER,
    blockedDurationMs: Number.MAX_SAFE_INTEGER,
    netDurationMs: Number.MAX_SAFE_INTEGER,
  });
  expectValid(validateResult, {
    schemaVersion: 2,
    ok: false,
    code: 'REVISION_CONFLICT',
    replayed: false,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scope: 'run',
    currentRunRevision: Number.MAX_SAFE_INTEGER,
  });
  expectInvalid(validateResult, { ...appliedResult, runRevision: Number.MAX_SAFE_INTEGER + 1 });
  expectInvalid(validateResult, { ...appliedResult, projectionRevision: -1 });
  expectInvalid(validateResult, { ...appliedResult, scheduleRevision: Number.MAX_SAFE_INTEGER + 1 });
  expectInvalid(validateResult, { ...appliedResult, blockedDurationMs: -1 });
  expectInvalid(validateResult, { ...appliedResult, completedAt: '2026-02-30T10:00:00Z' });
});
