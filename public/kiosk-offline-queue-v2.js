const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/iu;
const EVENT_TYPES = new Set(['start', 'block', 'resume', 'complete']);
const REASON_CODES = new Set([
  'sampleWaiting',
  'specConfirming',
  'deviceIssue',
  'talentWaiting',
  'siteIssue',
  'other',
]);
const SYNC_STATUSES = new Set(['synced', 'pending', 'conflict', 'reviewRequired']);
const CONFLICT_CODES = new Set([
  'REVISION_CONFLICT',
  'IDEMPOTENCY_KEY_REUSE',
  'RUN_ID_MISMATCH',
  'RUN_ID_REUSE',
  'SCHEDULE_ITEM_ID_MISMATCH',
  'RUN_PREPARATION_REQUIRED',
  'MULTIPLE_ACTIVE_RUNS',
  'MULTIPLE_CURRENT_CANDIDATES',
  'MULTIPLE_NEXT_CANDIDATES',
  'INVALID_RUN_TRANSITION',
  'EVENT_TIME_OUT_OF_ORDER',
]);
const ITEM_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'eventId',
  'runId',
  'scheduleItemId',
  'eventType',
  'expectedRunRevision',
  'occurredAt',
  'deviceId',
  'localSequence',
]);
const ITEM_KEYS = new Set([...ITEM_REQUIRED_KEYS, 'reasonCode', 'note']);
const STATE_KEYS = new Set([
  'schemaVersion',
  'nextLocalSequence',
  'syncStatus',
  'items',
  'cache',
]);
const CACHE_KEYS = new Set(['projectionRevision', 'lastSyncedAt']);
const RUN_STATES = new Set(['scheduled', 'shooting', 'blocked', 'completed', 'cancelled']);
const RESULT_FAILURE_CODES = new Set([
  'INVALID_JSON', 'INVALID_REQUEST', 'UNAUTHENTICATED', 'AUTH_NOT_CONFIGURED', 'FORBIDDEN',
  'RESOURCE_NOT_FOUND', 'SCHEDULE_ITEM_NOT_FOUND', 'RUN_NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSE', 'RUN_ID_MISMATCH', 'RUN_ID_REUSE',
  'SCHEDULE_ITEM_ID_MISMATCH', 'RUN_PREPARATION_REQUIRED',
  'MULTIPLE_ACTIVE_RUNS', 'MULTIPLE_CURRENT_CANDIDATES', 'MULTIPLE_NEXT_CANDIDATES',
  'INVALID_RUN_TRANSITION', 'EVENT_TIME_OUT_OF_ORDER',
  'INVALID_RUN_EVENT_COMMAND', 'INVALID_EVENT_ID', 'INVALID_EVENT_TIME',
  'INVALID_BLOCKING_REASON', 'BLOCKING_REASON_NOTE_REQUIRED',
  'EVENT_RECEIPT_INTEGRITY_ERROR', 'INTERNAL_ERROR', 'STORE_BUSY', 'SERVICE_UNAVAILABLE',
]);
const RESULT_STATUS_BY_CODE = Object.freeze({
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
const APPLIED_RESULT_KEYS = new Set([
  'schemaVersion', 'ok', 'code', 'replayed', 'eventId', 'runId',
  'previousState', 'resultingState', 'runRevision', 'projectionRevision',
  'scheduleRevision', 'startedAt', 'completedAt', 'grossDurationMs',
  'blockedDurationMs', 'netDurationMs', 'metricsAlgorithmVersion',
]);
const REVIEW_RESULT_KEYS = new Set([
  'schemaVersion', 'ok', 'code', 'replayed', 'eventId', 'runId', 'scheduleItemId',
  'reviewStatus', 'reviewReason', 'policyVersion', 'receivedAt',
]);
const CONFLICT_RESULT_KEYS = new Set([
  'schemaVersion', 'ok', 'code', 'replayed', 'eventId', 'runId', 'scope',
  'currentRunRevision',
]);
const FAILURE_RESULT_KEYS = new Set(['schemaVersion', 'ok', 'code', 'replayed']);
const CURRENT_KEYS = new Set([
  'schemaVersion', 'serverTime', 'projectionRevision', 'resourceId', 'current', 'next',
]);
const CURRENT_ITEM_KEYS = new Set([
  'scheduleItemId', 'allocationMode', 'plannedStart', 'plannedEnd', 'runId',
  'runRevision', 'runState', 'tasks', 'isGrouped', 'groupedNotice',
]);
const CURRENT_TASK_KEYS = new Set(['id', 'sku', 'name', 'summary', 'heroAssetId']);

function failure(code, details = {}) {
  return Object.freeze({ ok: false, code, ...details });
}

function exactKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => allowed.has(key)) && [...required].every(key => keys.includes(key));
}

