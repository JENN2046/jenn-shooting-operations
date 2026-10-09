import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { assertG3AuthorityReconciliationStartupAllowed } from '../src/g3-authority-reconciliation-startup-gate-v1.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const json = path => JSON.parse(read(path));
const design = json('docs/operations/g3-forward-reconciliation-exception.r1.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(json('contracts/g3-forward-reconciliation-exception.r1.schema.json'));
const validateCutoverPacket = ajv.compile(json('contracts/g3-schema11-cutover-packet.v1.schema.json'));
const old = json('docs/operations/g3-authority-binding-reconciliation.r1.json');
const g2 = json('docs/operations/g2-minimal-release-contract.v1.json');
const evidence = json('docs/operations/g3-forward-adoption-evidence-and-contract.r1.json');
const mutate = fn => { const copy = structuredClone(design); fn(copy); return copy; };

test('versioned exception is a closed non-executable design, never an existing cutover packet', () => {
  assert.equal(validate(design), true, JSON.stringify(validate.errors));
  assert.equal(validateCutoverPacket(design), false);
  assert.ok(Object.values(design.currentAuthority).every(v => v === false));
  assert.equal(design.actionId, evidence.forwardOnlyGovernance.actionId);
});

test('G2 byte pin and historical facts are checked against existing authority artifacts', () => {
  assert.equal(design.references.g2ContractSha256, 'sha256:' + createHash('sha256').update(read(design.references.g2Contract)).digest('hex'));
  assert.deepEqual(design.historicalFacts, evidence.historicalFacts);
  assert.equal(design.historicalFacts.g3GovernanceStatus, old.status);
  assert.equal(design.historicalFacts.g3ApprovalHead, old.trigger.approvedAuthorityHead);
  assert.equal(design.historicalFacts.g3ExecutionHead, old.trigger.executionCanonicalHead);
  assert.equal(design.historicalFacts.oldRollbackAttemptSha256, old.rollbackUnknownRecovery.priorRollbackAttemptRecordSha256);
  assert.equal(design.claimRequirements.replayIdentity, g2.invariants[3].attemptReplayIdentity);
  assert.equal(design.claimRequirements.packetIdPartitionsReplayIdentity, g2.invariants[3].packetIdPartitionsReplayIdentity);
  for (const outcome of design.receiptRequirements.subactionOutcomes) assert.ok(g2.invariants[4].allowedOutcomes.includes(outcome));
});

const negatives = [
  ['retroactive legalization', d => { d.historicalFacts.historicalBindingCompliant = true; }],
  ['old UNKNOWN reset', d => { d.historicalFacts.oldRollbackOutcome = 'ROLLED_BACK'; }],
  ['old approval reused', d => { d.approvalRequirements.oldApprovalMayAuthorizeFutureAction = true; }],
  ['design or merge used as permission', d => { d.approvalRequirements.designTaskOrMergeCountsAsExecutionApproval = true; }],
  ['historical operation ID reused', d => { d.claimRequirements.newOperationIdCannotEqualAnyHistoricalG3OrRollbackId = false; }],
  ['packet ID replay partition', d => { d.claimRequirements.packetIdPartitionsReplayIdentity = true; }],
  ['post-claim canonical lookup', d => { d.targetRequirements.latestCanonicalCheckedBeforeClaim = false; d.targetRequirements.postClaimNetworkDependencyAllowed = true; }],
  ['drift silently accepted', d => { d.targetRequirements.unknownOrDriftDisposition = 'CLAIM'; }],
  ['lab evidence promoted to production', d => { d.method.labEvidenceMaySubstituteForProduction = true; }],
  ['missing exact approval binding', d => { delete d.approvalRequirements.approvalBindsContractVersionDigestAndTargetDigest; }],
  ['claim without durable consumption', d => { d.claimRequirements.claimMustBeDurableBeforeNewGovernanceAppend = false; }],
  ['lost claim retried', d => { d.claimRequirements.lostClaimAcknowledgementDisposition = 'RETRY'; }],
  ['new gate family', d => { d.gateFamily = 'G3_FORWARD'; }],
  ['backdated effective time', d => { d.receiptRequirements.effectiveAt = 'HISTORICAL_CUTOVER_TIME'; }],
  ['invented terminal outcome', d => { d.receiptRequirements.subactionOutcomes.push('RECONCILED'); }],
  ['incomplete evidence accepted', d => { d.receiptRequirements.unclassifiableOrMissingEvidenceOutcome = 'COMMITTED'; }],
  ['receipt without claim', d => { d.receiptRequirements.noClaimMeansNoTerminalReceipt = false; }],
  ['side-channel approval payload', d => { d.approval = { approved: true }; }],
  ['live operation allocated', d => { d.operationId = 'SYNTHETIC_NOT_A_REAL_OPERATION'; }],
  ['unselected signed chain represented as passed', d => { d.method.optionalSignatureCompatibility = 'PASS'; }],
];
for (const [name, change] of negatives) {
  test('design rejects ' + name, () => {
    assert.equal(validate(mutate(change)), false, name);
  });
}

test('every present authority escalation is rejected, including receipt, merge and next gate', () => {
  for (const key of Object.keys(design.currentAuthority)) {
    assert.equal(validate(mutate(d => { d.currentAuthority[key] = true; })), false, key);
  }
});

test('valid design does not open unchanged production startup gate or clear history', () => {
  for (const reconciliationRecord of [design, old]) {
    assert.throws(() => assertG3AuthorityReconciliationStartupAllowed({
      databasePath: '/app/data/shooting-operations.sqlite', reconciliationRecord,
    }), /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/);
  }
  assert.equal(old.status, 'RECONCILIATION_REQUIRED');
  assert.equal(old.governance.productionServiceStartAllowed, false);
});
