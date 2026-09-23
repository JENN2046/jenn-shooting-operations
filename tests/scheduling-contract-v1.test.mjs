import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULING_DIAGNOSTIC_FIELD_PATHS_V1,
  SCHEDULING_HARD_DIAGNOSTIC_CODES_V1,
  SCHEDULING_SOFT_DIAGNOSTIC_CODES_V1,
  buildSchedulingDiagnosticV1,
  buildSchedulingProposalItemV1,
  canonicalJsonSchedulingV1,
  canonicalizeSchedulingResultV1,
  digestCanonicalJsonSchedulingV1,
  digestResourceCapabilitiesV1,
  normalizeSchedulingInputV1,
} from '../src/scheduling-contract-v1.mjs';

const CONFIG_DIGEST = `sha256:${'a'.repeat(64)}`;

function provenance(source = 'domain-command-v1') {
  return {
    productionType: source,
    shootingSubtype: source,
    desiredDate: source,
    sampleStatus: source,
    lightingPreset: source,
    reflectivity: source,
    priority: source,
    requiredCapabilityIds: source,
    durationEstimate: source,
  };
}

function candidate(overrides = {}) {
  return {
    requestId: 'REQ-0001',
    sourceOrdinal: 1,
    requestLifecycle: 'open',
    lifecycleProvenance: 'domainCommand',
    nonCancelledScheduleItemIds: [],
    productionType: '平面',
    shootingSubtype: '细节',
    desiredDate: '2026-09-25',
    sampleStatus: 'arrivedVerified',
    lightingPreset: 'LIGHT-SOFT',
    reflectivity: 'low',
    priority: 'p1',
    requiredCapabilityIds: ['FLAT', 'DETAIL'],
    durationEstimate: {
      durationMs: 3_600_000,
      source: 'explicit',
      sourceVersion: 'estimate-v1',
    },
    factProvenance: provenance(),
    ...overrides,
  };
}

function resource(overrides = {}) {
  const value = {
    resourceId: 'STUDIO-A',
    v1DisplayPlace: 'Studio A',
    status: 'active',
    capabilityJson: { schemaVersion: 1, capabilityIds: ['FLAT', 'DETAIL'] },
    businessWindows: [
      { start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T10:30:00.000Z' },
      { start: '2026-09-26T01:00:00.000Z', end: '2026-09-26T10:30:00.000Z' },
    ],
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'capabilityDigest')) {
    value.capabilityDigest = digestResourceCapabilitiesV1(value.capabilityJson);
  }
  return value;
}

function occupied(overrides = {}) {
  return {
    scheduleItemId: 'SCHEDULE-0001',
    sourceOrdinal: 1,
    resourceId: 'STUDIO-A',
    resourceResolutionStatus: 'resolved',
    allocationMode: 'single',
    taskBindings: [{ requestId: 'REQ-EXISTING', displayOrder: 0 }],
    plannedStart: '2026-09-25T01:30:00.000Z',
    plannedEnd: '2026-09-25T02:00:00.000Z',
    bufferAfterMinutes: 10,
    bufferSource: 'fixture-config-v1',
    scheduleStatus: 'confirmed',
    lockStatus: 'locked',
    lockStatusProvenance: 'domain_command',
    source: 'human',
    ...overrides,
  };
}

function durationStat(overrides = {}) {
  return {
    statId: 'STAT-0001',
    resourceId: 'STUDIO-A',
    productionType: '平面',
    shootingSubtype: '细节',
    lightingPreset: 'LIGHT-SOFT',
    reflectivity: 'low',
    sampleCount: 8,
    estimateDurationMs: 3_300_000,
    metricVersion: 'duration-median-v1',
    ...overrides,
  };
}

