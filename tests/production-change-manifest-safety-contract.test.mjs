import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createProductionChangeManifestValidator,
  deriveCoauthorizedRollbackActionIds,
} from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const validate = createProductionChangeManifestValidator(schema);
const CUT = 'PROD-13-CUTOVER-SWITCH';
const RESTORE = 'PROD-14-RESTORE-ORPHAN-CLEANUP';
const RB = 'ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP';
const FENCE = 'CUTOVER_TARGET_WRITE_FENCE_CAPABILITY';
const DISABLE = 'RESTORED_CLEANUP_DISABLE_CAPABILITY';
const schemaRejected = { ok: false, issues: [{ code: 'SCHEMA_AUTHORITY_INVALID', path: '/' }] };
const action = (value, id) => value.actions.find(entry => entry.id === id);
const checks = (value, id) => value.authorizationPacket.actionSpecificRevalidation[id];

function rejected(value, code) {
  const result = validate(value);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(entry => entry.code === code), true, code);
  assert.equal(Object.hasOwn(result, 'digest'), false);
}

function mutate(fn) {
  const value = structuredClone(base);
  fn(value);
  return value;
}

function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reordered(value[key])]));
  }
  return value;
}

test('safety contract: both new capabilities remain blocked and the packet grants no action', () => {
  assert.equal(validate(base).ok, true);
  for (const id of [FENCE, DISABLE]) {
    assert.equal(base.gates.find(gate => gate.id === id).status, 'BLOCKED');
    assert.equal(base.authorizationPacket.blockingGateIds.includes(id), true);
    assert.equal(base.authorizationPacket.deploymentBlockingGateIds.includes(id), false);
    rejected(mutate(value => { value.gates.find(gate => gate.id === id).status = 'SATISFIED'; }), 'GATE_STATUS_INVALID');
    rejected(mutate(value => { value.gates = value.gates.filter(gate => gate.id !== id); }), 'GATE_SET_INVALID');
    rejected(mutate(value => {
      value.authorizationPacket.blockingGateIds = value.authorizationPacket.blockingGateIds.filter(gate => gate !== id);
    }), 'AUTHORIZATION_BLOCKER_SET_INVALID');
  }
  for (const key of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds', 'derivedRollbackActionIds']) {
    assert.deepEqual(base.authorizationPacket[key], []);
  }
  assert.equal(base.currentState.deploymentGate, 'BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE');
  assert.equal(base.authorizationPacket.status, 'FROZEN_NOT_REQUESTED');
});

test('safety contract: cutover cannot drop fence capability, writer coverage or bound execution proofs', () => {
  assert.equal(action(base, CUT).preconditions.includes(FENCE), true);
  rejected(mutate(value => {
    action(value, CUT).preconditions = action(value, CUT).preconditions.filter(id => id !== FENCE);
  }), 'ACTION_PRECONDITIONS_INVALID');
  for (const evidence of [
    'TARGET_WRITE_FENCE_CAPABILITY_PROOF', 'TARGET_WRITER_INVENTORY_PROOF',
    'TARGET_WRITE_FENCE_ACQUISITION_PROOF', 'TARGET_DATABASE_ATTACHMENT_DRAIN_PROOF',
    'FINAL_SYNC_WRITER_REVOKED_AND_DRAINED', 'FINAL_PARITY_FENCE_BINDING_PROOF',
    'PRE_SWITCH_SAME_FENCE_PROOF', 'POST_SWITCH_SAME_FENCE_PROOF',
    'READ_ONLY_POST_SWITCH_VERIFICATION', 'TARGET_FENCE_RELEASE_PROOF',
    'PRE_SWITCH_SOURCE_TARGET_PARITY_PROOF', 'PRE_SWITCH_ATTACHMENT_PARITY_PROOF',
    'PRE_SWITCH_ORPHAN_CLEANUP_GUARD_PROOF',
  ]) {
    assert.equal(action(base, CUT).evidenceRequired.includes(evidence), true, evidence);
    rejected(mutate(value => {
      action(value, CUT).evidenceRequired = action(value, CUT).evidenceRequired.filter(id => id !== evidence);
    }), 'ACTION_EVIDENCE_REQUIRED_INVALID');
  }
});

