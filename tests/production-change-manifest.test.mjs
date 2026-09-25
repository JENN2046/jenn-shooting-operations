import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createProductionChangeManifestValidator,
  deriveCoauthorizedRollbackActionIds,
} from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(
  new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url),
  'utf8',
));
const base = JSON.parse(readFileSync(
  new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url),
  'utf8',
));
const validate = createProductionChangeManifestValidator(schema);

function issueCodes(result) {
  return new Set(result.issues.map(entry => entry.code));
}

function expectRejected(value, code, label) {
  const result = validate(value);
  assert.equal(result.ok, false, label);
  assert.equal(issueCodes(result).has(code), true, `${label}: missing ${code}: ${JSON.stringify(result.issues)}`);
}

function action(value, id) {
  const found = value.actions.find(candidate => candidate.id === id);
  assert.ok(found, id);
  return found;
}

test('production change manifest validates with deployment request blocked and no authorization granted', () => {
  const result = validate(base);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.match(result.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(base.authorizationPacket.requestedActionIds.length, 0);
  assert.equal(base.authorizationPacket.approvedActionIds.length, 0);
  assert.deepEqual(base.authorizationPacket.requestableActionIds, []);
  assert.deepEqual(base.authorizationPacket.derivedRollbackActionIds, []);
  assert.equal(
    base.authorizationPacket.rollbackAuthorizationModel,
    'BOUND_ROLLBACK_IDS_COAUTHORIZED_WITH_FORWARD_ACTION',
  );
  assert.equal(base.authorizationPacket.separateRollbackApprovalRequired, false);
  assert.deepEqual(
    [...base.authorizationPacket.blockingGateIds].sort(),
    base.gates.filter(gate => gate.status === 'BLOCKED').map(gate => gate.id).sort(),
  );
  assert.deepEqual(
    [...base.authorizationPacket.deploymentBlockingGateIds].sort(),
    [
      'WO06C_VCP_EXTERNAL',
      'WO06C_KIOSK_DEVICE',
      'PRODUCTION_TARGET_FACTS',
      'PRODUCTION_DATA_MIGRATION',
      'PRODUCTION_DEPLOYMENT_GATE',
    ].sort(),
  );
});

test('secret scanner rejects ordinary Bearer and token-shaped material inside schema-valid free text', () => {
  for (const [label, secretText] of [
    ['bearer', 'Bearer 12345678901234567890123456789012'],
    ['bearer newline', 'Bearer\n12345678901234567890123456789012'],
    ['bearer tab', 'Bearer\t12345678901234567890123456789012'],
    ['bearer CRLF', 'Bearer\r\n12345678901234567890123456789012'],
    ['access token', 'access_token = abcdefghijklmnopqrstuvwxyz123456'],
    ['viewer role token', 'VIEWER_TOKEN=abcdefghijklmnopqrstuvwxyz123456'],
    ['submitter role token', 'SUBMITTER_TOKEN = abcdefghijklmnopqrstuvwxyz123456'],
    ['scheduler role token', 'scheduler_token\t=\tabcdefghijklmnopqrstuvwxyz123456'],
    ['admin role token', 'ADMIN_TOKEN=abcdefghijklmnopqrstuvwxyz123456'],
    ['quoted admin role token', 'ADMIN_TOKEN="abcdefghijklmnopqrstuvwxyz123456"'],
    ['single-quoted viewer role token', "VIEWER_TOKEN='abcdefghijklmnopqrstuvwxyz123456'"],
    ['quoted mixed-case submitter role token', 'submitter_token = "abcdefghijklmnopqrstuvwxyz123456"'],
    ['openai-shaped token', 'sk-abcdefghijklmnopqrstuvwx1234567890'],
  ]) {
    const changed = structuredClone(base);
    changed.gates[0].evidence = secretText;
    expectRejected(changed, 'SECRET_MATERIAL_DETECTED', label);
  }
});

test('manifest rejects schema-level secret fields and any attempt to pre-authorize actions', () => {
  const secret = structuredClone(base);
  secret.secrets[0].value = 'replace-with-random-viewer-token';
  expectRejected(secret, 'SCHEMA_INVALID', 'secret field');

  const approved = structuredClone(base);
  approved.authorizationPacket.approvedActionIds = ['PROD-01-TARGET-READONLY-PREFLIGHT'];
  expectRejected(approved, 'SCHEMA_INVALID', 'pre-approved action');
});

test('manifest rejects blanket approval and incomplete blocker surfaces', () => {
  const blanket = structuredClone(base);
  blanket.authorizationPacket.blanketApprovalAllowed = true;
  expectRejected(blanket, 'SCHEMA_INVALID', 'blanket approval');

  for (const blockerId of [
    'WO06C_VCP_EXTERNAL',
    'DINGTALK_TARGET_BINDING',
    'CUTOVER_FORWARD_CHAIN',
    'CUTOVER_SWITCH_RECOVERY',
    'TARGET_HOST_BINDING',
    'CONTAINER_START_READINESS',
    'HEALTH_SMOKE_READINESS',
    'PROXY_BACKEND_READINESS',
    'PRODUCTION_IMPORT_STORAGE_READINESS',
    'INTEGRATION_DEPLOYMENT_READINESS',
  ]) {
    const missing = structuredClone(base);
    missing.authorizationPacket.blockingGateIds =
      missing.authorizationPacket.blockingGateIds.filter(id => id !== blockerId);
    expectRejected(missing, 'AUTHORIZATION_BLOCKER_SET_INVALID', `missing ${blockerId}`);
  }

  const staleExtra = structuredClone(base);
  staleExtra.authorizationPacket.blockingGateIds.push('WO06C_DINGTALK_PROVIDER');
  expectRejected(staleExtra, 'AUTHORIZATION_BLOCKER_SET_INVALID', 'non-blocked gate listed');

  const deploymentMissing = structuredClone(base);
  deploymentMissing.authorizationPacket.deploymentBlockingGateIds =
    deploymentMissing.authorizationPacket.deploymentBlockingGateIds
      .filter(id => id !== 'PRODUCTION_TARGET_FACTS');
  expectRejected(
    deploymentMissing,
    'DEPLOYMENT_BLOCKER_SET_INVALID',
    'deployment blocker missing',
  );

  const deploymentWidened = structuredClone(base);
  deploymentWidened.authorizationPacket.deploymentBlockingGateIds.push('DINGTALK_TARGET_BINDING');
  expectRejected(
    deploymentWidened,
    'DEPLOYMENT_BLOCKER_SET_INVALID',
    'action-specific blocker leaked into deployment blocker set',
  );
});

test('every action id is bound to its exact authority target', () => {
  for (const actionId of [
    'PROD-01-TARGET-READONLY-PREFLIGHT',
    'PROD-02-CREATE-ISOLATED-APP-STORAGE',
    'PROD-09-PRODUCTION-DATA-IMPORT',
    'PROD-12-DINGTALK-PROVIDER-INTEGRATION',
    'PROD-13-CUTOVER-SWITCH',
  ]) {
    const changed = structuredClone(base);
    action(changed, actionId).authorityTarget = 'every production host and any operation';
    expectRejected(changed, 'AUTHORITY_TARGET_INVALID', actionId);
  }
});

test('high-risk production actions cannot drop the unresolved target-facts prerequisite', () => {
  for (const actionId of [
    'PROD-09-PRODUCTION-DATA-IMPORT',
    'PROD-10-ENABLE-VCP-REMOTE-SYNC',
    'PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE',
    'PROD-13-CUTOVER-SWITCH',
  ]) {
    const changed = structuredClone(base);
    const candidate = action(changed, actionId);
    candidate.preconditions = candidate.preconditions.filter(gate => gate !== 'PRODUCTION_TARGET_FACTS');
    expectRejected(changed, 'ACTION_PRECONDITIONS_INVALID', actionId);
  }
});

test('every production action keeps its complete frozen prerequisite set', () => {
  for (const [actionId, gate] of [
    ['PROD-09-PRODUCTION-DATA-IMPORT', 'PRODUCTION_DATA_MIGRATION'],
    ['PROD-10-ENABLE-VCP-REMOTE-SYNC', 'WO06C_VCP_EXTERNAL'],
    ['PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE', 'WO06C_KIOSK_DEVICE'],
    ['PROD-13-CUTOVER-SWITCH', 'PRODUCTION_DEPLOYMENT_GATE'],
  ]) {
    const changed = structuredClone(base);
    const candidate = action(changed, actionId);
    candidate.preconditions = candidate.preconditions.filter(entry => entry !== gate);
    expectRejected(changed, 'ACTION_PRECONDITIONS_INVALID', actionId);
  }
});

test('requestable status is frozen empty while exact external targets remain unresolved', () => {
  assert.deepEqual(base.authorizationPacket.requestableActionIds, []);
  assert.deepEqual(
    base.actions.filter(candidate => candidate.status === 'REQUESTABLE_EXPLICIT_AUTHORIZATION'),
    [],
  );

  for (const actionId of [
    'PROD-01-TARGET-READONLY-PREFLIGHT',
    'PROD-12-DINGTALK-PROVIDER-INTEGRATION',
  ]) {
    const changed = structuredClone(base);
    action(changed, actionId).status = 'REQUESTABLE_EXPLICIT_AUTHORIZATION';
    changed.authorizationPacket.requestableActionIds.push(actionId);
    const result = validate(changed);
    assert.equal(result.ok, false, actionId);
    const codes = issueCodes(result);
    assert.equal(codes.has('ACTION_STATUS_INVALID'), true, actionId);
    assert.equal(codes.has('REQUESTABLE_ACTION_SET_INVALID'), true, actionId);
    assert.equal(codes.has('REQUESTABLE_STATUS_SET_INVALID'), true, actionId);
  }
});

test('target preflight depends on candidate host binding, not facts it is responsible for discovering', () => {
  const gate = base.gates.find(candidate => candidate.id === 'TARGET_HOST_BINDING');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.evidence, 'EXACT_CANDIDATE_PRODUCTION_HOST_UNRESOLVED');

  const preflight = action(base, 'PROD-01-TARGET-READONLY-PREFLIGHT');
  assert.deepEqual(preflight.preconditions, ['TARGET_HOST_BINDING']);
  assert.equal(preflight.preconditions.includes('PRODUCTION_TARGET_FACTS'), false);
  assert.equal(preflight.evidenceRequired.includes('BOUND_HOST_IDENTITY_MATCH'), true);
  assert.equal(preflight.evidenceRequired.includes('DISK_CAPACITY'), true);
  assert.equal(preflight.evidenceRequired.includes('TLS_BINDING_FACTS'), true);

  const cycle = structuredClone(base);
  action(cycle, 'PROD-01-TARGET-READONLY-PREFLIGHT').preconditions =
    ['PRODUCTION_TARGET_FACTS'];
  expectRejected(cycle, 'ACTION_PRECONDITIONS_INVALID', 'target-preflight cycle restored');

  const missingBinding = structuredClone(base);
  action(missingBinding, 'PROD-01-TARGET-READONLY-PREFLIGHT').preconditions = [];
  expectRejected(missingBinding, 'ACTION_PRECONDITIONS_INVALID', 'host binding removed');

  const forgedBinding = structuredClone(base);
  forgedBinding.gates.find(candidate => candidate.id === 'TARGET_HOST_BINDING').status = 'SATISFIED';
  expectRejected(forgedBinding, 'GATE_STATUS_INVALID', 'host binding cannot self-promote');
});

