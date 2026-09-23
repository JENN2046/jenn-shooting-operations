import {
  canonicalJsonSchedulingV1,
  canonicalizeSchedulingResultV1,
  digestCanonicalJsonSchedulingV1,
  isSchedulingIdentifierV1,
  normalizeSchedulingInputV1,
} from './scheduling-contract-v1.mjs';

const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROPOSAL_ITEM_ID = /^spi_[a-f0-9]{64}$/u;
const SCHEDULE_ITEM_ID = /^ssi_[a-f0-9]{64}$/u;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const GENERATION_COMMAND_KEYS = Object.freeze([
  'operationId', 'planningWindowStart', 'planningWindowEnd', 'resourceScope',
]);
const PROPOSAL_KEYS = Object.freeze([
  'proposalId', 'schemaVersion', 'baseScheduleRevision', 'algorithmVersion',
  'calendarCompilerVersion', 'timeZoneDataVersion', 'estimatePolicyVersion',
  'configVersion', 'configDigest',
  'planningWindowStart', 'planningWindowEnd', 'resourceScope', 'inputSnapshotJson',
  'inputDigest', 'proposedItemsJson', 'diagnosticsJson', 'resultDigest',
  'generationOperationId', 'generationCommandDigest', 'createdBy', 'createdAt',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'status', 'terminalDecisionId', 'lifecycleUpdatedAt',
]);
const LIFECYCLE_TRANSITION_KEYS = Object.freeze([
  'decisionId', 'decisionType', 'decidedAt',
]);
const DECISION_COMMAND_KEYS = Object.freeze([
  'decisionId', 'proposalId', 'decisionType', 'selectedProposalItemIds',
  'decisionNote', 'reasonCode',
]);
const SYSTEM_STALE_KEYS = Object.freeze([
  'triggerOperationId', 'proposalId', 'reasonCode',
]);
const SYSTEM_STALE_CONTEXT_KEYS = Object.freeze(['triggerOperationId']);
const GENERATION_IDEMPOTENCY_KEYS = Object.freeze(['operationId', 'commandDigest']);
const DECISION_IDEMPOTENCY_KEYS = Object.freeze(['decisionId', 'decisionCommandDigest']);
const ADOPTED_ITEM_KEYS = Object.freeze([
  'proposalItemId', 'scheduleItemId', 'sourceOrdinal',
]);
const DECISION_RECEIPT_INPUT_KEYS = Object.freeze([
  'decisionId', 'decisionCommandDigest', 'proposalId', 'decisionType',
  'selectedProposalItemIds', 'selectionDigest', 'adoptedItems', 'adoptionDigest',
  'decidedBy', 'decidedAt', 'decisionNote', 'baseScheduleRevision',
  'currentScheduleRevision', 'resultingScheduleRevision', 'reasonCode',
]);

export const SCHEDULING_PROPOSAL_SCHEMA_V1 = 1;
export const SCHEDULING_PROPOSAL_DECISION_NOTE_MAX_CODE_POINTS_V1 = 1000;
export const SCHEDULING_PROPOSAL_STATUSES_V1 = Object.freeze([
  'draft', 'accepted', 'partiallyAccepted', 'rejected', 'stale',
]);
export const SCHEDULING_PROPOSAL_DECISION_TYPES_V1 = Object.freeze([
  'accept', 'partiallyAccept', 'reject', 'stale',
]);
export const SCHEDULING_PROPOSAL_STALE_REASON_CODES_V1 = Object.freeze([
  'SCHEDULE_REVISION_CHANGED',
  'SCHEDULING_INPUT_CHANGED',
  'SCHEDULING_CONFIG_CHANGED',
  'SCHEDULING_ALGORITHM_UNSUPPORTED',
  'RESOURCE_CHANGED',
  'REQUEST_FACTS_CHANGED',
]);
export const SCHEDULING_PROPOSAL_ACCEPTANCE_V1 = Object.freeze({
  accept: 'NOT_WIRED',
  partiallyAccept: 'NOT_WIRED',
});

const STATUS_BY_DECISION = new Map([
  ['accept', 'accepted'],
  ['partiallyAccept', 'partiallyAccepted'],
  ['reject', 'rejected'],
  ['stale', 'stale'],
]);
const DECISION_TYPES = new Set(SCHEDULING_PROPOSAL_DECISION_TYPES_V1);
const PROPOSAL_STATUSES = new Set(SCHEDULING_PROPOSAL_STATUSES_V1);
const STALE_REASONS = new Set(SCHEDULING_PROPOSAL_STALE_REASON_CODES_V1);

