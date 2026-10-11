import { createHash } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { validateV1Snapshot, validateV2Snapshot, validateV3Snapshot } from './contract-validator.mjs';
import { sqliteFilenamePath, fileIdentity } from './sqlite-file-identity.mjs';
import { assertKnownSchema, MIGRATIONS } from './sqlite-schema-v2.mjs';
import { digestCanonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

// Fixed administrator custody. No environment/CLI override or application-writable approval.
const CUSTODY = '/etc/jso/core-acceptance';
const TRUSTED_UID = 0;
const SOURCE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA = new URL('../contracts/g3-forward-reconciliation-exception.r3.schema.json', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
const valid = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));
const validV4 = ajv.compile(JSON.parse(readFileSync(new URL('../contracts/g3-forward-reconciliation-exception.r4.schema.json',import.meta.url),'utf8')));
const fail = code => { throw new Error(`G3_CORE_ACCEPTANCE_${code}`); };
const need = (value, code) => { if (!value) fail(code); };
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function sourceDigest() {
  const files = [];
  let entries = 0, bytes = 0;
  function walk(path, prefix, depth = 0) {
    const directory = lstatSync(path);
    need(!directory.isSymbolicLink(), 'SOURCE_LINK');
    need(directory.isDirectory(), 'SOURCE_TYPE');
    need(depth <= 16, 'SOURCE_LIMIT');
    for (const name of readdirSync(path).sort()) {
      need(++entries <= 4096, 'SOURCE_LIMIT');
      const full = join(path, name), label = prefix + name, st = lstatSync(full);
      need(!st.isSymbolicLink(), 'SOURCE_LINK');
      if (st.isDirectory()) walk(full, label + '/', depth + 1);
      else {
        need(st.isFile(), 'SOURCE_TYPE');
        need(st.size <= 8 * 1024 * 1024 && bytes + st.size <= 64 * 1024 * 1024, 'SOURCE_LIMIT');
        const content = readFileSync(full), after = lstatSync(full);
        need(content.length === st.size && after.dev === st.dev && after.ino === st.ino
          && after.size === st.size && after.mtimeMs === st.mtimeMs && after.ctimeMs === st.ctimeMs,
        'SOURCE_CHANGED');
        bytes += content.length;
        files.push([label, digest(content)]);
      }
    }
  }
  // Fixed release roots, including schemas loaded at runtime and served browser assets.
  for (const name of ['src', 'contracts', 'public']) walk(join(SOURCE, '..', name), name + '/');
  return digest(canonical(files));
}
function protectedDirectory(path) {
  for (let p = resolve(path); ; p = dirname(p)) {
    const st = lstatSync(p);
    need(st.isDirectory() && st.uid === TRUSTED_UID && !(st.mode & 0o022), 'CUSTODY');
    if (p === dirname(p)) break;
  }
}
function material(name) {
  protectedDirectory(CUSTODY);
  const fd = openSync(join(CUSTODY, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    need(before.isFile() && before.uid === TRUSTED_UID && before.nlink === 1
      && !(before.mode & 0o022) && before.size > 0 && before.size <= 131072, 'MATERIAL');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    need(bytes.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs
      && before.ctimeMs === after.ctimeMs, 'MATERIAL_CHANGED');
    return bytes;
  } finally { closeSync(fd); }
}
function jsonMaterial(name) {
  const raw = material(name).toString('utf8'), value = JSON.parse(raw);
  // A single canonical representation rejects duplicate keys and ambiguous encodings.
  need(raw === canonical(value) + '\n', 'NON_CANONICAL_RECORD');
  return value;
}
function exact(value, keys) {
  need(value && canonical(Object.keys(value).sort()) === canonical(keys.sort()), 'RECORD_FIELDS');
}
export function runtimeConfigDigest(env = process.env) {
  const keys = ['HOST','PORT','UPLOAD_ROOT','VIEWER_TOKEN','SUBMITTER_TOKEN','SCHEDULER_TOKEN','ADMIN_TOKEN',
    'JSO_BUSINESS_RUNTIME','JSO_BUSINESS_IDENTITIES_JSON','KIOSK_SERVICE_CONTEXT'];
  return digest(canonical(Object.fromEntries(keys.map(k => [k, env[k] ?? null]))));
}
export function validateCoreRecord(record, { now = Date.now() } = {}) {
  need((record?.version===4?validV4:valid)(record), 'RECORD_INVALID');
  const start = Date.parse(record.window.start), end = Date.parse(record.window.end);
  need(start < end && Date.parse(record.ownerApprovedAt) <= now, 'WINDOW');
  if (record.state === 'PREPARED') {
    need(record.activation === null && now >= start && now <= end, 'PREPARED_WINDOW');
  } else {
    const accepted = Date.parse(record.activation?.acceptedAt);
    need(record.activation !== null && accepted >= start && accepted <= end && accepted <= now && accepted >= Date.parse(record.ownerApprovedAt), 'ACTIVATION');
  }
  return record;
}
function validateCoreUploadRoot(target) {
  const path = target.uploadRoot;
  let st, canonicalPath;
  try {
    st = lstatSync(path);
    canonicalPath = realpathSync(path);
  } catch { fail('UPLOAD_IDENTITY'); }
  need(resolve(path) === path && canonicalPath === path
    && st.isDirectory() && !st.isSymbolicLink()
    && st.dev === target.uploadIdentity.device && st.ino === target.uploadIdentity.inode,
  'UPLOAD_IDENTITY');
}
export function validateCoreDatabase(record, filename) {
  need(resolve(filename) === record.target.databasePath && realpathSync(filename) === record.target.databasePath, 'DATABASE_PATH');
  const st = lstatSync(filename), identity = record.target.databaseIdentity;
  need(st.isFile() && st.nlink === 1 && st.dev === identity.device && st.ino === identity.inode, 'DATABASE_IDENTITY');
  if (record.state === 'PREPARED') {
    for (const suffix of ['-wal','-shm','-journal']) need(!existsSync(filename + suffix), 'BASELINE_SIDEFILE');
    const bytes = readFileSync(filename);
    need(bytes[18] === 1 && bytes[19] === 1, 'PREPARED_ROLLBACK_JOURNAL_REQUIRED');
    need(digest(bytes) === record.baseline.sha256, 'BASELINE_DIGEST');
  }
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    need(assertKnownSchema(db).version === record.baseline.schemaVersion, 'SCHEMA_BINDING');
    const counter = db.prepare('SELECT * FROM revision_counters WHERE id=1').get();
    const legacy = db.prepare('SELECT * FROM schedule_state WHERE id=1').get();
    need(counter && legacy, 'INITIALIZATION_REQUIRED');
    validateCoreLegacySnapshot(legacy);
    const initial = db.prepare('SELECT * FROM empty_db_initialization WHERE id=1').get();
    validateCoreInitializationSnapshot({ initial, counter, schemaVersion:record.baseline.schemaVersion,
      audits: initial ? db.prepare(`SELECT * FROM audit_log
        WHERE action='emptyDbMaintenanceV1' AND entity_id=?`).all(initial.operation_id) : [],
      projections: db.prepare('SELECT * FROM snapshot_projections ORDER BY projection_name').all() });
  } finally { db.close(); }
}