function validIdentifier(value) {
  return typeof value === 'string' && [...value].length <= 160 && IDENTIFIER.test(value);
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number.isFinite(Date.parse(value));
}

function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validNullableRevision(value) {
  return value === null || validRevision(value);
}

function validNullableTimestamp(value) {
  return value === null || validTimestamp(value);
}

function validBoundedText(value, maximum) {
  return typeof value === 'string' && [...value].length >= 1
    && [...value].length <= maximum && /\S/u.test(value);
}

function validateCurrentTask(task) {
  if (!exactKeys(task, CURRENT_TASK_KEYS, new Set(['id', 'sku', 'name', 'summary']))) return false;
  return validIdentifier(task.id)
    && validBoundedText(task.sku, 120)
    && validBoundedText(task.name, 240)
    && validBoundedText(task.summary, 100)
    && (!Object.hasOwn(task, 'heroAssetId') || validIdentifier(task.heroAssetId));
}

function validateCurrentItem(item, { allowActive }) {
  if (!exactKeys(item, CURRENT_ITEM_KEYS) || !validIdentifier(item.scheduleItemId)) return false;
  if (!validTimestamp(item.plannedStart) || !validTimestamp(item.plannedEnd)) return false;
  if (Date.parse(item.plannedEnd) <= Date.parse(item.plannedStart)) return false;
  if (!Array.isArray(item.tasks) || item.tasks.length < 1 || !item.tasks.every(validateCurrentTask)) return false;
  const taskIds = new Set(item.tasks.map(task => task.id));
  if (taskIds.size !== item.tasks.length) return false;
  const grouped = item.allocationMode === 'grouped_unallocated';
  if (grouped) {
    if (item.tasks.length < 2 || item.isGrouped !== true || item.groupedNotice !== '组合场次，未拆分单任务工时') return false;
  } else if (
    item.allocationMode !== 'single'
    || item.tasks.length !== 1
    || item.isGrouped !== false
    || item.groupedNotice !== null
  ) return false;
  const candidate = item.runId === null
    && item.runRevision === 0
    && item.runState === 'scheduled';
  const active = allowActive
    && validIdentifier(item.runId)
    && Number.isSafeInteger(item.runRevision)
    && item.runRevision >= 1
    && ['shooting', 'blocked'].includes(item.runState);
  return candidate || active;
}

export function validateKioskCurrentResponse(value) {
  if (
    !exactKeys(value, CURRENT_KEYS)
    || value.schemaVersion !== 2
    || !validTimestamp(value.serverTime)
    || !validRevision(value.projectionRevision)
    || !validIdentifier(value.resourceId)
    || (value.current !== null && !validateCurrentItem(value.current, { allowActive: true }))
    || (value.next !== null && !validateCurrentItem(value.next, { allowActive: false }))
  ) return failure('INVALID_KIOSK_CURRENT_RESPONSE');
  const serverTime = Date.parse(value.serverTime);
  if (value.current?.runId === null) {
    const start = Date.parse(value.current.plannedStart);
    const end = Date.parse(value.current.plannedEnd);
    if (start > serverTime || serverTime >= end) return failure('INVALID_KIOSK_CURRENT_RESPONSE');
  }
  if (value.next && Date.parse(value.next.plannedStart) <= serverTime) {
    return failure('INVALID_KIOSK_CURRENT_RESPONSE');
  }
  if (value.current && value.next && (
    value.current.scheduleItemId === value.next.scheduleItemId
    || Date.parse(value.next.plannedStart) < Date.parse(value.current.plannedEnd)
  )) return failure('INVALID_KIOSK_CURRENT_RESPONSE');
  return { ok: true };
}