class AdmissionError extends Error {
  constructor(reason, path) {
    super('SCHEDULING_PROPOSAL_CONTRACT_INVALID');
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
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function ownDataKeys(value, path) {
  if (!isRecord(value)) fail('EXACT_KEYS', path);
  const keys = Reflect.ownKeys(value);
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

function exactRecord(value, expected, path) {
  const keys = ownDataKeys(value, path);
  const allowed = new Set(expected);
  if (keys.length !== expected.length || keys.some(key => !allowed.has(key))) {
    fail('EXACT_KEYS', path);
  }
  return value;
}

function arrayValues(value, path) {
  if (!Array.isArray(value)) fail('ARRAY_INVALID', path);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)))) {
    fail('ARRAY_INVALID', path);
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('ARRAY_INVALID', path);
    }
    values.push(descriptor.value);
  }
  return values;
}

function validText(value, maxCodePoints, { allowEmpty = false } = {}) {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && value === value.trim()
    && [...value].length <= maxCodePoints
    && !CONTROL_OR_LINE_SEPARATOR.test(value)
    && !UNPAIRED_SURROGATE.test(value);
}

function identifier(value, path, maxCodePoints = 160) {
  if (!isSchedulingIdentifierV1(value, maxCodePoints)) fail('IDENTIFIER_INVALID', path);
  return value;
}

function note(value, path) {
  if (value === null) return null;
  if (!validText(value, SCHEDULING_PROPOSAL_DECISION_NOTE_MAX_CODE_POINTS_V1, { allowEmpty: true })) {
    fail('DECISION_NOTE_INVALID', path);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('DIGEST_INVALID', path);
  return value;
}

function safeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) fail('SAFE_INTEGER_INVALID', path);
  return Object.is(value, -0) ? 0 : value;
}