test('DingTalk candidates cannot become requestable before exact app/provider and bounded destination binding', () => {
  const baseAction = action(base, 'PROD-12-DINGTALK-PROVIDER-INTEGRATION');
  assert.equal(baseAction.status, 'BLOCKED_PREREQUISITE');
  assert.equal(baseAction.authorityTarget, 'UNRESOLVED_DINGTALK_TARGET_BINDING');
  assert.equal(baseAction.preconditions.includes('DINGTALK_TARGET_BINDING'), true);
  assert.equal(
    base.authorizationPacket.requestableActionIds.includes('PROD-12-DINGTALK-PROVIDER-INTEGRATION'),
    false,
  );

  for (const authorityTarget of [
    'DingTalk app/provider APP_A -> bounded destination RECIPIENT_A',
    'DingTalk app/provider APP_B -> bounded destination RECIPIENT_B',
  ]) {
    const changed = structuredClone(base);
    const candidate = action(changed, 'PROD-12-DINGTALK-PROVIDER-INTEGRATION');
    candidate.status = 'REQUESTABLE_EXPLICIT_AUTHORIZATION';
    candidate.authorityTarget = authorityTarget;
    candidate.preconditions = ['WO06C_DINGTALK_PROVIDER'];
    changed.authorizationPacket.requestableActionIds.push('PROD-12-DINGTALK-PROVIDER-INTEGRATION');

    const result = validate(changed);
    assert.equal(result.ok, false, authorityTarget);
    const codes = issueCodes(result);
    for (const code of [
      'ACTION_STATUS_INVALID',
      'AUTHORITY_TARGET_INVALID',
      'ACTION_PRECONDITIONS_INVALID',
      'REQUESTABLE_ACTION_SET_INVALID',
      'REQUESTABLE_STATUS_SET_INVALID',
    ]) assert.equal(codes.has(code), true, `${authorityTarget}: ${code}`);
  }
});

test('each action keeps its exact rollback binding, not merely any rollback-category reference', () => {
  for (const [actionId, replacement] of [
    ['PROD-03-GENERATE-INSTALL-TOKENS', ['ROLLBACK-03-DISABLE-EXTERNAL-CONFIG']],
    ['PROD-04-BUILD-IMAGE', []],
    ['PROD-05-START-ISOLATED-CONTAINER', ['ROLLBACK-01-REMOVE-NEW-ROUTE']],
    ['PROD-09-PRODUCTION-DATA-IMPORT', ['ROLLBACK-01-REMOVE-NEW-ROUTE']],
    ['PROD-10-ENABLE-VCP-REMOTE-SYNC', ['ROLLBACK-04-PRESERVE-DATA-VOLUME']],
    ['PROD-13-CUTOVER-SWITCH', ['ROLLBACK-02-STOP-NEW-CONTAINER']],
  ]) {
    const changed = structuredClone(base);
    action(changed, actionId).rollbackActionIds = replacement;
    expectRejected(changed, 'ROLLBACK_BINDING_INVALID', actionId);
  }
});

