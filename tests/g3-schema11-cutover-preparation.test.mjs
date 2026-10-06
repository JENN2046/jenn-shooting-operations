import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { digestCanonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';
import { digestG3AuthorityTargetV1 } from '../src/g3-schema11-cutover-contract-v1.mjs';

const record = JSON.parse(await readFile(new URL(
  '../docs/operations/g3-schema11-cutover-exact-target.r1.json', import.meta.url), 'utf8'));

const d = (domain, key, value) => digestCanonicalJsonSchedulingV1({ domain, [key]: value });

test('G3 preparation binds all evidence into one exact authority target', () => {
  assert.equal(record.targetBindingDigest,
    d('g3-schema11-target-binding-v1', 'targetBindingEvidence', record.targetBindingEvidence));
  assert.equal(record.activeDatabaseFamilyDigest,
    d('g3-schema11-database-family-v1', 'databaseFamilyEvidence', record.databaseFamilyEvidence));
  assert.equal(record.recoveryReadbackProofDigest,
    d('g3-schema11-recovery-readback-v1', 'recoveryReadbackEvidence', record.recoveryReadbackEvidence));
  assert.equal(record.durableDisableReceiptDigest,
    d('g3-schema11-durable-writer-disable-v1', 'durableDisableEvidence', record.durableDisableEvidence));
  assert.equal(record.drainProofDigest,
    d('g3-schema11-writer-drain-v1', 'drainEvidence', record.drainEvidence));
  assert.equal(record.executionBoundaryProofDigest,
    d('g3-schema11-execution-boundary-v1', 'executionBoundaryEvidence', record.executionBoundaryEvidence));
  assert.equal(record.authorityTargetDigest, digestG3AuthorityTargetV1(record.authorityTarget));
});

test('G3 preparation cannot represent an approval or executable packet', () => {
  assert.equal(record.status, 'AWAITING_EXPLICIT_HUMAN_APPROVAL');
  assert.deepEqual(record.humanApproval, {
    status: 'NOT_REQUESTED',
    humanApprovalRequired: true,
    approvedAuthorityTargetDigest: null,
    approvalRef: null,
    approvalEvidenceDigest: null,
  });
  assert.equal(record.executablePacketStatus, 'NOT_CREATED');
  assert.equal(record.authority.schema11CutoverAuthorized, false);
  assert.equal(record.authority.productionMutationAuthorized, false);
});

test('authority target changes on artifact, prestate, containment or execution drift', () => {
  for (const mutate of [
    value => { value.artifact.imageDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.target.activeDatabaseFamilyDigest = 'sha256:' + '1'.repeat(64); },
    value => { value.prestate.recoveryArtifactDigest = 'sha256:' + '2'.repeat(64); },
    value => { value.writerContainment.drainProofDigest = 'sha256:' + '3'.repeat(64); },
    value => { value.execution.operationId = 'G3-SCHEMA11-OP-DRIFT'; },
  ]) {
    const changed = structuredClone(record.authorityTarget);
    mutate(changed);
    assert.notEqual(digestG3AuthorityTargetV1(changed), record.authorityTargetDigest);
  }
});

test('exact physical executor is pinned and rename-exchange self-test passes', async () => {
  const bytes = await readFile(new URL('../scripts/g3-schema11-cutover-executor.py', import.meta.url));
  assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'),
    record.executionBoundaryEvidence.executorSha256);
  const path = new URL('../scripts/g3-schema11-cutover-executor.py', import.meta.url).pathname;
  const run = spawnSync('python3', [path, '--self-test-exchange'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /G3_RENAME_EXCHANGE_SELF_TEST_PASS/);

  const approval = spawnSync('python3', [path, '--self-test-approval-signature'], { encoding: 'utf8' });
  assert.equal(approval.status, 0, approval.stderr);
  assert.match(approval.stdout, /G3_APPROVAL_SIGNATURE_SELF_TEST_PASS/);

  const mountSource = spawnSync('python3', [path, '--self-test-mount-source'], { encoding: 'utf8' });
  assert.equal(mountSource.status, 0, mountSource.stderr);
  assert.match(mountSource.stdout, /G3_MOUNT_SOURCE_SELF_TEST_PASS/);
});

test('executor requires approved packet/approval and rejects free-form authority digests', async () => {
  const path = new URL('../scripts/g3-schema11-cutover-executor.py', import.meta.url).pathname;
  const bytes = await readFile(path, 'utf8');
  assert.doesNotMatch(bytes, /--authority-target-digest/);
  assert.match(bytes, /--approved-packet/);
  assert.match(bytes, /--approval-record/);
  assert.match(bytes, /--preparation-record/);

  const oldStyle = spawnSync('python3', [
    path,
    '--execute',
    '--authority-target-digest',
    record.authorityTargetDigest,
  ], { encoding: 'utf8' });
  assert.notEqual(oldStyle.status, 0);

  const missingApproval = spawnSync('python3', [path, '--execute'], { encoding: 'utf8' });
  assert.notEqual(missingApproval.status, 0);
  assert.match(missingApproval.stderr, /approved-packet/);
});

test('forged approval JSON cannot self-authorize execution', async () => {
  const executor = new URL('../scripts/g3-schema11-cutover-executor.py', import.meta.url).pathname;
  const root = await mkdtemp(join(tmpdir(), 'g3-forged-approval-'));
  try {
    const approvalCore = {
      schemaVersion: 1,
      approvalId: 'FORGED-APPROVAL',
      approvalSource: 'EXPLICIT_HUMAN_CHAT_AUTHORIZATION',
      approvalRef: 'FORGED-REF',
      approvedActionId: 'G3_SCHEMA11_CUTOVER',
      approvedAuthorityTargetDigest: record.authorityTargetDigest,
      authorizationReceivedBeforeExecution: true,
      schema11CutoverAuthorized: true,
      normalWriterReadmissionAuthorized: false,
      signatureAlgorithm: 'Ed25519',
      signingKeyId: record.executionBoundaryEvidence.approvalGate.signingKeyId,
    };
    const approvalEvidenceDigest = digestCanonicalJsonSchedulingV1({
      domain: 'g3-schema11-human-approval-v1',
      approval: approvalCore,
    });
    const approval = {
      ...approvalCore,
      approvalEvidenceDigest,
      signatureBase64: Buffer.alloc(64).toString('base64'),
    };
    const packet = {
      schemaVersion: 1,
      packetId: record.proposedPacketId,
      contractId: 'G2_MINIMAL_RELEASE_CONTRACT_V1',
      authorityTarget: record.authorityTarget,
      authorityTargetDigest: record.authorityTargetDigest,
      authorization: {
        status: 'APPROVED',
        humanApprovalRequired: true,
        approvalRef: approval.approvalRef,
        approvedAuthorityTargetDigest: record.authorityTargetDigest,
        approvalEvidenceDigest,
      },
    };
    const preparationPath = join(root, 'preparation.json');
    const packetPath = join(root, 'packet.json');
    const approvalPath = join(root, 'approval.json');
    await writeFile(preparationPath, JSON.stringify(record));
    await writeFile(packetPath, JSON.stringify(packet));
    await writeFile(approvalPath, JSON.stringify(approval));
    const run = spawnSync('python3', [executor, '--execute',
      '--approved-packet', packetPath,
      '--approval-record', approvalPath,
      '--preparation-record', preparationPath,
    ], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /G3_APPROVAL_SIGNATURE_NOT_TRUSTED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('migration-user workdir access is proven before the one-shot claim', async () => {
  const source = await readFile(new URL('../scripts/g3-schema11-cutover-executor.py', import.meta.url), 'utf8');
  const preflight = source.indexOf('verify_migration_user_workdir_access()');
  const claim = source.indexOf('attempt = claim_attempt(authority_target_digest)');
  assert.ok(preflight >= 0 && claim > preflight);
  assert.match(source, /os\.chown\(workdir, MIGRATION_UID, MIGRATION_GID\)/);
  assert.match(source, /os\.chmod\(workdir, 0o750\)/);
  assert.match(source, /os\.chown\(candidate, MIGRATION_UID, MIGRATION_GID\)/);
  assert.match(source, /os\.chmod\(candidate, 0o600\)/);
});

test('execution boundary freezes physical target and non-Docker drain verification', () => {
  const boundary = record.executionBoundaryEvidence;
  assert.deepEqual(boundary.approvalGate, {
    approvedPacketRequired: true,
    separateApprovalRecordRequired: true,
    arbitraryAuthorityTargetDigestCliAllowed: false,
    approvedPacketMustMatchFrozenPreparation: true,
    approvalSource: 'EXPLICIT_HUMAN_CHAT_AUTHORIZATION',
    cryptographicApprovalRequired: true,
    signatureAlgorithm: 'Ed25519',
    signingKeyId: 'sha256:0d9c964a35c05842b5aafbe261fb5e020427ad5c635357e6955201da56100bae',
  });
  assert.equal(boundary.candidateIsolation.migrationUid, 1000);
  assert.equal(boundary.candidateIsolation.migrationGid, 1000);
  assert.equal(boundary.candidateIsolation.preclaimWorkdirWriteProbeRequired, true);
  assert.equal(boundary.candidateIsolation.workdirMode, '0750');
  assert.equal(boundary.candidateIsolation.candidateMode, '0600');
  assert.deepEqual(boundary.targetRuntimeVerification, {
    hostname: 'VM-0-12-ubuntu',
    instanceIdMetadataEndpoint: 'http://169.254.0.23/latest/meta-data/instance-id',
    instanceId: 'ins-mi85f3my',
    filesystemSource: '/dev/vdb',
    filesystemType: 'ext4',
    activeFileIdentityExact: true,
    requiresRootPrivileges: true,
  });
  assert.deepEqual(boundary.finalDrainVerification, {
    dockerVolumeUsersRequired: 0,
    dockerMountSourceAncestryChecked: true,
    lsofOpenUsersRequired: 0,
    fuserPidsRequired: 0,
    walRequiredAbsent: true,
    shmRequiredAbsent: true,
    checkedImmediatelyBeforeExchange: true,
  });
});