function schedulingInput(overrides = {}) {
  return {
    schemaVersion: 1,
    planningWindowStart: '2026-09-25T00:00:00.000Z',
    planningWindowEnd: '2026-09-27T00:00:00.000Z',
    businessTimeZone: 'Asia/Shanghai',
    baseScheduleRevision: 7,
    algorithmVersion: 'deterministic-scheduler-v1',
    calendarCompilerVersion: 'calendar-compiler-v1',
    estimatePolicyVersion: 'estimate-policy-v1',
    configVersion: 'fixture-config-v1',
    configDigest: CONFIG_DIGEST,
    resources: [
      resource({
        resourceId: 'STUDIO-B', v1DisplayPlace: 'Studio B',
        capabilityJson: { schemaVersion: 1, capabilityIds: ['VIDEO'] },
      }),
      resource(),
    ],
    candidates: [
      candidate({ requestId: 'REQ-0002', sourceOrdinal: 2, priority: null }),
      candidate(),
    ],
    occupied: [
      occupied({
        scheduleItemId: 'SCHEDULE-0002', sourceOrdinal: 2,
        taskBindings: [{ requestId: 'REQ-EXISTING-2', displayOrder: 0 }],
        plannedStart: '2026-09-26T02:00:00.000Z', plannedEnd: '2026-09-26T03:00:00.000Z',
      }),
      occupied(),
    ],
    activeRuns: [
      { runId: 'RUN-0002', scheduleItemId: 'SCHEDULE-0002', status: 'blocked' },
      { runId: 'RUN-0001', scheduleItemId: 'SCHEDULE-0001', status: 'shooting' },
    ],
    durationStats: [
      durationStat({ statId: 'STAT-0002', resourceId: null, sampleCount: 4 }),
      durationStat(),
    ],
    ...overrides,
  };
}

function proposedItem(overrides = {}) {
  return {
    requestId: 'REQ-0001',
    resourceId: 'STUDIO-A',
    plannedStart: '2026-09-25T02:10:00.000Z',
    plannedEnd: '2026-09-25T03:10:00.000Z',
    durationMs: 3_600_000,
    bufferAfterMinutes: 10,
    durationSource: 'explicit',
    durationSourceVersion: 'estimate-v1',
    bufferRuleId: 'same-lighting-v1',
    configVersion: 'fixture-config-v1',
    ...overrides,
  };
}

function diagnostic(overrides = {}) {
  return {
    code: 'PRIORITY_UNKNOWN',
    requestId: 'REQ-0002',
    resourceId: null,
    scheduleItemId: null,
    fieldPath: '$.candidates[].priority',
    ...overrides,
  };
}

function schedulingResult({ proposedItems = [], diagnostics = [], ...overrides } = {}) {
  return {
    algorithmVersion: 'deterministic-scheduler-v1',
    configVersion: 'fixture-config-v1',
    configDigest: CONFIG_DIGEST,
    calendarCompilerVersion: 'calendar-compiler-v1',
    estimatePolicyVersion: 'estimate-policy-v1',
    proposedItems,
    diagnostics,
    ...overrides,
  };
}

test('strict canonical JSON uses Unicode code-point key order and has a golden digest', () => {
  const value = { '\u{10000}': 2, '\uE000': 1, z: [3, { b: 2, a: '文' }] };
  assert.equal(
    canonicalJsonSchedulingV1(value),
    '{"z":[3,{"a":"文","b":2}],"":1,"𐀀":2}',
  );
  assert.equal(
    digestCanonicalJsonSchedulingV1({ b: 2, a: 1 }),
    'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
  );
  assert.equal(canonicalJsonSchedulingV1(-0), '0');
  assert.equal(digestCanonicalJsonSchedulingV1(-0), digestCanonicalJsonSchedulingV1(0));
});

test('strict canonical JSON rejects non-data, ambiguous and unsafe JavaScript values', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  const symbolKey = { a: 1 };
  symbolKey[Symbol('hidden')] = 2;
  const unsafeKey = Object.create(null);
  unsafeKey.__proto__ = 1;
  const nullPrototype = Object.assign(Object.create(null), { a: 1 });
  const surrogateKey = { ['\uD800']: 1 };
  const arrayWithExtra = [1];
  arrayWithExtra.extra = 2;

  for (const value of [
    { value: undefined }, { value: Number.NaN }, { value: Infinity }, { value: 1n },
    [1, , 2], cyclic, accessor, symbolKey, unsafeKey, nullPrototype, surrogateKey,
    arrayWithExtra, new Date(0),
    { value: '\uD800' },
  ]) assert.throws(() => canonicalJsonSchedulingV1(value), /CANONICAL_JSON_INVALID/u);
});

