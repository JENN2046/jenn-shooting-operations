import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULING_TIME_ZONE_DATA_VERSION,
  canonicalJsonSchedulingV1,
  canonicalizeSchedulingResultV1,
  digestCanonicalJsonSchedulingV1,
  digestResourceCapabilitiesV1,
  normalizeSchedulingInputV1,
} from '../src/scheduling-contract-v1.mjs';
import {
  SCHEDULING_PROPOSAL_ACCEPTANCE_V1,
  SCHEDULING_PROPOSAL_DECISION_NOTE_MAX_CODE_POINTS_V1,
  admitSchedulingProposalDecisionV1,
  buildSchedulingProposalDecisionCommandV1,
  buildSchedulingProposalDecisionReceiptV1,
  buildSchedulingProposalEnvelopeV1,
  buildSchedulingProposalGenerationCommandV1,
  buildSchedulingProposalLifecycleV1,
  compareSchedulingProposalDecisionIdempotencyV1,
  compareSchedulingProposalGenerationIdempotencyV1,
  deriveAcceptedScheduleItemIdV1,
  deriveSchedulingSystemStaleDecisionV1,
  normalizeSchedulingResourceScopeV1,
  transitionSchedulingProposalLifecycleV1,
  validateSchedulingProposalEnvelopeV1,
} from '../src/scheduling-proposal-contract-v1.mjs';

const CONFIG_DIGEST = `sha256:${'a'.repeat(64)}`;

function resource(resourceId, v1DisplayPlace, capabilityIds) {
  const capabilityJson = { schemaVersion: 1, capabilityIds };
  return {
    resourceId,
    v1DisplayPlace,
    status: 'active',
    capabilityJson,
    capabilityDigest: digestResourceCapabilitiesV1(capabilityJson),
    businessWindows: [{
      start: '2026-09-25T01:00:00.000Z',
      end: '2026-09-25T10:30:00.000Z',
    }],
  };
}

function provenance() {
  return {
    productionType: 'domain-command-v1',
    shootingSubtype: 'domain-command-v1',
    desiredDate: 'domain-command-v1',
    sampleStatus: 'domain-command-v1',
    lightingPreset: 'domain-command-v1',
    reflectivity: 'domain-command-v1',
    priority: 'domain-command-v1',
    requiredCapabilityIds: 'domain-command-v1',
    durationEstimate: 'domain-command-v1',
  };
}

function candidate(requestId, sourceOrdinal, capabilityId) {
  return {
    requestId,
    sourceOrdinal,
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
    requiredCapabilityIds: [capabilityId],
    durationEstimate: {
      durationMs: 3_600_000,
      source: 'explicit',
      sourceVersion: 'estimate-v1',
    },
    factProvenance: provenance(),
  };
}

function schedulingInput() {
  return {
    schemaVersion: 1,
    planningWindowStart: '2026-09-25T00:00:00.000Z',
    planningWindowEnd: '2026-09-26T00:00:00.000Z',
    businessTimeZone: 'Asia/Shanghai',
    baseScheduleRevision: 7,
    algorithmVersion: 'deterministic-scheduler-v1',
    calendarCompilerVersion: 'calendar-compiler-v1',
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: 'estimate-policy-v1',
    configVersion: 'fixture-config-v1',
    configDigest: CONFIG_DIGEST,
    resources: [
      resource('STUDIO-B', 'Studio B', ['FLAT-B']),
      resource('STUDIO-A', 'Studio A', ['FLAT-A']),
    ],
    candidates: [
      candidate('REQ-0002', 2, 'FLAT-B'),
      candidate('REQ-0001', 1, 'FLAT-A'),
    ],
    occupied: [],
    activeRuns: [],
    durationStats: [],
  };
}

