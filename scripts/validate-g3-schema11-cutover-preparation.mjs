import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';
import { digestCanonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';
import { digestG3AuthorityTargetV1 } from '../src/g3-schema11-cutover-contract-v1.mjs';

const RECORD_URL = new URL('../docs/operations/g3-schema11-cutover-exact-target.r1.json', import.meta.url);
const PACKET_SCHEMA_URL = new URL('../contracts/g3-schema11-cutover-packet.v1.schema.json', import.meta.url);
const EXECUTOR_URL = new URL('./g3-schema11-cutover-executor.py', import.meta.url);

const fail = code => {
  console.error(JSON.stringify({ status: 'G3_SCHEMA11_CUTOVER_PREPARATION_INVALID', code }));
  process.exit(1);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = (domain, key, value) => digestCanonicalJsonSchedulingV1({ domain, [key]: value });

try {
  const [recordBytes, packetSchemaBytes, executorBytes] = await Promise.all([
    readFile(RECORD_URL), readFile(PACKET_SCHEMA_URL), readFile(EXECUTOR_URL),
  ]);
  const record = JSON.parse(recordBytes);
  const packetSchema = JSON.parse(packetSchemaBytes);

  const migration = MIGRATIONS.find(item => item.version === 11);
  if (!migration
    || migration.name !== 'business_calendar_and_reschedule'
    || migration.checksum !== 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8') {
    fail('MIGRATION11_IDENTITY_DRIFT');
  }

  const targetBindingDigest = digest('g3-schema11-target-binding-v1',
    'targetBindingEvidence', record.targetBindingEvidence);
  const activeDatabaseFamilyDigest = digest('g3-schema11-database-family-v1',
    'databaseFamilyEvidence', record.databaseFamilyEvidence);
  const recoveryReadbackProofDigest = digest('g3-schema11-recovery-readback-v1',
    'recoveryReadbackEvidence', record.recoveryReadbackEvidence);
  const durableDisableReceiptDigest = digest('g3-schema11-durable-writer-disable-v1',
    'durableDisableEvidence', record.durableDisableEvidence);
  const drainProofDigest = digest('g3-schema11-writer-drain-v1',
    'drainEvidence', record.drainEvidence);
  const executionBoundaryProofDigest = digest('g3-schema11-execution-boundary-v1',
    'executionBoundaryEvidence', record.executionBoundaryEvidence);

  const expectedAuthorityTarget = {
    authorityHead: record.authority.authorityHead,
    artifact: {
      sourceCommit: '6334e2ae851247cb1558074fbd80cfee06b28c11',
      imageDigest: 'sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144',
      migrationVersion: 11,
      migrationName: migration.name,
      migrationChecksum: migration.checksum,
    },
    target: { targetBindingDigest, activeDatabaseFamilyDigest },
    prestate: {
      capturedAt: '2026-10-06T10:28:00Z',
      recoveryArtifactDigest: 'sha256:f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef',
      recoveryReadbackProofDigest,
      recoveryReadbackVerified: true,
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      capturedDatabaseFamilyDigest: activeDatabaseFamilyDigest,
      recoverySourceDatabaseFamilyDigest: activeDatabaseFamilyDigest,
    },
    writerContainment: {
      durableDisableReceiptDigest,
      inFlightWriterCount: 0,
      drainProofDigest,
      processLifetimeIsAuthority: false,
      executionBoundaryProofDigest,
      unknownExecutorHasAuthoritativeWriteCapability: false,
      nonDatabaseProductionMutationAllowed: false,
    },
    execution: {
      entrypointId: 'G3_SCHEMA11_CUTOVER',
      operationId: 'G3-SCHEMA11-OP-20261006-R1',
      automaticRetryAllowed: false,
    },
  };
  const authorityTargetDigest = digestG3AuthorityTargetV1(expectedAuthorityTarget);
  const executorDigest = 'sha256:' + createHash('sha256').update(executorBytes).digest('hex');
  const executorText = executorBytes.toString('utf8');

  const t = record.targetBindingEvidence;
  const f = record.databaseFamilyEvidence;
  const rr = record.recoveryReadbackEvidence;
  const dd = record.durableDisableEvidence;
  const dr = record.drainEvidence;
  const eb = record.executionBoundaryEvidence;
  const ha = record.humanApproval;

  if (record.schemaVersion !== 1
    || record.preparationId !== 'G3_SCHEMA11_CUTOVER_EXACT_TARGET_R1'
    || record.status !== 'AWAITING_EXPLICIT_HUMAN_APPROVAL'
    || record.authority.canonicalBranch !== 'codex/v2-1-architecture-freeze'
    || record.authority.authorityHead !== 'a4199fdb14808ebb866943148a222b0d4300d66e'
    || record.authority.productionMutationAuthorized !== false
    || record.authority.schema11CutoverAuthorized !== false
    || record.proposedPacketId !== 'G3-SCHEMA11-CUTOVER-20261006-R1'
    || record.targetBindingDigest !== targetBindingDigest
    || record.activeDatabaseFamilyDigest !== activeDatabaseFamilyDigest
    || record.recoveryReadbackProofDigest !== recoveryReadbackProofDigest
    || record.durableDisableReceiptDigest !== durableDisableReceiptDigest
    || record.drainProofDigest !== drainProofDigest
    || record.executionBoundaryProofDigest !== executionBoundaryProofDigest
    || !same(record.authorityTarget, expectedAuthorityTarget)
    || record.authorityTargetDigest !== authorityTargetDigest
    || executorDigest !== eb.executorSha256
    || t.provider !== 'TENCENT_CLOUD_CVM'
    || t.instanceId !== 'ins-mi85f3my'
    || t.hostname !== 'VM-0-12-ubuntu'
    || t.productionServiceContainerPresent !== false
    || t.dataVolumeName !== 'jenn-shooting-operations_shooting_data'
    || t.filesystem?.source !== '/dev/vdb' || t.filesystem?.type !== 'ext4'
    || t.activeFileIdentity?.size !== 512000
    || t.activeFileIdentity?.device !== 64784
    || t.activeFileIdentity?.inode !== 1835048
    || f.main?.sha256 !== 'sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7'
    || f.main?.size !== 512000 || f.wal !== null || f.shm !== null
    || f.schemaVersion !== 10 || f.migrationCount !== 10 || f.migration11Count !== 0
    || rr.recoveryArtifactDigest !== expectedAuthorityTarget.prestate.recoveryArtifactDigest
    || rr.sourceDatabaseFamilyDigest !== activeDatabaseFamilyDigest
    || rr.readbackMain?.sha256 !== f.main.sha256 || rr.readbackMain?.size !== f.main.size
    || rr.restoredSchemaVersion !== 10 || rr.migration11Count !== 0
    || rr.integrityCheck !== 'ok' || rr.foreignKeyViolationCount !== 0
    || rr.byteReadbackVerified !== true
    || dd.productionServiceContainerPresent !== false
    || dd.runningContainersUsingProductionVolume !== 0
    || dd.managedSystemdServicePresent !== false
    || dd.normalWritersBlocked !== true || dd.orphanCleanupBlocked !== true
    || dd.processLifetimeIsAuthority !== false
    || dr.runningContainersUsingProductionVolume !== 0
    || dr.openDatabaseFileUsers !== 0 || dr.fuserDatabasePids !== 0
    || dr.walPresent !== false || dr.shmPresent !== false
    || dr.stableMainSha256AcrossSamples !== true
    || dr.sample1MainSha256 !== f.main.sha256 || dr.sample2MainSha256 !== f.main.sha256
    || eb.boundaryId !== 'G3_SCHEMA11_ATOMIC_EXCHANGE_R1'
    || eb.executorPath !== 'scripts/g3-schema11-cutover-executor.py'
    || eb.imageArchiveSha256 !== 'sha256:7e6e707d11fab6c317851ad21fbc1a4ccdde0ff1dda4d6dba7535b3b37303dff'
    || eb.imageArchiveSize !== 63533056
    || eb.exactImageDigest !== expectedAuthorityTarget.artifact.imageDigest
    || eb.exactImageSourceCommit !== expectedAuthorityTarget.artifact.sourceCommit
    || eb.artifactStagedOnProduction !== true
    || eb.platform?.kernel !== '6.8.0-101-generic'
    || eb.platform?.architecture !== 'x86_64'
    || eb.platform?.filesystemType !== 'ext4'
    || eb.platform?.renameat2SymbolAvailable !== true
    || eb.candidateIsolation?.migrationRunsAgainstActiveDatabase !== false
    || eb.candidateIsolation?.candidateDirectoryOnlyRwMount !== true
    || eb.candidateIsolation?.activeDatabaseMountedIntoMigrationContainer !== false
    || eb.candidateIsolation?.networkMode !== 'none'
    || eb.candidateIsolation?.rootFilesystemReadOnly !== true
    || eb.candidateIsolation?.capDropAll !== true
    || eb.candidateIsolation?.noNewPrivileges !== true
    || eb.candidateIsolation?.migrationUid !== 1000
    || eb.candidateIsolation?.migrationGid !== 1000
    || eb.candidateIsolation?.preclaimWorkdirWriteProbeRequired !== true
    || eb.candidateIsolation?.workdirMode !== '0750'
    || eb.candidateIsolation?.candidateMode !== '0600'
    || eb.candidateMigrationVerification?.localSyntheticPass !== true
    || eb.candidateMigrationVerification?.sourceSchemaVersion !== 10
    || eb.candidateMigrationVerification?.targetSchemaVersion !== 11
    || eb.candidateMigrationVerification?.migrationChecksum !== migration.checksum
    || eb.candidateMigrationVerification?.integrityCheck !== 'ok'
    || eb.candidateMigrationVerification?.foreignKeyViolationCount !== 0
    || eb.candidateMigrationVerification?.journalMode !== 'delete'
    || eb.finalSwitch?.syscall !== 'renameat2' || eb.finalSwitch?.flag !== 'RENAME_EXCHANGE'
    || eb.finalSwitch?.sameFilesystemRequired !== true
    || eb.finalSwitch?.activeDatabaseWritesBeforeExchange !== false
    || eb.finalSwitch?.automaticRollbackAllowed !== false
    || eb.finalSwitch?.postExchangeActiveDatabaseWriteAllowed !== false
    || eb.finalSwitch?.independentTerminalVerificationRequired !== true
    || eb.attemptLedger?.durableOneShotRequired !== true
    || eb.attemptLedger?.claimBeforeCandidateMutation !== true
    || eb.attemptLedger?.replayIdentity !== 'operationId+authorityTargetDigest'
    || eb.attemptLedger?.packetIdPartitionsReplayIdentity !== false
    || eb.attemptLedger?.automaticRetryAllowed !== false
    || eb.approvalGate?.approvedPacketRequired !== true
    || eb.approvalGate?.separateApprovalRecordRequired !== true
    || eb.approvalGate?.arbitraryAuthorityTargetDigestCliAllowed !== false
    || eb.approvalGate?.approvedPacketMustMatchFrozenPreparation !== true
    || eb.approvalGate?.approvalSource !== 'EXPLICIT_HUMAN_CHAT_AUTHORIZATION'
    || eb.approvalGate?.cryptographicApprovalRequired !== true
    || eb.approvalGate?.signatureAlgorithm !== 'Ed25519'
    || eb.approvalGate?.signingKeyId !== 'sha256:0d9c964a35c05842b5aafbe261fb5e020427ad5c635357e6955201da56100bae'
    || eb.targetRuntimeVerification?.hostname !== 'VM-0-12-ubuntu'
    || eb.targetRuntimeVerification?.instanceIdMetadataEndpoint !== 'http://169.254.0.23/latest/meta-data/instance-id'
    || eb.targetRuntimeVerification?.instanceId !== 'ins-mi85f3my'
    || eb.targetRuntimeVerification?.filesystemSource !== '/dev/vdb'
    || eb.targetRuntimeVerification?.filesystemType !== 'ext4'
    || eb.targetRuntimeVerification?.activeFileIdentityExact !== true
    || eb.targetRuntimeVerification?.requiresRootPrivileges !== true
    || eb.finalDrainVerification?.dockerVolumeUsersRequired !== 0
    || eb.finalDrainVerification?.dockerMountSourceAncestryChecked !== true
    || eb.finalDrainVerification?.lsofOpenUsersRequired !== 0
    || eb.finalDrainVerification?.fuserPidsRequired !== 0
    || eb.finalDrainVerification?.walRequiredAbsent !== true
    || eb.finalDrainVerification?.shmRequiredAbsent !== true
    || eb.finalDrainVerification?.checkedImmediatelyBeforeExchange !== true
    || executorText.includes('--authority-target-digest')
    || !executorText.includes('--approved-packet')
    || !executorText.includes('--approval-record')
    || !executorText.includes('--preparation-record')
    || !executorText.includes('verify_physical_target()')
    || !executorText.includes('verify_no_open_db_users()')
    || !executorText.includes('verify_approval_signature(')
    || !executorText.includes('verify_migration_user_workdir_access()')
    || ha.status !== 'NOT_REQUESTED' || ha.humanApprovalRequired !== true
    || ha.approvedAuthorityTargetDigest !== null || ha.approvalRef !== null
    || ha.approvalEvidenceDigest !== null
    || record.executablePacketStatus !== 'NOT_CREATED'
    || record.terminalOutcomeStatus !== 'NOT_STARTED') {
    fail('SEMANTIC_INVARIANT_FAILED');
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validatePacket = ajv.compile(packetSchema);
  const shapeProbe = {
    schemaVersion: 1,
    packetId: record.proposedPacketId,
    contractId: 'G2_MINIMAL_RELEASE_CONTRACT_V1',
    authorityTarget: record.authorityTarget,
    authorityTargetDigest: record.authorityTargetDigest,
    authorization: {
      status: 'APPROVED',
      humanApprovalRequired: true,
      approvalRef: 'SHAPE_PROBE_ONLY',
      approvedAuthorityTargetDigest: record.authorityTargetDigest,
      approvalEvidenceDigest: 'sha256:' + '0'.repeat(64),
    },
  };
  if (!validatePacket(shapeProbe)) fail('AUTHORITY_TARGET_PACKET_SHAPE_INVALID');

  const executorPath = new URL(EXECUTOR_URL).pathname;
  const selfTest = spawnSync('python3', [executorPath, '--self-test-exchange'], { encoding: 'utf8' });
  if (selfTest.status !== 0 || !selfTest.stdout.includes('G3_RENAME_EXCHANGE_SELF_TEST_PASS')) {
    fail('EXECUTION_BOUNDARY_SELF_TEST_FAILED');
  }
  const approvalSelfTest = spawnSync('python3', [executorPath, '--self-test-approval-signature'],
    { encoding: 'utf8' });
  if (approvalSelfTest.status !== 0
    || !approvalSelfTest.stdout.includes('G3_APPROVAL_SIGNATURE_SELF_TEST_PASS')) {
    fail('APPROVAL_SIGNATURE_SELF_TEST_FAILED');
  }
  const mountSourceSelfTest = spawnSync('python3', [executorPath, '--self-test-mount-source'],
    { encoding: 'utf8' });
  if (mountSourceSelfTest.status !== 0
    || !mountSourceSelfTest.stdout.includes('G3_MOUNT_SOURCE_SELF_TEST_PASS')) {
    fail('DOCKER_MOUNT_SOURCE_SELF_TEST_FAILED');
  }

  console.log(JSON.stringify({
    status: 'G3_SCHEMA11_CUTOVER_PREPARATION_VALID',
    authorityTargetDigest,
    targetBindingDigest,
    activeDatabaseFamilyDigest,
    recoveryReadbackProofDigest,
    durableDisableReceiptDigest,
    drainProofDigest,
    executionBoundaryProofDigest,
    executorDigest,
    humanApprovalStatus: 'NOT_REQUESTED',
    executablePacketStatus: 'NOT_CREATED',
    schema11CutoverAuthorized: false,
  }));
} catch (error) {
  if (!process.exitCode) {
    console.error(JSON.stringify({
      status: 'G3_SCHEMA11_CUTOVER_PREPARATION_INVALID',
      code: 'SOURCE_OR_VALIDATOR_ERROR',
      errorClass: error?.constructor?.name ?? 'Error',
    }));
    process.exit(1);
  }
}
