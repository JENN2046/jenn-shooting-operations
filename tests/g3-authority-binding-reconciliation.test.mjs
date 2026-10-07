import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

const [record, packet, terminal] = await Promise.all([
  readJson('docs/operations/g3-authority-binding-reconciliation.r1.json'),
  readJson('docs/operations/g3-schema11-cutover-approved-packet.r2.json'),
  readJson('docs/operations/g3-schema11-terminal-evidence.r1.json'),
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

test('preferred repair restores exact Schema10 and requires a fresh operation and approval', () => {
  assert.equal(record.preservedPrestate.exactRollbackSourceAvailable, true);
  assert.equal(record.preferredResolution.rollbackTargetSha256, record.preservedPrestate.sha256);
  assert.equal(record.preferredResolution.oldReplayIdentityReusable, false);
  assert.equal(record.preferredResolution.newOperationIdRequired, true);
  assert.equal(record.preferredResolution.newAuthorityTargetDigestRequired, true);
  assert.equal(record.preferredResolution.newPreExecutionApprovalRequired, true);
  assert.equal(record.preferredResolution.explicitHumanAuthorizationRequired, true);
  assert.equal(record.preferredResolution.writerReadmissionAfterRollbackAllowed, false);
});
