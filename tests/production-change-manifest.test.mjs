import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const validate = createProductionChangeManifestValidator(schema);

test('production change manifest validates with deployment request blocked and no authorization granted', () => {
  const result = validate(base);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.match(result.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(base.authorizationPacket.requestedActionIds.length, 0);
  assert.equal(base.authorizationPacket.approvedActionIds.length, 0);
});

test('manifest rejects secret material and any attempt to pre-authorize actions', () => {
  const secret = structuredClone(base);
  secret.secrets[0].value = 'replace-with-random-viewer-token';
  assert.equal(validate(secret).ok, false);

  const approved = structuredClone(base);
  approved.authorizationPacket.approvedActionIds = ['PROD-01-TARGET-READONLY-PREFLIGHT'];
  assert.equal(validate(approved).ok, false);
});

test('manifest rejects blanket approval and missing production blockers', () => {
  const blanket = structuredClone(base);
  blanket.authorizationPacket.blanketApprovalAllowed = true;
  assert.equal(validate(blanket).ok, false);

  const missing = structuredClone(base);
  missing.authorizationPacket.blockingGateIds = missing.authorizationPacket.blockingGateIds
    .filter(id => id !== 'WO06C_VCP_EXTERNAL');
  assert.equal(validate(missing).ok, false);
});

test('high-risk actions cannot bypass their frozen prerequisite gates', () => {
  for (const [actionId, gate] of [
    ['PROD-09-PRODUCTION-DATA-IMPORT', 'PRODUCTION_DATA_MIGRATION'],
    ['PROD-10-ENABLE-VCP-REMOTE-SYNC', 'WO06C_VCP_EXTERNAL'],
    ['PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE', 'WO06C_KIOSK_DEVICE'],
    ['PROD-13-CUTOVER-SWITCH', 'PRODUCTION_DEPLOYMENT_GATE'],
  ]) {
    const changed = structuredClone(base);
    const action = changed.actions.find(candidate => candidate.id === actionId);
    action.preconditions = action.preconditions.filter(candidate => candidate !== gate);
    assert.equal(validate(changed).ok, false, actionId);
  }
});

test('rollback references must resolve only to rollback actions', () => {
  const changed = structuredClone(base);
  changed.actions.find(action => action.id === 'PROD-05-START-ISOLATED-CONTAINER')
    .rollbackActionIds = ['PROD-04-BUILD-IMAGE'];
  assert.equal(validate(changed).ok, false);
});
