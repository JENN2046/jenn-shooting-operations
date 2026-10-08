import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';

const MAX_ENVELOPE_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 768 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function readBoundedUtf8(path, maxBytes) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maxBytes) {
      throw new Error('INPUT_SIZE_BOUND');
    }
    const bytes = Buffer.alloc(before.size);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, used);
      if (!count) throw new Error('INPUT_SHORT_READ');
      used += count;
    }
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('INPUT_CHANGED_DURING_READ');
    }
    return bytes.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

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

function base64Strict(text, maxBytes) {
  if (typeof text !== 'string' || text.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new Error('BASE64_INPUT_SIZE_BOUND');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('NONCANONICAL_BASE64');
  }
  const data = Buffer.from(text, 'base64');
  if (data.length > maxBytes) throw new Error('BASE64_INPUT_SIZE_BOUND');
  if (data.toString('base64') !== text) throw new Error('BASE64_ROUNDTRIP_MISMATCH');
  return data;
}

// Pinned from the exact original migration image (immutable source revision).
// Do not infer schema rosters from caller-authored signed evidence.
export const G3_PRESTATE_TABLES = Object.freeze([
  'audit_log',
  'empty_db_initialization',
  'empty_db_maintenance_operations',
  'gf15_command_packets',
  'gf15_control_receipts',
  'gf15_outbox_isolation',
  'gf15_scheduling_leases',
  'kiosk_smoke_binding',
  'kiosk_smoke_outbox_isolation',
  'kiosk_smoke_phases',
  'kiosk_smoke_runtime_session',
  'kiosk_smoke_stop',
  'legacy_asset_entries',
  'legacy_compat_fragments',
  'migration_batches',
  'notification_outbox',
  'operations',
  'product_catalog_entries',
  'production_events',
  'production_runs',
  'requests_v2',
  'revision_counters',
  'run_event_id_owners',
  'run_event_reviews',
  'schedule_item_tasks',
  'schedule_items',
  'schedule_state',
  'scheduling_active_config',
  'scheduling_admin_operations',
  'scheduling_config_activations',
  'scheduling_config_versions',
  'scheduling_proposal_decisions',
  'scheduling_proposals',
  'scheduling_request_requirements',
  'scheduling_resources',
  'scheduling_run_context_snapshots',
  'schema_migrations',
  'snapshot_projections',
  'sqlite_sequence',
  'uploads',
]);
const G3_ACTIVE_TABLES = Object.freeze([
  ...G3_PRESTATE_TABLES, 'agent_grant_attempts', 'schedule_reschedule_operations'
].sort());
const G3_SCHEMA_MANIFESTS = Object.freeze({
  prestate: Object.freeze({
    schema: 'sha256:c9dc6643560b4439f2a635bbc71107eca3b2130589f453dbeb472d2101117e39',
    columns: 'sha256:2af54e93c3ed07ca86aa43a2b1a4aad8a263fef2aaefc45c7867939d01b72bf2'
  }),
  active: Object.freeze({
    schema: 'sha256:06a1e4b55b0f022bce9d8b2427bd844be6e8b7afe4afa0d6c49547c5ce0c753d',
    columns: 'sha256:eb832e1a61e67fda4327ba31dd4a162e9b9e8a965e1318a28f2d5a2041f9d204'
  })
});

