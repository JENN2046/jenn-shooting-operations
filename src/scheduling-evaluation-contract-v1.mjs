import {
  SCHEDULING_HARD_DIAGNOSTIC_CODES_V1,
  canonicalJsonSchedulingV1,
  digestCanonicalJsonSchedulingV1,
  isSchedulingIdentifierV1,
  normalizeSchedulingInputV1,
} from './scheduling-contract-v1.mjs';
import { RUN_METRICS_ALGORITHM_VERSION } from './domain-rules-v2.mjs';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SNAPSHOT_CONTENT_KEYS = Object.freeze([
  'schemaVersion', 'runId', 'scope', 'scheduleItemId', 'requestId', 'resourceId',
  'productionType', 'shootingSubtype', 'lightingPreset', 'reflectivity',
  'durationEstimate', 'bufferAfterMinutes', 'bufferSource', 'resourceCapabilityDigest',
  'configVersion', 'configDigest', 'contextStatus', 'ineligibleReason',
]);
const SNAPSHOT_INPUT_KEYS = Object.freeze([...SNAPSHOT_CONTENT_KEYS, 'capturedAt']);
const SNAPSHOT_ENVELOPE_KEYS = Object.freeze([...SNAPSHOT_INPUT_KEYS, 'snapshotDigest']);
const DURATION_ESTIMATE_KEYS = Object.freeze(['durationMs', 'provenance', 'version']);
const EVENT_CHAIN_CONTENT_KEYS = Object.freeze([
  'runId', 'status', 'derivationVersion', 'correctionProvenance',
]);
const EVENT_CHAIN_KEYS = Object.freeze([...EVENT_CHAIN_CONTENT_KEYS, 'evidenceDigest']);
const METRICS_CONTENT_KEYS = Object.freeze([
  'runId', 'algorithmVersion', 'derivationVersion', 'actualNetDurationMs',
]);
const METRICS_KEYS = Object.freeze([...METRICS_CONTENT_KEYS, 'evidenceDigest']);
const SHADOW_KEYS = Object.freeze([
  'schedulingInput', 'proposal', 'decision', 'outcome', 'evidenceDigest',
]);
const INPUT_REF_KEYS = Object.freeze(['inputDigest']);
const PROPOSAL_REF_KEYS = Object.freeze([
  'proposalId', 'proposalItemId', 'requestId', 'inputDigest', 'resultDigest',
  'algorithmVersion', 'configVersion', 'configDigest',
]);
const DECISION_REF_KEYS = Object.freeze([
  'decisionReceiptDigest', 'proposalId', 'decisionType', 'selectedProposalItemIds',
  'adoptedProposalItemIds',
]);
const OUTCOME_REF_KEYS = Object.freeze([
  'outcomeDigest', 'requestId', 'runId', 'scheduleItemId', 'status', 'finalizedAt',
  'actualNetDurationMs',
]);
const CLASSIFIER_KEYS = Object.freeze([
  'schemaVersion', 'sampleId', 'requestId', 'scheduleItemId', 'runId', 'scope',
  'requestBindingCount', 'runStatus', 'eventChainEvidence', 'metricsEvidence',
  'pendingReview', 'scheduleStatus', 'allocationMode', 'legacySynthesized',
  'runContextSnapshot', 'shadowEvidence', 'outcomeCutoff',
]);
const MANIFEST_KEYS = Object.freeze([
  'schemaVersion', 'datasetId', 'datasetClass', 'approvalDigest', 'windowStart',
  'windowEnd', 'outcomeCutoff', 'cases',
]);
const CASE_KEYS = Object.freeze([
  'caseId', 'occurredAt', 'qualification', 'schedulingInput', 'proposalItem',
  'decisionFacts', 'finalItem', 'setupMeasurement', 'priorityPairs',
]);
const PROPOSAL_ITEM_KEYS = Object.freeze([
  'proposalId', 'proposalItemId', 'requestId', 'resourceId', 'plannedStart', 'plannedEnd',
  'predictedDurationMs', 'bufferMs', 'inputDigest', 'resultDigest', 'algorithmVersion',
  'configVersion', 'configDigest',
]);
const ADOPTED_ITEM_KEYS = Object.freeze([
  'proposalItemId', 'scheduleItemId', 'sourceOrdinal',
]);
const DECISION_FACT_KEYS = Object.freeze([
  'decisionReceiptDigest', 'proposalId', 'decisionType', 'selectedProposalItemIds', 'adoptedItems',
]);
const FINAL_ITEM_KEYS = Object.freeze([
  'scheduleItemId', 'resourceId', 'plannedStart', 'plannedEnd', 'bufferMs',
]);
const SETUP_KEYS = Object.freeze([
  'measurementDigest', 'requestId', 'proposalItemId', 'measuredSetupMs', 'bufferMs',
]);
const PRIORITY_PAIR_KEYS = Object.freeze([
  'pairId', 'higherRequestId', 'lowerRequestId', 'higherPriority', 'lowerPriority',
  'resourceId', 'slotStart', 'slotEnd', 'inputDigest',
]);
const REPORT_INPUT_KEYS = Object.freeze([
  'manifest', 'algorithmVersion', 'configVersion', 'configDigest',
  'metricDefinitionVersion', 'generatedAt',
]);

export const SAMPLE_CLASSIFIER_SCHEMA_V1 = 1;
export const RUN_CONTEXT_SNAPSHOT_SCHEMA_V1 = 1;
export const SHADOW_DATASET_SCHEMA_V1 = 1;
export const SHADOW_REPORT_SCHEMA_V1 = 1;
export const SHADOW_METRIC_DEFINITION_VERSION_V1 = 'shadow-metrics-v1';
export const SUPPORTED_EVENT_CHAIN_DERIVATION_VERSION_V1 = 'production-run-event-chain-v1';
export const SUPPORTED_RUN_METRICS_ALGORITHM_VERSION_V1 = RUN_METRICS_ALGORITHM_VERSION;
export const SUPPORTED_RUN_METRICS_DERIVATION_VERSION_V1 = 'production-run-net-derivation-v1';
export const HARD_CONSTRAINT_VALIDATOR_VERSION_V1 = 'hard-constraint-validator-v1';
export const PRIORITY_ORDER_VALIDATOR_VERSION_V1 = 'priority-order-validator-v1';

export const SAMPLE_EXCLUSION_CODES_V1 = Object.freeze([
  'EVENT_OUTSIDE_DATASET_WINDOW', 'EVENT_AFTER_CUTOFF', 'NOT_TASK_SCOPE',
  'BINDING_COUNT_NOT_ONE', 'RUN_NOT_COMPLETED', 'EVENT_CHAIN_INVALID',
  'EVENT_CHAIN_INCOMPLETE', 'EVENT_CHAIN_VERSION_UNKNOWN', 'EVENT_CHAIN_VERSION_UNSUPPORTED',
  'METRICS_VERSION_UNKNOWN', 'METRICS_VERSION_UNSUPPORTED',
  'NET_DURATION_INVALID', 'PENDING_REVIEW', 'CORRECTION_PRESENT', 'SCHEDULE_CANCELLED',
  'GROUPED_UNALLOCATED', 'LEGACY_SYNTHESIZED', 'RUN_CONTEXT_SNAPSHOT_MISSING',
  'RUN_CONTEXT_SNAPSHOT_INELIGIBLE', 'SCHEDULING_INPUT_MISSING', 'PROPOSAL_MISSING',
  'ITEM_DECISION_DIFF_MISSING', 'OUTCOME_MISSING', 'OUTCOME_INCOMPLETE_AT_CUTOFF',
  'OUTCOME_AFTER_CUTOFF',
]);

