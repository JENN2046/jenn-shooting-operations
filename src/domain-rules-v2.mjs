const RUN_STATES = new Set(['scheduled', 'shooting', 'blocked', 'completed', 'cancelled']);
const RUN_EVENTS = new Set(['start', 'block', 'resume', 'complete', 'cancel']);
const RUN_TRANSITIONS = new Map([
  ['scheduled:start', 'shooting'],
  ['shooting:block', 'blocked'],
  ['blocked:resume', 'shooting'],
  ['shooting:complete', 'completed'],
  ['scheduled:cancel', 'cancelled'],
  ['blocked:cancel', 'cancelled'],
]);

const SCHEDULE_STATES = new Set(['draft', 'confirmed', 'cancelled']);
const SCHEDULE_COMMANDS = new Set(['confirm', 'cancel']);
const SCHEDULE_TRANSITIONS = new Map([
  ['draft:confirm', 'confirmed'],
  ['draft:cancel', 'cancelled'],
  ['confirmed:cancel', 'cancelled'],
]);

const REQUEST_STATES = new Set(['open', 'fulfilled', 'cancelled']);
const REQUEST_COMMANDS = new Set(['fulfill', 'cancel']);
const REQUEST_TRANSITIONS = new Map([
  ['open:fulfill', 'fulfilled'],
  ['open:cancel', 'cancelled'],
]);

const REVISION_EFFECTS = Object.freeze({
  scheduleCommand: Object.freeze({ scheduleRevision: 1, runRevision: 0, projectionRevision: 1 }),
  runEvent: Object.freeze({ scheduleRevision: 0, runRevision: 1, projectionRevision: 1 }),
  newRequest: Object.freeze({ scheduleRevision: 0, runRevision: 0, projectionRevision: 1 }),
  outbox: Object.freeze({ scheduleRevision: 0, runRevision: 0, projectionRevision: 0 }),
  noop: Object.freeze({ scheduleRevision: 0, runRevision: 0, projectionRevision: 0 }),
  replay: Object.freeze({ scheduleRevision: 0, runRevision: 0, projectionRevision: 0 }),
});

function invalidTransition(code, state, actionName, action) {
  return { ok: false, code, state, [actionName]: action };
}

export function transitionProductionRun({ state, eventType } = {}) {
  if (!RUN_STATES.has(state)) return { ok: false, code: 'INVALID_RUN_STATE', state };
  if (!RUN_EVENTS.has(eventType)) return { ok: false, code: 'INVALID_RUN_EVENT', eventType };
  const resultingState = RUN_TRANSITIONS.get(`${state}:${eventType}`);
  if (!resultingState) return invalidTransition('INVALID_RUN_TRANSITION', state, 'eventType', eventType);
  return { ok: true, previousState: state, resultingState };
}

export function transitionScheduleItem({ state, commandType } = {}) {
  if (!SCHEDULE_STATES.has(state)) return { ok: false, code: 'INVALID_SCHEDULE_STATE', state };
  if (!SCHEDULE_COMMANDS.has(commandType)) return { ok: false, code: 'INVALID_SCHEDULE_COMMAND', commandType };
  const resultingState = SCHEDULE_TRANSITIONS.get(`${state}:${commandType}`);
  if (!resultingState) return invalidTransition('INVALID_SCHEDULE_TRANSITION', state, 'commandType', commandType);
  return { ok: true, previousState: state, resultingState };
}

export function transitionRequest({ state, commandType } = {}) {
  if (!REQUEST_STATES.has(state)) return { ok: false, code: 'INVALID_REQUEST_STATE', state };
  if (!REQUEST_COMMANDS.has(commandType)) return { ok: false, code: 'INVALID_REQUEST_COMMAND', commandType };
  const resultingState = REQUEST_TRANSITIONS.get(`${state}:${commandType}`);
  if (!resultingState) return invalidTransition('INVALID_REQUEST_TRANSITION', state, 'commandType', commandType);
  return { ok: true, previousState: state, resultingState };
}

function invalidScope(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

export function requestEffectsForRunEvent({ scope, eventType, requestIds } = {}) {
  if (scope !== 'task' && scope !== 'block') {
    throw invalidScope('INVALID_RUN_SCOPE', 'run scope must be task or block');
  }
  if (!RUN_EVENTS.has(eventType)) {
    throw invalidScope('INVALID_RUN_EVENT', 'eventType must be a known production run event');
  }
  if (!Array.isArray(requestIds)) {
    throw invalidScope('INVALID_RUN_SCOPE_BINDING', 'requestIds must be an array');
  }
  if ((scope === 'task' && requestIds.length !== 1) || (scope === 'block' && requestIds.length < 2)) {
    throw invalidScope('INVALID_RUN_SCOPE_BINDING', 'run scope does not match request bindings');
  }
  if (eventType !== 'complete' || scope === 'block') return [];
  return [{ requestId: requestIds[0], commandType: 'fulfill' }];
}

export function revisionEffectsFor(kind) {
  const effects = REVISION_EFFECTS[kind];
  if (!effects) {
    const error = new TypeError(`unknown revision effect: ${String(kind)}`);
    error.code = 'UNKNOWN_REVISION_EFFECT';
    throw error;
  }
  return { ...effects };
}

function checkExpectedRevision({ expected, current, scope }) {
  if (!Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(current) || current < 0) {
    return { ok: false, code: 'INVALID_REVISION', scope };
  }
  if (expected !== current) {
    return { ok: false, code: 'REVISION_CONFLICT', scope, currentRevision: current };
  }
  return { ok: true, scope, currentRevision: current };
}

export function checkExpectedScheduleRevision({ expectedScheduleRevision, currentScheduleRevision } = {}) {
  return checkExpectedRevision({
    expected: expectedScheduleRevision,
    current: currentScheduleRevision,
    scope: 'schedule',
  });
}

export function checkExpectedRunRevision({ expectedRunRevision, currentRunRevision } = {}) {
  return checkExpectedRevision({
    expected: expectedRunRevision,
    current: currentRunRevision,
    scope: 'run',
  });
}
