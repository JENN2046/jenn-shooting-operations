import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyWitnessEnvelope } from '../scripts/verify-g3-forward-adoption-witness-signature.mjs';

const signatureScript = new URL('../scripts/verify-g3-forward-adoption-witness-signature.mjs', import.meta.url);
const witnessScript = new URL('../scripts/g3-forward-adoption-readonly-witness.py', import.meta.url);
const governance = new URL('../docs/operations/g3-authority-binding-reconciliation.r1.json', import.meta.url);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256 = value => 'sha256:' + createHash('sha256').update(value).digest('hex');

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyId = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  const activeSha = 'sha256:' + 'a'.repeat(64);
  const prestateSha = 'sha256:' + 'b'.repeat(64);
  const identity = (inode, sha256) => ({
    device: 3, inode, size: 4096, mode: 384, uid: 1000, gid: 1000, nlink: 1, sha256,
    fileFormatRead: 1, fileFormatWrite: 1, headerPageSizeBytes: 4096
  });
  const view = () => ({
    schemaSha256: prestateSha, columnSha256: prestateSha, indexXinfoSha256: prestateSha,
    foreignKeysSha256: prestateSha, indexListSha256: prestateSha, tableListSha256: prestateSha,
    headers: { application_id: 0 }, tables: { table_one: { rowCount: 1, rowSetSha256: prestateSha } }
  });
  const payload = {
    domain: 'G3_FORWARD_ADOPTION_OBSERVATION_R1',
    profile: 'g3',
    verifierSha256: sha256(readFileSync(witnessScript)),
    fileIdentities: { active: identity(123, activeSha), prestate: identity(456, prestateSha) },
    active: view(), prestate: view(),
    durableWriteCapabilityRevocation: 'NOT_ATTESTED',
    adoptionAuthorityAllowed: false,
    writerReadmissionAllowed: false,
    serviceStartAllowed: false,
    g4Allowed: false,
    historicalG3Governance: 'RECONCILIATION_REQUIRED',
    oldRollbackStatus: 'UNKNOWN',
    problems: [],
  };
  payload.captureDigest = sha256(Buffer.from(canonical(payload)));
  payload.status = 'READONLY_OBSERVATION_NOT_AUTHORITY';
  const bytes = Buffer.from(canonical(payload));
  const envelope = {
    payloadCanonicalBase64: bytes.toString('base64'),
    signatureBase64: sign(null, bytes, privateKey).toString('base64'),
    signerKeyId: keyId,
  };
  const opts = {
    envelope,
    publicKeyPem,
    expectedSignerKeyId: keyId,
    expectedCaptureDigest: payload.captureDigest,
    expectedVerifierDigest: payload.verifierSha256,
    expectedFileSha256: { active: activeSha, prestate: prestateSha },
  };
  return { opts, privateKey };
}

