import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const validate = createProductionChangeManifestValidator(schema);
const action = value => value.actions.find(({ id }) => id === 'PROD-13-CUTOVER-SWITCH');
const reject = (mutate, code) => {
  const value = structuredClone(base);
  mutate(value);
  const result = validate(value);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === code), `${code}: ${JSON.stringify(result.issues)}`);
};

test('final-sync exception is narrow, delayed until source drain, revoked/drained and sealed before parity', () => {
  assert.equal(validate(base).ok, true);
  const effects = action(base).effects;
  assert.equal(effects.length, 8);
  assert.match(effects[0], /deny every staging.*no sync exception active/u);
  assert.match(effects[1], /no sync exception active.*database and attachment/u);
  assert.match(effects[2], /Only after.*source database\/upload barrier is held and drained.*separately approved operation-bound final-sync identity/u);
  for (const term of ['both epochs', 'source/target identities', 'scope and finite bounds', 'offline grants none']) assert.match(effects[2], new RegExp(term.replace('/', '\\/'), 'u'));
  assert.match(effects[2], /revoke, drain DB and attachments, and seal/u);
  assert.match(effects[3], /zero active exceptions and zero in-flight mutations.*delayed, replayed or stale-epoch grants/u);
  assert.match(effects[4], /sync stays sealed, no exception or mutation is active/u);
  assert.match(effects[6], /uncertain acquisition, sync\/revocation, drain, restart, ownership.*never retries sync or reopens admission automatically/u);

  const pre = base.authorizationPacket.actionSpecificRevalidation['PROD-13-CUTOVER-SWITCH'];
  for (const plan of ['SOURCE_WRITE_BARRIER_CAPABILITY_PROOF', 'SOURCE_WRITE_BARRIER_PLAN', 'FINAL_SYNC_OPERATION_AND_AUTHORITY_TARGETS', 'FINAL_SYNC_EXCEPTION_ADMISSION_REVOCATION_DRAIN_AND_SEAL_PLAN']) assert.ok(pre.includes(plan));
  for (const receipt of ['FINAL_SYNC_EXCEPTION_ADMISSION_RECEIPT', 'FINAL_SYNC_EXCEPTION_REVOCATION_RECEIPT', 'FINAL_SYNC_DATABASE_DRAIN_RECEIPT', 'FINAL_SYNC_ATTACHMENT_DRAIN_RECEIPT', 'FINAL_SYNC_PHASE_SEALED_RECEIPT', 'ZERO_ACTIVE_SYNC_EXCEPTION_AND_MUTATION_PROOF']) {
    assert.ok(action(base).evidenceRequired.includes(receipt));
    assert.equal(pre.includes(receipt), false);
    reject(value => { action(value).evidenceRequired = action(value).evidenceRequired.filter(item => item !== receipt); }, 'ACTION_EVIDENCE_REQUIRED_INVALID');
  }
});

test('hostile final-sync bypasses, early/late grants, ordinary reopening and offline invented writes fail closed', () => {
  const hostile = [
    [0, 'Acquire target fence but allow a blanket admin or final-sync bypass immediately'],
    [1, 'Drain some writers while the synchronization exception is already active'],
    [2, 'Before source drain, grant any sync identity general target and source writes with no operation or epoch binding'],
    [2, 'Offline mode grants a convenient target writer exception'],
    [3, 'Compute parity while a synchronization exception or attachment mutation remains active'],
    [4, 'After parity replay a stale-epoch synchronization grant'],
    [5, 'During Switch reopen ordinary staging and direct-storage writes'],
    [6, 'After restart retry the possibly committed sync and automatically reopen admission'],
  ];
  for (const [index, replacement] of hostile) reject(value => { action(value).effects[index] = replacement; }, 'ACTION_EFFECTS_INVALID');
  reject(value => { const e=action(value).effects; [e[2],e[3]]=[e[3],e[2]]; }, 'ACTION_EFFECTS_INVALID');
  reject(value => { value.gates.find(({id}) => id === 'CUTOVER_TARGET_WRITE_FENCE_CAPABILITY').status='SATISFIED'; }, 'GATE_STATUS_INVALID');
  assert.deepEqual(base.authorizationPacket.requestedActionIds, []);
  assert.deepEqual(base.authorizationPacket.approvedActionIds, []);
  assert.deepEqual(base.authorizationPacket.requestableActionIds, []);
  assert.deepEqual(base.authorizationPacket.derivedRollbackActionIds, []);
});
