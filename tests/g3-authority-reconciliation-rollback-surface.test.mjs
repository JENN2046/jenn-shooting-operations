import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const record = JSON.parse(await readFile(new URL(
  'docs/operations/g3-authority-binding-reconciliation.r1.json', root), 'utf8'));
const executorUrl = new URL('scripts/g3-authority-reconciliation-rollback-executor.py', root);
const executorBytes = await readFile(executorUrl);
const executor = executorBytes.toString('utf8');

test('rollback authority surface is exact but not executable yet', async () => {
  const surface = record.rollbackAuthoritySurface;
  assert.equal(surface.status, 'DEFINED_NOT_EXECUTABLE');
  assert.equal(surface.executorSha256,
    'sha256:' + createHash('sha256').update(executorBytes).digest('hex'));
  assert.equal(surface.operationId, 'G3-AUTH-RECON-ROLLBACK-20261007-R1');
  assert.equal(surface.packetId, 'G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1');
  assert.equal(surface.replayIdentity, 'operationId+rollbackTargetDigest');
  assert.equal(surface.durableOneShotRequired, true);
  assert.equal(surface.automaticRetryAllowed, false);
  assert.equal(surface.packetIdPartitionsReplayIdentity, false);
  assert.equal(surface.targetFreezeMustBindPostMergeCanonicalHead, true);
  assert.equal(surface.canonicalHeadMustRemainUnchangedThroughExecution, true);
  assert.equal(surface.freshCanonicalHeadVerificationImmediatelyBeforeExecutionRequired, true);
  assert.equal(surface.exactRollbackTargetStatus, 'NOT_CREATED');
  assert.equal(surface.approvedPacketStatus, 'NOT_CREATED');
  assert.equal(surface.approvalRecordStatus, 'NOT_CREATED');
  assert.equal(surface.rollbackAuthorized, false);
  assert.equal(surface.approvalRequestAllowedBeforeExactTargetFreeze, false);

  for (const relative of [
    'docs/operations/g3-authority-binding-rollback-target.r1.json',
    'docs/operations/g3-authority-binding-rollback-approved-packet.r1.json',
    'docs/operations/g3-authority-binding-rollback-approval.r1.json',
  ]) {
    await assert.rejects(access(new URL(relative, root), constants.F_OK));
  }
});

test('rollback executor requires signed exact target and has an independent one-shot claim', () => {
  assert.doesNotMatch(executor, /--rollback-target-digest/);
  assert.match(executor, /--approved-packet/);
  assert.match(executor, /--approval-record/);
  assert.match(executor, /--target-record/);
  assert.match(executor, /CONTROL_ROOT = Path\("\/mnt\/datadisk0\/g3-authority-binding-reconciliation\/rollback"\)/);
  assert.match(executor, /OPERATION_ID = "G3-AUTH-RECON-ROLLBACK-20261007-R1"/);
  assert.match(executor, /CANONICAL_BRANCH = "codex\/v2-1-architecture-freeze"/);
  assert.match(executor, /git", "ls-remote"/);
  assert.match(executor, /ROLLBACK_CANONICAL_AUTHORITY_HEAD_MISMATCH/);

  const body = executor.slice(executor.indexOf('def execute('));
  const firstVerify = body.indexOf('verify_active_and_preserved_state(expected_authority_head)');
  const claim = body.indexOf('attempt = claim_attempt(target_digest)');
  const secondVerify = body.indexOf(
    'verify_active_and_preserved_state(expected_authority_head)', firstVerify + 1,
  );
  const finalAuthorityVerify = body.indexOf(
    'verify_canonical_authority_head(expected_authority_head)', secondVerify + 1,
  );
  const exchange = body.indexOf('rename_exchange(ACTIVE_DB, PRESERVED_SCHEMA10)');
  assert.ok(firstVerify >= 0
    && claim > firstVerify
    && secondVerify > claim
    && finalAuthorityVerify > secondVerify
    && exchange > finalAuthorityVerify);
  assert.equal(body.split('rename_exchange(ACTIVE_DB, PRESERVED_SCHEMA10)').length - 1, 1);
  assert.match(body, /automaticRetryAllowed": False/);
  assert.match(body, /writerReadmissionAuthorized": False/);
});

test('rollback executor public self-tests pass without production access', () => {
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

test('rollback approval cannot be requested before the post-merge exact target exists', () => {
  const preferred = record.preferredResolution;
  assert.equal(preferred.authoritySurfaceMustMergeBeforeExactTargetFreeze, true);
  assert.equal(preferred.exactRollbackTargetMustFreezeBeforeApprovalRequest, true);
  assert.equal(preferred.exactRollbackTargetStatus, 'NOT_CREATED');
  assert.equal(preferred.rollbackApprovalRequestAllowed, false);
  assert.equal(preferred.approvalRequestRequiresExactRollbackTargetDigest, true);
  assert.equal(preferred.targetFreezeMustBindPostMergeCanonicalHead, true);
  assert.equal(preferred.canonicalHeadMustRemainUnchangedThroughExecution, true);
  assert.equal(preferred.freshCanonicalHeadVerificationImmediatelyBeforeRollbackRequired, true);
  assert.equal(preferred.nextAction,
    'MERGE_RECONCILIATION_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_ROLLBACK_TARGET');
});