export function validateKioskRunEventResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 2) {
    return failure('INVALID_KIOSK_RUN_EVENT_RESPONSE');
  }
  if (value.code === 'RUN_EVENT_APPLIED') {
    if (!exactKeys(value, APPLIED_RESULT_KEYS)) return failure('INVALID_KIOSK_RUN_EVENT_RESPONSE');
    const valid = value.ok === true
      && typeof value.replayed === 'boolean'
      && typeof value.eventId === 'string'
      && EVENT_ID.test(value.eventId)
      && validIdentifier(value.runId)
      && RUN_STATES.has(value.previousState)
      && RUN_STATES.has(value.resultingState)
      && validRevision(value.runRevision)
      && validRevision(value.projectionRevision)
      && validRevision(value.scheduleRevision)
      && validNullableTimestamp(value.startedAt)
      && validNullableTimestamp(value.completedAt)
      && validNullableRevision(value.grossDurationMs)
      && validRevision(value.blockedDurationMs)
      && validNullableRevision(value.netDurationMs)
      && (value.metricsAlgorithmVersion === null
        || validBoundedText(value.metricsAlgorithmVersion, 160));
    return valid ? { ok: true } : failure('INVALID_KIOSK_RUN_EVENT_RESPONSE');
  }
  if (value.code === 'EVENT_TIME_REVIEW_REQUIRED') {
    const valid = exactKeys(value, REVIEW_RESULT_KEYS)
      && value.ok === false
      && typeof value.replayed === 'boolean'
      && typeof value.eventId === 'string'
      && EVENT_ID.test(value.eventId)
      && validIdentifier(value.runId)
      && validIdentifier(value.scheduleItemId)
      && value.reviewStatus === 'pending'
      && ['tooFarFuture', 'tooOld'].includes(value.reviewReason)
      && value.policyVersion === 'kiosk-event-time-local-v1'
      && validTimestamp(value.receivedAt);
    return valid ? { ok: true } : failure('INVALID_KIOSK_RUN_EVENT_RESPONSE');
  }
  if (value.code === 'REVISION_CONFLICT') {
    const valid = exactKeys(value, CONFLICT_RESULT_KEYS)
      && value.ok === false
      && value.replayed === false
      && typeof value.eventId === 'string'
      && EVENT_ID.test(value.eventId)
      && validIdentifier(value.runId)
      && value.scope === 'run'
      && validRevision(value.currentRunRevision);
    return valid ? { ok: true } : failure('INVALID_KIOSK_RUN_EVENT_RESPONSE');
  }
  const valid = exactKeys(value, FAILURE_RESULT_KEYS)
    && value.ok === false
    && value.replayed === false
    && RESULT_FAILURE_CODES.has(value.code);
  return valid ? { ok: true } : failure('INVALID_KIOSK_RUN_EVENT_RESPONSE');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateKioskQueueItem(value) {
  if (!exactKeys(value, ITEM_KEYS, ITEM_REQUIRED_KEYS)) return failure('INVALID_QUEUE_ITEM');
  if (
    value.schemaVersion !== 2
    || typeof value.eventId !== 'string'
    || !EVENT_ID.test(value.eventId)
    || !validIdentifier(value.runId)
    || !validIdentifier(value.scheduleItemId)
    || !EVENT_TYPES.has(value.eventType)
    || !validRevision(value.expectedRunRevision)
    || !validTimestamp(value.occurredAt)
    || !validIdentifier(value.deviceId)
    || !validRevision(value.localSequence)
  ) return failure('INVALID_QUEUE_ITEM');
  if (value.note !== undefined && (typeof value.note !== 'string' || [...value.note].length > 2000)) {
    return failure('INVALID_QUEUE_ITEM');
  }
  if (value.eventType === 'block') {
    if (!REASON_CODES.has(value.reasonCode)) return failure('INVALID_QUEUE_ITEM');
    if (value.reasonCode === 'other' && (
      typeof value.note !== 'string' || value.note.trim() === ''
    )) return failure('INVALID_QUEUE_ITEM');
  } else if (value.reasonCode !== undefined) {
    return failure('INVALID_QUEUE_ITEM');
  }
  return Object.freeze({ ok: true, item: clone(value) });
}

