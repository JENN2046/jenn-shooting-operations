import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';
import { validateProductionGreenfieldAuthority } from '../src/production-greenfield-authority-v1.mjs';
import { normalizeSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';

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
  assert.equal(authority.authorization.nextActionId, 'PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE');
  assert.equal(authority.authorization.nextActionRequiresExplicitAuthorization, true);
});

test('greenfield authority records GF14L completion while retaining rolled-back GF14 history', () => {
  assert.deepEqual(
    authority.completedAcceptanceIds.slice(-9),
    [
      'PROD-03-GENERATE-INSTALL-TOKENS',
      'PROD-04-BUILD-IMAGE',
      'PROD-05-START-ISOLATED-CONTAINER',
      'PROD-06-LOOPBACK-HEALTH-SMOKE',
      'PROD-07-CONFIGURE-REVERSE-PROXY-TLS',
      'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
      'PROD-GF-13-ACTIVATE',
      'PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE',
      'PROD-10-ENABLE-VCP-REMOTE-SYNC',
    ],
  );
  assert.equal(authority.completedAcceptanceIds.includes('PROD-GF-14-RESTORE-ORPHAN-CLEANUP'), false);
  assert.equal(authority.completedAcceptanceIds.includes('PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE'), true);
  assert.equal(authority.completedAcceptanceIds.includes('PROD-GF-13-ACTIVATE'), true);
  assert.equal(authority.acceptance.prod10.status, 'PASS');
  assert.equal(authority.acceptance.prod10.prewriteAttestationFinalSha256,
    'sha256:ab276166e3cdcc601fc397b95a9abe83c73b927ceba14e40e1403501c1a9fcbd');
  assert.equal(authority.acceptance.prod10.prewriteContainerId,
    'b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be');
  assert.equal(authority.acceptance.prod10.postRevision, 3);
  assert.equal(authority.acceptance.prod10.createdTaskIdSha256,
    'sha256:87062fd994bc89887e8b4322948b2d4899aa191ae8255f2e904c459c498e0960');
  assert.equal(authority.acceptance.prod10.acceptanceWriteEnabledPost, false);

  assert.deepEqual(authority.acceptance.prod03, {
    status: 'PASS',
    recordedAtUtc: '2026-09-27T16:34:04.678274744Z',
    secretStoragePath: '/mnt/datadisk0/apps/jenn-shooting-operations/.env.tokens',
    fileOwner: 'ubuntu:ubuntu',
    fileMode: 600,
    fileSizeBytes: 317,
    roleTokenCount: 4,
    uniqueRoleTokenCount: 4,
    tokenHexLength: 64,
    secretValuesRecorded: false,
    noSecretOutput: true,
    rollbackActionId: 'ROLLBACK-06-REVOKE-ROLE-TOKENS',
  });
  assert.deepEqual(authority.acceptance.prod04, {
    status: 'PASS',
    recordedAtUtc: '2026-09-27T16:48:50.128965614Z',
    authorityCommit: '92b7137211bf807f178901e878a8c3d6e335cec4',
    imageTag: 'jenn-shooting-operations:prod-92b7137211bf807f178901e878a8c3d6e335cec4',
    imageId: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
    nodeBaseIndexDigest: 'sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1',
    nodeBaseAmd64Digest: 'sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a',
    imageUser: 'node',
    targetContainers: 0,
    port3800Listeners: 0,
    tempBuildArtifacts: 0,
    buildLogLowDisclosure: true,
    secretValuesOutput: false,
    evidencePath: '/mnt/datadisk0/apps/jenn-shooting-operations/prod04-build-evidence.txt',
    rollbackActionId: 'ROLLBACK-08-REMOVE-BUILT-IMAGE',
  });
  assert.deepEqual(authority.acceptance.prod05, {
    status: 'PASS',
    recordedAtUtc: '2026-09-27T17:50:49Z',
    sourceAuthorityCommit: '92b7137211bf807f178901e878a8c3d6e335cec4',
    containerName: 'jenn-shooting-operations-prod',
    containerId: '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
    imageId: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
    loopbackBind: '127.0.0.1:3800',
    healthStatus: 'healthy',
    runtimeUid: 1000,
    runtimeGid: 1000,
    dataVolumeName: 'jenn-shooting-operations_shooting_data',
    dataVolumeBind: '/app/data',
    targetVolumeContainerMountCount: 1,
    readOnlyRootfs: true,
    restartPolicy: 'unless-stopped',
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
    orphanCleanupState: 'disabled',
    orphanCleanupMarkerValid: true,
    orphanCleanupActiveRuns: 0,
    startupOrphanCleanupDisabled: true,
    periodicOrphanCleanupDisabled: true,
    requestTriggeredOrphanCleanupDisabled: true,
    allOrphanCleanupEntryPointsDisabled: true,
    bootstrapRevision: 0,
    greenfieldNoExistingSource: true,
    productionImportCompletionProof: 'NOT_APPLICABLE_GREENFIELD',
    secretValuesRecorded: false,
    evidencePath: '/mnt/datadisk0/apps/jenn-shooting-operations/prod05-start-evidence.txt',
    evidenceSha256: 'sha256:f33a4175f10318fde375e85ca21a55fb7b1243717d039ffdaee96f3480e047a6',
    rollbackActionId: 'ROLLBACK-02-STOP-NEW-CONTAINER',
    rollbackPreserveDataVolume: 'jenn-shooting-operations_shooting_data',
  });
  assert.deepEqual(authority.acceptance.prod06, {
    status: 'PASS',
    recordedAtUtc: '2026-09-27T18:08:17Z',
    containerName: 'jenn-shooting-operations-prod',
    containerId: '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
    imageId: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
    healthzStatus: 200,
    healthzBody: {
      ok: true,
      service: 'jenn-shooting-operations',
    },
    healthzWriteAdmissionHeader: 'disabled',
    containerState: 'running',
    containerHealth: 'healthy',
    containerUid: 1000,
    containerGid: 1000,
    databasePath: '/app/data/shooting-operations.sqlite',
    volumeMountType: 'volume',
    volumeName: 'jenn-shooting-operations_shooting_data',
    volumeDestination: '/app/data',
    volumeReadWrite: true,
    loopbackBind: '127.0.0.1:3800',
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
    bootstrapRevision: 0,
    containerStartCompletionProof: 'PROD-05-START-ISOLATED-CONTAINER',
    readOnlySmoke: true,
    secretValuesRecorded: false,
  });
  assert.deepEqual(authority.acceptance.prod07, {
    status: 'PASS',
    recordedAtUtc: '2026-09-27T22:52:59Z',
    hostname: 'jso.skmt617.top',
    route: 'https://jso.skmt617.top',
    nginxConfigPath: '/etc/nginx/conf.d/jso-shooting-operations.conf',
    nginxConfigMode: 644,
    nginxConfigTest: 'PASS_ROOT_OPERATOR',
    nginxReload: 'PASS_ROOT_OPERATOR',
    nginxActive: true,
    noExistingRouteOverwrite: true,
    preMutationRouteMatchCount: 0,
    postMutationRouteMatchCount: 1,
    backend: 'http://127.0.0.1:3800',
    backendHealthStatus: 200,
    publicHealthStatus: 200,
    publicHealthWriteAdmission: 'disabled',
    httpRedirectStatus: 308,
    tlsOriginCertificateFamily: 'skmt617.top',
    tlsOriginHostnameCoverage: true,
    tlsOriginValidFromUtc: '2026-06-22T08:45:00Z',
    tlsOriginValidToUtc: '2041-06-18T08:45:00Z',
    tlsEdgeStatus: 'PASS',
    dnsProvider: 'Cloudflare',
    dnsProxyMode: 'PROXIED',
    publicWritePostStatus: 503,
    publicWritePutStatus: 503,
    publicWritePatchStatus: 503,
    publicWriteDeleteStatus: 503,
    publicWriteFailureCode: 'WRITE_ADMISSION_DISABLED',
    boundedStagingPrincipalScope: 'NO_PREACTIVATION_WRITES',
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
    orphanCleanupState: 'disabled',
    orphanCleanupMarkerValid: true,
    orphanCleanupActiveRuns: 0,
    bootstrapRevision: 0,
    stagingRequestPathCleanupDisabled: true,
    prod08RequiredForCurrentHttpsReachability: false,
    secretValuesRecorded: false,
    evidencePath: '/mnt/datadisk0/apps/jenn-shooting-operations/prod07-route-evidence.txt',
    evidenceSha256: 'sha256:a49ecf5e5d358f1774f631af57dd930401a3bc9c6468d339322966d1e6329cc1',
    rollbackActionId: 'ROLLBACK-01-REMOVE-NEW-ROUTE',
  });
  assert.deepEqual(authority.acceptance.prodGf13, {
    status: 'PASS',
    governanceStatus: 'RECONCILED_EXACT_READ_ONLY',
    activatedAtUtc: '2026-09-27T23:11:00Z',
    verifiedAtUtc: '2026-09-27T23:12:00Z',
    route: 'https://jso.skmt617.top',
    clientScope: 'HTTPS_ROUTE_ONLY_NO_VCP_NO_KIOSK',
    containerName: 'jenn-shooting-operations-prod',
    containerId: '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
    imageId: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
    hostPid: 747599,
    containerStartedAt: '2026-09-27T17:49:01.319828677Z',
    dataVolumeName: 'jenn-shooting-operations_shooting_data',
    dataVolumeDeviceInode: '64784:1835042',
    databaseDeviceInode: '64784:1835048',
    preEnableLoopbackHealth: 200,
    preEnableRoutedHealth: 200,
    preEnableWriteAdmission: 'disabled',
    preEnableMutatingMethodsDenied: true,
    preEnableOrphanCleanupState: 'disabled',
    preEnableOrphanCleanupActiveRuns: 0,
    preEnableRevision: 0,
    preEnableUploadRows: 0,
    preEnableOperationRows: 0,
    preEnableAuditRows: 0,
    preEnableAttachmentFiles: 0,
    targetVolumeContainerMountCount: 1,
    containerProcessCount: 1,
    integrationEnvCount: 0,
    directStoreGuardCount: 5,
    nginxConfigSha256: 'sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33',
    transitionSignal: 'SIGUSR2',
    writeAdmissionEvent: 'WRITE_ADMISSION_ENABLED',
    writeAdmissionRuntimePost: 'enabled',
    writeAdmissionTransitionCount: 1,
    sameContainerPost: true,
    sameHostPidPost: true,
    sameStartedAtPost: true,
    sameImagePost: true,
    sameRouteConfigPost: true,
    sameDataVolumePost: true,
    postEnableLoopbackHealth: 200,
    postEnableRoutedHealth: 200,
    postEnableLoopbackWriteAdmission: 'enabled',
    postEnableRoutedWriteAdmission: 'enabled',
    unauthenticatedWriteProbeStatus: 401,
    unauthenticatedWriteProbeCode: 'UNAUTHORIZED',
    orphanCleanupPost: 'disabled',
    orphanCleanupActiveRunsPost: 0,
    postEnableRevision: 0,
    postEnableUploadRows: 0,
    postEnableOperationRows: 0,
    postEnableAuditRows: 0,
    postEnableAttachmentFiles: 0,
    integrationsRemainDisabled: true,
    orphanCleanupRestorationDeferred: true,
    durabilityRemediationStatus: 'PASS',
    durabilityRemediationStartedAtUtc: '2026-09-27T23:29:06Z',
    durabilityRemediationVerifiedAtUtc: '2026-09-27T23:29:42Z',
    priorContainerId: '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
    durableContainerId: '1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb',
    durableContainerStartedAt: '2026-09-27T23:29:33.784982222Z',
    durableContainerImageId: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
    durableContainerRestartPolicy: 'unless-stopped',
    durableContainerReadOnlyRootfs: true,
    durableRuntimeEnvPath: '/mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime',
    durableRuntimeEnvSha256: 'sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c',
    durabilityRemediationScriptPath: '/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf13-durability-remediation.sh',
    durabilityRemediationScriptSha256: 'sha256:eb34f41d56c9fd464ae3517c0aa5b38c6836a96695bc4cbffea5282e682e7fb4',
    firstDurableStartAdmission: 'enabled',
    restartProbePerformed: true,
    restartProbeAdmission: 'enabled',
    publicHealthAfterRestart: 200,
    publicAdmissionAfterRestart: 'enabled',
    unauthenticatedWriteAfterRestartStatus: 401,
    unauthenticatedWriteAfterRestartCode: 'UNAUTHORIZED',
    orphanCleanupAfterRestart: 'disabled',
    orphanCleanupActiveRunsAfterRestart: 0,
    databaseRevisionAfterRestart: 0,
    uploadRowsAfterRestart: 0,
    operationRowsAfterRestart: 0,
    auditRowsAfterRestart: 0,
    activeTargetVolumeMountCountAfterRestart: 1,
    priorContainerRemovedAfterVerification: true,
    durableActivationAcrossRestartVerified: true,
    durableVolumeType: 'volume',
    durableVolumeName: 'jenn-shooting-operations_shooting_data',
    durableVolumeSource: '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data',
    durableVolumeDestination: '/app/data',
    durableVolumeReadWrite: true,
    durableDataDeviceInode: '64784:1835042',
    durableDatabasePath: '/app/data/shooting-operations.sqlite',
    durableDatabaseDeviceInode: '64784:1835048',
    durableDatabaseIdentityVerified: true,
    durableLoopbackHostIp: '127.0.0.1',
    durableLoopbackHostPort: 3800,
    durableContainerPort: '3800/tcp',
    durableVolumeIdentityVerified: true,
    durableLoopbackBindVerified: true,
    governanceReconciliationRequired: false,
    governanceReconciliationCompleted: true,
    governanceReconciliationActionId: 'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
    governanceReconciledAtUtc: '2026-09-28T03:09:43Z',
    secretValuesRecorded: false,
    evidencePath: '/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf13-activation-evidence.txt',
    evidenceSha256: 'sha256:1af2e9dd6ca511631ac5d7efb949d0b96c306b1d2c551241a5910b7ba7b81cb2',
    rollbackPreserveDataVolume: 'jenn-shooting-operations_shooting_data',
  });

  assert.deepEqual(authority.acceptance.prodGf13r, {
    status: 'PASS',
    recordedAtUtc: '2026-09-28T03:09:43Z',
    actionId: 'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
    sideEffect: 'READ_ONLY',
    targetInstanceId: 'ins-mi85f3my',
    containerName: 'jenn-shooting-operations-prod',
    containerId: '1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb',
    imageId: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
    containerState: 'running',
    containerHealth: 'healthy',
    containerStartedAt: '2026-09-27T23:29:33.784982222Z',
    restartPolicy: 'unless-stopped',
    readOnlyRootfs: true,
    loopbackHostIp: '127.0.0.1',
    loopbackHostPort: 3800,
    containerPort: '3800/tcp',
    volumeType: 'volume',
    volumeName: 'jenn-shooting-operations_shooting_data',
    volumeSource: '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data',
    volumeDestination: '/app/data',
    volumeReadWrite: true,
    activeTargetVolumeMountCount: 1,
    dataDeviceInode: '64784:1835042',
    databasePath: '/app/data/shooting-operations.sqlite',
    databaseDeviceInode: '64784:1835048',
    databaseRuntimePath: '/app/data/shooting-operations.sqlite',
    writeAdmissionEnvironment: 'enabled',
    orphanCleanupEnvironment: 'disabled',
    orphanCleanupDomain: 'jenn-shooting-operations-primary',
    loopbackHealthStatus: 200,
    loopbackWriteAdmission: 'enabled',
    routedHealthStatus: 200,
    routedWriteAdmission: 'enabled',
    unauthenticatedWriteStatus: 401,
    unauthenticatedWriteCode: 'UNAUTHORIZED',
    databaseRevision: 0,
    uploadRows: 0,
    operationRows: 0,
    auditRows: 0,
    attachmentFiles: 0,
    orphanCleanupState: 'disabled',
    orphanCleanupMarkerValid: true,
    orphanCleanupActiveRuns: 0,
    integrationEnvCount: 0,
    nginxConfigSha256: 'sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33',
    durableRuntimeEnvSha256: 'sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c',
    activationEvidenceSha256: 'sha256:1af2e9dd6ca511631ac5d7efb949d0b96c306b1d2c551241a5910b7ba7b81cb2',
    remediationScriptSha256: 'sha256:eb34f41d56c9fd464ae3517c0aa5b38c6836a96695bc4cbffea5282e682e7fb4',
    noProductionMutation: true,
    secretValuesRecorded: false,
  });

  rejected(value => {
    value.acceptance.prod03.uniqueRoleTokenCount = 3;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prod04.imageId = 'sha256:' + '0'.repeat(64);
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prod05.writeAdmissionMode = 'enabled';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prod06.healthzStatus = 503;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prod07.publicWritePostStatus = 200;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.writeAdmissionTransitionCount = 2;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.durableActivationAcrossRestartVerified = false;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.restartProbeAdmission = 'disabled';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.durableVolumeName = 'wrong-volume';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.durableLoopbackHostIp = '0.0.0.0';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.durableDatabasePath = '/app/data/alternate.sqlite';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.durableDatabaseDeviceInode = '64784:9999999';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13.governanceReconciliationCompleted = false;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13r.databasePath = '/app/data/alternate.sqlite';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf13r.loopbackHostIp = '0.0.0.0';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');

  assert.deepEqual(authority.acceptance.prodGf14, {
    "status": "ROLLED_BACK_FAIL_CLOSED_LIFECYCLE_AUTHORITY_REQUIRED",
    "authorizedActionId": "PROD-GF-14-RESTORE-ORPHAN-CLEANUP",
    "preflightAtUtc": "2026-09-28T03:28:24Z",
    "restoreStartedAtUtc": "2026-09-28T03:32:51Z",
    "restoreRestartedAtUtc": "2026-09-28T03:34:39.513157967Z",
    "finalizedAtUtc": "2026-09-28T03:35:20Z",
    "verifiedAtUtc": "2026-09-28T03:35:52Z",
    "targetInstanceId": "ins-mi85f3my",
    "containerName": "jenn-shooting-operations-prod",
    "preContainerId": "1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb",
    "postContainerId": "b66f589647a72ff109158194605d765df46435e1db4babcaa675fc5e75dec0ac",
    "imageId": "sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545",
    "postContainerStartedAt": "2026-09-28T03:34:39.513157967Z",
    "restartPolicy": "unless-stopped",
    "readOnlyRootfs": true,
    "loopbackBind": "127.0.0.1:3800 to 3800/tcp",
    "dataVolumeName": "jenn-shooting-operations_shooting_data",
    "dataVolumeSource": "/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data",
    "dataVolumeDestination": "/app/data",
    "dataDeviceInode": "64784:1835042",
    "databasePath": "/app/data/shooting-operations.sqlite",
    "databaseDeviceInode": "64784:1835048",
    "preWriteAdmission": "enabled",
    "postWriteAdmission": "enabled",
    "preCleanupMode": "disabled",
    "preCleanupState": "disabled",
    "preCleanupEpoch": "36d0854c-26c4-455c-a410-78ab64d9640e",
    "preCleanupMarkerValid": true,
    "preCleanupActiveRuns": 0,
    "cleanupDisableCapabilityProof": "PASS",
    "preRevision": 0,
    "preUploadRows": 0,
    "preUnclaimedUploadRows": 0,
    "preOperationRows": 0,
    "preAuditRows": 0,
    "preAttachmentFiles": 0,
    "preStagedCleanupFiles": 0,
    "preOldOrphanCandidates": 0,
    "candidateProbe": "PASS",
    "candidateRuntimeEnvSha256": "sha256:cdfa4ebba78b413c608f12670b3c02bde9af1315333bae00c1d2de97ad4f081a",
    "postCleanupMode": "enabled",
    "postCleanupState": "enabled",
    "postCleanupMarkerValid": true,
    "postCleanupActiveRuns": 0,
    "cleanupControlRoot": "/app/data/.orphan-cleanup-control/1ad8b65e5b8819bc9c7e4df213b9bb2ef3d0721a45e0a62d54c4e7f6c0bb1d27",
    "startupOrphanCleanupRestored": true,
    "periodicOrphanCleanupRestored": true,
    "saveUploadTriggeredCleanupRestored": true,
    "submitRequestTriggeredCleanupRestored": true,
    "cleanupAdmissionProbe": "PASS",
    "restartProbe": "PASS",
    "publicHealthPost": 200,
    "publicWriteAdmissionPost": "enabled",
    "unauthenticatedWritePostStatus": 401,
    "unauthenticatedWritePostCode": "UNAUTHORIZED",
    "postRevision": 0,
    "postUploadRows": 0,
    "postUnclaimedUploadRows": 0,
    "postOperationRows": 0,
    "postAuditRows": 0,
    "postAttachmentFiles": 0,
    "postStagedCleanupFiles": 0,
    "integrationEnvCountPost": 0,
    "runtimeConfigPromoted": false,
    "currentRuntimeEnvSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
    "preGf14RuntimeEnvSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
    "preGf14RuntimeEnvBackup": "/mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime.pre-gf14",
    "rollbackControlRoot": "/app/data/.orphan-cleanup-control/1ad8b65e5b8819bc9c7e4df213b9bb2ef3d0721a45e0a62d54c4e7f6c0bb1d27",
    "deletionIrreversibilityAcknowledged": true,
    "businessDataUnchanged": true,
    "secretValuesRecorded": false,
    "evidencePath": "/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf14-cleanup-evidence.txt",
    "evidenceSha256": "sha256:1bfa0d854c376260753fb4c1c4e4512b56ff7acecc7b6593f845136c0294a6d0",
    "governanceStatus": "SAFE_DISABLED_PENDING_EXACT_GF14L_AUTHORIZATION",
    "governanceReconciliationRequired": false,
    "governanceReconciliationCompleted": false,
    "runtimeCleanupRestorationPass": false,
    "rollbackActionAtExecution": "ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP",
    "rollbackBindingStatus": "SAFE_DISABLED_CONTROL_ROLLBACK_COMPLETED",
    "cleanupRollbackTargetBinding": "DISABLED_DRAINED_SAFE_STATE",
    "runtimeCleanupRestorationAttempted": true,
    "rollbackAtUtc": "2026-09-28T04:48:40Z",
    "rollbackCleanupState": "disabled",
    "rollbackCleanupEnabled": false,
    "rollbackCleanupEpoch": "71879def-55f0-40eb-a580-db45d133d70a",
    "rollbackCleanupMarkerValid": true,
    "rollbackCleanupActiveRuns": 0,
    "rollbackDurableRuntimeEnvSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
    "rollbackContainerRestarted": false,
    "rollbackContainerRecreated": false,
    "rollbackServiceHealth": 200,
    "rollbackWriteAdmission": "enabled",
    "rollbackRevision": 0,
    "rollbackUploadRows": 0,
    "rollbackUnclaimedUploadRows": 0,
    "rollbackOperationRows": 0,
    "rollbackAuditRows": 0,
    "rollbackAttachmentFiles": 0,
    "rollbackStagedCleanupFiles": 0,
    "rollbackIntegrationEnvCount": 0,
    "nextExactActionRequired": "PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE"
  });

  assert.deepEqual(authority.acceptance.prodGf14l, {
    "status": "PASS",
    "actionId": "PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE",
    "authorized": true,
    "preflightAtUtc": "2026-09-28T05:12:03Z",
    "firstStartAtUtc": "2026-09-28T05:13:58.471829315Z",
    "controlledRestartAtUtc": "2026-09-28T05:15:44.792470451Z",
    "verifiedAtUtc": "2026-09-28T05:16:16Z",
    "targetInstanceId": "ins-mi85f3my",
    "containerName": "jenn-shooting-operations-prod",
    "preContainerId": "b66f589647a72ff109158194605d765df46435e1db4babcaa675fc5e75dec0ac",
    "postContainerId": "b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be",
    "imageId": "sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545",
    "restartPolicy": "unless-stopped",
    "readOnlyRootfs": true,
    "loopbackBind": "127.0.0.1:3800 to 3800/tcp",
    "dataVolumeName": "jenn-shooting-operations_shooting_data",
    "dataVolumeSource": "/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data",
    "dataVolumeDestination": "/app/data",
    "dataDeviceInode": "64784:1835042",
    "databasePath": "/app/data/shooting-operations.sqlite",
    "databaseDeviceInode": "64784:1835048",
    "writeAdmissionPre": "enabled",
    "writeAdmissionPost": "enabled",
    "cleanupPreState": "disabled",
    "cleanupPreEnabled": false,
    "cleanupPreEpoch": "71879def-55f0-40eb-a580-db45d133d70a",
    "cleanupPreMarkerValid": true,
    "cleanupPreActiveRuns": 0,
    "cleanupPostMode": "enabled",
    "cleanupPostState": "enabled",
    "cleanupPostEnabled": true,
    "cleanupPostMarkerValid": true,
    "cleanupPostActiveRuns": 0,
    "startupOrphanCleanupRestored": true,
    "periodicOrphanCleanupRestored": true,
    "saveUploadTriggeredCleanupRestored": true,
    "submitRequestTriggeredCleanupRestored": true,
    "cleanupAdmissionProbe": "PASS",
    "controlledRestartProof": "PASS",
    "preRevision": 0,
    "preUploadRows": 0,
    "preUnclaimedRows": 0,
    "preOldOrphanCandidates": 0,
    "preOperationRows": 0,
    "preAuditRows": 0,
    "preAttachmentFiles": 0,
    "preStagedCleanupFiles": 0,
    "postRevision": 0,
    "postUploadRows": 0,
    "postUnclaimedRows": 0,
    "postOperationRows": 0,
    "postAuditRows": 0,
    "postAttachmentFiles": 0,
    "postStagedCleanupFiles": 0,
    "integrationEnvCountPost": 0,
    "publicHealthStatus": 200,
    "publicWriteAdmission": "enabled",
    "unauthenticatedWriteStatus": 401,
    "unauthenticatedWriteCode": "UNAUTHORIZED",
    "persistentRuntimeEnvSha256": "sha256:432b585fbaeee3795631c8e5c064422b3c6f1ae3a122a1eedecd52f138184ba4",
    "rollbackActionId": "ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP",
    "rollbackDisabledRuntimePath": "/mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime.pre-gf14",
    "rollbackDisabledRuntimeSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
    "rollbackScriptPath": "/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf14l-rollback-gf12.sh",
    "rollbackScriptSha256": "sha256:1561c117eca43d894c9ba34545509501990a041a38804313c3d8d307376c7de3",
    "backupContainerRemoved": true,
    "activeTargetVolumeMountCount": 1,
    "noBusinessDataMutationObserved": true,
    "deletionIrreversibilityAcknowledged": true,
    "secretValuesRecorded": false,
    "evidencePath": "/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf14l-lifecycle-evidence.txt",
    "evidenceSha256": "sha256:dc5dba9d51be927755778b3058925f7c50f4cfb8d31bd6957a2cbd20b62d34c9"
  });

  rejected(value => {
    value.acceptance.prodGf14l.cleanupPostState = 'disabled';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf14l.databaseDeviceInode = '64784:9999999';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf14l.rollbackActionId = 'ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');

  rejected(value => {
    value.acceptance.prodGf14.status = 'PASS';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf14.rollbackCleanupState = 'enabled';
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf14.runtimeCleanupRestorationPass = true;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf14.currentRuntimeEnvSha256 =
      'sha256:' + '0'.repeat(64);
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
  rejected(value => {
    value.acceptance.prodGf14.businessDataUnchanged = false;
  }, 'GREENFIELD_ACCEPTANCE_INVALID');
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
    value => { value.greenfieldKioskAcceptancePreparationAction = null; },
    value => { value.greenfieldKioskAcceptancePreparationConfigContract = null; },
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

test('durable activation reconciliation is exact-target, read-only and explicitly authorized', () => {
  const action = authority.greenfieldActivationReconciliationAction;
  assert.equal(action.id, 'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION');
  assert.equal(action.sideEffect, 'READ_ONLY');
  assert.equal(action.requiresExplicitAuthorization, true);
  assert.equal(action.rollbackActionIds.length, 0);
  assert.match(action.effects[0], /without representing it as prior exact-action authorization/u);
  assert.match(action.effects[2], /do not recreate, restart, signal, remount, rebind/u);
  for (const proof of [
    'DURABLE_LOOPBACK_BIND_IDENTITY',
    'DURABLE_TARGET_VOLUME_NAME',
    'DURABLE_TARGET_VOLUME_SOURCE',
    'DURABLE_TARGET_VOLUME_DESTINATION',
    'DURABLE_TARGET_VOLUME_DEVICE_INODE',
    'DURABLE_DATABASE_PATH',
    'DURABLE_DATABASE_DEVICE_INODE',
    'DURABLE_RESTART_PROOF',
  ]) {
    assert.equal(action.evidenceRequired.includes(proof), true, proof);
  }
  rejected(value => {
    value.greenfieldActivationReconciliationAction.requiresExplicitAuthorization = false;
  }, 'GREENFIELD_ACTIVATION_RECONCILIATION_ACTION_INVALID');
  rejected(value => {
    value.greenfieldActivationReconciliationAction.effects[2] =
      'recreate the production container during reconciliation';
  }, 'GREENFIELD_ACTIVATION_RECONCILIATION_ACTION_INVALID');
});

test('GF14L has exact lifecycle authority and a bound Greenfield rollback', () => {
  const action = authority.greenfieldCleanupLifecycleAction;
  assert.equal(action.id, 'PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE');
  assert.equal(action.sideEffect, 'IRREVERSIBLE_OR_EXTERNAL');
  assert.equal(action.requiresExplicitAuthorization, true);
  assert.deepEqual(
    action.rollbackActionIds,
    ['ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP'],
  );
  assert.match(action.authorityTarget, /container recreate\/restart operations/u);
  assert.match(action.effects[2], /recreate or restart only the exact production container name/u);
  assert.match(action.effects[4], /ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP/u);
  for (const proof of [
    'GF14_FAIL_CLOSED_DISABLED_STATE_PROOF',
    'GF14_EXACT_CONTAINER_IDENTITY',
    'GF14_EXACT_IMAGE_IDENTITY',
    'GF14_EXACT_LOOPBACK_BIND_IDENTITY',
    'GF14_EXACT_VOLUME_IDENTITY',
    'GF14_EXACT_DATABASE_IDENTITY',
    'GF14_DISABLED_MARKER_EPOCH',
    'CONTROLLED_RESTART_PROOF',
    'GF14_GREENFIELD_ROLLBACK_CONTRACT_BINDING',
  ]) {
    assert.equal(action.evidenceRequired.includes(proof), true, proof);
  }
  rejected(value => {
    value.greenfieldCleanupLifecycleAction.requiresExplicitAuthorization = false;
  }, 'GREENFIELD_CLEANUP_LIFECYCLE_ACTION_INVALID');
  rejected(value => {
    value.greenfieldCleanupLifecycleAction.authorityTarget =
      'cleanup controls only';
  }, 'GREENFIELD_CLEANUP_LIFECYCLE_ACTION_INVALID');
});

test('Greenfield cleanup rollback explicitly owns exact lifecycle alignment', () => {
  const rollback = authority.greenfieldCleanupRollbackAction;
  assert.equal(rollback.id, 'ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP');
  assert.equal(rollback.requiresExplicitAuthorization, false);
  assert.match(rollback.authorityTarget, /PROD-GF-14L/u);
  assert.match(rollback.authorityTarget, /container lifecycle alignment/u);
  assert.match(rollback.effects[1], /recreate or restart only the exact same production container name/u);
  assert.equal(
    rollback.evidenceRequired.includes('EXACT_CONTAINER_LIFECYCLE_TARGET_BINDING'),
    true,
  );
  rejected(value => {
    value.greenfieldCleanupRollbackAction.authorityTarget =
      'cleanup controls only';
  }, 'GREENFIELD_CLEANUP_ROLLBACK_ACTION_INVALID');
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


test('GF15 freezes every scheduling config field except the one authorization-bound local window', () => {
  const config = authority.greenfieldKioskAcceptancePreparationConfigContract;
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.configVersion, 'GF15-ACCEPT-CONFIG-R1');
  assert.equal(config.algorithmVersion, 'deterministic-scheduler-v1');
  assert.equal(config.calendarCompilerVersion, 'calendar-compiler-v1');
  assert.equal(config.estimatePolicyVersion, 'estimate-policy-v1');
  assert.equal(config.businessTimeZone, 'Asia/Shanghai');
  assert.deepEqual(config.resourceCalendarStatic, {
    resourceId: 'STUDIO-PROD-01',
    capabilityDigest: 'sha256:d32c7c24657ca59e09348cb394471525bdefee9777b51d498eb3b2ba16782068',
    weeklyWindows: [],
  });
  assert.deepEqual(config.durationFallbackRules, [{
    ruleId: 'GF15-DURATION-FLAT-DETAIL',
    productionType: '平面',
    shootingSubtype: '细节',
    durationMs: 900000,
  }]);
  assert.deepEqual(config.bufferRules, [{
    ruleId: 'GF15-BUFFER-FLAT-DETAIL',
    productionType: '平面',
    shootingSubtype: '细节',
    bufferAfterMinutes: 5,
  }]);
  assert.deepEqual(config.softScoringWeights, {
    LIGHTING_SWITCH: 0,
    REFLECTIVITY_SEQUENCE: 0,
    IDLE_GAP: 0,
    EXPECTED_OVERRUN: 0,
    DESIRED_DATE_MISS: 0,
  });
  assert.deepEqual(config.compatibleAlgorithmVersions, ['deterministic-scheduler-v1']);
  assert.deepEqual(config.dateOverrideContract, {
    status: 'custom',
    dateSource: 'AUTHORIZATION_BOUND_FUTURE_ASIA_SHANGHAI_DATE',
    windowSource: 'AUTHORIZATION_BOUND_SINGLE_LOCAL_WINDOW',
  });
  assert.equal(
    config.finalBindingRequirements.includes('TARGET_PACKET_CONTAINS_COMPLETE_NORMALIZED_CONFIG_JSON'),
    true,
  );
  assert.equal(
    config.finalBindingRequirements.includes('CONFIG_DIGEST_MUST_EQUAL_DIGEST_SCHEDULING_CONFIG_V1'),
    true,
  );

  const bound = normalizeSchedulingConfigV1({
    schemaVersion: config.schemaVersion,
    businessTimeZone: config.businessTimeZone,
    resourceCalendars: [{
      ...config.resourceCalendarStatic,
      dateOverrides: [{
        date: '2026-10-01',
        status: config.dateOverrideContract.status,
        windows: [{ start: '10:00', end: '12:00' }],
      }],
    }],
    durationFallbackRules: config.durationFallbackRules,
    bufferRules: config.bufferRules,
    softScoringWeights: config.softScoringWeights,
    compatibleAlgorithmVersions: config.compatibleAlgorithmVersions,
  });
  assert.equal(bound.ok, true);
  assert.equal(
    bound.configDigest,
    'sha256:0755a61402931e756cf68a1360e8dfcb6f58820b518ed920df73096a1b6c0ef8',
  );

  rejected(value => {
    value.greenfieldKioskAcceptancePreparationConfigContract.bufferRules[0].bufferAfterMinutes = 20;
  }, 'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_CONFIG_INVALID');
});

test('GF15 freezes the complete canonical request command and all requests_v2 persisted columns', () => {
  const contract = authority.greenfieldKioskAcceptancePreparationAction.requestContract;
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.requestId, 'REQ-GF15-ACCEPT-PROD-01');
  assert.equal(contract.requestOperationId, 'PRODGF15-REQUEST-R1');
  assert.equal(contract.commandContract.submissionSchemaVersion, 2);
  assert.equal(contract.commandContract.fixedFields.operationId, 'PRODGF15-REQUEST-R1');
  assert.equal(contract.commandContract.fixedFields.coreBriefSummary, 'PROD-11 Kiosk 真机验收');
  assert.deepEqual(contract.commandContract.fixedFields.uploadIds, []);
  assert.deepEqual(contract.commandContract.omittedOptionalFields, ['briefUrl', 'heroAssetId', 'sampleShelfId']);
  assert.equal(contract.commandContract.dynamicFields.desiredDate, 'AUTHORIZATION_BOUND_FUTURE_ASIA_SHANGHAI_DATE');

  const expectedColumns = [
  "id",
  "source_ordinal",
  "sku",
  "name",
  "client",
  "legacy_deliver_text",
  "kind",
  "legacy_v1_status",
  "v1_status_mode",
  "request_lifecycle",
  "lifecycle_provenance",
  "source",
  "business_created_at",
  "business_updated_at",
  "imported_at",
  "v1_assets_present",
  "v1_request_present",
  "production_type",
  "shooting_subtype",
  "deliverable_count",
  "aspect_ratio",
  "duration_seconds",
  "audio_requirement",
  "requested_by",
  "desired_date",
  "note",
  "source_operation_id",
  "core_brief_summary",
  "brief_url",
  "hero_asset_id",
  "sample_status",
  "sample_shelf_id",
  "lighting_preset",
  "reflectivity",
  "priority",
  "migration_batch_id"
];
  assert.deepEqual(contract.completePersistedColumns, expectedColumns);
  assert.equal(new Set(contract.completePersistedColumns).size, 36);
  assert.deepEqual(
    [...new Set([...Object.keys(contract.fixedPersistedFields), ...Object.keys(contract.derivedPersistedFields)])].sort(),
    [...contract.completePersistedColumns].sort(),
  );
  assert.equal(contract.fixedPersistedFields.legacy_deliver_text, 'PROD-11 Kiosk 真机验收');
  assert.equal(contract.fixedPersistedFields.v1_status_mode, 'canonical');
  assert.equal(contract.fixedPersistedFields.v1_assets_present, 0);
  assert.equal(contract.fixedPersistedFields.v1_request_present, 1);
  assert.equal(contract.fixedPersistedFields.requested_by, 'internal-acceptance');
  assert.equal(contract.fixedPersistedFields.note, '');
  assert.equal(contract.fixedPersistedFields.core_brief_summary, 'PROD-11 Kiosk 真机验收');
  assert.equal(contract.fixedPersistedFields.hero_asset_id, null);
  assert.equal(contract.fixedPersistedFields.sample_shelf_id, null);
  assert.equal(
    contract.derivedPersistedFields.source_ordinal,
    'NEXT_AVAILABLE_CANONICAL_SOURCE_ORDINAL_IN_MATERIALIZATION_TRANSACTION',
  );
  assert.equal(contract.finalBindingRequirements.includes('NO_UNLISTED_OR_UNBOUND_REQUESTS_V2_FIELD'), true);

  rejected(value => {
    value.greenfieldKioskAcceptancePreparationAction.requestContract.fixedPersistedFields.core_brief_summary =
      'implementation-chosen';
  }, 'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_ACTION_INVALID');
});

test('GF15 freezes one bounded irreversible Kiosk acceptance scheduling preparation action', () => {
  const action = authority.greenfieldKioskAcceptancePreparationAction;
  assert.equal(action.id, 'PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE');
  assert.equal(action.category, 'DATA');
  assert.equal(action.risk, 'HIGH');
  assert.equal(action.sideEffect, 'IRREVERSIBLE_OR_EXTERNAL');
  assert.equal(action.requiresExplicitAuthorization, true);
  assert.match(action.authorityTarget, /STUDIO-PROD-01/u);
  assert.match(action.authorityTarget, /requestId REQ-GF15-ACCEPT-PROD-01/u);
  assert.match(action.authorityTarget, /configVersion GF15-ACCEPT-CONFIG-R1/u);
  assert.match(action.authorityTarget, /decisionId PRODGF15-DECISION-R1/u);
  assert.equal(
    action.preconditions.includes('KIOSK_ACCEPTANCE_REQUEST_MATERIALIZATION_CAPABILITY'),
    true,
  );
  assert.equal(
    action.preconditions.includes('KIOSK_ACCEPTANCE_OUTBOX_ISOLATION_CAPABILITY'),
    true,
  );
  assert.equal(
    action.preconditions.includes('DATABASE_WIDE_BRIEF_HOST_COMPATIBILITY'),
    true,
  );
  assert.equal(
    action.preconditions.includes('GF15_ACCEPTANCE_CANDIDATE_ISOLATION'),
    true,
  );
  assert.equal(
    action.preconditions.includes('KIOSK_ACCEPTANCE_SCHEDULING_QUIESCENCE_CAPABILITY'),
    true,
  );
  assert.equal(
    action.effects.some(effect => /no raw SQL bypass/u.test(effect)),
    true,
  );
  assert.equal(
    action.effects.some(effect => /contains exactly one candidate whose requestId is REQ-GF15-ACCEPT-PROD-01/u.test(effect)),
    true,
  );
  assert.equal(
    action.effects.some(effect => /decision selects exactly that item/u.test(effect)),
    true,
  );
  assert.equal(
    action.effects.some(effect => /zero stored draft scheduling proposals/u.test(effect)),
    true,
  );
  const prewriteEffect = action.effects.find(effect => /prewrite draft-proposal gate/u.test(effect));
  assert.equal(typeof prewriteEffect, 'string');
  assert.equal(
    prewriteEffect.indexOf('acquire the bounded GF15 Scheduling quiescence capability')
      < prewriteEffect.indexOf('prove zero stored draft scheduling proposals'),
    true,
  );
  assert.equal(
    action.effects.some(effect => /stored draft-proposal set contains exactly that GF15 proposal and no other draft/u.test(effect)),
    true,
  );
  assert.equal(
    action.effects.some(effect => /persistent production facts/u.test(effect)),
    true,
  );
  assert.deepEqual(
    action.rollbackActionIds,
    ['ROLLBACK-GF-13-CONTAIN-DEVICE-ACCEPTANCE-SCHEDULE'],
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_BOUND_CONFIG_JSON'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_BOUND_CONFIG_DIGEST'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_PREWRITE_DRAFT_PROPOSAL_COUNT_ZERO'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_CANDIDATE_ISOLATION_PROOF'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_POST_GENERATION_ONLY_ACCEPTANCE_DRAFT_PROOF'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_SCHEDULING_QUIESCENCE_CAPABILITY_PROOF'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_SCHEDULING_QUIESCENCE_ACQUIRE_RECEIPT'),
    true,
  );
  for (const proof of [
    'GF15_BOUND_REQUEST_COMMAND',
    'GF15_BOUND_REQUEST_ROW_CONTRACT',
    'GF15_MATERIALIZED_REQUEST_ROW_ATTESTATION',
  ]) {
    assert.equal(action.evidenceRequired.includes(proof), true, proof);
  }
  assert.equal(
    action.evidenceRequired.includes('GF15_SELECTED_REQUEST_BINDING_PROOF'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_REQUEST_MATERIALIZATION_CAPABILITY_PROOF'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_OUTBOX_ISOLATION_CAPABILITY_PROOF'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_DERIVED_SCHEDULE_ITEM_ID'),
    true,
  );
  assert.equal(
    action.evidenceRequired.includes('GF15_OUTBOX_ISOLATION_PROOF'),
    true,
  );

  rejected(value => {
    value.greenfieldKioskAcceptancePreparationAction.preconditions =
      value.greenfieldKioskAcceptancePreparationAction.preconditions
        .filter(id => id !== 'KIOSK_ACCEPTANCE_REQUEST_MATERIALIZATION_CAPABILITY');
  }, 'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_ACTION_INVALID');
  rejected(value => {
    value.greenfieldKioskAcceptancePreparationAction.effects =
      ['directly insert a schedule row'];
  }, 'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_ACTION_INVALID');
});

test('GF15 rollback is containment-only and cannot pretend immutable scheduling facts disappear', () => {
  const rollback = authority.greenfieldKioskAcceptancePreparationRollbackAction;
  assert.equal(rollback.id, 'ROLLBACK-GF-13-CONTAIN-DEVICE-ACCEPTANCE-SCHEDULE');
  assert.equal(rollback.category, 'ROLLBACK');
  assert.equal(rollback.requiresExplicitAuthorization, false);
  assert.equal(rollback.sideEffect, 'IRREVERSIBLE_OR_EXTERNAL');
  assert.match(rollback.authorityTarget, /STUDIO-PROD-01/u);
  assert.equal(
    rollback.effects.some(effect => /preserve the acceptance request/u.test(effect)),
    true,
  );
  assert.equal(
    rollback.effects.some(effect => /no delete-or-clear-active-config command/u.test(effect)),
    true,
  );
  assert.equal(
    rollback.preconditions.includes('KIOSK_ACCEPTANCE_SCHEDULING_QUIESCENCE_CAPABILITY'),
    true,
  );
  assert.equal(
    rollback.effects.some(effect => /reacquire a bounded rollback lease/u.test(effect)),
    true,
  );
  assert.equal(
    rollback.effects.some(effect => /empty or contains only the exact source-bound GF15 proposal/u.test(effect)),
    true,
  );
  assert.equal(
    rollback.effects.some(effect => /contains no unrelated draft/u.test(effect)),
    true,
  );
  for (const proof of [
    'GF15_ROLLBACK_SCHEDULING_QUIESCENCE_ACQUIRE_OR_CONTINUE_RECEIPT',
    'GF15_ROLLBACK_PREMUTATION_DRAFT_PROPOSAL_GATE',
    'GF15_SCHEDULING_QUIESCENCE_RELEASE_RECEIPT',
  ]) {
    assert.equal(rollback.evidenceRequired.includes(proof), true, proof);
  }
  assert.equal(
    rollback.evidenceRequired.includes('GF15_IMMUTABLE_FACTS_PRESERVED'),
    true,
  );

  rejected(value => {
    value.greenfieldKioskAcceptancePreparationRollbackAction.effects =
      ['delete all acceptance facts'];
  }, 'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_ROLLBACK_INVALID');
});

test('greenfield authority cannot self-authorize the next production action', () => {
  rejected(value => {
    value.authorization.requestableActionIds = ['PROD-10-ENABLE-VCP-REMOTE-SYNC'];
  }, 'GREENFIELD_AUTHORIZATION_STATE_INVALID');
  rejected(value => {
    value.authorization.blanketApprovalAllowed = true;
  }, 'GREENFIELD_AUTHORIZATION_STATE_INVALID');
});
