import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';
import { validateProductionGreenfieldAuthority } from '../src/production-greenfield-authority-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const authority = JSON.parse(readFileSync(new URL('../docs/operations/production-greenfield-authority.v1.json', import.meta.url), 'utf8'));
const baseResult = createProductionChangeManifestValidator(schema)(base);

function validate(value, manifest = base) {
  return validateProductionGreenfieldAuthority(value, { baseManifest: manifest });
}

function rejected(mutator, code) {
  const value = structuredClone(authority);
  mutator(value);
  const result = validate(value);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === code), true, JSON.stringify(result.issues));
  assert.equal(Object.hasOwn(result, 'digest'), false);
}

test('greenfield authority binds the frozen parent and grants no production mutation', () => {
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

test('greenfield authority derives the parent digest from the supplied manifest', () => {
  rejected(value => {
    value.baseManifestDigest = 'sha256:' + '0'.repeat(64);
  }, 'BASE_MANIFEST_DIGEST_INVALID');

  const tamperedBase = structuredClone(base);
  tamperedBase.actions.find(action => action.id === 'PROD-09-PRODUCTION-DATA-IMPORT').title =
    'Tampered import contract';
  const result = validate(authority, tamperedBase);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === 'BASE_MANIFEST_DIGEST_INVALID'), true);
  assert.equal(Object.hasOwn(result, 'digest'), false);
});

test('greenfield authority rejects undeclared top-level fields', () => {
  rejected(value => {
    value.alternateActions = ['PROD-09-PRODUCTION-DATA-IMPORT'];
  }, 'GREENFIELD_TOP_LEVEL_KEYS_INVALID');
});

test('greenfield authority rejects malformed base-manifest entries without throwing', () => {
  for (const manifest of [
    { ...structuredClone(base), gates: [null] },
    { ...structuredClone(base), actions: [null] },
    {
      ...structuredClone(base),
      authorizationPacket: {
        ...structuredClone(base.authorizationPacket),
        requestedActionIds: null,
      },
    },
  ]) {
    const result = validate(authority, manifest);
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some(issue => issue.code === 'BASE_MANIFEST_SCHEMA_INVALID'),
      true,
      JSON.stringify(result.issues),
    );
    assert.equal(Object.hasOwn(result, 'digest'), false);
  }
});

