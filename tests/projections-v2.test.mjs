import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  projectV1CompatibilitySnapshot,
  projectV2Snapshot,
} from '../src/projections-v2.mjs';
import {
  validateLegacyCompatFragment,
  validateV1Snapshot,
  validateV2Snapshot,
} from '../src/contract-validator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(name) {
  return JSON.parse(await readFile(join(root, 'fixtures', 'migration-v2', name), 'utf8'));
}

function projectionOptions(candidate) {
  return {
    businessTimeZone: candidate.migrationContext.businessTimeZone,
    updatedAt: candidate.candidateV2Projection.updatedAt,
  };
}

function errorCode(code) {
  return error => error?.code === code;
}

function l1Fragment(overrides = {}) {
  const valueJson = overrides.value_json ?? 'true';
  return {
    entity_type: 'task',
    entity_id: 'TASK',
    json_pointer: '/extension',
    value_json: valueJson,
    value_digest: overrides.value_digest
      ?? `sha256:${createHash('sha256').update(valueJson).digest('hex')}`,
    violation_code: 'LEGACY_EXTRA_PROPERTY',
    classification: 'L1_GRANDFATHERED_OPAQUE',
    mapping_version: 'adp-020-test-v1',
    source_ordinal: 0,
    ...overrides,
    value_json: valueJson,
  };
}

test('candidate single and grouped records produce exact V1 and frozen V2 projections', async () => {
  for (const name of [
    'candidate-v2-single-normalized.json',
    'candidate-v2-grouped-normalized.json',
  ]) {
    const candidate = await fixture(name);
    const source = await fixture(candidate.sourceFixture);
    const before = structuredClone(candidate.records);

    assert.deepEqual(
      projectV1CompatibilitySnapshot(candidate.records, projectionOptions(candidate)),
      source,
    );
    const v2Snapshot = projectV2Snapshot(candidate.records, {
      updatedAt: candidate.candidateV2Projection.updatedAt,
    });
    assert.deepEqual(v2Snapshot, candidate.candidateV2Projection);
    assert.equal(validateV2Snapshot(v2Snapshot).ok, true);
    assert.deepEqual(candidate.records, before, 'projection must not mutate normalized facts');
  }
});

