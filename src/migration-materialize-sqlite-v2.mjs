import {
  MigrationError,
  canonicalJson,
} from './migration-v2.mjs';
import { assertKnownSchema } from './sqlite-schema-v2.mjs';

const EMPTY_TARGET_QUERIES = Object.freeze([
  ['run_event_reviews', 'SELECT COUNT(*) AS count FROM run_event_reviews'],
  ['run_event_id_owners', 'SELECT COUNT(*) AS count FROM run_event_id_owners'],
  ['notification_outbox', 'SELECT COUNT(*) AS count FROM notification_outbox'],
  ['migration_batches', 'SELECT COUNT(*) AS count FROM migration_batches'],
  ['revision_counters', 'SELECT COUNT(*) AS count FROM revision_counters'],
  ['product_catalog_entries', 'SELECT COUNT(*) AS count FROM product_catalog_entries'],
  ['requests_v2', 'SELECT COUNT(*) AS count FROM requests_v2'],
  ['schedule_items', 'SELECT COUNT(*) AS count FROM schedule_items'],
  ['schedule_item_tasks', 'SELECT COUNT(*) AS count FROM schedule_item_tasks'],
  ['legacy_asset_entries', 'SELECT COUNT(*) AS count FROM legacy_asset_entries'],
  ['legacy_compat_fragments', 'SELECT COUNT(*) AS count FROM legacy_compat_fragments'],
  ['production_runs', 'SELECT COUNT(*) AS count FROM production_runs'],
  ['production_events', 'SELECT COUNT(*) AS count FROM production_events'],
  ['snapshot_projections', 'SELECT COUNT(*) AS count FROM snapshot_projections'],
]);

const EMPTY_RUNTIME_FACT_QUERIES = Object.freeze([
  'SELECT COUNT(*) AS count FROM production_runs',
  'SELECT COUNT(*) AS count FROM production_events',
  'SELECT COUNT(*) AS count FROM run_event_id_owners',
  'SELECT COUNT(*) AS count FROM run_event_reviews',
  'SELECT COUNT(*) AS count FROM notification_outbox',
]);

function fail(code, result = 'INVALID_TARGET') {
  throw new MigrationError(code, result);
}

function validRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<zone>Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u.exec(value);
  if (!match) return false;
  const number = key => Number(match.groups[key]);
  const year = number('year');
  const month = number('month');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12
    && number('day') >= 1 && number('day') <= days[month - 1]
    && number('hour') <= 23 && number('minute') <= 59 && number('second') <= 59
    && (match.groups.zone === 'Z'
      || (number('offsetHour') <= 23 && number('offsetMinute') <= 59))
    && Number.isFinite(Date.parse(value));
}

function deterministicBatchId(identity) {
  if (typeof identity !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(identity)) {
    fail('INVALID_MIGRATION_PLAN');
  }
  return `MIG-${identity.slice(7, 39).toUpperCase()}`;
}

function canonicalRows(rows) {
  return canonicalJson(rows.map(row => ({ ...row })));
}

function expectedSourceUploads(plan) {
  return plan.source.uploads.map(row => ({
    id: row.id,
    operation_id: row.operation_id,
    original_name: row.original_name,
    content_type: row.content_type,
    kind: row.kind,
    size: row.size,
    sha256: row.sha256,
    stored_name: row.stored_name,
    claimed_task_id: row.claimed_task_id,
    created_at: row.created_at,
  }));
}

function expectedMaterializedUploads(plan) {
  return plan.records.uploads.map(row => ({
    id: row.id,
    operation_id: row.operation_id,
    original_name: row.original_name,
    content_type: row.content_type,
    kind: row.kind,
    size: row.size,
    sha256: row.sha256,
    stored_name: row.stored_name,
    claimed_task_id: row.claimed_task_id,
    created_at: row.created_at,
    claimed_order: row.claimed_order,
  })).toSorted((left, right) => left.id < right.id ? -1 : (left.id > right.id ? 1 : 0));
}

function readTargetUploads(db) {
  return db.prepare(`
    SELECT id, operation_id, original_name, content_type, kind, size, sha256,
           stored_name, claimed_task_id, created_at, claimed_order
    FROM uploads ORDER BY id
  `).all();
}

