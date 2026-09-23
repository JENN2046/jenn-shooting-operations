import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HARD_CONSTRAINT_VALIDATOR_VERSION_V1,
  PRIORITY_ORDER_VALIDATOR_VERSION_V1,
  SHADOW_METRIC_DEFINITION_VERSION_V1,
  SUPPORTED_EVENT_CHAIN_DERIVATION_VERSION_V1,
  SUPPORTED_RUN_METRICS_ALGORITHM_VERSION_V1,
  SUPPORTED_RUN_METRICS_DERIVATION_VERSION_V1,
  buildSchedulingRunContextSnapshotV1,
  buildShadowDatasetManifestV1,
  classifySchedulingSampleV1,
  deriveShadowDatasetApprovalDigestV1,
  evaluateShadowMetricsV1,
} from '../src/scheduling-evaluation-contract-v1.mjs';
import {
  SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
  SCHEDULING_TIME_ZONE_DATA_VERSION,
  digestCanonicalJsonSchedulingV1,
  digestResourceCapabilitiesV1,
  normalizeSchedulingInputV1,
} from '../src/scheduling-contract-v1.mjs';

const D = suffix => `sha256:${suffix.repeat(64)}`;
const CUTOFF = '2026-09-30T00:00:00.000Z';

function schedulingInput() {
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
  return { schemaVersion: 1, planningWindowStart: '2026-09-28T00:00:00.000Z',
    planningWindowEnd: '2026-09-29T00:00:00.000Z', businessTimeZone: 'Asia/Shanghai',
    baseScheduleRevision: 1, algorithmVersion: 'scheduler-v1',
    calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: 'estimate-v1',
    configVersion: 'fixture-config-v1', configDigest: D('a'),
    resources: [{ resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
      capabilityJson, capabilityDigest: digestResourceCapabilitiesV1(capabilityJson),
      businessWindows: [{ start: '2026-09-28T00:00:00.000Z', end: '2026-09-28T02:00:00.000Z' }] }],
    candidates: [{ requestId: 'REQUEST-1', sourceOrdinal: 0, requestLifecycle: 'open',
      lifecycleProvenance: 'domainCommand', nonCancelledScheduleItemIds: [], productionType: '平面',
      shootingSubtype: '细节', desiredDate: '2026-09-28', sampleStatus: 'arrivedVerified',
      lightingPreset: 'LIGHT-SOFT', reflectivity: 'low', priority: 'p1',
      requiredCapabilityIds: ['FLAT'], durationEstimate: { durationMs: 1000, source: 'explicit',
        sourceVersion: 'estimate-v1' }, factProvenance: { productionType: 'domain-v1',
        shootingSubtype: 'domain-v1', desiredDate: 'domain-v1', sampleStatus: 'domain-v1',
        lightingPreset: 'domain-v1', reflectivity: 'domain-v1', priority: 'domain-v1',
        requiredCapabilityIds: 'domain-v1', durationEstimate: 'domain-v1' } },
    { requestId: 'REQUEST-HIGH', sourceOrdinal: 1, requestLifecycle: 'open',
      lifecycleProvenance: 'domainCommand', nonCancelledScheduleItemIds: [], productionType: '平面',
      shootingSubtype: '细节', desiredDate: '2026-09-28', sampleStatus: 'arrivedVerified',
      lightingPreset: 'LIGHT-SOFT', reflectivity: 'low', priority: 'p0',
      requiredCapabilityIds: ['FLAT'], durationEstimate: { durationMs: 1000, source: 'explicit',
        sourceVersion: 'estimate-v1' }, factProvenance: { productionType: 'domain-v1',
        shootingSubtype: 'domain-v1', desiredDate: 'domain-v1', sampleStatus: 'domain-v1',
        lightingPreset: 'domain-v1', reflectivity: 'domain-v1', priority: 'domain-v1',
        requiredCapabilityIds: 'domain-v1', durationEstimate: 'domain-v1' } }],
    occupied: [], activeRuns: [], durationStats: [] };
}

const NORMALIZED_INPUT = normalizeSchedulingInputV1(schedulingInput());
assert.equal(NORMALIZED_INPUT.ok, true, JSON.stringify(NORMALIZED_INPUT));
const INPUT_DIGEST = NORMALIZED_INPUT.inputDigest;