test('V1 projection preserves optional presence, duplicate product order, and merged asset order', () => {
  const records = {
    product_catalog_entries: [
      { display_order: 2, sku: 'SKU-A', name: 'A' },
      { display_order: 0, sku: 'SKU-A', name: 'A' },
      { display_order: 1, sku: 'SKU-ORPHAN', name: 'Orphan' },
    ],
    requests_v2: [
      {
        id: 'TASK-MIN', source_ordinal: 0, sku: 'SKU-A', name: 'A', client: 'C',
        legacy_deliver_text: 'D', kind: '细节', v1_status_mode: 'legacy_omitted',
        request_lifecycle: null, source: null, business_created_at: null,
        business_updated_at: null, v1_assets_present: false, v1_request_present: false,
      },
      {
        id: 'TASK-FULL', source_ordinal: 1, sku: 'SKU-A', name: 'A2', client: 'C2',
        legacy_deliver_text: 'Video', kind: '待定', legacy_v1_status: 'completed',
        v1_status_mode: 'legacy_exact', request_lifecycle: 'fulfilled', source: 'import',
        business_created_at: '2026-09-20T02:00:00.000Z',
        business_updated_at: '2026-09-22T08:00:00.000Z',
        v1_assets_present: true, v1_request_present: true,
        production_type: '视频', shooting_subtype: '产品加人物展示', deliverable_count: 1,
        aspect_ratio: '9:16', duration_seconds: 30, audio_requirement: '配音',
        requested_by: 'R', desired_date: '2026-09-25', note: '',
      },
    ],
    uploads: [
      {
        id: 'ASSET-MANAGED', claimed_task_id: 'TASK-FULL', claimed_order: 1,
        original_name: 'managed.jpg', content_type: 'image/jpeg', kind: 'image', size: 100,
        sha256: 'a'.repeat(64),
      },
    ],
    legacy_asset_entries: [
      {
        id: 'ASSET-LEGACY', request_id: 'TASK-FULL', display_order: 0,
        name: 'legacy.pdf', content_type: 'application/pdf', kind: 'attachment', size: 200,
        sha256: 'b'.repeat(64),
      },
    ],
    schedule_items: [],
    schedule_item_tasks: [],
    revision_counters: { projection_revision: 17, schedule_revision: 0 },
  };

  assert.deepEqual(projectV1CompatibilitySnapshot(records, {
    businessTimeZone: 'Asia/Shanghai',
    updatedAt: '2026-09-22T08:00:00.000Z',
  }), {
    schemaVersion: 1,
    revision: 17,
    updatedAt: '2026-09-22T08:00:00.000Z',
    products: [['SKU-A', 'A'], ['SKU-ORPHAN', 'Orphan'], ['SKU-A', 'A']],
    tasks: [
      { id: 'TASK-MIN', sku: 'SKU-A', name: 'A', client: 'C', deliver: 'D', kind: '细节' },
      {
        id: 'TASK-FULL', sku: 'SKU-A', name: 'A2', client: 'C2', deliver: 'Video', kind: '待定',
        status: 'completed', source: 'import', createdAt: '2026-09-20T02:00:00.000Z',
        updatedAt: '2026-09-22T08:00:00.000Z',
        assets: [
          {
            id: 'ASSET-LEGACY', name: 'legacy.pdf', contentType: 'application/pdf',
            kind: 'attachment', size: 200, sha256: 'b'.repeat(64),
          },
          {
            id: 'ASSET-MANAGED', name: 'managed.jpg', contentType: 'image/jpeg',
            kind: 'image', size: 100, sha256: 'a'.repeat(64),
          },
        ],
        request: {
          productionType: '视频', shootingSubtype: '产品加人物展示', deliverableCount: 1,
          aspectRatio: '9:16', durationSeconds: 30, audioRequirement: '配音',
          requestedBy: 'R', desiredDate: '2026-09-25', note: '',
        },
      },
    ],
    sessions: [],
  });
});

test('canonical V1 status is derived without using production runs', () => {
  const records = {
    product_catalog_entries: [],
    requests_v2: [
      { id: 'OPEN', source_ordinal: 0, sku: 'S1', name: 'N1', client: 'C', legacy_deliver_text: 'D', kind: '待定', v1_status_mode: 'canonical', request_lifecycle: 'open', v1_assets_present: false, v1_request_present: false },
      { id: 'DONE', source_ordinal: 1, sku: 'S2', name: 'N2', client: 'C', legacy_deliver_text: 'D', kind: '待定', v1_status_mode: 'canonical', request_lifecycle: 'fulfilled', v1_assets_present: false, v1_request_present: false },
      { id: 'CANCELLED', source_ordinal: 2, sku: 'S3', name: 'N3', client: 'C', legacy_deliver_text: 'D', kind: '待定', v1_status_mode: 'canonical', request_lifecycle: 'cancelled', v1_assets_present: false, v1_request_present: false },
    ],
    schedule_items: [
      { id: 'BLOCK', source_ordinal: 0, schedule_status: 'confirmed', allocation_mode: 'single', source: 'migration', legacy_place_text: '', note: '', planned_start: '2026-09-22T01:00:00.000Z', planned_end: '2026-09-22T02:00:00.000Z' },
      { id: 'CANCELLED-BLOCK', source_ordinal: 1, schedule_status: 'cancelled', allocation_mode: 'single', source: 'migration', legacy_place_text: '', note: '', planned_start: '2026-09-22T03:00:00.000Z', planned_end: '2026-09-22T04:00:00.000Z' },
    ],
    schedule_item_tasks: [
      { schedule_item_id: 'BLOCK', task_id: 'OPEN', display_order: 0 },
      { schedule_item_id: 'CANCELLED-BLOCK', task_id: 'CANCELLED', display_order: 0 },
    ],
    production_runs: [{ id: 'IGNORED', status: 'completed', task_id: 'OPEN' }],
    revision_counters: { projection_revision: 3, schedule_revision: 2 },
  };

  const projected = projectV1CompatibilitySnapshot(records, {
    businessTimeZone: 'Asia/Shanghai', updatedAt: '2026-09-22T08:00:00.000Z',
  });
  assert.deepEqual(projected.tasks.map(task => task.status), ['scheduled', 'completed', 'cancelled']);
  assert.deepEqual(projected.sessions.map(session => session.id), ['BLOCK']);
});