// Validate the independent V1 row, not the V2 revision counter. Never normalize or repair it.
export function validateCoreLegacySnapshot(row) {
  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { fail('LEGACY_SNAPSHOT_JSON'); }
  need(validateV1Snapshot(snapshot).ok, 'LEGACY_SNAPSHOT_CONTRACT');
  need(snapshot.revision === row.revision && snapshot.updatedAt === row.updated_at,
    'LEGACY_SNAPSHOT_BINDING');
}

// Locate scope using administrator-owned material before checking runtime eligibility.
// A remaining complete locator can scope an incomplete installation. If none survives,
// file-backed stores fail closed because we cannot prove they are outside the target.
function concernsCoreDatabase(databasePath) {
  if (databasePath === ':memory:' || databasePath === '') return false;
  const filename = resolve(sqliteFilenamePath(databasePath));
  const current = fileIdentity(filename);
  const targets = [];
  for (const name of ['acceptance.json', 'installation.json']) {
    try {
      const target = jsonMaterial(name)?.target;
      if (typeof target?.databasePath === 'string' && target.databasePath === resolve(target.databasePath)
        && Number.isSafeInteger(target.databaseIdentity?.device)
        && Number.isSafeInteger(target.databaseIdentity?.inode)) targets.push(target);
    } catch { /* Full validation below still rejects missing or damaged target material. */ }
  }
  need(targets.length > 0, 'TARGET_SCOPE_UNAVAILABLE');
  return targets.some(target => filename === target.databasePath
    || current?.realpath === target.databasePath
    || (current && current.device === target.databaseIdentity.device
      && current.inode === target.databaseIdentity.inode));
}

