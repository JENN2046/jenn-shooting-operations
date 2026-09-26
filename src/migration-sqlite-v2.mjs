import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  MigrationError,
  buildMigrationPlan,
  canonicalJson,
  sha256Digest,
} from './migration-v2.mjs';
import { assertKnownSchema } from './sqlite-schema-v2.mjs';
import { filesystemPathComparisonKey } from './platform-filesystem.mjs';
import {
  projectV1CompatibilitySnapshot,
  projectV2Snapshot,
} from './projections-v2.mjs';

const REQUIRED_SOURCE_COLUMNS = Object.freeze({
  schedule_state: ['id', 'revision', 'updated_at', 'snapshot_json'],
  operations: ['operation_id', 'kind', 'response_json', 'created_at'],
  audit_log: ['id', 'action', 'role', 'entity_id', 'revision', 'result', 'created_at'],
  uploads: [
    'id', 'operation_id', 'original_name', 'content_type', 'kind', 'size', 'sha256',
    'stored_name', 'claimed_task_id', 'created_at',
  ],
});

const REQUIRED_TARGET_TABLES = Object.freeze([
  'schema_migrations',
  'migration_batches',
  'revision_counters',
  'product_catalog_entries',
  'requests_v2',
  'schedule_items',
  'schedule_item_tasks',
  'legacy_asset_entries',
  'legacy_compat_fragments',
  'production_runs',
  'production_events',
  'run_event_id_owners',
  'run_event_reviews',
  'notification_outbox',
  'snapshot_projections',
]);

const STAGED_CLEANUP_FILE = /^(?<storedName>[a-f0-9]{64}\.[a-z0-9]+)\.cleanup-[0-9a-f-]{36}$/;

function fail(code, result) {
  throw new MigrationError(code, result);
}

function hasNonFilesystemScheme(input) {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(input)) return false;
  return !/^[A-Za-z]:[\\/]/u.test(input);
}

export function resolveExistingPath(input, expectedType = 'file') {
  if (typeof input !== 'string' || !input || input.includes('\0') || !isAbsolute(input)
      || hasNonFilesystemScheme(input)) {
    fail('INVALID_PATH', 'INVALID_USAGE');
  }
  let realPath;
  let metadata;
  try {
    realPath = realpathSync(input);
    metadata = statSync(realPath, { bigint: true });
  } catch {
    fail('INVALID_PATH', 'INVALID_USAGE');
  }
  const valid = expectedType === 'directory' ? metadata.isDirectory() : metadata.isFile();
  if (!valid) fail('INVALID_PATH', 'INVALID_USAGE');
  return {
    realPath,
    pathDigest: sha256Digest(realPath),
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
  };
}

export function sameFile(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

export function readResourceMapFile(pathInfo) {
  let metadata;
  try {
    metadata = statSync(pathInfo.realPath);
  } catch {
    fail('RESOURCE_MAP_INVALID', 'INVALID_USAGE');
  }
  if (!metadata.isFile() || metadata.size > 1024 * 1024) {
    fail('RESOURCE_MAP_INVALID', 'INVALID_USAGE');
  }
  try {
    return readFileSync(pathInfo.realPath, 'utf8');
  } catch {
    fail('RESOURCE_MAP_INVALID', 'INVALID_USAGE');
  }
}

function tableShape(db) {
  const tableNames = db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
  return tableNames.map(name => ({
    name,
    columns: db.prepare(`
      SELECT name, type, "notnull", pk
      FROM pragma_table_info(?) ORDER BY cid
    `).all(name).map(column => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      pk: column.pk,
    })),
  }));
}

function assertSourceShape(shape) {
  const byName = new Map(shape.map(table => [table.name, new Set(table.columns.map(column => column.name))]));
  for (const [table, columns] of Object.entries(REQUIRED_SOURCE_COLUMNS)) {
    const actual = byName.get(table);
    if (!actual || columns.some(column => !actual.has(column))) fail('SOURCE_SCHEMA_MISSING', 'INVALID_SOURCE');
  }
}

