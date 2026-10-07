import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestCanonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';

const record = JSON.parse(await readFile(new URL(
  '../docs/operations/g4-schema11-service-startup-preparation.r1.json', import.meta.url), 'utf8'));

const digest = target => digestCanonicalJsonSchedulingV1({
  domain: 'g4-schema11-service-startup-authority-v1',
  authorityTarget: target,
});

test('G4-A preparation freezes one exact non-authorizing startup target', () => {
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.preparationId, 'G4_SCHEMA11_SERVICE_STARTUP_PREPARATION_R1');
  assert.equal(record.status, 'FROZEN_NOT_AUTHORIZED');
  assert.equal(record.gate, 'G4_PRODUCTION_V1_CLOSURE');
  assert.equal(record.action.actionId, 'G4A_START_SCHEMA11_SERVICE_DISABLED');
  assert.equal(record.authority.startupActionAuthorized, false);
  assert.equal(record.authority.writerReadmissionAuthorized, false);
  assert.equal(record.authority.normalBusinessMutationAuthorized, false);
  assert.equal(record.authorityTargetDigest, digest(record.authorityTarget));
});

test('G4-A exact runtime artifact and frozen production prestate remain bound', () => {
  assert.equal(record.artifactEvidence.sourceCommit,
    '1655d3646799d8a5923648bfbd033a690d8b03d0');
  assert.equal(record.artifactEvidence.imageDigest,
    'sha256:613cdb57b5359b89671ae4ea211028425a0e8f5a780045c45a9aa2957d749a59');
  assert.equal(record.artifactEvidence.imageArchiveSha256,
    'sha256:dc15df6a21fa89527d595e6d548afb139305a7f79c24172ece448fbf4fb7b44c');
  assert.equal(record.artifactEvidence.productionImageStaged, false);
  assert.equal(record.productionPrestate.activeDatabase.schemaVersion, 11);
  assert.equal(record.productionPrestate.activeDatabase.sha256,
    'sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9');
  assert.equal(record.productionPrestate.activeDatabase.journalMode, 'delete');
  assert.equal(record.productionPrestate.logicalFacts.digest,
    'sha256:8de6a00a7eddc5b33abd5edb6cdb14b08c72141d937c834ad7fea565d1083dd3');
  assert.equal(record.productionPrestate.scheduleState.revision, 3);
  assert.equal(record.productionPrestate.productionContainerPresent, false);
  assert.equal(record.productionPrestate.port3800Free, true);
});

test('G4-A startup is explicitly disabled and only bounded runtime storage effects are permitted', () => {
  const boundary = record.startupBoundary;
  assert.deepEqual(boundary.startupEnvironment, {
    WRITE_ADMISSION_MODE: 'disabled',
    ORPHAN_CLEANUP_MODE: 'disabled',
    KIOSK_SERVICE_CONTEXT: 'PROD11_PRODUCTION',
    KIOSK_AUTH_CONFIG_PATH: '',
    JSO_BUSINESS_RUNTIME: 'ABSENT',
    JSO_BUSINESS_IDENTITIES_JSON: 'ABSENT',
  });
  assert.equal(boundary.kioskExpectedMode, 'DISABLED');
  assert.equal(boundary.container.restartPolicy, 'no');
  assert.equal(boundary.container.readOnlyRootfs, true);
  assert.deepEqual(boundary.container.securityOpt, ['no-new-privileges:true']);
  assert.equal(boundary.permittedPersistentEffects.sqliteJournalModeTransition, 'delete_to_wal');
  assert.equal(boundary.permittedPersistentEffects.sqliteWalAndShmSidecars, true);
  assert.equal(boundary.permittedPersistentEffects.orphanCleanupDisabledMarker, true);
  assert.equal(boundary.permittedPersistentEffects.logicalBusinessFactsMutation, false);
  assert.equal(boundary.permittedPersistentEffects.nginxConfigMutation, false);
  assert.equal(boundary.requiredPostStartFacts.writeAdmissionEnabled, false);
  assert.equal(boundary.requiredPostStartFacts.writeAdmissionHeader, 'disabled');
  assert.equal(boundary.requiredPostStartFacts.logicalFactsDigestMustEqualPrestate, true);
  assert.equal(boundary.requiredPostStartFacts.scheduleRevisionMustRemain, 3);
});

test('G4-A local exact-image acceptance proves physical transition without logical fact drift', () => {
  const evidence = record.localAcceptanceEvidence;
  assert.equal(evidence.schema11StartupHealthy, true);
  assert.equal(evidence.healthStatus, 200);
  assert.equal(evidence.writeAdmissionHeader, 'disabled');
  assert.equal(evidence.runningJournalMode, 'wal');
  assert.equal(evidence.disabledMarkerCount, 1);
  assert.equal(evidence.physicalHashChangedAcrossStartup, true);
  assert.equal(evidence.logicalFactsDigestBefore, evidence.logicalFactsDigestAfter);
  assert.equal(evidence.logicalFactsUnchanged, true);
});

test('G4-A target digest changes on artifact, production identity, startup authority or prestate drift', () => {
  const mutators = [
    value => { value.artifact.imageDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.target.nginxConfigSha256 = 'sha256:' + '1'.repeat(64); },
    value => { value.target.tokenEnvFileSha256 = 'sha256:' + '2'.repeat(64); },
    value => { value.prestate.activeDatabaseSha256 = 'sha256:' + '3'.repeat(64); },
    value => { value.prestate.logicalFactsDigest = 'sha256:' + '4'.repeat(64); },
    value => { value.startup.writeAdmissionMode = 'enabled'; },
    value => { value.startup.kioskMode = 'PROD11_SMOKE_ONLY'; },
    value => { value.startup.restartPolicy = 'unless-stopped'; },
    value => { value.startup.logicalBusinessFactsMutationAllowed = true; },
    value => { value.startup.writerReadmissionAllowed = true; },
  ];
  for (const mutate of mutators) {
    const changed = structuredClone(record.authorityTarget);
    mutate(changed);
    assert.notEqual(digest(changed), record.authorityTargetDigest);
  }
});

test('G4-A keeps all later production authority separate', () => {
  assert.equal(record.nextState.nextAction,
    'REQUEST_EXPLICIT_G4A_START_SCHEMA11_SERVICE_DISABLED_AUTHORIZATION');
  assert.equal(record.nextState.startupActionStatus, 'NOT_AUTHORIZED');
  assert.equal(record.nextState.writerReadmissionStatus, 'NOT_AUTHORIZED');
  assert.equal(record.nextState.realBusinessLoopStatus, 'NOT_STARTED');
  assert.equal(record.nextState.durableProductionModeStatus, 'NOT_DESIGNED');
  for (const required of [
    'NO_WRITER_READMISSION',
    'NO_SIGUSR2',
    'NO_ORPHAN_CLEANUP_ENABLE',
    'NO_KIOSK_AUTH_OR_SMOKE_ENABLEMENT',
    'NO_BUSINESS_RUNTIME_ENABLEMENT',
    'NO_VCP_OR_DINGTALK_CONFIGURATION_CHANGE',
    'NO_NGINX_ROUTE_CHANGE',
    'NO_OLD_IMAGE_RESTART',
    'NO_AUTOMATIC_RESTART_POLICY',
    'NO_LOGICAL_BUSINESS_FACT_MUTATION',
  ]) {
    assert.ok(record.prohibitions.includes(required));
  }
});
