import { createHash } from 'node:crypto';

const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONTROLLED_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const INPUT_KEYS = Object.freeze([
  'schemaVersion', 'planningWindowStart', 'planningWindowEnd', 'businessTimeZone',
  'baseScheduleRevision', 'algorithmVersion', 'calendarCompilerVersion',
  'timeZoneDataVersion', 'estimatePolicyVersion', 'configVersion', 'configDigest', 'resources', 'candidates',
  'occupied', 'activeRuns', 'durationStats',
]);
const RESOURCE_KEYS = Object.freeze([
  'resourceId', 'v1DisplayPlace', 'status', 'capabilityJson', 'capabilityDigest', 'businessWindows',
]);
const RESOURCE_CAPABILITY_KEYS = Object.freeze(['schemaVersion', 'capabilityIds']);
const WINDOW_KEYS = Object.freeze(['start', 'end']);
const CANDIDATE_KEYS = Object.freeze([
  'requestId', 'sourceOrdinal', 'requestLifecycle', 'lifecycleProvenance',
  'nonCancelledScheduleItemIds', 'productionType', 'shootingSubtype', 'desiredDate',
  'sampleStatus', 'lightingPreset', 'reflectivity', 'priority', 'requiredCapabilityIds',
  'durationEstimate', 'factProvenance',
]);
const FACT_PROVENANCE_KEYS = Object.freeze([
  'productionType', 'shootingSubtype', 'desiredDate', 'sampleStatus', 'lightingPreset',
  'reflectivity', 'priority', 'requiredCapabilityIds', 'durationEstimate',
]);
const DURATION_ESTIMATE_KEYS = Object.freeze(['durationMs', 'source', 'sourceVersion']);
const OCCUPIED_KEYS = Object.freeze([
  'scheduleItemId', 'sourceOrdinal', 'resourceId', 'resourceResolutionStatus', 'allocationMode',
  'taskBindings', 'plannedStart', 'plannedEnd', 'bufferAfterMinutes', 'bufferSource',
  'scheduleStatus', 'lockStatus', 'lockStatusProvenance', 'source',
]);
const TASK_BINDING_KEYS = Object.freeze(['requestId', 'displayOrder']);
const ACTIVE_RUN_KEYS = Object.freeze(['runId', 'scheduleItemId', 'status']);
const DURATION_STAT_KEYS = Object.freeze([
  'statId', 'resourceId', 'productionType', 'shootingSubtype', 'lightingPreset',
  'reflectivity', 'sampleCount', 'estimateDurationMs', 'metricVersion',
]);
const PROPOSED_ITEM_INPUT_KEYS = Object.freeze([
  'requestId', 'resourceId', 'plannedStart', 'plannedEnd', 'durationMs',
  'bufferAfterMinutes', 'durationSource', 'durationSourceVersion', 'bufferRuleId', 'configVersion',
]);
const PROPOSED_ITEM_KEYS = Object.freeze(['proposalItemId', ...PROPOSED_ITEM_INPUT_KEYS]);
const DIAGNOSTIC_INPUT_KEYS = Object.freeze([
  'code', 'requestId', 'resourceId', 'scheduleItemId', 'fieldPath',
]);
const DIAGNOSTIC_KEYS = Object.freeze(['severity', ...DIAGNOSTIC_INPUT_KEYS]);
const RESULT_INPUT_KEYS = Object.freeze([
  'algorithmVersion', 'configVersion', 'configDigest', 'calendarCompilerVersion',
  'timeZoneDataVersion', 'estimatePolicyVersion', 'proposedItems', 'diagnostics',
]);

export const SCHEDULING_INPUT_SCHEMA_V1 = 1;
export const SCHEDULING_RESULT_SCHEMA_V1 = 1;
export const SCHEDULING_CALENDAR_COMPILER_VERSION_V1 = 'calendar-compiler-v1';
export const SCHEDULING_TIME_ZONE_DATA_VERSION = process.versions.tz ?? null;

export const SCHEDULING_HARD_DIAGNOSTIC_CODES_V1 = Object.freeze([
  'SAMPLE_NOT_VERIFIED',
  'PRIORITY_UNKNOWN',
  'DURATION_UNKNOWN',
  'RESOURCE_UNKNOWN',
  'RESOURCE_INACTIVE',
  'RESOURCE_CAPABILITY_MISMATCH',
  'RESOURCE_OVERLAP',
  'OUTSIDE_BUSINESS_CALENDAR',
  'LOCKED_INTERVAL_CONFLICT',
  'UNRESOLVED_LEGACY_BLOCK',
  'LEGACY_BUFFER_UNKNOWN',
  'V1_DATE_BOUNDARY',
]);

