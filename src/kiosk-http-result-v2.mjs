import {
  validateKioskCurrent,
  validateKioskRunEventResult,
} from './kiosk-contract-validator-v2.mjs';

const STATUS_BY_FAILURE_CODE = Object.freeze({
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  AUTH_NOT_CONFIGURED: 401,
  FORBIDDEN: 403,
  RESOURCE_NOT_FOUND: 404,
  SCHEDULE_ITEM_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSE: 409,
  RUN_ID_MISMATCH: 409,
  RUN_ID_REUSE: 409,
  SCHEDULE_ITEM_ID_MISMATCH: 409,
  RUN_PREPARATION_REQUIRED: 409,
  MULTIPLE_ACTIVE_RUNS: 409,
  MULTIPLE_CURRENT_CANDIDATES: 409,
  MULTIPLE_NEXT_CANDIDATES: 409,
  INVALID_RUN_TRANSITION: 409,
  EVENT_TIME_OUT_OF_ORDER: 409,
  INVALID_RUN_EVENT_COMMAND: 422,
  INVALID_EVENT_ID: 422,
  INVALID_EVENT_TIME: 422,
  INVALID_BLOCKING_REASON: 422,
  BLOCKING_REASON_NOTE_REQUIRED: 422,
  EVENT_RECEIPT_INTEGRITY_ERROR: 500,
  INTERNAL_ERROR: 500,
  STORE_BUSY: 503,
  SERVICE_UNAVAILABLE: 503,
});

const APPLIED_FIELDS = Object.freeze([
  'eventId',
  'runId',
  'previousState',
  'resultingState',
  'runRevision',
  'projectionRevision',
  'scheduleRevision',
  'startedAt',
  'completedAt',
  'grossDurationMs',
  'blockedDurationMs',
  'netDurationMs',
  'metricsAlgorithmVersion',
]);

const REVIEW_FIELDS = Object.freeze([
  'eventId',
  'runId',
  'scheduleItemId',
  'reviewStatus',
  'reviewReason',
  'policyVersion',
  'receivedAt',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(source, fields) {
  return Object.fromEntries(fields.map(field => [field, source[field]]));
}

function internalError() {
  return {
    status: 500,
    body: {
      schemaVersion: 2,
      ok: false,
      code: 'INTERNAL_ERROR',
      replayed: false,
    },
  };
}

function schemaChecked(status, body) {
  return validateKioskRunEventResult(body).ok ? { status, body } : internalError();
}

function hasValidReplayFlag(value) {
  return value.replayed === undefined || typeof value.replayed === 'boolean';
}

export function mapKioskRunEventHttpResult(useCaseResult) {
  if (!isRecord(useCaseResult)) return internalError();

  if (useCaseResult.ok === true && useCaseResult.code === 'RUN_EVENT_APPLIED') {
    if (!hasValidReplayFlag(useCaseResult)) return internalError();
    const replayed = useCaseResult.replayed === true;
    return schemaChecked(replayed ? 200 : 201, {
      schemaVersion: 2,
      ok: true,
      code: 'RUN_EVENT_APPLIED',
      replayed,
      ...pick(useCaseResult, APPLIED_FIELDS),
    });
  }

  if (useCaseResult.ok === false && useCaseResult.code === 'EVENT_TIME_REVIEW_REQUIRED') {
    if (!hasValidReplayFlag(useCaseResult)) return internalError();
    return schemaChecked(202, {
      schemaVersion: 2,
      ok: false,
      code: 'EVENT_TIME_REVIEW_REQUIRED',
      replayed: useCaseResult.replayed === true,
      ...pick(useCaseResult, REVIEW_FIELDS),
    });
  }

  if (useCaseResult.ok === false && useCaseResult.code === 'REVISION_CONFLICT') {
    return schemaChecked(409, {
      schemaVersion: 2,
      ok: false,
      code: 'REVISION_CONFLICT',
      replayed: false,
      eventId: useCaseResult.eventId,
      runId: useCaseResult.runId,
      scope: 'run',
      currentRunRevision: useCaseResult.currentRevision,
    });
  }

  const status = useCaseResult.ok === false ? STATUS_BY_FAILURE_CODE[useCaseResult.code] : undefined;
  if (status === undefined) return internalError();
  return schemaChecked(status, {
    schemaVersion: 2,
    ok: false,
    code: useCaseResult.code,
    replayed: false,
  });
}

export function mapKioskCurrentHttpResult(current, { unchanged = false } = {}) {
  if (unchanged === true) return { status: 304, body: null };
  if (unchanged !== false || !validateKioskCurrent(current).ok) return internalError();
  return { status: 200, body: current };
}

export { STATUS_BY_FAILURE_CODE as KIOSK_HTTP_STATUS_BY_FAILURE_CODE };
