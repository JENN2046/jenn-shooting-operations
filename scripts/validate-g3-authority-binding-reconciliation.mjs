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
  originalTarget: 'sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5',
  activeDb: 'sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9',
  prestateDb: 'sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7',
  originalAttempt: 'sha256:b398b83229bdece61032e7fa64f03d01594a3aa59abcc96954036871a8c4ed37',
  migration11: 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8',
  priorRollbackOperation: 'G3-AUTH-RECON-ROLLBACK-20261007-R1',
  priorRollbackPacket: 'G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1',
  priorRollbackTarget: 'sha256:b71d4853f47c8f2404b331c8a9e810747ba211a867353607819ee70ff15bf509',
  priorRollbackAttempt: 'sha256:bfd40da521d2a3871ffcf4b4913de260d51c368eeca0ca775c4bda6b25b5645a',
  priorRollbackTerminalEvidence: 'sha256:7e04e137efa425361bf0a400017bf4452bc45cf2e9daae6c6b49c767f341ebb1',
  recoveryExecutor: 'sha256:0f529e686ac9bcd07274ab7b74c9f741064264d87014f4b49df5ca82a8e3eb09',
  recoveryVerifier: 'sha256:5360e45311aa237246e0cf5eab4ce9302e0ef554832dad1311b70584773ee5fc',
  recoveryAction: 'G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_UNKNOWN_RECOVERY_TO_10',
  recoveryOperation: 'G3-AUTH-RECON-ROLLBACK-RECOVERY-20261007-R1',
  recoveryPacket: 'G3-AUTH-RECON-ROLLBACK-RECOVERY-PACKET-20261007-R1',
  recoveryContract: 'G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_RECOVERY_V1',
  recoveryTargetId: 'G3-AUTH-RECON-ROLLBACK-RECOVERY-TARGET-20261007-R1',
});

