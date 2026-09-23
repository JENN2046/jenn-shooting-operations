import {
  SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
  SCHEDULING_TIME_ZONE_DATA_VERSION,
  canonicalJsonSchedulingV1,
  digestCanonicalJsonSchedulingV1,
  digestResourceCapabilitiesV1,
  isSchedulingIdentifierV1,
} from './scheduling-contract-v1.mjs';

export {
  SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
  SCHEDULING_TIME_ZONE_DATA_VERSION,
};

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const CONTROLLED_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const RESOURCE_COMMAND_KEYS = Object.freeze([
  'operationId', 'expectedScheduleRevision', 'expectedProjectionRevision', 'resource',
]);
const RESOURCE_KEYS = Object.freeze([
  'resourceId', 'v1DisplayPlace', 'status', 'capabilityJson', 'capabilityDigest',
]);
const CONFIG_PUBLISH_KEYS = Object.freeze([
  'operationId', 'configVersion', 'algorithmVersion', 'calendarCompilerVersion',
  'estimatePolicyVersion', 'configJson', 'configDigest',
]);
const CONFIG_ACTIVATE_KEYS = Object.freeze([
  'operationId', 'configVersion', 'expectedProjectionRevision',
]);
const CONFIG_KEYS = Object.freeze([
  'schemaVersion', 'businessTimeZone', 'resourceCalendars', 'durationFallbackRules',
  'bufferRules', 'softScoringWeights', 'compatibleAlgorithmVersions',
]);
const RESOURCE_CALENDAR_KEYS = Object.freeze([
  'resourceId', 'capabilityDigest', 'weeklyWindows', 'dateOverrides',
]);
const WEEKLY_WINDOW_KEYS = Object.freeze(['weekday', 'start', 'end']);
const DATE_OVERRIDE_KEYS = Object.freeze(['date', 'status', 'windows']);
const LOCAL_WINDOW_KEYS = Object.freeze(['start', 'end']);
const DURATION_RULE_KEYS = Object.freeze([
  'ruleId', 'productionType', 'shootingSubtype', 'durationMs',
]);
const BUFFER_RULE_KEYS = Object.freeze([
  'ruleId', 'productionType', 'shootingSubtype', 'bufferAfterMinutes',
]);
const SOFT_WEIGHT_KEYS = Object.freeze([
  'LIGHTING_SWITCH', 'REFLECTIVITY_SEQUENCE', 'IDLE_GAP', 'EXPECTED_OVERRUN',
  'DESIRED_DATE_MISS',
]);
const CALENDAR_COMPILE_KEYS = Object.freeze([
  'configJson', 'resourceId', 'date', 'calendarCompilerVersion', 'timeZoneDataVersion',
]);

const FLAT_SUBTYPES = new Set(['模特', '细节', '场景', '待定']);
const VIDEO_SUBTYPES = new Set(['产品展示', '人物展示', '产品加人物展示', '口播', '剧情短片', '场景视频']);

export const SCHEDULING_CONFIG_SCHEMA_V1 = 1;

class AdmissionError extends Error {
  constructor(reason, path) {
    super('SCHEDULING_ADMIN_CONTRACT_INVALID');
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

function ownDataKeys(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail('EXACT_KEYS', path);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail('EXACT_KEYS', path);
  }
  if (keys.some(key => typeof key !== 'string' || UNSAFE_KEYS.has(key) || UNPAIRED_SURROGATE.test(key))) {
    fail('EXACT_KEYS', path);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('EXACT_KEYS', path);
    }
  }
  return keys;
}

function exactRecord(value, expectedKeys, path) {
  const keys = ownDataKeys(value, path);
  const expected = new Set(expectedKeys);
  if (keys.length !== expectedKeys.length || keys.some(key => !expected.has(key))) {
    fail('EXACT_KEYS', path);
  }
  return value;
}

function arrayValues(value, path) {
  if (!Array.isArray(value)) fail('ARRAY_INVALID', path);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => key !== 'length'
    && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)))) {
    fail('ARRAY_INVALID', path);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('ARRAY_INVALID', path);
    }
    result.push(descriptor.value);
  }
  return result;
}