function daysInMonth(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
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

function parseCanonicalJson(value, path) {
  if (typeof value !== 'string') fail('CANONICAL_JSON_INVALID', path);
  try {
    const parsed = JSON.parse(value);
    if (canonicalJsonSchedulingV1(parsed) !== value) fail('CANONICAL_JSON_INVALID', path);
    return parsed;
  } catch (error) {
    if (error instanceof AdmissionError) throw error;
    fail('CANONICAL_JSON_INVALID', path);
  }
}

export function normalizeSchedulingResourceScopeV1(value) {
  return admissionResult('SCHEDULING_RESOURCE_SCOPE_INVALID', () => {
    const resourceScope = arrayValues(value, '$')
      .map((resourceId, index) => identifier(resourceId, `$[${index}]`))
      .toSorted(codePointCompare);
    if (resourceScope.length === 0) fail('ARRAY_TOO_SHORT', '$');
    if (new Set(resourceScope).size !== resourceScope.length) fail('DUPLICATE_IDENTIFIER', '$');
    return deepFreeze({ ok: true, resourceScope });
  });
}

function resourceScope(value, path) {
  const result = normalizeSchedulingResourceScopeV1(value);
  if (!result.ok) fail(result.reason, path);
  return result.resourceScope;
}

function generationDigestBody(planningWindowStart, planningWindowEnd, scope) {
  return {
    domain: 'scheduling-proposal-generation-command-v1',
    planningWindowStart,
    planningWindowEnd,
    resourceScope: scope,
  };
}

export function buildSchedulingProposalGenerationCommandV1(input) {
  return admissionResult('SCHEDULING_PROPOSAL_GENERATION_COMMAND_INVALID', () => {
    exactRecord(input, GENERATION_COMMAND_KEYS, '$');
    const planningWindowStart = utcTimestamp(input.planningWindowStart, '$.planningWindowStart');
    const planningWindowEnd = utcTimestamp(input.planningWindowEnd, '$.planningWindowEnd');
    if (Date.parse(planningWindowEnd) <= Date.parse(planningWindowStart)) {
      fail('INTERVAL_INVALID', '$.planningWindowEnd');
    }
    const command = deepFreeze({
      operationId: identifier(input.operationId, '$.operationId'),
      planningWindowStart,
      planningWindowEnd,
      resourceScope: resourceScope(input.resourceScope, '$.resourceScope'),
    });
    return deepFreeze({
      ok: true,
      command,
      commandJson: canonicalJsonSchedulingV1(command),
      commandDigest: digestCanonicalJsonSchedulingV1(generationDigestBody(
        command.planningWindowStart,
        command.planningWindowEnd,
        command.resourceScope,
      )),
    });
  });
}

function compareIdempotency(
  existing,
  candidate,
  keys,
  idField,
  digestField,
  invalidCode,
  replayCode,
) {
  return admissionResult(invalidCode, () => {
    exactRecord(existing, keys, '$.existing');
    exactRecord(candidate, keys, '$.candidate');
    const existingId = identifier(existing[idField], `$.existing.${idField}`);
    const candidateId = identifier(candidate[idField], `$.candidate.${idField}`);
    const existingDigest = digest(existing[digestField], `$.existing.${digestField}`);
    const candidateDigest = digest(candidate[digestField], `$.candidate.${digestField}`);
    if (existingId !== candidateId) fail('IDEMPOTENCY_ID_MISMATCH', `$.candidate.${idField}`);
    if (existingDigest !== candidateDigest) {
      return Object.freeze({ ok: false, code: 'IDEMPOTENCY_KEY_REUSE' });
    }
    return Object.freeze({ ok: true, code: replayCode });
  });
}

export function compareSchedulingProposalGenerationIdempotencyV1(existing, candidate) {
  return compareIdempotency(
    existing,
    candidate,
    GENERATION_IDEMPOTENCY_KEYS,
    'operationId',
    'commandDigest',
    'SCHEDULING_PROPOSAL_GENERATION_IDEMPOTENCY_INVALID',
    'SCHEDULING_PROPOSAL_GENERATION_EXACT_REPLAY',
  );
}

function normalizeProposal(value, path = '$') {
  exactRecord(value, PROPOSAL_KEYS, path);
  if (value.schemaVersion !== SCHEDULING_PROPOSAL_SCHEMA_V1) {
    fail('SCHEMA_VERSION_INVALID', `${path}.schemaVersion`);
  }
  const proposalId = identifier(value.proposalId, `${path}.proposalId`);
  const planningWindowStart = utcTimestamp(value.planningWindowStart, `${path}.planningWindowStart`);
  const planningWindowEnd = utcTimestamp(value.planningWindowEnd, `${path}.planningWindowEnd`);
  if (Date.parse(planningWindowEnd) <= Date.parse(planningWindowStart)) {
    fail('INTERVAL_INVALID', `${path}.planningWindowEnd`);
  }
  const scope = resourceScope(value.resourceScope, `${path}.resourceScope`);
  const inputSnapshot = parseCanonicalJson(value.inputSnapshotJson, `${path}.inputSnapshotJson`);
  const normalizedInput = normalizeSchedulingInputV1(inputSnapshot);
  if (!normalizedInput.ok || normalizedInput.inputJson !== value.inputSnapshotJson) {
    fail('INPUT_SNAPSHOT_INVALID', `${path}.inputSnapshotJson`);
  }
  if (normalizedInput.inputDigest !== value.inputDigest) fail('INPUT_DIGEST_MISMATCH', `${path}.inputDigest`);
  const proposedItems = parseCanonicalJson(value.proposedItemsJson, `${path}.proposedItemsJson`);
  const diagnostics = parseCanonicalJson(value.diagnosticsJson, `${path}.diagnosticsJson`);
  const result = canonicalizeSchedulingResultV1({
    algorithmVersion: value.algorithmVersion,
    configVersion: value.configVersion,
    configDigest: value.configDigest,
    calendarCompilerVersion: value.calendarCompilerVersion,
    timeZoneDataVersion: value.timeZoneDataVersion,
    estimatePolicyVersion: value.estimatePolicyVersion,
    proposedItems,
    diagnostics,
  });
  if (!result.ok) fail('RESULT_INVALID', path);
  if (canonicalJsonSchedulingV1(result.result.proposedItems) !== value.proposedItemsJson) {
    fail('PROPOSED_ITEMS_JSON_MISMATCH', `${path}.proposedItemsJson`);
  }
  if (canonicalJsonSchedulingV1(result.result.diagnostics) !== value.diagnosticsJson) {
    fail('DIAGNOSTICS_JSON_MISMATCH', `${path}.diagnosticsJson`);
  }
  if (result.resultDigest !== value.resultDigest) fail('RESULT_DIGEST_MISMATCH', `${path}.resultDigest`);
  const input = normalizedInput.input;
  if (
    value.baseScheduleRevision !== input.baseScheduleRevision
    || value.algorithmVersion !== input.algorithmVersion
    || value.calendarCompilerVersion !== input.calendarCompilerVersion
    || value.timeZoneDataVersion !== input.timeZoneDataVersion
    || value.estimatePolicyVersion !== input.estimatePolicyVersion
    || value.configVersion !== input.configVersion
    || value.configDigest !== input.configDigest
    || planningWindowStart !== input.planningWindowStart
    || planningWindowEnd !== input.planningWindowEnd
  ) fail('PROPOSAL_INPUT_METADATA_MISMATCH', path);
  const inputResourceScope = input.resources.map(resource => resource.resourceId).toSorted(codePointCompare);
  if (canonicalJsonSchedulingV1(scope) !== canonicalJsonSchedulingV1(inputResourceScope)) {
    fail('RESOURCE_SCOPE_MISMATCH', `${path}.resourceScope`);
  }
  const scoped = new Set(scope);
  const candidates = new Set(input.candidates.map(candidate => candidate.requestId));
  const resources = new Map(input.resources.map(resource => [resource.resourceId, resource]));
  const planningStartMs = Date.parse(planningWindowStart);
  const planningEndMs = Date.parse(planningWindowEnd);
  for (let index = 0; index < result.result.proposedItems.length; index += 1) {
    const item = result.result.proposedItems[index];
    const itemPath = `${path}.proposedItemsJson[${index}]`;
    identifier(item.requestId, `${itemPath}.requestId`);
    identifier(item.resourceId, `${itemPath}.resourceId`);
    if (!candidates.has(item.requestId)) fail('PROPOSED_REQUEST_NOT_IN_INPUT', `${itemPath}.requestId`);
    const resource = resources.get(item.resourceId);
    if (!resource || !scoped.has(item.resourceId)) {
      fail('PROPOSED_ITEM_OUTSIDE_RESOURCE_SCOPE', `${itemPath}.resourceId`);
    }
    if (resource.status !== 'active') fail('PROPOSED_RESOURCE_INACTIVE', `${itemPath}.resourceId`);
    if (Date.parse(item.plannedStart) < planningStartMs || Date.parse(item.plannedEnd) > planningEndMs) {
      fail('PROPOSED_ITEM_OUTSIDE_PLANNING_WINDOW', itemPath);
    }
  }
  const expectedGenerationDigest = digestCanonicalJsonSchedulingV1(generationDigestBody(
    planningWindowStart,
    planningWindowEnd,
    scope,
  ));
  if (value.generationCommandDigest !== expectedGenerationDigest) {
    fail('GENERATION_COMMAND_DIGEST_MISMATCH', `${path}.generationCommandDigest`);
  }
  return deepFreeze({
    proposalId,
    schemaVersion: SCHEDULING_PROPOSAL_SCHEMA_V1,
    baseScheduleRevision: safeInteger(value.baseScheduleRevision, `${path}.baseScheduleRevision`),
    algorithmVersion: identifier(value.algorithmVersion, `${path}.algorithmVersion`, 128),
    calendarCompilerVersion: identifier(value.calendarCompilerVersion, `${path}.calendarCompilerVersion`, 128),
    timeZoneDataVersion: identifier(value.timeZoneDataVersion, `${path}.timeZoneDataVersion`, 128),
    estimatePolicyVersion: identifier(value.estimatePolicyVersion, `${path}.estimatePolicyVersion`, 128),
    configVersion: identifier(value.configVersion, `${path}.configVersion`, 128),
    configDigest: digest(value.configDigest, `${path}.configDigest`),
    planningWindowStart,
    planningWindowEnd,
    resourceScope: scope,
    inputSnapshotJson: normalizedInput.inputJson,
    inputDigest: digest(value.inputDigest, `${path}.inputDigest`),
    proposedItemsJson: value.proposedItemsJson,
    diagnosticsJson: value.diagnosticsJson,
    resultDigest: digest(value.resultDigest, `${path}.resultDigest`),
    generationOperationId: identifier(value.generationOperationId, `${path}.generationOperationId`),
    generationCommandDigest: digest(value.generationCommandDigest, `${path}.generationCommandDigest`),
    createdBy: identifier(value.createdBy, `${path}.createdBy`),
    createdAt: utcTimestamp(value.createdAt, `${path}.createdAt`),
  });
}

export function buildSchedulingProposalEnvelopeV1(input) {
  return admissionResult('SCHEDULING_PROPOSAL_INVALID', () => deepFreeze({
    ok: true,
    proposal: normalizeProposal(input),
  }));
}

export function validateSchedulingProposalEnvelopeV1(input) {
  return buildSchedulingProposalEnvelopeV1(input);
}

function normalizeLifecycle(input, path = '$') {
  exactRecord(input, LIFECYCLE_KEYS, path);
  if (!PROPOSAL_STATUSES.has(input.status)) fail('PROPOSAL_STATUS_INVALID', `${path}.status`);
  const terminalDecisionId = input.terminalDecisionId === null
    ? null
    : identifier(input.terminalDecisionId, `${path}.terminalDecisionId`);
  if ((input.status === 'draft') !== (terminalDecisionId === null)) {
    fail('LIFECYCLE_TERMINAL_DECISION_INVALID', `${path}.terminalDecisionId`);
  }
  return deepFreeze({
    status: input.status,
    terminalDecisionId,
    lifecycleUpdatedAt: utcTimestamp(input.lifecycleUpdatedAt, `${path}.lifecycleUpdatedAt`),
  });
}

export function buildSchedulingProposalLifecycleV1(input) {
  return admissionResult('SCHEDULING_PROPOSAL_LIFECYCLE_INVALID', () => deepFreeze({
    ok: true,
    lifecycle: normalizeLifecycle(input),
  }));
}

export function transitionSchedulingProposalLifecycleV1(current, transition) {
  return admissionResult('SCHEDULING_PROPOSAL_LIFECYCLE_TRANSITION_INVALID', () => {
    const lifecycle = normalizeLifecycle(current, '$.current');
    exactRecord(transition, LIFECYCLE_TRANSITION_KEYS, '$.transition');
    if (lifecycle.status !== 'draft') fail('PROPOSAL_NOT_DRAFT', '$.current.status');
    if (!DECISION_TYPES.has(transition.decisionType)) fail('DECISION_TYPE_INVALID', '$.transition.decisionType');
    const decidedAt = utcTimestamp(transition.decidedAt, '$.transition.decidedAt');
    if (Date.parse(decidedAt) < Date.parse(lifecycle.lifecycleUpdatedAt)) {
      fail('LIFECYCLE_TIME_REGRESSION', '$.transition.decidedAt');
    }
    const next = deepFreeze({
      status: STATUS_BY_DECISION.get(transition.decisionType),
      terminalDecisionId: identifier(transition.decisionId, '$.transition.decisionId'),
      lifecycleUpdatedAt: decidedAt,
    });
    return deepFreeze({ ok: true, lifecycle: next });
  });
}

function proposedItemsFromProposal(proposal) {
  return parseCanonicalJson(proposal.proposedItemsJson, '$.proposal.proposedItemsJson');
}

function canonicalSelectedIds(value, proposal, decisionType, path) {
  if (value === null) {
    if (decisionType === 'accept' || decisionType === 'partiallyAccept') {
      fail('SELECTION_REQUIRED', path);
    }
    return null;
  }
  if (decisionType === 'reject' || decisionType === 'stale') fail('SELECTION_FORBIDDEN', path);
  const values = arrayValues(value, path).map((item, index) => identifier(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) fail('DUPLICATE_IDENTIFIER', path);
  const proposedOrder = proposedItemsFromProposal(proposal).map(item => item.proposalItemId);
  const requested = new Set(values);
  if (values.some(item => !proposedOrder.includes(item))) fail('SELECTION_NOT_IN_PROPOSAL', path);
  const selected = proposedOrder.filter(item => requested.has(item));
  if (decisionType === 'accept' && (selected.length === 0 || selected.length !== proposedOrder.length)) {
    fail('ACCEPT_REQUIRES_NONEMPTY_ALL_ITEMS', path);
  }
  if (decisionType === 'partiallyAccept' && (selected.length === 0 || selected.length >= proposedOrder.length)) {
    fail('PARTIAL_REQUIRES_NONEMPTY_PROPER_SUBSET', path);
  }
  return selected;
}

function decisionReason(decisionType, reasonCode, path) {
  if (decisionType === 'accept' || decisionType === 'partiallyAccept') {
    if (reasonCode !== null) fail('REASON_CODE_INVALID', path);
    return null;
  }
  if (decisionType === 'reject') {
    if (reasonCode !== 'HUMAN_REJECTED') fail('REASON_CODE_INVALID', path);
    return reasonCode;
  }
  if (!STALE_REASONS.has(reasonCode)) fail('REASON_CODE_INVALID', path);
  return reasonCode;
}

function selectionDigest(selectedProposalItemIds) {
  if (selectedProposalItemIds === null) return null;
  return digestCanonicalJsonSchedulingV1({
    domain: 'scheduling-proposal-selection-v1',
    selectedProposalItemIds,
  });
}

function decisionCommandDigest(command) {
  return digestCanonicalJsonSchedulingV1({
    domain: 'scheduling-proposal-decision-command-v1',
    proposalId: command.proposalId,
    decisionType: command.decisionType,
    selectedProposalItemIds: command.selectedProposalItemIds,
    decisionNote: command.decisionNote,
    reasonCode: command.reasonCode,
  });
}

export function buildSchedulingProposalDecisionCommandV1(input, proposalInput) {
  return admissionResult('SCHEDULING_PROPOSAL_DECISION_COMMAND_INVALID', () => {
    const proposal = normalizeProposal(proposalInput, '$.proposal');
    exactRecord(input, DECISION_COMMAND_KEYS, '$.command');
    const decisionType = input.decisionType;
    if (!DECISION_TYPES.has(decisionType)) fail('DECISION_TYPE_INVALID', '$.command.decisionType');
    if (input.proposalId !== proposal.proposalId) fail('PROPOSAL_ID_MISMATCH', '$.command.proposalId');
    const command = deepFreeze({
      decisionId: identifier(input.decisionId, '$.command.decisionId'),
      proposalId: proposal.proposalId,
      decisionType,
      selectedProposalItemIds: canonicalSelectedIds(
        input.selectedProposalItemIds,
        proposal,
        decisionType,
        '$.command.selectedProposalItemIds',
      ),
      decisionNote: note(input.decisionNote, '$.command.decisionNote'),
      reasonCode: decisionReason(decisionType, input.reasonCode, '$.command.reasonCode'),
    });
    return deepFreeze({
      ok: true,
      command,
      commandJson: canonicalJsonSchedulingV1(command),
      decisionCommandDigest: decisionCommandDigest(command),
      selectionDigest: selectionDigest(command.selectedProposalItemIds),
    });
  });
}

export function compareSchedulingProposalDecisionIdempotencyV1(existing, candidate) {
  return compareIdempotency(
    existing,
    candidate,
    DECISION_IDEMPOTENCY_KEYS,
    'decisionId',
    'decisionCommandDigest',
    'SCHEDULING_PROPOSAL_DECISION_IDEMPOTENCY_INVALID',
    'SCHEDULING_PROPOSAL_DECISION_EXACT_REPLAY',
  );
}

export function admitSchedulingProposalDecisionV1(input, proposalInput) {
  const built = buildSchedulingProposalDecisionCommandV1(input, proposalInput);
  if (!built.ok) return built;
  if (built.command.decisionType === 'accept' || built.command.decisionType === 'partiallyAccept') {
    return Object.freeze({ ok: false, code: 'PROPOSAL_ACCEPT_NOT_WIRED' });
  }
  return built;
}

export function deriveSchedulingSystemStaleDecisionV1(input) {
  return admissionResult('SCHEDULING_SYSTEM_STALE_DECISION_INVALID', () => {
    exactRecord(input, SYSTEM_STALE_KEYS, '$');
    const triggerOperationId = identifier(input.triggerOperationId, '$.triggerOperationId');
    const proposalId = identifier(input.proposalId, '$.proposalId');
    if (!STALE_REASONS.has(input.reasonCode)) fail('REASON_CODE_INVALID', '$.reasonCode');
    const tuple = { triggerOperationId, proposalId, reasonCode: input.reasonCode };
    const decisionIdDigest = digestCanonicalJsonSchedulingV1({
      domain: 'scheduling-system-stale-decision-id-v1',
      ...tuple,
    });
    const decisionCommandDigest = digestCanonicalJsonSchedulingV1({
      domain: 'scheduling-system-stale-command-v1',
      ...tuple,
    });
    return deepFreeze({
      ok: true,
      decisionId: `spd_${decisionIdDigest.slice('sha256:'.length)}`,
      decisionCommandDigest,
    });
  });
}

export function deriveAcceptedScheduleItemIdV1(decisionIdInput, proposalItemIdInput) {
  return admissionResult('SCHEDULING_ACCEPTED_ITEM_ID_INVALID', () => {
    const decisionId = identifier(decisionIdInput, '$.decisionId');
    const proposalItemId = identifier(proposalItemIdInput, '$.proposalItemId');
    if (!PROPOSAL_ITEM_ID.test(proposalItemId)) fail('PROPOSAL_ITEM_ID_INVALID', '$.proposalItemId');
    const value = digestCanonicalJsonSchedulingV1({
      domain: 'schedule-item-v1',
      decisionId,
      proposalItemId,
    });
    return Object.freeze({ ok: true, scheduleItemId: `ssi_${value.slice('sha256:'.length)}` });
  });
}

function normalizeAdoptedItems(value, selectedIds, decisionId, path) {
  if (value === null) {
    if (selectedIds !== null) fail('ADOPTED_ITEMS_REQUIRED', path);
    return null;
  }
  if (selectedIds === null) fail('ADOPTED_ITEMS_FORBIDDEN', path);
  const adoptedItems = arrayValues(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    exactRecord(item, ADOPTED_ITEM_KEYS, itemPath);
    const proposalItemId = identifier(item.proposalItemId, `${itemPath}.proposalItemId`);
    const scheduleItemId = item.scheduleItemId;
    if (typeof scheduleItemId !== 'string' || !SCHEDULE_ITEM_ID.test(scheduleItemId)) {
      fail('SCHEDULE_ITEM_ID_INVALID', `${itemPath}.scheduleItemId`);
    }
    const expected = deriveAcceptedScheduleItemIdV1(decisionId, proposalItemId);
    if (!expected.ok || expected.scheduleItemId !== scheduleItemId) {
      fail('SCHEDULE_ITEM_ID_MISMATCH', `${itemPath}.scheduleItemId`);
    }
    return {
      proposalItemId,
      scheduleItemId,
      sourceOrdinal: safeInteger(item.sourceOrdinal, `${itemPath}.sourceOrdinal`),
    };
  });
  if (adoptedItems.length !== selectedIds.length) fail('ADOPTED_ITEMS_SELECTION_MISMATCH', path);
  for (let index = 0; index < selectedIds.length; index += 1) {
    if (adoptedItems[index].proposalItemId !== selectedIds[index]) {
      fail('ADOPTED_ITEMS_SELECTION_MISMATCH', `${path}[${index}].proposalItemId`);
    }
  }
  if (new Set(adoptedItems.map(item => item.scheduleItemId)).size !== adoptedItems.length) {
    fail('DUPLICATE_IDENTIFIER', path);
  }
  if (new Set(adoptedItems.map(item => item.sourceOrdinal)).size !== adoptedItems.length) {
    fail('DUPLICATE_SOURCE_ORDINAL', path);
  }
  for (let index = 1; index < adoptedItems.length; index += 1) {
    if (adoptedItems[index].sourceOrdinal !== adoptedItems[0].sourceOrdinal + index) {
      fail('SOURCE_ORDINAL_SEQUENCE_INVALID', `${path}[${index}].sourceOrdinal`);
    }
  }
  return adoptedItems;
}

function adoptionDigest(adoptedItems) {
  if (adoptedItems === null) return null;
  return digestCanonicalJsonSchedulingV1({
    domain: 'scheduling-proposal-adoption-v1',
    adoptedItems,
  });
}

export function buildSchedulingProposalDecisionReceiptV1(input, proposalInput, systemContext = null) {
  return admissionResult('SCHEDULING_PROPOSAL_DECISION_RECEIPT_INVALID', () => {
    const proposal = normalizeProposal(proposalInput, '$.proposal');
    exactRecord(input, DECISION_RECEIPT_INPUT_KEYS, '$.receipt');
    if (!DECISION_TYPES.has(input.decisionType)) fail('DECISION_TYPE_INVALID', '$.receipt.decisionType');
    if (input.proposalId !== proposal.proposalId) fail('PROPOSAL_ID_MISMATCH', '$.receipt.proposalId');
    const decisionId = identifier(input.decisionId, '$.receipt.decisionId');
    const selectedProposalItemIds = canonicalSelectedIds(
      input.selectedProposalItemIds,
      proposal,
      input.decisionType,
      '$.receipt.selectedProposalItemIds',
    );
    const expectedSelectionDigest = selectionDigest(selectedProposalItemIds);
    if (input.selectionDigest !== expectedSelectionDigest) {
      fail('SELECTION_DIGEST_MISMATCH', '$.receipt.selectionDigest');
    }
    const adoptedItems = normalizeAdoptedItems(
      input.adoptedItems,
      selectedProposalItemIds,
      decisionId,
      '$.receipt.adoptedItems',
    );
    const expectedAdoptionDigest = adoptionDigest(adoptedItems);
    if (input.adoptionDigest !== expectedAdoptionDigest) {
      fail('ADOPTION_DIGEST_MISMATCH', '$.receipt.adoptionDigest');
    }
    const baseScheduleRevision = safeInteger(input.baseScheduleRevision, '$.receipt.baseScheduleRevision');
    if (baseScheduleRevision !== proposal.baseScheduleRevision) {
      fail('BASE_SCHEDULE_REVISION_MISMATCH', '$.receipt.baseScheduleRevision');
    }
    let currentScheduleRevision;
    let resultingScheduleRevision;
    if (input.decisionType === 'accept' || input.decisionType === 'partiallyAccept') {
      currentScheduleRevision = safeInteger(input.currentScheduleRevision, '$.receipt.currentScheduleRevision');
      resultingScheduleRevision = safeInteger(input.resultingScheduleRevision, '$.receipt.resultingScheduleRevision');
      if (currentScheduleRevision !== baseScheduleRevision || resultingScheduleRevision !== currentScheduleRevision + 1) {
        fail('DECISION_REVISION_INVALID', '$.receipt.resultingScheduleRevision');
      }
    } else if (input.decisionType === 'reject') {
      if (input.currentScheduleRevision !== null || input.resultingScheduleRevision !== null) {
        fail('DECISION_REVISION_INVALID', '$.receipt.currentScheduleRevision');
      }
      currentScheduleRevision = null;
      resultingScheduleRevision = null;
    } else {
      currentScheduleRevision = safeInteger(input.currentScheduleRevision, '$.receipt.currentScheduleRevision');
      if (input.resultingScheduleRevision !== null) {
        fail('DECISION_REVISION_INVALID', '$.receipt.resultingScheduleRevision');
      }
      resultingScheduleRevision = null;
    }
    const normalizedNote = note(input.decisionNote, '$.receipt.decisionNote');
    const reasonCode = decisionReason(input.decisionType, input.reasonCode, '$.receipt.reasonCode');
    const decidedBy = identifier(input.decidedBy, '$.receipt.decidedBy');
    const decidedAt = utcTimestamp(input.decidedAt, '$.receipt.decidedAt');
    if (Date.parse(decidedAt) < Date.parse(proposal.createdAt)) {
      fail('DECISION_TIME_BEFORE_PROPOSAL', '$.receipt.decidedAt');
    }
    const commandDigest = digest(input.decisionCommandDigest, '$.receipt.decisionCommandDigest');
    if (decidedBy !== 'system:scheduling-invalidation-v1') {
      if (systemContext !== null) fail('SYSTEM_STALE_CONTEXT_FORBIDDEN', '$.systemContext');
      const expectedCommandDigest = decisionCommandDigest({
        proposalId: proposal.proposalId,
        decisionType: input.decisionType,
        selectedProposalItemIds,
        decisionNote: normalizedNote,
        reasonCode,
      });
      if (commandDigest !== expectedCommandDigest) {
        fail('DECISION_COMMAND_DIGEST_MISMATCH', '$.receipt.decisionCommandDigest');
      }
    } else {
      if (input.decisionType !== 'stale' || normalizedNote !== null) {
        fail('SYSTEM_ACTOR_DECISION_INVALID', '$.receipt.decidedBy');
      }
      exactRecord(systemContext, SYSTEM_STALE_CONTEXT_KEYS, '$.systemContext');
      const derived = deriveSchedulingSystemStaleDecisionV1({
        triggerOperationId: systemContext.triggerOperationId,
        proposalId: proposal.proposalId,
        reasonCode,
      });
      if (
        !derived.ok
        || derived.decisionId !== decisionId
        || derived.decisionCommandDigest !== commandDigest
      ) fail('SYSTEM_STALE_DERIVATION_MISMATCH', '$.receipt.decisionId');
    }
    const selectedProposalItemIdsJson = selectedProposalItemIds === null
      ? null
      : canonicalJsonSchedulingV1(selectedProposalItemIds);
    const adoptedItemsJson = adoptedItems === null ? null : canonicalJsonSchedulingV1(adoptedItems);
    const receiptBody = deepFreeze({
      decisionId,
      decisionCommandDigest: commandDigest,
      proposalId: proposal.proposalId,
      decisionType: input.decisionType,
      selectedProposalItemIdsJson,
      selectionDigest: expectedSelectionDigest,
      adoptedItemsJson,
      adoptionDigest: expectedAdoptionDigest,
      decidedBy,
      decidedAt,
      decisionNote: normalizedNote,
      baseScheduleRevision,
      currentScheduleRevision,
      resultingScheduleRevision,
      reasonCode,
    });
    const decisionReceiptDigest = digestCanonicalJsonSchedulingV1(receiptBody);
    return deepFreeze({
      ok: true,
      receipt: { ...receiptBody, decisionReceiptDigest },
      receiptJson: canonicalJsonSchedulingV1(receiptBody),
      decisionReceiptDigest,
    });
  });
}