function assertCompleteCapturedSchema(payload) {
  const fields = [
    'domain','profile','verifierSha256','runtime','sampling','fileIdentities',
    'prestate','active','comparedLegacyTables','schemaMigrationPrefixSha256',
    'excludedMetadata','problems','durableWriteCapabilityRevocation',
    'productionOriginSignature','historicalG3Governance','oldRollbackStatus',
    'adoptionAuthorityAllowed','writerReadmissionAllowed','serviceStartAllowed',
    'g4Allowed','captureDigest','status'
  ];
  if (!exactKeys(payload, fields)
      || !exactKeys(payload.runtime, ['python', 'sqlite'])
      || !/^3[.][0-9]+[.][0-9]+$/.test(payload.runtime.python)
      || !/^3[.][0-9]+[.][0-9]+$/.test(payload.runtime.sqlite)
      || payload.sampling !== 'PINNED_READONLY_FD_IN_MEMORY_SQLITE'
      || payload.comparedLegacyTables !== 38
      || !SHA256.test(payload.schemaMigrationPrefixSha256)
      || payload.productionOriginSignature !== 'NOT_PRESENT'
      || !exactKeys(payload.excludedMetadata, [
        'schema_version','page_count','freelist_count','cache_size',
        'synchronous','data_version','journal_mode'
      ]) || !Object.values(payload.excludedMetadata).every(v => typeof v === 'string' && v.length > 10)) {
    throw new Error('OBSERVATION_PAYLOAD_SHAPE_INVALID');
  }
  const rosters = {};
  for (const side of ['prestate', 'active']) {
    const view = payload[side];
    if (view?.schemaSha256 !== G3_SCHEMA_MANIFESTS[side].schema
        || view?.columnSha256 !== G3_SCHEMA_MANIFESTS[side].columns) {
      throw new Error('PINNED_SCHEMA_MANIFEST_MISMATCH');
    }
    if (!exactKeys(view.headers, ['application_id','user_version','encoding','page_size','auto_vacuum'])
        || !Number.isSafeInteger(view.headers.application_id)
        || !Number.isSafeInteger(view.headers.user_version)
        || view.headers.encoding !== 'UTF-8'
        || !Number.isSafeInteger(view.headers.page_size)
        || !Number.isSafeInteger(view.headers.auto_vacuum)
        || !view.tables || Array.isArray(view.tables)) {
      throw new Error('OBSERVATION_SQLITE_METADATA_INCOMPLETE');
    }
    const names = Object.keys(view.tables).sort();
    const pinnedNames = side === 'prestate' ? G3_PRESTATE_TABLES : G3_ACTIVE_TABLES;
    if (JSON.stringify(names) !== JSON.stringify(pinnedNames)) {
      throw new Error('OBSERVATION_TABLE_ROSTER_INCOMPLETE');
    }
    for (const name of names) {
      const table = view.tables[name];
      if (!exactKeys(table, ['columns','rowCount','rowSetSha256'])
          || !Array.isArray(table.columns) || table.columns.length === 0
          || table.columns.length > 512
          || table.columns.some(c => typeof c !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c))
          || !Number.isSafeInteger(table.rowCount)
          || table.rowCount < 0 || table.rowCount > 250000
          || typeof table.rowSetSha256 !== 'string' || !SHA256.test(table.rowSetSha256)) {
        throw new Error('OBSERVATION_TABLE_ROWS_INCOMPLETE');
      }
    }
    if (view.tables.schema_migrations.rowCount !== (side === 'prestate' ? 10 : 11)) {
      throw new Error('MIGRATION_PREFIX_COUNT_INVALID');
    }
    rosters[side] = names;
  }
  const added = rosters.active.filter(x => !rosters.prestate.includes(x));
  const removed = rosters.prestate.filter(x => !rosters.active.includes(x));
  if (removed.length || JSON.stringify(added) !== JSON.stringify(['agent_grant_attempts','schedule_reschedule_operations'])
      || payload.active.tables.agent_grant_attempts.rowCount !== 0
      || payload.active.tables.schedule_reschedule_operations.rowCount !== 0) {
    throw new Error('OBSERVATION_NEW_TABLE_SET_INVALID');
  }
  // Recompute determinable semantics, not merely the signer's problems: [] claim.
  for (const table of G3_PRESTATE_TABLES) {
    if (table === 'schema_migrations') continue; // version 11 adds a marker.
    if (canonical(payload.prestate.tables[table]) !== canonical(payload.active.tables[table])) {
      throw new Error('COMMON_TABLE_PARITY_MISMATCH:' + table);
    }
  }
  if (canonical(payload.prestate.headers) !== canonical(payload.active.headers)) {
    throw new Error('HEADER_PARITY_MISMATCH');
  }
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
  const bytes = base64Strict(envelope.payloadCanonicalBase64, MAX_PAYLOAD_BYTES);
  const signature = base64Strict(envelope.signatureBase64, 64);
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
  assertCompleteCapturedSchema(payload);
  for (const side of ['prestate', 'active']) {
    const identity = payload.fileIdentities[side];
    const view = payload[side];
    if (!exactKeys(identity, [
      'device','inode','size','mode','uid','gid','nlink','sha256',
      'fileFormatRead','fileFormatWrite','headerPageSizeBytes'
    ]) || !['device','inode','size','mode','uid','gid','headerPageSizeBytes'].every(k => Number.isSafeInteger(identity[k]) && identity[k] >= 0)
      || identity.inode < 1 || identity.size < 100 || identity.size > 64 * 1024 * 1024
      || identity.mode > 0o7777 || identity.nlink !== 1
      || identity.headerPageSizeBytes !== view.headers.page_size
      || identity.fileFormatRead !== 1 || identity.fileFormatWrite !== 1
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
    const envelope = JSON.parse(readBoundedUtf8(args['--envelope'], MAX_ENVELOPE_BYTES));
    const publicKeyPem = readBoundedUtf8(args['--trusted-public-key'], 8192);
    console.log(JSON.stringify(verifyWitnessEnvelope({
      envelope, publicKeyPem,
      expectedSignerKeyId: args['--expected-signer-key-id'],
      expectedCaptureDigest: args['--expected-capture-digest'],
      expectedVerifierDigest: args['--expected-verifier-digest'],
      expectedFileSha256: JSON.parse(readBoundedUtf8(args['--exact-file-target-json'], 4096))
    })));
  } catch (error) {
    fail(error.message || 'WITNESS_VERIFY_ERROR');
  }
}