test('SchedulingInputV1 normalization is exact, deeply frozen and permutation deterministic', () => {
  const first = normalizeSchedulingInputV1(schedulingInput());
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(first.inputDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.input), true);
  assert.equal(Object.isFrozen(first.input.resources[0].businessWindows), true);
  assert.deepEqual(first.input.resources.map(item => item.resourceId), ['STUDIO-A', 'STUDIO-B']);
  assert.deepEqual(first.input.candidates.map(item => item.requestId), ['REQ-0001', 'REQ-0002']);
  assert.deepEqual(first.input.resources[0].capabilityJson.capabilityIds, ['DETAIL', 'FLAT']);

  const permutedInput = schedulingInput();
  permutedInput.resources.reverse();
  permutedInput.resources.forEach(item => {
    item.capabilityJson.capabilityIds.reverse();
    item.businessWindows.reverse();
  });
  permutedInput.candidates.reverse();
  permutedInput.candidates.forEach(item => item.requiredCapabilityIds?.reverse());
  permutedInput.occupied.reverse();
  permutedInput.occupied.forEach(item => item.taskBindings.reverse());
  permutedInput.activeRuns.reverse();
  permutedInput.durationStats.reverse();
  const second = normalizeSchedulingInputV1(permutedInput);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.inputJson, first.inputJson);
  assert.equal(second.inputDigest, first.inputDigest);
});

test('SchedulingInputV1 normalizes offsets to UTC and every rule-relevant mutation changes digest', () => {
  const offset = schedulingInput({
    planningWindowStart: '2026-09-25T08:00:00.000+08:00',
    planningWindowEnd: '2026-09-27T08:00:00.000+08:00',
  });
  offset.resources.forEach(item => {
    item.businessWindows = item.businessWindows.map(window => ({
      start: window.start.replace('T01:', 'T09:').replace('Z', '+08:00'),
      end: window.end.replace('T10:', 'T18:').replace('Z', '+08:00'),
    }));
  });
  offset.occupied.forEach(item => {
    item.plannedStart = item.plannedStart.replace('T01:', 'T09:').replace('T02:', 'T10:').replace('Z', '+08:00');
    item.plannedEnd = item.plannedEnd.replace('T02:', 'T10:').replace('T03:', 'T11:').replace('Z', '+08:00');
  });
  const normalized = normalizeSchedulingInputV1(offset);
  assert.equal(normalized.ok, true, JSON.stringify(normalized));
  assert.equal(normalized.input.planningWindowStart, '2026-09-25T00:00:00.000Z');
  assert.equal(normalized.input.resources[0].businessWindows[0].start.endsWith('Z'), true);

  const baseline = normalizeSchedulingInputV1(schedulingInput());
  for (const changed of [
    schedulingInput({ baseScheduleRevision: 8 }),
    schedulingInput({ candidates: [candidate(), candidate({ requestId: 'REQ-0002', sourceOrdinal: 2, sampleStatus: null, priority: null })] }),
    schedulingInput({ resources: [resource(), resource({ resourceId: 'STUDIO-B', v1DisplayPlace: 'Studio B', capabilityJson: { schemaVersion: 1, capabilityIds: ['VIDEO', 'FLAT'] } })] }),
    schedulingInput({ resources: [
      resource({ capabilityJson: { schemaVersion: 1, capabilityIds: ['DETAIL', 'FLAT', 'VIDEO'] } }),
      resource({ resourceId: 'STUDIO-B', v1DisplayPlace: 'Studio B', capabilityJson: { schemaVersion: 1, capabilityIds: ['VIDEO'] } }),
    ] }),
    schedulingInput({ occupied: [occupied(), occupied({ scheduleItemId: 'SCHEDULE-0002', sourceOrdinal: 2, taskBindings: [{ requestId: 'REQ-EXISTING-2', displayOrder: 0 }], plannedStart: '2026-09-26T02:00:00.000Z', plannedEnd: '2026-09-26T03:00:00.000Z', lockStatus: 'unlocked' })] }),
    schedulingInput({ configDigest: `sha256:${'b'.repeat(64)}` }),
  ]) {
    const result = normalizeSchedulingInputV1(changed);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.notEqual(result.inputDigest, baseline.inputDigest);
  }
});