test('safety contract: authorization binds a deployable plan, not an unauthorized fence result', () => {
  for (const name of [
    'FINAL_PARITY_UNDER_FENCE_PLAN', 'TARGET_STORAGE_IDENTITIES', 'TARGET_WRITER_INVENTORY',
    'TARGET_WRITE_FENCE_CAPABILITY_PROOF', 'TARGET_WRITE_FENCE_PLAN',
    'TARGET_FENCE_FAILURE_RETENTION_PLAN', 'TARGET_FENCE_RELEASE_PLAN',
  ]) {
    assert.equal(checks(base, CUT).includes(name), true, name);
    rejected(mutate(value => {
      value.authorizationPacket.actionSpecificRevalidation[CUT] = checks(value, CUT).filter(id => id !== name);
    }), 'ACTION_REVALIDATION_INVALID');
  }
  for (const output of [
    'FINAL_SOURCE_TARGET_PARITY', 'TARGET_WRITE_FENCE_ACQUISITION_PROOF',
    'TARGET_DATABASE_ATTACHMENT_DRAIN_PROOF', 'FINAL_PARITY_FENCE_BINDING_PROOF',
    'POST_SWITCH_SAME_FENCE_PROOF', 'TARGET_FENCE_RELEASE_PROOF',
  ]) {
    assert.equal(checks(base, CUT).includes(output), false, output);
    rejected(mutate(value => { checks(value, CUT).push(output); }), 'ACTION_REVALIDATION_INVALID');
  }
  assert.deepEqual(base.authorizationPacket.mustRevalidateBeforeRequest, ['AUTHORITY_HEAD']);
  assert.equal(Object.hasOwn(base.authorizationPacket.actionSpecificRevalidation, 'PROD-01-TARGET-READONLY-PREFLIGHT'), false);
});

test('safety contract: every pairwise cutover effect reordering is rejected', () => {
  const effects = action(base, CUT).effects;
  assert.equal(effects.length, 8);
  assert.match(effects[0], /After exact PROD-13 authorization.*persistent target-wide.*database.*upload volume.*epoch/u);
  assert.match(effects[1], /drain all in-flight database and attachment.*all processes/u);
  assert.match(effects[2], /separately authorized bounded final synchronization.*revoke.*drain again/u);
  assert.match(effects[3], /zero remaining writers.*source snapshot.*target revision.*attachment digests.*epoch/u);
  assert.match(effects[4], /Immediately before Switch.*same fence.*no intervening writes/u);
  assert.match(effects[5], /retaining the same fence.*without releasing target writes/u);
  assert.match(effects[6], /read-only post-Switch.*failure, timeout, restart, fence loss or uncertainty.*without automatic retry/u);
  assert.match(effects[7], /Only after every.*succeeds.*otherwise retain closed admission independently.*cleanup stays disabled/u);
  for (let left = 0; left < effects.length; left += 1) {
    for (let right = left + 1; right < effects.length; right += 1) {
      rejected(mutate(value => {
        const steps = action(value, CUT).effects;
        [steps[left], steps[right]] = [steps[right], steps[left]];
      }), 'ACTION_EFFECTS_INVALID');
    }
  }
});

test('safety contract: omitted duplicated and fail-open cutover steps receive no digest', () => {
  for (let index = 0; index < 8; index += 1) {
    rejected(mutate(value => { action(value, CUT).effects.splice(index, 1); }), 'ACTION_EFFECTS_INVALID');
    rejected(mutate(value => { action(value, CUT).effects.splice(index, 0, action(value, CUT).effects[index]); }), 'ACTION_EFFECTS_INVALID');
  }
  for (const [index, text] of [
    [0, 'Block only bounded staging users at the reverse proxy'],
    [1, 'Drain database transactions but allow unfinished attachment writes'],
    [2, 'Allow a synchronization writer to continue after final parity'],
    [3, 'Reuse import parity without checking current target revision'],
    [5, 'Switch and release target writers before verification'],
    [6, 'Run writable post-switch probes and retry failed writes automatically'],
    [7, 'On lease timeout or restart reopen target writes automatically'],
  ]) {
    rejected(mutate(value => { action(value, CUT).effects[index] = text; }), 'ACTION_EFFECTS_INVALID');
  }
});