function assertV1Facts(db, plan, { materialized = false } = {}) {
  const scheduleRows = db.prepare(`
    SELECT id, revision, updated_at, snapshot_json
    FROM schedule_state ORDER BY id
  `).all();
  if (scheduleRows.length !== 1 || scheduleRows[0].id !== 1
      || scheduleRows[0].revision !== plan.source.snapshot.revision
      || scheduleRows[0].updated_at !== plan.source.snapshot.updatedAt) {
    fail('TARGET_V1_MISMATCH');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(scheduleRows[0].snapshot_json);
  } catch {
    fail('TARGET_V1_MISMATCH');
  }
  if (canonicalJson(snapshot) !== canonicalJson(plan.source.snapshot)) fail('TARGET_V1_MISMATCH');

  const operations = db.prepare(`
    SELECT operation_id, kind, response_json, created_at
    FROM operations ORDER BY operation_id
  `).all();
  if (canonicalRows(operations) !== canonicalRows(plan.source.operations)) fail('TARGET_V1_MISMATCH');
  const unexpectedOperationDigests = db.prepare(`
    SELECT COUNT(*) AS count FROM operations WHERE request_digest IS NOT NULL
  `).get();
  if (unexpectedOperationDigests.count !== 0) fail('TARGET_V1_MISMATCH');

  const actualUploads = readTargetUploads(db);
  const expectedUploads = materialized
    ? expectedMaterializedUploads(plan)
    : expectedSourceUploads(plan).toSorted((left, right) => (
      left.id < right.id ? -1 : (left.id > right.id ? 1 : 0)
    ));
  const comparableUploads = materialized
    ? actualUploads
    : actualUploads.map(({ claimed_order: ignored, ...row }) => row);
  if (canonicalRows(comparableUploads) !== canonicalRows(expectedUploads)) {
    fail('TARGET_V1_MISMATCH');
  }

  const auditSummary = db.prepare(`
    SELECT COUNT(*) AS count, MIN(revision) AS min_revision, MAX(revision) AS max_revision
    FROM audit_log
  `).get();
  if (canonicalJson(auditSummary) !== canonicalJson(plan.source.auditSummary)) {
    fail('TARGET_V1_MISMATCH');
  }
}

function assertEmptyNormalizedTarget(db) {
  for (const [, sql] of EMPTY_TARGET_QUERIES) {
    if (db.prepare(sql).get().count !== 0) fail('TARGET_NOT_EMPTY');
  }
}

function assertRuntimeFactsRemainEmpty(db) {
  for (const sql of EMPTY_RUNTIME_FACT_QUERIES) {
    if (db.prepare(sql).get().count !== 0) fail('TARGET_APPLY_INVARIANT_FAILED');
  }
}

function assertPlanTimes(plan, startedAt, completedAt) {
  if (!validRfc3339(startedAt) || !validRfc3339(completedAt)
      || Date.parse(completedAt) < Date.parse(startedAt)) {
    fail('INVALID_MIGRATION_TIME');
  }
  const importedRows = [
    ...plan.records.product_catalog_entries,
    ...plan.records.requests_v2,
    ...plan.records.schedule_items,
    ...plan.records.legacy_asset_entries,
  ];
  if (importedRows.some(row => row.imported_at !== startedAt)
      || plan.records.schedule_item_tasks.some(row => (
        row.imported_at !== startedAt || row.created_at !== startedAt
      ))) {
    fail('MIGRATION_TIME_MISMATCH');
  }
}

function assertPlanShape(plan) {
  const arrayNames = [
    'product_catalog_entries',
    'requests_v2',
    'schedule_items',
    'schedule_item_tasks',
    'uploads',
    'legacy_asset_entries',
    'legacy_compat_fragments',
    'production_runs',
    'production_events',
  ];
  if (!plan || typeof plan !== 'object' || !plan.source || !plan.records
      || !arrayNames.every(name => Array.isArray(plan.records[name]))
      || !plan.records.revision_counters
      || !plan.projections?.v1 || !plan.projections?.v2
      || !Array.isArray(plan.issues)
      || !Array.isArray(plan.source.operations) || !Array.isArray(plan.source.uploads)
      || !plan.source.snapshot || !plan.source.auditSummary) {
    fail('INVALID_MIGRATION_PLAN');
  }
  if (plan.records.production_runs.length !== 0 || plan.records.production_events.length !== 0) {
    fail('INVALID_MIGRATION_PLAN');
  }
}

function runFaultInjector(faultInjector, stage) {
  if (faultInjector) faultInjector(stage);
}

function requireOne(result) {
  if (result.changes !== 1) fail('TARGET_APPLY_INVARIANT_FAILED');
}