test('resource display identity enforces uniqueness and the 300-code-point boundary', () => {
  assert.equal(
    digestResourceCapabilitiesV1({ schemaVersion: 1, capabilityIds: ['VIDEO', 'FLAT'] }),
    digestResourceCapabilitiesV1({ schemaVersion: 1, capabilityIds: ['FLAT', 'VIDEO'] }),
  );
  const boundary = normalizeSchedulingInputV1(schedulingInput({
    resources: [resource({ v1DisplayPlace: '界'.repeat(300) })],
  }));
  assert.equal(boundary.ok, true, JSON.stringify(boundary));

  const tooLong = normalizeSchedulingInputV1(schedulingInput({
    resources: [resource({ v1DisplayPlace: '界'.repeat(301) })],
  }));
  assert.equal(tooLong.ok, false);

  const duplicateDisplay = normalizeSchedulingInputV1(schedulingInput({
    resources: [
      resource(),
      resource({ resourceId: 'STUDIO-B' }),
    ],
  }));
  assert.equal(duplicateDisplay.ok, false);
  assert.equal(duplicateDisplay.reason, 'DUPLICATE_IDENTIFIER');

  const forgedCapabilityDigest = normalizeSchedulingInputV1(schedulingInput({
    resources: [resource({ capabilityDigest: `sha256:${'0'.repeat(64)}` })],
  }));
  assert.equal(forgedCapabilityDigest.ok, false);
  assert.equal(forgedCapabilityDigest.reason, 'CAPABILITY_DIGEST_MISMATCH');

  const widenedResource = resource();
  widenedResource.capabilityJson.unsupported = true;
  const widenedCapabilityBody = normalizeSchedulingInputV1(schedulingInput({
    resources: [widenedResource],
  }));
  assert.equal(widenedCapabilityBody.ok, false);
  assert.equal(widenedCapabilityBody.reason, 'EXACT_KEYS');
});

test('numeric normalizers erase negative zero before exposing normalized DTOs', () => {
  const value = schedulingInput({ baseScheduleRevision: -0 });
  value.candidates[0].sourceOrdinal = -0;
  value.occupied[0].bufferAfterMinutes = -0;
  const normalized = normalizeSchedulingInputV1(value);
  assert.equal(normalized.ok, true, JSON.stringify(normalized));
  assert.equal(Object.is(normalized.input.baseScheduleRevision, -0), false);
  assert.equal(Object.is(normalized.input.candidates[0].sourceOrdinal, -0), false);
  assert.equal(Object.is(normalized.input.occupied[0].bufferAfterMinutes, -0), false);
});

test('occupied task bindings preserve display-order semantics in the input digest', () => {
  const grouped = occupied({
    allocationMode: 'groupedUnallocated',
    taskBindings: [
      { requestId: 'REQ-A', displayOrder: 0 },
      { requestId: 'REQ-B', displayOrder: 1 },
    ],
  });
  const arrayPermuted = occupied({
    allocationMode: 'groupedUnallocated',
    taskBindings: [...grouped.taskBindings].reverse(),
  });
  const semanticReorder = occupied({
    allocationMode: 'groupedUnallocated',
    taskBindings: [
      { requestId: 'REQ-A', displayOrder: 1 },
      { requestId: 'REQ-B', displayOrder: 0 },
    ],
  });
  const baseline = normalizeSchedulingInputV1(schedulingInput({ occupied: [grouped], activeRuns: [] }));
  const sameMeaning = normalizeSchedulingInputV1(schedulingInput({ occupied: [arrayPermuted], activeRuns: [] }));
  const changedMeaning = normalizeSchedulingInputV1(schedulingInput({ occupied: [semanticReorder], activeRuns: [] }));
  assert.equal(baseline.ok, true, JSON.stringify(baseline));
  assert.equal(sameMeaning.inputDigest, baseline.inputDigest);
  assert.notEqual(changedMeaning.inputDigest, baseline.inputDigest);
  assert.deepEqual(
    baseline.input.occupied[0].taskBindings.map(binding => binding.requestId),
    ['REQ-A', 'REQ-B'],
  );
});