try {
  const [
    record, recovery, packet, terminal, receipt, attemptBytes,
    rollbackExecutorBytes, terminalVerifierBytes, startupGateBytes, serverBytes, storeBytes, composeBytes, dockerfileBytes,
  ] = await Promise.all([
    readJson('docs/operations/g3-authority-binding-reconciliation.r1.json'),
    readJson('docs/operations/g3-rollback-unknown-reconciliation-recovery.r1.json'),
    readJson('docs/operations/g3-schema11-cutover-approved-packet.r2.json'),
    readJson('docs/operations/g3-schema11-terminal-evidence.r1.json'),
    readJson('docs/operations/g3-schema11-terminal-receipt.r1.json'),
    readFile(new URL('docs/operations/g3-schema11-attempt-record.r1.json', ROOT)),
    readFile(new URL('scripts/g3-authority-reconciliation-rollback-executor.py', ROOT)),
    readFile(new URL('scripts/g3-authority-reconciliation-rollback-recovery-terminal-verifier.py', ROOT)),
    readFile(new URL('src/g3-authority-reconciliation-startup-gate-v1.mjs', ROOT)),
    readFile(new URL('src/server.mjs', ROOT)),
    readFile(new URL('src/store.mjs', ROOT)),
    readFile(new URL('compose.yaml', ROOT)),
    readFile(new URL('Dockerfile', ROOT)),
  ]);
  const attempt = JSON.parse(attemptBytes.toString('utf8'));
  const executor = rollbackExecutorBytes.toString('utf8');
  const terminalVerifier = terminalVerifierBytes.toString('utf8');
  const startupGate = startupGateBytes.toString('utf8');
  const server = serverBytes.toString('utf8');
  const store = storeBytes.toString('utf8');
  const compose = composeBytes.toString('utf8');
  const dockerfile = dockerfileBytes.toString('utf8');

  if (record.schemaVersion !== 1
    || record.reconciliationId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_R1'
    || record.status !== 'RECONCILIATION_REQUIRED'
    || record.trigger.approvedAuthorityHead !== EXPECTED.approvedHead
    || record.trigger.executionCanonicalHead !== EXPECTED.executionHead
    || record.trigger.approvedAuthorityTargetDigest !== EXPECTED.originalTarget
    || record.trigger.authorityHeadsMatch !== false
    || packet.authorityTarget.authorityHead !== EXPECTED.approvedHead
    || packet.authorityTargetDigest !== EXPECTED.originalTarget
    || attempt.authorityTargetDigest !== EXPECTED.originalTarget
    || sha256(attemptBytes) !== EXPECTED.originalAttempt
    || record.execution.attemptRecordSha256 !== EXPECTED.originalAttempt
    || receipt.outcome !== 'COMMITTED'
    || terminal.classification.outcome !== 'COMMITTED'
    || record.physicalState.outcome !== 'COMMITTED'
    || record.physicalState.activeDatabaseSha256 !== EXPECTED.activeDb
    || record.preservedPrestate.sha256 !== EXPECTED.prestateDb
    || record.physicalState.migration11Checksum !== EXPECTED.migration11
    || record.governance.g3GovernanceClosureAllowed !== false
    || record.governance.g4Allowed !== false
    || record.governance.normalWriterReadmissionAllowed !== false
    || record.governance.productionServiceStartAllowed !== false) {
    fail('HISTORICAL_RECONCILIATION_FACT_DRIFT');
  }

  if (record.evidenceTrust.repositoryTerminalArtifactsProvideIntegrity !== true
    || record.evidenceTrust.repositoryTerminalArtifactsProvideProductionProvenance !== false
    || record.evidenceTrust.repositoryEvidenceAloneCanAuthorizeReconciliationMutation !== false
    || record.evidenceTrust.freshLiveReadOnlyProductionVerificationRequired !== true
    || record.evidenceTrust.cryptographicProductionAttestationPresent !== false) {
    fail('EVIDENCE_TRUST_DRIFT');
  }

  const incident = recovery.priorUnknownAttempt;
  if (recovery.schemaVersion !== 1
    || recovery.recoveryId !== 'G3_ROLLBACK_UNKNOWN_RECONCILIATION_RECOVERY_R1'
    || recovery.status !== 'RECOVERY_AUTHORITY_SURFACE_FREEZE_CANDIDATE'
    || recovery.productionAuthorityGranted !== false
    || incident.operationId !== EXPECTED.priorRollbackOperation
    || incident.packetId !== EXPECTED.priorRollbackPacket
    || incident.rollbackTargetDigest !== EXPECTED.priorRollbackTarget
    || incident.attemptRecordSha256 !== EXPECTED.priorRollbackAttempt
    || incident.terminalOutcome !== 'UNKNOWN'
    || incident.terminalEvidenceDigest !== EXPECTED.priorRollbackTerminalEvidence
    || incident.automaticRetryAllowed !== false
    || incident.replayIdentityReusable !== false
    || recovery.forensics.failureStage !== 'POST_CLAIM_PRE_EXCHANGE_CANONICAL_AUTHORITY_CHECK'
    || recovery.forensics.failureCode !== 'ROLLBACK_CANONICAL_AUTHORITY_UNAVAILABLE'
    || recovery.forensics.underlyingErrorClass !== 'subprocess.TimeoutExpired'
    || recovery.forensics.executorReportedExchangeMayHaveOccurred !== false
    || recovery.forensics.exchangeObserved !== false
    || recovery.forensics.activeDatabaseMutationObserved !== false
    || recovery.forensics.activeSchema11Sha256 !== EXPECTED.activeDb
    || recovery.forensics.preservedSchema10Sha256 !== EXPECTED.prestateDb
    || recovery.recoverySemantics.sameAttemptRetryAllowed !== false
    || recovery.recoverySemantics.sameReplayIdentityReusable !== false
    || recovery.recoverySemantics.newOperationRequired !== true
    || recovery.recoverySemantics.newExplicitHumanApprovalRequired !== true
    || recovery.recoverySemantics.oldAttemptRecordMutationAllowed !== false
    || recovery.recoverySemantics.recoveryActionIsAutomaticRetry !== false) {
    fail('ROLLBACK_UNKNOWN_RECOVERY_FACT_DRIFT');
  }

  const startup = record.runtimeStartupGate;
  if (startup.status !== 'ENFORCED_BY_AUTHORITY_SURFACE'
    || startup.directProductionServiceStartupBlockedWhileReconciliationRequired !== true
    || startup.composeWriteAdmissionDefault !== 'disabled'
    || startup.composeOrphanCleanupDefault !== 'disabled'
    || startup.callerMayOverrideReconciliationBlock !== false
    || startup.writableScheduleStoreProductionOpenBlocked !== true
    || !startupGate.includes('G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED')
    || !startupGate.includes("record.status === 'RECONCILIATION_REQUIRED'")
    || server.split('assertG3AuthorityReconciliationStartupAllowed({ databasePath });').length - 1 < 2
    || !store.includes('assertG3AuthorityReconciliationStartupAllowed({ databasePath: filename });')
    || !compose.includes('WRITE_ADMISSION_MODE: ${WRITE_ADMISSION_MODE:-disabled}')
    || !compose.includes('ORPHAN_CLEANUP_MODE: ${ORPHAN_CLEANUP_MODE:-disabled}')
    || !dockerfile.includes('g3-authority-binding-reconciliation.r1.json')) {
    fail('STARTUP_GATE_DRIFT');
  }

  const surface = record.rollbackAuthoritySurface;
  const recoverySurface = recovery.recoveryAuthoritySurface;
  if (surface.status !== 'RECOVERY_FREEZE_CANDIDATE_NOT_EXECUTABLE'
    || surface.executorPath !== 'scripts/g3-authority-reconciliation-rollback-executor.py'
    || surface.executorSha256 !== EXPECTED.recoveryExecutor
    || recoverySurface.executorSha256 !== EXPECTED.recoveryExecutor
    || sha256(rollbackExecutorBytes) !== EXPECTED.recoveryExecutor
    || surface.terminalVerifierPath !== 'scripts/g3-authority-reconciliation-rollback-recovery-terminal-verifier.py'
    || surface.terminalVerifierSha256 !== EXPECTED.recoveryVerifier
    || surface.terminalVerifierStatus !== 'DEFINED_READ_ONLY'
    || recoverySurface.terminalVerifierSha256 !== EXPECTED.recoveryVerifier
    || sha256(terminalVerifierBytes) !== EXPECTED.recoveryVerifier
    || surface.actionId !== EXPECTED.recoveryAction
    || surface.operationId !== EXPECTED.recoveryOperation
    || surface.packetId !== EXPECTED.recoveryPacket
    || surface.contractId !== EXPECTED.recoveryContract
    || surface.targetId !== EXPECTED.recoveryTargetId
    || surface.priorUnknownAttemptBindingRequired !== true
    || surface.durableOneShotRequired !== true
    || surface.automaticRetryAllowed !== false
    || surface.authorityAdmissionBoundary !== 'DURABLE_ONE_SHOT_CLAIM'
    || surface.canonicalHeadMustMatchApprovedTargetImmediatelyBeforeClaim !== true
    || surface.freshCanonicalHeadVerificationImmediatelyBeforeClaimRequired !== true
    || surface.postCanonicalPreClaimLocalRevalidationRequired !== true
    || surface.postCanonicalLocalContainmentRevalidationRequired !== true
    || surface.postCanonicalRemoteDependencyAllowed !== false
    || surface.exchangeSyscallResolvedBeforeClaimRequired !== true
    || surface.postClaimDynamicSyscallResolutionAllowed !== false
    || surface.postClaimCanonicalVerificationAllowed !== false
    || surface.postClaimNetworkDependencyAllowed !== false
    || surface.instanceIdentityBoundInClaimRequired !== true
    || surface.postClaimMetadataRequestAllowed !== false
    || surface.exactRecoveryTargetStatus !== 'NOT_CREATED'
    || surface.approvedPacketStatus !== 'NOT_CREATED'
    || surface.approvalRecordStatus !== 'NOT_CREATED'
    || surface.recoveryAuthorized !== false
    || surface.approvalRequestAllowedBeforeExactTargetFreeze !== false
    || surface.packetIdPartitionsReplayIdentity !== false
    || surface.targetFreezeMustBindPostMergeCanonicalHead !== true) {
    fail('RECOVERY_AUTHORITY_SURFACE_DRIFT');
  }

  if (!executor.includes('ACTION_ID = "' + EXPECTED.recoveryAction + '"')
    || !executor.includes('OPERATION_ID = "' + EXPECTED.recoveryOperation + '"')
    || !executor.includes('PACKET_ID = "' + EXPECTED.recoveryPacket + '"')
    || !executor.includes('CONTRACT_ID = "' + EXPECTED.recoveryContract + '"')
    || !executor.includes('PRIOR_UNKNOWN_OPERATION_ID = "' + EXPECTED.priorRollbackOperation + '"')
    || !executor.includes('PRIOR_UNKNOWN_TARGET_DIGEST = "' + EXPECTED.priorRollbackTarget + '"')
    || !executor.includes('PRIOR_UNKNOWN_ATTEMPT_SHA256 = "' + EXPECTED.priorRollbackAttempt + '"')
    || !executor.includes('EXPECTED_TERMINAL_VERIFIER_SHA256 = "' + EXPECTED.recoveryVerifier + '"')
    || !executor.includes('"terminalVerifierSha256"')
    || !executor.includes('target.get("terminalVerifierSha256") != EXPECTED_TERMINAL_VERIFIER_SHA256')
    || !executor.includes('"priorUnknownAttempt"')
    || !executor.includes('"instanceIdAtAdmission"')
    || !executor.includes('verify_prior_unknown_attempt()')
    || !executor.includes('ROLLBACK_ATTEMPT_CLAIM_DURABILITY_UNKNOWN')) {
    fail('RECOVERY_EXECUTOR_BINDING_DRIFT');
  }

  if (!terminalVerifier.includes('TARGET_ID = "G3-AUTH-RECON-ROLLBACK-RECOVERY-TARGET-20261007-R1"')
    || !terminalVerifier.includes('"terminalVerifierSha256"')
    || !terminalVerifier.includes('verifier_sha256()')
    || !terminalVerifier.includes('authorityHeadAtAdmission')
    || !terminalVerifier.includes('instanceIdAtAdmission')
    || !terminalVerifier.includes('DURABLE_RECOVERY_CLAIM')
    || terminalVerifier.includes('git", "ls-remote')
    || terminalVerifier.includes('CANONICAL_REPO_URL')
    || terminalVerifier.includes('INSTANCE_ID_URL')
    || terminalVerifier.includes('urllib.request')
    || terminalVerifier.includes('read_instance_id(')) {
    fail('RECOVERY_TERMINAL_VERIFIER_DRIFT');
  }

  const execute = executor.slice(executor.indexOf('def execute('), executor.indexOf('def self_test_exchange('));
  const preflight = execute.indexOf('verify_active_and_preserved_state()');
  const resolveExchange = execute.indexOf('exchange_fn = resolve_rename_exchange()');
  const finalAuthority = execute.indexOf('verify_canonical_authority_head(expected_authority_head)');
  const localRevalidation = execute.indexOf('verify_post_canonical_local_admission_state()');
  const claim = execute.indexOf('attempt = claim_attempt(');
  const exchange = execute.indexOf('rename_exchange(exchange_fn, ACTIVE_DB, PRESERVED_SCHEMA10)');
  if (preflight < 0 || resolveExchange <= preflight || finalAuthority <= resolveExchange || localRevalidation <= finalAuthority || claim <= localRevalidation || exchange <= claim
    || execute.indexOf('verify_canonical_authority_head(expected_authority_head)', claim) !== -1
    || execute.indexOf('verify_active_and_preserved_state()', claim) !== -1
    || execute.split('rename_exchange(exchange_fn, ACTIVE_DB, PRESERVED_SCHEMA10)').length - 1 !== 1) {
    fail('RECOVERY_ADMISSION_BOUNDARY_ORDER_DRIFT');
  }

  const localAdmission = executor.slice(
    executor.indexOf('def verify_post_canonical_local_admission_state():'),
    executor.indexOf('class AttemptClaimDurabilityUnknown'),
  );
  for (const required of [
    'verify_production_service_absent()',
    'verify_no_running_volume_users()',
    'verify_no_open_db_users()',
  ]) {
    if (!localAdmission.includes(required)) fail('POST_CANONICAL_LOCAL_CONTAINMENT_MISSING:' + required);
  }
  for (const forbidden of [
    'read_current_canonical_head(',
    'read_instance_id(',
    'verify_approval_signature(',
  ]) {
    if (localAdmission.includes(forbidden)) fail('POST_CANONICAL_REMOTE_DEPENDENCY:' + forbidden);
  }

  const executorContainment = executor.slice(
    executor.indexOf('def verify_no_running_volume_users():'),
    executor.indexOf('def verify_no_open_db_users():'),
  );
  if (!executorContainment.includes('mount_identity_for_path(ACTIVE_DB, daemon_mountinfo)')
    || !executorContainment.includes('mount_identity_for_path(PRESERVED_SCHEMA10, daemon_mountinfo)')) {
    fail('RECOVERY_EXECUTOR_DOCKER_CONTAINMENT_INCOMPLETE');
  }

  const verifierContainment = terminalVerifier.slice(
    terminalVerifier.indexOf('def verify_no_running_volume_users():'),
    terminalVerifier.indexOf('def verify_no_open_db_users('),
  );
  if (!verifierContainment.includes('mount_identity_for_path(ACTIVE_DB, daemon_mountinfo)')
    || !verifierContainment.includes('mount_identity_for_path(EXCHANGED_OUT_SCHEMA11, daemon_mountinfo)')) {
    fail('RECOVERY_VERIFIER_DOCKER_CONTAINMENT_INCOMPLETE');
  }

  const postClaim = execute.slice(claim);
  for (const forbidden of [
    'git", "ls-remote',
    'INSTANCE_ID_URL',
    'docker_json(',
    'verify_no_running_volume_users(',
    'verify_no_open_db_users(',
    'verify_approval_signature(',
    'resolve_rename_exchange(',
    'ctypes.CDLL(',
    'getattr(libc',
  ]) {
    if (postClaim.includes(forbidden)) fail('POST_CLAIM_EXTERNAL_DEPENDENCY:' + forbidden);
  }

  const preferred = record.preferredResolution;
  if (preferred.actionId !== EXPECTED.recoveryAction
    || preferred.strategy !== 'NEW_HUMAN_RECONCILED_ROLLBACK_RECOVERY_TO_EXACT_SCHEMA10_THEN_FRESH_FORWARD_G3'
    || preferred.productionMutationRequired !== true
    || preferred.explicitHumanAuthorizationRequired !== true
    || preferred.rollbackTargetSha256 !== EXPECTED.prestateDb
    || preferred.priorRollbackReplayIdentityReusable !== false
    || preferred.recoveryActionIsAutomaticRetry !== false
    || preferred.newOperationIdRequired !== true
    || preferred.newAuthorityTargetDigestRequired !== true
    || preferred.newPreExecutionApprovalRequired !== true
    || preferred.writerReadmissionAfterRollbackAllowed !== false
    || preferred.freshLiveReadOnlyVerificationImmediatelyBeforeRollbackRequired !== true
    || preferred.repositoryEvidenceMaySubstituteForLiveVerification !== false
    || preferred.authoritySurfaceMustMergeBeforeExactTargetFreeze !== true
    || preferred.exactRecoveryTargetMustFreezeBeforeApprovalRequest !== true
    || preferred.exactRecoveryTargetStatus !== 'NOT_CREATED'
    || preferred.recoveryApprovalRequestAllowed !== false
    || preferred.approvalRequestRequiresExactRollbackTargetDigest !== true
    || preferred.targetFreezeMustBindPostMergeCanonicalHead !== true
    || preferred.authorityAdmissionBoundary !== 'DURABLE_ONE_SHOT_CLAIM'
    || preferred.canonicalHeadMustMatchApprovedTargetImmediatelyBeforeClaim !== true
    || preferred.postCanonicalPreClaimLocalRevalidationRequired !== true
    || preferred.postCanonicalLocalContainmentRevalidationRequired !== true
    || preferred.postCanonicalRemoteDependencyAllowed !== false
    || preferred.exchangeSyscallResolvedBeforeClaimRequired !== true
    || preferred.postClaimDynamicSyscallResolutionAllowed !== false
    || preferred.postClaimCanonicalLookupAllowed !== false
    || preferred.postClaimNetworkDependencyAllowed !== false
    || preferred.instanceIdentityBoundInClaimRequired !== true
    || preferred.postClaimMetadataRequestAllowed !== false
    || preferred.nextAction !== 'MERGE_RECOVERY_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_RECOVERY_TARGET') {
    fail('RECOVERY_SEQUENCE_DRIFT');
  }

  const requiredProhibitions = [
    'NO_RETROACTIVE_APPROVAL',
    'NO_G4_ENTRY_BEFORE_RECONCILIATION',
    'NO_NORMAL_WRITER_READMISSION',
    'NO_PRODUCTION_SERVICE_START',
    'NO_RETRY_OF_PRIOR_G3_ATTEMPT',
    'NO_REUSE_OF_PRIOR_ROLLBACK_REPLAY_IDENTITY',
    'NO_MUTATION_OF_PRIOR_ROLLBACK_ATTEMPT_LEDGER',
    'NO_RECONCILIATION_MUTATION_FROM_REPOSITORY_EVIDENCE_ALONE',
    'NO_RECOVERY_APPROVAL_BEFORE_EXACT_TARGET_FREEZE',
    'NO_RECOVERY_WITHOUT_SEPARATE_EXPLICIT_AUTHORIZATION',
    'NO_POST_CLAIM_CANONICAL_NETWORK_LOOKUP',
  ];
  if (JSON.stringify(record.prohibitions) !== JSON.stringify(requiredProhibitions)) {
    fail('PROHIBITIONS_DRIFT');
  }

  console.log(JSON.stringify({
    status: 'G3_AUTHORITY_BINDING_RECONCILIATION_VALID',
    physicalOutcome: 'COMMITTED',
    rollbackTerminalOutcome: 'UNKNOWN',
    authorityAdmissionStatus: 'RECONCILIATION_REQUIRED',
    recoveryAuthoritySurfaceStatus: surface.status,
    recoveryExecutorSha256: surface.executorSha256,
    recoveryTerminalVerifierSha256: surface.terminalVerifierSha256,
    exactRecoveryTargetStatus: surface.exactRecoveryTargetStatus,
    recoveryApprovalRequestAllowed: false,
    productionStartupAllowed: false,
    g4Allowed: false,
    writerReadmissionAllowed: false,
    nextAction: 'MERGE_RECOVERY_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_RECOVERY_TARGET',
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
