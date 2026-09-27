import { createHash } from 'node:crypto';
import { containsForbiddenEvidenceInput } from './production-evidence-input-boundary-v1.mjs';

const EXPECTED_BASE_MANIFEST_DIGEST =
  'sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b';

const EXPECTED_NOT_APPLICABLE_GATES = Object.freeze([
  'PRODUCTION_DATA_MIGRATION',
  'PRODUCTION_IMPORT_SOURCE_CONSISTENCY',
  'PRODUCTION_ATTACHMENT_COPY_CAPABILITY',
  'CUTOVER_SOURCE_CONSISTENCY',
  'CUTOVER_SWITCH_RECOVERY',
  'CUTOVER_TARGET_WRITE_FENCE_CAPABILITY',
]);

const EXPECTED_SUPERSEDED_GATES = Object.freeze([
  'CONTAINER_START_READINESS',
  'INTEGRATION_DEPLOYMENT_READINESS',
  'CUTOVER_FORWARD_CHAIN',
  'POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION',
]);

const EXPECTED_COMPLETED = Object.freeze([
  'PROD-01-TARGET-READONLY-PREFLIGHT',
  'PROD-02-CREATE-ISOLATED-APP-STORAGE',
  'PHASE-B-TARGET-VOLUME-ACCEPTANCE',
]);

const EXPECTED_CONTAINER_START = Object.freeze([
  'PROD-02-CREATE-ISOLATED-APP-STORAGE',
  'PROD-03-GENERATE-INSTALL-TOKENS',
  'PROD-04-BUILD-IMAGE',
  'PRODUCTION_IMPORT_TARGET_ABSENCE',
  'GREENFIELD_NO_EXISTING_SOURCE',
  'PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL',
  'PRODUCTION_DEPLOYMENT_GATE',
]);

const EXPECTED_FORWARD_CHAIN = Object.freeze([
  'PROD-02-CREATE-ISOLATED-APP-STORAGE',
  'PROD-03-GENERATE-INSTALL-TOKENS',
  'PROD-04-BUILD-IMAGE',
  'PROD-05-START-ISOLATED-CONTAINER',
  'PROD-06-LOOPBACK-HEALTH-SMOKE',
  'PROD-07-CONFIGURE-REVERSE-PROXY-TLS',
]);

const EXPECTED_CONDITIONAL_ACTIONS = Object.freeze([
  'PROD-08-FIREWALL-SECURITY-GROUP',
]);

const EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS = Object.freeze([
  'PROD-10-ENABLE-VCP-REMOTE-SYNC',
  'PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE',
]);

const EXPECTED_INTEGRATION_PREREQUISITES = Object.freeze([
  'GREENFIELD_ACTIVATION_COMPLETION',
  'GREENFIELD_FORWARD_CHAIN',
  'PRODUCTION_TARGET_FACTS',
  'PRODUCTION_DEPLOYMENT_GATE',
]);

const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'authorityId',
  'baseManifestDigest',
  'deploymentMode',
  'target',
  'acceptance',
  'notApplicableBaseGateIds',
  'supersededBaseGateIds',
  'completedAcceptanceIds',
  'greenfieldContainerStartPrerequisites',
  'greenfieldForwardChain',
  'greenfieldConditionalActionIds',
  'postActivationIntegrationActionIds',
  'greenfieldIntegrationPrerequisites',
  'greenfieldActivationAction',
  'greenfieldCleanupAction',
  'authorization',
]);

