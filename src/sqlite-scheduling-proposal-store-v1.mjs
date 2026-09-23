import {
  canonicalJsonSchedulingV1,
  digestCanonicalJsonSchedulingV1,
  normalizeSchedulingInputV1,
} from './scheduling-contract-v1.mjs';
import { normalizeSchedulingConfigV1 } from './scheduling-admin-contract-v1.mjs';
import { generateDeterministicScheduleV1 } from './deterministic-scheduler-v1.mjs';
import { applyCanonicalScheduleAcceptanceInTransactionV2 } from './sqlite-schedule-command-v2.mjs';
import { authorizeCapability, validateTrustedPrincipal } from './authorization-v2.mjs';
import {
  admitSchedulingProposalDecisionV1,
  buildSchedulingProposalDecisionReceiptV1,
  buildSchedulingProposalDecisionCommandV1,
  buildSchedulingProposalEnvelopeV1,
  buildSchedulingProposalGenerationCommandV1,
  buildSchedulingProposalLifecycleV1,
  deriveSchedulingSystemStaleDecisionV1,
  validateSchedulingProposalEnvelopeV1,
} from './scheduling-proposal-contract-v1.mjs';

function denied(code) { return Object.freeze({ ok: false, code }); }
const ASSEMBLER_DENIALS = new Set([
  'SCHEDULING_PLANNING_RANGE_UNSUPPORTED',
  'SCHEDULING_RESOURCE_NOT_REGISTERED',
  'SCHEDULING_CALENDAR_COMPILE_FAILED',
  'SCHEDULING_REVISION_NOT_READY',
]);