function snapshot(overrides = {}) {
  return { schemaVersion: 1, runId: 'RUN-1', scope: 'task', scheduleItemId: 'SCHEDULE-1',
    requestId: 'REQUEST-1', resourceId: 'STUDIO-A', productionType: '平面', shootingSubtype: '细节',
    lightingPreset: 'LIGHT-SOFT', reflectivity: 'low',
    durationEstimate: { durationMs: 1000, provenance: 'explicit', version: 'estimate-v1' },
    bufferAfterMinutes: 10, bufferSource: 'fixture-config-v1', resourceCapabilityDigest: D('b'),
    configVersion: 'fixture-config-v1', configDigest: D('a'), contextStatus: 'complete',
    ineligibleReason: null, capturedAt: '2026-09-25T00:00:00.000Z', ...overrides };
}

function evidence(domain, content) {
  return { ...content, evidenceDigest: digestCanonicalJsonSchedulingV1({ domain, content }) };
}

function setupMeasurement(overrides = {}) {
  const content = { requestId: 'REQUEST-1', proposalItemId: 'SPI-1', measuredSetupMs: 601,
    bufferMs: 600, ...overrides };
  return { measurementDigest: digestCanonicalJsonSchedulingV1({ domain: 'setup-measurement-v1', content }),
    ...content };
}

function shadowEvidence(overrides = {}) {
  const content = { schedulingInput: { inputDigest: INPUT_DIGEST },
    proposal: { proposalId: 'PROPOSAL-1', proposalItemId: 'SPI-1', requestId: 'REQUEST-1',
      inputDigest: INPUT_DIGEST, resultDigest: D('d'), algorithmVersion: 'scheduler-v1',
      configVersion: 'fixture-config-v1', configDigest: D('a') },
    decision: { decisionReceiptDigest: D('e'), proposalId: 'PROPOSAL-1', decisionType: 'accept',
      selectedProposalItemIds: ['SPI-1'], adoptedProposalItemIds: ['SPI-1'] },
    outcome: { outcomeDigest: D('f'), requestId: 'REQUEST-1', runId: 'RUN-1',
      scheduleItemId: 'SCHEDULE-1', status: 'complete', finalizedAt: '2026-09-29T00:00:00.000Z',
      actualNetDurationMs: 1001 },
    ...overrides };
  return { ...content,
    evidenceDigest: digestCanonicalJsonSchedulingV1({ domain: 'shadow-case-evidence-v1', content }) };
}

function qualification(overrides = {}) {
  const eventContent = { runId: 'RUN-1', status: 'valid',
    derivationVersion: SUPPORTED_EVENT_CHAIN_DERIVATION_VERSION_V1, correctionProvenance: [] };
  const metricsContent = { runId: 'RUN-1', algorithmVersion: SUPPORTED_RUN_METRICS_ALGORITHM_VERSION_V1,
    derivationVersion: SUPPORTED_RUN_METRICS_DERIVATION_VERSION_V1, actualNetDurationMs: 1001 };
  const built = buildSchedulingRunContextSnapshotV1(snapshot());
  assert.equal(built.ok, true, JSON.stringify(built));
  return { schemaVersion: 1, sampleId: 'CASE-1', requestId: 'REQUEST-1', scheduleItemId: 'SCHEDULE-1',
    runId: 'RUN-1', scope: 'task', requestBindingCount: 1, runStatus: 'completed',
    eventChainEvidence: evidence('event-chain-evidence-v1', eventContent),
    metricsEvidence: evidence('run-metrics-evidence-v1', metricsContent), pendingReview: false,
    scheduleStatus: 'confirmed', allocationMode: 'single', legacySynthesized: false,
    runContextSnapshot: built.snapshot, shadowEvidence: shadowEvidence(), outcomeCutoff: CUTOFF,
    ...overrides };
}

