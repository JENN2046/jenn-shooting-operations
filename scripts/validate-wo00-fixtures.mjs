import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSnapshot, validateSubmission } from '../src/contract-validator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'fixtures', 'migration-v2');

async function load(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), 'utf8'));
}

function wallClock(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant)).map(part => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function projectCandidateToV1(candidate) {
  const records = candidate.records;
  const products = records.product_catalog_entries
    .toSorted((a, b) => a.source_ordinal - b.source_ordinal)
    .map(entry => [entry.sku, entry.name]);
  const tasks = records.requests_v2
    .toSorted((a, b) => a.source_ordinal - b.source_ordinal)
    .map(request => ({
      id: request.id,
      sku: request.sku,
      name: request.name,
      client: request.client,
      deliver: request.legacy_deliver_text,
      kind: request.kind,
      status: request.legacy_v1_status,
      source: request.source,
      createdAt: request.business_created_at,
      updatedAt: request.business_updated_at,
    }));
  const sessions = records.schedule_items
    .toSorted((a, b) => a.source_ordinal - b.source_ordinal)
    .map(item => {
      const start = wallClock(item.planned_start, candidate.migrationContext.businessTimeZone);
      const end = wallClock(item.planned_end, candidate.migrationContext.businessTimeZone);
      return {
        id: item.id,
        ids: records.schedule_item_tasks
          .filter(binding => binding.schedule_item_id === item.id)
          .toSorted((a, b) => a.display_order - b.display_order)
          .map(binding => binding.task_id),
        date: start.date,
        start: start.time,
        end: end.time,
        place: item.legacy_place_text,
        note: item.note,
        updatedAt: item.business_updated_at,
      };
    });
  return {
    schemaVersion: 1,
    revision: records.revision_counters.projection_revision,
    updatedAt: candidate.candidateV2Projection.updatedAt,
    products,
    tasks,
    sessions,
  };
}

function candidateReferenceErrors(candidateRecords) {
  const requestIds = new Set((candidateRecords.requests_v2 ?? []).map(request => request.id));
  const scheduleIds = new Set((candidateRecords.schedule_items ?? []).map(item => item.id));
  const errors = [];
  for (const binding of candidateRecords.schedule_item_tasks ?? []) {
    if (!requestIds.has(binding.task_id)) errors.push('UNKNOWN_TASK_REFERENCE');
    if (!scheduleIds.has(binding.schedule_item_id)) errors.push('UNKNOWN_SCHEDULE_ITEM_REFERENCE');
  }
  return errors;
}

function groupedSplitErrors(sourceSession, candidateRecords) {
  if (sourceSession.ids.length < 2) return [];
  const items = candidateRecords.schedule_items.filter(item => item.source_ref === sourceSession.id);
  if (items.length !== 1 || items[0].id !== sourceSession.id || items[0].allocation_mode !== 'grouped_unallocated') {
    return ['GROUPED_SESSION_WOULD_SPLIT'];
  }
  return [];
}

function applyMutation(base, mutation) {
  const value = structuredClone(base);
  if (!mutation) return value;
  const segments = mutation.path.slice(1).split('/').map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  const key = segments.pop();
  let parent = value;
  for (const segment of segments) parent = parent[Array.isArray(parent) ? Number(segment) : segment];
  parent[Array.isArray(parent) ? Number(key) : key] = structuredClone(mutation.value);
  return value;
}

function attachmentIssues(testCase) {
  const issues = [];
  const requestIds = new Set(testCase.requestIds);
  const assetLocations = new Map();
  for (const [requestId, assets] of Object.entries(testCase.taskAssets)) {
    for (const asset of assets) assetLocations.set(asset.id, { requestId, asset });
  }
  const uploadById = new Map(testCase.uploads.map(upload => [upload.id, upload]));
  const legacyById = new Map(testCase.legacyAssets.map(asset => [asset.id, asset]));
  const fileByName = new Map(testCase.fileManifest.map(file => [file.stored_name, file]));

  for (const upload of testCase.uploads) {
    if (!requestIds.has(upload.claimed_task_id)) issues.push('UNKNOWN_TASK_REFERENCE');
    const location = assetLocations.get(upload.id);
    if (!location) {
      issues.push('UPLOAD_PROJECTION_MISSING');
    } else if (location.requestId !== upload.claimed_task_id) {
      issues.push('UPLOAD_CLAIM_MISMATCH');
    } else if (
      location.asset.name !== upload.original_name
      || location.asset.contentType !== upload.content_type
      || ['kind', 'size', 'sha256'].some(field => location.asset[field] !== upload[field])
    ) {
      issues.push('UPLOAD_METADATA_MISMATCH');
    }
    const file = fileByName.get(upload.stored_name);
    if (!file) issues.push('UPLOAD_FILE_MISSING');
    else if (!file.exists && file.tombstone) issues.push('STAGED_UPLOAD_RECOVERY_REQUIRED');
    else if (!file.exists) issues.push('UPLOAD_FILE_MISSING');
    else if (file.size !== upload.size) issues.push('UPLOAD_SIZE_MISMATCH');
    else if (file.sha256 !== upload.sha256) issues.push('UPLOAD_HASH_MISMATCH');
  }

  for (const [requestId, assets] of Object.entries(testCase.taskAssets)) {
    for (const asset of assets) {
      const upload = uploadById.get(asset.id);
      const legacy = legacyById.get(asset.id);
      if (!upload && !(legacy && legacy.request_id === requestId)) issues.push('UPLOAD_REFERENCE_MISSING');
    }
  }
  return [...new Set(issues)];
}

function projectedAssetOrder(testCase, requestId) {
  return [
    ...testCase.uploads
      .filter(upload => upload.claimed_task_id === requestId)
      .map(upload => ({ id: upload.id, order: upload.claimed_order })),
    ...testCase.legacyAssets
      .filter(asset => asset.request_id === requestId)
      .map(asset => ({ id: asset.id, order: asset.display_order })),
  ].toSorted((a, b) => a.order - b.order).map(entry => entry.id);
}

const jsonFiles = (await readdir(fixtureRoot)).filter(name => name.endsWith('.json')).sort();
for (const name of jsonFiles) await load(name);

for (const name of [
  'v1-single-session.json',
  'v1-grouped-session.json',
  'v1-full-compatibility.json',
]) {
  assert.deepEqual(validateSnapshot(await load(name)), [], `${name} must pass the current runtime validator`);
}

for (const name of [
  'candidate-v2-single-normalized.json',
  'candidate-v2-grouped-normalized.json',
]) {
  const candidate = await load(name);
  const records = candidate.records;
  const source = await load(candidate.sourceFixture);
  const requestIds = new Set(records.requests_v2.map(request => request.id));
  const scheduleIds = new Set(records.schedule_items.map(item => item.id));

  assert.equal(records.revision_counters.projection_revision, source.revision);
  assert.equal(records.revision_counters.schedule_revision, 0);
  assert.equal(candidate.candidateV2Projection.projectionRevision, source.revision);
  assert.equal(candidate.candidateV2Projection.scheduleRevision, 0);
  assert.deepEqual(records.production_runs, []);
  assert.deepEqual(records.production_events, []);
  assert.deepEqual(
    records.product_catalog_entries
      .sort((a, b) => a.source_ordinal - b.source_ordinal)
      .map(entry => [entry.sku, entry.name]),
    source.products,
  );

  const projectedTaskCore = records.requests_v2
    .sort((a, b) => a.source_ordinal - b.source_ordinal)
    .map(request => ({
      id: request.id,
      sku: request.sku,
      name: request.name,
      client: request.client,
      deliver: request.legacy_deliver_text,
      kind: request.kind,
      status: request.legacy_v1_status,
      source: request.source,
      createdAt: request.business_created_at,
      updatedAt: request.business_updated_at,
    }));
  assert.deepEqual(projectedTaskCore, source.tasks.map(task => ({
    id: task.id,
    sku: task.sku,
    name: task.name,
    client: task.client,
    deliver: task.deliver,
    kind: task.kind,
    status: task.status,
    source: task.source,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })));

  for (const item of records.schedule_items) {
    assert.equal(item.buffer_after_minutes, null);
    assert.equal(item.lock_status, null);
    assert.equal(item.business_created_at, null);
    assert.equal(item.resource_id, null);
    assert.equal(item.resource_resolution_status, 'unresolved');
  }

  for (const binding of records.schedule_item_tasks) {
    assert.ok(requestIds.has(binding.task_id), `${name} binding must reference requests_v2`);
    assert.ok(scheduleIds.has(binding.schedule_item_id), `${name} binding must reference schedule item`);
  }

  for (const sourceSession of source.sessions) {
    const item = records.schedule_items.find(entry => entry.id === sourceSession.id);
    assert.ok(item, `${name} must preserve each source session`);
    const bindings = records.schedule_item_tasks
      .filter(binding => binding.schedule_item_id === sourceSession.id)
      .sort((a, b) => a.display_order - b.display_order);
    assert.deepEqual(bindings.map(binding => binding.task_id), sourceSession.ids);
    assert.equal(item.allocation_mode, sourceSession.ids.length === 1 ? 'single' : 'grouped_unallocated');
    assert.equal(item.legacy_place_text, sourceSession.place);
    assert.equal(item.note, sourceSession.note);
    assert.equal(item.business_updated_at, sourceSession.updatedAt);
    const start = wallClock(item.planned_start, candidate.migrationContext.businessTimeZone);
    const end = wallClock(item.planned_end, candidate.migrationContext.businessTimeZone);
    assert.equal(start.date, sourceSession.date);
    assert.equal(start.time, sourceSession.start);
    assert.equal(end.date, sourceSession.date);
    assert.equal(end.time, sourceSession.end);
  }
  assert.deepEqual(projectCandidateToV1(candidate), source, `${name} must round-trip to its exact V1 source`);
}

const dangling = await load('expected-invalid-dangling-task-binding.json');
assert.deepEqual(candidateReferenceErrors(dangling.candidateRecords), ['UNKNOWN_TASK_REFERENCE']);
assert.equal(dangling.expectedErrors[0].code, 'UNKNOWN_TASK_REFERENCE');

const split = await load('expected-invalid-fabricated-group-split.json');
assert.equal(split.expectedErrors.length, 1);
assert.deepEqual(candidateReferenceErrors(split.candidateRecords), []);
assert.deepEqual(groupedSplitErrors(split.sourceV1Session, split.candidateRecords), ['GROUPED_SESSION_WOULD_SPLIT']);
assert.equal(split.expectedErrors[0].code, 'GROUPED_SESSION_WOULD_SPLIT');

const l1 = await load('legacy-runtime-only-extra-property.json');
assert.deepEqual(validateSnapshot(l1.sourceSnapshot), []);
assert.equal(l1.sourceSnapshot.tasks[0].runtimeOnlyExtension.opaque, true);
assert.equal(l1.expectedCompatibilityClass, 'L1_GRANDFATHERED_OPAQUE');

const l2 = await load('legacy-repair-required-invalid-time.json');
assert.deepEqual(validateSnapshot(l2.sourceSnapshot), []);
assert.ok(Number(l2.sourceSnapshot.sessions[0].start.slice(0, 2)) > 23);
assert.equal(l2.expectedCompatibilityClass, 'L2_REPAIR_REQUIRED');

const l3 = await load('legacy-source-corrupt-unknown-task.json');
assert.ok(validateSnapshot(l3.sourceSnapshot).some(error => error.includes('unknown task')));
assert.equal(l3.expectedCompatibilityClass, 'L3_SOURCE_CORRUPT');

const parity = await load('v1-contract-parity-matrix.json');
for (const testCase of parity.cases) {
  const input = applyMutation(parity.baseInputs[testCase.base], testCase.mutation);
  const errors = testCase.base === 'snapshot' ? validateSnapshot(input) : validateSubmission(input);
  const observed = errors.length === 0 ? 'PASS' : 'REJECT';
  assert.equal(observed, testCase.expected.currentRuntime, `${testCase.id} current runtime observation changed`);
}
for (const requiredCase of [
  'snapshot-root-extra-property',
  'snapshot-task-extra-property',
  'snapshot-session-extra-property',
  'snapshot-request-extra-property',
  'snapshot-asset-extra-property',
  'snapshot-illegal-status',
  'snapshot-invalid-source',
  'snapshot-duplicate-session-task-id',
  'snapshot-duplicate-session-id',
  'snapshot-duplicate-task-id',
  'snapshot-illegal-civil-time',
  'snapshot-illegal-calendar-date',
  'snapshot-non-rfc3339-root-timestamp',
  'snapshot-unsafe-revision',
  'snapshot-whitespace-required-text',
  'submission-extra-property',
  'submission-overlong-name',
  'submission-whitespace-required-text',
  'submission-invalid-production-combination',
  'submission-duplicate-upload-id',
  'submission-illegal-calendar-date',
]) assert.ok(parity.cases.some(testCase => testCase.id === requiredCase), `missing parity case ${requiredCase}`);

const attachmentMatrix = await load('attachment-manifest-cases.json');
for (const testCase of attachmentMatrix.cases) {
  assert.deepEqual(attachmentIssues(testCase), testCase.expectedIssues, `${testCase.id} attachment issue mismatch`);
  for (const [requestId, expectedOrder] of Object.entries(testCase.expectedProjectedOrder ?? {})) {
    assert.deepEqual(projectedAssetOrder(testCase, requestId), expectedOrder, `${testCase.id} asset order mismatch`);
  }
}

console.log(`PASS ${jsonFiles.length}/${jsonFiles.length} JSON fixtures parse; candidate round-trip, negative-path detection, contract parity observations, and attachment manifest cases hold`);
