import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
// Input Boundary V1 intentionally rejects inline credential values at every length.
// Retain these historical fixtures; authorizer assertions still describe runtime only.
const validate = createProductionChangeManifestValidator(schema);
const keys = ['access_token', 'VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN'];
const synthetic = 'abcdefgh' + 'ijklmnop';
function codes(value) { return new Set(validate(value).issues.map(issue => issue.code)); }
function withText(text) {
  const copy = structuredClone(base);
  copy.gates[0].evidence = text;
  return copy;
}
function secret(text) {
  const result = codes(withText(text));
  assert.equal(result.has('SCHEMA_INVALID'), false);
  assert.equal(result.has('SECRET_MATERIAL_DETECTED'), true, JSON.stringify(text));
}

test('colon token values reject multiline plain and quoted YAML without truncation', () => {
  for (const key of keys) {
    for (const eol of ['\n', '\r\n', '\r']) {
      for (const [open, close] of [['', ''], ['"', '"'], ["'", "'"]]) {
        secret(`${key}: ${open}abcdefgh${eol}  ijklmnop${close}`);
        secret(`  "${key}": ${open}abcdefgh${eol}    ijklmnop${close}`);
        secret(`${key}: ${eol}  ${synthetic}`);
        secret(`${key}: abc${eol}${eol}  ${synthetic}`);
      }
    }
  }
});

test('colon scanner conservatively rejects multiline snippets rather than interpreting YAML scope', () => {
  for (const key of keys) {
    secret(`${key}: short\n  continued`);
    secret(`${key}: short\n# comment\n  continued`);
    secret(`${key}: short\nOTHER_FIELD: metadata`);
    for (const marker of ['|', '>-', '|2+', '!tag', '&anchor', '*alias']) {
      secret(`${key}: ${marker}\n  ${synthetic}`);
    }
  }
});

test('escaped quoted assignment keys cannot hide any recognized token key', () => {
  for (const key of keys) {
    for (let i = 0; i < key.length; i += 1) {
      const escaped = key.slice(0, i) + '\\u' + key.charCodeAt(i).toString(16).padStart(4, '0') + key.slice(i + 1);
      const snippet = `"${escaped}": "${synthetic}"`;
      assert.equal(Object.keys(JSON.parse(`{${snippet}}`))[0], key);
      secret(snippet);
      secret(`{"meta": "ok", ${snippet}}`);
      secret(`"${escaped}" = "${synthetic}"`);
    }
    const encoded = [...key].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    secret(`"${encoded}": "${synthetic}"`);
    secret(`"\\x${key.charCodeAt(0).toString(16)}${key.slice(1)}": ${synthetic}`);
    secret(`"\\U${key.charCodeAt(0).toString(16).padStart(8, '0')}${key.slice(1)}": ${synthetic}`);
  }
});

test('reference-only boundary rejects retained short single-line credential fixtures too', () => {
  for (const key of keys) {
    for (const text of [
      `${key}: short`, `${key}: "short"`, `${key}: 'short'`,
      `${key}: short\n`, `${key}: short\r\n`, `${key}=short`,
      `"${key}": "a\\b"`, `${key}: ${'x'.repeat(15)}`, `${key}: ${'😀'.repeat(7)}x`,
    ]) {
      assert.equal(codes(withText(text)).has('SECRET_MATERIAL_DETECTED'), true, JSON.stringify(text));
    }
    secret(`${key}: ${'x'.repeat(16)}`);
    secret(`${key}: "${'😀'.repeat(8)}"`);
    secret(`${key}=abcdefgh\\\nijklmnop`);
    secret(`${key}=$(printf ${synthetic})`);
  }
});

test('DingTalk traffic requires all production gates and prior deployment completion proof', () => {
  const id = 'PROD-12-DINGTALK-PROVIDER-INTEGRATION';
  const get = value => value.actions.find(action => action.id === id);
  for (const gate of ['PRODUCTION_TARGET_FACTS', 'INTEGRATION_DEPLOYMENT_READINESS', 'PRODUCTION_DEPLOYMENT_GATE', 'DINGTALK_TARGET_BINDING', 'DINGTALK_DEPLOYABLE_ADAPTER_WIRING']) {
    assert.ok(get(base).preconditions.includes(gate));
    const copy = structuredClone(base);
    get(copy).preconditions = get(copy).preconditions.filter(item => item !== gate);
    assert.ok(codes(copy).has('ACTION_PRECONDITIONS_INVALID'), gate);
  }
  for (const field of ['evidenceRequired', 'actionSpecificRevalidation']) {
    const copy = structuredClone(base);
    const owner = field === 'evidenceRequired' ? get(copy) : copy.authorizationPacket.actionSpecificRevalidation;
    const key = field === 'evidenceRequired' ? field : id;
    assert.ok(owner[key].includes('DEPLOYMENT_CHAIN_COMPLETION_PROOF'));
    owner[key] = owner[key].filter(item => item !== 'DEPLOYMENT_CHAIN_COMPLETION_PROOF');
    assert.ok(codes(copy).has(field === 'evidenceRequired' ? 'ACTION_EVIDENCE_REQUIRED_INVALID' : 'ACTION_REVALIDATION_INVALID'));
  }
});

test('corrected packet grants no action or rollback authority and promotes no blocked gate', () => {
  assert.equal(validate(base).ok, true);
  const packet = base.authorizationPacket;
  for (const field of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds', 'derivedRollbackActionIds']) assert.deepEqual(packet[field], []);
  assert.equal(packet.status, 'FROZEN_NOT_REQUESTED');
  assert.equal(packet.approvalModel, 'EXACT_ACTION_IDS_AND_TARGETS_ONLY');
  assert.equal(packet.blanketApprovalAllowed, false);
  assert.equal(base.currentState.deploymentAuthorizationRequest, 'BLOCKED_PREREQUISITES');
  assert.equal(base.currentState.deploymentGate, 'BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE');
  for (const id of ['INTEGRATION_DEPLOYMENT_READINESS', 'PRODUCTION_TARGET_FACTS', 'PRODUCTION_DEPLOYMENT_GATE']) {
    const copy = structuredClone(base);
    const gate = copy.gates.find(gate => gate.id === id);
    assert.equal(gate.status, 'BLOCKED');
    gate.status = 'SATISFIED';
    assert.ok(codes(copy).has('GATE_STATUS_INVALID'));
  }
});
