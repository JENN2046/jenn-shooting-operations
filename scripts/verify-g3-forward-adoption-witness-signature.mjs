import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fail = code => {
  console.error(JSON.stringify({ status: 'G3_FORWARD_WITNESS_SIGNATURE_REJECTED', code, adoptionAuthorityAllowed: false }));
  process.exitCode = 2;
};

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NONFINITE_VALUE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error('UNSUPPORTED_JSON_VALUE');
}

function hexSha256(value) {
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

function exactKeys(obj, keys) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj)
    && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...keys].sort());
}

function base64Strict(text) {
  if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('NONCANONICAL_BASE64');
  }
  const data = Buffer.from(text, 'base64');
  if (data.toString('base64') !== text) throw new Error('BASE64_ROUNDTRIP_MISMATCH');
  return data;
}

export function verifyWitnessEnvelope({ envelope, publicKeyPem, expectedSignerKeyId, expectedCaptureDigest, expectedVerifierDigest, expectedFileSha256 }) {
  if (!exactKeys(envelope, ['payloadCanonicalBase64', 'signatureBase64', 'signerKeyId'])) throw new Error('ENVELOPE_SHAPE_INVALID');
  for (const value of [expectedSignerKeyId, expectedCaptureDigest, expectedVerifierDigest]) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('TRUST_PIN_REQUIRED');
  }
  if (!exactKeys(expectedFileSha256, ['prestate', 'active'])
      || !Object.values(expectedFileSha256).every(v => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v))) {
    throw new Error('EXACT_FILE_TARGET_PINS_REQUIRED');
  }
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('SIGNER_ALGORITHM_INVALID');
  const actualSignerId = hexSha256(publicKey.export({ type: 'spki', format: 'der' }));
  if (actualSignerId !== expectedSignerKeyId || envelope.signerKeyId !== actualSignerId) {
    throw new Error('SIGNER_KEY_PIN_MISMATCH');
  }
  const bytes = base64Strict(envelope.payloadCanonicalBase64);
  const signature = base64Strict(envelope.signatureBase64);
  if (signature.length !== 64 || !verifySignature(null, bytes, publicKey, signature)) {
    throw new Error('SIGNATURE_INVALID');
  }
  const payloadText = bytes.toString('utf8');
  if (Buffer.from(payloadText, 'utf8').compare(bytes) !== 0) throw new Error('INVALID_UTF8');
  const payload = JSON.parse(payloadText);
  if (canonical(payload) !== payloadText) throw new Error('NONCANONICAL_OR_DUPLICATE_JSON');
  if (payload?.domain !== 'G3_FORWARD_ADOPTION_OBSERVATION_R1'
      || payload.profile !== 'g3'
      || payload.status !== 'READONLY_OBSERVATION_NOT_AUTHORITY'
      || !exactKeys(payload.fileIdentities, ['active', 'prestate'])
      || payload.verifierSha256 !== expectedVerifierDigest
      || payload.durableWriteCapabilityRevocation !== 'NOT_ATTESTED'
      || payload.adoptionAuthorityAllowed !== false
      || payload.writerReadmissionAllowed !== false
      || payload.serviceStartAllowed !== false
      || payload.g4Allowed !== false
      || payload.historicalG3Governance !== 'RECONCILIATION_REQUIRED'
      || payload.oldRollbackStatus !== 'UNKNOWN'
      || !Array.isArray(payload.problems)
      || payload.problems.length !== 0) {
    throw new Error('OBSERVATION_NOT_SUITABLE_FOR_FUTURE_WITNESS');
  }
  for (const side of ['prestate', 'active']) {
    const identity = payload.fileIdentities[side];
    const view = payload[side];
    if (!exactKeys(identity, [
      'device','inode','size','mode','uid','gid','nlink','sha256',
      'fileFormatRead','fileFormatWrite','headerPageSizeBytes'
    ]) || !Number.isSafeInteger(identity.device) || !Number.isSafeInteger(identity.inode)
      || identity.nlink !== 1 || identity.fileFormatRead !== 1 || identity.fileFormatWrite !== 1
      || identity.sha256 !== expectedFileSha256[side]
      || !exactKeys(view, [
        'schemaSha256','columnSha256','indexXinfoSha256','foreignKeysSha256',
        'indexListSha256','tableListSha256','headers','tables'
      ]) || !['schemaSha256','columnSha256','indexXinfoSha256','foreignKeysSha256','indexListSha256','tableListSha256'].every(k => typeof view[k] === 'string' && /^sha256:[a-f0-9]{64}$/.test(view[k]))
      || !view.tables || typeof view.tables !== 'object' || !Object.keys(view.tables).length) {
      throw new Error('UNBOUND_OR_INCOMPLETE_FILE_WITNESS');
    }
  }
  if (payload.fileIdentities.active.device === payload.fileIdentities.prestate.device
      && payload.fileIdentities.active.inode === payload.fileIdentities.prestate.inode) {
    throw new Error('SAME_PHYSICAL_FILE');
  }
  const copy = { ...payload };
  delete copy.captureDigest;
  delete copy.status;
  if (hexSha256(Buffer.from(canonical(copy))) !== payload.captureDigest
      || payload.captureDigest !== expectedCaptureDigest) {
    throw new Error('CAPTURE_DIGEST_MISMATCH');
  }
  return Object.freeze({
    status: 'SIGNED_READONLY_OBSERVATION_NOT_ADMISSION',
    signatureValid: true, signerKeyId: actualSignerId,
    captureDigest: payload.captureDigest,
    durableContainmentProven: false,
    trustedProductionOriginProvenBySignatureAlone: false,
    adoptionAuthorityAllowed: false,
    writerReadmissionAllowed: false,
    serviceStartAllowed: false,
    g4Allowed: false,
  });
}

function parseCli(argv) {
  if (argv.length !== 12) throw new Error('USAGE');
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--envelope', '--trusted-public-key', '--expected-signer-key-id', '--expected-capture-digest', '--expected-verifier-digest', '--exact-file-target-json'].includes(argv[i])
        || values[argv[i]] !== undefined) throw new Error('CLI_INVALID');
    values[argv[i]] = argv[i + 1];
  }
  if (Object.keys(values).length !== 6) throw new Error('CLI_INCOMPLETE');
  return values;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const args = parseCli(process.argv.slice(2));
    const envelope = JSON.parse(readFileSync(args['--envelope'], 'utf8'));
    const publicKeyPem = readFileSync(args['--trusted-public-key'], 'utf8');
    console.log(JSON.stringify(verifyWitnessEnvelope({
      envelope, publicKeyPem,
      expectedSignerKeyId: args['--expected-signer-key-id'],
      expectedCaptureDigest: args['--expected-capture-digest'],
      expectedVerifierDigest: args['--expected-verifier-digest'],
      expectedFileSha256: JSON.parse(readFileSync(args['--exact-file-target-json'], 'utf8'))
    })));
  } catch (error) {
    fail(error.message || 'WITNESS_VERIFY_ERROR');
  }
}
