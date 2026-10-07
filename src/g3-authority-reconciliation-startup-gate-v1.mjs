import { readFileSync } from 'node:fs';
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

export function isFrozenProductionDatabasePath(databasePath) {
  if (typeof databasePath !== 'string' || databasePath.length === 0) return false;
  return PRODUCTION_DATABASE_PATHS.has(resolve(databasePath));
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