function resultInput() {
  return {
    algorithmVersion: 'deterministic-scheduler-v1',
    configVersion: 'fixture-config-v1',
    configDigest: CONFIG_DIGEST,
    calendarCompilerVersion: 'calendar-compiler-v1',
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: 'estimate-policy-v1',
    proposedItems: [
      {
        requestId: 'REQ-0002',
        resourceId: 'STUDIO-B',
        plannedStart: '2026-09-25T04:00:00.000Z',
        plannedEnd: '2026-09-25T05:00:00.000Z',
        durationMs: 3_600_000,
        bufferAfterMinutes: 10,
        durationSource: 'explicit',
        durationSourceVersion: 'estimate-v1',
        bufferRuleId: 'buffer-v1',
        configVersion: 'fixture-config-v1',
      },
      {
        requestId: 'REQ-0001',
        resourceId: 'STUDIO-A',
        plannedStart: '2026-09-25T02:00:00.000Z',
        plannedEnd: '2026-09-25T03:00:00.000Z',
        durationMs: 3_600_000,
        bufferAfterMinutes: 10,
        durationSource: 'explicit',
        durationSourceVersion: 'estimate-v1',
        bufferRuleId: 'buffer-v1',
        configVersion: 'fixture-config-v1',
      },
    ],
    diagnostics: [],
  };
}

function fixture() {
  const normalizedInput = normalizeSchedulingInputV1(schedulingInput());
  assert.equal(normalizedInput.ok, true, JSON.stringify(normalizedInput));
  const result = canonicalizeSchedulingResultV1(resultInput());
  assert.equal(result.ok, true, JSON.stringify(result));
  const generation = buildSchedulingProposalGenerationCommandV1({
    operationId: 'GEN-0001',
    planningWindowStart: normalizedInput.input.planningWindowStart,
    planningWindowEnd: normalizedInput.input.planningWindowEnd,
    resourceScope: ['STUDIO-B', 'STUDIO-A'],
  });
  assert.equal(generation.ok, true, JSON.stringify(generation));
  const envelope = {
    proposalId: 'PROPOSAL-0001',
    schemaVersion: 1,
    baseScheduleRevision: normalizedInput.input.baseScheduleRevision,
    algorithmVersion: normalizedInput.input.algorithmVersion,
    calendarCompilerVersion: normalizedInput.input.calendarCompilerVersion,
    timeZoneDataVersion: normalizedInput.input.timeZoneDataVersion,
    estimatePolicyVersion: normalizedInput.input.estimatePolicyVersion,
    configVersion: normalizedInput.input.configVersion,
    configDigest: normalizedInput.input.configDigest,
    planningWindowStart: normalizedInput.input.planningWindowStart,
    planningWindowEnd: normalizedInput.input.planningWindowEnd,
    resourceScope: generation.command.resourceScope,
    inputSnapshotJson: normalizedInput.inputJson,
    inputDigest: normalizedInput.inputDigest,
    proposedItemsJson: canonicalJsonSchedulingV1(result.result.proposedItems),
    diagnosticsJson: canonicalJsonSchedulingV1(result.result.diagnostics),
    resultDigest: result.resultDigest,
    generationOperationId: generation.command.operationId,
    generationCommandDigest: generation.commandDigest,
    createdBy: 'scheduler:fixture',
    createdAt: '2026-09-22T12:00:00.000Z',
  };
  const proposal = buildSchedulingProposalEnvelopeV1(envelope);
  assert.equal(proposal.ok, true, JSON.stringify(proposal));
  return { generation, normalizedInput, result, envelope, proposal: proposal.proposal };
}

function decision(overrides = {}) {
  return {
    decisionId: 'DECISION-0001',
    proposalId: 'PROPOSAL-0001',
    decisionType: 'accept',
    selectedProposalItemIds: null,
    decisionNote: null,
    reasonCode: null,
    ...overrides,
  };
}

function adoptedItems(decisionId, selectedProposalItemIds, startOrdinal = 10) {
  return selectedProposalItemIds.map((proposalItemId, index) => {
    const derived = deriveAcceptedScheduleItemIdV1(decisionId, proposalItemId);
    assert.equal(derived.ok, true, JSON.stringify(derived));
    return {
      proposalItemId,
      scheduleItemId: derived.scheduleItemId,
      sourceOrdinal: startOrdinal + index,
    };
  });
}

function adoptionDigest(items) {
  return digestCanonicalJsonSchedulingV1({
    domain: 'scheduling-proposal-adoption-v1',
    adoptedItems: items,
  });
}