function atomicCase(overrides = {}) {
  const q = overrides.qualification ?? qualification();
  return { caseId: q.sampleId, occurredAt: '2026-09-28T00:00:00.000Z', qualification: q,
    schedulingInput: schedulingInput(),
    proposalItem: { proposalId: 'PROPOSAL-1', proposalItemId: 'SPI-1', requestId: 'REQUEST-1',
      resourceId: 'STUDIO-A', plannedStart: '2026-09-28T01:00:00.000Z',
      plannedEnd: '2026-09-28T01:00:01.000Z', predictedDurationMs: 1000, bufferMs: 600,
      inputDigest: INPUT_DIGEST, resultDigest: D('d'), algorithmVersion: 'scheduler-v1',
      configVersion: 'fixture-config-v1', configDigest: D('a') },
    decisionFacts: { decisionReceiptDigest: D('e'), proposalId: 'PROPOSAL-1', decisionType: 'accept',
      selectedProposalItemIds: ['SPI-1'], adoptedItems: [{ proposalItemId: 'SPI-1',
        scheduleItemId: 'SCHEDULE-1', sourceOrdinal: 7 }] },
    finalItem: { scheduleItemId: 'SCHEDULE-1', resourceId: 'STUDIO-A',
      plannedStart: '2026-09-28T01:00:00.000Z', plannedEnd: '2026-09-28T01:00:01.000Z', bufferMs: 600 },
    setupMeasurement: setupMeasurement(),
    priorityPairs: [{ pairId: 'PAIR-1', higherRequestId: 'REQUEST-HIGH', lowerRequestId: 'REQUEST-1',
      higherPriority: 'p0', lowerPriority: 'p1', resourceId: 'STUDIO-A',
      slotStart: '2026-09-28T01:00:00.000Z', slotEnd: '2026-09-28T01:00:01.000Z',
      inputDigest: INPUT_DIGEST }], ...overrides };
}

function manifest(cases = [], overrides = {}) {
  return { schemaVersion: 1, datasetId: 'synthetic-v1', datasetClass: 'synthetic', approvalDigest: null,
    windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-09-29T00:00:00.000Z',
    outcomeCutoff: CUTOFF, cases, ...overrides };
}

function reportInput(cases, overrides = {}) {
  return { manifest: manifest(cases), algorithmVersion: 'scheduler-v1',
    configVersion: 'fixture-config-v1', configDigest: D('a'),
    metricDefinitionVersion: SHADOW_METRIC_DEFINITION_VERSION_V1,
    generatedAt: '2026-09-30T01:00:00.000Z', ...overrides };
}

function evaluationContext(overrides = {}) {
  return { replayHardConstraints: () => ({ validatorVersion: HARD_CONSTRAINT_VALIDATOR_VERSION_V1,
    conflictCodes: ['RESOURCE_OVERLAP'] }),
  evaluatePriorityPair: () => ({ validatorVersion: PRIORITY_ORDER_VALIDATOR_VERSION_V1,
    violation: true }), expectedApprovalDigest: null, ...overrides };
}

test('snapshot scope/status matrix is exact and capturedAt stays outside digest', () => {
  const first = buildSchedulingRunContextSnapshotV1(snapshot());
  const second = buildSchedulingRunContextSnapshotV1(snapshot({ capturedAt: '2026-09-26T00:00:00Z' }));
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal(first.snapshotDigest, second.snapshotDigest);
  assert.equal(first.snapshot.scope, 'task');
  assert.equal(buildSchedulingRunContextSnapshotV1(snapshot({ scope: 'studio' })).ok, false);
  assert.equal(buildSchedulingRunContextSnapshotV1(snapshot({ scope: 'block' })).reason, 'SNAPSHOT_SCOPE_MATRIX_INVALID');
  const block = buildSchedulingRunContextSnapshotV1(snapshot({ scope: 'block', requestId: null,
    contextStatus: 'ineligible', ineligibleReason: 'GROUPED_UNALLOCATED' }));
  assert.equal(block.ok, true, JSON.stringify(block));
  assert.equal(first.snapshotDigest, 'sha256:a88248e46d4f4076bf285e222733b39ac6db2edfd81a5e522ecad4370c9f930a');
});

test('classifier reaches Level C only through digest-verified relational evidence', () => {
  const result = classifySchedulingSampleV1(qualification());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.classification.highestLevel, 'LEVEL_C');
  const missing = classifySchedulingSampleV1(qualification({ shadowEvidence: null }));
  assert.equal(missing.classification.highestLevel, 'LEVEL_B');
  assert.deepEqual(missing.classification.exclusionCodes.slice(-4), [
    'SCHEDULING_INPUT_MISSING', 'PROPOSAL_MISSING', 'ITEM_DECISION_DIFF_MISSING', 'OUTCOME_MISSING',
  ]);
});