// The receipt describes the original transaction; projections describe current state.
// Neither current revisions nor the legacy snapshot must remain at their initial zero.
export function validateCoreInitializationSnapshot({ initial, counter, audits, projections, schemaVersion=11 }) {
  need(initial, 'INITIALIZATION_REQUIRED');
  let response, binding;
  try { response = JSON.parse(initial.response_json); binding = JSON.parse(initial.binding_json); }
  catch { fail('INITIALIZATION_RECEIPT'); }
  const expected = { ok: true, kind: 'initialize', operationId: initial.operation_id,
    packetDigest: initial.packet_digest, scheduleRevision: 0, projectionRevision: 0,
    initializedAt: initial.created_at };
  need(canonical(response) === canonical(expected)
    && digestCanonicalJsonSchedulingV1(response) === initial.response_digest
    && /^sha256:[a-f0-9]{64}$/u.test(initial.packet_digest)
    && typeof initial.operation_id === 'string' && initial.operation_id.length > 0
    && Number.isFinite(Date.parse(initial.created_at))
    && typeof binding?.actor === 'string' && binding.actor.length > 0
    && binding.businessTimeZone === 'Asia/Shanghai'
    && (schemaVersion===12?[12]:[10,11]).some(version => binding.schemaDigest === digestCanonicalJsonSchedulingV1(
      MIGRATIONS.slice(0, version).map(({ version, name, checksum }) => ({ version, name, checksum })))),
  'INITIALIZATION_RECEIPT');
  need(audits.length === 1 && audits[0].action === 'emptyDbMaintenanceV1'
    && audits[0].entity_id === initial.operation_id && audits[0].role === binding.actor
    && audits[0].revision === 0 && audits[0].result === initial.packet_digest
    && audits[0].created_at === initial.created_at, 'INITIALIZATION_AUDIT');
  need(projections.length === (schemaVersion===12?1:2) && Number.isSafeInteger(counter.schedule_revision)
    && counter.schedule_revision >= 0 && Number.isSafeInteger(counter.projection_revision)
    && counter.projection_revision >= 0, 'INITIALIZATION_PROJECTIONS');
  for (const [index, name] of (schemaVersion===12?['schedule-v3']:['schedule-v1-compat', 'schedule-v2']).entries()) {
    const row = projections[index], version = schemaVersion===12?3:index + 1;
    let payload;
    try { payload = JSON.parse(row.payload_json); } catch { fail('INITIALIZATION_PROJECTIONS'); }
    try {
      const validation = version === 1
        ? validateV1Snapshot(payload, { profile: 'legacy-read' })
        : (version === 3 ? validateV3Snapshot : validateV2Snapshot)(payload);
      need(validation.ok && (version !== 1 || (validation.switchReady === true
        && ['L0_STRICT', 'L1_GRANDFATHERED_OPAQUE'].includes(validation.classification))),
      'INITIALIZATION_PROJECTIONS');
    } catch { fail('INITIALIZATION_PROJECTIONS'); }
    need(row.projection_name === name && row.schema_version === version && row.source_schema_version === (schemaVersion===12?12:2)
      && row.revision === counter.projection_revision
      && row.schedule_revision === (version === 1 ? null : counter.schedule_revision)
      && row.updated_at === counter.updated_at && payload?.schemaVersion === version
      && payload.updatedAt === row.updated_at
      && (version === 1 ? payload.revision === row.revision
        : payload.projectionRevision === row.revision && payload.scheduleRevision === row.schedule_revision),
    'INITIALIZATION_PROJECTIONS');
  }
}
export function loadCoreAcceptance(databasePath) {
  if (!existsSync(CUSTODY)) return null;
  if (!concernsCoreDatabase(databasePath)) return null;
  need(process.getuid() !== 0, 'NON_ROOT_APP_REQUIRED');
  const record = validateCoreRecord(jsonMaterial('acceptance.json'));
  const approval = jsonMaterial('owner-approval.json');
  exact(approval, ['acceptanceScopeSha256','ownerSource','ownerApprovedAt','ownerTextSha256']);
  const { state, activation, ...scope } = record;
  need(approval.acceptanceScopeSha256 === digest(canonical(scope))
    && approval.ownerSource === record.ownerSource && approval.ownerApprovedAt === record.ownerApprovedAt
    && approval.ownerTextSha256 === record.ownerTextSha256
    && digest(material('owner-approval.txt')) === record.ownerTextSha256, 'OWNER_BINDING');
  for (const [name, pin] of [
    ['plan.txt', record.planSha256], ['historical-evidence.json', record.baseline.historicalEvidenceSha256],
    ['backup-manifest.json', record.baseline.backupManifestSha256],
    ['restore-verification.json', record.baseline.restoreVerificationSha256],
  ]) need(digest(material(name)) === pin, 'EVIDENCE_BINDING');
  if (state === 'ACTIVE') {
    need(digest(material('initial-verification.json')) === activation.initialVerificationSha256, 'INITIAL_VERIFICATION_PIN');
    const initial = jsonMaterial('initial-verification.json');
    exact(initial, ['acceptanceScopeSha256','baselineSha256','checkedAt','schemaVersion','integrityOk',
      'foreignKeyViolations','backupRestoreVerified','exclusiveMaintenance','initialized']);
    need(initial.acceptanceScopeSha256 === approval.acceptanceScopeSha256
      && initial.baselineSha256 === record.baseline.sha256 && initial.schemaVersion === record.baseline.schemaVersion
      && initial.integrityOk === true && initial.foreignKeyViolations === 0
      && initial.backupRestoreVerified === true && initial.exclusiveMaintenance === true && initial.initialized === true
      && Date.parse(initial.checkedAt) >= Date.parse(record.window.start)
      && Date.parse(initial.checkedAt) >= Date.parse(record.ownerApprovedAt)
      && Date.parse(initial.checkedAt) <= Date.parse(activation.acceptedAt), 'INITIAL_VERIFICATION');
  }
  const installed = jsonMaterial('installation.json');
  exact(installed, ['acceptanceSha256','release','target','runtimeConfigSha256','installedBy']);
  need(typeof installed.installedBy === 'string' && installed.installedBy.length > 0
    && (state !== 'ACTIVE' || installed.installedBy === activation.installedBy)
    && installed.acceptanceSha256 === digest(canonical(record) + '\n')
    && canonical(installed.release) === canonical(record.release)
    && canonical(installed.target) === canonical(record.target)
    && installed.runtimeConfigSha256 === record.policy.runtimeConfigSha256, 'INSTALLATION_BINDING');
  // Image/host/mount identity is an administrator attestation, not container self-report.
  need(sourceDigest() === record.release.sourceSha256, 'CODE_CHANGED');
  need(runtimeConfigDigest() === record.policy.runtimeConfigSha256, 'CONFIG_CHANGED');
  need(process.env.KIOSK_SERVICE_CONTEXT === 'PROD11_PRODUCTION'
    && process.env.JSO_BUSINESS_RUNTIME === 'enabled'
    && process.env.ORPHAN_CLEANUP_MODE === 'disabled', 'CORE_SCOPE');
  // Check the approved attachment root before opening the store or creating anything.
  validateCoreUploadRoot(record.target);
  validateCoreDatabase(record, databasePath);
  return Object.freeze({ allowed: true, reason: 'PROSPECTIVE_CORE_ACCEPTANCE',
    prepared: state === 'PREPARED', target: Object.freeze(record.target), acceptanceId: record.acceptanceId });
}
