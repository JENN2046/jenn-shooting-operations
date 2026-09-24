import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

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
});

test('secret scanner rejects ordinary Bearer and token-shaped material inside schema-valid free text', () => {
  for (const [label, secretText] of [
    ['bearer', 'Bearer 12345678901234567890123456789012'],
    ['access token', 'access_token = abcdefghijklmnopqrstuvwxyz123456'],
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

test('manifest rejects blanket approval and missing production blockers', () => {
  const blanket = structuredClone(base);
  blanket.authorizationPacket.blanketApprovalAllowed = true;
  expectRejected(blanket, 'SCHEMA_INVALID', 'blanket approval');

  const missing = structuredClone(base);
  missing.authorizationPacket.blockingGateIds = missing.authorizationPacket.blockingGateIds
    .filter(id => id !== 'WO06C_VCP_EXTERNAL');
  expectRejected(missing, 'AUTHORIZATION_BLOCKER_SET_INVALID', 'missing blocker');
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

test('requestable status is bidirectionally frozen to the single currently bound action', () => {
  const widened = structuredClone(base);
  action(widened, 'PROD-02-CREATE-ISOLATED-APP-STORAGE').status = 'REQUESTABLE_EXPLICIT_AUTHORIZATION';
  expectRejected(widened, 'ACTION_STATUS_INVALID', 'widen blocked action');

  const dingtalkWidened = structuredClone(base);
  action(dingtalkWidened, 'PROD-12-DINGTALK-PROVIDER-INTEGRATION').status = 'REQUESTABLE_EXPLICIT_AUTHORIZATION';
  dingtalkWidened.authorizationPacket.requestableActionIds.push('PROD-12-DINGTALK-PROVIDER-INTEGRATION');
  const result = validate(dingtalkWidened);
  assert.equal(result.ok, false);
  const codes = issueCodes(result);
  assert.equal(codes.has('ACTION_STATUS_INVALID'), true);
  assert.equal(codes.has('REQUESTABLE_ACTION_SET_INVALID'), true);
  assert.equal(codes.has('REQUESTABLE_STATUS_SET_INVALID'), true);
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

test('pre-request revalidation checklist cannot be reduced or replaced', () => {
  const reduced = structuredClone(base);
  reduced.authorizationPacket.mustRevalidateBeforeRequest = ['AUTHORITY_HEAD'];
  expectRejected(reduced, 'REVALIDATION_CHECKLIST_INVALID', 'reduced checklist');

  const replaced = structuredClone(base);
  replaced.authorizationPacket.mustRevalidateBeforeRequest = [
    ...base.authorizationPacket.mustRevalidateBeforeRequest.slice(0, -1),
    'TRUST_ME',
  ];
  expectRejected(replaced, 'REVALIDATION_CHECKLIST_INVALID', 'replaced checklist');
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
  changed.authorizationPacket.mustRevalidateBeforeRequest = ['AUTHORITY_HEAD'];
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
    'TARGET_UNRESOLVED_FACTS_INVALID',
    'ACTION_RISK_INVALID',
    'ACTION_SIDE_EFFECT_INVALID',
    'ACTION_EVIDENCE_REQUIRED_INVALID',
    'AUTHORITY_TARGET_INVALID',
  ]) assert.equal(codes.has(code), true, code);
});


test('global rollback order includes the exact firewall revert at the frozen point', () => {
  assert.deepEqual(base.rollbackPlan.orderedActionIds, [
    'ROLLBACK-01-REMOVE-NEW-ROUTE',
    'ROLLBACK-05-REVERT-FIREWALL-RULE',
    'ROLLBACK-02-STOP-NEW-CONTAINER',
    'ROLLBACK-03-DISABLE-EXTERNAL-CONFIG',
    'ROLLBACK-04-PRESERVE-DATA-VOLUME',
  ]);

  const omitted = structuredClone(base);
  omitted.rollbackPlan.orderedActionIds = omitted.rollbackPlan.orderedActionIds
    .filter(id => id !== 'ROLLBACK-05-REVERT-FIREWALL-RULE');
  expectRejected(omitted, 'ROLLBACK_PLAN_ORDER_INVALID', 'firewall rollback omitted');

  const misplaced = structuredClone(base);
  misplaced.rollbackPlan.orderedActionIds = [
    'ROLLBACK-01-REMOVE-NEW-ROUTE',
    'ROLLBACK-02-STOP-NEW-CONTAINER',
    'ROLLBACK-03-DISABLE-EXTERNAL-CONFIG',
    'ROLLBACK-04-PRESERVE-DATA-VOLUME',
    'ROLLBACK-05-REVERT-FIREWALL-RULE',
  ];
  expectRejected(misplaced, 'ROLLBACK_PLAN_ORDER_INVALID', 'firewall rollback misplaced');
});