function transaction(db, begin, work) {
  db.exec(begin);
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function readActiveConfig(db) {
  const row = db.prepare(`SELECT version.config_version, version.config_json,
    version.config_digest, version.algorithm_version, version.calendar_compiler_version,
    version.estimate_policy_version
    FROM scheduling_active_config AS active
    JOIN scheduling_config_versions AS version ON version.config_version = active.config_version
    WHERE active.id = 1`).get();
  if (!row) return null;
  const admitted = normalizeSchedulingConfigV1(JSON.parse(row.config_json));
  if (!admitted.ok || admitted.configDigest !== row.config_digest
    || admitted.configJson !== row.config_json) return null;
  return { ...row, config: admitted.config };
}

function readRevision(db) {
  return db.prepare('SELECT schedule_revision FROM revision_counters WHERE id = 1').get()?.schedule_revision ?? null;
}

function readProposalRow(db, proposalId) {
  return db.prepare(`SELECT proposal_id, proposal_json, status, terminal_decision_id,
    lifecycle_updated_at FROM scheduling_proposals WHERE proposal_id = ?`).get(proposalId) ?? null;
}

function admitStoredProposal(row) {
  if (!row) return null;
  const admitted = validateSchedulingProposalEnvelopeV1(JSON.parse(row.proposal_json));
  const lifecycle = buildSchedulingProposalLifecycleV1({
    status: row.status, terminalDecisionId: row.terminal_decision_id,
    lifecycleUpdatedAt: row.lifecycle_updated_at,
  });
  if (!admitted.ok || !lifecycle.ok || admitted.proposal.proposalId !== row.proposal_id
    || canonicalJsonSchedulingV1(admitted.proposal) !== row.proposal_json) {
    throw new Error('SCHEDULING_PROPOSAL_STORED_FACT_INVALID');
  }
  return { proposal: admitted.proposal, lifecycle: lifecycle.lifecycle };
}

function insertDecision(db, receipt, proposal, status) {
  db.prepare(`INSERT INTO scheduling_proposal_decisions
    (decision_id, proposal_id, decision_command_digest, decision_type,
     receipt_json, receipt_digest, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    receipt.receipt.decisionId, proposal.proposalId, receipt.receipt.decisionCommandDigest,
    receipt.receipt.decisionType, receipt.receiptJson, receipt.decisionReceiptDigest,
    receipt.receipt.decidedAt,
  );
  const changed = db.prepare(`UPDATE scheduling_proposals SET status = ?,
    terminal_decision_id = ?, lifecycle_updated_at = ?
    WHERE proposal_id = ? AND status = 'draft'`).run(
    status, receipt.receipt.decisionId, receipt.receipt.decidedAt, proposal.proposalId,
  ).changes;
  if (changed !== 1) throw new Error('SCHEDULING_PROPOSAL_DECISION_CAS_FAILED');
}

function staleOneInTransaction(db, { proposalId, triggerOperationId, reasonCode, now }) {
  const found = admitStoredProposal(readProposalRow(db, proposalId));
  if (!found) return denied('PROPOSAL_NOT_FOUND');
  const derived = deriveSchedulingSystemStaleDecisionV1({
    proposalId, triggerOperationId, reasonCode,
  });
  if (!derived.ok) return derived;
  const prior = db.prepare(`SELECT receipt_json, receipt_digest FROM scheduling_proposal_decisions
    WHERE decision_id = ?`).get(derived.decisionId);
  if (prior) return { ok: true, receipt: {
    ...JSON.parse(prior.receipt_json), decisionReceiptDigest: prior.receipt_digest,
  }, exactReplay: true };
  if (found.lifecycle.status !== 'draft') return denied('PROPOSAL_NOT_DRAFT');
  const built = buildSchedulingProposalDecisionReceiptV1({
    decisionId: derived.decisionId,
    decisionCommandDigest: derived.decisionCommandDigest,
    proposalId, decisionType: 'stale', selectedProposalItemIds: null,
    selectionDigest: null, adoptedItems: null, adoptionDigest: null,
    decidedBy: 'system:scheduling-invalidation-v1', decidedAt: now().toISOString(),
    decisionNote: null, baseScheduleRevision: found.proposal.baseScheduleRevision,
    currentScheduleRevision: readRevision(db), resultingScheduleRevision: null,
    reasonCode,
  }, found.proposal, { triggerOperationId });
  if (!built.ok) return built;
  insertDecision(db, built, found.proposal, 'stale');
  return { ok: true, receipt: built.receipt, exactReplay: false };
}

/** Called only inside a trusted existing write transaction. */
export function staleDraftProposalsInTransactionV1({ db, triggerOperationId, reasonCode,
  now, resourceId = null } = {}) {
  if (!db || typeof now !== 'function') throw new TypeError('transaction and injected clock required');
  const rows = db.prepare(`SELECT proposal_id FROM scheduling_proposals
    WHERE status = 'draft' ORDER BY proposal_id`).all();
  let count = 0;
  for (const row of rows) {
    if (resourceId !== null) {
      const found = admitStoredProposal(readProposalRow(db, row.proposal_id));
      if (!found.proposal.resourceScope.includes(resourceId)) continue;
    }
    const result = staleOneInTransaction(db, {
      proposalId: row.proposal_id, triggerOperationId, reasonCode, now,
    });
    if (!result.ok) throw new Error(`SCHEDULING_STALE_FAILED:${result.code}`);
    count += 1;
  }
  return count;
}

/** Internal-only store. The trusted assembler must read only through the supplied db transaction. */
export function createSqliteSchedulingProposalStoreV1({ db, assembleInput, now,
  refreshProjections, authorizeAcceptance } = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function'
    || typeof assembleInput !== 'function' || typeof now !== 'function') {
    throw new TypeError('SQLite db, trusted input assembler, and injected clock are required');
  }

  function readAssembled(command, active) {
    let assembled;
    try {
      assembled = assembleInput({ db, command, activeConfig: active });
    } catch (error) {
      return denied(ASSEMBLER_DENIALS.has(error?.message) ? error.message
        : 'SCHEDULING_INPUT_ASSEMBLY_FAILED');
    }
    const admitted = normalizeSchedulingInputV1(assembled);
    if (!admitted.ok) return denied('SCHEDULING_INPUT_INVALID');
    if (admitted.input.configVersion !== active.config_version
      || admitted.input.configDigest !== active.config_digest
      || admitted.input.algorithmVersion !== active.algorithm_version
      || admitted.input.calendarCompilerVersion !== active.calendar_compiler_version
      || admitted.input.estimatePolicyVersion !== active.estimate_policy_version
      || admitted.input.planningWindowStart !== command.planningWindowStart
      || admitted.input.planningWindowEnd !== command.planningWindowEnd
      || canonicalJsonSchedulingV1(admitted.input.resources.map(item => item.resourceId))
        !== canonicalJsonSchedulingV1(command.resourceScope)) return denied('SCHEDULING_INPUT_INVALID');
    return admitted;
  }

  function readStored(proposalId) {
    const found = admitStoredProposal(readProposalRow(db, proposalId));
    return found ? { ok: true, ...found } : denied('PROPOSAL_NOT_FOUND');
  }

  return Object.freeze({
    generate(commandInput, trustedActor) {
      const generation = buildSchedulingProposalGenerationCommandV1(commandInput);
      if (!generation.ok) return generation;
      if (typeof trustedActor !== 'string' || trustedActor.length === 0) return denied('TRUSTED_ACTOR_REQUIRED');
      const command = generation.command;
      const existing = db.prepare(`SELECT proposal_id, generation_command_digest
        FROM scheduling_proposals WHERE generation_operation_id = ?`).get(command.operationId);
      if (existing) return existing.generation_command_digest === generation.commandDigest
        ? readStored(existing.proposal_id) : denied('IDEMPOTENCY_KEY_REUSE');

      const snapshot = transaction(db, 'BEGIN DEFERRED', () => {
        const active = readActiveConfig(db);
        const revision = readRevision(db);
        if (!active) return denied('SCHEDULING_CONFIG_NOT_ACTIVE');
        if (revision === null) return denied('SCHEDULING_REVISION_NOT_READY');
        const input = readAssembled(command, active);
        if (!input.ok) return input;
        if (input.input.baseScheduleRevision !== revision) return denied('SCHEDULING_INPUT_INVALID');
        return { ok: true, active, input, revision };
      });
      if (!snapshot.ok) return snapshot;
      const computed = generateDeterministicScheduleV1(snapshot.input.input, snapshot.active.config);
      if (!computed.ok) return computed;
      const createdAt = now().toISOString();
      const proposalId = `sp_${digestCanonicalJsonSchedulingV1({
        domain: 'scheduling-proposal-generation-id-v1', operationId: command.operationId,
      }).slice('sha256:'.length)}`;
      const built = buildSchedulingProposalEnvelopeV1({
        proposalId, schemaVersion: 1, baseScheduleRevision: snapshot.revision,
        algorithmVersion: snapshot.input.input.algorithmVersion,
        calendarCompilerVersion: snapshot.input.input.calendarCompilerVersion,
        timeZoneDataVersion: snapshot.input.input.timeZoneDataVersion,
        estimatePolicyVersion: snapshot.input.input.estimatePolicyVersion,
        configVersion: snapshot.input.input.configVersion,
        configDigest: snapshot.input.input.configDigest,
        planningWindowStart: command.planningWindowStart,
        planningWindowEnd: command.planningWindowEnd,
        resourceScope: command.resourceScope,
        inputSnapshotJson: snapshot.input.inputJson,
        inputDigest: snapshot.input.inputDigest,
        proposedItemsJson: canonicalJsonSchedulingV1(computed.result.proposedItems),
        diagnosticsJson: canonicalJsonSchedulingV1(computed.result.diagnostics),
        resultDigest: computed.resultDigest,
        generationOperationId: command.operationId,
        generationCommandDigest: generation.commandDigest,
        createdBy: trustedActor, createdAt,
      });
      if (!built.ok) return built;
      return transaction(db, 'BEGIN IMMEDIATE', () => {
        const replay = db.prepare(`SELECT proposal_id, generation_command_digest
          FROM scheduling_proposals WHERE generation_operation_id = ?`).get(command.operationId);
        if (replay) return replay.generation_command_digest === generation.commandDigest
          ? readStored(replay.proposal_id) : denied('IDEMPOTENCY_KEY_REUSE');
        const currentActive = readActiveConfig(db);
        const currentRevision = readRevision(db);
        if (!currentActive || currentRevision !== snapshot.revision
          || currentActive.config_version !== snapshot.active.config_version
          || currentActive.config_digest !== snapshot.active.config_digest) {
          return denied('SCHEDULING_INPUT_CHANGED_RETRY');
        }
        const currentInput = readAssembled(command, currentActive);
        if (!currentInput.ok || currentInput.inputDigest !== snapshot.input.inputDigest) {
          return denied('SCHEDULING_INPUT_CHANGED_RETRY');
        }
        db.prepare(`INSERT INTO scheduling_proposals
          (proposal_id, proposal_json, generation_operation_id, generation_command_digest,
           input_digest, result_digest, base_schedule_revision, config_version, status,
           terminal_decision_id, created_at, lifecycle_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`).run(
          proposalId, canonicalJsonSchedulingV1(built.proposal), command.operationId,
          generation.commandDigest, snapshot.input.inputDigest, computed.resultDigest,
          snapshot.revision, snapshot.active.config_version, createdAt, createdAt,
        );
        return { ok: true, proposal: built.proposal, lifecycle: {
          status: 'draft', terminalDecisionId: null, lifecycleUpdatedAt: createdAt,
        } };
      });
    },

    read(proposalId) {
      return readStored(proposalId);
    },

    reject(decisionInput, trustedActor) {
      if (typeof trustedActor !== 'string' || trustedActor.length === 0) return denied('TRUSTED_ACTOR_REQUIRED');
      return transaction(db, 'BEGIN IMMEDIATE', () => {
        const reused = db.prepare(`SELECT proposal_id FROM scheduling_proposal_decisions
          WHERE decision_id = ?`).get(decisionInput?.decisionId);
        if (reused && reused.proposal_id !== decisionInput?.proposalId) {
          return denied('IDEMPOTENCY_KEY_REUSE');
        }
        const found = admitStoredProposal(readProposalRow(db, decisionInput?.proposalId));
        if (!found) return denied('PROPOSAL_NOT_FOUND');
        const admitted = admitSchedulingProposalDecisionV1(decisionInput, found.proposal);
        if (!admitted.ok) return admitted;
        if (admitted.command.decisionType !== 'reject') return denied('PROPOSAL_ACCEPT_NOT_WIRED');
        const prior = db.prepare(`SELECT decision_command_digest, receipt_json, receipt_digest
          FROM scheduling_proposal_decisions WHERE decision_id = ?`).get(admitted.command.decisionId);
        if (prior) return prior.decision_command_digest === admitted.decisionCommandDigest
          ? { ok: true, receipt: {
            ...JSON.parse(prior.receipt_json), decisionReceiptDigest: prior.receipt_digest,
          }, exactReplay: true }
          : denied('IDEMPOTENCY_KEY_REUSE');
        if (found.lifecycle.status !== 'draft') return denied('PROPOSAL_NOT_DRAFT');
        const decidedAt = now().toISOString();
        const built = buildSchedulingProposalDecisionReceiptV1({
          decisionId: admitted.command.decisionId,
          decisionCommandDigest: admitted.decisionCommandDigest,
          proposalId: found.proposal.proposalId, decisionType: 'reject',
          selectedProposalItemIds: null, selectionDigest: null,
          adoptedItems: null, adoptionDigest: null,
          decidedBy: trustedActor, decidedAt,
          decisionNote: admitted.command.decisionNote,
          baseScheduleRevision: found.proposal.baseScheduleRevision,
          currentScheduleRevision: null, resultingScheduleRevision: null,
          reasonCode: 'HUMAN_REJECTED',
        }, found.proposal);
        if (!built.ok) return built;
        insertDecision(db, built, found.proposal, 'rejected');
        return { ok: true, receipt: built.receipt, exactReplay: false };
      });
    },

    /** Local application use case; no HTTP route or autonomous Agent caller is wired. */
    accept(decisionInput, principal) {
      if (typeof authorizeAcceptance !== 'function'
        || typeof refreshProjections !== 'function') return denied('PROPOSAL_ACCEPT_NOT_WIRED');
      if (!validateTrustedPrincipal(principal).ok) return denied('TRUSTED_SCHEDULER_REQUIRED');
      return transaction(db, 'BEGIN IMMEDIATE', () => {
        const operation = db.prepare(`SELECT kind, response_json, request_digest FROM operations
          WHERE operation_id = ?`).get(decisionInput?.decisionId);
        if (operation && !['acceptSchedulingProposal', 'acceptSchedulingProposalStale']
          .includes(operation.kind)) return denied('IDEMPOTENCY_KEY_REUSE');
        if (operation && JSON.parse(operation.response_json).proposalId !== decisionInput?.proposalId) {
          return denied('IDEMPOTENCY_KEY_REUSE');
        }
        const reused = db.prepare(`SELECT proposal_id FROM scheduling_proposal_decisions
          WHERE decision_id = ?`).get(decisionInput?.decisionId);
        if (reused && reused.proposal_id !== decisionInput?.proposalId) {
          return denied('IDEMPOTENCY_KEY_REUSE');
        }
        const found = admitStoredProposal(readProposalRow(db, decisionInput?.proposalId));
        if (!found) return denied('PROPOSAL_NOT_FOUND');
        const admitted = buildSchedulingProposalDecisionCommandV1(decisionInput, found.proposal);
        if (!admitted.ok) return admitted;
        if (!['accept', 'partiallyAccept'].includes(admitted.command.decisionType)) {
          return denied('PROPOSAL_ACCEPT_DECISION_TYPE_INVALID');
        }
        const allItems = JSON.parse(found.proposal.proposedItemsJson);
        const bySelectedId = new Map(allItems.map(item => [item.proposalItemId, item]));
        const selectedResourceIds = [...new Set(admitted.command.selectedProposalItemIds
          .map(id => bySelectedId.get(id).resourceId))];
        if (authorizeAcceptance(principal, selectedResourceIds) !== true
          || selectedResourceIds.some(resourceId => !authorizeCapability({
            principal, capability: 'modifySchedule', resourceId,
          }).allowed)) return denied('TRUSTED_SCHEDULER_REQUIRED');
        if (operation) return operation.request_digest === admitted.decisionCommandDigest
          ? { ok: true, receipt: JSON.parse(operation.response_json), exactReplay: true }
          : denied('IDEMPOTENCY_KEY_REUSE');
        const prior = db.prepare(`SELECT decision_command_digest, receipt_json, receipt_digest
          FROM scheduling_proposal_decisions WHERE decision_id = ?`).get(admitted.command.decisionId);
        if (prior) return prior.decision_command_digest === admitted.decisionCommandDigest
          ? { ok: true, receipt: {
            ...JSON.parse(prior.receipt_json), decisionReceiptDigest: prior.receipt_digest,
          }, exactReplay: true } : denied('IDEMPOTENCY_KEY_REUSE');
        if (found.lifecycle.status !== 'draft') return denied('PROPOSAL_NOT_DRAFT');
        const proposal = found.proposal;
        const current = db.prepare(`SELECT schedule_revision, projection_revision
          FROM revision_counters WHERE id = 1`).get();
        if (!current) throw new Error('SCHEDULING_COUNTERS_MISSING');
        const active = readActiveConfig(db);
        let staleReason = null;
        if (current.schedule_revision !== proposal.baseScheduleRevision) {
          staleReason = 'SCHEDULE_REVISION_CHANGED';
        } else if (!active || active.config_version !== proposal.configVersion
          || active.config_digest !== proposal.configDigest) {
          staleReason = 'SCHEDULING_CONFIG_CHANGED';
        } else if (!active.config.compatibleAlgorithmVersions.includes(proposal.algorithmVersion)
          || active.algorithm_version !== proposal.algorithmVersion) {
          staleReason = 'SCHEDULING_ALGORITHM_UNSUPPORTED';
        }
        let input = null;
        if (!staleReason) {
          input = readAssembled({ planningWindowStart: proposal.planningWindowStart,
            planningWindowEnd: proposal.planningWindowEnd, resourceScope: proposal.resourceScope }, active);
          if (!input || input.inputDigest !== proposal.inputDigest) {
            staleReason = 'SCHEDULING_INPUT_CHANGED';
          }
        }
        if (staleReason) {
          const stale = staleOneInTransaction(db, {
            proposalId: proposal.proposalId,
            triggerOperationId: admitted.command.decisionId, reasonCode: staleReason, now,
          });
          if (!stale.ok) return stale;
          db.prepare(`INSERT INTO operations
            (operation_id, kind, response_json, created_at, request_digest)
            VALUES (?, 'acceptSchedulingProposalStale', ?, ?, ?)`).run(
            admitted.command.decisionId, canonicalJsonSchedulingV1(stale.receipt),
            stale.receipt.decidedAt, admitted.decisionCommandDigest,
          );
          return stale;
        }
        const recomputed = generateDeterministicScheduleV1(input.input, active.config);
        if (!recomputed.ok || recomputed.resultDigest !== proposal.resultDigest) {
          throw new Error('SCHEDULING_HARD_CONSTRAINT_REVALIDATION_FAILED');
        }
        const byId = new Map(recomputed.result.proposedItems.map(item => [item.proposalItemId, item]));
        const selected = admitted.command.selectedProposalItemIds.map(id => byId.get(id));
        if (selected.some(item => !item)) throw new Error('SCHEDULING_SELECTION_REVALIDATION_FAILED');
        const decidedAt = now().toISOString();
        const applied = applyCanonicalScheduleAcceptanceInTransactionV2({ db, proposal,
          selectedItems: selected, decisionId: admitted.command.decisionId,
          currentScheduleRevision: current.schedule_revision,
          currentProjectionRevision: current.projection_revision, at: decidedAt,
          refreshProjections });
        const built = buildSchedulingProposalDecisionReceiptV1({
          decisionId: admitted.command.decisionId,
          decisionCommandDigest: admitted.decisionCommandDigest,
          proposalId: proposal.proposalId,
          decisionType: admitted.command.decisionType,
          selectedProposalItemIds: admitted.command.selectedProposalItemIds,
          selectionDigest: admitted.selectionDigest,
          adoptedItems: applied.adoptedItems,
          adoptionDigest: digestCanonicalJsonSchedulingV1({
            domain: 'scheduling-proposal-adoption-v1', adoptedItems: applied.adoptedItems,
          }),
          decidedBy: principal.subjectId, decidedAt,
          decisionNote: admitted.command.decisionNote,
          baseScheduleRevision: proposal.baseScheduleRevision,
          currentScheduleRevision: current.schedule_revision,
          resultingScheduleRevision: applied.scheduleRevision,
          reasonCode: null,
        }, proposal);
        if (!built.ok) throw new Error(`SCHEDULING_ACCEPT_RECEIPT_INVALID:${built.code}`);
        db.prepare(`INSERT INTO operations
          (operation_id, kind, response_json, created_at, request_digest)
          VALUES (?, 'acceptSchedulingProposal', ?, ?, ?)`).run(
          admitted.command.decisionId, canonicalJsonSchedulingV1(built.receipt), decidedAt,
          admitted.decisionCommandDigest,
        );
        db.prepare(`INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
          VALUES ('acceptSchedulingProposal', ?, ?, ?, 'accepted', ?)`).run(
          principal.role, proposal.proposalId, applied.scheduleRevision, decidedAt,
        );
        insertDecision(db, built, proposal,
          admitted.command.decisionType === 'accept' ? 'accepted' : 'partiallyAccepted');
        staleDraftProposalsInTransactionV1({ db,
          triggerOperationId: admitted.command.decisionId,
          reasonCode: 'SCHEDULE_REVISION_CHANGED', now });
        return { ok: true, receipt: built.receipt, exactReplay: false };
      });
    },

    stale({ proposalId, triggerOperationId, reasonCode } = {}) {
      return transaction(db, 'BEGIN IMMEDIATE', () => staleOneInTransaction(db, {
        proposalId, triggerOperationId, reasonCode, now,
      }));
    },
  });
}
