import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const validate = createProductionChangeManifestValidator(schema);
const ID = 'PROD-13-CUTOVER-SWITCH';
const cutover = value => value.actions.find(action => action.id === ID);
const reject = (change, code) => {
  const value = structuredClone(base);
  change(value);
  const result = validate(value);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === code), code);
  assert.equal(Object.hasOwn(result, 'digest'), false);
};

test('source barrier: both offline and final-sync paths hold source exclusion through demotion', () => {
  assert.equal(validate(base).ok, true);
  const action = cutover(base);
  assert.match(action.authorityTarget, /source and target.*write barriers/u);
  assert.ok(action.preconditions.includes('CUTOVER_SOURCE_CONSISTENCY'));
  assert.equal(base.gates.find(gate => gate.id === 'CUTOVER_SOURCE_CONSISTENCY').status, 'BLOCKED');
  assert.equal(action.effects.length, 8);
  assert.match(action.effects[2], /source database\/upload barrier is held and drained/u);
  assert.match(action.effects[2], /separately approved operation-bound final-sync identity/u);
  assert.match(action.effects[3], /source snapshot\/barrier epoch/u);
  assert.match(action.effects[4], /source barrier remain held.*no intervening writes/u);
  assert.match(action.effects[5], /old-source demotion.*denied-write policy/u);
  assert.match(action.effects[6], /Keep both barriers.*keeps both closed/u);
  assert.match(action.effects[7], /old-source demotion is proven.*keep old-source writes denied/u);
  for (const proof of [
    'SOURCE_WRITE_BARRIER_CAPABILITY_PROOF',
    'SOURCE_WRITE_BARRIER_ACQUISITION_AND_DRAIN_PROOF',
    'SOURCE_BARRIER_PARITY_BINDING_PROOF',
    'SOURCE_BARRIER_HELD_THROUGH_DEMOTION',
    'OLD_SOURCE_WRITE_ADMISSION_REMAINS_CLOSED',
  ]) {
    assert.ok(action.evidenceRequired.includes(proof), proof);
    assert.equal(base.authorizationPacket.actionSpecificRevalidation[ID].includes(proof), proof === 'SOURCE_WRITE_BARRIER_CAPABILITY_PROOF');
    reject(value => { cutover(value).evidenceRequired = cutover(value).evidenceRequired.filter(id => id !== proof); }, 'ACTION_EVIDENCE_REQUIRED_INVALID');
  }
  assert.ok(base.invariants.includes('SOURCE_AND_TARGET_WRITE_BARRIERS_SPAN_PARITY_SWITCH_AND_DEMOTION'));
  reject(value => { value.invariants = value.invariants.filter(id => id !== 'SOURCE_AND_TARGET_WRITE_BARRIERS_SPAN_PARITY_SWITCH_AND_DEMOTION'); }, 'INVARIANT_SET_INVALID');
});

test('source barrier: final sync and momentary rechecks cannot substitute for persistent write exclusion', () => {
  for (const [index, replacement] of [
    [2, 'Run final synchronization while ordinary source requests may continue'],
    [3, 'Measure source snapshot parity without a source write barrier epoch'],
    [4, 'Read source revision once before Switch and then allow source writes'],
    [5, 'Promote the target route while the old source still accepts client writes'],
    [6, 'Retain only the target fence during read-only post-Switch verification'],
    [7, 'After verification release both barriers and allow both services to accept writes'],
    [7, 'On failure or timeout automatically resume old source writes'],
  ]) {
    reject(value => { cutover(value).effects[index] = replacement; }, 'ACTION_EFFECTS_INVALID');
  }
  reject(value => {
    const effects = cutover(value).effects;
    [effects[2], effects[3]] = [effects[3], effects[2]];
  }, 'ACTION_EFFECTS_INVALID');
  reject(value => { cutover(value).authorityTarget = 'Only target service writes and route promotion'; }, 'AUTHORITY_TARGET_INVALID');
  for (const field of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds', 'derivedRollbackActionIds']) {
    assert.deepEqual(base.authorizationPacket[field], []);
  }
  assert.equal(base.currentState.deploymentGate, 'BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE');
});