test('rollback references still reject non-rollback actions independently of exact binding', () => {
  const changed = structuredClone(base);
  action(changed, 'PROD-05-START-ISOLATED-CONTAINER')
    .rollbackActionIds = ['PROD-04-BUILD-IMAGE'];
  const result = validate(changed);
  assert.equal(result.ok, false);
  assert.equal(issueCodes(result).has('ROLLBACK_BINDING_INVALID'), true);
  assert.equal(issueCodes(result).has('ROLLBACK_REFERENCE_INVALID'), true);
});

test('hostile manifest cannot add or replace a frozen action id', () => {
  const added = structuredClone(base);
  added.actions.push({
    ...structuredClone(added.actions[0]),
    id: 'PROD-99-BLANKET-OPERATIONS',
    title: 'Blanket operations',
  });
  expectRejected(added, 'ACTION_SET_INVALID', 'extra action');

  const replaced = structuredClone(base);
  action(replaced, 'PROD-02-CREATE-ISOLATED-APP-STORAGE').id = 'PROD-99-REPLACED-STORAGE';
  expectRejected(replaced, 'ACTION_SET_INVALID', 'replaced action');
});

test('hostile combined mutation cannot widen target, requestability and rollback in one edit', () => {
  const changed = structuredClone(base);
  const candidate = action(changed, 'PROD-09-PRODUCTION-DATA-IMPORT');
  candidate.status = 'REQUESTABLE_EXPLICIT_AUTHORIZATION';
  candidate.authorityTarget = 'all hosts, all databases, any migration';
  candidate.preconditions = ['PRODUCTION_DEPLOYMENT_GATE'];
  candidate.rollbackActionIds = ['ROLLBACK-01-REMOVE-NEW-ROUTE'];
  changed.gates[0].evidence = 'Bearer 12345678901234567890123456789012';

  const result = validate(changed);
  assert.equal(result.ok, false);
  const codes = issueCodes(result);
  for (const code of [
    'ACTION_STATUS_INVALID',
    'AUTHORITY_TARGET_INVALID',
    'ACTION_PRECONDITIONS_INVALID',
    'ROLLBACK_BINDING_INVALID',
    'REQUESTABLE_STATUS_SET_INVALID',
    'SECRET_MATERIAL_DETECTED',
  ]) assert.equal(codes.has(code), true, code);
});


test('authority lineage is frozen to the declared base commit', () => {
  const changed = structuredClone(base);
  changed.authorityBase = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const result = validate(changed);
  assert.equal(result.ok, false);
  assert.equal(
    issueCodes(result).has('SCHEMA_INVALID') || issueCodes(result).has('AUTHORITY_BASE_INVALID'),
    true,
    JSON.stringify(result.issues),
  );
});

test('critical action risk, side effect and evidence contract cannot be understated', () => {
  const cases = [
    ['risk', 'LOW', 'ACTION_RISK_INVALID'],
    ['sideEffect', 'READ_ONLY', 'ACTION_SIDE_EFFECT_INVALID'],
    ['evidenceRequired', ['OK'], 'ACTION_EVIDENCE_REQUIRED_INVALID'],
  ];
  for (const [field, replacement, code] of cases) {
    const changed = structuredClone(base);
    action(changed, 'PROD-09-PRODUCTION-DATA-IMPORT')[field] = replacement;
    expectRejected(changed, code, `PROD-09 ${field}`);
  }
});

test('initial preflight is exempt from all later-stage revalidation checks', () => {
  assert.deepEqual(
    base.authorizationPacket.mustRevalidateBeforeRequest,
    ['AUTHORITY_HEAD'],
  );
  assert.equal(
    Object.hasOwn(
      base.authorizationPacket.actionSpecificRevalidation,
      'PROD-01-TARGET-READONLY-PREFLIGHT',
    ),
    false,
  );

  for (const forbidden of [
    'TARGET_HOST_IDENTITY',
    'DISK_PORT_ROUTE_CONFLICTS',
    'BACKUP_ROLLBACK_PROOF',
    'SECRET_STORAGE',
    'EXTERNAL_READINESS_GATES',
    'ROLLBACK_TARGETS',
    'BUILT_IMAGE_DIGEST',
  ]) {
    assert.equal(
      base.authorizationPacket.mustRevalidateBeforeRequest.includes(forbidden),
      false,
      forbidden,
    );
  }

  assert.deepEqual(
    base.authorizationPacket.actionSpecificRevalidation['PROD-02-CREATE-ISOLATED-APP-STORAGE'],
    ['TARGET_HOST_IDENTITY', 'DISK_PORT_ROUTE_CONFLICTS', 'ROLLBACK_TARGETS'],
  );
  assert.deepEqual(
    base.authorizationPacket.actionSpecificRevalidation['PROD-03-GENERATE-INSTALL-TOKENS'],
    ['TARGET_HOST_IDENTITY', 'DISK_PORT_ROUTE_CONFLICTS', 'SECRET_STORAGE', 'ROLLBACK_TARGETS'],
  );
  assert.deepEqual(
    base.authorizationPacket.actionSpecificRevalidation['PROD-04-BUILD-IMAGE'],
    [
      'TARGET_HOST_IDENTITY',
      'DISK_PORT_ROUTE_CONFLICTS',
      'BUILD_SOURCE_AUTHORITY_COMMIT',
      'BUILD_BASE_IMAGE_DIGEST',
    ],
  );
  assert.deepEqual(
    base.authorizationPacket.actionSpecificRevalidation['PROD-09-PRODUCTION-DATA-IMPORT'],
    [
      'TARGET_HOST_IDENTITY',
      'DISK_PORT_ROUTE_CONFLICTS',
      'BACKUP_ROLLBACK_PROOF',
      'IMPORT_TARGET_SQLITE_ABSENCE_PROOF',
      'SOURCE_QUIESCENCE_OR_COORDINATION_PROOF',
      'ROLLBACK_TARGETS',
    ],
  );
  assert.deepEqual(
    base.authorizationPacket.actionSpecificRevalidation['PROD-12-DINGTALK-PROVIDER-INTEGRATION'],
    ['SECRET_STORAGE', 'EXTERNAL_READINESS_GATES', 'ROLLBACK_TARGETS'],
  );
  assert.deepEqual(
    base.authorizationPacket.actionSpecificRevalidation['PROD-13-CUTOVER-SWITCH'],
    [
      'TARGET_HOST_IDENTITY',
      'DISK_PORT_ROUTE_CONFLICTS',
      'BUILT_IMAGE_DIGEST',
      'BACKUP_ROLLBACK_PROOF',
      'EXTERNAL_READINESS_GATES',
      'ROLLBACK_TARGETS',
    ],
  );

  const pollutedGlobal = structuredClone(base);
  pollutedGlobal.authorizationPacket.mustRevalidateBeforeRequest.push('BACKUP_ROLLBACK_PROOF');
  expectRejected(
    pollutedGlobal,
    'REVALIDATION_CHECKLIST_INVALID',
    'later-stage backup proof cannot become a global preflight prerequisite',
  );

  const earlyExternal = structuredClone(base);
  earlyExternal.authorizationPacket.actionSpecificRevalidation[
    'PROD-01-TARGET-READONLY-PREFLIGHT'
  ] = ['EXTERNAL_READINESS_GATES'];
  expectRejected(
    earlyExternal,
    'ACTION_REVALIDATION_SET_INVALID',
    'preflight cannot require external readiness',
  );

  const missingBackup = structuredClone(base);
  missingBackup.authorizationPacket.actionSpecificRevalidation[
    'PROD-09-PRODUCTION-DATA-IMPORT'
  ] = [
    'TARGET_HOST_IDENTITY',
    'DISK_PORT_ROUTE_CONFLICTS',
    'IMPORT_TARGET_SQLITE_ABSENCE_PROOF',
    'SOURCE_QUIESCENCE_OR_COORDINATION_PROOF',
    'ROLLBACK_TARGETS',
  ];
  expectRejected(
    missingBackup,
    'ACTION_REVALIDATION_INVALID',
    'production import cannot drop backup rollback proof',
  );

  const missingExternal = structuredClone(base);
  missingExternal.authorizationPacket.actionSpecificRevalidation[
    'PROD-10-ENABLE-VCP-REMOTE-SYNC'
  ] = [
    'TARGET_HOST_IDENTITY',
    'DISK_PORT_ROUTE_CONFLICTS',
    'BUILT_IMAGE_DIGEST',
    'SECRET_STORAGE',
    'ROLLBACK_TARGETS',
  ];
  expectRejected(
    missingExternal,
    'ACTION_REVALIDATION_INVALID',
    'VCP enablement cannot drop external readiness',
  );

  const buildCycle = structuredClone(base);
  buildCycle.authorizationPacket.actionSpecificRevalidation['PROD-04-BUILD-IMAGE'] =
    [
      'TARGET_HOST_IDENTITY',
      'DISK_PORT_ROUTE_CONFLICTS',
      'BUILT_IMAGE_DIGEST',
      'BUILD_BASE_IMAGE_DIGEST',
    ];
  expectRejected(
    buildCycle,
    'ACTION_REVALIDATION_INVALID',
    'build cannot require its own output digest',
  );
});