export const SCHEDULING_SOFT_DIAGNOSTIC_CODES_V1 = Object.freeze([
  'LIGHTING_SWITCH',
  'REFLECTIVITY_SEQUENCE',
  'IDLE_GAP',
  'EXPECTED_OVERRUN',
  'DESIRED_DATE_MISS',
]);

export const SCHEDULING_DIAGNOSTIC_FIELD_PATHS_V1 = Object.freeze([
  '$.candidates[].sampleStatus',
  '$.candidates[].priority',
  '$.candidates[].durationEstimate',
  '$.candidates[].requiredCapabilityIds',
  '$.candidates[].desiredDate',
  '$.resources[]',
  '$.resources[].status',
  '$.resources[].capabilityJson',
  '$.resources[].businessWindows',
  '$.occupied[]',
  '$.occupied[].resourceId',
  '$.occupied[].lockStatus',
  '$.occupied[].bufferAfterMinutes',
  '$.occupied[].bufferSource',
  '$.planningWindowEnd',
]);

const HARD_CODES = new Set(SCHEDULING_HARD_DIAGNOSTIC_CODES_V1);
const SOFT_CODES = new Set(SCHEDULING_SOFT_DIAGNOSTIC_CODES_V1);
const DIAGNOSTIC_PATHS = new Set(SCHEDULING_DIAGNOSTIC_FIELD_PATHS_V1);
const PRODUCTION_TYPES = new Set(['平面', '视频']);
const FLAT_SUBTYPES = new Set(['模特', '细节', '场景', '待定']);
const VIDEO_SUBTYPES = new Set(['产品展示', '人物展示', '产品加人物展示', '口播', '剧情短片', '场景视频']);
const ALL_SUBTYPES = new Set([...FLAT_SUBTYPES, ...VIDEO_SUBTYPES]);

class AdmissionError extends Error {
  constructor(reason, path) {
    super('SCHEDULING_CONTRACT_INVALID');
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason, path) {
  throw new AdmissionError(reason, path);
}

function codePointCompare(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function ownDataKeys(value) {
  if (!isRecord(value)) throw new TypeError('CANONICAL_JSON_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || UNSAFE_KEYS.has(key) || UNPAIRED_SURROGATE.test(key))) {
    throw new TypeError('CANONICAL_JSON_INVALID');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('CANONICAL_JSON_INVALID');
    }
  }
  return keys;
}

function ownArrayValues(value) {
  if (!Array.isArray(value)) throw new TypeError('CANONICAL_JSON_INVALID');
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)))) {
    throw new TypeError('CANONICAL_JSON_INVALID');
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('CANONICAL_JSON_INVALID');
    }
    values.push(descriptor.value);
  }
  return values;
}

function canonical(value, ancestors) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (UNPAIRED_SURROGATE.test(value)) throw new TypeError('CANONICAL_JSON_INVALID');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('CANONICAL_JSON_INVALID');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new TypeError('CANONICAL_JSON_INVALID');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${ownArrayValues(value).map(item => canonical(item, ancestors)).join(',')}]`;
    }
    const keys = ownDataKeys(value).toSorted(codePointCompare);
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key], ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonSchedulingV1(value) {
  return canonical(value, new WeakSet());
}

export function digestCanonicalJsonSchedulingV1(value) {
  return `sha256:${createHash('sha256').update(canonicalJsonSchedulingV1(value), 'utf8').digest('hex')}`;
}

function exactRecord(value, expected, path) {
  let keys;
  try {
    keys = ownDataKeys(value);
  } catch {
    fail('EXACT_KEYS', path);
  }
  if (keys.length !== expected.length) fail('EXACT_KEYS', path);
  const allowed = new Set(expected);
  if (keys.some(key => !allowed.has(key))) fail('EXACT_KEYS', path);
  return value;
}

function arrayValues(value, path) {
  try {
    return ownArrayValues(value);
  } catch {
    fail('ARRAY_INVALID', path);
  }
}

function validString(value, maxCodePoints) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= maxCodePoints
    && /\S/u.test(value)
    && !CONTROL_OR_LINE_SEPARATOR.test(value)
    && !UNPAIRED_SURROGATE.test(value);
}

export function isSchedulingIdentifierV1(value, maxCodePoints = 160) {
  return Number.isSafeInteger(maxCodePoints)
    && maxCodePoints >= 1
    && validString(value, maxCodePoints);
}

function identifier(value, path, maxCodePoints = 160) {
  if (!isSchedulingIdentifierV1(value, maxCodePoints)) fail('IDENTIFIER_INVALID', path);
  return value;
}

function nullableIdentifier(value, path, maxCodePoints = 160) {
  return value === null ? null : identifier(value, path, maxCodePoints);
}

function controlledToken(value, path) {
  if (typeof value !== 'string' || !CONTROLLED_TOKEN.test(value)) fail('CONTROLLED_TOKEN_INVALID', path);
  return value;
}

function safeInteger(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('SAFE_INTEGER_INVALID', path);
  }
  return Object.is(value, -0) ? 0 : value;
}

function daysInMonth(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function calendarDate(value, path) {
  if (typeof value !== 'string') fail('CALENDAR_DATE_INVALID', path);
  const match = CALENDAR_DATE.exec(value);
  if (!match) fail('CALENDAR_DATE_INVALID', path);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    fail('CALENDAR_DATE_INVALID', path);
  }
  return value;
}

function utcTimestamp(value, path) {
  if (typeof value !== 'string') fail('TIMESTAMP_INVALID', path);
  const match = RFC3339.exec(value);
  if (!match) fail('TIMESTAMP_INVALID', path);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    fail('TIMESTAMP_INVALID', path);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) fail('TIMESTAMP_INVALID', path);
  return new Date(millis).toISOString();
}

function businessTimeZone(value, path) {
  if (!validString(value, 128)) fail('TIME_ZONE_INVALID', path);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch {
    fail('TIME_ZONE_INVALID', path);
  }
  return value;
}

function enumValue(value, allowed, path) {
  if (!allowed.has(value)) fail('ENUM_INVALID', path);
  return value;
}

function uniqueIdentifiers(value, path, { nullable = false, minimum = 0 } = {}) {
  if (nullable && value === null) return null;
  const values = arrayValues(value, path);
  if (values.length < minimum) fail('ARRAY_TOO_SHORT', path);
  const normalized = values.map((item, index) => identifier(item, `${path}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail('DUPLICATE_IDENTIFIER', path);
  return normalized.toSorted(codePointCompare);
}

