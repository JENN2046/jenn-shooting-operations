import {
  validateLegacyCompatFragment,
  validateV2Snapshot,
} from './contract-validator.mjs';

export class ProjectionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ProjectionError';
    this.code = code;
  }
}

function fail(code) {
  throw new ProjectionError(code);
}

function rows(records, name) {
  const value = records?.[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('INVALID_PROJECTION_INPUT');
  return value;
}

function ordered(values, ordinalField = 'source_ordinal') {
  const seen = new Set();
  for (const value of values) {
    const ordinal = value?.[ordinalField];
    if (!Number.isInteger(ordinal) || ordinal < 0) fail('INVALID_SOURCE_ORDINAL');
    if (seen.has(ordinal)) fail('DUPLICATE_SOURCE_ORDINAL');
    seen.add(ordinal);
  }
  return values.toSorted((left, right) => left[ordinalField] - right[ordinalField]);
}

function indexUnique(values, field, duplicateCode) {
  const result = new Map();
  for (const value of values) {
    const key = value?.[field];
    if (typeof key !== 'string' || !key) fail('INVALID_PROJECTION_INPUT');
    if (result.has(key)) fail(duplicateCode);
    result.set(key, value);
  }
  return result;
}

function scopedRevision(records, field, code) {
  const value = records?.revision_counters?.[field];
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function isRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function checkedTimestamp(value, code) {
  if (!isRfc3339(value)) fail(code);
  return value;
}

function projectionTimestamp(updatedAt) {
  return checkedTimestamp(updatedAt, 'INVALID_PROJECTION_UPDATED_AT');
}

function createWallClockFormatter(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) fail('INVALID_BUSINESS_TIME_ZONE');
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    fail('INVALID_BUSINESS_TIME_ZONE');
  }
}