test('safety contract: restored cleanup has only its exact coauthorized disable recovery', () => {
  assert.deepEqual(action(base, RESTORE).rollbackActionIds, [RB]);
  assert.equal(action(base, RESTORE).preconditions.includes(DISABLE), true);
  assert.equal(action(base, RESTORE).sideEffect, 'IRREVERSIBLE_OR_EXTERNAL');
  assert.deepEqual(deriveCoauthorizedRollbackActionIds(base.actions, [RESTORE]), [RB]);
  assert.deepEqual(deriveCoauthorizedRollbackActionIds(base.actions, []), []);
  assert.deepEqual(deriveCoauthorizedRollbackActionIds(base.actions, [RB]), []);
  for (const forward of base.actions.filter(entry => entry.id.startsWith('PROD-') && entry.id !== RESTORE)) {
    assert.equal(deriveCoauthorizedRollbackActionIds(base.actions, [forward.id]).includes(RB), false, forward.id);
  }
  assert.equal(action(base, RB).requiresExplicitAuthorization, false);
  assert.match(action(base, RB).authorityTarget, /restored by the approved PROD-14.*exact service and upload volume/u);
  rejected(mutate(value => { action(value, RESTORE).rollbackActionIds = []; }), 'ROLLBACK_BINDING_INVALID');
  rejected(mutate(value => { action(value, RESTORE).rollbackActionIds = ['ROLLBACK-02-STOP-NEW-CONTAINER']; }), 'ROLLBACK_BINDING_INVALID');
  rejected(mutate(value => { action(value, CUT).rollbackActionIds.push(RB); }), 'ROLLBACK_BINDING_INVALID');
  rejected(mutate(value => { action(value, RB).requiresExplicitAuthorization = true; }), 'ACTION_AUTHORIZATION_MODE_INVALID');
  rejected(mutate(value => { action(value, RB).authorityTarget = 'All cleanup configuration on any service'; }), 'AUTHORITY_TARGET_INVALID');
  rejected(mutate(value => { value.authorizationPacket.derivedRollbackActionIds = [RB]; }), 'DERIVED_ROLLBACK_AUTHORITY_INVALID');
});

test('safety contract: disable capability and captured rollback target precede cleanup restoration', () => {
  rejected(mutate(value => {
    action(value, RESTORE).preconditions = action(value, RESTORE).preconditions.filter(id => id !== DISABLE);
  }), 'ACTION_PRECONDITIONS_INVALID');
  for (const proof of ['CLEANUP_DISABLE_CAPABILITY_PROOF', 'CLEANUP_PRE_RESTORE_DISABLED_STATE', 'ROLLBACK_TARGETS']) {
    assert.equal(checks(base, RESTORE).includes(proof), true, proof);
    rejected(mutate(value => {
      value.authorizationPacket.actionSpecificRevalidation[RESTORE] = checks(value, RESTORE).filter(id => id !== proof);
    }), 'ACTION_REVALIDATION_INVALID');
  }
  for (const proof of ['CLEANUP_DISABLE_CAPABILITY_PROOF', 'CLEANUP_PRE_RESTORE_DISABLED_STATE', 'CLEANUP_ROLLBACK_TARGET_BINDING', 'DELETION_IRREVERSIBILITY_ACKNOWLEDGED']) {
    assert.equal(action(base, RESTORE).evidenceRequired.includes(proof), true, proof);
    rejected(mutate(value => { action(value, RESTORE).evidenceRequired = action(value, RESTORE).evidenceRequired.filter(id => id !== proof); }), 'ACTION_EVIDENCE_REQUIRED_INVALID');
  }
  for (const id of [RESTORE, RB]) {
    assert.equal(action(base, id).effects.length, 2);
    rejected(mutate(value => { action(value, id).effects.reverse(); }), 'ACTION_EFFECTS_INVALID');
  }
  assert.match(action(base, RESTORE).effects[0], /recovery capability before enabling/u);
  assert.match(action(base, RB).effects[0], /block.*all four.*cancel.*drain in-flight/u);
  assert.match(action(base, RB).effects[1], /do not claim to recover already deleted/u);
});