const EXPECTED_ACTIVATION = Object.freeze({
  id: 'PROD-GF-13-ACTIVATE',
  title: 'Activate first greenfield production service',
  category: 'CUTOVER',
  risk: 'CRITICAL',
  sideEffect: 'IRREVERSIBLE_OR_EXTERNAL',
  requiresExplicitAuthorization: true,
  authorityTarget:
    'Exact new Jenn Shooting Operations route and client activation on ins-mi85f3my only; no previous Jenn Shooting Operations production authority exists',
  preconditions: Object.freeze([
    'GREENFIELD_NO_EXISTING_SOURCE',
    'PRODUCTION_TARGET_FACTS',
    'GREENFIELD_FORWARD_CHAIN',
    'GREENFIELD_WRITE_CAPABLE_INTEGRATIONS_DISABLED',
    'CUTOVER_LIVE_SERVICE_READINESS',
    'PRODUCTION_DEPLOYMENT_GATE',
  ]),
  effects: Object.freeze([
    'After exact PROD-GF-13 authorization, revalidate the bound host, exact target storage identities, no-existing-source evidence, activation route and client scope; no source barrier, source sync or old-source demotion exists on this greenfield path',
    'Keep every orphan-cleanup entry point disabled, keep public unauthenticated writes blocked, and keep PROD-10/PROD-11 write-capable integrations disabled while verifying the isolated target service, loopback health and routed TLS',
    'Promote only the approved new route and client entrypoint mappings to production and record one activation receipt; do not overwrite or claim any previous Jenn Shooting Operations authority',
    'Perform read-only post-activation health, routing, client-mapping, database and attachment-baseline verification; failure removes only newly introduced exposure/runtime bindings and preserves the data volume',
    'Only after every read-only verification succeeds may approved production writes be admitted; PROD-10/PROD-11 remain separately blocked until post-activation prerequisites and exact authorization, and orphan cleanup stays disabled until separately authorized greenfield cleanup restoration',
  ]),
  rollbackActionIds: Object.freeze([
    'ROLLBACK-01-REMOVE-NEW-ROUTE',
    'ROLLBACK-05-REVERT-FIREWALL-RULE',
    'ROLLBACK-02-STOP-NEW-CONTAINER',
    'ROLLBACK-08-REMOVE-BUILT-IMAGE',
    'ROLLBACK-06-REVOKE-ROLE-TOKENS',
    'ROLLBACK-04-PRESERVE-DATA-VOLUME',
  ]),
  evidenceRequired: Object.freeze([
    'GREENFIELD_NO_EXISTING_SOURCE_PROOF',
    'NO_PREVIOUS_PRODUCTION_AUTHORITY_PROOF',
    'GREENFIELD_FORWARD_CHAIN_COMPLETION_PROOF',
    'PRE_ACTIVATION_WRITE_CAPABLE_INTEGRATIONS_DISABLED_PROOF',
    'TARGET_STORAGE_IDENTITIES',
    'ACTIVATION_ROUTE_AND_CLIENT_SCOPE',
    'PRE_ACTIVATION_LOOPBACK_HEALTH',
    'PRE_ACTIVATION_ROUTED_TLS_PROBE',
    'PRE_ACTIVATION_ORPHAN_CLEANUP_GUARD_PROOF',
    'ACTIVATION_RECORD',
    'READ_ONLY_POST_ACTIVATION_VERIFICATION',
    'ROLLBACK_TARGETS',
  ]),
});

const EXPECTED_CLEANUP = Object.freeze({
  id: 'PROD-GF-14-RESTORE-ORPHAN-CLEANUP',
  title: 'Restore orphan cleanup after greenfield activation',
  category: 'RUNTIME',
  risk: 'HIGH',
  sideEffect: 'IRREVERSIBLE_OR_EXTERNAL',
  requiresExplicitAuthorization: true,
  authorityTarget:
    'Exact orphan-upload cleanup controls of the greenfield Jenn Shooting Operations production service only',
  preconditions: Object.freeze([
    'GREENFIELD_ACTIVATION_COMPLETION',
    'GREENFIELD_ATTACHMENT_BASELINE',
    'RESTORED_CLEANUP_DISABLE_CAPABILITY',
  ]),
  effects: Object.freeze([
    'After verified greenfield activation, verify the target attachment baseline and capture the exact disabled cleanup configuration before enabling any cleanup entry point',
    'Restore only the approved startup, periodic, saveUpload-triggered and submitRequest-triggered cleanup controls; failure invokes only the PROD-GF-14-bound disable-and-drain recovery and never deletes or rewrites deployment data as rollback',
  ]),
  rollbackActionIds: Object.freeze([
    'ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP',
  ]),
  evidenceRequired: Object.freeze([
    'GREENFIELD_ACTIVATION_COMPLETION_PROOF',
    'GREENFIELD_ATTACHMENT_BASELINE_PROOF',
    'CLEANUP_DISABLE_CAPABILITY_PROOF',
    'CLEANUP_PRE_RESTORE_DISABLED_STATE',
    'STARTUP_ORPHAN_CLEANUP_RESTORED',
    'PERIODIC_ORPHAN_CLEANUP_RESTORED',
    'REQUEST_TRIGGERED_ORPHAN_CLEANUP_RESTORED',
    'POST_RESTORE_HEALTH_STATUS',
    'CLEANUP_ROLLBACK_TARGET_BINDING',
    'DELETION_IRREVERSIBILITY_ACKNOWLEDGED',
  ]),
});

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + stableJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

function sameSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function sameObject(actual, expected) {
  return stableJson(actual) === stableJson(expected);
}

function issue(code, path) {
  return Object.freeze({ code, path });
}

