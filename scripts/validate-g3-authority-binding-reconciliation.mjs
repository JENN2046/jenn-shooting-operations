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
  rollbackExecutor: 'sha256:50f1f538d0143510ac4ff1f178da8dadb78fd58025d7649461e57fa5e911df26',
  rollbackOperation: 'G3-AUTH-RECON-ROLLBACK-20261007-R1',
  rollbackPacket: 'G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1',
});

try {
  const [
    record, packet, terminal, receipt, attemptBytes,
    rollbackExecutorBytes, startupGateBytes, serverBytes, composeBytes, dockerfileBytes,
  ] = await Promise.all([
    readJson('docs/operations/g3-authority-binding-reconciliation.r1.json'),
    readJson('docs/operations/g3-schema11-cutover-approved-packet.r2.json'),
    readJson('docs/operations/g3-schema11-terminal-evidence.r1.json'),
    readJson('docs/operations/g3-schema11-terminal-receipt.r1.json'),
    readFile(new URL('docs/operations/g3-schema11-attempt-record.r1.json', ROOT)),
    readFile(new URL('scripts/g3-authority-reconciliation-rollback-executor.py', ROOT)),
    readFile(new URL('src/g3-authority-reconciliation-startup-gate-v1.mjs', ROOT)),
    readFile(new URL('src/server.mjs', ROOT)),
    readFile(new URL('compose.yaml', ROOT)),
    readFile(new URL('Dockerfile', ROOT)),
  ]);
  const attempt = JSON.parse(attemptBytes.toString('utf8'));
  const rollbackExecutorText = rollbackExecutorBytes.toString('utf8');
  const startupGateText = startupGateBytes.toString('utf8');
  const serverText = serverBytes.toString('utf8');
  const composeText = composeBytes.toString('utf8');
  const dockerfileText = dockerfileBytes.toString('utf8');

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
    || record.evidenceTrust.cryptographicProductionAttestationPresent !== false) {
    fail('TERMINAL_OR_RECONCILIATION_FACT_DRIFT');
  }

  const startup = record.runtimeStartupGate;
  if (startup.status !== 'ENFORCED_BY_AUTHORITY_SURFACE'
    || startup.directProductionServiceStartupBlockedWhileReconciliationRequired !== true
    || startup.composeWriteAdmissionDefault !== 'disabled'
    || startup.composeOrphanCleanupDefault !== 'disabled'
    || startup.callerMayOverrideReconciliationBlock !== false
    || !startup.productionDatabasePaths.includes('/app/data/shooting-operations.sqlite')
    || !startup.productionDatabasePaths.includes(record.physicalState.activeDatabasePath)
    || !startupGateText.includes('G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED')
    || !startupGateText.includes("record.status === 'RECONCILIATION_REQUIRED'")
    || serverText.split('assertG3AuthorityReconciliationStartupAllowed({ databasePath });').length - 1 < 2
    || !composeText.includes('WRITE_ADMISSION_MODE: \${WRITE_ADMISSION_MODE:-disabled}')
    || !composeText.includes('ORPHAN_CLEANUP_MODE: \${ORPHAN_CLEANUP_MODE:-disabled}')
    || !dockerfileText.includes('g3-authority-binding-reconciliation.r1.json')) {
    fail('STARTUP_GATE_DRIFT');
  }

  const surface = record.rollbackAuthoritySurface;
  if (surface.status !== 'DEFINED_NOT_EXECUTABLE'
    || surface.executorPath !== 'scripts/g3-authority-reconciliation-rollback-executor.py'
    || surface.executorSha256 !== EXPECTED.rollbackExecutor
    || sha256(rollbackExecutorBytes) !== EXPECTED.rollbackExecutor
    || surface.actionId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_TO_10'
    || surface.operationId !== EXPECTED.rollbackOperation
    || surface.packetId !== EXPECTED.rollbackPacket
    || surface.contractId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_V1'
    || surface.controlRoot !== '/mnt/datadisk0/g3-authority-binding-reconciliation/rollback'
    || surface.replayIdentity !== 'operationId+rollbackTargetDigest'
    || surface.durableOneShotRequired !== true
    || surface.automaticRetryAllowed !== false
    || surface.exactRollbackTargetStatus !== 'NOT_CREATED'
    || surface.approvedPacketStatus !== 'NOT_CREATED'
    || surface.approvalRecordStatus !== 'NOT_CREATED'
    || surface.rollbackAuthorized !== false
    || surface.authorityHeadBinding !== 'FREEZE_POST_MERGE_AUTHORITY_HEAD_IN_SEPARATE_EXACT_TARGET'
    || surface.approvalRequestAllowedBeforeExactTargetFreeze !== false
    || surface.packetIdPartitionsReplayIdentity !== false
    || surface.targetFreezeMustBindPostMergeCanonicalHead !== true
    || surface.canonicalHeadMustRemainUnchangedThroughExecution !== true
    || surface.freshCanonicalHeadVerificationImmediatelyBeforeExecutionRequired !== true
    || !rollbackExecutorText.includes('CANONICAL_BRANCH = "codex/v2-1-architecture-freeze"')
    || !rollbackExecutorText.includes('git", "ls-remote"')
    || !rollbackExecutorText.includes('ROLLBACK_CANONICAL_AUTHORITY_HEAD_MISMATCH')
    || !rollbackExecutorText.includes('OPERATION_ID = "' + EXPECTED.rollbackOperation + '"')
    || !rollbackExecutorText.includes('PACKET_ID = "' + EXPECTED.rollbackPacket + '"')
    || !rollbackExecutorText.includes('claim_attempt(target_digest)')
    || rollbackExecutorText.split('verify_active_and_preserved_state(expected_authority_head)').length - 1 < 2
    || !rollbackExecutorText.includes('rename_exchange(ACTIVE_DB, PRESERVED_SCHEMA10)')
    || !rollbackExecutorText.includes('--target-record')
    || rollbackExecutorText.includes('--rollback-target-digest')) {
    fail('ROLLBACK_AUTHORITY_SURFACE_DRIFT');
  }

  const preferred = record.preferredResolution;
  if (preferred.actionId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_TO_10'
    || preferred.strategy !== 'ROLLBACK_TO_EXACT_SCHEMA10_THEN_REEXECUTE_UNDER_POST_MERGE_FROZEN_AUTHORITY'
    || preferred.productionMutationRequired !== true
    || preferred.explicitHumanAuthorizationRequired !== true
    || preferred.rollbackTargetSha256 !== EXPECTED.prestateDb
    || preferred.oldReplayIdentityReusable !== false
    || preferred.newOperationIdRequired !== true
    || preferred.newAuthorityTargetDigestRequired !== true
    || preferred.newPreExecutionApprovalRequired !== true
    || preferred.writerReadmissionAfterRollbackAllowed !== false
    || preferred.freshLiveReadOnlyVerificationImmediatelyBeforeRollbackRequired !== true
    || preferred.repositoryEvidenceMaySubstituteForLiveVerification !== false
    || preferred.authoritySurfaceMustMergeBeforeExactTargetFreeze !== true
    || preferred.exactRollbackTargetMustFreezeBeforeApprovalRequest !== true
    || preferred.exactRollbackTargetStatus !== 'NOT_CREATED'
    || preferred.rollbackApprovalRequestAllowed !== false
    || preferred.approvalRequestRequiresExactRollbackTargetDigest !== true
    || preferred.targetFreezeMustBindPostMergeCanonicalHead !== true
    || preferred.canonicalHeadMustRemainUnchangedThroughExecution !== true
    || preferred.freshCanonicalHeadVerificationImmediatelyBeforeRollbackRequired !== true
    || preferred.nextAction !== 'MERGE_RECONCILIATION_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_ROLLBACK_TARGET') {
    fail('ROLLBACK_SEQUENCE_DRIFT');
  }

  const requiredProhibitions = [
    'NO_RETROACTIVE_APPROVAL',
    'NO_G4_ENTRY_BEFORE_RECONCILIATION',
    'NO_NORMAL_WRITER_READMISSION',
    'NO_PRODUCTION_SERVICE_START',
    'NO_RETRY_OF_PRIOR_G3_ATTEMPT',
    'NO_RECONCILIATION_MUTATION_FROM_REPOSITORY_EVIDENCE_ALONE',
    'NO_ROLLBACK_APPROVAL_BEFORE_EXACT_TARGET_FREEZE',
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
    rollbackAuthoritySurfaceStatus: surface.status,
    rollbackExecutorSha256: surface.executorSha256,
    exactRollbackTargetStatus: surface.exactRollbackTargetStatus,
    rollbackApprovalRequestAllowed: false,
    productionStartupAllowed: false,
    g4Allowed: false,
    writerReadmissionAllowed: false,
    nextAction: 'MERGE_RECONCILIATION_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_ROLLBACK_TARGET',
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