function identifier(value, path, maximum = 160) {
  if (!isSchedulingIdentifierV1(value, maximum)) fail('IDENTIFIER_INVALID', path);
  return value;
}

function controlledToken(value, path) {
  if (typeof value !== 'string' || !CONTROLLED_TOKEN.test(value)) {
    fail('CONTROLLED_TOKEN_INVALID', path);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('DIGEST_INVALID', path);
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

function localTime(value, path) {
  if (typeof value !== 'string' || !LOCAL_TIME.test(value)) fail('LOCAL_TIME_INVALID', path);
  return value;
}

function localMinute(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function businessTimeZone(value, path) {
  if (!isSchedulingIdentifierV1(value, 128)) fail('TIME_ZONE_INVALID', path);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch {
    fail('TIME_ZONE_INVALID', path);
  }
  return value;
}

function ensureUnique(values, keyOf, path, reason = 'DUPLICATE_IDENTIFIER') {
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const key = keyOf(values[index]);
    if (seen.has(key)) fail(reason, `${path}[${index}]`);
    seen.add(key);
  }
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

function normalizeCapabilityJson(value, path) {
  exactRecord(value, ['schemaVersion', 'capabilityIds'], path);
  if (value.schemaVersion !== 1) fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  const capabilityIds = arrayValues(value.capabilityIds, `${path}.capabilityIds`)
    .map((item, index) => identifier(item, `${path}.capabilityIds[${index}]`))
    .toSorted(codePointCompare);
  ensureUnique(capabilityIds, item => item, `${path}.capabilityIds`);
  return { schemaVersion: 1, capabilityIds };
}

function normalizeResource(value, path) {
  exactRecord(value, RESOURCE_KEYS, path);
  const capabilityJson = normalizeCapabilityJson(value.capabilityJson, `${path}.capabilityJson`);
  const expectedDigest = digestResourceCapabilitiesV1(capabilityJson);
  if (value.capabilityDigest !== expectedDigest) {
    fail('CAPABILITY_DIGEST_MISMATCH', `${path}.capabilityDigest`);
  }
  return {
    resourceId: identifier(value.resourceId, `${path}.resourceId`),
    v1DisplayPlace: identifier(value.v1DisplayPlace, `${path}.v1DisplayPlace`, 300),
    status: value.status === 'active' || value.status === 'inactive'
      ? value.status
      : fail('ENUM_INVALID', `${path}.status`),
    capabilityJson,
    capabilityDigest: expectedDigest,
  };
}

function normalizeResourceCommand(value, commandType, domain) {
  exactRecord(value, RESOURCE_COMMAND_KEYS, '$');
  const normalized = {
    operationId: identifier(value.operationId, '$.operationId'),
    expectedScheduleRevision: safeInteger(value.expectedScheduleRevision, '$.expectedScheduleRevision'),
    expectedProjectionRevision: safeInteger(value.expectedProjectionRevision, '$.expectedProjectionRevision'),
    resource: normalizeResource(value.resource, '$.resource'),
  };
  const commandDigest = digestCanonicalJsonSchedulingV1({
    domain,
    command: {
      expectedScheduleRevision: normalized.expectedScheduleRevision,
      expectedProjectionRevision: normalized.expectedProjectionRevision,
      resource: normalized.resource,
    },
  });
  return deepFreeze({
    ok: true,
    commandType,
    command: normalized,
    commandJson: canonicalJsonSchedulingV1(normalized),
    commandDigest,
  });
}

export function normalizeRegisterSchedulingResourceV1(value) {
  return admissionResult('REGISTER_SCHEDULING_RESOURCE_INVALID', () => normalizeResourceCommand(
    value,
    'RegisterSchedulingResourceV1',
    'scheduling-resource-register-command-v1',
  ));
}

export function normalizeReplaceSchedulingResourceV1(value) {
  return admissionResult('REPLACE_SCHEDULING_RESOURCE_INVALID', () => normalizeResourceCommand(
    value,
    'ReplaceSchedulingResourceV1',
    'scheduling-resource-replace-command-v1',
  ));
}

function normalizeLocalWindow(value, path) {
  exactRecord(value, LOCAL_WINDOW_KEYS, path);
  const start = localTime(value.start, `${path}.start`);
  const end = localTime(value.end, `${path}.end`);
  if (localMinute(start) >= localMinute(end)) fail('LOCAL_INTERVAL_INVALID', path);
  return { start, end };
}

function ensureNonOverlappingWindows(windows, path) {
  for (let index = 1; index < windows.length; index += 1) {
    if (localMinute(windows[index].start) < localMinute(windows[index - 1].end)) {
      fail('LOCAL_WINDOW_OVERLAP', `${path}[${index}]`);
    }
  }
}

function normalizeWeeklyWindow(value, path) {
  exactRecord(value, WEEKLY_WINDOW_KEYS, path);
  const weekday = safeInteger(value.weekday, `${path}.weekday`, { minimum: 1, maximum: 7 });
  const window = normalizeLocalWindow({ start: value.start, end: value.end }, path);
  return { weekday, ...window };
}

function localDateTimeParts(date, time) {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
    hour: Number(time.slice(0, 2)),
    minute: Number(time.slice(3, 5)),
  };
}

function localFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function formattedLocalParts(formatter, millis) {
  const result = {};
  for (const part of formatter.formatToParts(millis)) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
}

function utcMillisFromParts(parts) {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return value.getTime();
}

function timeZoneOffsetMillis(formatter, millis) {
  return utcMillisFromParts(formattedLocalParts(formatter, millis)) - millis;
}

function resolveLocalMinute(date, time, timeZone, path) {
  const wanted = localDateTimeParts(date, time);
  const formatter = localFormatter(timeZone);
  const centerDate = new Date(0);
  centerDate.setUTCFullYear(wanted.year, wanted.month - 1, wanted.day);
  centerDate.setUTCHours(wanted.hour, wanted.minute, 0, 0);
  const center = centerDate.getTime();
  const matches = [];
  for (let millis = center - 18 * 60 * 60 * 1000;
    millis <= center + 18 * 60 * 60 * 1000;
    millis += 60 * 1000) {
    const found = formattedLocalParts(formatter, millis);
    if (found.year === wanted.year && found.month === wanted.month && found.day === wanted.day
      && found.hour === wanted.hour && found.minute === wanted.minute && found.second === 0) {
      matches.push(millis);
      if (matches.length > 1) break;
    }
  }
  if (matches.length !== 1) fail('LOCAL_TIME_AMBIGUOUS_OR_INVALID', path);
  return matches[0];
}

function compileLocalWindows(windows, date, timeZone, path) {
  const formatter = localFormatter(timeZone);
  const compiled = windows.map((window, index) => {
    const startMs = resolveLocalMinute(date, window.start, timeZone, `${path}[${index}].start`);
    const endMs = resolveLocalMinute(date, window.end, timeZone, `${path}[${index}].end`);
    if (endMs <= startMs) fail('UTC_INTERVAL_INVALID', `${path}[${index}]`);
    const expectedOffset = timeZoneOffsetMillis(formatter, startMs);
    for (let millis = startMs + 60 * 1000; millis < endMs; millis += 60 * 1000) {
      if (timeZoneOffsetMillis(formatter, millis) !== expectedOffset) {
        fail('DST_TRANSITION_WITHIN_WINDOW', `${path}[${index}]`);
      }
    }
    if (timeZoneOffsetMillis(formatter, endMs) !== expectedOffset) {
      fail('DST_TRANSITION_WITHIN_WINDOW', `${path}[${index}]`);
    }
    return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
  });
  for (let index = 1; index < compiled.length; index += 1) {
    if (Date.parse(compiled[index].start) < Date.parse(compiled[index - 1].end)) {
      fail('UTC_WINDOW_OVERLAP', `${path}[${index}]`);
    }
  }
  return compiled;
}

function normalizeDateOverride(value, path, timeZone) {
  exactRecord(value, DATE_OVERRIDE_KEYS, path);
  const date = calendarDate(value.date, `${path}.date`);
  const status = value.status === 'closed' || value.status === 'custom'
    ? value.status
    : fail('ENUM_INVALID', `${path}.status`);
  const windows = arrayValues(value.windows, `${path}.windows`)
    .map((window, index) => normalizeLocalWindow(window, `${path}.windows[${index}]`))
    .toSorted((left, right) => localMinute(left.start) - localMinute(right.start)
      || localMinute(left.end) - localMinute(right.end));
  ensureNonOverlappingWindows(windows, `${path}.windows`);
  if ((status === 'closed' && windows.length !== 0) || (status === 'custom' && windows.length === 0)) {
    fail('DATE_OVERRIDE_STATUS_INVALID', path);
  }
  if (status === 'custom') compileLocalWindows(windows, date, timeZone, `${path}.windows`);
  return { date, status, windows };
}

function normalizeResourceCalendar(value, path, timeZone) {
  exactRecord(value, RESOURCE_CALENDAR_KEYS, path);
  const weeklyWindows = arrayValues(value.weeklyWindows, `${path}.weeklyWindows`)
    .map((window, index) => normalizeWeeklyWindow(window, `${path}.weeklyWindows[${index}]`))
    .toSorted((left, right) => left.weekday - right.weekday
      || localMinute(left.start) - localMinute(right.start)
      || localMinute(left.end) - localMinute(right.end));
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    ensureNonOverlappingWindows(
      weeklyWindows.filter(window => window.weekday === weekday),
      `${path}.weeklyWindows`,
    );
  }
  const dateOverrides = arrayValues(value.dateOverrides, `${path}.dateOverrides`)
    .map((override, index) => normalizeDateOverride(override, `${path}.dateOverrides[${index}]`, timeZone))
    .toSorted((left, right) => codePointCompare(left.date, right.date));
  ensureUnique(dateOverrides, item => item.date, `${path}.dateOverrides`, 'DUPLICATE_DATE_OVERRIDE');
  return {
    resourceId: identifier(value.resourceId, `${path}.resourceId`),
    capabilityDigest: digest(value.capabilityDigest, `${path}.capabilityDigest`),
    weeklyWindows,
    dateOverrides,
  };
}

function normalizeSelector(value, path) {
  const productionType = value.productionType;
  const shootingSubtype = value.shootingSubtype;
  if (productionType !== null && productionType !== '平面' && productionType !== '视频') {
    fail('ENUM_INVALID', `${path}.productionType`);
  }
  if (productionType === null) {
    if (shootingSubtype !== null) fail('SELECTOR_INVALID', path);
  } else if (shootingSubtype !== null) {
    const allowed = productionType === '平面' ? FLAT_SUBTYPES : VIDEO_SUBTYPES;
    if (!allowed.has(shootingSubtype)) fail('SELECTOR_INVALID', path);
  }
  return { productionType, shootingSubtype };
}

function selectorKey(rule) {
  return `${rule.productionType ?? '*'}\u0000${rule.shootingSubtype ?? '*'}`;
}

function selectorSpecificity(rule) {
  if (rule.shootingSubtype !== null) return 2;
  if (rule.productionType !== null) return 1;
  return 0;
}

function ruleCompare(left, right) {
  return selectorSpecificity(right) - selectorSpecificity(left)
    || codePointCompare(left.productionType ?? '', right.productionType ?? '')
    || codePointCompare(left.shootingSubtype ?? '', right.shootingSubtype ?? '')
    || codePointCompare(left.ruleId, right.ruleId);
}

function normalizeDurationRule(value, path) {
  exactRecord(value, DURATION_RULE_KEYS, path);
  return {
    ruleId: identifier(value.ruleId, `${path}.ruleId`),
    ...normalizeSelector(value, path),
    durationMs: safeInteger(value.durationMs, `${path}.durationMs`, { minimum: 1 }),
  };
}

function normalizeBufferRule(value, path) {
  exactRecord(value, BUFFER_RULE_KEYS, path);
  return {
    ruleId: identifier(value.ruleId, `${path}.ruleId`),
    ...normalizeSelector(value, path),
    bufferAfterMinutes: safeInteger(value.bufferAfterMinutes, `${path}.bufferAfterMinutes`),
  };
}

function normalizeRules(value, path, normalizer) {
  const rules = arrayValues(value, path)
    .map((rule, index) => normalizer(rule, `${path}[${index}]`))
    .toSorted(ruleCompare);
  ensureUnique(rules, rule => rule.ruleId, path);
  ensureUnique(rules, selectorKey, path, 'DUPLICATE_RULE_SELECTOR');
  return rules;
}

function normalizeSoftScoringWeights(value, path) {
  exactRecord(value, SOFT_WEIGHT_KEYS, path);
  return Object.fromEntries(SOFT_WEIGHT_KEYS.map(key => [
    key,
    safeInteger(value[key], `${path}.${key}`, { maximum: 1_000_000 }),
  ]));
}

function normalizeCompatibleAlgorithms(value, path) {
  const versions = arrayValues(value, path)
    .map((version, index) => controlledToken(version, `${path}[${index}]`))
    .toSorted(codePointCompare);
  if (versions.length === 0) fail('ARRAY_TOO_SHORT', path);
  ensureUnique(versions, item => item, path);
  return versions;
}

function normalizeConfig(value, path = '$') {
  exactRecord(value, CONFIG_KEYS, path);
  if (value.schemaVersion !== SCHEDULING_CONFIG_SCHEMA_V1) {
    fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  }
  const timeZone = businessTimeZone(value.businessTimeZone, `${path}.businessTimeZone`);
  const resourceCalendars = arrayValues(value.resourceCalendars, `${path}.resourceCalendars`)
    .map((calendar, index) => normalizeResourceCalendar(
      calendar,
      `${path}.resourceCalendars[${index}]`,
      timeZone,
    ))
    .toSorted((left, right) => codePointCompare(left.resourceId, right.resourceId));
  ensureUnique(resourceCalendars, item => item.resourceId, `${path}.resourceCalendars`);
  return {
    schemaVersion: SCHEDULING_CONFIG_SCHEMA_V1,
    businessTimeZone: timeZone,
    resourceCalendars,
    durationFallbackRules: normalizeRules(
      value.durationFallbackRules,
      `${path}.durationFallbackRules`,
      normalizeDurationRule,
    ),
    bufferRules: normalizeRules(value.bufferRules, `${path}.bufferRules`, normalizeBufferRule),
    softScoringWeights: normalizeSoftScoringWeights(
      value.softScoringWeights,
      `${path}.softScoringWeights`,
    ),
    compatibleAlgorithmVersions: normalizeCompatibleAlgorithms(
      value.compatibleAlgorithmVersions,
      `${path}.compatibleAlgorithmVersions`,
    ),
  };
}

export function digestSchedulingConfigV1(configJson) {
  const normalized = normalizeConfig(configJson);
  return digestCanonicalJsonSchedulingV1({ domain: 'scheduling-config-v1', configJson: normalized });
}

export function normalizeSchedulingConfigV1(configJson) {
  return admissionResult('SCHEDULING_CONFIG_INVALID', () => {
    const config = deepFreeze(normalizeConfig(configJson));
    return deepFreeze({
      ok: true,
      config,
      configJson: canonicalJsonSchedulingV1(config),
      configDigest: digestSchedulingConfigV1(config),
    });
  });
}

export function normalizePublishSchedulingConfigV1(value) {
  return admissionResult('PUBLISH_SCHEDULING_CONFIG_INVALID', () => {
    exactRecord(value, CONFIG_PUBLISH_KEYS, '$');
    const configJson = normalizeConfig(value.configJson, '$.configJson');
    const configDigest = digestSchedulingConfigV1(configJson);
    if (value.configDigest !== configDigest) fail('CONFIG_DIGEST_MISMATCH', '$.configDigest');
    const command = {
      operationId: identifier(value.operationId, '$.operationId'),
      configVersion: controlledToken(value.configVersion, '$.configVersion'),
      algorithmVersion: controlledToken(value.algorithmVersion, '$.algorithmVersion'),
      calendarCompilerVersion: controlledToken(
        value.calendarCompilerVersion,
        '$.calendarCompilerVersion',
      ),
      estimatePolicyVersion: controlledToken(value.estimatePolicyVersion, '$.estimatePolicyVersion'),
      configJson,
      configDigest,
    };
    if (command.calendarCompilerVersion !== SCHEDULING_CALENDAR_COMPILER_VERSION_V1) {
      fail('CALENDAR_COMPILER_VERSION_UNSUPPORTED', '$.calendarCompilerVersion');
    }
    if (!configJson.compatibleAlgorithmVersions.includes(command.algorithmVersion)) {
      fail('ALGORITHM_NOT_COMPATIBLE', '$.algorithmVersion');
    }
    const commandDigest = digestCanonicalJsonSchedulingV1({
      domain: 'scheduling-config-publish-command-v1',
      command: {
        configVersion: command.configVersion,
        algorithmVersion: command.algorithmVersion,
        calendarCompilerVersion: command.calendarCompilerVersion,
        estimatePolicyVersion: command.estimatePolicyVersion,
        configJson: command.configJson,
        configDigest: command.configDigest,
      },
    });
    return deepFreeze({
      ok: true,
      commandType: 'PublishSchedulingConfigV1',
      command,
      commandJson: canonicalJsonSchedulingV1(command),
      commandDigest,
    });
  });
}

export function normalizeActivateSchedulingConfigV1(value) {
  return admissionResult('ACTIVATE_SCHEDULING_CONFIG_INVALID', () => {
    exactRecord(value, CONFIG_ACTIVATE_KEYS, '$');
    const command = {
      operationId: identifier(value.operationId, '$.operationId'),
      configVersion: controlledToken(value.configVersion, '$.configVersion'),
      expectedProjectionRevision: safeInteger(
        value.expectedProjectionRevision,
        '$.expectedProjectionRevision',
      ),
    };
    return deepFreeze({
      ok: true,
      commandType: 'ActivateSchedulingConfigV1',
      command,
      commandJson: canonicalJsonSchedulingV1(command),
      commandDigest: digestCanonicalJsonSchedulingV1({
        domain: 'scheduling-config-activate-command-v1',
        command: {
          configVersion: command.configVersion,
          expectedProjectionRevision: command.expectedProjectionRevision,
        },
      }),
    });
  });
}

function isoWeekday(date) {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function compileSchedulingCalendarDateV1(value) {
  return admissionResult('SCHEDULING_CALENDAR_COMPILE_INVALID', () => {
    exactRecord(value, CALENDAR_COMPILE_KEYS, '$');
    const calendarCompilerVersion = controlledToken(
      value.calendarCompilerVersion,
      '$.calendarCompilerVersion',
    );
    if (calendarCompilerVersion !== SCHEDULING_CALENDAR_COMPILER_VERSION_V1) {
      fail('CALENDAR_COMPILER_VERSION_UNSUPPORTED', '$.calendarCompilerVersion');
    }
    if (typeof SCHEDULING_TIME_ZONE_DATA_VERSION !== 'string'
      || SCHEDULING_TIME_ZONE_DATA_VERSION.length === 0) {
      fail('TIME_ZONE_DATA_UNAVAILABLE', '$.timeZoneDataVersion');
    }
    const timeZoneDataVersion = controlledToken(value.timeZoneDataVersion, '$.timeZoneDataVersion');
    if (timeZoneDataVersion !== SCHEDULING_TIME_ZONE_DATA_VERSION) {
      fail('TIME_ZONE_DATA_VERSION_MISMATCH', '$.timeZoneDataVersion');
    }
    const config = normalizeConfig(value.configJson, '$.configJson');
    const resourceId = identifier(value.resourceId, '$.resourceId');
    const date = calendarDate(value.date, '$.date');
    const calendar = config.resourceCalendars.find(item => item.resourceId === resourceId);
    if (!calendar) fail('RESOURCE_CALENDAR_NOT_FOUND', '$.resourceId');
    const override = calendar.dateOverrides.find(item => item.date === date);
    const source = override ? `dateOverride:${override.status}` : 'weekly';
    const localWindows = override
      ? override.windows
      : calendar.weeklyWindows
        .filter(window => window.weekday === isoWeekday(date))
        .map(({ start, end }) => ({ start, end }));
    const windows = compileLocalWindows(localWindows, date, config.businessTimeZone, '$.windows');
    const result = {
      resourceId,
      date,
      source,
      calendarCompilerVersion,
      timeZoneDataVersion,
      windows,
    };
    return deepFreeze({
      ok: true,
      ...result,
      resultDigest: digestCanonicalJsonSchedulingV1({
        domain: 'scheduling-calendar-compile-result-v1',
        result,
      }),
    });
  });
}
