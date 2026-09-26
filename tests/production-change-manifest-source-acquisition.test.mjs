import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

// Definition/validator regression only: no service, writer, barrier or sync executes.
const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const validate = createProductionChangeManifestValidator(schema);
const CUT = 'PROD-13-CUTOVER-SWITCH';
const action = value => value.actions.find(entry => entry.id === CUT);
const receipt = 'SOURCE_WRITE_BARRIER_ACQUISITION_AND_DRAIN_PROOF';

function rejected(value, code) {
  const result = validate(value);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(entry => entry.code === code), true, code);
  assert.equal(Object.hasOwn(result, 'digest'), false);
}

test('source acquisition: both branches explicitly acquire and drain the source before sync admission or parity', () => {
  assert.equal(validate(base).ok, true);
  const cutover = action(base);
  assert.equal(cutover.effects.length, 8);
  assert.match(cutover.authorityTarget, /Exact approved source and target service database\/upload write barriers/u);
  assert.match(cutover.effects[0], /^After exact PROD-13 authorization.*no sync exception active$/u);
  assert.match(cutover.effects[1], /same fence and no sync exception active, acquire and retain the source-wide database\/upload barrier; deny and drain all source writers across processes; drain all initial in-flight target database and attachment mutations across every process/u);
  assert.match(cutover.effects[1], /keep every orphan-cleanup entry point disabled$/u);
  assert.equal(/\bif\b|\bonly when\b|\bassume\b/iu.test(cutover.effects[1]), false);
  assert.match(cutover.effects[2], /^Only after the exact source database\/upload barrier is held and drained, admit.*offline grants none$/u);
  assert.match(cutover.effects[3], /^With sync sealed, zero active exceptions and zero in-flight mutations, recompute/u);
  assert.equal(cutover.evidenceRequired.includes(receipt), true);
  const beforeRequest = base.authorizationPacket.actionSpecificRevalidation[CUT];
  assert.equal(beforeRequest.includes('SOURCE_WRITE_BARRIER_CAPABILITY_PROOF'), true);
  assert.equal(beforeRequest.includes('SOURCE_WRITE_BARRIER_PLAN'), true);
  assert.equal(beforeRequest.includes(receipt), false);
  assert.equal(base.gates.find(gate => gate.id === 'CUTOVER_SOURCE_CONSISTENCY').status, 'BLOCKED');
  for (const key of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds', 'derivedRollbackActionIds']) {
    assert.deepEqual(base.authorizationPacket[key], []);
  }
});

test('source acquisition: the prior target-only step and weakened source acquisition or coverage get no digest', () => {
  const actual = action(base).effects[1];
  const oldStep = 'With the same fence and no sync exception active, drain all initial in-flight target database and attachment mutations across every process; reject incomplete coverage or uncertain drain, keep ordinary writer denial continuous, and keep every orphan-cleanup entry point disabled';
  const weakened = [
    oldStep,
    actual.replace('acquire and retain the source-wide database/upload barrier', 'assume the source-wide database/upload barrier is held'),
    actual.replace('acquire and retain the source-wide database/upload barrier; ', ''),
    actual.replace('deny and drain all source writers across processes; ', ''),
    actual.replace('deny and drain all source writers across processes', 'drain only the source synchronization writer'),
    actual.replace('database/upload barrier', 'database-only barrier'),
    actual.replace('all source writers across processes', 'source requests in this process'),
    'Acquire and drain source writers only when final synchronization is selected; offline mode skips source exclusion',
  ];
  for (const text of weakened) {
    assert.notEqual(text, actual);
    assert.ok(text.length > 0 && text.length <= 300);
    const value = structuredClone(base);
    action(value).effects[1] = text;
    rejected(value, 'ACTION_EFFECTS_INVALID');
  }
  for (const later of [2, 3, 5, 7]) {
    const value = structuredClone(base);
    const effects = action(value).effects;
    [effects[1], effects[later]] = [effects[later], effects[1]];
    rejected(value, 'ACTION_EFFECTS_INVALID');
  }
  const withoutReceipt = structuredClone(base);
  action(withoutReceipt).evidenceRequired = action(withoutReceipt).evidenceRequired.filter(id => id !== receipt);
  rejected(withoutReceipt, 'ACTION_EVIDENCE_REQUIRED_INVALID');
  const prematureReceipt = structuredClone(base);
  prematureReceipt.authorizationPacket.actionSpecificRevalidation[CUT].push(receipt);
  rejected(prematureReceipt, 'ACTION_REVALIDATION_INVALID');
});
