import { GF15_IDS, assertGf15OneItem, gf15Equal } from './gf15-contract-v1.mjs';
import { assertSchedulingQuiescenceV1, gf15Fail, readGf15Packet } from './sqlite-scheduling-quiescence-v1.mjs';

/** Atomic isolation within canonical acceptance, before enqueue. The permanent exclusion is
 * committed together with the real notification evidence. There is no claimable commit. */
export function isolateGf15OutboxInTransactionV1({ db, proposal, selectedItems, decisionId, intent, schedulingLease, at }) {
  if (proposal.generationOperationId !== GF15_IDS.proposal && decisionId !== GF15_IDS.decision) return;
  assertSchedulingQuiescenceV1({ db, lease: schedulingLease, now: () => new Date(at) });
  if (schedulingLease?.purpose !== 'forward') gf15Fail('GF15_FORWARD_LEASE_REQUIRED');
  const baseline = readGf15Packet(db, 'baseline');
  const decision = readGf15Packet(db, GF15_IDS.decision);
  if (!baseline || baseline.owner !== schedulingLease?.owner || !decision
    || proposal.generationOperationId !== GF15_IDS.proposal || decisionId !== GF15_IDS.decision
    || decision.proposalId !== proposal.proposalId || decision.decisionType !== 'accept'
    || !gf15Equal(decision.selectedProposalItemIds, selectedItems.map(item => item.proposalItemId))
    || intent.intentType !== 'schedule.confirmed.v1') gf15Fail('GF15_OUTBOX_BINDING_MISMATCH');
  assertGf15OneItem(baseline.binding, selectedItems);
  db.prepare('INSERT INTO gf15_outbox_isolation VALUES (?, ?, ?, ?, ?, ?)').run(
    intent.outboxId, proposal.proposalId, decisionId, intent.intentType, intent.payloadDigest, at);
  db.prepare(`INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
    VALUES ('gf15.outbox.isolate', 'scheduler', ?, ?, 'permanentlyExcluded', ?)`).run(intent.outboxId, intent.aggregateRevision, at);
}