test('target unresolved-fact set and global invariants are frozen', () => {
  const targetFacts = structuredClone(base);
  targetFacts.target.unresolvedFacts = targetFacts.target.unresolvedFacts
    .filter(value => value !== 'TARGET_HOST_IDENTITY');
  expectRejected(targetFacts, 'TARGET_UNRESOLVED_FACTS_INVALID', 'target fact removal');

  const invariants = structuredClone(base);
  invariants.invariants = invariants.invariants
    .filter(value => value !== 'NO_SECRET_IN_GIT_LOGS_CHAT');
  expectRejected(invariants, 'INVARIANT_SET_INVALID', 'invariant removal');
});

test('gate evidence cannot be rewritten to weaken the documented blocker', () => {
  const changed = structuredClone(base);
  const gate = changed.gates.find(candidate => candidate.id === 'WO06C_VCP_EXTERNAL');
  gate.evidence = 'PASS';
  expectRejected(changed, 'GATE_EVIDENCE_INVALID', 'gate evidence drift');
});

test('action title, category and effects remain bound to the frozen operation meaning', () => {
  for (const [field, replacement, code] of [
    ['title', 'Harmless read-only check', 'ACTION_TITLE_INVALID'],
    ['category', 'TARGET', 'ACTION_CATEGORY_INVALID'],
    ['effects', ['No meaningful effect'], 'ACTION_EFFECTS_INVALID'],
  ]) {
    const changed = structuredClone(base);
    action(changed, 'PROD-13-CUTOVER-SWITCH')[field] = replacement;
    expectRejected(changed, code, `PROD-13 ${field}`);
  }
});

test('hostile combined semantic widening still fails closed after schema admission', () => {
  const changed = structuredClone(base);
  changed.authorizationPacket.mustRevalidateBeforeRequest =
    ['AUTHORITY_HEAD', 'BACKUP_ROLLBACK_PROOF'];
  changed.authorizationPacket.actionSpecificRevalidation['PROD-04-BUILD-IMAGE'] =
    ['TARGET_HOST_IDENTITY', 'DISK_PORT_ROUTE_CONFLICTS', 'BUILT_IMAGE_DIGEST'];
  changed.target.unresolvedFacts = ['TARGET_HOST_IDENTITY'];

  const importAction = action(changed, 'PROD-09-PRODUCTION-DATA-IMPORT');
  importAction.risk = 'LOW';
  importAction.sideEffect = 'READ_ONLY';
  importAction.evidenceRequired = ['OK'];
  importAction.authorityTarget = 'any database';

  const result = validate(changed);
  assert.equal(result.ok, false);
  const codes = issueCodes(result);
  for (const code of [
    'REVALIDATION_CHECKLIST_INVALID',
    'ACTION_REVALIDATION_INVALID',
    'TARGET_UNRESOLVED_FACTS_INVALID',
    'ACTION_RISK_INVALID',
    'ACTION_SIDE_EFFECT_INVALID',
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'AUTHORITY_TARGET_INVALID',
  ]) assert.equal(codes.has(code), true, code);
});


test('container startup remains blocked until storage, tokens, image, and production import complete', () => {
  const gate = base.gates.find(candidate => candidate.id === 'CONTAINER_START_READINESS');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.evidence, 'REQUIRES_VERIFIED_PROD_02_03_04_09');

  const start = action(base, 'PROD-05-START-ISOLATED-CONTAINER');
  assert.equal(start.preconditions.includes('CONTAINER_START_READINESS'), true);
  assert.equal(
    start.evidenceRequired.includes('STORAGE_TOKEN_IMAGE_PREDECESSOR_PROOF'),
    true,
  );
  assert.equal(
    start.evidenceRequired.includes('PRODUCTION_IMPORT_COMPLETION_PROOF'),
    true,
  );

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-05-START-ISOLATED-CONTAINER').preconditions =
    action(droppedGate, 'PROD-05-START-ISOLATED-CONTAINER').preconditions
      .filter(id => id !== 'CONTAINER_START_READINESS');
  expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', 'container predecessor gate removed');

  const droppedProof = structuredClone(base);
  action(droppedProof, 'PROD-05-START-ISOLATED-CONTAINER').evidenceRequired =
    action(droppedProof, 'PROD-05-START-ISOLATED-CONTAINER').evidenceRequired
      .filter(id => id !== 'STORAGE_TOKEN_IMAGE_PREDECESSOR_PROOF');
  expectRejected(
    droppedProof,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'container predecessor proof removed',
  );

  const droppedImportProof = structuredClone(base);
  action(droppedImportProof, 'PROD-05-START-ISOLATED-CONTAINER').evidenceRequired =
    action(droppedImportProof, 'PROD-05-START-ISOLATED-CONTAINER').evidenceRequired
      .filter(id => id !== 'PRODUCTION_IMPORT_COMPLETION_PROOF');
  expectRejected(
    droppedImportProof,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'container cannot start before verified production import completion',
  );

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(candidate => candidate.id === 'CONTAINER_START_READINESS').status =
    'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'container readiness cannot self-promote');
});

test('health smoke remains blocked until the isolated container has started successfully', () => {
  const gate = base.gates.find(candidate => candidate.id === 'HEALTH_SMOKE_READINESS');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.evidence, 'REQUIRES_VERIFIED_PROD_05');

  const health = action(base, 'PROD-06-LOOPBACK-HEALTH-SMOKE');
  assert.equal(health.preconditions.includes('HEALTH_SMOKE_READINESS'), true);
  assert.equal(health.evidenceRequired.includes('CONTAINER_START_COMPLETION_PROOF'), true);

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-06-LOOPBACK-HEALTH-SMOKE').preconditions =
    action(droppedGate, 'PROD-06-LOOPBACK-HEALTH-SMOKE').preconditions
      .filter(id => id !== 'HEALTH_SMOKE_READINESS');
  expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', 'health predecessor gate removed');

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(candidate => candidate.id === 'HEALTH_SMOKE_READINESS').status =
    'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'health readiness cannot self-promote');
});