function wallClock(formatter, instant) {
  checkedTimestamp(instant, 'INVALID_PLANNED_TIME');
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function validateBindings(records) {
  const requests = rows(records, 'requests_v2');
  const items = rows(records, 'schedule_items');
  const bindings = rows(records, 'schedule_item_tasks');
  const requestById = indexUnique(requests, 'id', 'DUPLICATE_TASK_ID');
  const itemById = indexUnique(items, 'id', 'DUPLICATE_SCHEDULE_ITEM_ID');
  const byItem = new Map(items.map(item => [item.id, []]));

  for (const binding of bindings) {
    if (!requestById.has(binding?.task_id)) fail('UNKNOWN_TASK_REFERENCE');
    if (!itemById.has(binding?.schedule_item_id)) fail('UNKNOWN_SCHEDULE_ITEM_REFERENCE');
    if (!Number.isInteger(binding.display_order) || binding.display_order < 0) fail('INVALID_BINDING_ORDER');
    byItem.get(binding.schedule_item_id).push(binding);
  }

  for (const item of items) {
    const itemBindings = byItem.get(item.id);
    const orders = new Set();
    const taskIds = new Set();
    for (const binding of itemBindings) {
      if (orders.has(binding.display_order)) fail('DUPLICATE_BINDING_ORDER');
      if (taskIds.has(binding.task_id)) fail('DUPLICATE_TASK_BINDING');
      orders.add(binding.display_order);
      taskIds.add(binding.task_id);
    }
    if (item.allocation_mode === 'single' && itemBindings.length !== 1) fail('INVALID_BINDING_COUNT');
    if (item.allocation_mode === 'grouped_unallocated' && itemBindings.length < 2) fail('INVALID_BINDING_COUNT');
    if (!['single', 'grouped_unallocated'].includes(item.allocation_mode)) fail('INVALID_ALLOCATION_MODE');
    itemBindings.sort((left, right) => left.display_order - right.display_order);
    if (itemBindings.some((binding, index) => binding.display_order !== index)) {
      fail('INVALID_BINDING_ORDER');
    }
  }

  return { requests, items, requestById, itemById, bindingsByItem: byItem };
}

function taskHasActiveSchedule(taskId, items, bindingsByItem) {
  return items.some(item => item.schedule_status !== 'cancelled'
    && bindingsByItem.get(item.id).some(binding => binding.task_id === taskId));
}

function v1Status(request, model) {
  if (request.v1_status_mode === 'legacy_omitted') return undefined;
  if (request.v1_status_mode === 'legacy_exact') {
    if (typeof request.legacy_v1_status !== 'string') fail('INVALID_LEGACY_STATUS');
    return request.legacy_v1_status;
  }
  if (request.v1_status_mode !== 'canonical') fail('INVALID_V1_STATUS_MODE');
  if (request.request_lifecycle === 'cancelled') return 'cancelled';
  if (request.request_lifecycle === 'fulfilled') return 'completed';
  if (request.request_lifecycle !== 'open') fail('INVALID_REQUEST_LIFECYCLE');
  return taskHasActiveSchedule(request.id, model.items, model.bindingsByItem) ? 'scheduled' : 'pending';
}

function optional(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

function assetProjection(entry, managed) {
  const contentType = managed ? entry.content_type : entry.content_type;
  const name = managed ? entry.original_name : entry.name;
  if (
    typeof entry.id !== 'string'
    || typeof name !== 'string'
    || typeof contentType !== 'string'
    || typeof entry.kind !== 'string'
    || !Number.isInteger(entry.size)
    || typeof entry.sha256 !== 'string'
  ) fail('INVALID_ASSET_FACT');
  return {
    id: entry.id,
    name,
    contentType,
    kind: entry.kind,
    size: entry.size,
    sha256: entry.sha256,
  };
}

function assetsByRequest(records, requestById) {
  const result = new Map([...requestById.keys()].map(id => [id, []]));
  const assetIds = new Set();

  for (const upload of rows(records, 'uploads')) {
    if (upload.claimed_task_id === undefined || upload.claimed_task_id === null) continue;
    if (!requestById.has(upload.claimed_task_id)) fail('UNKNOWN_ASSET_OWNER');
    if (!Number.isInteger(upload.claimed_order) || upload.claimed_order < 0) fail('INVALID_ASSET_ORDER');
    if (assetIds.has(upload.id)) fail('ASSET_ID_CONFLICT');
    assetIds.add(upload.id);
    result.get(upload.claimed_task_id).push({
      order: upload.claimed_order,
      value: assetProjection(upload, true),
    });
  }

  for (const asset of rows(records, 'legacy_asset_entries')) {
    if (!requestById.has(asset.request_id)) fail('UNKNOWN_ASSET_OWNER');
    if (!Number.isInteger(asset.display_order) || asset.display_order < 0) fail('INVALID_ASSET_ORDER');
    if (assetIds.has(asset.id)) fail('ASSET_ID_CONFLICT');
    assetIds.add(asset.id);
    result.get(asset.request_id).push({
      order: asset.display_order,
      value: assetProjection(asset, false),
    });
  }

  for (const values of result.values()) {
    const orders = new Set();
    for (const entry of values) {
      if (orders.has(entry.order)) fail('ASSET_ORDER_CONFLICT');
      orders.add(entry.order);
    }
    values.sort((left, right) => left.order - right.order);
  }
  return result;
}

function projectV1Request(request) {
  const required = ['id', 'sku', 'name', 'client', 'legacy_deliver_text', 'kind'];
  if (required.some(field => typeof request[field] !== 'string')) fail('INCOMPLETE_V1_TASK');
  const value = {
    id: request.id,
    sku: request.sku,
    name: request.name,
    client: request.client,
    deliver: request.legacy_deliver_text,
    kind: request.kind,
  };
  optional(value, 'source', request.source);
  optional(value, 'createdAt', request.business_created_at === null || request.business_created_at === undefined
    ? request.business_created_at
    : checkedTimestamp(request.business_created_at, 'INVALID_BUSINESS_CREATED_AT'));
  optional(value, 'updatedAt', request.business_updated_at === null || request.business_updated_at === undefined
    ? request.business_updated_at
    : checkedTimestamp(request.business_updated_at, 'INVALID_BUSINESS_UPDATED_AT'));
  return value;
}

function projectV1RequestDetails(request) {
  const required = [
    'production_type', 'shooting_subtype', 'aspect_ratio', 'requested_by', 'desired_date', 'note',
  ];
  if (required.some(field => request[field] === undefined || request[field] === null)) {
    fail('INCOMPLETE_V1_REQUEST');
  }
  const value = {
    productionType: request.production_type,
    shootingSubtype: request.shooting_subtype,
  };
  optional(value, 'deliverableCount', request.deliverable_count);
  value.aspectRatio = request.aspect_ratio;
  optional(value, 'durationSeconds', request.duration_seconds);
  optional(value, 'audioRequirement', request.audio_requirement);
  value.requestedBy = request.requested_by;
  value.desiredDate = request.desired_date;
  value.note = request.note;
  return value;
}

function resourcePlace(records, item) {
  if (item.source === 'migration' || item.schedule_status_provenance === 'legacy_snapshot') {
    if (typeof item.legacy_place_text !== 'string') fail('MISSING_LEGACY_PLACE');
    return item.legacy_place_text;
  }
  const resource = rows(records, 'resources').find(entry => (
    entry.id === item.resource_id || entry.resource_id === item.resource_id
  ));
  const place = resource?.v1_display_place;
  if (typeof place !== 'string') fail('RESOURCE_PLACE_UNAVAILABLE');
  return place;
}

const FRAGMENT_RESERVED_FIELDS = {
  root: new Set(['schemaVersion', 'revision', 'updatedAt', 'products', 'tasks', 'sessions']),
  task: new Set(['id', 'sku', 'name', 'client', 'deliver', 'kind', 'status', 'source', 'createdAt', 'updatedAt', 'assets', 'request']),
  session: new Set(['id', 'ids', 'date', 'start', 'end', 'place', 'note', 'updatedAt']),
  request: new Set(['productionType', 'shootingSubtype', 'deliverableCount', 'aspectRatio', 'durationSeconds', 'audioRequirement', 'requestedBy', 'desiredDate', 'note']),
  asset: new Set(['id', 'name', 'contentType', 'kind', 'size', 'sha256']),
};

const V2_RESERVED_FIELDS = new Set([
  'projectionRevision', 'scheduleRevision', 'runRevision', 'expectedScheduleRevision', 'expectedRunRevision',
  'requests', 'scheduleItems', 'productionRuns', 'taskBindings', 'allocationMode', 'resourceId',
  'resourceResolutionStatus', 'bufferAfterMinutes', 'scheduleStatus', 'lockStatus', 'nextStart', 'diagnostics',
  'requestLifecycle', 'lifecycleProvenance', 'v1StatusMode', 'sourceOperationId', 'deliverables',
  'coreBriefSummary', 'briefUrl', 'heroAssetId', 'sampleStatus', 'sampleShelfId', 'lightingPreset',
  'reflectivity', 'priority',
]);

const UNSAFE_POINTER_TOKENS = new Set(['__proto__', 'prototype', 'constructor']);

function pointerTokens(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    fail('INVALID_LEGACY_FRAGMENT_POINTER');
  }
  return pointer.slice(1).split('/').map(raw => {
    if (/~(?![01])/u.test(raw)) fail('INVALID_LEGACY_FRAGMENT_POINTER');
    const token = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (UNSAFE_POINTER_TOKENS.has(token)) fail('INVALID_LEGACY_FRAGMENT_POINTER');
    return token;
  });
}

function fragmentTarget(snapshot, fragment) {
  const type = fragment.entity_type;
  if (!Object.hasOwn(FRAGMENT_RESERVED_FIELDS, type)) fail('INVALID_LEGACY_FRAGMENT_ENTITY_TYPE');
  if (type === 'root') {
    if (fragment.entity_id !== null && fragment.entity_id !== undefined) fail('LEGACY_FRAGMENT_UNKNOWN_ENTITY');
    return snapshot;
  }
  if (typeof fragment.entity_id !== 'string' || !fragment.entity_id) fail('LEGACY_FRAGMENT_UNKNOWN_ENTITY');
  if (type === 'task') return snapshot.tasks.find(task => task.id === fragment.entity_id);
  if (type === 'session') return snapshot.sessions.find(session => session.id === fragment.entity_id);
  if (type === 'request') return snapshot.tasks.find(task => task.id === fragment.entity_id)?.request;
  return snapshot.tasks.flatMap(task => task.assets ?? []).find(asset => asset.id === fragment.entity_id);
}

function allowsOptionalTimestampOverlay(records, fragment, tokens, target, value) {
  if (
    fragment.violation_code !== 'SCHEMA_FORMAT'
    || tokens.length !== 1
    || typeof value !== 'string'
    || isRfc3339(value)
    || Object.hasOwn(target, tokens[0])
  ) return false;

  if (fragment.entity_type === 'task' && ['createdAt', 'updatedAt'].includes(tokens[0])) {
    const request = rows(records, 'requests_v2').find(entry => entry.id === fragment.entity_id);
    const normalizedField = tokens[0] === 'createdAt' ? 'business_created_at' : 'business_updated_at';
    return request !== undefined && request[normalizedField] == null;
  }
  if (fragment.entity_type === 'session' && tokens[0] === 'updatedAt') {
    const item = rows(records, 'schedule_items').find(entry => entry.id === fragment.entity_id);
    return item !== undefined && item.business_updated_at == null;
  }
  return false;
}

function applyLegacyFragments(snapshot, fragments, records) {
  for (const fragment of ordered(fragments)) {
    const validation = validateLegacyCompatFragment(fragment);
    if (!validation.ok) {
      const codes = new Set(validation.errors.map(error => error.code));
      if (codes.has('UNSAFE_FRAGMENT_POINTER')) fail('INVALID_LEGACY_FRAGMENT_POINTER');
      if (codes.has('RESERVED_FRAGMENT_POINTER') || codes.has('INVALID_TIMESTAMP_OVERLAY_VALUE')) {
        fail('LEGACY_FRAGMENT_CONFLICT');
      }
      if (codes.has('UNSAFE_FRAGMENT_VALUE') || codes.has('INVALID_FRAGMENT_JSON')) {
        fail('INVALID_LEGACY_FRAGMENT_VALUE');
      }
      if (codes.has('FRAGMENT_DIGEST_MISMATCH')) fail('FRAGMENT_DIGEST_MISMATCH');
      if (fragment?.classification !== 'L1_GRANDFATHERED_OPAQUE') {
        fail('INVALID_LEGACY_FRAGMENT_CLASSIFICATION');
      }
      if (validation.errors.some(error => error.path === '/json_pointer')) {
        fail('INVALID_LEGACY_FRAGMENT_POINTER');
      }
      fail('INVALID_LEGACY_FRAGMENT_ROW');
    }
    if (fragment?.classification !== 'L1_GRANDFATHERED_OPAQUE') {
      fail('INVALID_LEGACY_FRAGMENT_CLASSIFICATION');
    }
    const target = fragmentTarget(snapshot, fragment);
    if (!target) fail('LEGACY_FRAGMENT_UNKNOWN_ENTITY');
    const tokens = pointerTokens(fragment.json_pointer);
    if (typeof fragment.value_json !== 'string') fail('INVALID_LEGACY_FRAGMENT_VALUE');
    let value;
    try {
      value = JSON.parse(fragment.value_json);
    } catch {
      fail('INVALID_LEGACY_FRAGMENT_VALUE');
    }
    const conflictsWithReserved = FRAGMENT_RESERVED_FIELDS[fragment.entity_type].has(tokens[0])
      || tokens.some(token => V2_RESERVED_FIELDS.has(token));
    if (conflictsWithReserved && !allowsOptionalTimestampOverlay(records, fragment, tokens, target, value)) {
      fail('LEGACY_FRAGMENT_CONFLICT');
    }
    let parent = target;
    for (const token of tokens.slice(0, -1)) {
      if (Object.hasOwn(parent, token)) {
        if (parent[token] === null || typeof parent[token] !== 'object' || Array.isArray(parent[token])) {
          fail('LEGACY_FRAGMENT_CONFLICT');
        }
      } else {
        parent[token] = {};
      }
      parent = parent[token];
    }
    const key = tokens.at(-1);
    if (Object.hasOwn(parent, key)) fail('LEGACY_FRAGMENT_CONFLICT');
    parent[key] = value;
  }
  return snapshot;
}

const V2_ENUMS = {
  v1StatusMode: new Map([
    ['legacy_exact', 'legacyExact'],
    ['legacy_omitted', 'legacyOmitted'],
    ['canonical', 'canonical'],
  ]),
  lifecycleProvenance: new Map([
    ['legacy_snapshot', 'legacySnapshot'],
    ['domain_command', 'domainCommand'],
  ]),
  allocationMode: new Map([
    ['single', 'single'],
    ['grouped_unallocated', 'groupedUnallocated'],
  ]),
  scheduleSource: new Map([
    ['human', 'human'],
    ['agent_proposal', 'agentProposal'],
    ['agentProposal', 'agentProposal'],
    ['migration', 'migration'],
  ]),
  runScope: new Map([
    ['task', 'task'],
    ['block', 'block'],
  ]),
};

function mappedEnum(map, value, code) {
  const mapped = map.get(value);
  if (mapped === undefined) fail(code);
  return mapped;
}

function projectV2Deliverables(request) {
  if (request.production_type === undefined || request.production_type === null) return null;
  if (request.production_type === '平面') {
    if (!Number.isInteger(request.deliverable_count)) fail('INCOMPLETE_V2_DELIVERABLES');
    return { type: 'flat', count: request.deliverable_count };
  }
  if (request.production_type === '视频') {
    if (!Number.isInteger(request.duration_seconds) || typeof request.audio_requirement !== 'string') {
      fail('INCOMPLETE_V2_DELIVERABLES');
    }
    return {
      type: 'video',
      durationSeconds: request.duration_seconds,
      audioRequirement: request.audio_requirement,
    };
  }
  fail('INVALID_PRODUCTION_TYPE');
}

function projectV2Request(request) {
  const requiredFacts = [
    'business_created_at', 'business_updated_at', 'imported_at', 'v1_assets_present', 'v1_request_present',
    'production_type', 'shooting_subtype', 'deliverable_count', 'aspect_ratio', 'duration_seconds',
    'audio_requirement', 'requested_by', 'desired_date', 'note', 'source_operation_id',
    'core_brief_summary', 'brief_url', 'hero_asset_id', 'sample_status', 'sample_shelf_id',
    'lighting_preset', 'reflectivity', 'priority',
  ];
  if (requiredFacts.some(field => !Object.hasOwn(request, field))) fail('INCOMPLETE_V2_REQUEST_FACTS');
  const requiredText = ['id', 'sku', 'name', 'client', 'legacy_deliver_text', 'kind', 'source'];
  if (requiredText.some(field => typeof request[field] !== 'string')) fail('INCOMPLETE_V2_REQUEST');
  if (!Number.isInteger(request.source_ordinal) || request.source_ordinal < 0) fail('INVALID_SOURCE_ORDINAL');
  const value = {
    id: request.id,
    sourceOrdinal: request.source_ordinal,
    sku: request.sku,
    name: request.name,
    client: request.client,
    legacyDeliverText: request.legacy_deliver_text,
    kind: request.kind,
    legacyV1Status: request.legacy_v1_status ?? null,
    v1StatusMode: mappedEnum(V2_ENUMS.v1StatusMode, request.v1_status_mode, 'INVALID_V1_STATUS_MODE'),
    requestLifecycle: request.request_lifecycle ?? null,
    lifecycleProvenance: mappedEnum(
      V2_ENUMS.lifecycleProvenance,
      request.lifecycle_provenance,
      'INVALID_LIFECYCLE_PROVENANCE',
    ),
    source: request.source,
    productionType: request.production_type ?? null,
    shootingSubtype: request.shooting_subtype ?? null,
    aspectRatio: request.aspect_ratio ?? null,
    deliverables: projectV2Deliverables(request),
    requestedBy: request.requested_by ?? null,
    desiredDate: request.desired_date || null,
    note: request.note ?? null,
    sourceOperationId: request.source_operation_id ?? null,
    coreBriefSummary: request.core_brief_summary ?? null,
    briefUrl: request.brief_url ?? null,
    heroAssetId: request.hero_asset_id ?? null,
    sampleStatus: request.sample_status ?? null,
    sampleShelfId: request.sample_shelf_id ?? null,
    lightingPreset: request.lighting_preset,
    reflectivity: request.reflectivity,
    priority: request.priority ?? null,
  };
  if (request.business_created_at !== null) {
    value.businessCreatedAt = checkedTimestamp(request.business_created_at, 'INVALID_BUSINESS_CREATED_AT');
  }
  if (request.business_updated_at !== null) {
    value.businessUpdatedAt = checkedTimestamp(request.business_updated_at, 'INVALID_BUSINESS_UPDATED_AT');
  }
  if (request.imported_at !== null) {
    value.importedAt = checkedTimestamp(request.imported_at, 'INVALID_IMPORTED_AT');
  }
  return value;
}

function projectProductionRuns(records, model) {
  const runRows = rows(records, 'production_runs');
  const runById = indexUnique(runRows, 'id', 'DUPLICATE_RUN_ID');
  const result = [];
  for (const run of runById.values()) {
    const scheduleItemId = run.schedule_item_id;
    const item = model.itemById.get(scheduleItemId);
    if (!item) fail('UNKNOWN_RUN_SCHEDULE_ITEM');
    const scope = mappedEnum(V2_ENUMS.runScope, run.scope, 'INVALID_RUN_SCOPE');
    const taskId = run.task_id ?? null;
    if (scope === 'task') {
      if (!model.requestById.has(taskId)) fail('UNKNOWN_RUN_TASK');
      if (!model.bindingsByItem.get(scheduleItemId).some(binding => binding.task_id === taskId)) {
        fail('RUN_TASK_BINDING_MISMATCH');
      }
      if (item.allocation_mode !== 'single') fail('RUN_SCOPE_MISMATCH');
    } else if (taskId !== null || item.allocation_mode !== 'grouped_unallocated') {
      fail('RUN_SCOPE_MISMATCH');
    }
    if (!Number.isSafeInteger(run.run_revision) || run.run_revision < 0) fail('INVALID_RUN_REVISION');
    result.push({
      id: run.id,
      scheduleItemId,
      scope,
      taskId,
      status: run.status,
      runRevision: run.run_revision,
    });
  }
  return result;
}

export function projectV1CompatibilitySnapshot(records, {
  businessTimeZone,
  updatedAt,
} = {}) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) fail('INVALID_PROJECTION_INPUT');
  const model = validateBindings(records);
  const formatter = createWallClockFormatter(businessTimeZone);
  const assets = assetsByRequest(records, model.requestById);

  const products = ordered(rows(records, 'product_catalog_entries'), 'display_order').map(entry => {
    if (typeof entry.sku !== 'string' || typeof entry.name !== 'string') fail('INVALID_PRODUCT_ENTRY');
    return [entry.sku, entry.name];
  });

  const tasks = ordered(model.requests).map(request => {
    const task = projectV1Request(request);
    const status = v1Status(request, model);
    optional(task, 'status', status);
    const requestAssets = assets.get(request.id);
    if (request.v1_assets_present === true) {
      task.assets = requestAssets.map(entry => entry.value);
    } else if (request.v1_assets_present !== false && request.v1_assets_present !== undefined) {
      fail('INVALID_OPTIONAL_PRESENCE');
    } else if (requestAssets.length) {
      fail('ASSET_PRESENCE_CONFLICT');
    }
    if (request.v1_request_present === true) {
      task.request = projectV1RequestDetails(request);
    } else if (request.v1_request_present !== false && request.v1_request_present !== undefined) {
      fail('INVALID_OPTIONAL_PRESENCE');
    }
    return task;
  });

  const sessions = ordered(model.items)
    .filter(item => item.schedule_status !== 'cancelled')
    .map(item => {
      const start = wallClock(formatter, item.planned_start);
      const end = wallClock(formatter, item.planned_end);
      if (start.date !== end.date) fail('V1_SESSION_CROSSES_DATE_BOUNDARY');
      if (typeof item.note !== 'string') fail('INCOMPLETE_V1_SESSION');
      const session = {
        id: item.id,
        ids: model.bindingsByItem.get(item.id).map(binding => binding.task_id),
        date: start.date,
        start: start.time,
        end: end.time,
        place: resourcePlace(records, item),
        note: item.note,
      };
      optional(session, 'updatedAt', item.business_updated_at === null || item.business_updated_at === undefined
        ? item.business_updated_at
        : checkedTimestamp(item.business_updated_at, 'INVALID_BUSINESS_UPDATED_AT'));
      return session;
    });

  return applyLegacyFragments({
    schemaVersion: 1,
    revision: scopedRevision(records, 'projection_revision', 'INVALID_PROJECTION_REVISION'),
    updatedAt: projectionTimestamp(updatedAt),
    products,
    tasks,
    sessions,
  }, rows(records, 'legacy_compat_fragments'), records);
}