function validCache(cache) {
  return cache === null || (
    exactKeys(cache, CACHE_KEYS)
    && validRevision(cache.projectionRevision)
    && validTimestamp(cache.lastSyncedAt)
  );
}

function validateQueueState(value) {
  if (
    !exactKeys(value, STATE_KEYS)
    || value.schemaVersion !== 2
    || !validRevision(value.nextLocalSequence)
    || !SYNC_STATUSES.has(value.syncStatus)
    || !Array.isArray(value.items)
    || !validCache(value.cache)
  ) return failure('QUEUE_STATE_INVALID');
  if (
    (value.items.length === 0 && value.syncStatus !== 'synced')
    || (value.items.length > 0 && value.syncStatus === 'synced')
  ) return failure('QUEUE_STATE_INVALID');

  const eventIds = new Set();
  let priorSequence = null;
  for (const rawItem of value.items) {
    const validation = validateKioskQueueItem(rawItem);
    if (!validation.ok || eventIds.has(rawItem.eventId)) return failure('QUEUE_STATE_INVALID');
    if (priorSequence !== null && rawItem.localSequence !== priorSequence + 1) {
      return failure('QUEUE_STATE_INVALID');
    }
    eventIds.add(rawItem.eventId);
    priorSequence = rawItem.localSequence;
  }
  if (priorSequence !== null && value.nextLocalSequence !== priorSequence + 1) {
    return failure('QUEUE_STATE_INVALID');
  }
  return Object.freeze({ ok: true, state: clone(value) });
}

function initialState() {
  return {
    schemaVersion: 2,
    nextLocalSequence: 0,
    syncStatus: 'synced',
    items: [],
    cache: null,
  };
}

function notRefreshed() {
  return Object.freeze({ kind: 'notRefreshed', current: null });
}

function outcome(state, serverStatus, extra = {}) {
  return Object.freeze({
    ok: true,
    syncStatus: state.syncStatus,
    serverStatus,
    pendingCount: state.items.length,
    cache: clone(state.cache),
    ...extra,
  });
}

function stateFailure(code) {
  return failure(code, {
    syncStatus: 'reviewRequired',
    serverStatus: notRefreshed(),
    pendingCount: null,
    cache: null,
  });
}

function itemFingerprint(item) {
  return JSON.stringify(Object.fromEntries(
    [...ITEM_KEYS].toSorted()
      .filter(key => Object.hasOwn(item, key))
      .map(key => [key, item[key]]),
  ));
}

function reloadHead(storage, submittedHead) {
  const loaded = loadState(storage);
  if (!loaded.ok) return loaded;
  const index = loaded.state.items.findIndex(item => item.eventId === submittedHead.eventId);
  if (index === -1) return { ok: true, state: loaded.state, headPresent: false };
  if (index !== 0 || itemFingerprint(loaded.state.items[0]) !== itemFingerprint(submittedHead)) {
    return stateFailure('QUEUE_STATE_INVALID');
  }
  return { ok: true, state: loaded.state, headPresent: true };
}

function loadState(storage) {
  let raw;
  try {
    raw = storage.load();
  } catch {
    return stateFailure('QUEUE_STATE_INVALID');
  }
  if (raw === null || raw === undefined) return { ok: true, state: initialState() };
  const validation = validateQueueState(raw);
  return validation.ok ? validation : stateFailure(validation.code);
}

function commitState(storage, baseState, nextState) {
  const validation = validateQueueState(nextState);
  if (!validation.ok) return failure(validation.code);
  try {
    const committed = storage.commit({
      baseState: clone(baseState),
      nextState: clone(validation.state),
    });
    const committedValidation = validateQueueState(committed);
    if (!committedValidation.ok) return failure('QUEUE_STATE_INVALID');
    return { ok: true, state: committedValidation.state };
  } catch {
    return failure('QUEUE_STORAGE_WRITE_FAILED');
  }
}

function clockTimestamp(clock) {
  try {
    const value = clock()?.toISOString?.();
    return validTimestamp(value) ? value : null;
  } catch {
    return null;
  }
}