test('proxy exposure remains blocked until build, start, and health verification are complete', () => {
  const gate = base.gates.find(candidate => candidate.id === 'PROXY_BACKEND_READINESS');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.evidence, 'REQUIRES_VERIFIED_PROD_04_05_06');

  const proxy = action(base, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS');
  assert.equal(proxy.preconditions.includes('PROXY_BACKEND_READINESS'), true);
  assert.equal(proxy.evidenceRequired.includes('BACKEND_BUILD_START_HEALTH_PROOF'), true);

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS').preconditions =
    action(droppedGate, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS').preconditions
      .filter(id => id !== 'PROXY_BACKEND_READINESS');
  expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', 'proxy backend gate removed');

  const droppedEvidence = structuredClone(base);
  action(droppedEvidence, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS').evidenceRequired =
    action(droppedEvidence, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS').evidenceRequired
      .filter(id => id !== 'BACKEND_BUILD_START_HEALTH_PROOF');
  expectRejected(
    droppedEvidence,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'proxy backend proof removed',
  );

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(candidate => candidate.id === 'PROXY_BACKEND_READINESS').status = 'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'proxy backend gate cannot self-promote');
});


test('production import remains blocked until isolated storage preparation completes', () => {
  const gate = base.gates.find(
    candidate => candidate.id === 'PRODUCTION_IMPORT_STORAGE_READINESS',
  );
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.evidence, 'REQUIRES_VERIFIED_PROD_02');

  const dataImport = action(base, 'PROD-09-PRODUCTION-DATA-IMPORT');
  assert.equal(
    dataImport.preconditions.includes('PRODUCTION_IMPORT_STORAGE_READINESS'),
    true,
  );
  assert.equal(
    dataImport.evidenceRequired.includes('STORAGE_PREPARATION_COMPLETION_PROOF'),
    true,
  );

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-09-PRODUCTION-DATA-IMPORT').preconditions =
    action(droppedGate, 'PROD-09-PRODUCTION-DATA-IMPORT').preconditions
      .filter(id => id !== 'PRODUCTION_IMPORT_STORAGE_READINESS');
  expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', 'import storage gate removed');

  const droppedProof = structuredClone(base);
  action(droppedProof, 'PROD-09-PRODUCTION-DATA-IMPORT').evidenceRequired =
    action(droppedProof, 'PROD-09-PRODUCTION-DATA-IMPORT').evidenceRequired
      .filter(id => id !== 'STORAGE_PREPARATION_COMPLETION_PROOF');
  expectRejected(
    droppedProof,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'import storage completion proof removed',
  );

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(
    candidate => candidate.id === 'PRODUCTION_IMPORT_STORAGE_READINESS',
  ).status = 'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'import storage gate cannot self-promote');
});

test('production import requires an absent target SQLite path and precedes container initialization', () => {
  const gate = base.gates.find(
    candidate => candidate.id === 'PRODUCTION_IMPORT_TARGET_ABSENCE',
  );
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(
    gate.evidence,
    'REQUIRES_TARGET_SQLITE_PATH_ABSENT_BEFORE_PROD_05',
  );

  const dataImport = action(base, 'PROD-09-PRODUCTION-DATA-IMPORT');
  assert.equal(
    dataImport.preconditions.includes('PRODUCTION_IMPORT_TARGET_ABSENCE'),
    true,
  );
  assert.equal(
    dataImport.evidenceRequired.includes('IMPORT_TARGET_SQLITE_ABSENCE_PROOF'),
    true,
  );
  assert.equal(
    base.authorizationPacket.actionSpecificRevalidation[
      'PROD-09-PRODUCTION-DATA-IMPORT'
    ].includes('IMPORT_TARGET_SQLITE_ABSENCE_PROOF'),
    true,
  );

  const containerGate = base.gates.find(
    candidate => candidate.id === 'CONTAINER_START_READINESS',
  );
  assert.equal(containerGate.evidence, 'REQUIRES_VERIFIED_PROD_02_03_04_09');

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-09-PRODUCTION-DATA-IMPORT').preconditions =
    action(droppedGate, 'PROD-09-PRODUCTION-DATA-IMPORT').preconditions
      .filter(id => id !== 'PRODUCTION_IMPORT_TARGET_ABSENCE');
  expectRejected(
    droppedGate,
    'ACTION_PRECONDITIONS_INVALID',
    'import target absence gate removed',
  );

  const droppedRevalidation = structuredClone(base);
  droppedRevalidation.authorizationPacket.actionSpecificRevalidation[
    'PROD-09-PRODUCTION-DATA-IMPORT'
  ] = droppedRevalidation.authorizationPacket.actionSpecificRevalidation[
    'PROD-09-PRODUCTION-DATA-IMPORT'
  ].filter(id => id !== 'IMPORT_TARGET_SQLITE_ABSENCE_PROOF');
  expectRejected(
    droppedRevalidation,
    'ACTION_REVALIDATION_INVALID',
    'import target absence proof removed',
  );

  const droppedEvidence = structuredClone(base);
  action(droppedEvidence, 'PROD-09-PRODUCTION-DATA-IMPORT').evidenceRequired =
    action(droppedEvidence, 'PROD-09-PRODUCTION-DATA-IMPORT').evidenceRequired
      .filter(id => id !== 'IMPORT_TARGET_SQLITE_ABSENCE_PROOF');
  expectRejected(
    droppedEvidence,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'import target absence evidence removed',
  );

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(
    candidate => candidate.id === 'PRODUCTION_IMPORT_TARGET_ABSENCE',
  ).status = 'SATISFIED';
  expectRejected(
    forgedGate,
    'GATE_STATUS_INVALID',
    'target absence gate cannot self-promote',
  );
});


test('production import requires offline source quiescence or verified upload/migration coordination', () => {
  const gate = base.gates.find(
    candidate => candidate.id === 'PRODUCTION_IMPORT_SOURCE_CONSISTENCY',
  );
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(
    gate.evidence,
    'REQUIRES_OFFLINE_SOURCE_QUIESCENCE_OR_VERIFIED_UPLOAD_MIGRATION_COORDINATION',
  );

  const dataImport = action(base, 'PROD-09-PRODUCTION-DATA-IMPORT');
  assert.equal(
    dataImport.preconditions.includes('PRODUCTION_IMPORT_SOURCE_CONSISTENCY'),
    true,
  );
  assert.equal(
    dataImport.evidenceRequired.includes('SOURCE_QUIESCENCE_OR_COORDINATION_PROOF'),
    true,
  );
  assert.equal(
    base.authorizationPacket.actionSpecificRevalidation[
      'PROD-09-PRODUCTION-DATA-IMPORT'
    ].includes('SOURCE_QUIESCENCE_OR_COORDINATION_PROOF'),
    true,
  );

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-09-PRODUCTION-DATA-IMPORT').preconditions =
    action(droppedGate, 'PROD-09-PRODUCTION-DATA-IMPORT').preconditions
      .filter(id => id !== 'PRODUCTION_IMPORT_SOURCE_CONSISTENCY');
  expectRejected(
    droppedGate,
    'ACTION_PRECONDITIONS_INVALID',
    'production import source-consistency gate removed',
  );

  const droppedRevalidation = structuredClone(base);
  droppedRevalidation.authorizationPacket.actionSpecificRevalidation[
    'PROD-09-PRODUCTION-DATA-IMPORT'
  ] = droppedRevalidation.authorizationPacket.actionSpecificRevalidation[
    'PROD-09-PRODUCTION-DATA-IMPORT'
  ].filter(id => id !== 'SOURCE_QUIESCENCE_OR_COORDINATION_PROOF');
  expectRejected(
    droppedRevalidation,
    'ACTION_REVALIDATION_INVALID',
    'production import source-state proof removed',
  );

  const droppedEvidence = structuredClone(base);
  action(droppedEvidence, 'PROD-09-PRODUCTION-DATA-IMPORT').evidenceRequired =
    action(droppedEvidence, 'PROD-09-PRODUCTION-DATA-IMPORT').evidenceRequired
      .filter(id => id !== 'SOURCE_QUIESCENCE_OR_COORDINATION_PROOF');
  expectRejected(
    droppedEvidence,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'production import source-state evidence removed',
  );

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(
    candidate => candidate.id === 'PRODUCTION_IMPORT_SOURCE_CONSISTENCY',
  ).status = 'SATISFIED';
  expectRejected(
    forgedGate,
    'GATE_STATUS_INVALID',
    'source consistency gate cannot self-promote',
  );
});


test('VCP and Kiosk enablement remain blocked until the deployment chain is complete', () => {
  const gate = base.gates.find(candidate => candidate.id === 'INTEGRATION_DEPLOYMENT_READINESS');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(
    gate.evidence,
    'REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_AND_PROD_08_IF_USED',
  );

  for (const actionId of [
    'PROD-10-ENABLE-VCP-REMOTE-SYNC',
    'PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE',
  ]) {
    const candidate = action(base, actionId);
    assert.equal(candidate.preconditions.includes('INTEGRATION_DEPLOYMENT_READINESS'), true);
    assert.equal(candidate.evidenceRequired.includes('DEPLOYMENT_CHAIN_COMPLETION_PROOF'), true);

    const droppedGate = structuredClone(base);
    action(droppedGate, actionId).preconditions =
      action(droppedGate, actionId).preconditions
        .filter(id => id !== 'INTEGRATION_DEPLOYMENT_READINESS');
    expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', `${actionId} deployment gate removed`);

    const droppedProof = structuredClone(base);
    action(droppedProof, actionId).evidenceRequired =
      action(droppedProof, actionId).evidenceRequired
        .filter(id => id !== 'DEPLOYMENT_CHAIN_COMPLETION_PROOF');
    expectRejected(
      droppedProof,
      'ACTION_EVIDENCE_REQUIRED_INVALID',
      `${actionId} deployment proof removed`,
    );
  }

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(
    candidate => candidate.id === 'INTEGRATION_DEPLOYMENT_READINESS',
  ).status = 'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'integration readiness cannot self-promote');
});


test('cutover remains blocked until the frozen forward deployment chain is verified', () => {
  const gate = base.gates.find(candidate => candidate.id === 'CUTOVER_FORWARD_CHAIN');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(
    gate.evidence,
    'REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_10_11_AND_PROD_08_IF_USED',
  );

  const cutover = action(base, 'PROD-13-CUTOVER-SWITCH');
  assert.equal(cutover.preconditions.includes('CUTOVER_FORWARD_CHAIN'), true);
  assert.equal(cutover.evidenceRequired.includes('FORWARD_CHAIN_COMPLETION_PROOF'), true);
  assert.equal(
    cutover.evidenceRequired.includes('VCP_KIOSK_ENABLEMENT_COMPLETION_PROOF'),
    true,
  );

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-13-CUTOVER-SWITCH').preconditions =
    action(droppedGate, 'PROD-13-CUTOVER-SWITCH').preconditions
      .filter(id => id !== 'CUTOVER_FORWARD_CHAIN');
  expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', 'cutover forward-chain gate removed');

  const droppedEvidence = structuredClone(base);
  action(droppedEvidence, 'PROD-13-CUTOVER-SWITCH').evidenceRequired =
    action(droppedEvidence, 'PROD-13-CUTOVER-SWITCH').evidenceRequired
      .filter(id => id !== 'FORWARD_CHAIN_COMPLETION_PROOF');
  expectRejected(
    droppedEvidence,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'cutover completion proof removed',
  );

  const droppedIntegrationProof = structuredClone(base);
  action(droppedIntegrationProof, 'PROD-13-CUTOVER-SWITCH').evidenceRequired =
    action(droppedIntegrationProof, 'PROD-13-CUTOVER-SWITCH').evidenceRequired
      .filter(id => id !== 'VCP_KIOSK_ENABLEMENT_COMPLETION_PROOF');
  expectRejected(
    droppedIntegrationProof,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'VCP/Kiosk enablement completion proof removed',
  );

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(candidate => candidate.id === 'CUTOVER_FORWARD_CHAIN').status = 'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'cutover chain cannot be self-promoted');
});

test('cutover is blocked until post-Switch authority restoration is designed and bound', () => {
  const gate = base.gates.find(candidate => candidate.id === 'CUTOVER_SWITCH_RECOVERY');
  assert.ok(gate);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(
    gate.evidence,
    'POST_SWITCH_DUAL_READ_COMPATIBLE_WRITE_AND_SWITCH_RECORD_NOT_DESIGNED',
  );

  const cutover = action(base, 'PROD-13-CUTOVER-SWITCH');
  assert.equal(cutover.preconditions.includes('CUTOVER_SWITCH_RECOVERY'), true);
  assert.equal(
    cutover.rollbackActionIds.includes('ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH'),
    true,
  );
  for (const evidence of [
    'POST_SWITCH_RECOVERY_DESIGN',
    'DUAL_READ_COMPATIBLE_WRITE_RECOVERY_PROOF',
    'SWITCH_RECORD',
  ]) assert.equal(cutover.evidenceRequired.includes(evidence), true, evidence);

  const switchRollback = action(base, 'ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH');
  assert.equal(switchRollback.category, 'ROLLBACK');
  assert.equal(switchRollback.status, 'BLOCKED_PREREQUISITE');
  assert.equal(switchRollback.requiresExplicitAuthorization, false);
  assert.deepEqual(switchRollback.preconditions, ['CUTOVER_SWITCH_RECOVERY']);
  assert.equal(
    switchRollback.authorityTarget,
    'UNRESOLVED_POST_SWITCH_AUTHORITY_RECOVERY_CAPABILITY',
  );
  assert.equal(base.rollbackPlan.orderedActionIds.includes(switchRollback.id), false);
  assert.equal(
    deriveCoauthorizedRollbackActionIds(base.actions, ['PROD-13-CUTOVER-SWITCH'])
      .includes(switchRollback.id),
    false,
  );

  const droppedGate = structuredClone(base);
  action(droppedGate, 'PROD-13-CUTOVER-SWITCH').preconditions =
    action(droppedGate, 'PROD-13-CUTOVER-SWITCH').preconditions
      .filter(id => id !== 'CUTOVER_SWITCH_RECOVERY');
  expectRejected(droppedGate, 'ACTION_PRECONDITIONS_INVALID', 'switch recovery gate removed');

  const droppedRollback = structuredClone(base);
  action(droppedRollback, 'PROD-13-CUTOVER-SWITCH').rollbackActionIds =
    action(droppedRollback, 'PROD-13-CUTOVER-SWITCH').rollbackActionIds
      .filter(id => id !== 'ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH');
  expectRejected(droppedRollback, 'ROLLBACK_BINDING_INVALID', 'switch restore rollback removed');

  const forgedGate = structuredClone(base);
  forgedGate.gates.find(candidate => candidate.id === 'CUTOVER_SWITCH_RECOVERY').status = 'SATISFIED';
  expectRejected(forgedGate, 'GATE_STATUS_INVALID', 'switch recovery cannot be self-promoted');

  const forgedRollback = structuredClone(base);
  action(forgedRollback, 'ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH').status = 'ROLLBACK_ONLY';
  expectRejected(forgedRollback, 'ACTION_STATUS_INVALID', 'blocked switch rollback cannot be activated');
});


test('rollback authority is derived from approved forward actions without a second approval', () => {
  assert.deepEqual(
    deriveCoauthorizedRollbackActionIds(base.actions, [
      'PROD-03-GENERATE-INSTALL-TOKENS',
      'PROD-07-CONFIGURE-REVERSE-PROXY-TLS',
    ]),
    [
      'ROLLBACK-01-REMOVE-NEW-ROUTE',
      'ROLLBACK-06-REVOKE-ROLE-TOKENS',
    ],
  );

  assert.deepEqual(
    deriveCoauthorizedRollbackActionIds(
      base.actions,
      base.actions.filter(candidate => candidate.id.startsWith('PROD-')).map(candidate => candidate.id),
    ),
    [
      'ROLLBACK-01-REMOVE-NEW-ROUTE',
      'ROLLBACK-02-STOP-NEW-CONTAINER',
      'ROLLBACK-04-PRESERVE-DATA-VOLUME',
      'ROLLBACK-05-REVERT-FIREWALL-RULE',
      'ROLLBACK-06-REVOKE-ROLE-TOKENS',
      'ROLLBACK-08-REMOVE-BUILT-IMAGE',
      'ROLLBACK-09-DISABLE-VCP-CONFIG',
      'ROLLBACK-10-DISABLE-KIOSK-CONFIG',
      'ROLLBACK-11-DISABLE-DINGTALK-CONFIG',
    ],
  );

  for (const rollback of base.actions.filter(candidate => candidate.status === 'ROLLBACK_ONLY')) {
    assert.equal(rollback.requiresExplicitAuthorization, false, rollback.id);
  }
  assert.equal(
    action(base, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS').requiresExplicitAuthorization,
    true,
  );

  const forgedDerived = structuredClone(base);
  forgedDerived.authorizationPacket.derivedRollbackActionIds = ['ROLLBACK-01-REMOVE-NEW-ROUTE'];
  expectRejected(
    forgedDerived,
    'DERIVED_ROLLBACK_AUTHORITY_INVALID',
    'rollback authority cannot exist without an approved forward action',
  );

  const secondApproval = structuredClone(base);
  action(secondApproval, 'ROLLBACK-01-REMOVE-NEW-ROUTE').requiresExplicitAuthorization = true;
  expectRejected(
    secondApproval,
    'ACTION_AUTHORIZATION_MODE_INVALID',
    'rollback cannot demand a second standalone approval',
  );
});


test('integration rollback authority stays scoped to its originating forward action', () => {
  const cases = [
    [
      'PROD-10-ENABLE-VCP-REMOTE-SYNC',
      'ROLLBACK-09-DISABLE-VCP-CONFIG',
      ['ROLLBACK-10-DISABLE-KIOSK-CONFIG', 'ROLLBACK-11-DISABLE-DINGTALK-CONFIG'],
    ],
    [
      'PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE',
      'ROLLBACK-10-DISABLE-KIOSK-CONFIG',
      ['ROLLBACK-09-DISABLE-VCP-CONFIG', 'ROLLBACK-11-DISABLE-DINGTALK-CONFIG'],
    ],
    [
      'PROD-12-DINGTALK-PROVIDER-INTEGRATION',
      'ROLLBACK-11-DISABLE-DINGTALK-CONFIG',
      ['ROLLBACK-09-DISABLE-VCP-CONFIG', 'ROLLBACK-10-DISABLE-KIOSK-CONFIG'],
    ],
  ];

  for (const [forwardId, expectedRollbackId, forbiddenRollbackIds] of cases) {
    const derived = deriveCoauthorizedRollbackActionIds(base.actions, [forwardId]);
    assert.deepEqual(derived, [expectedRollbackId], forwardId);
    for (const forbiddenId of forbiddenRollbackIds) {
      assert.equal(derived.includes(forbiddenId), false, `${forwardId} must not derive ${forbiddenId}`);
    }
  }

  assert.equal(
    action(base, 'ROLLBACK-09-DISABLE-VCP-CONFIG').authorityTarget.includes('introduced by PROD-10'),
    true,
  );
  assert.equal(
    action(base, 'ROLLBACK-10-DISABLE-KIOSK-CONFIG').authorityTarget.includes('introduced by PROD-11'),
    true,
  );
  assert.equal(
    action(base, 'ROLLBACK-11-DISABLE-DINGTALK-CONFIG').authorityTarget.includes('introduced by PROD-12'),
    true,
  );
});

test('PROD-02 storage creation is intentionally retained rather than misclassified reversible', () => {
  const storage = action(base, 'PROD-02-CREATE-ISOLATED-APP-STORAGE');
  assert.equal(storage.sideEffect, 'IRREVERSIBLE_OR_EXTERNAL');
  assert.deepEqual(storage.rollbackActionIds, ['ROLLBACK-04-PRESERVE-DATA-VOLUME']);
  assert.equal(
    storage.effects.some(value => value.includes('retain the created directory and volume')),
    true,
  );
  assert.equal(storage.evidenceRequired.includes('RETAINED_STORAGE_ARTIFACT_ACKNOWLEDGED'), true);

  const falselyReversible = structuredClone(base);
  action(falselyReversible, 'PROD-02-CREATE-ISOLATED-APP-STORAGE').sideEffect = 'REVERSIBLE';
  expectRejected(
    falselyReversible,
    'ACTION_SIDE_EFFECT_INVALID',
    'retained storage cannot be classified fully reversible',
  );
});


test('container rollback removes the exact container object before image removal while preserving volume', () => {
  const rollback = action(base, 'ROLLBACK-02-STOP-NEW-CONTAINER');
  assert.equal(rollback.status, 'ROLLBACK_ONLY');
  assert.equal(
    rollback.title,
    'Stop and remove newly started application container',
  );
  assert.equal(
    rollback.authorityTarget.includes('named data volume is excluded from deletion'),
    true,
  );
  assert.equal(
    rollback.effects.some(value => value.includes('releases its image reference')),
    true,
  );
  for (const evidence of [
    'CONTAINER_STOPPED',
    'CONTAINER_REMOVED',
    'IMAGE_REFERENCE_RELEASED',
    'DATA_VOLUME_PRESERVED',
  ]) {
    assert.equal(rollback.evidenceRequired.includes(evidence), true, evidence);
  }

  const order = base.rollbackPlan.orderedActionIds;
  assert.equal(
    order.indexOf('ROLLBACK-02-STOP-NEW-CONTAINER')
      < order.indexOf('ROLLBACK-08-REMOVE-BUILT-IMAGE'),
    true,
  );

  const imageRollback = action(base, 'ROLLBACK-08-REMOVE-BUILT-IMAGE');
  assert.equal(
    imageRollback.evidenceRequired.includes('CONTAINER_REFERENCE_ABSENT'),
    true,
  );

  const stopOnly = structuredClone(base);
  action(stopOnly, 'ROLLBACK-02-STOP-NEW-CONTAINER').evidenceRequired =
    ['CONTAINER_STOPPED', 'DATA_VOLUME_PRESERVED'];
  expectRejected(
    stopOnly,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'stopping without container removal cannot release image reference',
  );

  const unsafeTarget = structuredClone(base);
  action(unsafeTarget, 'ROLLBACK-02-STOP-NEW-CONTAINER').authorityTarget =
    'New container and its named data volume';
  expectRejected(
    unsafeTarget,
    'AUTHORITY_TARGET_INVALID',
    'container rollback must not widen into named-volume deletion',
  );

  const missingImageReferenceProof = structuredClone(base);
  action(missingImageReferenceProof, 'ROLLBACK-08-REMOVE-BUILT-IMAGE').evidenceRequired =
    action(missingImageReferenceProof, 'ROLLBACK-08-REMOVE-BUILT-IMAGE').evidenceRequired
      .filter(id => id !== 'CONTAINER_REFERENCE_ABSENT');
  expectRejected(
    missingImageReferenceProof,
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'image removal requires proof the container reference is absent',
  );
});


test('PROD-04 image creation has exact digest-bound rollback authority', () => {
  assert.deepEqual(
    action(base, 'PROD-04-BUILD-IMAGE').rollbackActionIds,
    ['ROLLBACK-08-REMOVE-BUILT-IMAGE'],
  );
  const rollback = action(base, 'ROLLBACK-08-REMOVE-BUILT-IMAGE');
  assert.equal(rollback.status, 'ROLLBACK_ONLY');
  assert.equal(rollback.requiresExplicitAuthorization, false);
  assert.equal(rollback.authorityTarget.includes('exact image digest created by PROD-04'), true);
  for (const evidence of [
    'IMAGE_DIGEST_MATCH',
    'CONTAINER_REFERENCE_ABSENT',
    'IMAGE_NOT_IN_USE',
    'IMAGE_REMOVED',
  ]) {
    assert.equal(rollback.evidenceRequired.includes(evidence), true, evidence);
  }
  assert.deepEqual(
    deriveCoauthorizedRollbackActionIds(base.actions, ['PROD-04-BUILD-IMAGE']),
    ['ROLLBACK-08-REMOVE-BUILT-IMAGE'],
  );

  const widened = structuredClone(base);
  action(widened, 'ROLLBACK-08-REMOVE-BUILT-IMAGE').authorityTarget =
    'Any unused production-host image';
  expectRejected(widened, 'AUTHORITY_TARGET_INVALID', 'image rollback target widened');

  const unsafe = structuredClone(base);
  action(unsafe, 'ROLLBACK-08-REMOVE-BUILT-IMAGE').evidenceRequired = ['IMAGE_REMOVED'];
  expectRejected(unsafe, 'ACTION_EVIDENCE_REQUIRED_INVALID', 'image rollback safety removed');
});


test('global rollback order includes the exact firewall and role-token rollback points', () => {
  assert.deepEqual(base.rollbackPlan.orderedActionIds, [
    'ROLLBACK-01-REMOVE-NEW-ROUTE',
    'ROLLBACK-05-REVERT-FIREWALL-RULE',
    'ROLLBACK-02-STOP-NEW-CONTAINER',
    'ROLLBACK-08-REMOVE-BUILT-IMAGE',
    'ROLLBACK-06-REVOKE-ROLE-TOKENS',
    'ROLLBACK-09-DISABLE-VCP-CONFIG',
    'ROLLBACK-10-DISABLE-KIOSK-CONFIG',
    'ROLLBACK-11-DISABLE-DINGTALK-CONFIG',
    'ROLLBACK-04-PRESERVE-DATA-VOLUME',
  ]);

  const firewallOmitted = structuredClone(base);
  firewallOmitted.rollbackPlan.orderedActionIds = firewallOmitted.rollbackPlan.orderedActionIds
    .filter(id => id !== 'ROLLBACK-05-REVERT-FIREWALL-RULE');
  expectRejected(firewallOmitted, 'ROLLBACK_PLAN_ORDER_INVALID', 'firewall rollback omitted');

  const tokenOmitted = structuredClone(base);
  tokenOmitted.rollbackPlan.orderedActionIds = tokenOmitted.rollbackPlan.orderedActionIds
    .filter(id => id !== 'ROLLBACK-06-REVOKE-ROLE-TOKENS');
  expectRejected(tokenOmitted, 'ROLLBACK_PLAN_ORDER_INVALID', 'role-token rollback omitted');

  const imageOmitted = structuredClone(base);
  imageOmitted.rollbackPlan.orderedActionIds = imageOmitted.rollbackPlan.orderedActionIds
    .filter(id => id !== 'ROLLBACK-08-REMOVE-BUILT-IMAGE');
  expectRejected(imageOmitted, 'ROLLBACK_PLAN_ORDER_INVALID', 'image rollback omitted');

  const misplaced = structuredClone(base);
  misplaced.rollbackPlan.orderedActionIds = [
    'ROLLBACK-01-REMOVE-NEW-ROUTE',
    'ROLLBACK-02-STOP-NEW-CONTAINER',
    'ROLLBACK-08-REMOVE-BUILT-IMAGE',
    'ROLLBACK-06-REVOKE-ROLE-TOKENS',
    'ROLLBACK-09-DISABLE-VCP-CONFIG',
    'ROLLBACK-10-DISABLE-KIOSK-CONFIG',
    'ROLLBACK-11-DISABLE-DINGTALK-CONFIG',
    'ROLLBACK-04-PRESERVE-DATA-VOLUME',
    'ROLLBACK-05-REVERT-FIREWALL-RULE',
  ];
  expectRejected(misplaced, 'ROLLBACK_PLAN_ORDER_INVALID', 'rollback sequence misplaced');
});

test('PROD-03 rollback explicitly revokes the generated role-token bindings', () => {
  assert.deepEqual(
    action(base, 'PROD-03-GENERATE-INSTALL-TOKENS').rollbackActionIds,
    ['ROLLBACK-06-REVOKE-ROLE-TOKENS'],
  );
  const rollback = action(base, 'ROLLBACK-06-REVOKE-ROLE-TOKENS');
  assert.equal(rollback.status, 'ROLLBACK_ONLY');
  assert.equal(rollback.authorityTarget.includes('created by PROD-03'), true);
  assert.equal(rollback.evidenceRequired.includes('ROLE_TOKEN_BINDINGS_REMOVED'), true);
  assert.equal(rollback.evidenceRequired.includes('SECRET_VALUES_NOT_LOGGED'), true);
});
