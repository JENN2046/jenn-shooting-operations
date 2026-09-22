import { createHash } from 'node:crypto';

import {
  validateLegacyCompatFragment,
  validateV1Snapshot,
  validateV2Snapshot,
} from './contract-validator.mjs';
import {
  projectV1CompatibilitySnapshot,
  projectV2Snapshot,
} from './projections-v2.mjs';

export const MIGRATION_SPEC_VERSION = 'migration-dry-run-v2.1-r1';
export const MIGRATION_VERSION = 'v1-to-v2-r1';

const RESULT_EXIT_CODES = Object.freeze({
  PASS: 0,
  PASS_WITH_WARNINGS: 0,
  BLOCKED_MAPPING: 2,
  INVALID_USAGE: 3,
  INVALID_SOURCE: 4,
  INVALID_TARGET: 5,
  INTERNAL_ERROR: 10,
});

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const IDENTIFIER = /\S/u;

export class MigrationError extends Error {
  constructor(code, result, message = code) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.result = result;
    this.exitCode = RESULT_EXIT_CODES[result] ?? RESULT_EXIT_CODES.INTERNAL_ERROR;
  }
}

function fail(code, result = 'INVALID_SOURCE') {
  throw new MigrationError(code, result);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Digest(value) {
  const bytes = typeof value === 'string' ? value : canonicalJson(value);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function hasUnsafeKey(value) {
  if (Array.isArray(value)) return value.some(hasUnsafeKey);
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(key => UNSAFE_KEYS.has(key) || hasUnsafeKey(value[key]));
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validTimeZone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function parseResourceMap(text, expectedTimeZone) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('RESOURCE_MAP_INVALID', 'INVALID_USAGE');
  }
  if (!isPlainRecord(value) || hasUnsafeKey(value)
      || !exactKeys(value, ['schemaVersion', 'mapVersion', 'businessTimeZone', 'places'])
      || value.schemaVersion !== 1
      || typeof value.mapVersion !== 'string'
      || value.mapVersion.length < 1
      || value.mapVersion.length > 160
      || !IDENTIFIER.test(value.mapVersion)
      || !validTimeZone(value.businessTimeZone)
      || !isPlainRecord(value.places)) {
    fail('RESOURCE_MAP_INVALID', 'INVALID_USAGE');
  }
  if (value.businessTimeZone !== expectedTimeZone) {
    fail('RESOURCE_MAP_TIME_ZONE_MISMATCH', 'INVALID_USAGE');
  }
  const places = new Map();
  for (const [place, resourceId] of Object.entries(value.places)) {
    if (typeof place !== 'string' || place.length === 0
        || typeof resourceId !== 'string' || resourceId.length < 1
        || resourceId.length > 160 || !IDENTIFIER.test(resourceId)) {
      fail('RESOURCE_MAP_INVALID', 'INVALID_USAGE');
    }
    places.set(place, resourceId);
  }
  return Object.freeze({
    schemaVersion: 1,
    mapVersion: value.mapVersion,
    businessTimeZone: value.businessTimeZone,
    places,
    digest: sha256Digest(value),
  });
}

function formatter(timeZone) {
  if (!validTimeZone(timeZone)) fail('BUSINESS_TIME_ZONE_REQUIRED', 'INVALID_USAGE');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function wallClockParts(dateFormatter, instant) {
  const values = Object.fromEntries(
    dateFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

const instantCache = new Map();

export function localMinuteToInstant(date, time, timeZone) {
  const cacheKey = `${timeZone}\u0000${date}\u0000${time}`;
  if (instantCache.has(cacheKey)) return instantCache.get(cacheKey);
  const dateFormatter = formatter(timeZone);
  const target = `${date}T${time}`;
  const naive = Date.parse(`${target}:00.000Z`);
  if (!Number.isFinite(naive)) fail('INVALID_LOCAL_TIME', 'INVALID_SOURCE');
  const matches = [];
  for (let deltaMinutes = -14 * 60; deltaMinutes <= 14 * 60; deltaMinutes += 1) {
    const candidate = naive + deltaMinutes * 60_000;
    if (wallClockParts(dateFormatter, candidate) === target) matches.push(candidate);
  }
  if (matches.length !== 1) fail('INVALID_LOCAL_TIME', 'INVALID_SOURCE');
  const result = new Date(matches[0]).toISOString();
  instantCache.set(cacheKey, result);
  return result;
}

function pointerTokens(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) fail('INVALID_LEGACY_FRAGMENT_POINTER');
  return pointer.slice(1).split('/').map(raw => raw.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function encodePointer(tokens) {
  return `/${tokens.map(token => String(token).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function normalizeFragment(snapshot, fragment, sourceOrdinal) {
  const tokens = pointerTokens(fragment.jsonPointer);
  let entityType = 'root';
  let entityId = null;
  let localTokens = tokens;
  if (tokens[0] === 'tasks' && /^\d+$/u.test(tokens[1] ?? '')) {
    const task = snapshot.tasks?.[Number(tokens[1])];
    if (!task?.id) fail('INVALID_LEGACY_FRAGMENT_POINTER');
    entityType = 'task';
    entityId = task.id;
    localTokens = tokens.slice(2);
    if (localTokens[0] === 'request') {
      entityType = 'request';
      localTokens = localTokens.slice(1);
    } else if (localTokens[0] === 'assets' && /^\d+$/u.test(localTokens[1] ?? '')) {
      const asset = task.assets?.[Number(localTokens[1])];
      if (!asset?.id) fail('INVALID_LEGACY_FRAGMENT_POINTER');
      entityType = 'asset';
      entityId = asset.id;
      localTokens = localTokens.slice(2);
    }
  } else if (tokens[0] === 'sessions' && /^\d+$/u.test(tokens[1] ?? '')) {
    const session = snapshot.sessions?.[Number(tokens[1])];
    if (!session?.id) fail('INVALID_LEGACY_FRAGMENT_POINTER');
    entityType = 'session';
    entityId = session.id;
    localTokens = tokens.slice(2);
  }
  if (localTokens.length === 0) fail('INVALID_LEGACY_FRAGMENT_POINTER');
  const valueJson = JSON.stringify(fragment.value);
  if (valueJson === undefined) fail('INVALID_LEGACY_FRAGMENT_VALUE');
  const row = {
    entity_type: entityType,
    entity_id: entityId,
    json_pointer: encodePointer(localTokens),
    value_json: valueJson,
    value_digest: sha256Digest(valueJson),
    violation_code: fragment.violationCode,
    classification: 'L1_GRANDFATHERED_OPAQUE',
    mapping_version: MIGRATION_VERSION,
    source_ordinal: sourceOrdinal,
  };
  if (!validateLegacyCompatFragment(row).ok) fail('INVALID_LEGACY_FRAGMENT_VALUE');
  return row;
}

function operationMap(operations) {
  const byTask = new Map();
  for (const operation of operations) {
    if (operation.kind !== 'request.submit') continue;
    let response;
    try {
      response = JSON.parse(operation.response_json);
    } catch {
      fail('OPERATION_RESPONSE_INVALID');
    }
    if (!response || typeof response !== 'object' || Array.isArray(response)
        || typeof response.taskId !== 'string') {
      fail('OPERATION_RESPONSE_INVALID');
    }
    const values = byTask.get(response.taskId) ?? [];
    values.push(operation.operation_id);
    byTask.set(response.taskId, values);
  }
  for (const values of byTask.values()) {
    if (new Set(values).size > 1) fail('OPERATION_TASK_AMBIGUOUS');
  }
  return byTask;
}

function requestLifecycle(status, present) {
  if (!present) return null;
  if (status === 'completed') return 'fulfilled';
  if (status === 'cancelled') return 'cancelled';
  return 'open';
}

function deterministicId(prefix, batchIdentity, ordinal) {
  return `${prefix}-${sha256Digest(`${batchIdentity}:${ordinal}`).slice(7, 31).toUpperCase()}`;
}

function hasTimestampOverlay(fragments, entityType, entityId, pointer) {
  return fragments.some(fragment => (
    fragment.entity_type === entityType
    && fragment.entity_id === entityId
    && fragment.json_pointer === pointer
    && fragment.violation_code === 'SCHEMA_FORMAT'
  ));
}

function mapAssets(task, taskOrdinal, uploads, importedAt) {
  const managed = [];
  const legacy = [];
  const uploadById = new Map(uploads.map(upload => [upload.id, upload]));
  const assets = Object.hasOwn(task, 'assets') ? task.assets : [];
  assets.forEach((asset, assetOrdinal) => {
    const upload = uploadById.get(asset.id);
    if (upload) {
      if (upload.claimed_task_id !== task.id
          || upload.original_name !== asset.name
          || upload.content_type !== asset.contentType
          || upload.kind !== asset.kind
          || upload.size !== asset.size
          || upload.sha256 !== asset.sha256
          || (Object.hasOwn(upload, 'claimed_order')
            && upload.claimed_order !== null
            && upload.claimed_order !== assetOrdinal)) {
        fail('UPLOAD_METADATA_MISMATCH');
      }
      managed.push({ ...upload, claimed_order: assetOrdinal });
      return;
    }
    if (!['workbench', 'import'].includes(task.source)) fail('UPLOAD_REFERENCE_MISSING');
    legacy.push({
      id: asset.id,
      request_id: task.id,
      display_order: assetOrdinal,
      name: asset.name,
      content_type: asset.contentType,
      kind: asset.kind,
      size: asset.size,
      sha256: asset.sha256,
      source: 'migration',
      imported_at: importedAt,
    });
  });
  return { managed, legacy, taskOrdinal };
}

function mapSnapshot({
  snapshot,
  operations,
  uploads,
  businessTimeZone,
  resourceMap,
  importedAt,
  batchIdentity,
  fragments,
}) {
  const diagnostics = [];
  const operationIds = operationMap(operations);
  const productCatalog = snapshot.products.map(([sku, name], displayOrder) => ({
    id: deterministicId('MIG-PRODUCT', batchIdentity, displayOrder),
    sku,
    name,
    display_order: displayOrder,
    source: 'migration',
    imported_at: importedAt,
  }));
  const managedById = new Map();
  const legacyAssets = [];
  const requests = snapshot.tasks.map((task, sourceOrdinal) => {
    if (!Object.hasOwn(task, 'source')) fail('UNKNOWN_REQUIRED_V2_FIELD', 'BLOCKED_MAPPING');
    const statusPresent = Object.hasOwn(task, 'status');
    const requestPresent = Object.hasOwn(task, 'request');
    const request = task.request ?? {};
    if (requestPresent && (
      (request.productionType === '平面' && !Number.isInteger(request.deliverableCount))
      || (request.productionType === '视频'
        && (!Number.isInteger(request.durationSeconds) || typeof request.audioRequirement !== 'string'))
    )) fail('UNKNOWN_REQUIRED_V2_FIELD', 'BLOCKED_MAPPING');
    const mappedAssets = mapAssets(task, sourceOrdinal, uploads, importedAt);
    for (const upload of mappedAssets.managed) {
      if (managedById.has(upload.id)) fail('UPLOAD_PROJECTION_MISSING');
      managedById.set(upload.id, upload);
    }
    legacyAssets.push(...mappedAssets.legacy);
    const matches = operationIds.get(task.id) ?? [];
    return {
      id: task.id,
      source_ordinal: sourceOrdinal,
      sku: task.sku,
      name: task.name,
      client: task.client,
      legacy_deliver_text: task.deliver,
      kind: task.kind,
      legacy_v1_status: statusPresent ? task.status : null,
      v1_status_mode: statusPresent ? 'legacy_exact' : 'legacy_omitted',
      request_lifecycle: requestLifecycle(task.status, statusPresent),
      lifecycle_provenance: 'legacy_snapshot',
      source: task.source,
      business_created_at: hasTimestampOverlay(fragments, 'task', task.id, '/createdAt')
        ? null : (task.createdAt ?? null),
      business_updated_at: hasTimestampOverlay(fragments, 'task', task.id, '/updatedAt')
        ? null : (task.updatedAt ?? null),
      imported_at: importedAt,
      v1_assets_present: Object.hasOwn(task, 'assets'),
      v1_request_present: requestPresent,
      production_type: requestPresent ? request.productionType : null,
      shooting_subtype: requestPresent ? request.shootingSubtype : null,
      deliverable_count: requestPresent ? (request.deliverableCount ?? null) : null,
      aspect_ratio: requestPresent ? request.aspectRatio : null,
      duration_seconds: requestPresent ? (request.durationSeconds ?? null) : null,
      audio_requirement: requestPresent ? (request.audioRequirement ?? null) : null,
      requested_by: requestPresent ? request.requestedBy : null,
      desired_date: requestPresent ? request.desiredDate : null,
      note: requestPresent ? request.note : null,
      source_operation_id: matches[0] ?? null,
      core_brief_summary: null,
      brief_url: null,
      hero_asset_id: null,
      sample_status: null,
      sample_shelf_id: null,
      lighting_preset: 'unknown',
      reflectivity: 'unknown',
      priority: null,
    };
  });

  for (const upload of uploads) {
    if (upload.claimed_task_id == null) {
      if (Object.hasOwn(upload, 'claimed_order') && upload.claimed_order !== null) {
        fail('UPLOAD_METADATA_MISMATCH');
      }
      managedById.set(upload.id, { ...upload, claimed_order: null });
      continue;
    }
    if (!managedById.has(upload.id)) fail('UPLOAD_PROJECTION_MISSING');
  }

  const scheduleItems = [];
  const bindings = [];
  for (const [sourceOrdinal, session] of snapshot.sessions.entries()) {
    const resourceId = resourceMap?.places.get(session.place) ?? null;
    if (!resourceId) diagnostics.push({ code: 'UNMAPPED_RESOURCE', sessionId: session.id });
    const plannedStart = localMinuteToInstant(session.date, session.start, businessTimeZone);
    const plannedEnd = localMinuteToInstant(session.date, session.end, businessTimeZone);
    if (Date.parse(plannedEnd) <= Date.parse(plannedStart)) fail('INVALID_LOCAL_TIME');
    scheduleItems.push({
      id: session.id,
      source_ordinal: sourceOrdinal,
      allocation_mode: session.ids.length === 1 ? 'single' : 'grouped_unallocated',
      resource_id: resourceId,
      resource_resolution_status: resourceId ? 'resolved' : 'unresolved',
      resource_mapping_version: resourceMap?.mapVersion ?? null,
      legacy_place_text: session.place,
      planned_start: plannedStart,
      planned_end: plannedEnd,
      buffer_after_minutes: null,
      buffer_source: 'legacy_unknown',
      schedule_status: 'confirmed',
      schedule_status_provenance: 'legacy_snapshot',
      lock_status: null,
      lock_status_provenance: 'legacy_unknown',
      note: session.note,
      source: 'migration',
      source_ref: session.id,
      business_created_at: null,
      business_updated_at: hasTimestampOverlay(fragments, 'session', session.id, '/updatedAt')
        ? null : (session.updatedAt ?? null),
      imported_at: importedAt,
    });
    session.ids.forEach((taskId, displayOrder) => bindings.push({
      schedule_item_id: session.id,
      task_id: taskId,
      display_order: displayOrder,
      created_at: importedAt,
      imported_at: importedAt,
    }));
  }

  const intervals = new Map();
  for (const item of scheduleItems) {
    if (item.resource_id === null) continue;
    const values = intervals.get(item.resource_id) ?? [];
    values.push(item);
    intervals.set(item.resource_id, values);
  }
  for (const values of intervals.values()) {
    values.sort((left, right) => Date.parse(left.planned_start) - Date.parse(right.planned_start));
    for (let index = 1; index < values.length; index += 1) {
      if (Date.parse(values[index].planned_start) < Date.parse(values[index - 1].planned_end)) {
        diagnostics.push({
          code: 'RESOURCE_OVERLAP',
          sessionId: values[index].id,
        });
      }
    }
  }

  return { records: {
    product_catalog_entries: productCatalog,
    requests_v2: requests,
    schedule_items: scheduleItems,
    schedule_item_tasks: bindings,
    uploads: [...managedById.values()],
    legacy_asset_entries: legacyAssets,
    legacy_compat_fragments: fragments,
    production_runs: [],
    production_events: [],
    revision_counters: {
      projection_revision: snapshot.revision,
      schedule_revision: 0,
    },
  }, diagnostics };
}

function issue(code, severity, count = 1) {
  return { code, severity, count };
}

export function buildMigrationPlan({
  source,
  businessTimeZone,
  resourceMap = null,
  importedAt,
}) {
  if (!validTimeZone(businessTimeZone)) fail('BUSINESS_TIME_ZONE_REQUIRED', 'INVALID_USAGE');
  if (resourceMap && resourceMap.businessTimeZone !== businessTimeZone) {
    fail('RESOURCE_MAP_TIME_ZONE_MISMATCH', 'INVALID_USAGE');
  }
  const legacy = validateV1Snapshot(source.snapshot, { profile: 'legacy-read' });
  if (legacy.classification === 'L3_SOURCE_CORRUPT') fail('SOURCE_L3_CORRUPT');
  if (legacy.classification === 'L2_REPAIR_REQUIRED') fail('LEGACY_L2_REPAIR_REQUIRED', 'BLOCKED_MAPPING');
  const fragments = legacy.fragments.map((fragment, index) => normalizeFragment(source.snapshot, fragment, index));
  const configurationDigest = sha256Digest({
    migrationVersion: MIGRATION_VERSION,
    businessTimeZone,
    resourceMapDigest: resourceMap?.digest ?? null,
  });
  const batchIdentity = sha256Digest({
    migrationVersion: MIGRATION_VERSION,
    sourceSchemaDigest: source.schemaDigest,
    sourceStructuralDigest: source.structuralDigest,
    sourceRevision: source.snapshot.revision,
    configurationDigest,
  });
  const input = {
    snapshot: source.snapshot,
    operations: source.operations,
    uploads: source.uploads,
    businessTimeZone,
    resourceMap,
    importedAt,
    batchIdentity,
    fragments,
  };
  const mapped = mapSnapshot(input);
  const replay = mapSnapshot(input);
  const records = mapped.records;
  if (canonicalJson(mapped) !== canonicalJson(replay)) fail('IDEMPOTENCY_SIMULATION_FAILED', 'BLOCKED_MAPPING');

  const v1Projection = projectV1CompatibilitySnapshot(records, {
    businessTimeZone,
    updatedAt: source.snapshot.updatedAt,
  });
  if (canonicalJson(v1Projection) !== canonicalJson(source.snapshot)) fail('ROUND_TRIP_MISMATCH');
  const v1Validation = validateV1Snapshot(v1Projection, { profile: 'legacy-read' });
  if (v1Validation.classification !== legacy.classification) fail('ROUND_TRIP_MISMATCH');
  const v2Projection = projectV2Snapshot(records, { updatedAt: source.snapshot.updatedAt });
  if (!validateV2Snapshot(v2Projection).ok) fail('STRICT_CONTRACT_FAILED');

  const warnings = [];
  const diagnosticCounts = new Map();
  for (const diagnostic of mapped.diagnostics) {
    diagnosticCounts.set(diagnostic.code, (diagnosticCounts.get(diagnostic.code) ?? 0) + 1);
  }
  for (const [code, count] of diagnosticCounts) warnings.push(issue(code, 'BLOCKER', count));
  if (fragments.length) warnings.push(issue('LEGACY_L1_FRAGMENT', 'INFO', fragments.length));
  return {
    specVersion: MIGRATION_SPEC_VERSION,
    migrationVersion: MIGRATION_VERSION,
    batchIdentity,
    configurationDigest,
    source,
    businessTimeZone,
    resourceMap,
    records,
    projections: { v1: v1Projection, v2: v2Projection },
    compatibility: legacy,
    mappingDiagnostics: mapped.diagnostics,
    issues: warnings,
  };
}

export function reportForPlan(plan, {
  mode,
  sourceLabel = 'source',
  sourcePathDigest,
  verification,
  attachmentManifest,
  uploadHashing = false,
} = {}) {
  const records = plan.records;
  const verified = verification?.status === 'ALREADY_APPLIED_VERIFIED';
  const attachment = attachmentManifest ?? {
    validationStatus: 'NOT_RUN',
    databaseReferencesValid: true,
    filesChecked: 0,
    filesMissing: 0,
    sizeMismatches: 0,
    hashesChecked: 0,
    hashMismatches: 0,
    unsafePaths: 0,
    stagedTombstonesObserved: 0,
    uploadSetStable: false,
    issues: [issue('ATTACHMENT_VALIDATION_NOT_RUN', 'WARNING')],
  };
  const issues = [...plan.issues, ...(attachment.issues ?? [])];
  const blocked = issues.some(entry => entry.severity === 'BLOCKER');
  const warning = issues.some(entry => entry.severity === 'WARNING');
  const relevantOperations = plan.source.operations.filter(operation => operation.kind === 'request.submit').length;
  const claimedUploads = plan.source.uploads.filter(upload => upload.claimed_task_id !== null).length;
  const orphanUploads = plan.source.uploads.length - claimedUploads;
  const managedAssets = records.uploads.filter(upload => Number.isInteger(upload.claimed_order)).length;
  return {
    specVersion: MIGRATION_SPEC_VERSION,
    mode,
    result: blocked ? 'BLOCKED_MAPPING' : (warning ? 'PASS_WITH_WARNINGS' : 'PASS'),
    switchReadiness: blocked ? 'BLOCKED' : 'NOT_RUN',
    source: {
      label: sourceLabel,
      pathDigest: sourcePathDigest,
      schemaDigest: plan.source.schemaDigest,
      structuralDigest: plan.source.structuralDigest,
      snapshotRevision: plan.source.snapshot.revision,
    },
    configuration: {
      businessTimeZone: plan.businessTimeZone,
      resourceMapVersion: plan.resourceMap?.mapVersion ?? null,
      resourceMapDigest: plan.resourceMap?.digest ?? null,
      uploadHashing,
    },
    counts: {
      products: plan.source.snapshot.products.length,
      tasks: plan.source.snapshot.tasks.length,
      sessions: plan.source.snapshot.sessions.length,
      singleSessions: records.schedule_items.filter(item => item.allocation_mode === 'single').length,
      groupedUnallocatedSessions: records.schedule_items.filter(item => item.allocation_mode === 'grouped_unallocated').length,
      taskBindings: records.schedule_item_tasks.length,
      operationsByRelevantKind: relevantOperations,
      auditRows: plan.source.auditSummary.count,
      auditMinRevision: plan.source.auditSummary.min_revision,
      auditMaxRevision: plan.source.auditSummary.max_revision,
      uploads: plan.source.uploads.length,
      claimedUploads,
      orphanUploads,
      assetProjectionReferences: plan.source.snapshot.tasks.reduce(
        (count, task) => count + (Array.isArray(task.assets) ? task.assets.length : 0),
        0,
      ),
      managedAssetEntries: managedAssets,
      legacyAssetEntries: records.legacy_asset_entries.length,
      wouldCreateRequests: records.requests_v2.length,
      wouldCreateScheduleItems: records.schedule_items.length,
      wouldCreateProductionRuns: 0,
      wouldCreateProductionEvents: 0,
      unmappedRecords: plan.mappingDiagnostics.filter(item => item.code === 'UNMAPPED_RESOURCE').length,
      overlapDiagnostics: plan.mappingDiagnostics.filter(item => item.code === 'RESOURCE_OVERLAP').length,
    },
    mapping: {
      unresolvedResources: plan.mappingDiagnostics.filter(item => item.code === 'UNMAPPED_RESOURCE').length,
      overlapConflicts: plan.mappingDiagnostics.filter(item => item.code === 'RESOURCE_OVERLAP').length,
      notMaterializableCount: 0,
    },
    compatibility: {
      classification: plan.compatibility.classification,
      legacyFragmentsPreserved: records.legacy_compat_fragments.length,
      repairRequired: 0,
      corruptRecords: 0,
    },
    revisions: {
      sourceV1Revision: plan.source.snapshot.revision,
      proposedProjectionRevision: records.revision_counters.projection_revision,
      proposedScheduleRevision: records.revision_counters.schedule_revision,
      createdRunCount: 0,
      idempotentReplayConsumesRevision: false,
    },
    roundTrip: {
      validatorStatus: 'PASS',
      sourceCanonicalDigest: sha256Digest(plan.source.snapshot),
      roundTripCanonicalDigest: sha256Digest(plan.projections.v1),
      productsEqual: true,
      tasksEqual: true,
      sessionsEqual: true,
      orderingEqual: true,
      diffCount: 0,
      v2ValidatorStatus: 'PASS',
    },
    attachments: Object.fromEntries(Object.entries(attachment).filter(([key]) => key !== 'issues')),
    targetVerification: mode === 'verify-only'
      ? { status: verified ? 'ALREADY_APPLIED_VERIFIED' : (verification?.status ?? 'NOT_RUN') }
      : { status: 'NOT_RUN' },
    issues,
  };
}

export function failureReport(error, { mode = 'unknown', sourceLabel = 'source', sourcePathDigest } = {}) {
  const known = error instanceof MigrationError;
  const result = known ? error.result : 'INTERNAL_ERROR';
  const code = known ? error.code : 'INTERNAL_ERROR';
  const attachmentManifest = known && error.attachmentManifest
    ? error.attachmentManifest
    : { validationStatus: 'NOT_RUN', hashesChecked: 0 };
  return {
    report: {
      specVersion: MIGRATION_SPEC_VERSION,
      mode,
      result,
      switchReadiness: 'NOT_RUN',
      source: { label: sourceLabel, ...(sourcePathDigest ? { pathDigest: sourcePathDigest } : {}) },
      roundTrip: { validatorStatus: 'NOT_RUN', v2ValidatorStatus: 'NOT_RUN' },
      attachments: attachmentManifest,
      targetVerification: { status: result === 'INVALID_TARGET' ? code : 'NOT_RUN' },
      issues: [issue(code, 'BLOCKER')],
    },
    exitCode: known ? error.exitCode : RESULT_EXIT_CODES.INTERNAL_ERROR,
  };
}

export function exitCodeForReport(report, strict = false) {
  if (strict && report.result === 'PASS_WITH_WARNINGS') return 2;
  return RESULT_EXIT_CODES[report.result] ?? RESULT_EXIT_CODES.INTERNAL_ERROR;
}