export const RUN_CONTEXT_INELIGIBLE_REASONS_V1 = Object.freeze([
  'GROUPED_UNALLOCATED', 'CONFIG_MISSING', 'RULE_FACT_MISSING',
]);

export const SHADOW_METRIC_NAMES_V1 = Object.freeze([
  'medianAbsoluteDurationErrorMs', 'p90OverrunMs', 'setupBufferMissRate',
  'hardConflictCount', 'humanOverrideRate', 'priorityViolationCount',
  'retrospectiveDurationBaselineMedianAbsoluteErrorMs',
  'retrospectiveDurationBaselineP90OverrunMs',
]);

const EXCLUSION_ORDER = new Map(SAMPLE_EXCLUSION_CODES_V1.map((code, index) => [code, index]));
const RUN_CONTEXT_REASONS = new Set(RUN_CONTEXT_INELIGIBLE_REASONS_V1);
const FLAT_SUBTYPES = new Set(['模特', '细节', '场景', '待定']);
const VIDEO_SUBTYPES = new Set(['产品展示', '人物展示', '产品加人物展示', '口播', '剧情短片', '场景视频']);
const PRIORITIES = new Map([['p0', 0], ['p1', 1], ['p2', 2]]);
const HARD_CODES = new Set(SCHEDULING_HARD_DIAGNOSTIC_CODES_V1);

class ContractError extends Error {
  constructor(reason, path) {
    super('SCHEDULING_EVALUATION_CONTRACT_INVALID');
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason, path) { throw new ContractError(reason, path); }

function admissionResult(error, operation) {
  try {
    return operation();
  } catch (caught) {
    if (caught instanceof ContractError) {
      return Object.freeze({ ok: false, error, reason: caught.reason, path: caught.path });
    }
    return Object.freeze({ ok: false, error, reason: 'MALFORMED_OR_HOSTILE_INPUT', path: '$' });
  }
}

function keysOf(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail('EXACT_KEYS', path);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || UNSAFE_KEYS.has(key) || LONE_SURROGATE.test(key))) {
    fail('EXACT_KEYS', path);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('EXACT_KEYS', path);
  }
  return keys;
}

function exact(value, expected, path) {
  const keys = keysOf(value, path);
  const allowed = new Set(expected);
  if (keys.length !== expected.length || keys.some(key => !allowed.has(key))) fail('EXACT_KEYS', path);
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) fail('ARRAY_INVALID', path);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)))) {
    fail('ARRAY_INVALID', path);
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('ARRAY_INVALID', path);
    return descriptor.value;
  });
}

function compare(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function identifier(value, path, maximum = 160) {
  if (!isSchedulingIdentifierV1(value, maximum)) fail('IDENTIFIER_INVALID', path);
  return value;
}

function token(value, path) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('CONTROLLED_TOKEN_INVALID', path);
  return value;
}

function digest(value, path) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('DIGEST_INVALID', path);
  return value;
}

function booleanValue(value, path) {
  if (typeof value !== 'boolean') fail('BOOLEAN_INVALID', path);
  return value;
}

function integer(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('SAFE_INTEGER_INVALID', path);
  return Object.is(value, -0) ? 0 : value;
}

function enumValue(value, values, path) {
  if (!values.has(value)) fail('ENUM_INVALID', path);
  return value;
}

