import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

const [record, packet, terminal, recovery] = await Promise.all([
  readJson('docs/operations/g3-authority-binding-reconciliation.r1.json'),
  readJson('docs/operations/g3-schema11-cutover-approved-packet.r2.json'),
  readJson('docs/operations/g3-schema11-terminal-evidence.r1.json'),
  readJson('docs/operations/g3-rollback-unknown-reconciliation-recovery.r1.json'),
]);

test('G3 reconciliation preserves physical COMMITTED while blocking governance closure', () => {
  assert.equal(record.status, 'RECONCILIATION_REQUIRED');
  assert.equal(record.physicalState.outcome, 'COMMITTED');
  assert.equal(terminal.classification.outcome, 'COMMITTED');
  assert.equal(record.governance.g3GovernanceClosureAllowed, false);
  assert.equal(record.governance.g4Allowed, false);
  assert.equal(record.governance.normalWriterReadmissionAllowed, false);
  assert.equal(record.governance.productionServiceStartAllowed, false);
});

test('G3 reconciliation captures the exact pre-execution authority mismatch', () => {
  assert.equal(packet.authorityTarget.authorityHead, record.trigger.approvedAuthorityHead);
  assert.equal(packet.authorityTargetDigest, record.trigger.approvedAuthorityTargetDigest);
  assert.notEqual(record.trigger.approvedAuthorityHead, record.trigger.executionCanonicalHead);
  assert.equal(record.trigger.authorityHeadsMatch, false);
  assert.equal(record.governance.authorityAdmissionReconciliationRequired, true);
  assert.equal(record.governance.retroactiveApprovalAllowed, false);
});

test('prior rollback UNKNOWN is sealed instead of converted into a retry', () => {
  assert.equal(record.rollbackUnknownRecovery.priorRollbackTerminalOutcome, 'UNKNOWN');
  assert.equal(record.rollbackUnknownRecovery.priorRollbackReplayIdentityReusable, false);
  assert.equal(record.rollbackUnknownRecovery.productionAuthorityGranted, false);
  assert.equal(recovery.priorUnknownAttempt.terminalOutcome, 'UNKNOWN');
  assert.equal(recovery.priorUnknownAttempt.automaticRetryAllowed, false);
  assert.equal(recovery.recoverySemantics.sameAttemptRetryAllowed, false);
  assert.equal(recovery.recoverySemantics.sameReplayIdentityReusable, false);
  assert.equal(recovery.recoverySemantics.recoveryActionIsAutomaticRetry, false);
  assert.equal(recovery.recoverySemantics.newOperationRequired, true);
  assert.equal(recovery.recoverySemantics.newExplicitHumanApprovalRequired, true);
});

test('preferred repair is a new exact recovery operation with a fresh approval', () => {
  assert.equal(record.preservedPrestate.exactRollbackSourceAvailable, true);
  assert.equal(record.preferredResolution.rollbackTargetSha256, record.preservedPrestate.sha256);
  assert.equal(record.preferredResolution.priorRollbackReplayIdentityReusable, false);
  assert.equal(record.preferredResolution.recoveryActionIsAutomaticRetry, false);
  assert.equal(record.preferredResolution.newOperationIdRequired, true);
  assert.equal(record.preferredResolution.newAuthorityTargetDigestRequired, true);
  assert.equal(record.preferredResolution.newPreExecutionApprovalRequired, true);
  assert.equal(record.preferredResolution.explicitHumanAuthorizationRequired, true);
  assert.equal(record.preferredResolution.writerReadmissionAfterRollbackAllowed, false);
  assert.equal(record.preferredResolution.freshLiveReadOnlyVerificationImmediatelyBeforeRollbackRequired, true);
  assert.equal(record.preferredResolution.repositoryEvidenceMaySubstituteForLiveVerification, false);
  assert.equal(record.preferredResolution.authorityAdmissionBoundary, 'DURABLE_ONE_SHOT_CLAIM');
  assert.equal(record.preferredResolution.canonicalHeadMustMatchApprovedTargetImmediatelyBeforeClaim, true);
  assert.equal(record.preferredResolution.postClaimCanonicalLookupAllowed, false);
  assert.equal(record.preferredResolution.postClaimNetworkDependencyAllowed, false);
  assert.equal(record.preferredResolution.instanceIdentityBoundInClaimRequired, true);
  assert.equal(record.preferredResolution.postClaimMetadataRequestAllowed, false);
});

test('repository evidence cannot self-authorize recovery mutation', () => {
  assert.equal(record.evidenceTrust.repositoryTerminalArtifactsProvideIntegrity, true);
  assert.equal(record.evidenceTrust.repositoryTerminalArtifactsProvideProductionProvenance, false);
  assert.equal(record.evidenceTrust.repositoryEvidenceAloneCanAuthorizeReconciliationMutation, false);
  assert.equal(record.evidenceTrust.freshLiveReadOnlyProductionVerificationRequired, true);
  assert.equal(record.evidenceTrust.cryptographicProductionAttestationPresent, false);
  assert.equal(recovery.productionAuthorityGranted, false);
  assert.equal(recovery.recoveryAuthoritySurface.exactRecoveryTargetStatus, 'NOT_CREATED');
  assert.equal(recovery.recoveryAuthoritySurface.approvedPacketStatus, 'NOT_CREATED');
  assert.equal(recovery.recoveryAuthoritySurface.approvalRecordStatus, 'NOT_CREATED');
  assert.equal(recovery.recoveryAuthoritySurface.recoveryAuthorized, false);
});