function pragmaOk(db, name) {
  const rows = db.prepare(`PRAGMA ${name}`).all();
  return rows.length === 1 && Object.values(rows[0])[0] === 'ok';
}

function openReadOnly(path, invalidResult) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const queryOnly = db.prepare('PRAGMA query_only').get();
    if (Number(queryOnly?.query_only) !== 1) fail('QUERY_ONLY_NOT_ENFORCED', invalidResult);
    return db;
  } catch (error) {
    try { db?.close(); } catch {}
    if (error instanceof MigrationError) throw error;
    fail(invalidResult === 'INVALID_TARGET' ? 'INVALID_TARGET' : 'INVALID_SOURCE', invalidResult);
  }
}

function hashFamilyFileStable(path, expectedMetadata) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()
        || before.dev !== expectedMetadata.dev
        || before.ino !== expectedMetadata.ino) {
      fail('SOURCE_CHANGED_DURING_SCAN', 'INVALID_SOURCE');
    }
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs) {
      fail('SOURCE_CHANGED_DURING_SCAN', 'INVALID_SOURCE');
    }
    return `sha256:${digest.digest('hex')}`;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('SOURCE_CHANGED_DURING_SCAN', 'INVALID_SOURCE');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fileIdentity(path, { includeCtime = true, includeDigest = false, requireSingleLink = false } = {}) {
  let metadata;
  try {
    metadata = lstatSync(path, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('SOURCE_CHANGED_DURING_SCAN', 'INVALID_SOURCE');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()
      || (requireSingleLink && metadata.nlink !== 1n)) {
    fail('SOURCE_CHANGED_DURING_SCAN', 'INVALID_SOURCE');
  }
  const identity = {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
  };
  if (includeCtime) identity.ctimeNs = metadata.ctimeNs.toString();
  if (includeDigest) identity.digest = hashFamilyFileStable(path, metadata);
  return identity;
}

function sqliteFamilyNamespace(path) {
  return Object.freeze({
    database: sha256Digest(filesystemPathComparisonKey(path, path)),
    wal: sha256Digest(filesystemPathComparisonKey(`${path}-wal`, path)),
    shm: sha256Digest(filesystemPathComparisonKey(`${path}-shm`, path)),
    journal: sha256Digest(filesystemPathComparisonKey(`${path}-journal`, path)),
  });
}

function sourceFamily(
  path,
  { includeDatabaseDigest = false, requireSingleLink = false } = {},
) {
  return {
    namespace: sqliteFamilyNamespace(path),
    database: fileIdentity(path, {
      includeDigest: includeDatabaseDigest,
      requireSingleLink,
    }),
    wal: fileIdentity(`${path}-wal`, {
      includeCtime: false,
      includeDigest: true,
      requireSingleLink,
    }),
    shm: fileIdentity(`${path}-shm`, { requireSingleLink }),
    journal: fileIdentity(`${path}-journal`, { requireSingleLink }),
  };
}

function sameSourceFamily(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function captureSqlitePhysicalFamily(
  pathInfo,
  { includeDatabaseDigest = false, requireSingleLink = false } = {},
) {
  if (!pathInfo || typeof pathInfo.realPath !== 'string') {
    fail('INVALID_PATH', 'INVALID_USAGE');
  }
  return sourceFamily(pathInfo.realPath, { includeDatabaseDigest, requireSingleLink });
}

export function sameSqlitePhysicalFamily(left, right) {
  return sameSourceFamily(left, right);
}

export function sqlitePhysicalFamiliesAreDisjoint(left, right) {
  const keys = ['database', 'wal', 'shm', 'journal'];

  for (const leftPath of Object.values(left?.namespace ?? {})) {
    for (const rightPath of Object.values(right?.namespace ?? {})) {
      if (leftPath === rightPath) return false;
    }
  }

  for (const leftKey of keys) {
    const leftMember = left?.[leftKey];
    if (!leftMember) continue;
    for (const rightKey of keys) {
      const rightMember = right?.[rightKey];
      if (!rightMember) continue;
      if (leftMember.device === rightMember.device
          && leftMember.inode === rightMember.inode) {
        return false;
      }
    }
  }
  return true;
}

export function readV1Source(pathInfo, { duringScan } = {}) {
  const beforeFamily = sourceFamily(pathInfo.realPath);
  const db = openReadOnly(pathInfo.realPath, 'INVALID_SOURCE');
  let inTransaction = false;
  let closed = false;
  try {
    db.exec('BEGIN');
    inTransaction = true;
    if (!pragmaOk(db, 'quick_check')) fail('SOURCE_INTEGRITY_FAILED', 'INVALID_SOURCE');
    const shape = tableShape(db);
    assertSourceShape(shape);
    const scheduleRows = db.prepare(`
      SELECT id, revision, updated_at, snapshot_json
      FROM schedule_state ORDER BY id
    `).all();
    if (scheduleRows.length !== 1 || scheduleRows[0].id !== 1) {
      fail('SNAPSHOT_ROW_COUNT_INVALID', 'INVALID_SOURCE');
    }
    let snapshot;
    try {
      snapshot = JSON.parse(scheduleRows[0].snapshot_json);
    } catch {
      fail('SNAPSHOT_INVALID', 'INVALID_SOURCE');
    }
    if (snapshot?.revision !== scheduleRows[0].revision
        || snapshot?.updatedAt !== scheduleRows[0].updated_at) {
      fail('SNAPSHOT_REVISION_MISMATCH', 'INVALID_SOURCE');
    }
    const operationRows = db.prepare(`
      SELECT operation_id, kind, response_json, created_at
      FROM operations ORDER BY operation_id
    `).all();
    const uploadColumns = new Set(shape.find(table => table.name === 'uploads').columns.map(column => column.name));
    const claimedOrder = uploadColumns.has('claimed_order') ? ', claimed_order' : '';
    const uploadRows = db.prepare(`
      SELECT id, operation_id, original_name, content_type, kind, size, sha256,
             stored_name, claimed_task_id, created_at${claimedOrder}
      FROM uploads ORDER BY id
    `).all();
    const auditSummary = db.prepare(`
      SELECT COUNT(*) AS count, MIN(revision) AS min_revision, MAX(revision) AS max_revision
      FROM audit_log
    `).get();
    if (duringScan) duringScan();
    db.exec('COMMIT');
    inTransaction = false;
    db.close();
    closed = true;
    return {
      snapshot,
      operations: operationRows,
      uploads: uploadRows,
      auditSummary,
      schemaDigest: sha256Digest(shape),
      structuralDigest: sha256Digest({
        snapshot,
        operations: operationRows,
        uploads: uploadRows,
        auditSummary,
      }),
      queryOnly: true,
    };
  } catch (error) {
    if (inTransaction) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    if (error instanceof MigrationError) throw error;
    fail('INVALID_SOURCE', 'INVALID_SOURCE');
  } finally {
    if (!closed) db.close();
    const afterFamily = sourceFamily(pathInfo.realPath);
    if (!sameSourceFamily(beforeFamily, afterFamily)) {
      fail('SOURCE_CHANGED_DURING_SCAN', 'INVALID_SOURCE');
    }
  }
}

function sameFileStat(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function hashOpenFileReadOnly(descriptor) {
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  while (true) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
  }
  return digest.digest('hex');
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function observeStagedCleanupTombstones(uploadRootInfo, summary, manifestFail) {
  const cleanupPath = resolve(uploadRootInfo.realPath, '.cleanup');
  let before;
  try {
    before = lstatSync(cleanupPath, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    summary.unsafePaths += 1;
    manifestFail('UPLOAD_PATH_UNSAFE');
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    summary.unsafePaths += 1;
    manifestFail('UPLOAD_PATH_UNSAFE');
  }

  let entries;
  try {
    entries = readdirSync(cleanupPath, { withFileTypes: true });
  } catch {
    summary.unsafePaths += 1;
    manifestFail('UPLOAD_PATH_UNSAFE');
  }
  for (const entry of entries) {
    if (!STAGED_CLEANUP_FILE.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      summary.unsafePaths += 1;
      manifestFail('UPLOAD_PATH_UNSAFE');
    }
    summary.stagedTombstonesObserved += 1;
  }

  let after;
  try {
    after = lstatSync(cleanupPath, { bigint: true });
  } catch {
    manifestFail('UPLOAD_SET_CHANGED_DURING_SCAN');
  }
  if (!sameFileStat(before, after)) manifestFail('UPLOAD_SET_CHANGED_DURING_SCAN');
  if (summary.stagedTombstonesObserved > 0) {
    manifestFail('STAGED_UPLOAD_RECOVERY_REQUIRED');
  }
}

export function verifyUploadManifest(uploadRootInfo, plan, {
  hashUploads = false,
  duringFileScan,
} = {}) {
  const fileUploads = plan.records.uploads.filter(upload => upload.stored_name !== null);
  const summary = {
    validationStatus: 'FAILED',
    databaseReferencesValid: true,
    filesChecked: 0,
    filesMissing: 0,
    sizeMismatches: 0,
    hashesChecked: 0,
    hashMismatches: 0,
    unsafePaths: 0,
    stagedTombstonesObserved: 0,
    uploadSetStable: false,
  };
  const manifestFail = (code, result = 'INVALID_SOURCE') => {
    const error = new MigrationError(code, result);
    error.attachmentManifest = { ...summary };
    throw error;
  };
  if (uploadRootInfo) observeStagedCleanupTombstones(uploadRootInfo, summary, manifestFail);
  if (fileUploads.length === 0) {
    return {
      ...summary,
      validationStatus: 'PASS_NO_FILES',
      uploadSetStable: true,
      issues: [],
    };
  }
  if (!uploadRootInfo) {
    summary.validationStatus = 'NOT_RUN';
    manifestFail('UPLOAD_ROOT_REQUIRED', 'INVALID_USAGE');
  }
  const rootPrefix = `${uploadRootInfo.realPath}${sep}`;
  let filesChecked = 0;
  let hashesChecked = 0;
  for (const upload of fileUploads) {
    const storedName = upload.stored_name;
    if (typeof storedName !== 'string' || storedName.length === 0 || storedName.includes('\0')
        || basename(storedName) !== storedName || storedName.includes('/') || storedName.includes('\\')) {
      summary.unsafePaths += 1;
      manifestFail('UPLOAD_PATH_UNSAFE');
    }
    const candidate = resolve(uploadRootInfo.realPath, storedName);
    if (!candidate.startsWith(rootPrefix)) {
      summary.unsafePaths += 1;
      manifestFail('UPLOAD_PATH_UNSAFE');
    }
    let linkMetadata;
    try {
      linkMetadata = lstatSync(candidate, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        summary.filesMissing += 1;
        manifestFail('UPLOAD_FILE_MISSING');
      }
      summary.unsafePaths += 1;
      manifestFail('UPLOAD_PATH_UNSAFE');
    }
    if (linkMetadata.isSymbolicLink() || !linkMetadata.isFile()) {
      summary.unsafePaths += 1;
      manifestFail('UPLOAD_PATH_UNSAFE');
    }
    if (duringFileScan) duringFileScan();
    let descriptor;
    try {
      descriptor = openSync(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        summary.filesMissing += 1;
        manifestFail('UPLOAD_FILE_MISSING');
      }
      summary.unsafePaths += 1;
      manifestFail('UPLOAD_PATH_UNSAFE');
    }
    try {
      const before = fstatSync(descriptor, { bigint: true });
      if (!before.isFile() || !sameFileIdentity(linkMetadata, before)) {
        manifestFail('UPLOAD_SET_CHANGED_DURING_SCAN');
      }
      summary.filesChecked += 1;
      if (before.size !== BigInt(upload.size)) {
        summary.sizeMismatches += 1;
        manifestFail('UPLOAD_SIZE_MISMATCH');
      }
      let digest;
      if (hashUploads) {
        digest = hashOpenFileReadOnly(descriptor);
        hashesChecked += 1;
        summary.hashesChecked = hashesChecked;
      }
      const after = fstatSync(descriptor, { bigint: true });
      if (!sameFileStat(before, after)) manifestFail('UPLOAD_SET_CHANGED_DURING_SCAN');
      let finalMetadata;
      try {
        finalMetadata = lstatSync(candidate, { bigint: true });
      } catch {
        manifestFail('UPLOAD_SET_CHANGED_DURING_SCAN');
      }
      if (finalMetadata.isSymbolicLink() || !finalMetadata.isFile()
          || !sameFileStat(after, finalMetadata)) {
        manifestFail('UPLOAD_SET_CHANGED_DURING_SCAN');
      }
      if (hashUploads && digest !== upload.sha256) {
        summary.hashMismatches += 1;
        manifestFail('UPLOAD_HASH_MISMATCH');
      }
    } finally {
      closeSync(descriptor);
    }
    filesChecked += 1;
  }
  return {
    validationStatus: hashUploads ? 'PASS_HASHED' : 'PASS_FAST',
    databaseReferencesValid: true,
    filesChecked,
    filesMissing: 0,
    sizeMismatches: 0,
    hashesChecked,
    hashMismatches: 0,
    unsafePaths: 0,
    stagedTombstonesObserved: 0,
    uploadSetStable: true,
    issues: hashUploads ? [] : [{ code: 'UPLOAD_HASH_NOT_RUN', severity: 'WARNING', count: filesChecked }],
  };
}

function assertTargetShape(shape) {
  const names = new Set(shape.map(table => table.name));
  const present = REQUIRED_TARGET_TABLES.filter(name => names.has(name));
  if (present.length > 0 && present.length < REQUIRED_TARGET_TABLES.length) {
    fail('PARTIAL_TARGET_MIGRATION', 'INVALID_TARGET');
  }
  if (present.length === 0) fail('TARGET_SCHEMA_UNSUPPORTED', 'INVALID_TARGET');
}

function expectedCounts(plan) {
  return {
    run_event_reviews: 0,
    run_event_id_owners: 0,
    notification_outbox: 0,
    product_catalog_entries: plan.records.product_catalog_entries.length,
    requests_v2: plan.records.requests_v2.length,
    schedule_items: plan.records.schedule_items.length,
    schedule_item_tasks: plan.records.schedule_item_tasks.length,
    legacy_asset_entries: plan.records.legacy_asset_entries.length,
    legacy_compat_fragments: plan.records.legacy_compat_fragments.length,
    production_runs: 0,
    production_events: 0,
  };
}

function expectedTargetFacts(plan, batchId) {
  const owned = row => ({ ...row, migration_batch_id: batchId });
  const by = (...keys) => (left, right) => {
    for (const key of keys) {
      const leftValue = String(left[key]);
      const rightValue = String(right[key]);
      const comparison = leftValue < rightValue ? -1 : (leftValue > rightValue ? 1 : 0);
      if (comparison !== 0) return comparison;
    }
    return 0;
  };
  return {
    operations: plan.source.operations.map(row => ({ ...row, request_digest: null }))
      .toSorted(by('operation_id')),
    uploads: plan.records.uploads.toSorted(by('id')),
    product_catalog_entries: plan.records.product_catalog_entries.map(owned)
      .toSorted((left, right) => left.display_order - right.display_order || by('id')(left, right)),
    requests_v2: plan.records.requests_v2.map(row => owned({
      ...row,
      v1_assets_present: row.v1_assets_present ? 1 : 0,
      v1_request_present: row.v1_request_present ? 1 : 0,
    })).toSorted((left, right) => left.source_ordinal - right.source_ordinal || by('id')(left, right)),
    schedule_items: plan.records.schedule_items.map(owned)
      .toSorted((left, right) => left.source_ordinal - right.source_ordinal || by('id')(left, right)),
    schedule_item_tasks: plan.records.schedule_item_tasks.toSorted((left, right) => (
      by('schedule_item_id')(left, right)
      || left.display_order - right.display_order
      || by('task_id')(left, right)
    )),
    legacy_asset_entries: plan.records.legacy_asset_entries.map(owned).toSorted((left, right) => (
      by('request_id')(left, right)
      || left.display_order - right.display_order
      || by('id')(left, right)
    )),
    legacy_compat_fragments: plan.records.legacy_compat_fragments.map((row, index) => owned({
      id: index + 1,
      ...row,
    })),
    production_runs: [],
    production_events: [],
    run_event_id_owners: [],
    run_event_reviews: [],
    notification_outbox: [],
  };
}

function readTargetFacts(db) {
  return {
    operations: db.prepare(`
      SELECT operation_id, kind, response_json, created_at, request_digest
      FROM operations ORDER BY operation_id
    `).all(),
    uploads: db.prepare(`
      SELECT id, operation_id, original_name, content_type, kind, size, sha256,
             stored_name, claimed_task_id, created_at, claimed_order
      FROM uploads ORDER BY id
    `).all(),
    product_catalog_entries: db.prepare(`
      SELECT id, display_order, sku, name, source, migration_batch_id, imported_at
      FROM product_catalog_entries ORDER BY display_order, id
    `).all(),
    requests_v2: db.prepare(`
      SELECT id, source_ordinal, sku, name, client, legacy_deliver_text, kind,
             legacy_v1_status, v1_status_mode, request_lifecycle, lifecycle_provenance,
             source, business_created_at, business_updated_at, imported_at,
             v1_assets_present, v1_request_present, production_type, shooting_subtype,
             deliverable_count, aspect_ratio, duration_seconds, audio_requirement,
             requested_by, desired_date, note, source_operation_id, core_brief_summary,
             brief_url, hero_asset_id, sample_status, sample_shelf_id, lighting_preset,
             reflectivity, priority, migration_batch_id
      FROM requests_v2 ORDER BY source_ordinal, id
    `).all(),
    schedule_items: db.prepare(`
      SELECT id, source_ordinal, resource_id, resource_resolution_status,
             resource_mapping_version, legacy_place_text, planned_start, planned_end,
             buffer_after_minutes, buffer_source, schedule_status,
             schedule_status_provenance, lock_status, lock_status_provenance, note,
             allocation_mode, source, source_ref, business_created_at,
             business_updated_at, imported_at, migration_batch_id
      FROM schedule_items ORDER BY source_ordinal, id
    `).all(),
    schedule_item_tasks: db.prepare(`
      SELECT schedule_item_id, task_id, display_order, created_at, imported_at
      FROM schedule_item_tasks ORDER BY schedule_item_id, display_order, task_id
    `).all(),
    legacy_asset_entries: db.prepare(`
      SELECT id, request_id, display_order, name, content_type, kind, size, sha256,
             source, imported_at, migration_batch_id
      FROM legacy_asset_entries ORDER BY request_id, display_order, id
    `).all(),
    legacy_compat_fragments: db.prepare(`
      SELECT id, entity_type, entity_id, json_pointer, value_json, value_digest,
             violation_code, classification, mapping_version, source_ordinal,
             migration_batch_id
      FROM legacy_compat_fragments ORDER BY source_ordinal, id
    `).all(),
    production_runs: db.prepare('SELECT * FROM production_runs ORDER BY id').all(),
    production_events: db.prepare('SELECT * FROM production_events ORDER BY event_id').all(),
    run_event_id_owners: db.prepare('SELECT * FROM run_event_id_owners ORDER BY event_id').all(),
    run_event_reviews: db.prepare('SELECT * FROM run_event_reviews ORDER BY event_id').all(),
    notification_outbox: db.prepare('SELECT * FROM notification_outbox ORDER BY outbox_id').all(),
  };
}

function assertExactTargetFacts(actual, expected) {
  for (const table of Object.keys(expected)) {
    if (canonicalJson(actual[table]) !== canonicalJson(expected[table])) {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }
  }
}

function validRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<zone>Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u.exec(value);
  if (!match) return false;
  const numbers = Object.fromEntries(
    Object.entries(match.groups).map(([key, raw]) => [key, raw === undefined || key === 'zone' ? raw : Number(raw)]),
  );
  const leap = numbers.year % 4 === 0 && (numbers.year % 100 !== 0 || numbers.year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return numbers.month >= 1 && numbers.month <= 12
    && numbers.day >= 1 && numbers.day <= days[numbers.month - 1]
    && numbers.hour <= 23 && numbers.minute <= 59 && numbers.second <= 59
    && (numbers.zone === 'Z' || (numbers.offsetHour <= 23 && numbers.offsetMinute <= 59))
    && Number.isFinite(Date.parse(value));
}

export function verifyV2Target(pathInfo, plan) {
  const db = openReadOnly(pathInfo.realPath, 'INVALID_TARGET');
  let inTransaction = false;
  try {
    db.exec('BEGIN');
    inTransaction = true;
    if (!pragmaOk(db, 'integrity_check')) fail('INVALID_TARGET', 'INVALID_TARGET');
    const shape = tableShape(db);
    assertTargetShape(shape);
    let knownSchema;
    try {
      knownSchema = assertKnownSchema(db);
    } catch {
      fail('TARGET_SCHEMA_UNSUPPORTED', 'INVALID_TARGET');
    }
    if (knownSchema.version !== knownSchema.latestVersion) {
      fail('PARTIAL_TARGET_MIGRATION', 'INVALID_TARGET');
    }
    const batches = db.prepare(`
      SELECT id, identity_digest, migration_version, mapping_version, source_schema_version,
             source_revision, source_schema_digest, source_structural_digest,
             configuration_digest, resource_map_version, resource_map_digest,
             business_time_zone, status, started_at, completed_at
      FROM migration_batches
    `).all();
    if (batches.length !== 1 || batches[0].identity_digest !== plan.batchIdentity
        || batches[0].migration_version !== plan.migrationVersion
        || batches[0].mapping_version !== plan.migrationVersion
        || batches[0].source_schema_version !== 1
        || batches[0].source_revision !== plan.source.snapshot.revision
        || batches[0].source_schema_digest !== plan.source.schemaDigest
        || batches[0].source_structural_digest !== plan.source.structuralDigest
        || batches[0].configuration_digest !== plan.configurationDigest
        || batches[0].resource_map_version !== (plan.resourceMap?.mapVersion ?? null)
        || batches[0].resource_map_digest !== (plan.resourceMap?.digest ?? null)
        || batches[0].business_time_zone !== plan.businessTimeZone) {
      fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
    }
    if (batches[0].status !== 'completed') fail('PARTIAL_TARGET_MIGRATION', 'INVALID_TARGET');
    if (!validRfc3339(batches[0].started_at)
        || !validRfc3339(batches[0].completed_at)
        || Date.parse(batches[0].completed_at) < Date.parse(batches[0].started_at)) {
      fail('TARGET_BATCH_TIME_INVALID', 'INVALID_TARGET');
    }
    const verificationPlan = buildMigrationPlan({
      source: plan.source,
      businessTimeZone: plan.businessTimeZone,
      resourceMap: plan.resourceMap,
      importedAt: batches[0].started_at,
    });
    if (verificationPlan.batchIdentity !== plan.batchIdentity
        || verificationPlan.batchIdentity !== batches[0].identity_digest
        || verificationPlan.configurationDigest !== plan.configurationDigest) {
      fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
    }

    const targetScheduleRows = db.prepare(`
      SELECT id, revision, updated_at, snapshot_json
      FROM schedule_state ORDER BY id
    `).all();
    if (targetScheduleRows.length !== 1 || targetScheduleRows[0].id !== 1
        || targetScheduleRows[0].revision !== verificationPlan.source.snapshot.revision
        || targetScheduleRows[0].updated_at !== verificationPlan.source.snapshot.updatedAt) {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }
    let targetSnapshot;
    try {
      targetSnapshot = JSON.parse(targetScheduleRows[0].snapshot_json);
    } catch {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }
    if (canonicalJson(targetSnapshot) !== canonicalJson(verificationPlan.source.snapshot)) {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }
    const targetAuditSummary = db.prepare(`
      SELECT COUNT(*) AS count, MIN(revision) AS min_revision, MAX(revision) AS max_revision
      FROM audit_log
    `).get();
    if (canonicalJson(targetAuditSummary) !== canonicalJson(verificationPlan.source.auditSummary)) {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }

    const counters = db.prepare(`
      SELECT projection_revision, schedule_revision FROM revision_counters WHERE id = 1
    `).all();
    if (counters.length !== 1
        || counters[0].projection_revision !== verificationPlan.records.revision_counters.projection_revision
        || counters[0].schedule_revision !== verificationPlan.records.revision_counters.schedule_revision) {
      fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
    }
    for (const [table, expected] of Object.entries(expectedCounts(verificationPlan))) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      if (row.count !== expected) fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
    }
    const targetFacts = readTargetFacts(db);
    assertExactTargetFacts(targetFacts, expectedTargetFacts(verificationPlan, batches[0].id));
    const projections = db.prepare(`
      SELECT projection_name, schema_version, revision, schedule_revision,
             updated_at, payload_json, source_schema_version
      FROM snapshot_projections ORDER BY schema_version
    `).all();
    if (projections.length !== 2) fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
    const byVersion = new Map();
    for (const projection of projections) {
      let payload;
      try {
        payload = JSON.parse(projection.payload_json);
      } catch {
        fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
      }
      if (byVersion.has(projection.schema_version)) fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
      byVersion.set(projection.schema_version, { ...projection, payload });
    }
    const v1 = byVersion.get(1);
    const v2 = byVersion.get(2);
    if (!v1 || !v2
        || v1.projection_name !== 'schedule-v1-compat'
        || v2.projection_name !== 'schedule-v2'
        || v1.revision !== verificationPlan.records.revision_counters.projection_revision
        || v2.revision !== verificationPlan.records.revision_counters.projection_revision
        || v1.schedule_revision !== null
        || v2.schedule_revision !== verificationPlan.records.revision_counters.schedule_revision
        || v1.updated_at !== verificationPlan.projections.v1.updatedAt
        || v2.updated_at !== verificationPlan.projections.v2.updatedAt
        || v1.source_schema_version !== 1
        || v2.source_schema_version !== 1
        || canonicalJson(v1.payload) !== canonicalJson(verificationPlan.projections.v1)
        || canonicalJson(v2.payload) !== canonicalJson(verificationPlan.projections.v2)) {
      fail('TARGET_BATCH_MISMATCH', 'INVALID_TARGET');
    }
    const projectedFacts = {
      ...targetFacts,
      requests_v2: targetFacts.requests_v2.map(row => ({
        ...row,
        v1_assets_present: Boolean(row.v1_assets_present),
        v1_request_present: Boolean(row.v1_request_present),
      })),
      legacy_compat_fragments: targetFacts.legacy_compat_fragments.map(row => ({
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        json_pointer: row.json_pointer,
        value_json: row.value_json,
        value_digest: row.value_digest,
        violation_code: row.violation_code,
        classification: row.classification,
        mapping_version: row.mapping_version,
        source_ordinal: row.source_ordinal,
      })),
      revision_counters: counters[0],
    };
    let reconstructedV1;
    let reconstructedV2;
    try {
      reconstructedV1 = projectV1CompatibilitySnapshot(projectedFacts, {
        businessTimeZone: verificationPlan.businessTimeZone,
        updatedAt: verificationPlan.source.snapshot.updatedAt,
      });
      reconstructedV2 = projectV2Snapshot(projectedFacts, {
        updatedAt: verificationPlan.source.snapshot.updatedAt,
      });
    } catch {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }
    if (canonicalJson(reconstructedV1) !== canonicalJson(v1.payload)
        || canonicalJson(reconstructedV2) !== canonicalJson(v2.payload)
        || canonicalJson(reconstructedV1) !== canonicalJson(verificationPlan.projections.v1)
        || canonicalJson(reconstructedV2) !== canonicalJson(verificationPlan.projections.v2)) {
      fail('TARGET_FACT_MISMATCH', 'INVALID_TARGET');
    }
    db.exec('COMMIT');
    inTransaction = false;
    return { status: 'ALREADY_APPLIED_VERIFIED', plan: verificationPlan };
  } catch (error) {
    if (inTransaction) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    if (error instanceof MigrationError) throw error;
    fail('INVALID_TARGET', 'INVALID_TARGET');
  } finally {
    db.close();
  }
}