test('safety contract: emergency cleanup disable is first in the derived rollback subset', () => {
  assert.equal(base.rollbackPlan.strategy, 'STOP_CLEANUP_THEN_ROUTE_RUNTIME_PRESERVE_DATA');
  assert.equal(base.rollbackPlan.orderedActionIds[0], RB);
  const selected = new Set(deriveCoauthorizedRollbackActionIds(base.actions, [RESTORE, 'PROD-07-CONFIGURE-REVERSE-PROXY-TLS']));
  assert.deepEqual(base.rollbackPlan.orderedActionIds.filter(id => selected.has(id)), [RB, 'ROLLBACK-01-REMOVE-NEW-ROUTE']);
  rejected(mutate(value => { value.rollbackPlan.orderedActionIds = value.rollbackPlan.orderedActionIds.filter(id => id !== RB); }), 'ROLLBACK_PLAN_ORDER_INVALID');
  rejected(mutate(value => { value.rollbackPlan.orderedActionIds.push(value.rollbackPlan.orderedActionIds.shift()); }), 'ROLLBACK_PLAN_ORDER_INVALID');
  for (const proof of [
    'CLEANUP_ROLLBACK_TARGET_MATCH', 'ALL_RESTORED_CLEANUP_ENTRY_POINTS_DISABLED',
    'CLEANUP_SCHEDULES_CANCELLED', 'CLEANUP_IN_FLIGHT_WORK_DRAINED',
    'PRE_RESTORE_DISABLED_STATE_RESTORED', 'DATA_VOLUME_PRESERVED',
    'UNRELATED_CONFIGURATION_UNCHANGED', 'DELETIONS_NOT_REVERSED_ACKNOWLEDGED',
  ]) {
    assert.equal(action(base, RB).evidenceRequired.includes(proof), true, proof);
    rejected(mutate(value => { action(value, RB).evidenceRequired = action(value, RB).evidenceRequired.filter(id => id !== proof); }), 'ACTION_EVIDENCE_REQUIRED_INVALID');
  }
});

test('schema authority: coordinated schema and authority-state changes fail before compilation', () => {
  const cases = [
    [['properties', 'currentState', 'properties', 'deploymentGate', 'const'], ['currentState', 'deploymentGate'], 'AUTHORIZED'],
    [['properties', 'currentState', 'properties', 'deploymentAuthorizationRequest', 'const'], ['currentState', 'deploymentAuthorizationRequest'], 'AUTHORIZED'],
    [['properties', 'currentState', 'properties', 'manifestDefinitionStatus', 'const'], ['currentState', 'manifestDefinitionStatus'], 'AUTHORIZED'],
    [['properties', 'purpose', 'const'], ['purpose'], 'EXECUTE_PRODUCTION'],
    [['properties', 'authorizationPacket', 'properties', 'status', 'const'], ['authorizationPacket', 'status'], 'AUTHORIZED'],
    [['properties', 'authorizationPacket', 'properties', 'humanApprovalRequired', 'const'], ['authorizationPacket', 'humanApprovalRequired'], false],
    [['properties', 'authorizationPacket', 'properties', 'blanketApprovalAllowed', 'const'], ['authorizationPacket', 'blanketApprovalAllowed'], true],
    [['properties', 'target', 'properties', 'applicationBind', 'const'], ['target', 'applicationBind'], '0.0.0.0:3800'],
    [['properties', 'rollbackPlan', 'properties', 'destructiveDataDeletionAllowed', 'const'], ['rollbackPlan', 'destructiveDataDeletionAllowed'], true],
  ];
  const set = (object, path, value) => { const parent = path.slice(0, -1).reduce((node, key) => node[key], object); parent[path.at(-1)] = value; };
  for (const [schemaPath, manifestPath, replacement] of cases) {
    const changedSchema = structuredClone(schema);
    const manifest = structuredClone(base);
    set(changedSchema, schemaPath, replacement);
    set(manifest, manifestPath, replacement);
    assert.deepEqual(createProductionChangeManifestValidator(changedSchema)(manifest), schemaRejected);
  }
});

test('schema authority: every schema constant and structural constraint belongs to the pin', () => {
  const paths = [];
  const visit = (value, path = []) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['const', 'additionalProperties', 'required', 'enum', 'maxItems', 'type', '$ref'].includes(key)) paths.push([...path, key]);
      visit(child, [...path, key]);
    }
  };
  visit(schema);
  assert.ok(paths.length > 50);
  for (const path of paths) {
    const changedSchema = structuredClone(schema);
    const parent = path.slice(0, -1).reduce((node, key) => node[key], changedSchema);
    delete parent[path.at(-1)];
    assert.deepEqual(createProductionChangeManifestValidator(changedSchema)(base), schemaRejected);
  }
  for (const candidate of [true, false, null, {}, [], { $ref: 'https://invalid.example/not-fetched' }]) {
    assert.deepEqual(createProductionChangeManifestValidator(candidate)(base), schemaRejected);
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.deepEqual(createProductionChangeManifestValidator(cyclic)(base), schemaRejected);
});