export function validateProductionGreenfieldAuthority(value, {
  baseManifest,
} = {}) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ ok: false, issues: Object.freeze([issue('GREENFIELD_SCHEMA_INVALID', '/')]) });
  }
  if (containsForbiddenEvidenceInput(value)) {
    return Object.freeze({ ok: false, issues: Object.freeze([issue('SECRET_MATERIAL_DETECTED', '/')]) });
  }
  if (!sameSet(Object.keys(value), EXPECTED_TOP_LEVEL_KEYS)) {
    issues.push(issue('GREENFIELD_TOP_LEVEL_KEYS_INVALID', '/'));
  }
  const derivedBaseManifestDigest = baseManifest && typeof baseManifest === 'object'
    ? 'sha256:' + createHash('sha256').update(stableJson(baseManifest)).digest('hex')
    : null;
  if (derivedBaseManifestDigest !== EXPECTED_BASE_MANIFEST_DIGEST
      || value.baseManifestDigest !== EXPECTED_BASE_MANIFEST_DIGEST) {
    issues.push(issue('BASE_MANIFEST_DIGEST_INVALID', '/baseManifestDigest'));
  }
  if (value.schemaVersion !== 1
      || value.authorityId !== 'WO-06D-GREENFIELD-PRODUCTION-AUTHORITY-R1'
      || value.deploymentMode !== 'GREENFIELD_NO_EXISTING_SOURCE') {
    issues.push(issue('GREENFIELD_AUTHORITY_IDENTITY_INVALID', '/'));
  }

  const expectedTarget = {
    provider: 'TENCENT_CLOUD_CVM',
    instanceId: 'ins-mi85f3my',
    instanceName: 'AGENTS-OS',
    publicIpv4: '159.75.139.246',
    privateIpv4: '172.16.0.12',
    region: 'ap-guangzhou',
    zone: 'ap-guangzhou-7',
    os: 'Ubuntu 24.04.4 LTS',
    architecture: 'amd64',
    dockerVersion: '29.1.3',
    dockerComposeVersion: '2.40.3',
    applicationBind: '127.0.0.1:3800',
    applicationDirectory: '/mnt/datadisk0/apps/jenn-shooting-operations',
    dataVolumeName: 'jenn-shooting-operations_shooting_data',
    dataVolumeMountpoint:
      '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data',
    backingDevice: '/dev/vdb',
    filesystem: 'ext4',
    publicHostname: null,
    reverseProxyRoute: null,
    containerName: null,
    cloudSecurityGroupStatus: 'UNVERIFIED_CONTROL_PLANE_FACT',
  };
  if (!sameObject(value.target, expectedTarget)) {
    issues.push(issue('GREENFIELD_TARGET_BINDING_INVALID', '/target'));
  }

  const expectedAcceptance = {
    firstProductionDeploymentConfirmedByOwner: true,
    priorJennShootingOperationsProductionDeployment: 'NONE',
    existingProductionSource: 'ABSENT_VERIFIED',
    sourceDiscoveryScope:
      'BOUND_HOST_ACTIVE_FILESYSTEM_AND_LOCAL_RUNTIME_NO_V1_SOURCE_FOUND',
    targetVolumeAcceptance: 'PASS',
    targetFilesystemCaseSemantics: 'CASE_SENSITIVE',
    targetUnicodeCanonicalEquivalence: 'DISTINCT',
    procSelfFdExclusiveCreate: 'PASS',
    sqliteWalFamily: 'PASS',
    sqliteRollbackJournalFamily: 'PASS',
    acceptedContainerNodeVersion: 'v24.21.0',
    activeTargetBindAliases: 0,
    targetVolumeEmptyAfterAcceptance: true,
    acceptanceProbeAssetsRemoved: true,
  };
  if (!sameObject(value.acceptance, expectedAcceptance)) {
    issues.push(issue('GREENFIELD_ACCEPTANCE_INVALID', '/acceptance'));
  }

  const baseGateMap = new Map((baseManifest?.gates ?? []).map(gate => [gate.id, gate]));
  if (!sameSet(value.notApplicableBaseGateIds, EXPECTED_NOT_APPLICABLE_GATES)) {
    issues.push(issue('GREENFIELD_NOT_APPLICABLE_GATE_SET_INVALID', '/notApplicableBaseGateIds'));
  }
  if (!sameSet(value.supersededBaseGateIds, EXPECTED_SUPERSEDED_GATES)) {
    issues.push(issue('GREENFIELD_SUPERSEDED_GATE_SET_INVALID', '/supersededBaseGateIds'));
  }
  for (const id of [...EXPECTED_NOT_APPLICABLE_GATES, ...EXPECTED_SUPERSEDED_GATES]) {
    if (baseGateMap.get(id)?.status !== 'BLOCKED') {
      issues.push(issue('GREENFIELD_BASE_GATE_STATE_INVALID', '/baseManifest/' + id));
    }
  }

  if (!sameSet(value.completedAcceptanceIds, EXPECTED_COMPLETED)) {
    issues.push(issue('GREENFIELD_COMPLETED_ACCEPTANCE_SET_INVALID', '/completedAcceptanceIds'));
  }
  if (!sameSet(value.greenfieldContainerStartPrerequisites, EXPECTED_CONTAINER_START)) {
    issues.push(issue('GREENFIELD_CONTAINER_START_CONTRACT_INVALID', '/greenfieldContainerStartPrerequisites'));
  }
  if (!sameSet(value.greenfieldForwardChain, EXPECTED_FORWARD_CHAIN)) {
    issues.push(issue('GREENFIELD_FORWARD_CHAIN_INVALID', '/greenfieldForwardChain'));
  }
  if (!sameSet(value.greenfieldConditionalActionIds, EXPECTED_CONDITIONAL_ACTIONS)) {
    issues.push(issue('GREENFIELD_CONDITIONAL_ACTION_SET_INVALID', '/greenfieldConditionalActionIds'));
  }
  if (!sameSet(
    value.postActivationIntegrationActionIds,
    EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS,
  )) {
    issues.push(issue(
      'GREENFIELD_INTEGRATION_ACTION_SET_INVALID',
      '/postActivationIntegrationActionIds',
    ));
  }
  if (!sameSet(
    value.greenfieldIntegrationPrerequisites,
    EXPECTED_INTEGRATION_PREREQUISITES,
  )) {
    issues.push(issue(
      'GREENFIELD_INTEGRATION_PREREQUISITES_INVALID',
      '/greenfieldIntegrationPrerequisites',
    ));
  }

  const baseActionMap = new Map((baseManifest?.actions ?? []).map(action => [action.id, action]));
  for (const id of [
    ...EXPECTED_FORWARD_CHAIN,
    ...EXPECTED_CONDITIONAL_ACTIONS,
    ...EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS,
  ]) {
    if (!baseActionMap.has(id)) {
      issues.push(issue('GREENFIELD_ACTION_REFERENCE_INVALID', '/baseManifest/actions/' + id));
    }
  }
  for (const id of EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS) {
    if (!baseActionMap.get(id)?.preconditions?.includes('INTEGRATION_DEPLOYMENT_READINESS')) {
      issues.push(issue('GREENFIELD_INTEGRATION_BASE_CONTRACT_INVALID', '/baseManifest/actions/' + id));
    }
  }

  if (!sameObject(value.greenfieldActivationAction, EXPECTED_ACTIVATION)) {
    issues.push(issue('GREENFIELD_ACTIVATION_ACTION_INVALID', '/greenfieldActivationAction'));
  }
  if (!sameObject(value.greenfieldCleanupAction, EXPECTED_CLEANUP)) {
    issues.push(issue('GREENFIELD_CLEANUP_ACTION_INVALID', '/greenfieldCleanupAction'));
  }

  if (value.greenfieldContainerStartPrerequisites.includes('PROD-09-PRODUCTION-DATA-IMPORT')
      || value.greenfieldForwardChain.includes('PROD-09-PRODUCTION-DATA-IMPORT')
      || value.greenfieldForwardChain.some(id => EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS.includes(id))
      || value.greenfieldActivationAction.preconditions.includes('CUTOVER_SOURCE_CONSISTENCY')
      || value.greenfieldActivationAction.rollbackActionIds.includes('ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH')
      || value.greenfieldActivationAction.rollbackActionIds.includes('ROLLBACK-09-DISABLE-VCP-CONFIG')
      || value.greenfieldActivationAction.rollbackActionIds.includes('ROLLBACK-10-DISABLE-KIOSK-CONFIG')) {
    issues.push(issue('GREENFIELD_SOURCE_PATH_LEAK_INVALID', '/'));
  }

  const expectedAuthorization = {
    status: 'FROZEN_NOT_REQUESTED',
    approvalModel: 'EXACT_ACTION_IDS_AND_TARGETS_ONLY',
    humanApprovalRequired: true,
    blanketApprovalAllowed: false,
    requestedActionIds: [],
    approvedActionIds: [],
    requestableActionIds: [],
    nextActionId: 'PROD-03-GENERATE-INSTALL-TOKENS',
    nextActionRequiresExplicitAuthorization: true,
  };
  if (!sameObject(value.authorization, expectedAuthorization)) {
    issues.push(issue('GREENFIELD_AUTHORIZATION_STATE_INVALID', '/authorization'));
  }

  if ((baseManifest?.authorizationPacket?.requestedActionIds ?? []).length !== 0
      || (baseManifest?.authorizationPacket?.approvedActionIds ?? []).length !== 0
      || (baseManifest?.authorizationPacket?.requestableActionIds ?? []).length !== 0) {
    issues.push(issue('BASE_AUTHORIZATION_NOT_EMPTY', '/baseManifest/authorizationPacket'));
  }

  if (issues.length > 0) {
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }
  const digest = 'sha256:' + createHash('sha256').update(stableJson(value)).digest('hex');
  return Object.freeze({ ok: true, digest, issues: Object.freeze([]) });
}
