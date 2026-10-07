import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const RECONCILIATION_RECORD_URL = new URL(
  '../docs/operations/g3-authority-binding-reconciliation.r1.json',
  import.meta.url,
);

const PRODUCTION_DATABASE_PATHS = Object.freeze(new Set([
  '/app/data/shooting-operations.sqlite',
  '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data/shooting-operations.sqlite',
]));

function loadFrozenReconciliationRecord() {
  let value;
  try {
    value = JSON.parse(readFileSync(RECONCILIATION_RECORD_URL, 'utf8'));
  } catch {
    throw new Error('G3_AUTHORITY_RECONCILIATION_RECORD_UNAVAILABLE');
  }
  if (value?.schemaVersion !== 1
      || value?.reconciliationId !== 'G3_AUTHORITY_BINDING_RECONCILIATION_R1'
      || typeof value?.status !== 'string') {
    throw new Error('G3_AUTHORITY_RECONCILIATION_RECORD_INVALID');
  }
  return value;
}

function fileIdentity(path) {
  try {
    const realpath = realpathSync(resolve(path));
    const metadata = statSync(realpath);
    if (!metadata.isFile()) return null;
    return Object.freeze({
      realpath,
      device: metadata.dev,
      inode: metadata.ino,
    });
  } catch {
    return null;
  }
}

export function pathsReferToSameFile(left, right) {
  const leftIdentity = fileIdentity(left);
  const rightIdentity = fileIdentity(right);
  if (!leftIdentity || !rightIdentity) return false;
  return leftIdentity.realpath === rightIdentity.realpath
    || (leftIdentity.device === rightIdentity.device
      && leftIdentity.inode === rightIdentity.inode);
}

export function isFrozenProductionDatabasePath(databasePath) {
  if (typeof databasePath !== 'string' || databasePath.length === 0) return false;
  const resolved = resolve(databasePath);
  if (PRODUCTION_DATABASE_PATHS.has(resolved)) return true;

  let realpath = null;
  try { realpath = realpathSync(resolved); } catch {}
  if (realpath && PRODUCTION_DATABASE_PATHS.has(realpath)) return true;

  return [...PRODUCTION_DATABASE_PATHS]
    .some(productionPath => pathsReferToSameFile(resolved, productionPath));
}

export function assertG3AuthorityReconciliationStartupAllowed({
  databasePath,
  reconciliationRecord,
} = {}) {
  if (!isFrozenProductionDatabasePath(databasePath)) {
    return Object.freeze({ allowed: true, reason: 'NON_PRODUCTION_DATABASE_PATH' });
  }
  const record = reconciliationRecord ?? loadFrozenReconciliationRecord();
  if (record.status === 'RECONCILIATION_REQUIRED'
      || record.governance?.productionServiceStartAllowed !== true
      || record.governance?.normalWriterReadmissionAllowed !== true) {
    throw new Error('G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED');
  }
  return Object.freeze({ allowed: true, reason: 'RECONCILIATION_CLEARED' });
}
