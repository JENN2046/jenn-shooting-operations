import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [record, recovery] = await Promise.all([
  readJson('docs/operations/g3-authority-binding-reconciliation.r1.json'),
  readJson('docs/operations/g3-rollback-unknown-reconciliation-recovery.r1.json'),
]);
const executorUrl = new URL('scripts/g3-authority-reconciliation-rollback-executor.py', root);
const executorBytes = await readFile(executorUrl);
const executor = executorBytes.toString('utf8');
const executorSha = 'sha256:' + createHash('sha256').update(executorBytes).digest('hex');

test('UNKNOWN rollback is sealed and recovery surface is exact but not executable', async () => {
  assert.equal(record.rollbackUnknownRecovery.priorRollbackTerminalOutcome, 'UNKNOWN');
  assert.equal(record.rollbackUnknownRecovery.priorRollbackReplayIdentityReusable, false);
  assert.equal(recovery.priorUnknownAttempt.automaticRetryAllowed, false);
  assert.equal(recovery.priorUnknownAttempt.replayIdentityReusable, false);

  const surface = record.rollbackAuthoritySurface;
  assert.equal(surface.status, 'RECOVERY_FREEZE_CANDIDATE_NOT_EXECUTABLE');
  assert.equal(surface.executorSha256, executorSha);
  assert.equal(recovery.recoveryAuthoritySurface.executorSha256, executorSha);
  assert.equal(surface.operationId, 'G3-AUTH-RECON-ROLLBACK-RECOVERY-20261007-R1');
  assert.equal(surface.packetId, 'G3-AUTH-RECON-ROLLBACK-RECOVERY-PACKET-20261007-R1');
  assert.equal(surface.targetId, 'G3-AUTH-RECON-ROLLBACK-RECOVERY-TARGET-20261007-R1');
  assert.equal(surface.priorUnknownAttemptBindingRequired, true);
  assert.equal(surface.replayIdentity, 'operationId+rollbackTargetDigest');
  assert.equal(surface.durableOneShotRequired, true);
  assert.equal(surface.automaticRetryAllowed, false);
  assert.equal(surface.authorityAdmissionBoundary, 'DURABLE_ONE_SHOT_CLAIM');
  assert.equal(surface.canonicalHeadMustMatchApprovedTargetImmediatelyBeforeClaim, true);
  assert.equal(surface.postClaimCanonicalVerificationAllowed, false);
  assert.equal(surface.postClaimNetworkDependencyAllowed, false);
  assert.equal(surface.exactRecoveryTargetStatus, 'NOT_CREATED');
  assert.equal(surface.approvedPacketStatus, 'NOT_CREATED');
  assert.equal(surface.approvalRecordStatus, 'NOT_CREATED');
  assert.equal(surface.recoveryAuthorized, false);
  assert.equal(surface.approvalRequestAllowedBeforeExactTargetFreeze, false);

  for (const relative of [
    'docs/operations/g3-authority-binding-rollback-recovery-target.r1.json',
    'docs/operations/g3-authority-binding-rollback-recovery-approved-packet.r1.json',
    'docs/operations/g3-authority-binding-rollback-recovery-approval.r1.json',
  ]) {
    await assert.rejects(access(new URL(relative, root), constants.F_OK));
  }
});

