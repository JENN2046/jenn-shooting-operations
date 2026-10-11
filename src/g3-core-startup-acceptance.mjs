import { createHash } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { assertKnownSchema } from './sqlite-schema-v2.mjs';

// Fixed administrator custody. No environment/CLI override or application-writable approval.
const CUSTODY = '/etc/jso/core-acceptance';
const TRUSTED_UID = 0;
const SOURCE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA = new URL('../contracts/g3-forward-reconciliation-exception.r3.schema.json', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
const valid = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));
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
  function walk(path, prefix = '') {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name), label = prefix + name, st = lstatSync(full);
      need(!st.isSymbolicLink(), 'SOURCE_LINK');
      if (st.isDirectory()) walk(full, label + '/');
      else { need(st.isFile(), 'SOURCE_TYPE'); files.push([label, digest(readFileSync(full))]); }
    }
  }
  walk(SOURCE);
  files.push(['../contracts/g3-forward-reconciliation-exception.r3.schema.json', digest(readFileSync(SCHEMA))]);
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
  need(valid(record), 'RECORD_INVALID');
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
    db.exec('PRAGMA query_only=ON');
    need(assertKnownSchema(db).version === 11, 'SCHEMA11');
    need(!!db.prepare('SELECT id FROM revision_counters WHERE id=1').get()
      && !!db.prepare('SELECT id FROM schedule_state WHERE id=1').get(), 'INITIALIZATION_REQUIRED');
  } finally { db.close(); }
}
export function loadCoreAcceptance(databasePath) {
  if (!existsSync(CUSTODY)) return null;
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
      && initial.baselineSha256 === record.baseline.sha256 && initial.schemaVersion === 11
      && initial.integrityOk === true && initial.foreignKeyViolations === 0
      && initial.backupRestoreVerified === true && initial.exclusiveMaintenance === true && initial.initialized === true
      && Date.parse(initial.checkedAt) >= Date.parse(record.window.start)
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
  validateCoreDatabase(record, databasePath);
  return Object.freeze({ allowed: true, reason: 'PROSPECTIVE_CORE_ACCEPTANCE',
    prepared: state === 'PREPARED', target: Object.freeze(record.target), acceptanceId: record.acceptanceId });
}