test('correction provenance and incomplete/unsupported evidence exclude without upgrade booleans', () => {
  const eventContent = { runId: 'RUN-1', status: 'incomplete', derivationVersion: 'event-v1',
    correctionProvenance: ['correction-v1'] };
  const result = classifySchedulingSampleV1(qualification({
    eventChainEvidence: evidence('event-chain-evidence-v1', eventContent),
  }));
  assert.equal(result.classification.highestLevel, 'NONE');
  assert.ok(result.classification.exclusionCodes.includes('EVENT_CHAIN_INCOMPLETE'));
  assert.ok(result.classification.exclusionCodes.includes('CORRECTION_PRESENT'));
  const metricsContent = { runId: 'RUN-1', algorithmVersion: 'run-v9', derivationVersion: 'derive-v9',
    actualNetDurationMs: 1001 };
  const unsupported = classifySchedulingSampleV1(qualification({
    metricsEvidence: evidence('run-metrics-evidence-v1', metricsContent),
  }));
  assert.ok(unsupported.classification.exclusionCodes.includes('METRICS_VERSION_UNSUPPORTED'));
  assert.ok(result.classification.exclusionCodes.includes('EVENT_CHAIN_VERSION_UNSUPPORTED'));
});

test('forged evidence digest and cross-case identity relations fail closed', () => {
  const forged = qualification();
  forged.metricsEvidence.evidenceDigest = D('0');
  assert.equal(classifySchedulingSampleV1(forged).reason, 'EVIDENCE_DIGEST_MISMATCH');
  const crossed = qualification();
  crossed.shadowEvidence.proposal.requestId = 'REQUEST-OTHER';
  crossed.shadowEvidence.evidenceDigest = digestCanonicalJsonSchedulingV1({ domain: 'shadow-case-evidence-v1',
    content: { schedulingInput: crossed.shadowEvidence.schedulingInput, proposal: crossed.shadowEvidence.proposal,
      decision: crossed.shadowEvidence.decision, outcome: crossed.shadowEvidence.outcome } });
  assert.equal(classifySchedulingSampleV1(crossed).reason, 'EVIDENCE_RELATION_INVALID');
});

test('dataset class approval matrix prevents synthetic data from masquerading as approved', () => {
  assert.equal(buildShadowDatasetManifestV1(manifest([])).ok, true);
  assert.equal(buildShadowDatasetManifestV1(manifest([], { approvalDigest: D('9') })).reason,
    'DATASET_APPROVAL_MATRIX_INVALID');
  assert.equal(buildShadowDatasetManifestV1(manifest([], {
    datasetClass: 'approvedLowDisclosure', approvalDigest: null,
  })).reason, 'DATASET_APPROVAL_MATRIX_INVALID');
  const selfSigned = manifest([], {
    datasetClass: 'approvedLowDisclosure', approvalDigest: D('9'),
  });
  const derived = deriveShadowDatasetApprovalDigestV1(selfSigned);
  assert.equal(derived.ok, true, JSON.stringify(derived));
  const approved = { ...selfSigned, approvalDigest: derived.approvalDigest };
  assert.equal(buildShadowDatasetManifestV1(approved).reason, 'DATASET_APPROVAL_UNVERIFIED');
  assert.equal(buildShadowDatasetManifestV1(approved, {
    expectedApprovalDigest: derived.approvalDigest,
  }).ok, true);
  assert.equal(buildShadowDatasetManifestV1(approved, {
    expectedApprovalDigest: D('8'),
  }).reason, 'DATASET_APPROVAL_UNVERIFIED');
});