function timestamp(value, path) {
  if (typeof value !== 'string') fail('TIMESTAMP_INVALID', path);
  const match = RFC3339.exec(value);
  if (!match) fail('TIMESTAMP_INVALID', path);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail('TIMESTAMP_INVALID', path);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) fail('TIMESTAMP_INVALID', path);
  return new Date(instant).toISOString();
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function uniqueTokens(value, path) {
  const values = array(value, path).map((item, index) => token(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) fail('DUPLICATE_IDENTIFIER', path);
  return values.toSorted(compare);
}

function uniqueIdentifiers(value, path) {
  const values = array(value, path).map((item, index) => identifier(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) fail('DUPLICATE_IDENTIFIER', path);
  return values.toSorted(compare);
}

function verifiedEvidence(value, keys, contentKeys, domain, path, normalizeContent) {
  exact(value, keys, path);
  const content = normalizeContent(Object.fromEntries(contentKeys.map(key => [key, value[key]])), path);
  const evidenceDigest = digest(value.evidenceDigest, `${path}.evidenceDigest`);
  const expected = digestCanonicalJsonSchedulingV1({ domain, content });
  if (evidenceDigest !== expected) fail('EVIDENCE_DIGEST_MISMATCH', `${path}.evidenceDigest`);
  return { ...content, evidenceDigest };
}

function normalizeDurationEstimate(value, path) {
  if (value === null) return null;
  exact(value, DURATION_ESTIMATE_KEYS, path);
  return {
    durationMs: integer(value.durationMs, `${path}.durationMs`, 1),
    provenance: token(value.provenance, `${path}.provenance`),
    version: token(value.version, `${path}.version`),
  };
}

function normalizeSnapshotContent(value, path) {
  exact(value, SNAPSHOT_CONTENT_KEYS, path);
  if (value.schemaVersion !== 1) fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  const scope = enumValue(value.scope, new Set(['task', 'block']), `${path}.scope`);
  const productionType = value.productionType === null ? null
    : enumValue(value.productionType, new Set(['平面', '视频']), `${path}.productionType`);
  const shootingSubtype = value.shootingSubtype === null ? null
    : identifier(value.shootingSubtype, `${path}.shootingSubtype`, 120);
  if ((productionType === null && shootingSubtype !== null)
    || (productionType === '平面' && !FLAT_SUBTYPES.has(shootingSubtype))
    || (productionType === '视频' && !VIDEO_SUBTYPES.has(shootingSubtype))) {
    fail('PRODUCTION_FACTS_INCONSISTENT', path);
  }
  const content = {
    schemaVersion: 1,
    runId: identifier(value.runId, `${path}.runId`),
    scope,
    scheduleItemId: identifier(value.scheduleItemId, `${path}.scheduleItemId`),
    requestId: value.requestId === null ? null : identifier(value.requestId, `${path}.requestId`),
    resourceId: value.resourceId === null ? null : identifier(value.resourceId, `${path}.resourceId`),
    productionType,
    shootingSubtype,
    lightingPreset: value.lightingPreset === null ? null : identifier(value.lightingPreset, `${path}.lightingPreset`, 120),
    reflectivity: value.reflectivity === null ? null
      : enumValue(value.reflectivity, new Set(['unknown', 'low', 'medium', 'high']), `${path}.reflectivity`),
    durationEstimate: normalizeDurationEstimate(value.durationEstimate, `${path}.durationEstimate`),
    bufferAfterMinutes: value.bufferAfterMinutes === null ? null
      : integer(value.bufferAfterMinutes, `${path}.bufferAfterMinutes`),
    bufferSource: value.bufferSource === null ? null : token(value.bufferSource, `${path}.bufferSource`),
    resourceCapabilityDigest: value.resourceCapabilityDigest === null ? null
      : digest(value.resourceCapabilityDigest, `${path}.resourceCapabilityDigest`),
    configVersion: value.configVersion === null ? null : token(value.configVersion, `${path}.configVersion`),
    configDigest: value.configDigest === null ? null : digest(value.configDigest, `${path}.configDigest`),
    contextStatus: enumValue(value.contextStatus, new Set(['complete', 'ineligible']), `${path}.contextStatus`),
    ineligibleReason: value.ineligibleReason === null ? null
      : enumValue(value.ineligibleReason, RUN_CONTEXT_REASONS, `${path}.ineligibleReason`),
  };
  const completeFields = [content.requestId, content.resourceId, content.productionType,
    content.shootingSubtype, content.lightingPreset, content.reflectivity, content.durationEstimate,
    content.bufferAfterMinutes, content.bufferSource, content.resourceCapabilityDigest,
    content.configVersion, content.configDigest];
  if (scope === 'block' && (content.contextStatus !== 'ineligible'
    || content.ineligibleReason !== 'GROUPED_UNALLOCATED')) fail('SNAPSHOT_SCOPE_MATRIX_INVALID', path);
  if (content.contextStatus === 'complete' && (scope !== 'task'
    || content.ineligibleReason !== null || completeFields.some(item => item === null))) {
    fail('SNAPSHOT_COMPLETENESS_INVALID', path);
  }
  if (content.contextStatus === 'ineligible' && content.ineligibleReason === null) {
    fail('SNAPSHOT_COMPLETENESS_INVALID', path);
  }
  return content;
}

function normalizeSnapshotEnvelope(value, path) {
  exact(value, SNAPSHOT_ENVELOPE_KEYS, path);
  const capturedAt = timestamp(value.capturedAt, `${path}.capturedAt`);
  const content = normalizeSnapshotContent(
    Object.fromEntries(SNAPSHOT_CONTENT_KEYS.map(key => [key, value[key]])), path,
  );
  const snapshotDigest = digest(value.snapshotDigest, `${path}.snapshotDigest`);
  const expected = digestCanonicalJsonSchedulingV1({ domain: 'scheduling-run-context-snapshot-v1', content });
  if (snapshotDigest !== expected) fail('EVIDENCE_DIGEST_MISMATCH', `${path}.snapshotDigest`);
  return { ...content, capturedAt, snapshotDigest };
}

export function buildSchedulingRunContextSnapshotV1(value) {
  return admissionResult('RUN_CONTEXT_SNAPSHOT_INVALID', () => {
    exact(value, SNAPSHOT_INPUT_KEYS, '$');
    const capturedAt = timestamp(value.capturedAt, '$.capturedAt');
    const content = normalizeSnapshotContent(
      Object.fromEntries(SNAPSHOT_CONTENT_KEYS.map(key => [key, value[key]])), '$',
    );
    const snapshotDigest = digestCanonicalJsonSchedulingV1({
      domain: 'scheduling-run-context-snapshot-v1', content,
    });
    return freeze({ ok: true, snapshot: { ...content, capturedAt, snapshotDigest },
      snapshotJson: canonicalJsonSchedulingV1(content), snapshotDigest });
  });
}

function normalizeEventContent(value, path) {
  exact(value, EVENT_CHAIN_CONTENT_KEYS, path);
  return {
    runId: identifier(value.runId, `${path}.runId`),
    status: enumValue(value.status, new Set(['valid', 'invalid', 'incomplete']), `${path}.status`),
    derivationVersion: value.derivationVersion === null ? null
      : token(value.derivationVersion, `${path}.derivationVersion`),
    correctionProvenance: uniqueTokens(value.correctionProvenance, `${path}.correctionProvenance`),
  };
}

function normalizeMetricsContent(value, path) {
  exact(value, METRICS_CONTENT_KEYS, path);
  return {
    runId: identifier(value.runId, `${path}.runId`),
    algorithmVersion: value.algorithmVersion === null ? null : token(value.algorithmVersion, `${path}.algorithmVersion`),
    derivationVersion: value.derivationVersion === null ? null : token(value.derivationVersion, `${path}.derivationVersion`),
    actualNetDurationMs: value.actualNetDurationMs === null ? null
      : integer(value.actualNetDurationMs, `${path}.actualNetDurationMs`, 1),
  };
}

function normalizeInputRef(value, path) {
  exact(value, INPUT_REF_KEYS, path);
  return { inputDigest: digest(value.inputDigest, `${path}.inputDigest`) };
}

function normalizeProposalRef(value, path) {
  exact(value, PROPOSAL_REF_KEYS, path);
  return {
    proposalId: identifier(value.proposalId, `${path}.proposalId`),
    proposalItemId: identifier(value.proposalItemId, `${path}.proposalItemId`),
    requestId: identifier(value.requestId, `${path}.requestId`),
    inputDigest: digest(value.inputDigest, `${path}.inputDigest`),
    resultDigest: digest(value.resultDigest, `${path}.resultDigest`),
    algorithmVersion: token(value.algorithmVersion, `${path}.algorithmVersion`),
    configVersion: token(value.configVersion, `${path}.configVersion`),
    configDigest: digest(value.configDigest, `${path}.configDigest`),
  };
}

function normalizeDecisionRef(value, path) {
  exact(value, DECISION_REF_KEYS, path);
  const selected = uniqueIdentifiers(value.selectedProposalItemIds, `${path}.selectedProposalItemIds`);
  const adopted = uniqueIdentifiers(value.adoptedProposalItemIds, `${path}.adoptedProposalItemIds`);
  if (adopted.some(id => !selected.includes(id))) fail('DECISION_RELATION_INVALID', path);
  const decisionType = enumValue(value.decisionType,
    new Set(['accept', 'partiallyAccept', 'reject']), `${path}.decisionType`);
  if ((decisionType === 'reject' && (selected.length !== 0 || adopted.length !== 0))
    || (decisionType !== 'reject' && (selected.length === 0 || adopted.length !== selected.length))) {
    fail('DECISION_RELATION_INVALID', path);
  }
  return { decisionReceiptDigest: digest(value.decisionReceiptDigest, `${path}.decisionReceiptDigest`),
    proposalId: identifier(value.proposalId, `${path}.proposalId`), decisionType,
    selectedProposalItemIds: selected, adoptedProposalItemIds: adopted };
}

function normalizeOutcomeRef(value, path) {
  exact(value, OUTCOME_REF_KEYS, path);
  const status = enumValue(value.status, new Set(['complete', 'incomplete']), `${path}.status`);
  const finalizedAt = value.finalizedAt === null ? null : timestamp(value.finalizedAt, `${path}.finalizedAt`);
  const actualNetDurationMs = value.actualNetDurationMs === null ? null
    : integer(value.actualNetDurationMs, `${path}.actualNetDurationMs`, 1);
  if ((status === 'complete') !== (finalizedAt !== null && actualNetDurationMs !== null)) {
    fail('OUTCOME_RELATION_INVALID', path);
  }
  return { outcomeDigest: digest(value.outcomeDigest, `${path}.outcomeDigest`),
    requestId: identifier(value.requestId, `${path}.requestId`),
    runId: identifier(value.runId, `${path}.runId`),
    scheduleItemId: identifier(value.scheduleItemId, `${path}.scheduleItemId`), status, finalizedAt,
    actualNetDurationMs };
}

function normalizeShadowEvidence(value, path) {
  if (value === null) return null;
  exact(value, SHADOW_KEYS, path);
  const content = {
    schedulingInput: value.schedulingInput === null ? null : normalizeInputRef(value.schedulingInput, `${path}.schedulingInput`),
    proposal: value.proposal === null ? null : normalizeProposalRef(value.proposal, `${path}.proposal`),
    decision: value.decision === null ? null : normalizeDecisionRef(value.decision, `${path}.decision`),
    outcome: value.outcome === null ? null : normalizeOutcomeRef(value.outcome, `${path}.outcome`),
  };
  const evidenceDigest = digest(value.evidenceDigest, `${path}.evidenceDigest`);
  const expected = digestCanonicalJsonSchedulingV1({ domain: 'shadow-case-evidence-v1', content });
  if (evidenceDigest !== expected) fail('EVIDENCE_DIGEST_MISMATCH', `${path}.evidenceDigest`);
  if (content.schedulingInput && content.proposal
    && content.schedulingInput.inputDigest !== content.proposal.inputDigest) fail('EVIDENCE_RELATION_INVALID', path);
  if (content.proposal && content.decision && content.proposal.proposalId !== content.decision.proposalId) {
    fail('EVIDENCE_RELATION_INVALID', path);
  }
  return { ...content, evidenceDigest };
}

function normalizeClassifier(value, path = '$') {
  exact(value, CLASSIFIER_KEYS, path);
  if (value.schemaVersion !== 1) fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  const requestId = identifier(value.requestId, `${path}.requestId`);
  const scheduleItemId = identifier(value.scheduleItemId, `${path}.scheduleItemId`);
  const runId = identifier(value.runId, `${path}.runId`);
  const scope = enumValue(value.scope, new Set(['task', 'block']), `${path}.scope`);
  const eventChainEvidence = verifiedEvidence(value.eventChainEvidence, EVENT_CHAIN_KEYS,
    EVENT_CHAIN_CONTENT_KEYS, 'event-chain-evidence-v1', `${path}.eventChainEvidence`, normalizeEventContent);
  const metricsEvidence = verifiedEvidence(value.metricsEvidence, METRICS_KEYS,
    METRICS_CONTENT_KEYS, 'run-metrics-evidence-v1', `${path}.metricsEvidence`, normalizeMetricsContent);
  if (eventChainEvidence.runId !== runId || metricsEvidence.runId !== runId) fail('EVIDENCE_RELATION_INVALID', path);
  const snapshot = value.runContextSnapshot === null ? null
    : normalizeSnapshotEnvelope(value.runContextSnapshot, `${path}.runContextSnapshot`);
  if (snapshot && (snapshot.runId !== runId || snapshot.scheduleItemId !== scheduleItemId
    || snapshot.scope !== scope || (scope === 'task' && snapshot.requestId !== requestId)
    || (scope === 'block' && snapshot.requestId !== null))) fail('EVIDENCE_RELATION_INVALID', path);
  const shadow = normalizeShadowEvidence(value.shadowEvidence, `${path}.shadowEvidence`);
  if (shadow?.proposal && shadow.proposal.requestId !== requestId) fail('EVIDENCE_RELATION_INVALID', path);
  if (shadow?.outcome && (shadow.outcome.requestId !== requestId || shadow.outcome.runId !== runId
    || shadow.outcome.scheduleItemId !== scheduleItemId
    || (shadow.outcome.actualNetDurationMs !== null
      && shadow.outcome.actualNetDurationMs !== metricsEvidence.actualNetDurationMs))) {
    fail('EVIDENCE_RELATION_INVALID', path);
  }
  if (shadow?.proposal && shadow?.decision) {
    const itemId = shadow.proposal.proposalItemId;
    const selected = shadow.decision.selectedProposalItemIds.includes(itemId);
    const adopted = shadow.decision.adoptedProposalItemIds.includes(itemId);
    if (selected !== adopted) fail('EVIDENCE_RELATION_INVALID', path);
  }
  return { schemaVersion: 1, sampleId: identifier(value.sampleId, `${path}.sampleId`), requestId,
    scheduleItemId, runId, scope,
    requestBindingCount: integer(value.requestBindingCount, `${path}.requestBindingCount`),
    runStatus: enumValue(value.runStatus, new Set(['completed', 'active', 'cancelled']), `${path}.runStatus`),
    eventChainEvidence, metricsEvidence,
    pendingReview: booleanValue(value.pendingReview, `${path}.pendingReview`),
    scheduleStatus: enumValue(value.scheduleStatus, new Set(['confirmed', 'draft', 'cancelled']), `${path}.scheduleStatus`),
    allocationMode: enumValue(value.allocationMode, new Set(['single', 'groupedUnallocated']), `${path}.allocationMode`),
    legacySynthesized: booleanValue(value.legacySynthesized, `${path}.legacySynthesized`),
    runContextSnapshot: snapshot, shadowEvidence: shadow,
    outcomeCutoff: timestamp(value.outcomeCutoff, `${path}.outcomeCutoff`) };
}

function classify(input) {
  const exclusions = new Set();
  if (input.scope !== 'task') exclusions.add('NOT_TASK_SCOPE');
  if (input.requestBindingCount !== 1) exclusions.add('BINDING_COUNT_NOT_ONE');
  if (input.runStatus !== 'completed') exclusions.add('RUN_NOT_COMPLETED');
  if (input.eventChainEvidence.status === 'invalid') exclusions.add('EVENT_CHAIN_INVALID');
  if (input.eventChainEvidence.status === 'incomplete') exclusions.add('EVENT_CHAIN_INCOMPLETE');
  if (input.eventChainEvidence.derivationVersion === null) exclusions.add('EVENT_CHAIN_VERSION_UNKNOWN');
  else if (input.eventChainEvidence.derivationVersion !== SUPPORTED_EVENT_CHAIN_DERIVATION_VERSION_V1) {
    exclusions.add('EVENT_CHAIN_VERSION_UNSUPPORTED');
  }
  if (input.metricsEvidence.algorithmVersion === null || input.metricsEvidence.derivationVersion === null) {
    exclusions.add('METRICS_VERSION_UNKNOWN');
  } else if (input.metricsEvidence.algorithmVersion !== SUPPORTED_RUN_METRICS_ALGORITHM_VERSION_V1
    || input.metricsEvidence.derivationVersion !== SUPPORTED_RUN_METRICS_DERIVATION_VERSION_V1) {
    exclusions.add('METRICS_VERSION_UNSUPPORTED');
  }
  if (input.metricsEvidence.actualNetDurationMs === null) exclusions.add('NET_DURATION_INVALID');
  if (input.pendingReview) exclusions.add('PENDING_REVIEW');
  if (input.eventChainEvidence.correctionProvenance.length > 0) exclusions.add('CORRECTION_PRESENT');
  if (input.scheduleStatus === 'cancelled') exclusions.add('SCHEDULE_CANCELLED');
  if (input.allocationMode === 'groupedUnallocated') exclusions.add('GROUPED_UNALLOCATED');
  if (input.legacySynthesized) exclusions.add('LEGACY_SYNTHESIZED');
  const levelA = exclusions.size === 0;
  if (input.runContextSnapshot === null) exclusions.add('RUN_CONTEXT_SNAPSHOT_MISSING');
  else if (input.runContextSnapshot.contextStatus !== 'complete') exclusions.add('RUN_CONTEXT_SNAPSHOT_INELIGIBLE');
  const levelB = levelA && input.runContextSnapshot?.contextStatus === 'complete';
  const shadow = input.shadowEvidence;
  if (shadow?.schedulingInput == null) exclusions.add('SCHEDULING_INPUT_MISSING');
  if (shadow?.proposal == null) exclusions.add('PROPOSAL_MISSING');
  if (shadow?.decision == null) exclusions.add('ITEM_DECISION_DIFF_MISSING');
  if (shadow?.outcome == null) exclusions.add('OUTCOME_MISSING');
  else if (shadow.outcome.status !== 'complete') exclusions.add('OUTCOME_INCOMPLETE_AT_CUTOFF');
  else if (Date.parse(shadow.outcome.finalizedAt) > Date.parse(input.outcomeCutoff)) exclusions.add('OUTCOME_AFTER_CUTOFF');
  const levelC = levelB && shadow?.schedulingInput != null && shadow.proposal != null
    && shadow.decision != null && shadow.outcome?.status === 'complete'
    && Date.parse(shadow.outcome.finalizedAt) <= Date.parse(input.outcomeCutoff);
  return { sampleId: input.sampleId, highestLevel: levelC ? 'LEVEL_C' : levelB ? 'LEVEL_B' : levelA ? 'LEVEL_A' : 'NONE',
    eligibleLevels: { levelA, levelB, levelC }, exclusionCodes: [...exclusions]
      .toSorted((left, right) => EXCLUSION_ORDER.get(left) - EXCLUSION_ORDER.get(right)) };
}

export function classifySchedulingSampleV1(value) {
  return admissionResult('SAMPLE_CLASSIFIER_INPUT_INVALID', () => {
    const input = normalizeClassifier(value);
    return freeze({ ok: true, input, classification: classify(input) });
  });
}

function normalizeProposalItem(value, path) {
  if (value === null) return null;
  exact(value, PROPOSAL_ITEM_KEYS, path);
  const plannedStart = timestamp(value.plannedStart, `${path}.plannedStart`);
  const plannedEnd = timestamp(value.plannedEnd, `${path}.plannedEnd`);
  const predictedDurationMs = integer(value.predictedDurationMs, `${path}.predictedDurationMs`, 1);
  if (Date.parse(plannedEnd) - Date.parse(plannedStart) !== predictedDurationMs) fail('DURATION_RELATION_INVALID', path);
  return { proposalId: identifier(value.proposalId, `${path}.proposalId`),
    proposalItemId: identifier(value.proposalItemId, `${path}.proposalItemId`),
    requestId: identifier(value.requestId, `${path}.requestId`),
    resourceId: identifier(value.resourceId, `${path}.resourceId`), plannedStart, plannedEnd,
    predictedDurationMs, bufferMs: integer(value.bufferMs, `${path}.bufferMs`),
    inputDigest: digest(value.inputDigest, `${path}.inputDigest`),
    resultDigest: digest(value.resultDigest, `${path}.resultDigest`),
    algorithmVersion: token(value.algorithmVersion, `${path}.algorithmVersion`),
    configVersion: token(value.configVersion, `${path}.configVersion`),
    configDigest: digest(value.configDigest, `${path}.configDigest`) };
}

function normalizeAdopted(value, path) {
  exact(value, ADOPTED_ITEM_KEYS, path);
  return { proposalItemId: identifier(value.proposalItemId, `${path}.proposalItemId`),
    scheduleItemId: identifier(value.scheduleItemId, `${path}.scheduleItemId`),
    sourceOrdinal: integer(value.sourceOrdinal, `${path}.sourceOrdinal`) };
}

function normalizeDecisionFacts(value, path) {
  if (value === null) return null;
  exact(value, DECISION_FACT_KEYS, path);
  const decisionType = enumValue(value.decisionType,
    new Set(['accept', 'partiallyAccept', 'reject']), `${path}.decisionType`);
  const selected = uniqueIdentifiers(value.selectedProposalItemIds, `${path}.selectedProposalItemIds`);
  const adopted = array(value.adoptedItems, `${path}.adoptedItems`)
    .map((item, index) => normalizeAdopted(item, `${path}.adoptedItems[${index}]`))
    .toSorted((left, right) => compare(left.proposalItemId, right.proposalItemId));
  if (new Set(adopted.map(item => item.proposalItemId)).size !== adopted.length
    || adopted.some(item => !selected.includes(item.proposalItemId))) fail('DECISION_RELATION_INVALID', path);
  if ((decisionType === 'reject' && (selected.length !== 0 || adopted.length !== 0))
    || (decisionType !== 'reject' && (selected.length === 0 || adopted.length !== selected.length))) {
    fail('DECISION_RELATION_INVALID', path);
  }
  return { decisionReceiptDigest: digest(value.decisionReceiptDigest, `${path}.decisionReceiptDigest`),
    proposalId: identifier(value.proposalId, `${path}.proposalId`), decisionType,
    selectedProposalItemIds: selected, adoptedItems: adopted };
}

function normalizeFinalItem(value, path) {
  if (value === null) return null;
  exact(value, FINAL_ITEM_KEYS, path);
  const plannedStart = timestamp(value.plannedStart, `${path}.plannedStart`);
  const plannedEnd = timestamp(value.plannedEnd, `${path}.plannedEnd`);
  if (Date.parse(plannedEnd) <= Date.parse(plannedStart)) fail('INTERVAL_INVALID', path);
  return { scheduleItemId: identifier(value.scheduleItemId, `${path}.scheduleItemId`),
    resourceId: identifier(value.resourceId, `${path}.resourceId`), plannedStart, plannedEnd,
    bufferMs: integer(value.bufferMs, `${path}.bufferMs`) };
}

function normalizeSetup(value, path) {
  if (value === null) return null;
  exact(value, SETUP_KEYS, path);
  const content = {
    requestId: identifier(value.requestId, `${path}.requestId`),
    proposalItemId: identifier(value.proposalItemId, `${path}.proposalItemId`),
    measuredSetupMs: integer(value.measuredSetupMs, `${path}.measuredSetupMs`),
    bufferMs: integer(value.bufferMs, `${path}.bufferMs`),
  };
  const measurementDigest = digest(value.measurementDigest, `${path}.measurementDigest`);
  const expected = digestCanonicalJsonSchedulingV1({ domain: 'setup-measurement-v1', content });
  if (measurementDigest !== expected) fail('EVIDENCE_DIGEST_MISMATCH', `${path}.measurementDigest`);
  return { measurementDigest, ...content };
}

function normalizePair(value, path) {
  exact(value, PRIORITY_PAIR_KEYS, path);
  const higherPriority = enumValue(value.higherPriority, new Set(PRIORITIES.keys()), `${path}.higherPriority`);
  const lowerPriority = enumValue(value.lowerPriority, new Set(PRIORITIES.keys()), `${path}.lowerPriority`);
  if (PRIORITIES.get(higherPriority) >= PRIORITIES.get(lowerPriority)) fail('PRIORITY_RELATION_INVALID', path);
  const slotStart = timestamp(value.slotStart, `${path}.slotStart`);
  const slotEnd = timestamp(value.slotEnd, `${path}.slotEnd`);
  if (Date.parse(slotEnd) <= Date.parse(slotStart)) fail('INTERVAL_INVALID', path);
  const higherRequestId = identifier(value.higherRequestId, `${path}.higherRequestId`);
  const lowerRequestId = identifier(value.lowerRequestId, `${path}.lowerRequestId`);
  if (higherRequestId === lowerRequestId) fail('PRIORITY_RELATION_INVALID', path);
  return { pairId: identifier(value.pairId, `${path}.pairId`), higherRequestId, lowerRequestId,
    higherPriority, lowerPriority, resourceId: identifier(value.resourceId, `${path}.resourceId`),
    slotStart, slotEnd, inputDigest: digest(value.inputDigest, `${path}.inputDigest`) };
}

function normalizeCase(value, path) {
  exact(value, CASE_KEYS, path);
  const qualification = normalizeClassifier(value.qualification, `${path}.qualification`);
  const caseId = identifier(value.caseId, `${path}.caseId`);
  if (caseId !== qualification.sampleId) fail('CASE_ID_MISMATCH', path);
  let schedulingInput = null;
  let schedulingInputDigest = null;
  if (value.schedulingInput !== null) {
    const normalizedInput = normalizeSchedulingInputV1(value.schedulingInput);
    if (!normalizedInput.ok) fail('SCHEDULING_INPUT_INVALID', `${path}.schedulingInput`);
    schedulingInput = normalizedInput.input;
    schedulingInputDigest = normalizedInput.inputDigest;
  }
  const proposalItem = normalizeProposalItem(value.proposalItem, `${path}.proposalItem`);
  const decisionFacts = normalizeDecisionFacts(value.decisionFacts, `${path}.decisionFacts`);
  const finalItem = normalizeFinalItem(value.finalItem, `${path}.finalItem`);
  const setupMeasurement = normalizeSetup(value.setupMeasurement, `${path}.setupMeasurement`);
  const priorityPairs = array(value.priorityPairs, `${path}.priorityPairs`)
    .map((item, index) => normalizePair(item, `${path}.priorityPairs[${index}]`))
    .toSorted((left, right) => compare(left.pairId, right.pairId));
  const shadow = qualification.shadowEvidence;
  const classification = classify(qualification);
  if (classification.eligibleLevels.levelC && (!schedulingInput || !proposalItem || !decisionFacts
    || !shadow?.proposal || !shadow.decision || !shadow.outcome || !shadow.schedulingInput)) {
    fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
  }
  if (proposalItem !== null) {
    if (!schedulingInput || !shadow?.proposal || !shadow.schedulingInput) {
      fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
    }
    const proposalMatches = proposalItem.proposalId === shadow.proposal.proposalId
      && proposalItem.proposalItemId === shadow.proposal.proposalItemId
      && proposalItem.requestId === qualification.requestId
      && proposalItem.inputDigest === schedulingInputDigest
      && proposalItem.inputDigest === shadow.schedulingInput.inputDigest
      && proposalItem.inputDigest === shadow.proposal.inputDigest
      && proposalItem.resultDigest === shadow.proposal.resultDigest
      && proposalItem.algorithmVersion === shadow.proposal.algorithmVersion
      && proposalItem.configVersion === shadow.proposal.configVersion
      && proposalItem.configDigest === shadow.proposal.configDigest
      && proposalItem.algorithmVersion === schedulingInput.algorithmVersion
      && proposalItem.configVersion === schedulingInput.configVersion
      && proposalItem.configDigest === schedulingInput.configDigest
      && schedulingInput.candidates.some(candidate => candidate.requestId === proposalItem.requestId)
      && schedulingInput.resources.some(resource => resource.resourceId === proposalItem.resourceId
        && resource.status === 'active')
      && Date.parse(proposalItem.plannedStart) >= Date.parse(schedulingInput.planningWindowStart)
      && Date.parse(proposalItem.plannedEnd) <= Date.parse(schedulingInput.planningWindowEnd);
    if (!proposalMatches) fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
  }
  if (decisionFacts !== null) {
    if (!proposalItem || !shadow?.decision || decisionFacts.proposalId !== proposalItem.proposalId
      || decisionFacts.decisionReceiptDigest !== shadow.decision.decisionReceiptDigest
      || decisionFacts.decisionType !== shadow.decision.decisionType
      || canonicalJsonSchedulingV1(decisionFacts.selectedProposalItemIds)
        !== canonicalJsonSchedulingV1(shadow.decision.selectedProposalItemIds)
      || canonicalJsonSchedulingV1(decisionFacts.adoptedItems.map(item => item.proposalItemId))
        !== canonicalJsonSchedulingV1(shadow.decision.adoptedProposalItemIds)) {
      fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
    }
    const adopted = decisionFacts.adoptedItems.find(item => item.proposalItemId === proposalItem.proposalItemId);
    const selected = decisionFacts.selectedProposalItemIds.includes(proposalItem.proposalItemId);
    if (selected && (!adopted || adopted.scheduleItemId !== qualification.scheduleItemId
      || adopted.scheduleItemId !== shadow.outcome?.scheduleItemId
      || adopted.scheduleItemId !== finalItem?.scheduleItemId)) {
      fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
    }
  }
  if (setupMeasurement && (!proposalItem || setupMeasurement.requestId !== qualification.requestId
    || setupMeasurement.proposalItemId !== proposalItem.proposalItemId
    || setupMeasurement.bufferMs !== proposalItem.bufferMs)) fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
  if (finalItem !== null && finalItem.scheduleItemId !== qualification.scheduleItemId) {
    fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
  }
  if (proposalItem && priorityPairs.some(pair => pair.lowerRequestId !== proposalItem.requestId
    || pair.resourceId !== proposalItem.resourceId || pair.slotStart !== proposalItem.plannedStart
    || pair.slotEnd !== proposalItem.plannedEnd || pair.inputDigest !== proposalItem.inputDigest
    || !schedulingInput.candidates.some(candidate => candidate.requestId === pair.higherRequestId)
    || !schedulingInput.candidates.some(candidate => candidate.requestId === pair.lowerRequestId))) {
    fail('ATOMIC_EVIDENCE_RELATION_INVALID', path);
  }
  if (new Set(priorityPairs.map(item => item.pairId)).size !== priorityPairs.length) {
    fail('DUPLICATE_IDENTIFIER', `${path}.priorityPairs`);
  }
  return { caseId, occurredAt: timestamp(value.occurredAt, `${path}.occurredAt`), qualification,
    schedulingInput, proposalItem, decisionFacts, finalItem, setupMeasurement, priorityPairs };
}

function normalizeManifest(value, path = '$') {
  exact(value, MANIFEST_KEYS, path);
  if (value.schemaVersion !== 1) fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  const datasetClass = enumValue(value.datasetClass,
    new Set(['synthetic', 'approvedLowDisclosure']), `${path}.datasetClass`);
  const approvalDigest = value.approvalDigest === null ? null : digest(value.approvalDigest, `${path}.approvalDigest`);
  if ((datasetClass === 'synthetic') !== (approvalDigest === null)) fail('DATASET_APPROVAL_MATRIX_INVALID', path);
  const windowStart = timestamp(value.windowStart, `${path}.windowStart`);
  const windowEnd = timestamp(value.windowEnd, `${path}.windowEnd`);
  const outcomeCutoff = timestamp(value.outcomeCutoff, `${path}.outcomeCutoff`);
  if (Date.parse(windowEnd) <= Date.parse(windowStart) || Date.parse(outcomeCutoff) < Date.parse(windowEnd)) {
    fail('DATASET_WINDOW_INVALID', path);
  }
  const cases = array(value.cases, `${path}.cases`).map((item, index) => normalizeCase(item, `${path}.cases[${index}]`))
    .toSorted((left, right) => compare(left.caseId, right.caseId));
  if (new Set(cases.map(item => item.caseId)).size !== cases.length) fail('DUPLICATE_IDENTIFIER', `${path}.cases`);
  if (cases.some(item => item.qualification.outcomeCutoff !== outcomeCutoff)) fail('OUTCOME_CUTOFF_MISMATCH', `${path}.cases`);
  return { schemaVersion: 1, datasetId: identifier(value.datasetId, `${path}.datasetId`),
    datasetClass, approvalDigest, windowStart, windowEnd, outcomeCutoff, cases };
}

function approvalBinding(manifest) {
  const withoutApproval = { ...manifest, approvalDigest: null };
  const datasetDigestWithoutApproval = digestCanonicalJsonSchedulingV1({
    domain: 'shadow-dataset-without-approval-v1', manifest: withoutApproval,
  });
  const approvalDigest = digestCanonicalJsonSchedulingV1({
    domain: 'shadow-dataset-approval-v1', datasetDigestWithoutApproval,
  });
  return { datasetDigestWithoutApproval, approvalDigest };
}

function verifyApproval(manifest, expectedApprovalDigest, path) {
  if (manifest.datasetClass === 'synthetic') {
    if (expectedApprovalDigest !== null) fail('DATASET_APPROVAL_UNVERIFIED', path);
    return;
  }
  const expected = expectedApprovalDigest === null ? null
    : digest(expectedApprovalDigest, `${path}.expectedApprovalDigest`);
  const binding = approvalBinding(manifest);
  if (manifest.approvalDigest !== binding.approvalDigest || expected !== manifest.approvalDigest) {
    fail('DATASET_APPROVAL_UNVERIFIED', path);
  }
}

export function deriveShadowDatasetApprovalDigestV1(value) {
  return admissionResult('SHADOW_DATASET_APPROVAL_INPUT_INVALID', () => {
    const manifest = normalizeManifest(value);
    if (manifest.datasetClass !== 'approvedLowDisclosure') fail('DATASET_CLASS_INVALID', '$.datasetClass');
    return freeze({ ok: true, ...approvalBinding(manifest) });
  });
}

export function buildShadowDatasetManifestV1(value, context = { expectedApprovalDigest: null }) {
  return admissionResult('SHADOW_DATASET_MANIFEST_INVALID', () => {
    exact(context, ['expectedApprovalDigest'], '$context');
    const manifest = normalizeManifest(value);
    verifyApproval(manifest, context.expectedApprovalDigest, '$context');
    const datasetDigest = digestCanonicalJsonSchedulingV1({ domain: 'shadow-dataset-v1', manifest });
    return freeze({ ok: true, manifest, manifestJson: canonicalJsonSchedulingV1(manifest), datasetDigest });
  });
}

function emptyMetric() { return { status: 'NOT_ENOUGH_DATA', value: null, numerator: null, denominator: 0 }; }
function statistic(values, p90 = false) {
  if (values.length === 0) return emptyMetric();
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = p90 ? sorted[Math.ceil(0.9 * sorted.length) - 1]
    : sorted.length % 2 ? sorted[middle] : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2;
  return { status: 'OK', value, numerator: null, denominator: values.length };
}
function counted(numerator, denominator, rate = false) {
  return denominator === 0 ? emptyMetric()
    : { status: 'OK', value: rate ? numerator / denominator : numerator, numerator, denominator };
}

function trustedHardResult(port, schedulingInput, proposalItem) {
  if (typeof port !== 'function') return null;
  try {
    const result = port(freeze({ schedulingInput, proposalItem: freeze({ ...proposalItem }) }));
    exact(result, ['validatorVersion', 'conflictCodes'], '$context.replayHardConstraints.result');
    if (result.validatorVersion !== HARD_CONSTRAINT_VALIDATOR_VERSION_V1) return null;
    const conflictCodes = uniqueTokens(result.conflictCodes, '$context.replayHardConstraints.result.conflictCodes');
    if (conflictCodes.some(code => !HARD_CODES.has(code))) return null;
    return { validatorVersion: result.validatorVersion, conflictCodes };
  } catch {
    return null;
  }
}

function trustedPriorityResult(port, schedulingInput, pair) {
  if (typeof port !== 'function') return null;
  try {
    const result = port(freeze({ schedulingInput, pair: freeze({ ...pair }) }));
    exact(result, ['validatorVersion', 'violation'], '$context.evaluatePriorityPair.result');
    if (result.validatorVersion !== PRIORITY_ORDER_VALIDATOR_VERSION_V1
      || typeof result.violation !== 'boolean') return null;
    return { validatorVersion: result.validatorVersion, violation: result.violation };
  } catch {
    return null;
  }
}

export function evaluateShadowMetricsV1(value, context = {
  replayHardConstraints: null,
  evaluatePriorityPair: null,
  expectedApprovalDigest: null,
}) {
  return admissionResult('SHADOW_METRICS_REPORT_INPUT_INVALID', () => {
    exact(context, ['replayHardConstraints', 'evaluatePriorityPair', 'expectedApprovalDigest'], '$context');
    if (context.replayHardConstraints !== null && typeof context.replayHardConstraints !== 'function') {
      fail('TRUSTED_PORT_INVALID', '$context.replayHardConstraints');
    }
    if (context.evaluatePriorityPair !== null && typeof context.evaluatePriorityPair !== 'function') {
      fail('TRUSTED_PORT_INVALID', '$context.evaluatePriorityPair');
    }
    exact(value, REPORT_INPUT_KEYS, '$');
    const manifest = normalizeManifest(value.manifest, '$.manifest');
    verifyApproval(manifest, context.expectedApprovalDigest, '$context');
    const algorithmVersion = token(value.algorithmVersion, '$.algorithmVersion');
    const configVersion = token(value.configVersion, '$.configVersion');
    const configDigest = digest(value.configDigest, '$.configDigest');
    if (value.metricDefinitionVersion !== SHADOW_METRIC_DEFINITION_VERSION_V1) {
      fail('METRIC_DEFINITION_VERSION_INVALID', '$.metricDefinitionVersion');
    }
    const generatedAt = timestamp(value.generatedAt, '$.generatedAt');
    const datasetDigest = digestCanonicalJsonSchedulingV1({ domain: 'shadow-dataset-v1', manifest });
    const eligibilityCounts = { total: manifest.cases.length, ineligible: 0, levelA: 0, levelB: 0, levelC: 0 };
    const exclusionMap = new Map(SAMPLE_EXCLUSION_CODES_V1.map(code => [code, 0]));
    const errors = []; const overruns = []; const baselineErrors = []; const baselineOverruns = [];
    let setupMisses = 0; let setupCount = 0; let conflicts = 0; let conflictItems = 0;
    let overrides = 0; let overrideItems = 0; let violations = 0; let comparablePairs = 0;
    let hardReplayIncomplete = false; let priorityReplayIncomplete = false;
    for (const item of manifest.cases) {
      const occurred = Date.parse(item.occurredAt);
      if (occurred < Date.parse(manifest.windowStart) || occurred >= Date.parse(manifest.windowEnd)
        || occurred > Date.parse(manifest.outcomeCutoff)) {
        eligibilityCounts.ineligible += 1;
        if (occurred < Date.parse(manifest.windowStart) || occurred >= Date.parse(manifest.windowEnd)) {
          exclusionMap.set('EVENT_OUTSIDE_DATASET_WINDOW', exclusionMap.get('EVENT_OUTSIDE_DATASET_WINDOW') + 1);
        }
        if (occurred > Date.parse(manifest.outcomeCutoff)) {
          exclusionMap.set('EVENT_AFTER_CUTOFF', exclusionMap.get('EVENT_AFTER_CUTOFF') + 1);
        }
        continue;
      }
      const classification = classify(item.qualification);
      if (classification.highestLevel === 'NONE') eligibilityCounts.ineligible += 1;
      if (classification.eligibleLevels.levelA) eligibilityCounts.levelA += 1;
      if (classification.eligibleLevels.levelB) eligibilityCounts.levelB += 1;
      if (classification.eligibleLevels.levelC) eligibilityCounts.levelC += 1;
      for (const code of classification.exclusionCodes) exclusionMap.set(code, exclusionMap.get(code) + 1);
      const actual = item.qualification.shadowEvidence?.outcome?.actualNetDurationMs
        ?? item.qualification.metricsEvidence.actualNetDurationMs;
      if (classification.eligibleLevels.levelB) {
        const predicted = item.qualification.runContextSnapshot.durationEstimate.durationMs;
        baselineErrors.push(Math.abs(predicted - actual));
        baselineOverruns.push(Math.max(actual - predicted, 0));
      }
      if (!classification.eligibleLevels.levelC) continue;
      if (item.proposalItem.algorithmVersion !== algorithmVersion
        || item.proposalItem.configVersion !== configVersion
        || item.proposalItem.configDigest !== configDigest) {
        fail('REPORT_EVIDENCE_VERSION_MISMATCH', '$.manifest.cases');
      }
      errors.push(Math.abs(item.proposalItem.predictedDurationMs - actual));
      overruns.push(Math.max(actual - item.proposalItem.predictedDurationMs, 0));
      if (item.setupMeasurement) {
        setupCount += 1;
        if (item.setupMeasurement.measuredSetupMs > item.setupMeasurement.bufferMs) setupMisses += 1;
      }
      const hardResult = trustedHardResult(
        context.replayHardConstraints,
        item.schedulingInput,
        item.proposalItem,
      );
      if (hardResult !== null) {
        conflictItems += 1;
        if (hardResult.conflictCodes.length > 0) conflicts += 1;
      } else hardReplayIncomplete = true;
      overrideItems += 1;
      const selected = item.decisionFacts.selectedProposalItemIds.includes(item.proposalItem.proposalItemId);
      const final = item.finalItem;
      if (!selected || final === null || final.resourceId !== item.proposalItem.resourceId
        || final.plannedStart !== item.proposalItem.plannedStart || final.plannedEnd !== item.proposalItem.plannedEnd
        || final.bufferMs !== item.proposalItem.bufferMs) overrides += 1;
      for (const pair of item.priorityPairs) {
        const priorityResult = trustedPriorityResult(
          context.evaluatePriorityPair,
          item.schedulingInput,
          pair,
        );
        if (priorityResult !== null) {
          comparablePairs += 1;
          if (priorityResult.violation) violations += 1;
        } else priorityReplayIncomplete = true;
      }
    }
    const metrics = { medianAbsoluteDurationErrorMs: statistic(errors), p90OverrunMs: statistic(overruns, true),
      setupBufferMissRate: counted(setupMisses, setupCount, true),
      hardConflictCount: hardReplayIncomplete ? emptyMetric() : counted(conflicts, conflictItems),
      humanOverrideRate: counted(overrides, overrideItems, true),
      priorityViolationCount: priorityReplayIncomplete ? emptyMetric() : counted(violations, comparablePairs),
      retrospectiveDurationBaselineMedianAbsoluteErrorMs: statistic(baselineErrors),
      retrospectiveDurationBaselineP90OverrunMs: statistic(baselineOverruns, true) };
    const exclusionCounts = SAMPLE_EXCLUSION_CODES_V1.map(code => ({ code, count: exclusionMap.get(code) }))
      .filter(item => item.count > 0);
    const body = { schemaVersion: 1, gateStatus: 'BLOCKED_DATA', datasetDigest,
      datasetClass: manifest.datasetClass, approvalDigest: manifest.approvalDigest,
      algorithmVersion, configVersion, configDigest,
      metricDefinitionVersion: SHADOW_METRIC_DEFINITION_VERSION_V1,
      eligibilityCounts, exclusionCounts, metrics };
    const resultDigest = digestCanonicalJsonSchedulingV1({ domain: 'shadow-report-v1', report: body });
    return freeze({ ok: true, report: { ...body, generatedAt, resultDigest },
      resultJson: canonicalJsonSchedulingV1(body), resultDigest });
  });
}