test('recovery target must bind the exact prior UNKNOWN attempt', () => {
  assert.match(executor, /TARGET_ID = "G3-AUTH-RECON-ROLLBACK-RECOVERY-TARGET-20261007-R1"/);
  assert.match(executor, /PRIOR_UNKNOWN_OPERATION_ID = "G3-AUTH-RECON-ROLLBACK-20261007-R1"/);
  assert.match(executor, /PRIOR_UNKNOWN_PACKET_ID = "G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1"/);
  assert.match(executor, /PRIOR_UNKNOWN_TARGET_DIGEST = "sha256:b71d4853/);
  assert.match(executor, /PRIOR_UNKNOWN_ATTEMPT_SHA256 = "sha256:bfd40da5/);
  assert.match(executor, /PRIOR_UNKNOWN_TERMINAL_EVIDENCE_DIGEST = "sha256:7e04e137/);
  assert.match(executor, /"priorUnknownAttempt"/);
  assert.match(executor, /verify_prior_unknown_attempt\(\)/);
  assert.match(executor, /ROLLBACK_PRIOR_UNKNOWN_ATTEMPT_MISMATCH/);
});

test('durable claim is the admission boundary and post-claim path is network-free', () => {
  const body = executor.slice(executor.indexOf('def execute('), executor.indexOf('def self_test_exchange('));
  const preflight = body.indexOf('verify_active_and_preserved_state()');
  const finalAuthority = body.indexOf('verify_canonical_authority_head(expected_authority_head)');
  const claim = body.indexOf('attempt = claim_attempt(target_digest, expected_authority_head)');
  const exchange = body.indexOf('rename_exchange(ACTIVE_DB, PRESERVED_SCHEMA10)');

  assert.ok(preflight >= 0 && finalAuthority > preflight && claim > finalAuthority && exchange > claim);
  assert.equal(body.indexOf('verify_canonical_authority_head(expected_authority_head)', claim), -1);
  assert.equal(body.indexOf('verify_active_and_preserved_state()', claim), -1);
  assert.equal(body.split('rename_exchange(ACTIVE_DB, PRESERVED_SCHEMA10)').length - 1, 1);

  const postClaim = body.slice(claim);
  for (const forbidden of [
    'git", "ls-remote',
    'INSTANCE_ID_URL',
    'docker_json(',
    'verify_no_running_volume_users(',
    'verify_no_open_db_users(',
    'verify_approval_signature(',
  ]) {
    assert.equal(postClaim.includes(forbidden), false, forbidden);
  }
  assert.match(postClaim, /rename_exchange\(ACTIVE_DB, PRESERVED_SCHEMA10\)/);
  assert.match(postClaim, /fsync_dir\(ACTIVE_DB\.parent\)/);
  assert.match(postClaim, /fsync_dir\(PRESERVED_SCHEMA10\.parent\)/);
});

test('claim durability ambiguity is fail-closed and never proceeds to exchange', () => {
  assert.match(executor, /class AttemptClaimDurabilityUnknown/);
  assert.match(executor, /ROLLBACK_ATTEMPT_CLAIM_DURABILITY_UNKNOWN/);
  assert.match(executor, /"claimMayHaveOccurred": True/);
  assert.match(executor, /"exchangeMayHaveOccurred": False/);
  assert.match(executor, /"automaticRetryAllowed": False/);
});

test('rollback recovery executor public self-tests pass without production access', () => {
  const path = executorUrl.pathname;
  const exchange = spawnSync('python3', [path, '--self-test-exchange'], { encoding: 'utf8' });
  assert.equal(exchange.status, 0, exchange.stderr);
  assert.match(exchange.stdout, /G3_RECONCILIATION_ROLLBACK_EXCHANGE_SELF_TEST_PASS/);

  const approval = spawnSync('python3', [path, '--self-test-approval-signature'], { encoding: 'utf8' });
  assert.equal(approval.status, 0, approval.stderr);
  assert.match(approval.stdout, /G3_RECONCILIATION_ROLLBACK_APPROVAL_SELF_TEST_PASS/);

  const authority = spawnSync('python3', [path, '--self-test-authority-head'], { encoding: 'utf8' });
  assert.equal(authority.status, 0, authority.stderr);
  assert.match(authority.stdout, /G3_RECONCILIATION_ROLLBACK_AUTHORITY_HEAD_SELF_TEST_PASS/);

  const missing = spawnSync('python3', [path, '--execute'], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /approved-packet/);
});

test('recovery cannot be requested before the post-merge exact target exists', () => {
  const preferred = record.preferredResolution;
  assert.equal(preferred.authoritySurfaceMustMergeBeforeExactTargetFreeze, true);
  assert.equal(preferred.exactRecoveryTargetMustFreezeBeforeApprovalRequest, true);
  assert.equal(preferred.exactRecoveryTargetStatus, 'NOT_CREATED');
  assert.equal(preferred.recoveryApprovalRequestAllowed, false);
  assert.equal(preferred.approvalRequestRequiresExactRollbackTargetDigest, true);
  assert.equal(preferred.targetFreezeMustBindPostMergeCanonicalHead, true);
  assert.equal(preferred.priorRollbackReplayIdentityReusable, false);
  assert.equal(preferred.recoveryActionIsAutomaticRetry, false);
  assert.equal(preferred.postClaimCanonicalLookupAllowed, false);
  assert.equal(preferred.nextAction,
    'MERGE_RECOVERY_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_RECOVERY_TARGET');
});