function normalizeResourceCapabilitiesV1(value, path) {
  exactRecord(value, RESOURCE_CAPABILITY_KEYS, path);
  if (value.schemaVersion !== 1) fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  return {
    schemaVersion: 1,
    capabilityIds: uniqueIdentifiers(value.capabilityIds, `${path}.capabilityIds`),
  };
}

export function digestResourceCapabilitiesV1(capabilityJson) {
  const normalized = normalizeResourceCapabilitiesV1(capabilityJson, '$');
  return digestCanonicalJsonSchedulingV1({
    domain: 'resource-capabilities-v1',
    capabilityJson: normalized,
  });
}

function ensureUnique(records, key, path) {
  const seen = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const id = records[index][key];
    if (seen.has(id)) fail('DUPLICATE_IDENTIFIER', `${path}[${index}].${key}`);
    seen.add(id);
  }
}

function normalizeWindow(value, path) {
  exactRecord(value, WINDOW_KEYS, path);
  const start = utcTimestamp(value.start, `${path}.start`);
  const end = utcTimestamp(value.end, `${path}.end`);
  if (Date.parse(end) <= Date.parse(start)) fail('INTERVAL_INVALID', path);
  return { start, end };
}

function normalizeResource(value, path, planningStartMs, planningEndMs) {
  exactRecord(value, RESOURCE_KEYS, path);
  const businessWindows = arrayValues(value.businessWindows, `${path}.businessWindows`)
    .map((window, index) => normalizeWindow(window, `${path}.businessWindows[${index}]`))
    .toSorted((left, right) => codePointCompare(left.start, right.start) || codePointCompare(left.end, right.end));
  for (let index = 0; index < businessWindows.length; index += 1) {
    const current = businessWindows[index];
    if (Date.parse(current.start) < planningStartMs || Date.parse(current.end) > planningEndMs) {
      fail('WINDOW_OUTSIDE_PLANNING_RANGE', `${path}.businessWindows[${index}]`);
    }
    if (index > 0 && Date.parse(current.start) < Date.parse(businessWindows[index - 1].end)) {
      fail('WINDOW_OVERLAP', `${path}.businessWindows[${index}]`);
    }
  }
  const capabilityJson = normalizeResourceCapabilitiesV1(value.capabilityJson, `${path}.capabilityJson`);
  const expectedCapabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
  if (value.capabilityDigest !== expectedCapabilityDigest) {
    fail('CAPABILITY_DIGEST_MISMATCH', `${path}.capabilityDigest`);
  }
  return {
    resourceId: identifier(value.resourceId, `${path}.resourceId`),
    v1DisplayPlace: identifier(value.v1DisplayPlace, `${path}.v1DisplayPlace`, 300),
    status: enumValue(value.status, new Set(['active', 'inactive']), `${path}.status`),
    capabilityJson,
    capabilityDigest: expectedCapabilityDigest,
    businessWindows,
  };
}