export function projectV2Snapshot(records, { updatedAt, allowedBriefHosts } = {}) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) fail('INVALID_PROJECTION_INPUT');
  const model = validateBindings(records);
  const projectionRevision = scopedRevision(records, 'projection_revision', 'INVALID_PROJECTION_REVISION');
  const scheduleRevision = scopedRevision(records, 'schedule_revision', 'INVALID_SCHEDULE_REVISION');
  const requests = ordered(model.requests).map(projectV2Request);
  const scheduleItems = ordered(model.items).map(item => {
    const requiredFacts = [
      'resource_id', 'resource_resolution_status', 'resource_mapping_version', 'legacy_place_text',
      'planned_start', 'planned_end', 'buffer_after_minutes', 'buffer_source', 'schedule_status',
      'schedule_status_provenance', 'lock_status', 'note', 'source', 'source_ref',
      'business_created_at', 'business_updated_at', 'imported_at',
    ];
    if (requiredFacts.some(field => !Object.hasOwn(item, field))) fail('INCOMPLETE_V2_SCHEDULE_FACTS');
    checkedTimestamp(item.planned_start, 'INVALID_PLANNED_TIME');
    checkedTimestamp(item.planned_end, 'INVALID_PLANNED_TIME');
    if (item.business_created_at !== null) checkedTimestamp(item.business_created_at, 'INVALID_BUSINESS_CREATED_AT');
    if (item.business_updated_at !== null) checkedTimestamp(item.business_updated_at, 'INVALID_BUSINESS_UPDATED_AT');
    if (item.imported_at !== null) checkedTimestamp(item.imported_at, 'INVALID_IMPORTED_AT');
    return {
      id: item.id,
      taskBindings: model.bindingsByItem.get(item.id).map(binding => ({
        taskId: binding.task_id,
        displayOrder: binding.display_order,
      })),
      allocationMode: mappedEnum(V2_ENUMS.allocationMode, item.allocation_mode, 'INVALID_ALLOCATION_MODE'),
      resourceId: item.resource_id ?? null,
      resourceResolutionStatus: item.resource_resolution_status,
      plannedStart: item.planned_start,
      plannedEnd: item.planned_end,
      bufferAfterMinutes: item.buffer_after_minutes ?? null,
      scheduleStatus: item.schedule_status,
      lockStatus: item.lock_status ?? null,
      source: mappedEnum(V2_ENUMS.scheduleSource, item.source, 'INVALID_SCHEDULE_SOURCE'),
      createdAt: item.business_created_at ?? null,
      updatedAt: item.business_updated_at ?? null,
    };
  });
  const productionRuns = projectProductionRuns(records, model);

  const snapshot = {
    schemaVersion: 2,
    projectionRevision,
    scheduleRevision,
    updatedAt: projectionTimestamp(updatedAt),
    requests,
    scheduleItems,
    productionRuns,
  };
  const validation = validateV2Snapshot(snapshot, { allowedBriefHosts });
  if (!validation.ok) fail(validation.errors[0]?.code ?? 'INVALID_V2_PROJECTION');
  return snapshot;
}