function validRefreshBody(body, resourceId) {
  return validateKioskCurrentResponse(body).ok && body.resourceId === resourceId;
}

function applied(response, head) {
  const exactStatus = (response?.status === 201 && response?.body?.replayed === false)
    || (response?.status === 200 && response?.body?.replayed === true);
  return validateKioskRunEventResponse(response?.body).ok
    && response.body.ok === true
    && response.body.code === 'RUN_EVENT_APPLIED'
    && exactStatus
    && response.body.eventId === head.eventId
    && response.body.runId === head.runId;
}

function reviewRequired(response, head) {
  return validateKioskRunEventResponse(response?.body).ok
    && response.body.ok === false
    && response.body.code === 'EVENT_TIME_REVIEW_REQUIRED'
    && response.body.eventId === head.eventId
    && response.body.runId === head.runId
    && response.body.scheduleItemId === head.scheduleItemId
    && response.status === 202;
}

function protocolFailure(response) {
  return !response
    || !Number.isInteger(response.status)
    || response.status < 100
    || response.status > 599
    || !response.body
    || typeof response.body !== 'object'
    || Array.isArray(response.body);
}

function validResultHttpStatus(response) {
  if (response.body.code === 'RUN_EVENT_APPLIED') {
    return (response.status === 201 && response.body.replayed === false)
      || (response.status === 200 && response.body.replayed === true);
  }
  if (response.body.code === 'EVENT_TIME_REVIEW_REQUIRED') return response.status === 202;
  if (response.body.code === 'REVISION_CONFLICT') return response.status === 409;
  return RESULT_STATUS_BY_CODE[response.body.code] === response.status;
}