test('V2 projection emits only persisted schedule facts and scoped revisions', () => {
  const records = {
    product_catalog_entries: [], requests_v2: [{
      id: 'TASK', source_ordinal: 0, sku: 'S', name: 'N', client: 'C',
      legacy_deliver_text: 'D', kind: '待定', legacy_v1_status: 'scheduled',
      v1_status_mode: 'legacy_exact', request_lifecycle: 'open',
      lifecycle_provenance: 'legacy_snapshot', source: 'import',
      production_type: '平面', shooting_subtype: '待定', aspect_ratio: '1:1',
      deliverable_count: 4, duration_seconds: null, audio_requirement: null,
      requested_by: 'R', desired_date: '2026-09-25', note: '',
      source_operation_id: 'OP-V2-PROJECTION-0001', core_brief_summary: 'Four photographs',
      brief_url: 'https://example.com/brief', hero_asset_id: 'ASSET-HERO-0001',
      sample_status: 'arrivedVerified', sample_shelf_id: 'SHELF-A-01',
      lighting_preset: 'softbox', reflectivity: 'medium', priority: 'p1',
      business_created_at: null, business_updated_at: null, imported_at: null,
      v1_assets_present: false, v1_request_present: false,
    }],
    schedule_items: [{
      id: 'BLOCK', source_ordinal: 0, allocation_mode: 'single', resource_id: 'R1',
      resource_resolution_status: 'resolved', resource_mapping_version: 'manual-v1',
      legacy_place_text: 'legacy',
      planned_start: '2026-09-22T01:00:00.000Z', planned_end: '2026-09-22T02:00:00.000Z',
      buffer_after_minutes: 10, buffer_source: 'config', schedule_status: 'confirmed',
      schedule_status_provenance: 'domain_command', lock_status: 'locked', note: '',
      source: 'human', source_ref: null, business_created_at: '2026-09-20T00:00:00.000Z',
      business_updated_at: '2026-09-22T00:00:00.000Z', imported_at: null,
      next_start: 'must-not-leak', diagnostics: [{ code: 'must-not-leak' }],
    }],
    schedule_item_tasks: [{ schedule_item_id: 'BLOCK', task_id: 'TASK', display_order: 0 }],
    production_runs: [{
      id: 'RUN', schedule_item_id: 'BLOCK', scope: 'task', task_id: 'TASK',
      status: 'scheduled', run_revision: 0,
    }],
    revision_counters: { projection_revision: 9, schedule_revision: 4 },
  };

  const snapshot = projectV2Snapshot(records, {
    updatedAt: '2026-09-22T08:00:00.000Z', allowedBriefHosts: ['example.com'],
  });
  assert.deepEqual(snapshot, {
    schemaVersion: 2,
    projectionRevision: 9,
    scheduleRevision: 4,
    updatedAt: '2026-09-22T08:00:00.000Z',
    requests: [{
      id: 'TASK', sourceOrdinal: 0, sku: 'S', name: 'N', client: 'C', legacyDeliverText: 'D',
      kind: '待定', legacyV1Status: 'scheduled', v1StatusMode: 'legacyExact',
      requestLifecycle: 'open', lifecycleProvenance: 'legacySnapshot', source: 'import',
      productionType: '平面', shootingSubtype: '待定', aspectRatio: '1:1',
      deliverables: { type: 'flat', count: 4 }, requestedBy: 'R', desiredDate: '2026-09-25',
      note: '', sourceOperationId: 'OP-V2-PROJECTION-0001', coreBriefSummary: 'Four photographs',
      briefUrl: 'https://example.com/brief', heroAssetId: 'ASSET-HERO-0001',
      sampleStatus: 'arrivedVerified', sampleShelfId: 'SHELF-A-01', lightingPreset: 'softbox',
      reflectivity: 'medium', priority: 'p1',
    }],
    scheduleItems: [{
      id: 'BLOCK', taskBindings: [{ taskId: 'TASK', displayOrder: 0 }],
      allocationMode: 'single', resourceId: 'R1', resourceResolutionStatus: 'resolved',
      plannedStart: '2026-09-22T01:00:00.000Z', plannedEnd: '2026-09-22T02:00:00.000Z',
      bufferAfterMinutes: 10, scheduleStatus: 'confirmed', lockStatus: 'locked',
      source: 'human', createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    }],
    productionRuns: [{
      id: 'RUN', scheduleItemId: 'BLOCK', scope: 'task', taskId: 'TASK',
      status: 'scheduled', runRevision: 0,
    }],
  });
  assert.equal(validateV2Snapshot(snapshot, { allowedBriefHosts: ['example.com'] }).ok, true);

  const groupedRecords = structuredClone(records);
  groupedRecords.requests_v2.push({
    ...groupedRecords.requests_v2[0], id: 'TASK-2', source_ordinal: 1,
    source_operation_id: 'OP-V2-PROJECTION-0002', hero_asset_id: null, brief_url: null,
  });
  groupedRecords.schedule_items[0].allocation_mode = 'grouped_unallocated';
  groupedRecords.schedule_item_tasks.push({
    schedule_item_id: 'BLOCK', task_id: 'TASK-2', display_order: 1,
  });
  groupedRecords.production_runs = [{
    id: 'RUN-BLOCK', schedule_item_id: 'BLOCK', scope: 'block', task_id: null,
    status: 'scheduled', run_revision: 0,
  }];
  const groupedSnapshot = projectV2Snapshot(groupedRecords, {
    updatedAt: '2026-09-22T08:00:00.000Z', allowedBriefHosts: ['example.com'],
  });
  assert.equal(groupedSnapshot.scheduleItems[0].allocationMode, 'groupedUnallocated');
  assert.equal(groupedSnapshot.productionRuns[0].scope, 'block');
  assert.equal(validateV2Snapshot(groupedSnapshot, { allowedBriefHosts: ['example.com'] }).ok, true);

  assert.throws(() => projectV2Snapshot(records, {
    updatedAt: '2026-09-22', allowedBriefHosts: ['example.com'],
  }), errorCode('INVALID_PROJECTION_UPDATED_AT'));

  const looseV2PlannedTime = structuredClone(records);
  looseV2PlannedTime.schedule_items[0].planned_start = '2026-09-22 01:00:00Z';
  assert.throws(() => projectV2Snapshot(looseV2PlannedTime, {
    updatedAt: '2026-09-22T08:00:00.000Z', allowedBriefHosts: ['example.com'],
  }), errorCode('INVALID_PLANNED_TIME'));

  const missingFact = structuredClone(records);
  delete missingFact.requests_v2[0].lighting_preset;
  assert.throws(() => projectV2Snapshot(missingFact, {
    updatedAt: '2026-09-22T08:00:00.000Z', allowedBriefHosts: ['example.com'],
  }), errorCode('INCOMPLETE_V2_REQUEST_FACTS'));
});