function normalizeDurationEstimate(value, path) {
  if (value === null) return null;
  exactRecord(value, DURATION_ESTIMATE_KEYS, path);
  return {
    durationMs: safeInteger(value.durationMs, `${path}.durationMs`, { minimum: 1 }),
    source: enumValue(value.source, new Set(['explicit', 'retrospective', 'fallback']), `${path}.source`),
    sourceVersion: controlledToken(value.sourceVersion, `${path}.sourceVersion`),
  };
}

function normalizeFactProvenance(value, path) {
  exactRecord(value, FACT_PROVENANCE_KEYS, path);
  return Object.fromEntries(FACT_PROVENANCE_KEYS.map(key => [
    key,
    controlledToken(value[key], `${path}.${key}`),
  ]));
}

function normalizeCandidate(value, path) {
  exactRecord(value, CANDIDATE_KEYS, path);
  const productionType = value.productionType === null
    ? null
    : enumValue(value.productionType, PRODUCTION_TYPES, `${path}.productionType`);
  const shootingSubtype = value.shootingSubtype === null
    ? null
    : enumValue(value.shootingSubtype, ALL_SUBTYPES, `${path}.shootingSubtype`);
  if (
    (productionType === null && shootingSubtype !== null)
    || (productionType === '平面' && !FLAT_SUBTYPES.has(shootingSubtype))
    || (productionType === '视频' && !VIDEO_SUBTYPES.has(shootingSubtype))
  ) fail('PRODUCTION_FACTS_INCONSISTENT', path);

  const nonCancelledScheduleItemIds = uniqueIdentifiers(
    value.nonCancelledScheduleItemIds,
    `${path}.nonCancelledScheduleItemIds`,
  );
  if (nonCancelledScheduleItemIds.length !== 0) {
    fail('CANDIDATE_ALREADY_BOUND', `${path}.nonCancelledScheduleItemIds`);
  }

  return {
    requestId: identifier(value.requestId, `${path}.requestId`),
    sourceOrdinal: safeInteger(value.sourceOrdinal, `${path}.sourceOrdinal`),
    requestLifecycle: enumValue(value.requestLifecycle, new Set(['open']), `${path}.requestLifecycle`),
    lifecycleProvenance: enumValue(
      value.lifecycleProvenance,
      new Set(['legacySnapshot', 'domainCommand']),
      `${path}.lifecycleProvenance`,
    ),
    nonCancelledScheduleItemIds,
    productionType,
    shootingSubtype,
    desiredDate: value.desiredDate === null ? null : calendarDate(value.desiredDate, `${path}.desiredDate`),
    sampleStatus: value.sampleStatus === null
      ? null
      : enumValue(value.sampleStatus, new Set(['arrivedVerified', 'inTransit', 'unavailable']), `${path}.sampleStatus`),
    lightingPreset: nullableIdentifier(value.lightingPreset, `${path}.lightingPreset`, 120),
    reflectivity: value.reflectivity === null
      ? null
      : enumValue(value.reflectivity, new Set(['unknown', 'low', 'medium', 'high']), `${path}.reflectivity`),
    priority: value.priority === null
      ? null
      : enumValue(value.priority, new Set(['p0', 'p1', 'p2']), `${path}.priority`),
    requiredCapabilityIds: uniqueIdentifiers(
      value.requiredCapabilityIds,
      `${path}.requiredCapabilityIds`,
      { nullable: true },
    ),
    durationEstimate: normalizeDurationEstimate(value.durationEstimate, `${path}.durationEstimate`),
    factProvenance: normalizeFactProvenance(value.factProvenance, `${path}.factProvenance`),
  };
}

function normalizeTaskBinding(value, path) {
  exactRecord(value, TASK_BINDING_KEYS, path);
  return {
    requestId: identifier(value.requestId, `${path}.requestId`),
    displayOrder: safeInteger(value.displayOrder, `${path}.displayOrder`),
  };
}