test('evaluator derives every metric from bound atomic facts', () => {
  const secondQ = qualification({ sampleId: 'CASE-2',
    metricsEvidence: evidence('run-metrics-evidence-v1', { runId: 'RUN-1',
      algorithmVersion: SUPPORTED_RUN_METRICS_ALGORITHM_VERSION_V1,
      derivationVersion: SUPPORTED_RUN_METRICS_DERIVATION_VERSION_V1, actualNetDurationMs: 1002 }),
    shadowEvidence: shadowEvidence({ outcome: { outcomeDigest: D('f'), requestId: 'REQUEST-1',
      runId: 'RUN-1', scheduleItemId: 'SCHEDULE-1', status: 'complete',
      finalizedAt: '2026-09-29T00:00:00.000Z', actualNetDurationMs: 1002 } }) });
  const second = atomicCase({ caseId: 'CASE-2', qualification: secondQ,
    setupMeasurement: setupMeasurement({ measuredSetupMs: 500 }),
    finalItem: { scheduleItemId: 'SCHEDULE-1', resourceId: 'STUDIO-B',
      plannedStart: '2026-09-28T01:00:00.000Z', plannedEnd: '2026-09-28T01:00:01.000Z', bufferMs: 600 },
    priorityPairs: [] });
  const result = evaluateShadowMetricsV1(reportInput([atomicCase(), second]), evaluationContext());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.report.gateStatus, 'BLOCKED_DATA');
  assert.equal(result.report.metrics.medianAbsoluteDurationErrorMs.value, 1.5);
  assert.equal(result.report.metrics.p90OverrunMs.value, 2);
  assert.deepEqual(result.report.metrics.setupBufferMissRate,
    { status: 'OK', value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(result.report.metrics.hardConflictCount,
    { status: 'OK', value: 2, numerator: 2, denominator: 2 });
  assert.deepEqual(result.report.metrics.humanOverrideRate,
    { status: 'OK', value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(result.report.metrics.priorityViolationCount,
    { status: 'OK', value: 1, numerator: 1, denominator: 1 });
  assert.equal(result.report.metrics.retrospectiveDurationBaselineMedianAbsoluteErrorMs.value, 1.5);
});

test('missing explicit setup and comparable pairs yield NOT_ENOUGH_DATA, never zero', () => {
  const item = atomicCase({ setupMeasurement: null, priorityPairs: [] });
  const result = evaluateShadowMetricsV1(reportInput([item]));
  assert.deepEqual(result.report.metrics.setupBufferMissRate,
    { status: 'NOT_ENOUGH_DATA', value: null, numerator: null, denominator: 0 });
  assert.deepEqual(result.report.metrics.priorityViolationCount,
    { status: 'NOT_ENOUGH_DATA', value: null, numerator: null, denominator: 0 });
});

test('missing, throwing or forged replay ports cannot inject hard or priority conclusions', () => {
  const item = atomicCase();
  const missing = evaluateShadowMetricsV1(reportInput([item]));
  assert.equal(missing.report.metrics.hardConflictCount.status, 'NOT_ENOUGH_DATA');
  assert.equal(missing.report.metrics.priorityViolationCount.status, 'NOT_ENOUGH_DATA');
  const forged = evaluateShadowMetricsV1(reportInput([item]), evaluationContext({
    replayHardConstraints: () => ({ validatorVersion: 'forged-v1', conflictCodes: ['RESOURCE_OVERLAP'] }),
    evaluatePriorityPair: () => ({ validatorVersion: PRIORITY_ORDER_VALIDATOR_VERSION_V1,
      violation: 'yes' }),
  }));
  assert.equal(forged.report.metrics.hardConflictCount.status, 'NOT_ENOUGH_DATA');
  assert.equal(forged.report.metrics.priorityViolationCount.status, 'NOT_ENOUGH_DATA');
  const throwing = evaluateShadowMetricsV1(reportInput([item]), evaluationContext({
    replayHardConstraints: () => { throw new Error('nope'); },
    evaluatePriorityPair: () => { throw new Error('nope'); },
  }));
  assert.equal(throwing.report.metrics.hardConflictCount.status, 'NOT_ENOUGH_DATA');
  assert.equal(throwing.report.metrics.priorityViolationCount.status, 'NOT_ENOUGH_DATA');
});

test('manifest accepts evidence-incomplete cases only to count stable exclusions', () => {
  const q = qualification({ sampleId: 'CASE-INCOMPLETE', shadowEvidence: null });
  const incomplete = atomicCase({ qualification: q, schedulingInput: null, proposalItem: null,
    decisionFacts: null, finalItem: null, setupMeasurement: null, priorityPairs: [] });
  const result = evaluateShadowMetricsV1(reportInput([incomplete]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.report.eligibilityCounts.levelB, 1);
  assert.equal(result.report.eligibilityCounts.levelC, 0);
  assert.ok(result.report.exclusionCounts.some(item => item.code === 'PROPOSAL_MISSING'));
  assert.equal(result.report.metrics.medianAbsoluteDurationErrorMs.status, 'NOT_ENOUGH_DATA');
});

test('atomic facts must match proposal, decision, snapshot and outcome evidence', () => {
  const mismatched = atomicCase();
  mismatched.proposalItem.resultDigest = D('0');
  assert.equal(buildShadowDatasetManifestV1(manifest([mismatched])).reason,
    'ATOMIC_EVIDENCE_RELATION_INVALID');
  const aggregated = atomicCase();
  aggregated.hardValidation = [{ numerator: 1, denominator: 1 }];
  assert.equal(buildShadowDatasetManifestV1(manifest([aggregated])).reason, 'EXACT_KEYS');
  const adoptionMismatch = atomicCase();
  adoptionMismatch.decisionFacts.adoptedItems[0].scheduleItemId = 'SCHEDULE-OTHER';
  assert.equal(buildShadowDatasetManifestV1(manifest([adoptionMismatch])).reason,
    'ATOMIC_EVIDENCE_RELATION_INVALID');
  const adoptedProposalMismatch = atomicCase();
  adoptedProposalMismatch.decisionFacts.adoptedItems[0].proposalItemId = 'SPI-OTHER';
  assert.equal(buildShadowDatasetManifestV1(manifest([adoptedProposalMismatch])).reason,
    'DECISION_RELATION_INVALID');
  const adoptionWidening = atomicCase();
  adoptionWidening.decisionFacts.adoptedItems[0].resourceId = 'STUDIO-A';
  assert.equal(buildShadowDatasetManifestV1(manifest([adoptionWidening])).reason, 'EXACT_KEYS');
  const unsafeOrdinal = atomicCase();
  unsafeOrdinal.decisionFacts.adoptedItems[0].sourceOrdinal = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(buildShadowDatasetManifestV1(manifest([unsafeOrdinal])).reason,
    'SAFE_INTEGER_INVALID');
});

test('generatedAt is outside result digest and gate stays BLOCKED_DATA for approved data too', () => {
  const candidate = manifest([], { datasetClass: 'approvedLowDisclosure', approvalDigest: D('9') });
  const approval = deriveShadowDatasetApprovalDigestV1(candidate).approvalDigest;
  const approved = { ...candidate, approvalDigest: approval };
  const context = evaluationContext({ expectedApprovalDigest: approval });
  const first = evaluateShadowMetricsV1(reportInput([], { manifest: approved }), context);
  const second = evaluateShadowMetricsV1(reportInput([], { manifest: approved,
    generatedAt: '2026-10-01T00:00:00.000Z' }), context);
  assert.equal(first.resultDigest, second.resultDigest);
  assert.equal(first.report.gateStatus, 'BLOCKED_DATA');
  assert.equal(first.resultJson.includes('generatedAt'), false);
  assert.equal(first.resultDigest, 'sha256:cd9a1b75cc4e6285af2adbeeed143a16b4b00ffe725c95ff16004c1a29231075');
});

test('hostile Proxy, accessors, symbols, sparse arrays and extra keys return stable invalid results', () => {
  const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  assert.equal(classifySchedulingSampleV1(proxy).reason, 'MALFORMED_OR_HOSTILE_INPUT');
  const accessor = qualification();
  Object.defineProperty(accessor, 'sampleId', { enumerable: true, get: () => 'CASE-1' });
  assert.equal(classifySchedulingSampleV1(accessor).reason, 'EXACT_KEYS');
  const symbol = qualification(); symbol[Symbol('x')] = 1;
  assert.equal(classifySchedulingSampleV1(symbol).reason, 'EXACT_KEYS');
  const sparse = manifest([, atomicCase()]);
  assert.equal(buildShadowDatasetManifestV1(sparse).reason, 'ARRAY_INVALID');
  const extra = snapshot(); extra.client = 'forbidden';
  assert.equal(buildSchedulingRunContextSnapshotV1(extra).reason, 'EXACT_KEYS');
  assert.equal(classifySchedulingSampleV1({ ...qualification(), sampleId: 'BAD\u0085ID' }).reason,
    'IDENTIFIER_INVALID');
});

test('all fixtures are synthetic contract vectors; zero Level C never claims acceptance', () => {
  const result = evaluateShadowMetricsV1(reportInput([]));
  assert.equal(result.report.datasetClass, 'synthetic');
  assert.equal(result.report.eligibilityCounts.levelC, 0);
  assert.equal(result.report.gateStatus, 'BLOCKED_DATA');
  for (const metric of Object.values(result.report.metrics)) {
    assert.equal(metric.status, 'NOT_ENOUGH_DATA'); assert.equal(metric.value, null);
  }
});
