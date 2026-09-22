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

export const RUN_METRICS_ALGORITHM_VERSION = 'production-run-net-v1';

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

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

function timestampMillis(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function invalidRunFold(code, details = {}) {
  return { ok: false, code, ...details };
}

function safeDuration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function foldProductionRunEvent({
  run,
  eventType,
  occurredAt,
  lastOccurredAt = null,
  metricsAlgorithmVersion = RUN_METRICS_ALGORITHM_VERSION,
} = {}) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    return invalidRunFold('INVALID_RUN_FACT');
  }
  const transition = transitionProductionRun({ state: run.status, eventType });
  if (!transition.ok) return transition;

  const occurredMillis = timestampMillis(occurredAt);
  if (occurredMillis === null) return invalidRunFold('INVALID_EVENT_TIME');
  const canonicalOccurredAt = new Date(occurredMillis).toISOString();
  if (lastOccurredAt !== null) {
    const lastMillis = timestampMillis(lastOccurredAt);
    if (lastMillis === null) return invalidRunFold('INVALID_RUN_FACT');
    if (occurredMillis < lastMillis) return invalidRunFold('EVENT_TIME_OUT_OF_ORDER');
  }

  const blockedDurationMs = run.blocked_duration_ms ?? 0;
  if (!safeDuration(blockedDurationMs)) return invalidRunFold('INVALID_RUN_METRICS');
  const patch = {
    status: transition.resultingState,
    started_at: run.started_at ?? null,
    completed_at: run.completed_at ?? null,
    active_block_started_at: run.active_block_started_at ?? null,
    gross_duration_ms: run.gross_duration_ms ?? null,
    blocked_duration_ms: blockedDurationMs,
    net_duration_ms: run.net_duration_ms ?? null,
    metrics_algorithm_version: run.metrics_algorithm_version ?? null,
  };
  const hasFinalMetrics = patch.completed_at !== null
    || patch.gross_duration_ms !== null
    || patch.net_duration_ms !== null
    || patch.metrics_algorithm_version !== null;
  if (hasFinalMetrics) return invalidRunFold('INVALID_RUN_METRICS');
  if (run.status === 'scheduled' && (
    patch.started_at !== null || patch.active_block_started_at !== null || blockedDurationMs !== 0
  )) return invalidRunFold('INVALID_RUN_METRICS');
  if (run.status === 'shooting' && (
    timestampMillis(patch.started_at) === null || patch.active_block_started_at !== null
  )) return invalidRunFold('INVALID_RUN_METRICS');
  if (run.status === 'blocked' && (
    timestampMillis(patch.started_at) === null || timestampMillis(patch.active_block_started_at) === null
  )) return invalidRunFold('INVALID_RUN_METRICS');

  if (eventType === 'start') {
    if (
      patch.started_at !== null
      || patch.active_block_started_at !== null
    ) return invalidRunFold('INVALID_RUN_METRICS');
    patch.started_at = canonicalOccurredAt;
  } else if (eventType === 'block') {
    const startedMillis = timestampMillis(patch.started_at);
    if (startedMillis === null || patch.active_block_started_at !== null) {
      return invalidRunFold('INVALID_RUN_METRICS');
    }
    if (occurredMillis < startedMillis) return invalidRunFold('EVENT_TIME_OUT_OF_ORDER');
    patch.active_block_started_at = canonicalOccurredAt;
  } else if (eventType === 'resume') {
    const blockStartedMillis = timestampMillis(patch.active_block_started_at);
    if (timestampMillis(patch.started_at) === null || blockStartedMillis === null) {
      return invalidRunFold('INVALID_RUN_METRICS');
    }
    if (occurredMillis < blockStartedMillis) return invalidRunFold('EVENT_TIME_OUT_OF_ORDER');
    const closedBlockMs = occurredMillis - blockStartedMillis;
    const nextBlockedDurationMs = blockedDurationMs + closedBlockMs;
    if (!safeDuration(closedBlockMs) || !safeDuration(nextBlockedDurationMs)) {
      return invalidRunFold('RUN_METRICS_OVERFLOW');
    }
    patch.blocked_duration_ms = nextBlockedDurationMs;
    patch.active_block_started_at = null;
  } else if (eventType === 'complete') {
    const startedMillis = timestampMillis(patch.started_at);
    if (startedMillis === null || patch.active_block_started_at !== null) {
      return invalidRunFold('UNCLOSED_BLOCK_INTERVAL');
    }
    if (occurredMillis < startedMillis) return invalidRunFold('EVENT_TIME_OUT_OF_ORDER');
    const grossDurationMs = occurredMillis - startedMillis;
    const netDurationMs = grossDurationMs - blockedDurationMs;
    if (!safeDuration(grossDurationMs) || !safeDuration(netDurationMs)) {
      return invalidRunFold('INVALID_RUN_METRICS');
    }
    patch.completed_at = canonicalOccurredAt;
    patch.gross_duration_ms = grossDurationMs;
    patch.net_duration_ms = netDurationMs;
    patch.metrics_algorithm_version = metricsAlgorithmVersion;
  } else if (eventType === 'cancel') {
    patch.active_block_started_at = null;
    patch.gross_duration_ms = null;
    patch.net_duration_ms = null;
    patch.metrics_algorithm_version = null;
  }

  return {
    ok: true,
    previousState: transition.previousState,
    resultingState: transition.resultingState,
    occurredAt: canonicalOccurredAt,
    run: patch,
  };
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