function normalizeOccupied(value, path) {
  exactRecord(value, OCCUPIED_KEYS, path);
  const resourceResolutionStatus = enumValue(
    value.resourceResolutionStatus,
    new Set(['resolved', 'unresolved']),
    `${path}.resourceResolutionStatus`,
  );
  const resourceId = nullableIdentifier(value.resourceId, `${path}.resourceId`);
  if ((resourceResolutionStatus === 'resolved') !== (resourceId !== null)) {
    fail('RESOURCE_RESOLUTION_INCONSISTENT', path);
  }
  const allocationMode = enumValue(
    value.allocationMode,
    new Set(['single', 'groupedUnallocated']),
    `${path}.allocationMode`,
  );
  const taskBindings = arrayValues(value.taskBindings, `${path}.taskBindings`)
    .map((binding, index) => normalizeTaskBinding(binding, `${path}.taskBindings[${index}]`))
    .toSorted((left, right) => left.displayOrder - right.displayOrder);
  if (taskBindings.length === 0) fail('ARRAY_TOO_SHORT', `${path}.taskBindings`);
  if (new Set(taskBindings.map(binding => binding.requestId)).size !== taskBindings.length) {
    fail('DUPLICATE_IDENTIFIER', `${path}.taskBindings`);
  }
  if (taskBindings.some((binding, index) => binding.displayOrder !== index)) {
    fail('BINDING_ORDER_INVALID', `${path}.taskBindings`);
  }
  if ((allocationMode === 'single' && taskBindings.length !== 1)
    || (allocationMode === 'groupedUnallocated' && taskBindings.length < 2)) {
    fail('ALLOCATION_BINDING_INVALID', `${path}.taskBindings`);
  }
  const plannedStart = utcTimestamp(value.plannedStart, `${path}.plannedStart`);
  const plannedEnd = utcTimestamp(value.plannedEnd, `${path}.plannedEnd`);
  if (Date.parse(plannedEnd) <= Date.parse(plannedStart)) fail('INTERVAL_INVALID', path);
  const bufferAfterMinutes = value.bufferAfterMinutes === null
    ? null
    : safeInteger(value.bufferAfterMinutes, `${path}.bufferAfterMinutes`, { maximum: 1440 });
  const bufferSource = controlledToken(value.bufferSource, `${path}.bufferSource`);
  if ((bufferAfterMinutes === null) !== (bufferSource === 'legacy_unknown')) {
    fail('BUFFER_PROVENANCE_INCONSISTENT', path);
  }
  const lockStatus = value.lockStatus === null
    ? null
    : enumValue(value.lockStatus, new Set(['unlocked', 'locked']), `${path}.lockStatus`);
  const lockStatusProvenance = enumValue(
    value.lockStatusProvenance,
    new Set(['legacy_unknown', 'domain_command']),
    `${path}.lockStatusProvenance`,
  );
  if ((lockStatus === null) !== (lockStatusProvenance === 'legacy_unknown')) {
    fail('LOCK_PROVENANCE_INCONSISTENT', path);
  }
  return {
    scheduleItemId: identifier(value.scheduleItemId, `${path}.scheduleItemId`),
    sourceOrdinal: safeInteger(value.sourceOrdinal, `${path}.sourceOrdinal`),
    resourceId,
    resourceResolutionStatus,
    allocationMode,
    taskBindings,
    plannedStart,
    plannedEnd,
    bufferAfterMinutes,
    bufferSource,
    scheduleStatus: enumValue(value.scheduleStatus, new Set(['draft', 'confirmed']), `${path}.scheduleStatus`),
    lockStatus,
    lockStatusProvenance,
    source: enumValue(value.source, new Set(['human', 'agentProposal', 'migration']), `${path}.source`),
  };
}

function normalizeActiveRun(value, path) {
  exactRecord(value, ACTIVE_RUN_KEYS, path);
  return {
    runId: identifier(value.runId, `${path}.runId`),
    scheduleItemId: identifier(value.scheduleItemId, `${path}.scheduleItemId`),
    status: enumValue(value.status, new Set(['shooting', 'blocked']), `${path}.status`),
  };
}