test('160-code-point identifiers accept astral characters and reject 161 or lone surrogates', () => {
  const atBoundary = buildSchedulingProposalItemV1(proposedItem({ requestId: '😀'.repeat(160) }));
  assert.equal(atBoundary.ok, true, JSON.stringify(atBoundary));
  assert.equal(buildSchedulingProposalItemV1(proposedItem({ requestId: '😀'.repeat(161) })).ok, false);
  assert.equal(buildSchedulingProposalItemV1(proposedItem({ requestId: '\uD800' })).ok, false);
});

test('candidate universe retains incomplete open/unbound facts and rejects prefiltered or bound candidates', () => {
  const incomplete = candidate({
    productionType: null,
    shootingSubtype: null,
    desiredDate: null,
    sampleStatus: null,
    lightingPreset: null,
    reflectivity: null,
    priority: null,
    requiredCapabilityIds: null,
    durationEstimate: null,
  });
  const admitted = normalizeSchedulingInputV1(schedulingInput({ candidates: [incomplete] }));
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.equal(admitted.input.candidates.length, 1);
  assert.equal(admitted.input.candidates[0].sampleStatus, null);

  for (const invalidCandidate of [
    candidate({ requestLifecycle: 'fulfilled' }),
    candidate({ nonCancelledScheduleItemIds: ['SCHEDULE-BOUND'] }),
  ]) {
    const result = normalizeSchedulingInputV1(schedulingInput({ candidates: [invalidCandidate] }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SCHEDULING_INPUT_INVALID');
  }
});

test('candidate, occupancy and active-run collections are mutually consistent', () => {
  const candidateAlreadyOccupied = normalizeSchedulingInputV1(schedulingInput({
    candidates: [candidate({ requestId: 'REQ-EXISTING' })],
  }));
  assert.equal(candidateAlreadyOccupied.ok, false);
  assert.equal(candidateAlreadyOccupied.reason, 'CANDIDATE_OCCUPANCY_CONFLICT');

  const danglingRun = normalizeSchedulingInputV1(schedulingInput({
    activeRuns: [{ runId: 'RUN-MISSING', scheduleItemId: 'SCHEDULE-MISSING', status: 'shooting' }],
  }));
  assert.equal(danglingRun.ok, false);
  assert.equal(danglingRun.reason, 'ACTIVE_RUN_OCCUPANCY_MISSING');

  const duplicateBinding = normalizeSchedulingInputV1(schedulingInput({
    occupied: [
      occupied(),
      occupied({
        scheduleItemId: 'SCHEDULE-0002',
        sourceOrdinal: 2,
        plannedStart: '2026-09-26T02:00:00.000Z',
        plannedEnd: '2026-09-26T03:00:00.000Z',
      }),
    ],
  }));
  assert.equal(duplicateBinding.ok, false);
  assert.equal(duplicateBinding.reason, 'REQUEST_BOUND_MORE_THAN_ONCE');
});

test('SchedulingInputV1 rejects exact-key, duplicate, time, interval and unsafe-key violations', () => {
  const extraRoot = schedulingInput();
  extraRoot.extra = true;
  const duplicateCandidate = schedulingInput({ candidates: [candidate(), candidate()] });
  const duplicateCandidateOrdinal = schedulingInput({ candidates: [
    candidate(),
    candidate({ requestId: 'REQ-0002' }),
  ] });
  const overlappingWindows = schedulingInput({ resources: [resource({
    businessWindows: [
      { start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T04:00:00.000Z' },
      { start: '2026-09-25T03:00:00.000Z', end: '2026-09-25T05:00:00.000Z' },
    ],
  })] });
  const invalidDate = schedulingInput({ candidates: [candidate({ desiredDate: '2026-02-30' })] });
  const invalidZone = schedulingInput({ businessTimeZone: 'Mars/Olympus_Mons' });
  const duplicateOccupiedOrdinal = schedulingInput({ occupied: [
    occupied(),
    occupied({
      scheduleItemId: 'SCHEDULE-0002',
      plannedStart: '2026-09-26T02:00:00.000Z',
      plannedEnd: '2026-09-26T03:00:00.000Z',
    }),
  ] });
  const duplicateActiveSchedule = schedulingInput({ activeRuns: [
    { runId: 'RUN-0001', scheduleItemId: 'SCHEDULE-0001', status: 'shooting' },
    { runId: 'RUN-0002', scheduleItemId: 'SCHEDULE-0001', status: 'blocked' },
  ] });
  const bindingGap = schedulingInput({ occupied: [occupied({
    allocationMode: 'groupedUnallocated',
    taskBindings: [
      { requestId: 'REQ-A', displayOrder: 0 },
      { requestId: 'REQ-B', displayOrder: 2 },
    ],
  })], activeRuns: [] });
  const freeTextProvenance = schedulingInput({ candidates: [candidate({
    factProvenance: provenance('copied from a note'),
  })] });
  const unsafe = schedulingInput();
  unsafe.candidates[0].factProvenance = Object.assign(Object.create(null), unsafe.candidates[0].factProvenance);
  unsafe.candidates[0].factProvenance.__proto__ = 'forbidden';

  for (const value of [
    extraRoot, duplicateCandidate, duplicateCandidateOrdinal, overlappingWindows, invalidDate, invalidZone,
    duplicateOccupiedOrdinal, duplicateActiveSchedule, bindingGap, freeTextProvenance, unsafe,
  ]) {
    const result = normalizeSchedulingInputV1(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SCHEDULING_INPUT_INVALID');
    assert.equal(typeof result.reason, 'string');
    assert.equal(typeof result.path, 'string');
  }
});

test('diagnostic code/path allowlists are frozen and derive rather than trust severity', () => {
  assert.equal(Object.isFrozen(SCHEDULING_HARD_DIAGNOSTIC_CODES_V1), true);
  assert.equal(Object.isFrozen(SCHEDULING_SOFT_DIAGNOSTIC_CODES_V1), true);
  assert.equal(Object.isFrozen(SCHEDULING_DIAGNOSTIC_FIELD_PATHS_V1), true);
  assert.equal(buildSchedulingDiagnosticV1(diagnostic()).diagnostic.severity, 'hard');
  assert.equal(buildSchedulingDiagnosticV1(diagnostic({
    code: 'IDLE_GAP', requestId: null, fieldPath: '$.resources[].businessWindows',
  })).diagnostic.severity, 'soft');
  const legacyBuffer = buildSchedulingDiagnosticV1(diagnostic({
    code: 'LEGACY_BUFFER_UNKNOWN',
    requestId: null,
    scheduleItemId: 'SCHEDULE-LEGACY',
    fieldPath: '$.occupied[].bufferAfterMinutes',
  }));
  assert.equal(legacyBuffer.ok, true, JSON.stringify(legacyBuffer));
  assert.equal(legacyBuffer.diagnostic.severity, 'hard');
  assert.equal(buildSchedulingDiagnosticV1(diagnostic({ code: 'FREE_TEXT_CODE' })).ok, false);
  assert.equal(buildSchedulingDiagnosticV1(diagnostic({ fieldPath: '$.briefUrl' })).ok, false);
  assert.equal(buildSchedulingDiagnosticV1({ ...diagnostic(), severity: 'soft' }).ok, false);
});

test('proposal item IDs and result digest are deterministic across input permutation', () => {
  const item = buildSchedulingProposalItemV1(proposedItem());
  assert.equal(item.ok, true, JSON.stringify(item));
  assert.match(item.item.proposalItemId, /^spi_[a-f0-9]{64}$/u);
  assert.equal(
    item.item.proposalItemId,
    'spi_f3373d2299702689cc2a1451ac5384846e34e7190641c9ecfcca280fa48b6a20',
  );
  assert.equal(Object.isFrozen(item.item), true);
  assert.equal(buildSchedulingProposalItemV1(item.item).item.proposalItemId, item.item.proposalItemId);

  const first = canonicalizeSchedulingResultV1(schedulingResult({
    proposedItems: [
      proposedItem({ requestId: 'REQ-0002', plannedStart: '2026-09-25T04:00:00.000Z', plannedEnd: '2026-09-25T05:00:00.000Z' }),
      proposedItem(),
    ],
    diagnostics: [
      diagnostic({ code: 'IDLE_GAP', requestId: null, fieldPath: '$.resources[].businessWindows' }),
      diagnostic(),
    ],
  }));
  const second = canonicalizeSchedulingResultV1(schedulingResult({
    proposedItems: [...first.result.proposedItems].reverse(),
    diagnostics: [...first.result.diagnostics].reverse(),
  }));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(first.resultJson, second.resultJson);
  assert.equal(first.resultDigest, second.resultDigest);
  assert.equal(first.result.resultDigest, first.resultDigest);
  assert.equal(Object.isFrozen(first.result.proposedItems[0]), true);

  const golden = canonicalizeSchedulingResultV1(schedulingResult({ proposedItems: [proposedItem()] }));
  assert.equal(
    golden.resultDigest,
    'sha256:e13e1a49ec439329fc6d97556a3fc45128b307d1d31719887a2fb5214e2dc7fd',
  );
});

test('result digest explicitly binds every algorithm and config version field', () => {
  const baselineInput = schedulingResult({ proposedItems: [proposedItem()] });
  const baseline = canonicalizeSchedulingResultV1(baselineInput);
  assert.equal(baseline.ok, true, JSON.stringify(baseline));
  const mutations = [
    { ...baselineInput, algorithmVersion: 'deterministic-scheduler-v2' },
    {
      ...baselineInput,
      configVersion: 'fixture-config-v2',
      proposedItems: [proposedItem({ configVersion: 'fixture-config-v2' })],
    },
    { ...baselineInput, configDigest: `sha256:${'b'.repeat(64)}` },
    { ...baselineInput, calendarCompilerVersion: 'calendar-compiler-v2' },
    { ...baselineInput, estimatePolicyVersion: 'estimate-policy-v2' },
  ];
  for (const mutation of mutations) {
    const result = canonicalizeSchedulingResultV1(mutation);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.notEqual(result.resultDigest, baseline.resultDigest);
  }
});

test('proposal item and diagnostic mutations change IDs or result digest, while malformed data fails closed', () => {
  const baselineItem = buildSchedulingProposalItemV1(proposedItem());
  const changedItem = buildSchedulingProposalItemV1(proposedItem({ bufferAfterMinutes: 35 }));
  assert.notEqual(baselineItem.item.proposalItemId, changedItem.item.proposalItemId);

  const baseline = canonicalizeSchedulingResultV1(schedulingResult({ proposedItems: [proposedItem()] }));
  const changed = canonicalizeSchedulingResultV1(schedulingResult({ proposedItems: [proposedItem({ bufferAfterMinutes: 35 })] }));
  assert.notEqual(baseline.resultDigest, changed.resultDigest);

  assert.equal(buildSchedulingProposalItemV1(proposedItem({ plannedEnd: '2026-09-25T03:09:59.000Z' })).ok, false);
  assert.equal(buildSchedulingProposalItemV1({ ...baselineItem.item, proposalItemId: `spi_${'0'.repeat(64)}` }).ok, false);
  assert.equal(canonicalizeSchedulingResultV1(schedulingResult({ proposedItems: [proposedItem(), proposedItem()] })).ok, false);
  assert.equal(canonicalizeSchedulingResultV1(schedulingResult({ proposedItems: [
    proposedItem(),
    proposedItem({
      plannedStart: '2026-09-25T04:00:00.000Z',
      plannedEnd: '2026-09-25T05:00:00.000Z',
    }),
  ] })).reason, 'DUPLICATE_IDENTIFIER');
  assert.equal(canonicalizeSchedulingResultV1(schedulingResult({
    configVersion: 'fixture-config-v2',
    proposedItems: [proposedItem()],
  })).reason, 'PROPOSAL_CONFIG_VERSION_MISMATCH');
  assert.equal(canonicalizeSchedulingResultV1(schedulingResult({ diagnostics: [diagnostic(), diagnostic()] })).ok, false);
});
