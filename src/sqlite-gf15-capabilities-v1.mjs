import { GF15_IDS as ids, GF15_RESOURCE as resource, GF15_CONFIG, GF15_ROLLBACK,
  assertGf15Binding, assertGf15FreshWindowV1, assertGf15FutureDate, assertGf15OneItem,
  gf15Equal, preflightGf15V1 } from './gf15-contract-v1.mjs';
import { validateV2Submission } from './contract-validator.mjs';
import { authorizeCapability } from './authorization-v2.mjs';
import { normalizeRegisterSchedulingResourceV1, normalizeReplaceSchedulingResourceV1,
  normalizeActivateSchedulingConfigV1, normalizePublishSchedulingConfigV1 } from './scheduling-admin-contract-v1.mjs';
import { createSqliteSchedulingAdminStoreV1, normalizeSchedulingRequestRequirementsV1 } from './sqlite-scheduling-admin-store-v1.mjs';
import { createSqliteSchedulingProposalStoreV1 } from './sqlite-scheduling-proposal-store-v1.mjs';
import { assembleSchedulingInputFromSqliteV1 } from './sqlite-scheduling-input-assembler-v1.mjs';
import { digestCanonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';
import { validateSchedulingProposalEnvelopeV1, buildSchedulingProposalGenerationCommandV1,
  buildSchedulingProposalDecisionCommandV1 } from './scheduling-proposal-contract-v1.mjs';
import { createSqliteGf15RequestStoreV1 } from './sqlite-gf15-request-store-v1.mjs';
import { assertSchedulingQuiescenceV1, bindGf15PacketInTransaction, readGf15Packet,
  immediateGf15, gf15Fail } from './sqlite-scheduling-quiescence-v1.mjs';

function requireOk(value) { if (!value.ok) gf15Fail(value.code); return value; }
function counters(db) {
  const row = db.prepare('SELECT * FROM revision_counters WHERE id = 1').get();
  if (!row) gf15Fail('SCHEDULING_REVISION_NOT_READY');
  return { expectedScheduleRevision: row.schedule_revision, expectedProjectionRevision: row.projection_revision };
}
function draftGate(db, allowOwn) {
  const rows = db.prepare("SELECT proposal_id, generation_operation_id FROM scheduling_proposals WHERE status = 'draft'").all();
  if (rows.length > (allowOwn ? 1 : 0) || rows.some(row => row.generation_operation_id !== ids.proposal)) gf15Fail('GF15_DRAFT_GATE_FAILED');
  return rows;
}
function currentResource(db) { return db.prepare('SELECT * FROM scheduling_resources WHERE resource_id = ?').get(ids.resource); }
function currentConfig(db) {
  const row = db.prepare('SELECT * FROM scheduling_active_config WHERE id = 1').get();
  return row ? { ...row } : null;
}

/** Local domain composition only. No production CLI, HTTP route or authorization transition.
 * Callers must acquire a durable lease before begin and retain it through verification/rollback. */
export function createSqliteGf15CapabilitiesV1({ db, now, refreshProjections, allowedBriefHosts = [], checkpoint = () => {} }) {
  function gate(lease, principal) {
    assertSchedulingQuiescenceV1({ db, now, lease });
    if (lease.owner !== principal?.subjectId || !authorizeCapability({ principal,
      capability: 'modifySchedule', resourceId: ids.resource }).allowed) gf15Fail('GF15_PRINCIPAL_REQUIRED');
  }
  function baseline(lease) {
    const value = readGf15Packet(db, 'baseline');
    if (!value || value.owner !== lease.owner) gf15Fail('GF15_BASELINE_REQUIRED');
    assertGf15Binding(value.binding);
    return value;
  }
  function packet(id, lease, principal, make) {
    return immediateGf15(db, () => {
      gate(lease, principal);
      if (lease.purpose === 'forward') {
        const state = classify(lease);
        if (!state.decisionComplete) assertGf15FreshWindowV1(state.base.binding, now);
      }
      return readGf15Packet(db, id) ?? bindGf15PacketInTransaction(db, id, make(), now().toISOString());
    });
  }
  function admin(lease) { return createSqliteSchedulingAdminStoreV1({ db, now, refreshProjections, schedulingLease: lease }); }
  function proposals(lease, binding) {
    return createSqliteSchedulingProposalStoreV1({ db, now, refreshProjections, schedulingLease: lease,
      authorizeAcceptance: principal => authorizeCapability({ principal, capability: 'modifySchedule', resourceId: ids.resource }).allowed,
      assembleInput: context => {
        const input = assembleSchedulingInputFromSqliteV1(context);
        // The acceptance reassembly after generation uses the same gate. Never filter candidates.
        if (input.candidates.length !== 1 || input.candidates[0].requestId !== ids.request) gf15Fail('GF15_CANDIDATE_ISOLATION_FAILED');
        if (input.configDigest !== binding.configDigest) gf15Fail('GF15_CONFIG_BINDING_MISMATCH');
        return input;
      } });
  }
  function checkAdminReceipt(id, normalizer, kind) {
    const row = db.prepare('SELECT * FROM scheduling_admin_operations WHERE operation_id = ?').get(id);
    if (!row) return null;
    const command = readGf15Packet(db, id);
    const admitted = command && normalizer(command);
    if (!admitted?.ok || admitted.commandDigest !== row.command_digest || row.kind !== kind) gf15Fail('GF15_RECEIPT_MISMATCH');
    const response = JSON.parse(row.response_json);
    if (response.noOp === true) gf15Fail('GF15_RECEIPT_MISMATCH');
    if (command.resource) {
      const expectedResource = id === ids.rollbackResource ? { ...resource, status: 'inactive' } : resource;
      if (!gf15Equal(command.resource, expectedResource) || response.resourceId !== ids.resource
        || response.scheduleRevision !== command.expectedScheduleRevision + 1
        || response.projectionRevision !== command.expectedProjectionRevision + 1) gf15Fail('GF15_RECEIPT_MISMATCH');
    }
    if (kind === 'activateConfig') {
      if (response.configVersion !== command.configVersion || response.projectionRevision !== command.expectedProjectionRevision + 1) gf15Fail('GF15_RECEIPT_MISMATCH');
      const activation = db.prepare('SELECT * FROM scheduling_config_activations WHERE operation_id = ?').get(id);
      if (!activation || activation.command_digest !== row.command_digest || activation.config_version !== command.configVersion
        || activation.projection_revision !== response.projectionRevision || activation.activated_at !== row.created_at) gf15Fail('GF15_RECEIPT_MISMATCH');
    }
    if (kind === 'setRequestRequirements' && (response.requestId !== ids.request
      || response.scheduleRevision !== command.expectedScheduleRevision
      || response.projectionRevision !== command.expectedProjectionRevision + 1)) gf15Fail('GF15_RECEIPT_MISMATCH');
    if (kind === 'publishConfig' && (response.configVersion !== ids.config
      || response.configDigest !== command.configDigest)) gf15Fail('GF15_RECEIPT_MISMATCH');
    return response;
  }
  function classify(lease) {
    const base = baseline(lease);
    const forwardResource = checkAdminReceipt(ids.resourceOperation, normalizeRegisterSchedulingResourceV1, 'registerResource');
    const rollbackResource = checkAdminReceipt(ids.rollbackResource, normalizeReplaceSchedulingResourceV1, 'replaceResource');
    const forwardConfig = checkAdminReceipt(ids.activate, normalizeActivateSchedulingConfigV1, 'activateConfig');
    const rollbackConfig = checkAdminReceipt(ids.rollbackConfig, normalizeActivateSchedulingConfigV1, 'activateConfig');
    const r = currentResource(db);
    const c = currentConfig(db);
    let resourceState;
    if (!r && !forwardResource && !rollbackResource) resourceState = 'RESOURCE_FORWARD_NOT_REACHED';
    else if (r && r.v1_display_place === resource.v1DisplayPlace
      && r.capability_digest === resource.capabilityDigest && gf15Equal(JSON.parse(r.capability_json), resource.capabilityJson)) {
      if (r.status === 'active' && r.source_operation_id === ids.resourceOperation && forwardResource && !rollbackResource) resourceState = 'RESOURCE_FORWARD_APPLIED';
      if (r.status === 'inactive' && r.source_operation_id === ids.rollbackResource && forwardResource && rollbackResource) resourceState = 'RESOURCE_ROLLBACK_APPLIED';
    }
    let configState;
    if (!forwardConfig && !rollbackConfig && gf15Equal(c, base.priorConfig)) configState = c
      ? 'CONFIG_FORWARD_NOT_REACHED_PRIOR_PRESENT' : 'CONFIG_FORWARD_NOT_REACHED_NO_PRIOR';
    if (forwardConfig && c?.config_version === ids.config && c.activation_operation_id === ids.activate && !rollbackConfig) configState =
      !base.priorConfig && resourceState === 'RESOURCE_ROLLBACK_APPLIED' ? 'CONFIG_CONTAINED_NO_PRIOR' : 'CONFIG_FORWARD_APPLIED';
    if (forwardConfig && rollbackConfig && base.priorConfig && c?.config_version === base.priorConfig.config_version
      && c.activation_operation_id === ids.rollbackConfig) configState = 'CONFIG_ROLLBACK_APPLIED_PRIOR_PRESENT';
    const pair = `${resourceState} + ${configState}`;
    if (!GF15_ROLLBACK.rollbackStateMachine.validStatePairs.includes(pair)) gf15Fail('GF15_ROLLBACK_STATE_REJECTED');
    if (r) {
      const sourceReceipt = db.prepare('SELECT created_at FROM scheduling_admin_operations WHERE operation_id = ?').get(r.source_operation_id);
      const createdReceipt = db.prepare('SELECT created_at FROM scheduling_admin_operations WHERE operation_id = ?').get(ids.resourceOperation);
      if (r.updated_at !== sourceReceipt?.created_at || r.created_at !== createdReceipt?.created_at) gf15Fail('GF15_RECEIPT_MISMATCH');
    }
    if (forwardConfig && c) {
      const receipt = c.activation_operation_id === ids.activate ? forwardConfig : rollbackConfig;
      const sourceReceipt = db.prepare('SELECT created_at FROM scheduling_admin_operations WHERE operation_id = ?').get(c.activation_operation_id);
      if (!receipt || c.projection_revision !== receipt.projectionRevision || c.activated_at !== sourceReceipt?.created_at) gf15Fail('GF15_RECEIPT_MISMATCH');
    }
    // A later Scheduling mutation cannot be overwritten, even if it restored the same values.
    const request = db.prepare('SELECT * FROM operations WHERE operation_id = ?').get(ids.requestOperation);
    let requestReceipt = null;
    if (request) {
      if (request.kind !== 'gf15.request.materialize' || request.request_digest !== base.binding.requestDigest) gf15Fail('GF15_RECEIPT_MISMATCH');
      requestReceipt = JSON.parse(request.response_json);
      if (!gf15Equal({ ...db.prepare('SELECT * FROM requests_v2 WHERE id = ?').get(ids.request) }, requestReceipt.row)) gf15Fail('GF15_REQUEST_ROW_MISMATCH');
    } else if (db.prepare('SELECT 1 FROM requests_v2 WHERE id = ?').get(ids.request)) gf15Fail('GF15_RECEIPT_MISMATCH');
    const requirements = checkAdminReceipt(ids.requirements, normalizeSchedulingRequestRequirementsV1, 'setRequestRequirements');
    if (requirements) {
      const row = db.prepare('SELECT * FROM scheduling_request_requirements WHERE request_id = ?').get(ids.request);
      if (!row || row.source_operation_id !== ids.requirements || !gf15Equal(JSON.parse(row.required_capability_ids_json), ['FLAT'])
        || !gf15Equal(JSON.parse(row.duration_estimate_json), { durationMs: 900000, source: 'explicit', sourceVersion: 'prod-gf15-r1' })) gf15Fail('GF15_RECEIPT_MISMATCH');
    }
    const published = checkAdminReceipt(ids.publish, normalizePublishSchedulingConfigV1, 'publishConfig');
    const configRow = db.prepare('SELECT * FROM scheduling_config_versions WHERE config_version = ?').get(ids.config);
    if (published && (!configRow || configRow.publish_operation_id !== ids.publish || configRow.published_by !== base.owner
      || configRow.config_digest !== base.binding.configDigest || !gf15Equal(JSON.parse(configRow.config_json), base.binding.config))) gf15Fail('GF15_CONFIG_BINDING_MISMATCH');
    if (!published && configRow) gf15Fail('GF15_RECEIPT_MISMATCH');
    const proposalRow = db.prepare('SELECT * FROM scheduling_proposals WHERE generation_operation_id = ?').get(ids.proposal);
    let proposal = null;
    if (proposalRow) {
      const admitted = validateSchedulingProposalEnvelopeV1(JSON.parse(proposalRow.proposal_json));
      const generationPacket = readGf15Packet(db, ids.proposal);
      const generation = generationPacket && buildSchedulingProposalGenerationCommandV1(generationPacket);
      if (!admitted.ok || !generation?.ok || proposalRow.generation_command_digest !== generation.commandDigest
        || admitted.proposal.generationCommandDigest !== generation.commandDigest || admitted.proposal.createdBy !== base.owner
        || admitted.proposal.configDigest !== base.binding.configDigest) gf15Fail('GF15_PROPOSAL_BINDING_MISMATCH');
      proposal = admitted.proposal;
      const snapshot = JSON.parse(proposal.inputSnapshotJson);
      if (snapshot.candidates.length !== 1 || snapshot.candidates[0].requestId !== ids.request) gf15Fail('GF15_CANDIDATE_ISOLATION_FAILED');
      assertGf15OneItem(base.binding, JSON.parse(proposal.proposedItemsJson));
    }
    const decision = db.prepare('SELECT * FROM operations WHERE operation_id = ?').get(ids.decision);
    let decisionReceipt = null;
    if (decision) {
      if (decision.kind !== 'acceptSchedulingProposal') gf15Fail('GF15_RECEIPT_MISMATCH');
      decisionReceipt = JSON.parse(decision.response_json);
      const stored = db.prepare('SELECT * FROM scheduling_proposal_decisions WHERE decision_id = ?').get(ids.decision);
      const command = readGf15Packet(db, ids.decision);
      const admitted = proposal && command && buildSchedulingProposalDecisionCommandV1(command, proposal);
      if (!admitted?.ok || admitted.decisionCommandDigest !== decision.request_digest
        || decisionReceipt.decidedBy !== base.owner || proposalRow.status !== 'accepted'
        || !stored || stored.decision_command_digest !== decision.request_digest
        || digestCanonicalJsonSchedulingV1(JSON.parse(stored.receipt_json)) !== stored.receipt_digest
        || !gf15Equal({ ...JSON.parse(stored.receipt_json), decisionReceiptDigest: stored.receipt_digest }, decisionReceipt)) gf15Fail('GF15_RECEIPT_MISMATCH');
    }
    const expectedSchedule = base.revisions.expectedScheduleRevision + Number(Boolean(forwardResource))
      + Number(Boolean(decisionReceipt)) + Number(Boolean(rollbackResource));
    const expectedProjection = base.revisions.expectedProjectionRevision + Number(Boolean(requestReceipt))
      + Number(Boolean(forwardResource)) + Number(Boolean(forwardConfig)) + Number(Boolean(requirements))
      + Number(Boolean(decisionReceipt)) + Number(Boolean(rollbackResource)) + Number(Boolean(rollbackConfig));
    if (!gf15Equal(counters(db), { expectedScheduleRevision: expectedSchedule, expectedProjectionRevision: expectedProjection })) gf15Fail('GF15_POSTSTATE_REVISION_CHANGED');
    if (forwardConfig) {
      const config = db.prepare('SELECT * FROM scheduling_config_versions WHERE config_version = ?').get(ids.config);
      if (!config || config.config_digest !== base.binding.configDigest || !gf15Equal(JSON.parse(config.config_json), base.binding.config)) gf15Fail('GF15_CONFIG_BINDING_MISMATCH');
    }
    return { pair, resourceState, configState, decisionComplete: Boolean(decisionReceipt), base };
  }

  return Object.freeze({
    begin(binding, lease, principal) {
      assertGf15Binding(binding);
      return immediateGf15(db, () => {
        gate(lease, principal);
        if (lease.purpose !== 'forward') gf15Fail('GF15_FORWARD_LEASE_REQUIRED');
        const prior = readGf15Packet(db, 'baseline');
        if (prior) {
          if (prior.owner !== lease.owner || !gf15Equal(prior.binding, binding)) gf15Fail('GF15_PACKET_REUSE');
          draftGate(db, true); classify(lease); return prior;
        }
        draftGate(db, false);
        assertGf15FutureDate(binding.desiredDate, now);
        for (const row of db.prepare("SELECT brief_url FROM requests_v2 WHERE brief_url IS NOT NULL AND trim(brief_url) <> ''").all()) {
          if (!validateV2Submission({ ...binding.requestCommand, briefUrl: row.brief_url }, { allowedBriefHosts }).ok) gf15Fail('GF15_DATABASE_BRIEF_HOST_INCOMPATIBLE');
        }
        const reserved = Object.values(ids);
        if (currentResource(db) || db.prepare('SELECT 1 FROM requests_v2 WHERE id = ?').get(ids.request)
          || db.prepare('SELECT 1 FROM scheduling_config_versions WHERE config_version = ?').get(ids.config)
          || reserved.some(id => db.prepare('SELECT 1 FROM operations WHERE operation_id = ?').get(id)
            || db.prepare('SELECT 1 FROM scheduling_admin_operations WHERE operation_id = ?').get(id))
          || db.prepare('SELECT 1 FROM scheduling_proposals WHERE generation_operation_id = ?').get(ids.proposal)
          || db.prepare('SELECT 1 FROM scheduling_proposal_decisions WHERE decision_id = ?').get(ids.decision)) gf15Fail('GF15_IDENTIFIER_EXISTS');
        const candidates = db.prepare(`SELECT id FROM requests_v2 WHERE request_lifecycle = 'open'
          AND NOT EXISTS (SELECT 1 FROM schedule_item_tasks AS binding JOIN schedule_items AS item
            ON item.id = binding.schedule_item_id WHERE binding.task_id = requests_v2.id AND item.schedule_status <> 'cancelled')`).all();
        if (candidates.length !== 0) gf15Fail('GF15_CANDIDATE_ISOLATION_FAILED');
        const revisions = counters(db);
        const sourceOrdinal = (db.prepare('SELECT max(source_ordinal) AS value FROM requests_v2').get().value ?? -1) + 1;
        const preflight = preflightGf15V1(binding, { scheduleRevision: revisions.expectedScheduleRevision, sourceOrdinal });
        return bindGf15PacketInTransaction(db, 'baseline', { binding, owner: lease.owner,
          revisions, priorConfig: currentConfig(db), preflightDigest: preflight.resultDigest }, now().toISOString());
      });
    },

    forward(lease, principal) {
      const base = immediateGf15(db, () => {
        gate(lease, principal); draftGate(db, true);
        if (lease.purpose !== 'forward') gf15Fail('GF15_FORWARD_LEASE_REQUIRED');
        const state = classify(lease);
        if (state.resourceState === 'RESOURCE_ROLLBACK_APPLIED' || readGf15Packet(db, ids.rollbackResource)) gf15Fail('GF15_ALREADY_CONTAINED');
        return state.base;
      });
      const binding = base.binding;
      const requestPacket = packet(ids.requestOperation, lease, principal, () => ({
        command: binding.requestCommand, commandDigest: binding.requestDigest, desiredDate: binding.desiredDate,
        expectedProjectionRevision: counters(db).expectedProjectionRevision }));
      const requestResult = createSqliteGf15RequestStoreV1({ db, now, refreshProjections, schedulingLease: lease })
        .materialize(requestPacket, principal);
      checkpoint('after-request');
      const store = admin(lease);
      requireOk(store.registerResource(packet(ids.resourceOperation, lease, principal, () => ({
        operationId: ids.resourceOperation, ...counters(db), resource })), principal.subjectId));
      checkpoint('after-resource');
      const req = packet(ids.requirements, lease, principal, () => ({ operationId: ids.requirements,
        ...counters(db), requestId: ids.request, requiredCapabilityIds: ['FLAT'],
        durationEstimate: { durationMs: 900000, source: 'explicit', sourceVersion: 'prod-gf15-r1' } }));
      requireOk(store.setRequestRequirements(req, principal.subjectId));
      checkpoint('before-config');
      requireOk(store.publishConfig(packet(ids.publish, lease, principal, () => ({ operationId: ids.publish,
        configVersion: ids.config, algorithmVersion: GF15_CONFIG.algorithmVersion,
        calendarCompilerVersion: GF15_CONFIG.calendarCompilerVersion, estimatePolicyVersion: GF15_CONFIG.estimatePolicyVersion,
        configJson: binding.config, configDigest: binding.configDigest })), principal.subjectId));
      requireOk(store.activateConfig(packet(ids.activate, lease, principal, () => ({ operationId: ids.activate,
        configVersion: ids.config, expectedProjectionRevision: counters(db).expectedProjectionRevision })), principal.subjectId));
      checkpoint('after-config');
      const proposalStore = proposals(lease, binding);
      const generated = requireOk(proposalStore.generate(packet(ids.proposal, lease, principal, () => ({
        operationId: ids.proposal, planningWindowStart: binding.planningWindowStart,
        planningWindowEnd: binding.planningWindowEnd, resourceScope: [ids.resource] })), principal.subjectId));
      const items = JSON.parse(generated.proposal.proposedItemsJson);
      assertGf15OneItem(binding, items);
      const decision = packet(ids.decision, lease, principal, () => ({ decisionId: ids.decision,
        proposalId: generated.proposal.proposalId, decisionType: 'accept',
        selectedProposalItemIds: items.map(item => item.proposalItemId), decisionNote: null, reasonCode: null }));
      immediateGf15(db, () => {
        gate(lease, principal);
        const drafts = draftGate(db, true);
        if (generated.lifecycle.status === 'draft' && (drafts.length !== 1 || drafts[0].proposal_id !== decision.proposalId)) gf15Fail('GF15_DRAFT_GATE_FAILED');
      });
      checkpoint('after-proposal');
      const accepted = requireOk(proposalStore.accept(decision, principal));
      checkpoint('after-decision');
      immediateGf15(db, () => {
        gate(lease, principal); draftGate(db, false); classify(lease);
        const isolated = db.prepare(`SELECT isolation.*, outbox.attempt_count, outbox.status FROM gf15_outbox_isolation AS isolation
          JOIN notification_outbox AS outbox ON outbox.outbox_id = isolation.outbox_id WHERE isolation.decision_id = ?`).all(ids.decision);
        if (isolated.length !== 1 || isolated[0].attempt_count !== 0 || isolated[0].status !== 'pending') gf15Fail('GF15_OUTBOX_POSTCHECK_FAILED');
      });
      return { ok: true, request: requestResult, proposal: generated.proposal, receipt: accepted.receipt,
        exactReplay: accepted.exactReplay };
    },

    classify(lease, principal) {
      return immediateGf15(db, () => { gate(lease, principal); draftGate(db, true); return classify(lease); });
    },
    rollback(lease, principal) {
      let state = immediateGf15(db, () => { gate(lease, principal); draftGate(db, true); return classify(lease); });
      const initialPair = state.pair;
      const store = admin(lease);
      if (state.resourceState === 'RESOURCE_FORWARD_APPLIED' || state.resourceState === 'RESOURCE_ROLLBACK_APPLIED') {
        const command = packet(ids.rollbackResource, lease, principal, () => ({ operationId: ids.rollbackResource,
          ...counters(db), resource: { ...resource, status: 'inactive' } }));
        requireOk(store.replaceResource(command, principal.subjectId));
      }
      checkpoint('rollback-after-resource');
      state = immediateGf15(db, () => { gate(lease, principal); draftGate(db, true); return classify(lease); });
      if (state.base.priorConfig && ['CONFIG_FORWARD_APPLIED', 'CONFIG_ROLLBACK_APPLIED_PRIOR_PRESENT'].includes(state.configState)) {
        const command = packet(ids.rollbackConfig, lease, principal, () => ({ operationId: ids.rollbackConfig,
          configVersion: state.base.priorConfig.config_version,
          expectedProjectionRevision: counters(db).expectedProjectionRevision }));
        requireOk(store.activateConfig(command, principal.subjectId));
      }
      checkpoint('rollback-after-config');
      state = immediateGf15(db, () => { gate(lease, principal); draftGate(db, true); return classify(lease); });
      return { ok: true, initialPair, finalPair: state.pair };
    },
  });
}
