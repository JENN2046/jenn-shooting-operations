import {
  SAMPLE_EXCLUSION_CODES_V1,
  SHADOW_METRIC_DEFINITION_VERSION_V1,
  SHADOW_METRIC_NAMES_V1,
} from './scheduling-evaluation-contract-v1.mjs';
import {
  canonicalJsonSchedulingV1,
  digestCanonicalJsonSchedulingV1,
} from './scheduling-contract-v1.mjs';

const ROOT_KEYS = Object.freeze([
  'schemaVersion', 'gateStatus', 'datasetDigest', 'datasetClass', 'approvalDigest',
  'algorithmVersion', 'configVersion', 'configDigest', 'metricDefinitionVersion',
  'eligibilityCounts', 'exclusionCounts', 'metrics', 'generatedAt', 'resultDigest',
]);
const ELIGIBILITY_KEYS = Object.freeze(['total', 'ineligible', 'levelA', 'levelB', 'levelC']);
const EXCLUSION_KEYS = Object.freeze(['code', 'count']);
const METRIC_KEYS = Object.freeze(['status', 'value', 'numerator', 'denominator']);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const EXCLUSION_ORDER = new Map(SAMPLE_EXCLUSION_CODES_V1.map((code, index) => [code, index]));

function invalid(reason) {
  return Object.freeze({ ok: false, code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID', reason });
}

function exactRecord(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length
      || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return null;
      }
      Object.defineProperty(result, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    return null;
  }
}

function exactArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return null;
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')
      || keys.some(key => typeof key !== 'string')) return null;
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return null;
      }
      items.push(descriptor.value);
    }
    return items;
  } catch {
    return null;
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function token(value) {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

function digest(value) {
  return typeof value === 'string' && DIGEST.test(value) ? value : null;
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

function admitEligibility(value) {
  const record = exactRecord(value, ELIGIBILITY_KEYS);
  if (!record) return null;
  const result = Object.fromEntries(ELIGIBILITY_KEYS.map(key => [key, safeCount(record[key])]));
  if (Object.values(result).some(item => item === null)
    || result.levelB > result.levelA
    || result.levelC > result.levelB
    || result.ineligible > result.total
    || result.levelA + result.ineligible !== result.total) return null;
  return Object.freeze(result);
}

function admitExclusions(value) {
  const array = exactArray(value);
  if (!array) return null;
  let previous = -1;
  const seen = new Set();
  const result = [];
  for (const item of array) {
    const record = exactRecord(item, EXCLUSION_KEYS);
    if (!record || !EXCLUSION_ORDER.has(record.code)
      || seen.has(record.code)
      || !Number.isSafeInteger(record.count) || record.count <= 0) return null;
    const order = EXCLUSION_ORDER.get(record.code);
    if (order <= previous) return null;
    previous = order;
    seen.add(record.code);
    result.push(Object.freeze({ code: record.code, count: record.count }));
  }
  return Object.freeze(result);
}

function admitMetric(name, value) {
  const record = exactRecord(value, METRIC_KEYS);
  if (!record || !['OK', 'NOT_ENOUGH_DATA'].includes(record.status)) return null;
  if (record.status === 'NOT_ENOUGH_DATA') {
    if (record.value !== null || record.numerator !== null || record.denominator !== 0) return null;
    return Object.freeze({
      status: 'NOT_ENOUGH_DATA', value: null, numerator: null, denominator: 0,
    });
  }
  if (!Number.isFinite(record.value) || record.value < 0
    || !Number.isSafeInteger(record.denominator) || record.denominator <= 0) return null;

  const statistics = new Set([
    'medianAbsoluteDurationErrorMs',
    'p90OverrunMs',
    'retrospectiveDurationBaselineMedianAbsoluteErrorMs',
    'retrospectiveDurationBaselineP90OverrunMs',
  ]);
  const rates = new Set(['setupBufferMissRate', 'humanOverrideRate']);
  const counts = new Set(['hardConflictCount', 'priorityViolationCount']);

  if (statistics.has(name)) {
    if (record.numerator !== null) return null;
  } else {
    if (!Number.isSafeInteger(record.numerator) || record.numerator < 0
      || record.numerator > record.denominator) return null;
    if (rates.has(name) && record.value !== record.numerator / record.denominator) return null;
    if (counts.has(name) && record.value !== record.numerator) return null;
  }

  return Object.freeze({
    status: 'OK',
    value: record.value,
    numerator: record.numerator,
    denominator: record.denominator,
  });
}

function admitMetrics(value) {
  const record = exactRecord(value, SHADOW_METRIC_NAMES_V1);
  if (!record) return null;
  const result = {};
  for (const name of SHADOW_METRIC_NAMES_V1) {
    const admitted = admitMetric(name, record[name]);
    if (!admitted) return null;
    Object.defineProperty(result, name, {
      value: admitted,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

export function admitLowDisclosureShadowReportV1(value) {
  try {
    const record = exactRecord(value, ROOT_KEYS);
    if (!record
      || record.schemaVersion !== 1
      || record.gateStatus !== 'BLOCKED_DATA'
      || !['synthetic', 'approvedLowDisclosure'].includes(record.datasetClass)
      || !digest(record.datasetDigest)
      || !token(record.algorithmVersion)
      || !token(record.configVersion)
      || !digest(record.configDigest)
      || record.metricDefinitionVersion !== SHADOW_METRIC_DEFINITION_VERSION_V1
      || !timestamp(record.generatedAt)
      || !digest(record.resultDigest)) return invalid('REPORT_SHAPE_INVALID');

    if ((record.datasetClass === 'synthetic' && record.approvalDigest !== null)
      || (record.datasetClass === 'approvedLowDisclosure' && !digest(record.approvalDigest))) {
      return invalid('REPORT_APPROVAL_MATRIX_INVALID');
    }

    const eligibilityCounts = admitEligibility(record.eligibilityCounts);
    const exclusionCounts = admitExclusions(record.exclusionCounts);
    const metrics = admitMetrics(record.metrics);
    if (!eligibilityCounts || !exclusionCounts || !metrics
      || exclusionCounts.some(item => item.count > eligibilityCounts.total)) {
      return invalid('REPORT_CONTENT_INVALID');
    }

    const agentMetricNames = [
      'medianAbsoluteDurationErrorMs',
      'p90OverrunMs',
      'setupBufferMissRate',
      'hardConflictCount',
      'humanOverrideRate',
      'priorityViolationCount',
    ];
    const baselineMetricNames = [
      'retrospectiveDurationBaselineMedianAbsoluteErrorMs',
      'retrospectiveDurationBaselineP90OverrunMs',
    ];
    if (eligibilityCounts.levelC === 0
      && agentMetricNames.some(name => metrics[name].status !== 'NOT_ENOUGH_DATA')) {
      return invalid('REPORT_CONTENT_INVALID');
    }
    if (eligibilityCounts.levelB === 0
      && baselineMetricNames.some(name => metrics[name].status !== 'NOT_ENOUGH_DATA')) {
      return invalid('REPORT_CONTENT_INVALID');
    }

    const body = Object.freeze({
      schemaVersion: 1,
      gateStatus: 'BLOCKED_DATA',
      datasetDigest: record.datasetDigest,
      datasetClass: record.datasetClass,
      approvalDigest: record.approvalDigest,
      algorithmVersion: record.algorithmVersion,
      configVersion: record.configVersion,
      configDigest: record.configDigest,
      metricDefinitionVersion: record.metricDefinitionVersion,
      eligibilityCounts,
      exclusionCounts,
      metrics,
    });
    const expectedDigest = digestCanonicalJsonSchedulingV1({
      domain: 'shadow-report-v1',
      report: body,
    });
    if (expectedDigest !== record.resultDigest) return invalid('REPORT_DIGEST_MISMATCH');

    const report = Object.freeze({
      ...body,
      generatedAt: timestamp(record.generatedAt),
      resultDigest: record.resultDigest,
    });
    return Object.freeze({
      ok: true,
      report,
      reportJson: canonicalJsonSchedulingV1(report),
      resultDigest: record.resultDigest,
    });
  } catch {
    return invalid('REPORT_SHAPE_INVALID');
  }
}