test('V1 projection restores controlled L1 fragments at root, task, session, request, and asset locations', () => {
  const records = {
    product_catalog_entries: [],
    requests_v2: [{
      id: 'TASK', source_ordinal: 0, sku: 'S', name: 'N', client: 'C',
      legacy_deliver_text: 'D', kind: '待定', v1_status_mode: 'legacy_omitted',
      v1_assets_present: true, v1_request_present: true,
      production_type: '平面', shooting_subtype: '待定', aspect_ratio: '1:1',
      requested_by: 'R', desired_date: '', note: '',
    }],
    legacy_asset_entries: [{
      id: 'ASSET', request_id: 'TASK', display_order: 0, name: 'legacy.jpg',
      content_type: 'image/jpeg', kind: 'image', size: 1, sha256: 'a'.repeat(64),
    }],
    schedule_items: [{
      id: 'BLOCK', source_ordinal: 0, allocation_mode: 'single', schedule_status: 'confirmed',
      schedule_status_provenance: 'legacy_snapshot', source: 'migration', legacy_place_text: '',
      note: '', planned_start: '2026-09-22T01:00:00.000Z', planned_end: '2026-09-22T02:00:00.000Z',
    }],
    schedule_item_tasks: [{ schedule_item_id: 'BLOCK', task_id: 'TASK', display_order: 0 }],
    revision_counters: { projection_revision: 3, schedule_revision: 0 },
    legacy_compat_fragments: [
      l1Fragment({ entity_type: 'root', entity_id: null, json_pointer: '/rootExtension', value_json: '{"enabled":true}', source_ordinal: 0 }),
      l1Fragment({ entity_type: 'task', entity_id: 'TASK', json_pointer: '/taskExtension', value_json: '7', source_ordinal: 1 }),
      l1Fragment({ entity_type: 'session', entity_id: 'BLOCK', json_pointer: '/sessionExtension', value_json: '"kept"', source_ordinal: 2 }),
      l1Fragment({ entity_type: 'request', entity_id: 'TASK', json_pointer: '/requestExtension', value_json: '[1,2]', source_ordinal: 3 }),
      l1Fragment({ entity_type: 'asset', entity_id: 'ASSET', json_pointer: '/assetExtension', value_json: 'null', source_ordinal: 4 }),
    ],
  };

  const projected = projectV1CompatibilitySnapshot(records, {
    businessTimeZone: 'Asia/Shanghai', updatedAt: '2026-09-22T08:00:00.000Z',
  });
  assert.deepEqual(projected.rootExtension, { enabled: true });
  assert.equal(projected.tasks[0].taskExtension, 7);
  assert.deepEqual(projected.tasks[0].request.requestExtension, [1, 2]);
  assert.equal(projected.tasks[0].assets[0].assetExtension, null);
  assert.equal(projected.sessions[0].sessionExtension, 'kept');
});