export function createBrowserQueueStorage({
  storage,
  key = 'jenn.kiosk.offline-queue.v2',
} = {}) {
  if (
    !storage
    || typeof storage.getItem !== 'function'
    || typeof storage.setItem !== 'function'
    || typeof storage.removeItem !== 'function'
    || typeof storage.key !== 'function'
    || !Number.isInteger(storage.length)
  ) {
    throw new TypeError('localStorage-compatible storage is required');
  }
  if (typeof key !== 'string' || key === '') throw new TypeError('storage key is required');
  const metaKey = `${key}.meta`;
  const itemPrefix = `${key}.item.`;
  const sequencePrefix = `${key}.sequence.`;
  const terminalPrefix = `${key}.terminal.`;

  function itemKey(item) {
    return `${itemPrefix}${String(item.localSequence).padStart(16, '0')}.${encodeURIComponent(item.eventId)}`;
  }

  function sequenceKey(sequence) {
    return `${sequencePrefix}${String(sequence).padStart(16, '0')}`;
  }

  function terminalKey(eventId) {
    return `${terminalPrefix}${encodeURIComponent(eventId)}`;
  }

  function readSequenceMarkers() {
    const markers = new Map();
    const eventIds = new Set();
    for (let index = 0; index < storage.length; index += 1) {
      const candidate = storage.key(index);
      if (typeof candidate !== 'string' || !candidate.startsWith(sequencePrefix)) continue;
      const marker = JSON.parse(storage.getItem(candidate));
      if (
        !exactKeys(marker, new Set(['schemaVersion', 'localSequence', 'eventId']))
        || marker.schemaVersion !== 2
        || !validRevision(marker.localSequence)
        || typeof marker.eventId !== 'string'
        || !EVENT_ID.test(marker.eventId)
        || candidate !== sequenceKey(marker.localSequence)
        || markers.has(marker.localSequence)
        || eventIds.has(marker.eventId)
      ) throw new Error('QUEUE_STATE_INVALID');
      markers.set(marker.localSequence, marker.eventId);
      eventIds.add(marker.eventId);
    }
    return markers;
  }

  function readItems(markers) {
    const items = [];
    for (let index = 0; index < storage.length; index += 1) {
      const candidate = storage.key(index);
      if (typeof candidate !== 'string' || !candidate.startsWith(itemPrefix)) continue;
      const parsed = JSON.parse(storage.getItem(candidate));
      const validation = validateKioskQueueItem(parsed);
      if (
        !validation.ok
        || candidate !== itemKey(validation.item)
        || markers.get(validation.item.localSequence) !== validation.item.eventId
      ) throw new Error('QUEUE_STATE_INVALID');
      items.push(validation.item);
    }
    return items.toSorted((left, right) => left.localSequence - right.localSequence);
  }

  function readMeta() {
    const raw = storage.getItem(metaKey);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (
      !exactKeys(parsed, new Set(['schemaVersion', 'nextLocalSequence', 'cache']))
      || parsed.schemaVersion !== 2
      || !validRevision(parsed.nextLocalSequence)
      || !validCache(parsed.cache)
    ) {
      throw new Error('QUEUE_STATE_INVALID');
    }
    return parsed;
  }

  function readTerminal(item) {
    if (!item) return null;
    const raw = storage.getItem(terminalKey(item.eventId));
    if (raw === null) return null;
    const marker = JSON.parse(raw);
    if (
      !exactKeys(marker, new Set(['schemaVersion', 'eventId', 'syncStatus']))
      || marker.schemaVersion !== 2
      || marker.eventId !== item.eventId
      || !['conflict', 'reviewRequired'].includes(marker.syncStatus)
    ) throw new Error('QUEUE_STATE_INVALID');
    return marker.syncStatus;
  }

  function loadFromRecords() {
    const markers = readSequenceMarkers();
    const items = readItems(markers);
    const meta = readMeta();
    if (meta === null && items.length === 0 && markers.size === 0) return null;
    let minimumNext = 0;
    for (const sequence of markers.keys()) minimumNext = Math.max(minimumNext, sequence + 1);
    const nextLocalSequence = Math.max(meta?.nextLocalSequence ?? 0, minimumNext);
    const terminalStatus = readTerminal(items[0]);
    return {
      schemaVersion: 2,
      nextLocalSequence,
      syncStatus: items.length === 0 ? 'synced' : terminalStatus ?? 'pending',
      items,
      cache: meta?.cache ?? null,
    };
  }

  return Object.freeze({
    load() {
      return loadFromRecords();
    },
    commit({ baseState, nextState }) {
      const base = validateQueueState(baseState);
      const next = validateQueueState(nextState);
      if (!base.ok || !next.ok) throw new Error('QUEUE_STATE_INVALID');
      const nextIds = new Set(next.state.items.map(item => item.eventId));
      for (const item of base.state.items) {
        if (!nextIds.has(item.eventId)) {
          storage.removeItem(itemKey(item));
          storage.removeItem(terminalKey(item.eventId));
        }
      }
      const baseIds = new Set(base.state.items.map(item => item.eventId));
      for (const item of next.state.items) {
        if (!baseIds.has(item.eventId)) {
          const markerTarget = sequenceKey(item.localSequence);
          const marker = storage.getItem(markerTarget);
          if (marker !== null) {
            const parsed = JSON.parse(marker);
            if (parsed.eventId !== item.eventId) throw new Error('QUEUE_STATE_INVALID');
          } else {
            storage.setItem(markerTarget, JSON.stringify({
              schemaVersion: 2,
              localSequence: item.localSequence,
              eventId: item.eventId,
            }));
          }
          const target = itemKey(item);
          const existing = storage.getItem(target);
          if (existing !== null) {
            if (itemFingerprint(JSON.parse(existing)) !== itemFingerprint(item)) {
              throw new Error('QUEUE_STATE_INVALID');
            }
          } else {
            storage.setItem(target, JSON.stringify(item));
          }
        }
      }
      const current = loadFromRecords() ?? initialState();
      const cache = !current.cache || (
        next.state.cache
        && next.state.cache.projectionRevision >= current.cache.projectionRevision
      ) ? next.state.cache : current.cache;
      const nextTerminal = ['conflict', 'reviewRequired'].includes(next.state.syncStatus)
        && current.items[0]?.eventId === next.state.items[0]?.eventId;
      if (nextTerminal && readTerminal(current.items[0]) === null) {
        storage.setItem(terminalKey(current.items[0].eventId), JSON.stringify({
          schemaVersion: 2,
          eventId: current.items[0].eventId,
          syncStatus: next.state.syncStatus,
        }));
      }
      storage.setItem(metaKey, JSON.stringify({
        schemaVersion: 2,
        nextLocalSequence: Math.max(current.nextLocalSequence, next.state.nextLocalSequence),
        cache,
      }));
      return loadFromRecords() ?? initialState();
    },
  });
}