test('synthetic negative witnesses test the read-only comparator, not the production database', () => {
  const output = execFileSync('python3', [
    '-m', 'unittest', 'discover', '-s', new URL('./', import.meta.url).pathname,
    '-p', 'test_g3_forward_adoption_witness.py', '-v',
  ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(output, '');
});

test('Ed25519 signature proves a transcript signature, not adoption or containment', () => {
  const { opts } = fixture();
  const verdict = verifyWitnessEnvelope(opts);
  assert.equal(verdict.status, 'SIGNED_READONLY_OBSERVATION_NOT_ADMISSION');
  assert.equal(verdict.signatureValid, true);
  assert.equal(verdict.durableContainmentProven, false);
  assert.equal(verdict.trustedProductionOriginProvenBySignatureAlone, false);
  assert.equal(verdict.adoptionAuthorityAllowed, false);
  assert.equal(verdict.serviceStartAllowed, false);
  assert.equal(verdict.g4Allowed, false);
});

test('any payload mutation, forged key or missing trust pin fails closed', () => {
  const { opts } = fixture();
  const invalidSignature = structuredClone(opts);
  invalidSignature.envelope.signatureBase64 = Buffer.alloc(64).toString('base64');
  assert.throws(() => verifyWitnessEnvelope(invalidSignature), /SIGNATURE_INVALID/);
  assert.throws(() => verifyWitnessEnvelope({ ...opts, expectedSignerKeyId: 'sha256:' + '0'.repeat(64) }), /SIGNER_KEY_PIN_MISMATCH/);
  assert.throws(() => verifyWitnessEnvelope({ ...opts, expectedCaptureDigest: 'sha256:' + '0'.repeat(64) }), /CAPTURE_DIGEST_MISMATCH/);
  assert.throws(() => verifyWitnessEnvelope({ ...opts, expectedVerifierDigest: 'sha256:' + '0'.repeat(64) }), /OBSERVATION_NOT_SUITABLE_FOR_FUTURE_WITNESS/);
  assert.throws(() => verifyWitnessEnvelope({ ...opts, expectedCaptureDigest: undefined }), /TRUST_PIN_REQUIRED/);
});

test('validly signed lies about permission are rejected, not interpreted as authority', () => {
  const { opts, privateKey } = fixture();
  const payload = JSON.parse(Buffer.from(opts.envelope.payloadCanonicalBase64, 'base64').toString());
  payload.adoptionAuthorityAllowed = true;
  delete payload.status;
  delete payload.captureDigest;
  payload.captureDigest = sha256(Buffer.from(canonical(payload)));
  payload.status = 'READONLY_OBSERVATION_NOT_AUTHORITY';
  const bytes = Buffer.from(canonical(payload));
  const envelope = { ...opts.envelope, payloadCanonicalBase64: bytes.toString('base64'), signatureBase64: sign(null, bytes, privateKey).toString('base64') };
  assert.throws(() => verifyWitnessEnvelope({ ...opts, envelope, expectedCaptureDigest: payload.captureDigest }), /OBSERVATION_NOT_SUITABLE_FOR_FUTURE_WITNESS/);
});

test('historical gates are unchanged; review contract is non-executable', () => {
  const historic = JSON.parse(readFileSync(governance, 'utf8'));
  assert.equal(historic.status, 'RECONCILIATION_REQUIRED');
  assert.equal(historic.governance.g3GovernanceClosureAllowed, false);
  assert.equal(historic.governance.productionServiceStartAllowed, false);
  assert.equal(historic.governance.normalWriterReadmissionAllowed, false);
});

test('the minimal future-only G3 contract pins exact verifier bytes and remains non-executable', () => {
  const root = new URL('../', import.meta.url);
  const contract = JSON.parse(readFileSync(new URL('docs/operations/g3-forward-adoption-evidence-and-contract.r1.json', root)));
  const records = JSON.parse(readFileSync(governance));
  assert.equal(contract.status, 'FROZEN_NON_EXECUTABLE_REVIEW_CANDIDATE');
  assert.equal(contract.role, 'PROSPECTIVE_G3_RECONCILIATION_SUBACTION_ONLY');
  assert.equal(contract.verifiedCode.observationVerifierSha256, sha256(readFileSync(witnessScript)));
  assert.equal(contract.verifiedCode.ed25519EnvelopeVerifierSha256, sha256(readFileSync(signatureScript)));
  assert.equal(contract.historicalFacts.g3GovernanceStatus, records.status);
  assert.equal(contract.historicalFacts.g3ApprovalHead, records.trigger.approvedAuthorityHead);
  assert.equal(contract.historicalFacts.g3ExecutionHead, records.trigger.executionCanonicalHead);
  assert.equal(contract.historicalFacts.oldRollbackOutcome, 'UNKNOWN');
  assert.equal(contract.threeProofObligations.P1_DURABLE_TWO_FILE_CONTAINMENT.observableCurrentStatus, 'NOT_PROVEN');
  assert.equal(contract.threeProofObligations.P2_REPRODUCIBLE_ORIGIN_SIGNED_WITNESS.currentResult, 'NOT_YET_ATTESTED');
  assert.equal(contract.threeProofObligations.P2_SQLITE_METADATA_EQUIVALENCE.databaseByteIdentityNotRequired, true);
  assert.equal(contract.forwardOnlyGovernance.actionId, 'G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1');
  assert.equal(contract.forwardOnlyGovernance.resetHistoricalReconciliationStatusAllowed, false);
  assert.equal(contract.forwardOnlyGovernance.createsNewTopLevelGate, false);
  assert.equal(contract.forwardOnlyGovernance.automaticReadmissionAllowed, false);
  for (const field of [
    'governanceExceptionApproved','executableAuthorityTargetStatus','approvedHumanTargetStatus',
    'productionOriginTrustRootStatus','containmentAttestationStatus','signedProductionWitnessStatus'
  ]) {
    assert.match(String(contract[field]), /^(?:false|NOT_)/);
  }
  assert.equal(contract.admissibility.canConstructExecutableTargetNow, false);
  assert.equal(contract.admissibility.currentG3ClosureAllowed, false);
});
