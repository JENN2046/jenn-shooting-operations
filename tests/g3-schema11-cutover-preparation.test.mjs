import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
  const run = spawnSync('python3', [
    new URL('../scripts/g3-schema11-cutover-executor.py', import.meta.url).pathname,
    '--self-test-exchange',
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /G3_RENAME_EXCHANGE_SELF_TEST_PASS/);
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

test('execution boundary freezes physical target and non-Docker drain verification', () => {
  const boundary = record.executionBoundaryEvidence;
  assert.deepEqual(boundary.approvalGate, {
    approvedPacketRequired: true,
    separateApprovalRecordRequired: true,
    arbitraryAuthorityTargetDigestCliAllowed: false,
    approvedPacketMustMatchFrozenPreparation: true,
    approvalSource: 'EXPLICIT_HUMAN_CHAT_AUTHORIZATION',
  });
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
    lsofOpenUsersRequired: 0,
    fuserPidsRequired: 0,
    walRequiredAbsent: true,
    shmRequiredAbsent: true,
    checkedImmediatelyBeforeExchange: true,
  });
});
