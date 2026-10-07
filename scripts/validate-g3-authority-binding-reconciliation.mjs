import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const fail = code => {
  console.error(JSON.stringify({ status: 'G3_AUTHORITY_BINDING_RECONCILIATION_INVALID', code }));
  process.exit(1);
};

const EXPECTED = Object.freeze({
  approvedHead: 'a4199fdb14808ebb866943148a222b0d4300d66e',
  executionHead: 'b9dd595eb52bd09f7a8e2115a48ac401389f5b73',
  target: 'sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5',
  activeDb: 'sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9',
  prestateDb: 'sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7',
  attempt: 'sha256:b398b83229bdece61032e7fa64f03d01594a3aa59abcc96954036871a8c4ed37',
  migration11: 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8',
});

try {
  const [record, packet, terminal, receipt, attemptBytes] = await Promise.all([
    readJson('docs/operations/g3-authority-binding-reconciliation.r1.json'),
    readJson('docs/operations/g3-schema11-cutover-approved-packet.r2.json'),
    readJson('docs/operations/g3-schema11-terminal-evidence.r1.json'),
    readJson('docs/operations/g3-schema11-terminal-receipt.r1.json'),
    readFile(new URL('docs/operations/g3-schema11-attempt-record.r1.json', ROOT)),
  ]);
  const attempt = JSON.parse(attemptBytes.toString('utf8'));

  if (record.schemaVersion !== 1
    || record.reconciliationId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_R1'
    || record.status !== 'RECONCILIATION_REQUIRED'
    || record.trigger.source !== 'PR_50_CODEX_P1'
    || record.trigger.code !== 'EXECUTION_AUTHORITY_HEAD_MISMATCH'
    || record.trigger.approvedAuthorityHead !== EXPECTED.approvedHead
    || record.trigger.executionCanonicalHead !== EXPECTED.executionHead
    || record.trigger.authorityHeadsMatch !== false
    || record.trigger.approvedAuthorityTargetDigest !== EXPECTED.target
    || packet.authorityTarget.authorityHead !== EXPECTED.approvedHead
    || packet.authorityTargetDigest !== EXPECTED.target
    || packet.authorization.approvedAuthorityTargetDigest !== EXPECTED.target
    || EXPECTED.approvedHead === EXPECTED.executionHead
    || record.execution.operationId !== attempt.operationId
    || record.execution.packetId !== attempt.packetId
    || record.execution.attemptClaimedAt !== attempt.claimedAt
    || record.execution.attemptRecordSha256 !== EXPECTED.attempt
    || sha256(attemptBytes) !== EXPECTED.attempt
    || attempt.authorityTargetDigest !== EXPECTED.target
    || record.execution.automaticRetryAllowed !== false
    || receipt.outcome !== 'COMMITTED'
    || receipt.authorityTargetDigest !== EXPECTED.target
    || terminal.classification.outcome !== 'COMMITTED'
    || terminal.schemaVerificationEvidence.activeDatabaseSha256 !== EXPECTED.activeDb
    || terminal.schemaVerificationEvidence.schemaVersionObserved !== 11
    || terminal.schemaVerificationEvidence.migration11Checksum !== EXPECTED.migration11
    || terminal.schemaVerificationEvidence.integrityCheck !== 'ok'
    || terminal.schemaVerificationEvidence.foreignKeyViolationCount !== 0
    || record.physicalState.outcome !== 'COMMITTED'
    || record.physicalState.activeSchemaVersion !== 11
    || record.physicalState.activeDatabaseSha256 !== EXPECTED.activeDb
    || record.physicalState.migration11Checksum !== EXPECTED.migration11
    || record.physicalState.integrityCheck !== 'ok'
    || record.physicalState.foreignKeyViolationCount !== 0
    || record.physicalState.walPresent !== false
    || record.physicalState.shmPresent !== false
    || record.physicalState.journalPresent !== false
    || record.physicalState.activeDatabaseUnchangedSinceAtomicExchange !== true
    || terminal.postStateEvidence.preservedPrestate.sha256 !== EXPECTED.prestateDb
    || terminal.postStateEvidence.preservedPrestate.schemaVersion !== 10
    || record.preservedPrestate.sha256 !== EXPECTED.prestateDb
    || record.preservedPrestate.schemaVersion !== 10
    || record.preservedPrestate.migration11Count !== 0
    || record.preservedPrestate.exactRollbackSourceAvailable !== true
    || record.containment.productionServiceRunning !== false
    || record.containment.normalWritesDisabled !== true
    || record.containment.openDatabaseFileUsers !== 0
    || record.containment.fuserDatabasePids !== 0
    || record.containment.authoritativeWriteCapabilityAbsent !== true
    || record.governance.terminalPhysicalClassification !== 'COMMITTED'
    || record.governance.authorityAdmissionReconciliationRequired !== true
    || record.governance.retroactiveApprovalAllowed !== false
    || record.governance.g3GovernanceClosureAllowed !== false
    || record.governance.g4Allowed !== false
    || record.governance.normalWriterReadmissionAllowed !== false
    || record.governance.productionServiceStartAllowed !== false
    || record.evidenceTrust.repositoryTerminalArtifactsProvideIntegrity !== true
    || record.evidenceTrust.repositoryTerminalArtifactsProvideProductionProvenance !== false
    || record.evidenceTrust.repositoryEvidenceAloneCanAuthorizeReconciliationMutation !== false
    || record.evidenceTrust.freshLiveReadOnlyProductionVerificationRequired !== true
    || record.evidenceTrust.latestLiveActiveDatabaseSha256 !== EXPECTED.activeDb
    || record.evidenceTrust.latestLivePreservedPrestateSha256 !== EXPECTED.prestateDb
    || record.evidenceTrust.latestLiveAttemptRecordSha256 !== EXPECTED.attempt
    || record.evidenceTrust.latestLiveSchemaVersion !== 11
    || record.evidenceTrust.latestLiveMigration11Count !== 1
    || record.evidenceTrust.latestLiveOpenDatabaseFileUsers !== 0
    || record.evidenceTrust.latestLiveFuserDatabasePids !== 0
    || record.evidenceTrust.cryptographicProductionAttestationPresent !== false
    || record.preferredResolution.actionId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_TO_10'
    || record.preferredResolution.strategy
      !== 'ROLLBACK_TO_EXACT_SCHEMA10_THEN_REEXECUTE_UNDER_POST_MERGE_FROZEN_AUTHORITY'
    || record.preferredResolution.productionMutationRequired !== true
    || record.preferredResolution.explicitHumanAuthorizationRequired !== true
    || record.preferredResolution.rollbackTargetSha256 !== EXPECTED.prestateDb
    || record.preferredResolution.oldReplayIdentityReusable !== false
    || record.preferredResolution.newOperationIdRequired !== true
    || record.preferredResolution.newAuthorityTargetDigestRequired !== true
    || record.preferredResolution.newPreExecutionApprovalRequired !== true
    || record.preferredResolution.writerReadmissionAfterRollbackAllowed !== false
    || record.preferredResolution.freshLiveReadOnlyVerificationImmediatelyBeforeRollbackRequired !== true
    || record.preferredResolution.repositoryEvidenceMaySubstituteForLiveVerification !== false) {
    fail('SEMANTIC_INVARIANT_FAILED');
  }

  const requiredProhibitions = [
    'NO_RETROACTIVE_APPROVAL',
    'NO_G4_ENTRY_BEFORE_RECONCILIATION',
    'NO_NORMAL_WRITER_READMISSION',
    'NO_PRODUCTION_SERVICE_START',
    'NO_RETRY_OF_PRIOR_G3_ATTEMPT',
    'NO_RECONCILIATION_MUTATION_FROM_REPOSITORY_EVIDENCE_ALONE',
    'NO_ROLLBACK_WITHOUT_SEPARATE_EXPLICIT_AUTHORIZATION',
  ];
  if (JSON.stringify(record.prohibitions) !== JSON.stringify(requiredProhibitions)) {
    fail('PROHIBITIONS_DRIFT');
  }

  console.log(JSON.stringify({
    status: 'G3_AUTHORITY_BINDING_RECONCILIATION_VALID',
    physicalOutcome: 'COMMITTED',
    authorityAdmissionStatus: 'RECONCILIATION_REQUIRED',
    approvedAuthorityHead: EXPECTED.approvedHead,
    executionCanonicalHead: EXPECTED.executionHead,
    authorityTargetDigest: EXPECTED.target,
    rollbackTargetSha256: EXPECTED.prestateDb,
    g4Allowed: false,
    writerReadmissionAllowed: false,
    nextAction: 'REQUEST_EXPLICIT_G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_TO_10_AUTHORIZATION',
  }));
} catch (error) {
  if (!process.exitCode) {
    console.error(JSON.stringify({
      status: 'G3_AUTHORITY_BINDING_RECONCILIATION_INVALID',
      code: 'VALIDATOR_ERROR',
      errorClass: error?.constructor?.name ?? 'Error',
    }));
    process.exit(1);
  }
}
