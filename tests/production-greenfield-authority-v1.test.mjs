import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';
import { validateProductionGreenfieldAuthority } from '../src/production-greenfield-authority-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const authority = JSON.parse(readFileSync(new URL('../docs/operations/production-greenfield-authority.v1.json', import.meta.url), 'utf8'));
const baseResult = createProductionChangeManifestValidator(schema)(base);

function validate(value, manifest = base, digest = baseResult.digest) {
  return validateProductionGreenfieldAuthority(value, {
    baseManifest: manifest,
    baseManifestDigest: digest,
  });
}

function rejected(mutator, code) {
  const value = structuredClone(authority);
  mutator(value);
  const result = validate(value);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === code), true, JSON.stringify(result.issues));
  assert.equal(Object.hasOwn(result, 'digest'), false);
}

test('greenfield authority binds the existing frozen manifest and grants no production mutation', () => {
  assert.equal(baseResult.ok, true);
  const result = validate(authority);
  assert.equal(result.ok, true);
  assert.equal(authority.deploymentMode, 'GREENFIELD_NO_EXISTING_SOURCE');
  assert.equal(authority.authorization.status, 'FROZEN_NOT_REQUESTED');
  assert.deepEqual(authority.authorization.requestedActionIds, []);
  assert.deepEqual(authority.authorization.approvedActionIds, []);
  assert.deepEqual(authority.authorization.requestableActionIds, []);
  assert.equal(authority.authorization.nextActionId, 'PROD-03-GENERATE-INSTALL-TOKENS');
  assert.equal(authority.authorization.nextActionRequiresExplicitAuthorization, true);
});

test('greenfield authority cannot detach from the exact parent manifest digest', () => {
  rejected(value => { value.baseManifestDigest = 'sha256:' + '0'.repeat(64); }, 'BASE_MANIFEST_DIGEST_INVALID');
  const result = validate(authority, base, 'sha256:' + '1'.repeat(64));
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === 'BASE_MANIFEST_DIGEST_INVALID'), true);
});

test('greenfield authority cannot invent an existing source or another host', () => {
  rejected(value => { value.acceptance.existingProductionSource = 'PRESENT'; }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => { value.target.publicIpv4 = '127.0.0.1'; }, 'GREENFIELD_TARGET_BINDING_INVALID');
  rejected(value => { value.target.instanceId = 'ins-other'; }, 'GREENFIELD_TARGET_BINDING_INVALID');
});

test('greenfield start path cannot smuggle PROD-09 or drop empty-target proof', () => {
  rejected(value => {
    value.greenfieldContainerStartPrerequisites.push('PROD-09-PRODUCTION-DATA-IMPORT');
  }, 'GREENFIELD_CONTAINER_START_CONTRACT_INVALID');
  rejected(value => {
    value.greenfieldContainerStartPrerequisites =
      value.greenfieldContainerStartPrerequisites.filter(id => id !== 'PRODUCTION_IMPORT_TARGET_ABSENCE');
  }, 'GREENFIELD_CONTAINER_START_CONTRACT_INVALID');
});

test('greenfield forward chain cannot require migration import', () => {
  rejected(value => {
    value.greenfieldForwardChain.push('PROD-09-PRODUCTION-DATA-IMPORT');
  }, 'GREENFIELD_FORWARD_CHAIN_INVALID');
});

test('greenfield activation cannot acquire source barriers or restore a previous authority', () => {
  rejected(value => {
    value.greenfieldActivationAction.preconditions.push('CUTOVER_SOURCE_CONSISTENCY');
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
  rejected(value => {
    value.greenfieldActivationAction.rollbackActionIds.push('ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH');
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
});

test('greenfield activation remains exact-target and explicitly authorized', () => {
  rejected(value => {
    value.greenfieldActivationAction.requiresExplicitAuthorization = false;
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
  rejected(value => {
    value.greenfieldActivationAction.authorityTarget = 'all hosts and routes';
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
});

test('greenfield cleanup cannot bypass activation or disable-and-drain recovery', () => {
  rejected(value => {
    value.greenfieldCleanupAction.preconditions =
      value.greenfieldCleanupAction.preconditions.filter(id => id !== 'RESTORED_CLEANUP_DISABLE_CAPABILITY');
  }, 'GREENFIELD_CLEANUP_ACTION_INVALID');
  rejected(value => {
    value.greenfieldCleanupAction.rollbackActionIds = [];
  }, 'GREENFIELD_CLEANUP_ACTION_INVALID');
});

test('greenfield supplement only supersedes base gates that remain blocked', () => {
  const forged = structuredClone(base);
  forged.gates.find(gate => gate.id === 'CUTOVER_SOURCE_CONSISTENCY').status = 'SATISFIED';
  const result = validate(authority, forged, baseResult.digest);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === 'GREENFIELD_BASE_GATE_STATE_INVALID'), true);
});

test('greenfield authority cannot self-authorize the next production action', () => {
  rejected(value => {
    value.authorization.requestableActionIds = ['PROD-03-GENERATE-INSTALL-TOKENS'];
  }, 'GREENFIELD_AUTHORIZATION_STATE_INVALID');
  rejected(value => {
    value.authorization.blanketApprovalAllowed = true;
  }, 'GREENFIELD_AUTHORIZATION_STATE_INVALID');
});