test('schema authority: object formatting is irrelevant but array order and content remain pinned', () => {
  const reformatted = JSON.parse(JSON.stringify(reordered(schema), null, 4));
  assert.equal(createProductionChangeManifestValidator(reformatted)(base).ok, true);
  const changed = structuredClone(schema);
  changed.required.reverse();
  assert.deepEqual(createProductionChangeManifestValidator(changed)(base), schemaRejected);
  const supplied = structuredClone(schema);
  const frozenValidator = createProductionChangeManifestValidator(supplied);
  supplied.properties.currentState.properties.deploymentGate.const = 'AUTHORIZED';
  supplied.additionalProperties = true;
  const manifest = structuredClone(base);
  manifest.currentState.deploymentGate = 'AUTHORIZED';
  const result = frozenValidator(manifest);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(entry => entry.code === 'SCHEMA_INVALID'), true);
  assert.equal(Object.hasOwn(result, 'digest'), false);
  assert.equal(frozenValidator(base).ok, true);
});

function runIsolatedCli(schemaValue, manifestValue) {
  const root = mkdtempSync(join(tmpdir(), 'wo06d-schema-pin-'));
  try {
    for (const path of ['scripts', 'contracts', 'docs/operations']) mkdirSync(join(root, path), { recursive: true });
    copyFileSync(new URL('../scripts/validate-production-change-manifest.mjs', import.meta.url), join(root, 'scripts/validate-production-change-manifest.mjs'));
    symlinkSync(fileURLToPath(new URL('../src', import.meta.url)), join(root, 'src'), 'dir');
    writeFileSync(join(root, 'contracts/production-change-manifest.v1.schema.json'), JSON.stringify(schemaValue));
    writeFileSync(join(root, 'docs/operations/production-change-manifest.v1.json'), JSON.stringify(manifestValue));
    return spawnSync(process.execPath, [join(root, 'scripts/validate-production-change-manifest.mjs')], { encoding: 'utf8', timeout: 15000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('schema authority: real CLI rejects a jointly forged pair without source echo or successful digest', () => {
  const supplied = structuredClone(schema);
  supplied.properties.currentState.properties.deploymentGate.const = 'AUTHORIZED';
  const manifest = structuredClone(base);
  manifest.currentState.deploymentGate = 'AUTHORIZED';
  const result = runIsolatedCli(supplied, manifest);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'WO_06D_MANIFEST_INVALID', issues: schemaRejected.issues });
  assert.doesNotMatch(result.stderr, /AUTHORIZED|sha256:|manifestDigest|deploymentGate/u);
  const normal = runIsolatedCli(reordered(schema), base);
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(JSON.parse(normal.stdout).status, 'WO_06D_MANIFEST_VALID');
  assert.equal(JSON.parse(normal.stdout).deploymentGate, 'BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE');
});

test('safety contract: legacy source preservation and unavailable Switch recovery are not weakened', () => {
  const cut = action(base, CUT);
  for (const gate of ['CUTOVER_SOURCE_CONSISTENCY', 'CUTOVER_LIVE_SERVICE_READINESS', 'CUTOVER_FORWARD_CHAIN', 'CUTOVER_SWITCH_RECOVERY']) {
    assert.equal(cut.preconditions.includes(gate), true);
  }
  assert.equal(checks(base, CUT).includes('ALL_ORPHAN_CLEANUP_ENTRY_POINTS_STILL_DISABLED'), true);
  assert.equal(action(base, 'ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH').status, 'BLOCKED_PREREQUISITE');
  assert.equal(deriveCoauthorizedRollbackActionIds(base.actions, [CUT]).includes('ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH'), false);
  assert.equal(base.rollbackPlan.destructiveDataDeletionAllowed, false);
  const order = base.rollbackPlan.orderedActionIds;
  assert.ok(order.indexOf('ROLLBACK-02-STOP-NEW-CONTAINER') < order.indexOf('ROLLBACK-08-REMOVE-BUILT-IMAGE'));
  assert.ok(action(base, 'PROD-05-START-ISOLATED-CONTAINER').evidenceRequired.includes('PRODUCTION_IMPORT_COMPLETION_PROOF'));
});