export function createFetchKioskTransport({
  fetchImpl,
  currentUrl = '/api/v2/kiosk/current',
  eventUrlForScheduleItem = scheduleItemId => (
    `/api/v2/schedule-items/${encodeURIComponent(scheduleItemId)}/events`
  ),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  if (typeof currentUrl !== 'string' || currentUrl === '') throw new TypeError('currentUrl is required');
  if (typeof eventUrlForScheduleItem !== 'function') {
    throw new TypeError('eventUrlForScheduleItem is required');
  }
  return Object.freeze({
    async refreshCurrent({ resourceId, projectionRevision }) {
      const separator = currentUrl.includes('?') ? '&' : '?';
      const headers = {};
      if (validRevision(projectionRevision)) {
        headers['If-None-Match'] = `"projection-${projectionRevision}"`;
      }
      const response = await fetchImpl(
        `${currentUrl}${separator}resourceId=${encodeURIComponent(resourceId)}`,
        { method: 'GET', headers },
      );
      if (response.status === 304) return { status: 304, body: null };
      return { status: response.status, body: await response.json() };
    },
    async submitEvent(item) {
      const response = await fetchImpl(eventUrlForScheduleItem(item.scheduleItemId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      return { status: response.status, body: await response.json() };
    },
  });
}

export function createKioskOfflineQueue({ storage, transport, clock } = {}) {
  if (!storage || typeof storage.load !== 'function' || typeof storage.commit !== 'function') {
    throw new TypeError('queue storage is required');
  }
  if (
    !transport
    || typeof transport.refreshCurrent !== 'function'
    || typeof transport.submitEvent !== 'function'
  ) throw new TypeError('queue transport is required');
  if (typeof clock !== 'function') throw new TypeError('clock is required');

  return Object.freeze({
    inspect() {
      const loaded = loadState(storage);
      if (!loaded.ok) return loaded;
      return outcome(loaded.state, notRefreshed(), { items: clone(loaded.state.items) });
    },

    enqueue(rawItem) {
      const loaded = loadState(storage);
      if (!loaded.ok) return loaded;
      if (['conflict', 'reviewRequired'].includes(loaded.state.syncStatus)) {
        return failure('QUEUE_REPLAY_BLOCKED', { syncStatus: loaded.state.syncStatus });
      }
      const validation = validateKioskQueueItem(rawItem);
      if (!validation.ok) return validation;
      if (rawItem.localSequence !== loaded.state.nextLocalSequence) {
        return failure('LOCAL_SEQUENCE_MISMATCH', {
          expectedLocalSequence: loaded.state.nextLocalSequence,
        });
      }
      if (loaded.state.items.some(item => item.eventId === rawItem.eventId)) {
        return failure('DUPLICATE_EVENT_ID');
      }
      if (loaded.state.nextLocalSequence === Number.MAX_SAFE_INTEGER) {
        return failure('LOCAL_SEQUENCE_EXHAUSTED');
      }
      const nextState = {
        ...loaded.state,
        nextLocalSequence: loaded.state.nextLocalSequence + 1,
        syncStatus: 'pending',
        items: [...loaded.state.items, validation.item],
      };
      const saved = commitState(storage, loaded.state, nextState);
      if (!saved.ok) return saved;
      return Object.freeze({
        ok: true,
        syncStatus: 'pending',
        pendingCount: saved.state.items.length,
        item: clone(validation.item),
      });
    },

    async replay({ resourceId } = {}) {
      if (!validIdentifier(resourceId)) return stateFailure('INVALID_RESOURCE_ID');
      const loaded = loadState(storage);
      if (!loaded.ok) return loaded;
      let state = loaded.state;
      let refresh;
      try {
        refresh = await transport.refreshCurrent({
          resourceId,
          projectionRevision: state.cache?.projectionRevision,
        });
      } catch {
        return outcome(state, { kind: 'unavailable', current: null }, { processed: 0 });
      }
      if (
        !refresh
        || !Number.isInteger(refresh.status)
        || ![200, 304].includes(refresh.status)
      ) return outcome(state, { kind: 'unavailable', current: null }, { processed: 0 });

      const syncedAt = clockTimestamp(clock);
      if (syncedAt === null) return stateFailure('INVALID_CLIENT_TIME');
      let serverStatus;
      let projectionRevision = state.cache?.projectionRevision;
      if (refresh.status === 304) {
        if (!validRevision(projectionRevision)) {
          return outcome(state, { kind: 'unavailable', current: null }, { processed: 0 });
        }
        serverStatus = { kind: 'unchanged', current: null };
      } else {
        if (!validRefreshBody(refresh.body, resourceId)) {
          return outcome(state, { kind: 'unavailable', current: null }, { processed: 0 });
        }
        projectionRevision = refresh.body.projectionRevision;
        serverStatus = { kind: 'fresh', current: clone(refresh.body) };
      }
      // refreshCurrent crosses an async boundary. Reload before persisting the
      // cache so an enqueue completed by another controller is never replaced
      // by this replay's older snapshot.
      const latestAfterRefresh = loadState(storage);
      if (!latestAfterRefresh.ok) return latestAfterRefresh;
      const refreshedState = {
        ...latestAfterRefresh.state,
        cache: { projectionRevision, lastSyncedAt: syncedAt },
      };
      const refreshedSave = commitState(storage, latestAfterRefresh.state, refreshedState);
      if (!refreshedSave.ok) return stateFailure(refreshedSave.code);
      state = refreshedSave.state;

      if (['conflict', 'reviewRequired'].includes(state.syncStatus)) {
        return outcome(state, serverStatus, { processed: 0 });
      }

      let processed = 0;
      while (state.items.length > 0) {
        const head = deepFreeze(clone(state.items[0]));
        let response;
        try {
          response = await transport.submitEvent(deepFreeze(clone(head)));
        } catch {
          const latest = loadState(storage);
          return latest.ok
            ? outcome(latest.state, serverStatus, { processed })
            : latest;
        }
        const latest = reloadHead(storage, head);
        if (!latest.ok) return latest;
        state = latest.state;
        if (protocolFailure(response) || response.status >= 500) {
          return outcome(state, serverStatus, { processed });
        }
        if (
          !validateKioskRunEventResponse(response.body).ok
          || !validResultHttpStatus(response)
        ) {
          return outcome(state, serverStatus, { processed });
        }
        if (applied(response, head)) {
          if (!latest.headPresent) {
            processed += 1;
            continue;
          }
          if (['conflict', 'reviewRequired'].includes(state.syncStatus)) {
            return outcome(state, serverStatus, { processed });
          }
          const remaining = state.items.slice(1);
          const nextState = {
            ...state,
            syncStatus: remaining.length === 0 ? 'synced' : 'pending',
            items: remaining,
          };
          const saved = commitState(storage, state, nextState);
          if (!saved.ok) return outcome(state, serverStatus, { processed });
          state = saved.state;
          processed += 1;
          continue;
        }
        if (reviewRequired(response, head)) {
          if (!latest.headPresent) continue;
          const nextState = { ...state, syncStatus: 'reviewRequired' };
          const saved = commitState(storage, state, nextState);
          if (!saved.ok) return outcome(state, serverStatus, { processed });
          return outcome(saved.state, serverStatus, {
            processed,
            stopCode: 'EVENT_TIME_REVIEW_REQUIRED',
          });
        }
        if (
          (response.status >= 400 && response.status < 500)
          || CONFLICT_CODES.has(response.body.code)
        ) {
          if (!latest.headPresent) continue;
          const nextState = { ...state, syncStatus: 'conflict' };
          const saved = commitState(storage, state, nextState);
          if (!saved.ok) return outcome(state, serverStatus, { processed });
          return outcome(saved.state, serverStatus, {
            processed,
            stopCode: typeof response.body.code === 'string' ? response.body.code : 'QUEUE_CONFLICT',
          });
        }
        return outcome(state, serverStatus, { processed });
      }
      return outcome(state, serverStatus, { processed });
    },
  });
}