test('legacy optional timestamp fragments replay exact V1 while V2 remains schema-valid', async () => {
  const candidate = await fixture('candidate-v2-single-normalized.json');
  const source = await fixture(candidate.sourceFixture);
  source.tasks[0].createdAt = 'legacy-created-at';
  source.tasks[0].updatedAt = 'legacy-task-updated-at';
  source.sessions[0].updatedAt = 'legacy-session-updated-at';

  const legacy = validateV1Snapshot(source, { profile: 'legacy-read' });
  assert.equal(legacy.classification, 'L1_GRANDFATHERED_OPAQUE');
  assert.equal(legacy.switchReady, true);
  assert.deepEqual(legacy.fragments.map(fragment => fragment.violationCode), [
    'SCHEMA_FORMAT', 'SCHEMA_FORMAT', 'SCHEMA_FORMAT',
  ]);

  const records = structuredClone(candidate.records);
  records.requests_v2[0].business_created_at = null;
  records.requests_v2[0].business_updated_at = null;
  records.schedule_items[0].business_updated_at = null;
  records.legacy_compat_fragments = legacy.fragments.map((fragment, sourceOrdinal) => {
    const isTask = fragment.jsonPointer.startsWith('/tasks/');
    const jsonPointer = `/${fragment.jsonPointer.split('/').at(-1)}`;
    const row = l1Fragment({
      entity_type: isTask ? 'task' : 'session',
      entity_id: isTask ? source.tasks[0].id : source.sessions[0].id,
      json_pointer: jsonPointer,
      value_json: JSON.stringify(fragment.value),
      violation_code: fragment.violationCode,
      source_ordinal: sourceOrdinal,
    });
    assert.equal(validateLegacyCompatFragment(row).ok, true);
    return row;
  });

  assert.deepEqual(projectV1CompatibilitySnapshot(records, projectionOptions(candidate)), source);
  const v2 = projectV2Snapshot(records, { updatedAt: source.updatedAt });
  assert.equal(validateV2Snapshot(v2).ok, true);
  assert.equal(Object.hasOwn(v2.requests[0], 'businessCreatedAt'), false);
  assert.equal(Object.hasOwn(v2.requests[0], 'businessUpdatedAt'), false);
  assert.equal(v2.scheduleItems[0].updatedAt, null);
});

