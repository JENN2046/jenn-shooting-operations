const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

const REQUEST_KEYS = Object.freeze(['requestId', 'priority', 'productionType', 'desiredDate']);
const SCHEDULE_KEYS = Object.freeze([
  'scheduleItemId', 'resourceId', 'plannedStart', 'plannedEnd', 'taskCount', 'scheduleRevision',
]);
const COMPLETION_KEYS = Object.freeze([
  'runId', 'scheduleItemId', 'resourceId', 'scope', 'taskCount', 'completedAt',
  'netDurationMs', 'runRevision',
]);

export const DINGTALK_CARD_SCHEMA_V1 = Object.freeze({
  requestSubmitted: 'request-submitted-card-v1',
  scheduleConfirmed: 'schedule-confirmed-card-v1',
  productionRunCompleted: 'production-run-completed-card-v1',
});

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const allowed = new Set(expected);
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every(key => allowed.has(key));
}

function exactKeySet(value, expected) {
  if (!isRecord(value)) return false;
  const allowed = new Set(expected);
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every(key => allowed.has(key));
}

function validIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= 128
    && /\S/u.test(value)
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

function daysInMonth(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function validCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function timestampMillis(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function safeCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalid() {
  return Object.freeze({ ok: false, code: 'DINGTALK_CARD_INVALID' });
}

function success(cardSchemaVersion, card) {
  return Object.freeze({ ok: true, cardSchemaVersion, card: Object.freeze(card) });
}

function validRequestCard(input) {
  return exactKeySet(input, REQUEST_KEYS)
    && validIdentifier(input.requestId)
    && ['p0', 'p1', 'p2'].includes(input.priority)
    && ['平面', '视频'].includes(input.productionType)
    && validCalendarDate(input.desiredDate);
}

function validScheduleCard(input) {
  const start = timestampMillis(input?.plannedStart);
  const end = timestampMillis(input?.plannedEnd);
  return exactKeySet(input, SCHEDULE_KEYS)
    && validIdentifier(input.scheduleItemId)
    && validIdentifier(input.resourceId)
    && start !== null
    && end !== null
    && end > start
    && safeCounter(input.taskCount)
    && safeCounter(input.scheduleRevision);
}

function validCompletionCard(input) {
  return exactKeySet(input, COMPLETION_KEYS)
    && validIdentifier(input.runId)
    && validIdentifier(input.scheduleItemId)
    && validIdentifier(input.resourceId)
    && ['task', 'block'].includes(input.scope)
    && safeCounter(input.taskCount)
    && ((input.scope === 'task' && input.taskCount === 1) || (input.scope === 'block' && input.taskCount >= 2))
    && timestampMillis(input.completedAt) !== null
    && safeCounter(input.netDurationMs)
    && safeCounter(input.runRevision);
}

export function buildRequestSubmittedCardV1(input) {
  if (!validRequestCard(input)) return invalid();
  return success(DINGTALK_CARD_SCHEMA_V1.requestSubmitted, {
    requestId: input.requestId,
    priority: input.priority,
    productionType: input.productionType,
    desiredDate: input.desiredDate,
  });
}

export function buildScheduleConfirmedCardV1(input) {
  if (!validScheduleCard(input)) return invalid();
  return success(DINGTALK_CARD_SCHEMA_V1.scheduleConfirmed, {
    scheduleItemId: input.scheduleItemId,
    resourceId: input.resourceId,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd,
    taskCount: input.taskCount,
    scheduleRevision: input.scheduleRevision,
  });
}

export function buildProductionRunCompletedCardV1(input) {
  if (!validCompletionCard(input)) return invalid();
  return success(DINGTALK_CARD_SCHEMA_V1.productionRunCompleted, {
    runId: input.runId,
    scheduleItemId: input.scheduleItemId,
    resourceId: input.resourceId,
    scope: input.scope,
    taskCount: input.taskCount,
    completedAt: input.completedAt,
    netDurationMs: input.netDurationMs,
    runRevision: input.runRevision,
  });
}

export function validateDingTalkCardV1(card) {
  if (exactKeys(card, REQUEST_KEYS) && validRequestCard(card)) {
    return Object.freeze({ ok: true, cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.requestSubmitted });
  }
  if (exactKeys(card, SCHEDULE_KEYS) && validScheduleCard(card)) {
    return Object.freeze({ ok: true, cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.scheduleConfirmed });
  }
  if (exactKeys(card, COMPLETION_KEYS) && validCompletionCard(card)) {
    return Object.freeze({ ok: true, cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.productionRunCompleted });
  }
  return invalid();
}