function normalizeDurationStat(value, path) {
  exactRecord(value, DURATION_STAT_KEYS, path);
  const productionType = value.productionType === null
    ? null
    : enumValue(value.productionType, PRODUCTION_TYPES, `${path}.productionType`);
  const shootingSubtype = value.shootingSubtype === null
    ? null
    : enumValue(value.shootingSubtype, ALL_SUBTYPES, `${path}.shootingSubtype`);
  if (
    (productionType === null && shootingSubtype !== null)
    || (productionType === '平面' && !FLAT_SUBTYPES.has(shootingSubtype))
    || (productionType === '视频' && !VIDEO_SUBTYPES.has(shootingSubtype))
  ) fail('PRODUCTION_FACTS_INCONSISTENT', path);
  return {
    statId: identifier(value.statId, `${path}.statId`),
    resourceId: nullableIdentifier(value.resourceId, `${path}.resourceId`),
    productionType,
    shootingSubtype,
    lightingPreset: nullableIdentifier(value.lightingPreset, `${path}.lightingPreset`, 120),
    reflectivity: value.reflectivity === null
      ? null
      : enumValue(value.reflectivity, new Set(['unknown', 'low', 'medium', 'high']), `${path}.reflectivity`),
    sampleCount: safeInteger(value.sampleCount, `${path}.sampleCount`, { minimum: 1 }),
    estimateDurationMs: safeInteger(value.estimateDurationMs, `${path}.estimateDurationMs`, { minimum: 1 }),
    metricVersion: controlledToken(value.metricVersion, `${path}.metricVersion`),
  };
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function invalid(code, reason, path) {
  return Object.freeze({ ok: false, code, reason, path });
}

function admissionResult(code, work) {
  try {
    return work();
  } catch (error) {
    if (error instanceof AdmissionError) return invalid(code, error.reason, error.path);
    return invalid(code, 'CANONICAL_JSON_INVALID', '$');
  }
}

export function normalizeSchedulingInputV1(input) {
  return admissionResult('SCHEDULING_INPUT_INVALID', () => {
    exactRecord(input, INPUT_KEYS, '$');
    if (input.schemaVersion !== SCHEDULING_INPUT_SCHEMA_V1) fail('SCHEMA_VERSION_INVALID', '$.schemaVersion');
    const planningWindowStart = utcTimestamp(input.planningWindowStart, '$.planningWindowStart');
    const planningWindowEnd = utcTimestamp(input.planningWindowEnd, '$.planningWindowEnd');
    const planningStartMs = Date.parse(planningWindowStart);
    const planningEndMs = Date.parse(planningWindowEnd);
    if (planningEndMs <= planningStartMs) fail('INTERVAL_INVALID', '$.planningWindowEnd');

    const resources = arrayValues(input.resources, '$.resources')
      .map((resource, index) => normalizeResource(resource, `$.resources[${index}]`, planningStartMs, planningEndMs))
      .toSorted((left, right) => codePointCompare(left.resourceId, right.resourceId));
    const candidates = arrayValues(input.candidates, '$.candidates')
      .map((candidate, index) => normalizeCandidate(candidate, `$.candidates[${index}]`))
      .toSorted((left, right) => codePointCompare(left.requestId, right.requestId));
    const occupied = arrayValues(input.occupied, '$.occupied')
      .map((item, index) => normalizeOccupied(item, `$.occupied[${index}]`))
      .toSorted((left, right) => codePointCompare(left.plannedStart, right.plannedStart)
        || codePointCompare(left.resourceId ?? '', right.resourceId ?? '')
        || codePointCompare(left.scheduleItemId, right.scheduleItemId));
    const activeRuns = arrayValues(input.activeRuns, '$.activeRuns')
      .map((run, index) => normalizeActiveRun(run, `$.activeRuns[${index}]`))
      .toSorted((left, right) => codePointCompare(left.runId, right.runId));
    const durationStats = arrayValues(input.durationStats, '$.durationStats')
      .map((stat, index) => normalizeDurationStat(stat, `$.durationStats[${index}]`))
      .toSorted((left, right) => codePointCompare(left.statId, right.statId));

    ensureUnique(resources, 'resourceId', '$.resources');
    ensureUnique(resources, 'v1DisplayPlace', '$.resources');
    ensureUnique(candidates, 'requestId', '$.candidates');
    ensureUnique(candidates, 'sourceOrdinal', '$.candidates');
    ensureUnique(occupied, 'scheduleItemId', '$.occupied');
    ensureUnique(occupied, 'sourceOrdinal', '$.occupied');
    ensureUnique(activeRuns, 'runId', '$.activeRuns');
    ensureUnique(activeRuns, 'scheduleItemId', '$.activeRuns');
    ensureUnique(durationStats, 'statId', '$.durationStats');

    const occupiedScheduleItemIds = new Set(occupied.map(item => item.scheduleItemId));
    for (let index = 0; index < activeRuns.length; index += 1) {
      if (!occupiedScheduleItemIds.has(activeRuns[index].scheduleItemId)) {
        fail('ACTIVE_RUN_OCCUPANCY_MISSING', `$.activeRuns[${index}].scheduleItemId`);
      }
    }
    const occupiedRequestIds = new Set();
    for (let occupiedIndex = 0; occupiedIndex < occupied.length; occupiedIndex += 1) {
      for (let bindingIndex = 0; bindingIndex < occupied[occupiedIndex].taskBindings.length; bindingIndex += 1) {
        const requestId = occupied[occupiedIndex].taskBindings[bindingIndex].requestId;
        if (occupiedRequestIds.has(requestId)) {
          fail('REQUEST_BOUND_MORE_THAN_ONCE', `$.occupied[${occupiedIndex}].taskBindings[${bindingIndex}].requestId`);
        }
        occupiedRequestIds.add(requestId);
      }
    }
    for (let index = 0; index < candidates.length; index += 1) {
      if (occupiedRequestIds.has(candidates[index].requestId)) {
        fail('CANDIDATE_OCCUPANCY_CONFLICT', `$.candidates[${index}].requestId`);
      }
    }

    const normalized = deepFreeze({
      schemaVersion: SCHEDULING_INPUT_SCHEMA_V1,
      planningWindowStart,
      planningWindowEnd,
      businessTimeZone: businessTimeZone(input.businessTimeZone, '$.businessTimeZone'),
      baseScheduleRevision: safeInteger(input.baseScheduleRevision, '$.baseScheduleRevision'),
      algorithmVersion: controlledToken(input.algorithmVersion, '$.algorithmVersion'),
      calendarCompilerVersion: input.calendarCompilerVersion === SCHEDULING_CALENDAR_COMPILER_VERSION_V1
        ? input.calendarCompilerVersion
        : fail('CALENDAR_COMPILER_VERSION_UNSUPPORTED', '$.calendarCompilerVersion'),
      timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION !== null
        && input.timeZoneDataVersion === SCHEDULING_TIME_ZONE_DATA_VERSION
        ? input.timeZoneDataVersion
        : fail(
          SCHEDULING_TIME_ZONE_DATA_VERSION === null
            ? 'TIME_ZONE_DATA_UNAVAILABLE'
            : 'TIME_ZONE_DATA_VERSION_MISMATCH',
          '$.timeZoneDataVersion',
        ),
      estimatePolicyVersion: controlledToken(input.estimatePolicyVersion, '$.estimatePolicyVersion'),
      configVersion: controlledToken(input.configVersion, '$.configVersion'),
      configDigest: typeof input.configDigest === 'string' && DIGEST.test(input.configDigest)
        ? input.configDigest
        : fail('DIGEST_INVALID', '$.configDigest'),
      resources,
      candidates,
      occupied,
      activeRuns,
      durationStats,
    });
    const inputJson = canonicalJsonSchedulingV1(normalized);
    const inputDigest = digestCanonicalJsonSchedulingV1(normalized);
    return deepFreeze({ ok: true, input: normalized, inputJson, inputDigest });
  });
}

function normalizeProposedItem(value, path) {
  const hasId = isRecord(value) && Reflect.ownKeys(value).includes('proposalItemId');
  exactRecord(value, hasId ? PROPOSED_ITEM_KEYS : PROPOSED_ITEM_INPUT_KEYS, path);
  const plannedStart = utcTimestamp(value.plannedStart, `${path}.plannedStart`);
  const plannedEnd = utcTimestamp(value.plannedEnd, `${path}.plannedEnd`);
  const durationMs = safeInteger(value.durationMs, `${path}.durationMs`, { minimum: 1 });
  if (Date.parse(plannedEnd) - Date.parse(plannedStart) !== durationMs) {
    fail('PROPOSED_DURATION_MISMATCH', path);
  }
  const body = {
    requestId: identifier(value.requestId, `${path}.requestId`),
    resourceId: identifier(value.resourceId, `${path}.resourceId`),
    plannedStart,
    plannedEnd,
    durationMs,
    bufferAfterMinutes: safeInteger(value.bufferAfterMinutes, `${path}.bufferAfterMinutes`, { maximum: 1440 }),
    durationSource: enumValue(
      value.durationSource,
      new Set(['explicit', 'retrospective', 'fallback']),
      `${path}.durationSource`,
    ),
    durationSourceVersion: controlledToken(value.durationSourceVersion, `${path}.durationSourceVersion`),
    bufferRuleId: controlledToken(value.bufferRuleId, `${path}.bufferRuleId`),
    configVersion: controlledToken(value.configVersion, `${path}.configVersion`),
  };
  const proposalItemId = `spi_${digestCanonicalJsonSchedulingV1({
    domain: 'proposal-item-v1',
    item: body,
  }).slice('sha256:'.length)}`;
  if (hasId && value.proposalItemId !== proposalItemId) fail('PROPOSAL_ITEM_ID_MISMATCH', `${path}.proposalItemId`);
  return { proposalItemId, ...body };
}

function normalizeDiagnostic(value, path) {
  const hasSeverity = isRecord(value) && Reflect.ownKeys(value).includes('severity');
  exactRecord(value, hasSeverity ? DIAGNOSTIC_KEYS : DIAGNOSTIC_INPUT_KEYS, path);
  const code = value.code;
  const severity = HARD_CODES.has(code) ? 'hard' : SOFT_CODES.has(code) ? 'soft' : null;
  if (severity === null) fail('DIAGNOSTIC_CODE_INVALID', `${path}.code`);
  if (hasSeverity && value.severity !== severity) fail('DIAGNOSTIC_SEVERITY_MISMATCH', `${path}.severity`);
  const fieldPath = value.fieldPath;
  if (fieldPath !== null && !DIAGNOSTIC_PATHS.has(fieldPath)) {
    fail('DIAGNOSTIC_FIELD_PATH_INVALID', `${path}.fieldPath`);
  }
  return {
    severity,
    code,
    requestId: nullableIdentifier(value.requestId, `${path}.requestId`),
    resourceId: nullableIdentifier(value.resourceId, `${path}.resourceId`),
    scheduleItemId: nullableIdentifier(value.scheduleItemId, `${path}.scheduleItemId`),
    fieldPath,
  };
}

export function buildSchedulingProposalItemV1(item) {
  return admissionResult('SCHEDULING_PROPOSAL_ITEM_INVALID', () => deepFreeze({
    ok: true,
    item: normalizeProposedItem(item, '$'),
  }));
}

export function buildSchedulingDiagnosticV1(diagnostic) {
  return admissionResult('SCHEDULING_DIAGNOSTIC_INVALID', () => deepFreeze({
    ok: true,
    diagnostic: normalizeDiagnostic(diagnostic, '$'),
  }));
}

export function canonicalizeSchedulingResultV1(value) {
  return admissionResult('SCHEDULING_RESULT_INVALID', () => {
    exactRecord(value, RESULT_INPUT_KEYS, '$');
    const algorithmVersion = controlledToken(value.algorithmVersion, '$.algorithmVersion');
    const configVersion = controlledToken(value.configVersion, '$.configVersion');
    const configDigest = typeof value.configDigest === 'string' && DIGEST.test(value.configDigest)
      ? value.configDigest
      : fail('DIGEST_INVALID', '$.configDigest');
    const calendarCompilerVersion = controlledToken(
      value.calendarCompilerVersion,
      '$.calendarCompilerVersion',
    );
    if (calendarCompilerVersion !== SCHEDULING_CALENDAR_COMPILER_VERSION_V1) {
      fail('CALENDAR_COMPILER_VERSION_UNSUPPORTED', '$.calendarCompilerVersion');
    }
    const timeZoneDataVersion = controlledToken(value.timeZoneDataVersion, '$.timeZoneDataVersion');
    if (SCHEDULING_TIME_ZONE_DATA_VERSION === null) {
      fail('TIME_ZONE_DATA_UNAVAILABLE', '$.timeZoneDataVersion');
    }
    if (timeZoneDataVersion !== SCHEDULING_TIME_ZONE_DATA_VERSION) {
      fail('TIME_ZONE_DATA_VERSION_MISMATCH', '$.timeZoneDataVersion');
    }
    const estimatePolicyVersion = controlledToken(value.estimatePolicyVersion, '$.estimatePolicyVersion');
    const proposedItems = arrayValues(value.proposedItems, '$.proposedItems')
      .map((item, index) => normalizeProposedItem(item, `$.proposedItems[${index}]`))
      .toSorted((left, right) => codePointCompare(left.plannedStart, right.plannedStart)
        || codePointCompare(left.resourceId, right.resourceId)
        || codePointCompare(left.requestId, right.requestId)
        || codePointCompare(left.proposalItemId, right.proposalItemId));
    if (proposedItems.some(item => item.configVersion !== configVersion)) {
      fail('PROPOSAL_CONFIG_VERSION_MISMATCH', '$.proposedItems');
    }
    const diagnostics = arrayValues(value.diagnostics, '$.diagnostics')
      .map((diagnostic, index) => normalizeDiagnostic(diagnostic, `$.diagnostics[${index}]`))
      .toSorted((left, right) => codePointCompare(left.severity, right.severity)
        || codePointCompare(left.code, right.code)
        || codePointCompare(left.requestId ?? '', right.requestId ?? '')
        || codePointCompare(left.resourceId ?? '', right.resourceId ?? '')
        || codePointCompare(left.scheduleItemId ?? '', right.scheduleItemId ?? '')
        || codePointCompare(left.fieldPath ?? '', right.fieldPath ?? ''));
    ensureUnique(proposedItems, 'proposalItemId', '$.proposedItems');
    ensureUnique(proposedItems, 'requestId', '$.proposedItems');
    const diagnosticKeys = diagnostics.map(diagnostic => canonicalJsonSchedulingV1(diagnostic));
    if (new Set(diagnosticKeys).size !== diagnosticKeys.length) fail('DUPLICATE_DIAGNOSTIC', '$.diagnostics');
    const digestBody = deepFreeze({
      schemaVersion: SCHEDULING_RESULT_SCHEMA_V1,
      algorithmVersion,
      configVersion,
      configDigest,
      calendarCompilerVersion,
      timeZoneDataVersion,
      estimatePolicyVersion,
      proposedItems,
      diagnostics,
    });
    const resultJson = canonicalJsonSchedulingV1(digestBody);
    const resultDigest = digestCanonicalJsonSchedulingV1(digestBody);
    return deepFreeze({
      ok: true,
      result: { ...digestBody, resultDigest },
      resultJson,
      resultDigest,
    });
  });
}