test("json_pointer '/' replays a root empty-string property losslessly", async () => {
  const candidate = await fixture('candidate-v2-single-normalized.json');
  const source = await fixture(candidate.sourceFixture);
  source[''] = { exact: 'empty-key' };
  const legacy = validateV1Snapshot(source, { profile: 'legacy-read' });
  assert.equal(legacy.classification, 'L1_GRANDFATHERED_OPAQUE');
  assert.deepEqual(legacy.fragments.map(fragment => fragment.jsonPointer), ['/']);

  const valueJson = JSON.stringify(legacy.fragments[0].value);
  const row = l1Fragment({
    entity_type: 'root', entity_id: null, json_pointer: '/', value_json: valueJson,
    violation_code: legacy.fragments[0].violationCode,
  });
  assert.equal(validateLegacyCompatFragment(row).ok, true);
  const records = structuredClone(candidate.records);
  records.legacy_compat_fragments = [row];
  assert.deepEqual(projectV1CompatibilitySnapshot(records, projectionOptions(candidate)), source);
});

test('L1 fragment reconstruction rejects unsafe pointers, conflicts, classifications, and unknown entities', () => {
  const base = {
    product_catalog_entries: [],
    requests_v2: [{ id: 'TASK', source_ordinal: 0, sku: 'S', name: 'N', client: 'C', legacy_deliver_text: 'D', kind: '待定', v1_status_mode: 'legacy_omitted', v1_assets_present: false, v1_request_present: false }],
    schedule_items: [], schedule_item_tasks: [],
    revision_counters: { projection_revision: 1, schedule_revision: 0 },
  };
  const options = { businessTimeZone: 'Asia/Shanghai', updatedAt: '2026-09-22T08:00:00.000Z' };
  const withFragment = fragment => ({ ...base, legacy_compat_fragments: [l1Fragment(fragment)] });

  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/status', value_json: '"completed"', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('LEGACY_FRAGMENT_CONFLICT'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/createdAt', value_json: '"legacy"',
    violation_code: 'ADDITIONAL_PROPERTY', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('LEGACY_FRAGMENT_CONFLICT'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'root', entity_id: null, json_pointer: '/projectionRevision', value_json: '8', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('LEGACY_FRAGMENT_CONFLICT'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/extension/priority', value_json: '"p0"', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('LEGACY_FRAGMENT_CONFLICT'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/__proto__/polluted', value_json: 'true', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('INVALID_LEGACY_FRAGMENT_POINTER'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/extension/constructor/polluted', value_json: 'true', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('INVALID_LEGACY_FRAGMENT_POINTER'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'MISSING', json_pointer: '/extension', value_json: 'true', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('LEGACY_FRAGMENT_UNKNOWN_ENTITY'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/extension', value_json: 'true', classification: 'L2_REPAIR_REQUIRED',
  }), options), errorCode('INVALID_LEGACY_FRAGMENT_CLASSIFICATION'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: 'not-a-pointer', value_json: 'true', classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('INVALID_LEGACY_FRAGMENT_POINTER'));
  assert.throws(() => projectV1CompatibilitySnapshot(withFragment({
    entity_type: 'task', entity_id: 'TASK', json_pointer: '/extension', value_json: 'true',
    value_digest: `sha256:${'0'.repeat(64)}`, classification: 'L1_GRANDFATHERED_OPAQUE',
  }), options), errorCode('FRAGMENT_DIGEST_MISMATCH'));
});