test('generation command canonicalizes scope/time and excludes operationId from its golden digest', () => {
  const first = buildSchedulingProposalGenerationCommandV1({
    operationId: 'GEN-0001',
    planningWindowStart: '2026-09-25T08:00:00+08:00',
    planningWindowEnd: '2026-09-26T08:00:00+08:00',
    resourceScope: ['STUDIO-B', 'STUDIO-A'],
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.command.resourceScope, ['STUDIO-A', 'STUDIO-B']);
  assert.equal(first.command.planningWindowStart, '2026-09-25T00:00:00.000Z');
  assert.equal(first.commandDigest, 'sha256:46c3098fe768b4d764e48ec9ff46921813f48539e38b103569231bc5e183d516');

  const replay = buildSchedulingProposalGenerationCommandV1({
    ...first.command,
    operationId: 'GEN-OTHER',
    resourceScope: [...first.command.resourceScope].reverse(),
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.commandDigest, first.commandDigest);
  assert.equal(normalizeSchedulingResourceScopeV1([]).ok, false);
  assert.equal(normalizeSchedulingResourceScopeV1(['STUDIO-A', 'STUDIO-A']).ok, false);

  assert.deepEqual(compareSchedulingProposalGenerationIdempotencyV1(
    { operationId: 'GEN-0001', commandDigest: first.commandDigest },
    { operationId: 'GEN-0001', commandDigest: first.commandDigest },
  ), { ok: true, code: 'SCHEDULING_PROPOSAL_GENERATION_EXACT_REPLAY' });
  assert.deepEqual(compareSchedulingProposalGenerationIdempotencyV1(
    { operationId: 'GEN-0001', commandDigest: first.commandDigest },
    { operationId: 'GEN-0001', commandDigest: `sha256:${'0'.repeat(64)}` },
  ), { ok: false, code: 'IDEMPOTENCY_KEY_REUSE' });
});

test('immutable Proposal envelope validates every stored canonical body and is deeply frozen', () => {
  const { envelope, proposal } = fixture();
  assert.equal(Object.isFrozen(proposal), true);
  assert.equal(Object.isFrozen(proposal.resourceScope), true);
  assert.deepEqual(proposal.resourceScope, ['STUDIO-A', 'STUDIO-B']);
  assert.equal(proposal.timeZoneDataVersion, SCHEDULING_TIME_ZONE_DATA_VERSION);
  assert.equal(validateSchedulingProposalEnvelopeV1(proposal).ok, true);
  assert.throws(() => { proposal.resourceScope.push('STUDIO-C'); }, TypeError);

  for (const changed of [
    { ...envelope, inputDigest: `sha256:${'0'.repeat(64)}` },
    { ...envelope, resultDigest: `sha256:${'0'.repeat(64)}` },
    { ...envelope, baseScheduleRevision: 8 },
    { ...envelope, timeZoneDataVersion: 'forged-tzdata-v999' },
    { ...envelope, resourceScope: ['STUDIO-A'] },
    { ...envelope, generationCommandDigest: `sha256:${'0'.repeat(64)}` },
    { ...envelope, proposedItemsJson: JSON.stringify(JSON.parse(envelope.proposedItemsJson), null, 2) },
    { ...envelope, extra: true },
  ]) assert.equal(buildSchedulingProposalEnvelopeV1(changed).ok, false);
});

test('Proposal items must cross-reference input candidates, active scoped resources and the planning window', () => {
  const { envelope } = fixture();
  const unrelated = resultInput();
  unrelated.proposedItems[0].requestId = 'REQ-NOT-IN-INPUT';
  const unrelatedResult = canonicalizeSchedulingResultV1(unrelated);
  assert.equal(unrelatedResult.ok, true, JSON.stringify(unrelatedResult));

  const outside = resultInput();
  outside.proposedItems[0].plannedStart = '2026-09-24T23:00:00.000Z';
  outside.proposedItems[0].plannedEnd = '2026-09-25T00:00:00.000Z';
  const outsideResult = canonicalizeSchedulingResultV1(outside);
  assert.equal(outsideResult.ok, true, JSON.stringify(outsideResult));

  for (const changedResult of [unrelatedResult, outsideResult]) {
    assert.equal(buildSchedulingProposalEnvelopeV1({
      ...envelope,
      proposedItemsJson: canonicalJsonSchedulingV1(changedResult.result.proposedItems),
      diagnosticsJson: canonicalJsonSchedulingV1(changedResult.result.diagnostics),
      resultDigest: changedResult.resultDigest,
    }).ok, false);
  }

  const inactiveInput = schedulingInput();
  inactiveInput.resources.find(item => item.resourceId === 'STUDIO-A').status = 'inactive';
  const normalizedInactive = normalizeSchedulingInputV1(inactiveInput);
  assert.equal(normalizedInactive.ok, true, JSON.stringify(normalizedInactive));
  assert.equal(buildSchedulingProposalEnvelopeV1({
    ...envelope,
    inputSnapshotJson: normalizedInactive.inputJson,
    inputDigest: normalizedInactive.inputDigest,
  }).ok, false);
});

test('Proposal lifecycle permits one draft-to-terminal transition and seals every terminal state', () => {
  const draft = buildSchedulingProposalLifecycleV1({
    status: 'draft',
    terminalDecisionId: null,
    lifecycleUpdatedAt: '2026-09-22T12:00:00Z',
  });
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.equal(draft.lifecycle.lifecycleUpdatedAt, '2026-09-22T12:00:00.000Z');

  for (const [decisionType, status] of [
    ['accept', 'accepted'],
    ['partiallyAccept', 'partiallyAccepted'],
    ['reject', 'rejected'],
    ['stale', 'stale'],
  ]) {
    const transitioned = transitionSchedulingProposalLifecycleV1(draft.lifecycle, {
      decisionId: `DECISION-${decisionType}`,
      decisionType,
      decidedAt: '2026-09-22T12:05:00.000Z',
    });
    assert.equal(transitioned.ok, true, JSON.stringify(transitioned));
    assert.equal(transitioned.lifecycle.status, status);
    assert.equal(transitionSchedulingProposalLifecycleV1(transitioned.lifecycle, {
      decisionId: 'DECISION-SECOND', decisionType: 'reject', decidedAt: '2026-09-22T12:06:00.000Z',
    }).reason, 'PROPOSAL_NOT_DRAFT');
  }
  assert.equal(buildSchedulingProposalLifecycleV1({
    status: 'draft', terminalDecisionId: 'DECISION-X', lifecycleUpdatedAt: '2026-09-22T12:00:00.000Z',
  }).ok, false);
  assert.equal(buildSchedulingProposalLifecycleV1({
    status: 'stale', terminalDecisionId: null, lifecycleUpdatedAt: '2026-09-22T12:00:00.000Z',
  }).ok, false);
  assert.equal(transitionSchedulingProposalLifecycleV1(draft.lifecycle, {
    decisionId: 'DECISION-EARLY', decisionType: 'reject', decidedAt: '2026-09-22T11:59:59.999Z',
  }).reason, 'LIFECYCLE_TIME_REGRESSION');
});

test('decision command matrix canonicalizes selection in Proposal order and pins command digests', () => {
  const { proposal } = fixture();
  const itemIds = JSON.parse(proposal.proposedItemsJson).map(item => item.proposalItemId);
  const accept = buildSchedulingProposalDecisionCommandV1(decision({
    selectedProposalItemIds: [...itemIds].reverse(),
  }), proposal);
  assert.equal(accept.ok, true, JSON.stringify(accept));
  assert.deepEqual(accept.command.selectedProposalItemIds, itemIds);
  assert.equal(accept.decisionCommandDigest, 'sha256:8bef0d16521879dd56c36bc8f9786fd708dc7f71d65e7b41e56f899db0f5dc89');
  assert.equal(accept.selectionDigest, 'sha256:ddbfeaa923e58aa50f5bdc8bf94b0fd8df40c9919d0bc31d734baea16cb0b988');

  const partial = buildSchedulingProposalDecisionCommandV1(decision({
    decisionId: 'DECISION-0002',
    decisionType: 'partiallyAccept',
    selectedProposalItemIds: [itemIds[1]],
  }), proposal);
  assert.equal(partial.ok, true, JSON.stringify(partial));
  assert.deepEqual(partial.command.selectedProposalItemIds, [itemIds[1]]);

  const reject = buildSchedulingProposalDecisionCommandV1(decision({
    decisionId: 'DECISION-0003',
    decisionType: 'reject',
    selectedProposalItemIds: null,
    decisionNote: 'human choice',
    reasonCode: 'HUMAN_REJECTED',
  }), proposal);
  assert.equal(reject.ok, true, JSON.stringify(reject));
  assert.equal(reject.selectionDigest, null);

  const stale = buildSchedulingProposalDecisionCommandV1(decision({
    decisionId: 'DECISION-0004',
    decisionType: 'stale',
    selectedProposalItemIds: null,
    reasonCode: 'REQUEST_FACTS_CHANGED',
  }), proposal);
  assert.equal(stale.ok, true, JSON.stringify(stale));

  assert.deepEqual(compareSchedulingProposalDecisionIdempotencyV1(
    { decisionId: accept.command.decisionId, decisionCommandDigest: accept.decisionCommandDigest },
    { decisionId: accept.command.decisionId, decisionCommandDigest: accept.decisionCommandDigest },
  ), { ok: true, code: 'SCHEDULING_PROPOSAL_DECISION_EXACT_REPLAY' });
  assert.deepEqual(compareSchedulingProposalDecisionIdempotencyV1(
    { decisionId: accept.command.decisionId, decisionCommandDigest: accept.decisionCommandDigest },
    { decisionId: accept.command.decisionId, decisionCommandDigest: `sha256:${'0'.repeat(64)}` },
  ), { ok: false, code: 'IDEMPOTENCY_KEY_REUSE' });
});

test('an empty Proposal cannot be accepted or partially accepted', () => {
  const { envelope } = fixture();
  const emptyResult = canonicalizeSchedulingResultV1({ ...resultInput(), proposedItems: [] });
  assert.equal(emptyResult.ok, true, JSON.stringify(emptyResult));
  const emptyProposal = buildSchedulingProposalEnvelopeV1({
    ...envelope,
    proposedItemsJson: canonicalJsonSchedulingV1(emptyResult.result.proposedItems),
    diagnosticsJson: canonicalJsonSchedulingV1(emptyResult.result.diagnostics),
    resultDigest: emptyResult.resultDigest,
  });
  assert.equal(emptyProposal.ok, true, JSON.stringify(emptyProposal));
  assert.equal(buildSchedulingProposalDecisionCommandV1(decision({
    selectedProposalItemIds: [],
  }), emptyProposal.proposal).ok, false);
  assert.equal(buildSchedulingProposalDecisionCommandV1(decision({
    decisionType: 'partiallyAccept', selectedProposalItemIds: [],
  }), emptyProposal.proposal).ok, false);
});

test('decision matrix rejects invalid full/partial/terminal selection and stale reasons', () => {
  const { proposal } = fixture();
  const itemIds = JSON.parse(proposal.proposedItemsJson).map(item => item.proposalItemId);
  const invalid = [
    decision({ selectedProposalItemIds: [itemIds[0]] }),
    decision({ decisionType: 'partiallyAccept', selectedProposalItemIds: [] }),
    decision({ decisionType: 'partiallyAccept', selectedProposalItemIds: itemIds }),
    decision({ decisionType: 'partiallyAccept', selectedProposalItemIds: [itemIds[0], itemIds[0]] }),
    decision({ decisionType: 'partiallyAccept', selectedProposalItemIds: ['spi_unknown'] }),
    decision({ decisionType: 'reject', selectedProposalItemIds: null, reasonCode: null }),
    decision({ decisionType: 'reject', selectedProposalItemIds: [itemIds[0]], reasonCode: 'HUMAN_REJECTED' }),
    decision({ decisionType: 'stale', selectedProposalItemIds: null, reasonCode: 'UNKNOWN' }),
    decision({ decisionType: 'accept', selectedProposalItemIds: itemIds, reasonCode: 'HUMAN_REJECTED' }),
  ];
  for (const command of invalid) {
    assert.equal(buildSchedulingProposalDecisionCommandV1(command, proposal).ok, false);
  }
  const reserved = buildSchedulingProposalDecisionCommandV1(decision({
    decisionId: `spd_${'0'.repeat(64)}`,
    decisionType: 'reject',
    selectedProposalItemIds: null,
    reasonCode: 'HUMAN_REJECTED',
  }), proposal);
  assert.equal(reserved.ok, false);
  assert.equal(reserved.reason, 'DECISION_ID_RESERVED');
});

test('accept and partiallyAccept stay at the exact stable NOT_WIRED boundary', () => {
  const { proposal } = fixture();
  const itemIds = JSON.parse(proposal.proposedItemsJson).map(item => item.proposalItemId);
  assert.deepEqual(SCHEDULING_PROPOSAL_ACCEPTANCE_V1, {
    accept: 'NOT_WIRED', partiallyAccept: 'NOT_WIRED',
  });
  for (const command of [
    decision({ selectedProposalItemIds: itemIds }),
    decision({ decisionType: 'partiallyAccept', selectedProposalItemIds: [itemIds[0]] }),
  ]) {
    assert.deepEqual(admitSchedulingProposalDecisionV1(command, proposal), {
      ok: false, code: 'PROPOSAL_ACCEPT_NOT_WIRED',
    });
  }
  const rejected = admitSchedulingProposalDecisionV1(decision({
    decisionType: 'reject', selectedProposalItemIds: null, reasonCode: 'HUMAN_REJECTED',
  }), proposal);
  assert.equal(rejected.ok, true);
});

test('system stale and accepted schedule IDs are deterministic domain-separated golden values', () => {
  const system = deriveSchedulingSystemStaleDecisionV1({
    triggerOperationId: 'TRIGGER-0001',
    proposalId: 'PROPOSAL-0001',
    reasonCode: 'SCHEDULE_REVISION_CHANGED',
  });
  assert.equal(system.ok, true, JSON.stringify(system));
  assert.equal(system.decisionId, 'spd_31c071ddb37dd71b21d8d2608bb946009b64ae5f06c3b58c5b274e0e7b7cd748');
  assert.equal(system.decisionCommandDigest, 'sha256:8a34592c64633fe7ecdd963b76e63f80501cae60c0a2e7f2345b56b6a70dc93c');
  assert.deepEqual(deriveSchedulingSystemStaleDecisionV1({
    triggerOperationId: 'TRIGGER-0001', proposalId: 'PROPOSAL-0001', reasonCode: 'SCHEDULE_REVISION_CHANGED',
  }), system);

  const schedule = deriveAcceptedScheduleItemIdV1('DECISION-0001', `spi_${'a'.repeat(64)}`);
  assert.equal(schedule.ok, true, JSON.stringify(schedule));
  assert.equal(schedule.scheduleItemId, 'ssi_3045af25a7ddf95d1c3d8a8c04b23bf0a5a384b10dc1f67ec77496ca5b3b5fc7');
});

test('accept receipt binds canonical selection, adopted IDs/ordinals, revisions and all business fields', () => {
  const { proposal } = fixture();
  const itemIds = JSON.parse(proposal.proposedItemsJson).map(item => item.proposalItemId);
  const command = buildSchedulingProposalDecisionCommandV1(decision({
    selectedProposalItemIds: [...itemIds].reverse(),
  }), proposal);
  assert.equal(command.ok, true, JSON.stringify(command));
  const adopted = adoptedItems(command.command.decisionId, command.command.selectedProposalItemIds);
  const built = buildSchedulingProposalDecisionReceiptV1({
    decisionId: command.command.decisionId,
    decisionCommandDigest: command.decisionCommandDigest,
    proposalId: proposal.proposalId,
    decisionType: 'accept',
    selectedProposalItemIds: [...itemIds].reverse(),
    selectionDigest: command.selectionDigest,
    adoptedItems: adopted,
    adoptionDigest: adoptionDigest(adopted),
    decidedBy: 'scheduler:fixture',
    decidedAt: '2026-09-22T12:10:00.000Z',
    decisionNote: null,
    baseScheduleRevision: 7,
    currentScheduleRevision: 7,
    resultingScheduleRevision: 8,
    reasonCode: null,
  }, proposal);
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.receipt.selectedProposalItemIdsJson, canonicalJsonSchedulingV1(itemIds));
  assert.equal(built.receipt.adoptedItemsJson, canonicalJsonSchedulingV1(adopted));
  assert.equal(built.decisionReceiptDigest, 'sha256:7556d5efbf4c0784aef1c8843ac3c24b913727f0ff87e97b7fc173003f0520fd');
  assert.equal(Object.isFrozen(built.receipt), true);
});

test('reject and system stale receipts follow their null/revision/actor matrices', () => {
  const { proposal } = fixture();
  const rejectCommand = buildSchedulingProposalDecisionCommandV1(decision({
    decisionId: 'DECISION-REJECT',
    decisionType: 'reject',
    selectedProposalItemIds: null,
    decisionNote: 'declined',
    reasonCode: 'HUMAN_REJECTED',
  }), proposal);
  const rejected = buildSchedulingProposalDecisionReceiptV1({
    decisionId: rejectCommand.command.decisionId,
    decisionCommandDigest: rejectCommand.decisionCommandDigest,
    proposalId: proposal.proposalId,
    decisionType: 'reject',
    selectedProposalItemIds: null,
    selectionDigest: null,
    adoptedItems: null,
    adoptionDigest: null,
    decidedBy: 'administrator:fixture',
    decidedAt: '2026-09-22T12:10:00.000Z',
    decisionNote: 'declined',
    baseScheduleRevision: 7,
    currentScheduleRevision: null,
    resultingScheduleRevision: null,
    reasonCode: 'HUMAN_REJECTED',
  }, proposal);
  assert.equal(rejected.ok, true, JSON.stringify(rejected));

  const system = deriveSchedulingSystemStaleDecisionV1({
    triggerOperationId: 'TRIGGER-0002',
    proposalId: proposal.proposalId,
    reasonCode: 'SCHEDULING_CONFIG_CHANGED',
  });
  const staleInput = {
    decisionId: system.decisionId,
    decisionCommandDigest: system.decisionCommandDigest,
    proposalId: proposal.proposalId,
    decisionType: 'stale',
    selectedProposalItemIds: null,
    selectionDigest: null,
    adoptedItems: null,
    adoptionDigest: null,
    decidedBy: 'system:scheduling-invalidation-v1',
    decidedAt: '2026-09-22T12:11:00.000Z',
    decisionNote: null,
    baseScheduleRevision: 7,
    currentScheduleRevision: 8,
    resultingScheduleRevision: null,
    reasonCode: 'SCHEDULING_CONFIG_CHANGED',
  };
  const systemContext = { triggerOperationId: 'TRIGGER-0002' };
  const stale = buildSchedulingProposalDecisionReceiptV1(staleInput, proposal, systemContext);
  assert.equal(stale.ok, true, JSON.stringify(stale));
  assert.equal(buildSchedulingProposalDecisionReceiptV1(staleInput, proposal).ok, false);
  assert.equal(buildSchedulingProposalDecisionReceiptV1({
    ...staleInput, decisionId: `spd_${'0'.repeat(64)}`,
  }, proposal, systemContext).ok, false);
  assert.equal(buildSchedulingProposalDecisionReceiptV1({
    ...staleInput, decisionCommandDigest: `sha256:${'0'.repeat(64)}`,
  }, proposal, systemContext).ok, false);
  assert.equal(buildSchedulingProposalDecisionReceiptV1({
    ...staleInput, decisionNote: 'system note is forbidden',
  }, proposal, systemContext).ok, false);
});

test('receipt validation rejects selection/adoption/digest/revision and system-actor tampering', () => {
  const { proposal } = fixture();
  const itemIds = JSON.parse(proposal.proposedItemsJson).map(item => item.proposalItemId);
  const command = buildSchedulingProposalDecisionCommandV1(decision({ selectedProposalItemIds: itemIds }), proposal);
  const adopted = adoptedItems(command.command.decisionId, itemIds);
  const valid = {
    decisionId: command.command.decisionId,
    decisionCommandDigest: command.decisionCommandDigest,
    proposalId: proposal.proposalId,
    decisionType: 'accept',
    selectedProposalItemIds: itemIds,
    selectionDigest: command.selectionDigest,
    adoptedItems: adopted,
    adoptionDigest: adoptionDigest(adopted),
    decidedBy: 'scheduler:fixture',
    decidedAt: '2026-09-22T12:10:00.000Z',
    decisionNote: null,
    baseScheduleRevision: 7,
    currentScheduleRevision: 7,
    resultingScheduleRevision: 8,
    reasonCode: null,
  };
  const wrongScheduleId = adopted.map((item, index) => index === 0
    ? { ...item, scheduleItemId: `ssi_${'0'.repeat(64)}` }
    : item);
  const nonContiguous = adopted.map((item, index) => index === 1
    ? { ...item, sourceOrdinal: item.sourceOrdinal + 1 }
    : item);
  for (const changed of [
    { ...valid, selectionDigest: `sha256:${'0'.repeat(64)}` },
    { ...valid, adoptedItems: [...adopted].reverse() },
    { ...valid, adoptedItems: wrongScheduleId, adoptionDigest: adoptionDigest(wrongScheduleId) },
    { ...valid, adoptedItems: nonContiguous, adoptionDigest: adoptionDigest(nonContiguous) },
    { ...valid, adoptionDigest: `sha256:${'0'.repeat(64)}` },
    { ...valid, baseScheduleRevision: 6 },
    { ...valid, currentScheduleRevision: 8, resultingScheduleRevision: 9 },
    { ...valid, resultingScheduleRevision: 9 },
    { ...valid, decisionCommandDigest: `sha256:${'0'.repeat(64)}` },
    { ...valid, decidedBy: 'system:scheduling-invalidation-v1' },
    { ...valid, decidedAt: '2026-09-22T11:59:59.999Z' },
    { ...valid, extra: true },
  ]) assert.equal(buildSchedulingProposalDecisionReceiptV1(changed, proposal).ok, false);
});

test('identifiers, timestamps, notes, exact keys, sparse arrays and unsafe objects fail closed', () => {
  const { proposal } = fixture();
  const itemIds = JSON.parse(proposal.proposedItemsJson).map(item => item.proposalItemId);
  assert.equal(SCHEDULING_PROPOSAL_DECISION_NOTE_MAX_CODE_POINTS_V1, 1000);
  assert.equal(buildSchedulingProposalDecisionCommandV1(decision({
    selectedProposalItemIds: itemIds,
    decisionNote: '界'.repeat(1000),
  }), proposal).ok, true);
  for (const decisionNote of [' 笔记', '笔记\n', '笔记\u0085', '\uD800', '界'.repeat(1001)]) {
    assert.equal(buildSchedulingProposalDecisionCommandV1(decision({
      selectedProposalItemIds: itemIds,
      decisionNote,
    }), proposal).ok, false);
  }
  for (const operationId of ['', ' GEN', 'GEN\n', 'GEN\u0085', '\uD800', '😀'.repeat(161)]) {
    assert.equal(buildSchedulingProposalGenerationCommandV1({
      operationId,
      planningWindowStart: '2026-09-25T00:00:00.000Z',
      planningWindowEnd: '2026-09-26T00:00:00.000Z',
      resourceScope: ['STUDIO-A'],
    }).ok, false);
  }
  assert.equal(buildSchedulingProposalGenerationCommandV1({
    operationId: 'GEN-1',
    planningWindowStart: '2026-02-29T00:00:00.000Z',
    planningWindowEnd: '2026-09-26T00:00:00.000Z',
    resourceScope: ['STUDIO-A'],
  }).ok, false);
  assert.equal(deriveAcceptedScheduleItemIdV1('DECISION-1', 'not-a-proposal-item-id').ok, false);

  const sparse = ['STUDIO-A', , 'STUDIO-B'];
  assert.equal(normalizeSchedulingResourceScopeV1(sparse).ok, false);
  const accessor = {};
  Object.defineProperty(accessor, 'operationId', { enumerable: true, get: () => 'GEN-1' });
  Object.assign(accessor, {
    planningWindowStart: '2026-09-25T00:00:00.000Z',
    planningWindowEnd: '2026-09-26T00:00:00.000Z',
    resourceScope: ['STUDIO-A'],
  });
  assert.equal(buildSchedulingProposalGenerationCommandV1(accessor).ok, false);
  const symbol = {
    operationId: 'GEN-1',
    planningWindowStart: '2026-09-25T00:00:00.000Z',
    planningWindowEnd: '2026-09-26T00:00:00.000Z',
    resourceScope: ['STUDIO-A'],
  };
  symbol[Symbol('unsafe')] = true;
  assert.equal(buildSchedulingProposalGenerationCommandV1(symbol).ok, false);
  const nullPrototype = Object.assign(Object.create(null), symbol);
  delete nullPrototype[Object.getOwnPropertySymbols(nullPrototype)[0]];
  assert.equal(buildSchedulingProposalGenerationCommandV1(nullPrototype).ok, false);
});