test('greenfield authority rejects malformed nested shapes without throwing', () => {
  for (const mutate of [
    value => { value.greenfieldForwardChain = null; },
    value => { value.greenfieldActivationAction = null; },
    value => { value.greenfieldPreActivationWriteFence = null; },
    value => { value.authorization.requestableActionIds = null; },
  ]) {
    const candidate = structuredClone(authority);
    mutate(candidate);
    const result = validate(candidate);
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some(issue => issue.code === 'GREENFIELD_SCHEMA_INVALID'),
      true,
      JSON.stringify(result.issues),
    );
    assert.equal(Object.hasOwn(result, 'digest'), false);
  }
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

test('pre-activation forward chain contains no write-capable integrations', () => {
  assert.equal(authority.greenfieldForwardChain.includes('PROD-10-ENABLE-VCP-REMOTE-SYNC'), false);
  assert.equal(authority.greenfieldForwardChain.includes('PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE'), false);
  assert.deepEqual(
    [...authority.postActivationIntegrationActionIds].sort(),
    ['PROD-10-ENABLE-VCP-REMOTE-SYNC', 'PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE'].sort(),
  );
  assert.equal(
    authority.greenfieldIntegrationPrerequisites.includes('GREENFIELD_ACTIVATION_COMPLETION'),
    true,
  );

  rejected(value => {
    value.greenfieldForwardChain.push('PROD-10-ENABLE-VCP-REMOTE-SYNC');
  }, 'GREENFIELD_FORWARD_CHAIN_INVALID');
  rejected(value => {
    value.greenfieldIntegrationPrerequisites =
      value.greenfieldIntegrationPrerequisites.filter(id => id !== 'GREENFIELD_ACTIVATION_COMPLETION');
  }, 'GREENFIELD_INTEGRATION_PREREQUISITES_INVALID');
});

test('conditional firewall action uses the actual base action id', () => {
  assert.deepEqual(
    authority.greenfieldConditionalActionIds,
    ['PROD-08-FIREWALL-SECURITY-GROUP'],
  );
  rejected(value => {
    value.greenfieldConditionalActionIds = ['PROD-08-FIREWALL-SECURITY-GROUP_IF_USED'];
  }, 'GREENFIELD_CONDITIONAL_ACTION_SET_INVALID');
});

test('pre-activation writer fence denies staging, admin, API, background and direct-storage writers', () => {
  const fence = authority.greenfieldPreActivationWriteFence;
  assert.equal(fence.runtimeEnvironmentVariable, 'WRITE_ADMISSION_MODE');
  assert.equal(fence.runtimeEnvironmentValue, 'disabled');
  assert.deepEqual(
    [...fence.coveredWriterClasses].sort(),
    [
      'STAGING_PRINCIPAL',
      'ADMIN_PRINCIPAL',
      'API_WRITE_ENDPOINTS',
      'BACKGROUND_WRITER',
      'DIRECT_STORAGE_BYPASS_WRITER',
    ].sort(),
  );
  for (const requirement of [
    'ALL_HTTP_WRITES_REJECTED_BEFORE_STORE_DISPATCH',
    'V1_DIRECT_STORE_MUTATIONS_REJECTED',
    'PROD_07_STAGING_WRITES_FORBIDDEN_ON_GREENFIELD_PATH',
    'ORPHAN_CLEANUP_DISABLED_AND_DRAINED',
    'BACKGROUND_WRITER_INVENTORY_ZERO',
    'UNCONTROLLED_DIRECT_STORAGE_WRITER_INVENTORY_ZERO',
    'NO_OTHER_CONTAINER_MOUNTS_TARGET_VOLUME',
    'EMPTY_TARGET_SCHEMA_BOOTSTRAP_BEFORE_LISTEN_ONLY',
    'CLEANUP_ENABLE_FORBIDDEN_WHILE_WRITE_ADMISSION_DISABLED',
    'NO_CONTAINER_RESTART_FOR_ADMISSION_ENABLE',
    'ATOMIC_IN_PROCESS_ADMISSION_ENABLE_AFTER_VERIFICATION',
  ]) {
    assert.equal(fence.requirements.includes(requirement), true, requirement);
  }
  assert.equal(
    fence.activationTransition,
    'SIGUSR2_IN_PROCESS_WRITE_ADMISSION_ENABLE',
  );
  for (const proof of [
    'CLEANUP_ENABLE_DENIAL_PROOF',
    'SAME_PROCESS_ADMISSION_TRANSITION_PROOF',
    'WRITE_ADMISSION_ENABLE_RECEIPT',
  ]) {
    assert.equal(fence.evidenceRequired.includes(proof), true, proof);
  }
  rejected(value => {
    value.greenfieldPreActivationWriteFence.runtimeMode = 'enabled';
  }, 'GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_INVALID');
  rejected(value => {
    value.greenfieldPreActivationWriteFence.requirements =
      value.greenfieldPreActivationWriteFence.requirements
        .filter(id => id !== 'PROD_07_STAGING_WRITES_FORBIDDEN_ON_GREENFIELD_PATH');
  }, 'GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_INVALID');
});

test('greenfield activation cannot acquire source barriers or integration rollback authority', () => {
  rejected(value => {
    value.greenfieldActivationAction.preconditions.push('CUTOVER_SOURCE_CONSISTENCY');
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
  rejected(value => {
    value.greenfieldActivationAction.rollbackActionIds.push('ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH');
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
  rejected(value => {
    value.greenfieldActivationAction.rollbackActionIds.push('ROLLBACK-09-DISABLE-VCP-CONFIG');
  }, 'GREENFIELD_ACTIVATION_ACTION_INVALID');
  assert.equal(
    authority.greenfieldActivationAction.evidenceRequired.includes(
      'GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_PROOF',
    ),
    true,
  );
  assert.equal(
    authority.greenfieldActivationAction.evidenceRequired.includes(
      'PRE_ACTIVATION_WRITER_DRAIN_PROOF',
    ),
    true,
  );
  assert.equal(
    authority.greenfieldActivationAction.evidenceRequired.includes(
      'PROD_07_STAGING_WRITE_DENIAL_PROOF',
    ),
    true,
  );
  assert.equal(
    authority.greenfieldActivationAction.evidenceRequired.includes(
      'VCP_KIOSK_ENABLEMENT_COMPLETION_PROOF',
    ),
    false,
  );
});

test('greenfield activation keeps the same process fenced through verification then enables atomically', () => {
  const effects = authority.greenfieldActivationAction.effects;
  assert.match(effects[3], /write fence remains held/u);
  assert.match(
    effects[4],
    /same process, route, image, target volume and disabled write fence remain unchanged/u,
  );
  assert.match(effects[4], /atomic in-process write-admission enable transition/u);
  assert.match(effects[4], /no container restart or route change/u);
  for (const proof of [
    'PRE_ENABLE_SAME_PROCESS_AND_FENCE_PROOF',
    'WRITE_ADMISSION_ENABLE_RECEIPT',
  ]) {
    assert.equal(authority.greenfieldActivationAction.evidenceRequired.includes(proof), true, proof);
  }
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

test('greenfield authority cannot self-authorize the next production action', () => {
  rejected(value => {
    value.authorization.requestableActionIds = ['PROD-03-GENERATE-INSTALL-TOKENS'];
  }, 'GREENFIELD_AUTHORIZATION_STATE_INVALID');
  rejected(value => {
    value.authorization.blanketApprovalAllowed = true;
  }, 'GREENFIELD_AUTHORIZATION_STATE_INVALID');
});