test('projection fails closed with stable codes for invalid normalized facts', () => {
  const base = {
    product_catalog_entries: [], requests_v2: [{ id: 'TASK', source_ordinal: 0, sku: 'S', name: 'N', client: 'C', legacy_deliver_text: 'D', kind: '待定', v1_status_mode: 'legacy_omitted', request_lifecycle: null, lifecycle_provenance: 'legacy_snapshot', source: 'import', v1_assets_present: false, v1_request_present: false }],
    schedule_items: [{ id: 'BLOCK', source_ordinal: 0, allocation_mode: 'single', resource_id: null, resource_resolution_status: 'unresolved', buffer_after_minutes: null, lock_status: null, schedule_status: 'confirmed', schedule_status_provenance: 'legacy_snapshot', source: 'migration', legacy_place_text: '', note: '', planned_start: '2026-09-22T01:00:00.000Z', planned_end: '2026-09-22T02:00:00.000Z', business_created_at: null, business_updated_at: null }],
    schedule_item_tasks: [{ schedule_item_id: 'BLOCK', task_id: 'TASK', display_order: 0 }],
    revision_counters: { projection_revision: 1, schedule_revision: 0 },
  };
  const options = { businessTimeZone: 'Asia/Shanghai', updatedAt: '2026-09-22T08:00:00.000Z' };

  const dangling = structuredClone(base);
  dangling.schedule_item_tasks[0].task_id = 'MISSING';
  assert.throws(() => projectV1CompatibilitySnapshot(dangling, options), errorCode('UNKNOWN_TASK_REFERENCE'));

  const badGrouped = structuredClone(base);
  badGrouped.schedule_items[0].allocation_mode = 'grouped_unallocated';
  assert.throws(() => projectV2Snapshot(badGrouped, { updatedAt: options.updatedAt }), errorCode('INVALID_BINDING_COUNT'));

  const bindingGap = structuredClone(base);
  bindingGap.requests_v2.push({ ...bindingGap.requests_v2[0], id: 'TASK-2', source_ordinal: 1 });
  bindingGap.schedule_items[0].allocation_mode = 'grouped_unallocated';
  bindingGap.schedule_item_tasks.push({
    schedule_item_id: 'BLOCK', task_id: 'TASK-2', display_order: 2,
  });
  assert.throws(() => projectV2Snapshot(bindingGap, { updatedAt: options.updatedAt }), errorCode('INVALID_BINDING_ORDER'));

  const duplicatedAssetOrder = structuredClone(base);
  duplicatedAssetOrder.requests_v2[0].v1_assets_present = true;
  duplicatedAssetOrder.uploads = [{ id: 'A', claimed_task_id: 'TASK', claimed_order: 0, original_name: 'a', content_type: 'image/jpeg', kind: 'image', size: 1, sha256: 'a'.repeat(64) }];
  duplicatedAssetOrder.legacy_asset_entries = [{ id: 'B', request_id: 'TASK', display_order: 0, name: 'b', content_type: 'image/jpeg', kind: 'image', size: 1, sha256: 'b'.repeat(64) }];
  assert.throws(() => projectV1CompatibilitySnapshot(duplicatedAssetOrder, options), errorCode('ASSET_ORDER_CONFLICT'));

  assert.throws(
    () => projectV1CompatibilitySnapshot(base, { ...options, businessTimeZone: 'Not/AZone' }),
    errorCode('INVALID_BUSINESS_TIME_ZONE'),
  );
  assert.throws(
    () => projectV1CompatibilitySnapshot(base, { ...options, updatedAt: '2026-09-22' }),
    errorCode('INVALID_PROJECTION_UPDATED_AT'),
  );

  const loosePlannedTime = structuredClone(base);
  loosePlannedTime.schedule_items[0].planned_start = '2026-09-22 01:00:00Z';
  assert.throws(
    () => projectV1CompatibilitySnapshot(loosePlannedTime, options),
    errorCode('INVALID_PLANNED_TIME'),
  );

  const looseBusinessTimestamp = structuredClone(base);
  looseBusinessTimestamp.requests_v2[0].business_created_at = 'legacy-created-at';
  assert.throws(
    () => projectV1CompatibilitySnapshot(looseBusinessTimestamp, options),
    errorCode('INVALID_BUSINESS_CREATED_AT'),
  );

  const unsafeRevision = structuredClone(base);
  unsafeRevision.revision_counters.projection_revision = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => projectV2Snapshot(unsafeRevision, { updatedAt: options.updatedAt }), errorCode('INVALID_PROJECTION_REVISION'));
});