function insertCatalog(db, rows, batchId) {
  const insert = db.prepare(`
    INSERT INTO product_catalog_entries (
      id, display_order, sku, name, source, migration_batch_id, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) requireOne(insert.run(
    row.id, row.display_order, row.sku, row.name, row.source, batchId, row.imported_at,
  ));
}

function insertRequests(db, rows, batchId) {
  const insert = db.prepare(`
    INSERT INTO requests_v2 (
      id, source_ordinal, sku, name, client, legacy_deliver_text, kind,
      legacy_v1_status, v1_status_mode, request_lifecycle, lifecycle_provenance,
      source, business_created_at, business_updated_at, imported_at,
      v1_assets_present, v1_request_present, production_type, shooting_subtype,
      deliverable_count, aspect_ratio, duration_seconds, audio_requirement,
      requested_by, desired_date, note, source_operation_id, core_brief_summary,
      brief_url, hero_asset_id, sample_status, sample_shelf_id, lighting_preset,
      reflectivity, priority, migration_batch_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  for (const row of rows) requireOne(insert.run(
    row.id, row.source_ordinal, row.sku, row.name, row.client, row.legacy_deliver_text,
    row.kind, row.legacy_v1_status, row.v1_status_mode, row.request_lifecycle,
    row.lifecycle_provenance, row.source, row.business_created_at, row.business_updated_at,
    row.imported_at, Number(row.v1_assets_present), Number(row.v1_request_present),
    row.production_type, row.shooting_subtype, row.deliverable_count, row.aspect_ratio,
    row.duration_seconds, row.audio_requirement, row.requested_by, row.desired_date,
    row.note, row.source_operation_id, row.core_brief_summary, row.brief_url,
    row.hero_asset_id, row.sample_status, row.sample_shelf_id, row.lighting_preset,
    row.reflectivity, row.priority, batchId,
  ));
}

function insertScheduleItems(db, rows, batchId) {
  const insert = db.prepare(`
    INSERT INTO schedule_items (
      id, source_ordinal, resource_id, resource_resolution_status,
      resource_mapping_version, legacy_place_text, planned_start, planned_end,
      buffer_after_minutes, buffer_source, schedule_status,
      schedule_status_provenance, lock_status, lock_status_provenance, note,
      allocation_mode, source, source_ref, business_created_at,
      business_updated_at, imported_at, migration_batch_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  for (const row of rows) requireOne(insert.run(
    row.id, row.source_ordinal, row.resource_id, row.resource_resolution_status,
    row.resource_mapping_version, row.legacy_place_text, row.planned_start, row.planned_end,
    row.buffer_after_minutes, row.buffer_source, row.schedule_status,
    row.schedule_status_provenance, row.lock_status, row.lock_status_provenance, row.note,
    row.allocation_mode, row.source, row.source_ref, row.business_created_at,
    row.business_updated_at, row.imported_at, batchId,
  ));
}

function insertBindings(db, rows) {
  const insert = db.prepare(`
    INSERT INTO schedule_item_tasks (
      schedule_item_id, task_id, display_order, created_at, imported_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of rows) requireOne(insert.run(
    row.schedule_item_id, row.task_id, row.display_order, row.created_at, row.imported_at,
  ));
}

function insertLegacyAssets(db, rows, batchId) {
  const insert = db.prepare(`
    INSERT INTO legacy_asset_entries (
      id, request_id, display_order, name, content_type, kind, size, sha256,
      source, imported_at, migration_batch_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) requireOne(insert.run(
    row.id, row.request_id, row.display_order, row.name, row.content_type, row.kind,
    row.size, row.sha256, row.source, row.imported_at, batchId,
  ));
}

function insertFragments(db, rows, batchId) {
  const insert = db.prepare(`
    INSERT INTO legacy_compat_fragments (
      id, entity_type, entity_id, json_pointer, value_json, value_digest,
      violation_code, classification, mapping_version, source_ordinal,
      migration_batch_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  rows.forEach((row, index) => requireOne(insert.run(
    index + 1, row.entity_type, row.entity_id, row.json_pointer, row.value_json,
    row.value_digest, row.violation_code, row.classification, row.mapping_version,
    row.source_ordinal, batchId,
  )));
}

export function materializeMigrationPlan({
  db,
  plan,
  startedAt,
  completedAt,
  faultInjector,
} = {}) {
  let inTransaction = false;
  let batchId;
  try {
    if (!db) fail('INVALID_MIGRATION_PLAN');
    assertPlanShape(plan);
    if (plan.issues?.some(issue => issue.severity === 'BLOCKER')) {
      fail('BLOCKED_MAPPING', 'BLOCKED_MAPPING');
    }
    assertPlanTimes(plan, startedAt, completedAt);
    if (Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) !== 1
        || Number(db.prepare('PRAGMA query_only').get()?.query_only) !== 0
        || String(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toLowerCase() !== 'delete'
        || Number(db.prepare('PRAGMA synchronous').get()?.synchronous) !== 2) {
      fail('TARGET_WRITE_GUARD_INVALID');
    }
    batchId = deterministicBatchId(plan.batchIdentity);
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    runFaultInjector(faultInjector, 'after_begin');
    const schema = assertKnownSchema(db);
    if (schema.version !== schema.latestVersion) fail('TARGET_SCHEMA_UNSUPPORTED');
    assertEmptyNormalizedTarget(db);
    assertV1Facts(db, plan);
    runFaultInjector(faultInjector, 'after_preflight');

    requireOne(db.prepare(`
      INSERT INTO migration_batches (
        id, identity_digest, migration_version, mapping_version,
        source_schema_version, source_revision, source_schema_digest,
        source_structural_digest, configuration_digest, resource_map_version,
        resource_map_digest, business_time_zone, status, started_at, completed_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'applying', ?, NULL)
    `).run(
      batchId, plan.batchIdentity, plan.migrationVersion, plan.migrationVersion,
      plan.source.snapshot.revision, plan.source.schemaDigest, plan.source.structuralDigest,
      plan.configurationDigest, plan.resourceMap?.mapVersion ?? null,
      plan.resourceMap?.digest ?? null, plan.businessTimeZone, startedAt,
    ));
    runFaultInjector(faultInjector, 'after_batch');

    const updateUploadOrder = db.prepare('UPDATE uploads SET claimed_order = ? WHERE id = ?');
    for (const upload of plan.records.uploads) {
      requireOne(updateUploadOrder.run(upload.claimed_order, upload.id));
    }
    runFaultInjector(faultInjector, 'after_uploads');

    insertCatalog(db, plan.records.product_catalog_entries, batchId);
    runFaultInjector(faultInjector, 'after_catalog');
    insertRequests(db, plan.records.requests_v2, batchId);
    runFaultInjector(faultInjector, 'after_requests');
    insertScheduleItems(db, plan.records.schedule_items, batchId);
    runFaultInjector(faultInjector, 'after_schedule_items');
    insertBindings(db, plan.records.schedule_item_tasks);
    runFaultInjector(faultInjector, 'after_bindings');
    insertLegacyAssets(db, plan.records.legacy_asset_entries, batchId);
    runFaultInjector(faultInjector, 'after_legacy_assets');
    insertFragments(db, plan.records.legacy_compat_fragments, batchId);
    runFaultInjector(faultInjector, 'after_fragments');

    requireOne(db.prepare(`
      INSERT INTO revision_counters (
        id, projection_revision, schedule_revision, updated_at
      ) VALUES (1, ?, ?, ?)
    `).run(
      plan.records.revision_counters.projection_revision,
      plan.records.revision_counters.schedule_revision,
      startedAt,
    ));
    runFaultInjector(faultInjector, 'after_counters');

    const insertProjection = db.prepare(`
      INSERT INTO snapshot_projections (
        projection_name, schema_version, revision, schedule_revision,
        updated_at, payload_json, source_schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    requireOne(insertProjection.run(
      'schedule-v1-compat', 1,
      plan.records.revision_counters.projection_revision, null,
      plan.projections.v1.updatedAt, JSON.stringify(plan.projections.v1),
    ));
    requireOne(insertProjection.run(
      'schedule-v2', 2,
      plan.records.revision_counters.projection_revision,
      plan.records.revision_counters.schedule_revision,
      plan.projections.v2.updatedAt, JSON.stringify(plan.projections.v2),
    ));
    runFaultInjector(faultInjector, 'after_projections');

    assertV1Facts(db, plan, { materialized: true });
    assertRuntimeFactsRemainEmpty(db);
    runFaultInjector(faultInjector, 'after_v1_recheck');
    requireOne(db.prepare(`
      UPDATE migration_batches
      SET status = 'completed', completed_at = ?
      WHERE id = ? AND status = 'applying' AND completed_at IS NULL
    `).run(completedAt, batchId));
    runFaultInjector(faultInjector, 'before_commit');
    db.exec('COMMIT');
    inTransaction = false;
    return { status: 'APPLIED', batchId };
  } catch (error) {
    if (inTransaction) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    if (error instanceof MigrationError) throw error;
    fail('TARGET_APPLY_FAILED');
  }
}
