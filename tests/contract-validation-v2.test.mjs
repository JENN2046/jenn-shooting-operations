import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  validateV1Snapshot,
  validateV1Submission,
  validateV2Snapshot,
  validateV2Submission,
  validateLegacyCompatFragment,
  normalizePlannerData,
} from '../src/contract-validator.mjs';

const fixtureRoot = new URL('../fixtures/migration-v2/', import.meta.url);
const parity = JSON.parse(await readFile(new URL('v1-contract-parity-matrix.json', fixtureRoot), 'utf8'));

function mutate(base, mutation) {
  const value = structuredClone(base);
  if (!mutation) return value;
  const segments = mutation.path.split('/').slice(1).map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  const key = segments.pop();
  let parent = value;
  for (const segment of segments) parent = parent[Array.isArray(parent) ? Number(segment) : segment];
  if (mutation.op === 'add' && Array.isArray(parent)) parent.splice(Number(key), 0, mutation.value);
  else parent[key] = mutation.value;
  return value;
}

test('V1 strict-write and legacy-read reproduce the frozen parity matrix', () => {
  for (const testCase of parity.cases) {
    const input = mutate(parity.baseInputs[testCase.base], testCase.mutation);
    if (testCase.base === 'snapshot') {
      const strict = validateV1Snapshot(input, { profile: 'strict-write' });
      const legacy = validateV1Snapshot(input, { profile: 'legacy-read' });
      assert.equal(strict.ok ? 'PASS' : 'REJECT', testCase.expected.strictWrite, `${testCase.id} strict-write`);
      assert.equal(legacy.classification, testCase.expected.legacyRead, `${testCase.id} legacy-read`);
    } else {
      const strict = validateV1Submission(input);
      assert.equal(strict.ok ? 'PASS' : 'REJECT', testCase.expected.strictWrite, `${testCase.id} strict-write`);
    }
  }
});

test('V1 strict-write enforces civil time, calendar date, RFC 3339 and safe revision', () => {
  const base = parity.baseInputs.snapshot;
  for (const [path, value] of [
    ['/sessions/0/start', '24:00'],
    ['/sessions/0/start', '23:60'],
    ['/sessions/0/date', '2026-02-30'],
    ['/updatedAt', '2026-09-22'],
    ['/revision', Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.equal(validateV1Snapshot(mutate(base, { op: 'replace', path, value })).ok, false, `${path}=${value}`);
  }
  assert.equal(validateV1Snapshot(mutate(base, { op: 'replace', path: '/sessions/0/start', value: '00:00' })).ok, true);
  assert.equal(validateV1Snapshot(mutate(base, { op: 'replace', path: '/sessions/0/end', value: '23:59' })).ok, true);
});

test('V1 embedded request enforces published production/subtype combinations', () => {
  const invalid = mutate(parity.baseInputs.snapshot, {
    op: 'replace', path: '/tasks/0/request/shootingSubtype', value: '产品展示',
  });
  assert.equal(validateV1Snapshot(invalid).ok, false);
  assert.equal(validateV1Snapshot(invalid, { profile: 'legacy-read' }).classification, 'L2_REPAIR_REQUIRED');

  const video = structuredClone(parity.baseInputs.snapshot);
  video.tasks[0].request.productionType = '视频';
  video.tasks[0].request.shootingSubtype = '场景视频';
  delete video.tasks[0].request.deliverableCount;
  video.tasks[0].request.durationSeconds = 30;
  video.tasks[0].request.audioRequirement = '原声';
  assert.equal(validateV1Snapshot(video).ok, true);
});

test('legacy-read returns exact L1 fragments without mutating input', () => {
  const input = mutate(parity.baseInputs.snapshot, { op: 'add', path: '/tasks/0/taskExtension', value: { keep: ['exactly'] } });
  const before = structuredClone(input);
  const result = validateV1Snapshot(input, { profile: 'legacy-read' });
  assert.equal(result.classification, 'L1_GRANDFATHERED_OPAQUE');
  assert.deepEqual(result.fragments, [{
    jsonPointer: '/tasks/0/taskExtension',
    value: { keep: ['exactly'] },
    violationCode: 'ADDITIONAL_PROPERTY',
  }]);
  assert.deepEqual(input, before);
});

test('legacy-read never launders reserved V2 fields into L1 fragments', () => {
  for (const [path, value] of [
    ['/projectionRevision', 2],
    ['/tasks/0/runRevision', 0],
    ['/sessions/0/nextStart', '2026-09-22T10:00:00.000Z'],
    ['/sessions/0/diagnostics', []],
  ]) {
    const input = mutate(parity.baseInputs.snapshot, { op: 'add', path, value });
    const result = validateV1Snapshot(input, { profile: 'legacy-read' });
    assert.equal(result.classification, 'L2_REPAIR_REQUIRED', path);
    assert.equal(result.switchReady, false, path);
    assert.deepEqual(result.fragments, [], path);
  }
});

test('legacy-read classifies optional timestamps as L1 and primary identity failures as L3', () => {
  for (const path of ['/tasks/0/createdAt', '/tasks/0/updatedAt', '/sessions/0/updatedAt']) {
    const input = mutate(parity.baseInputs.snapshot, { op: 'replace', path, value: 'not-rfc3339' });
    const result = validateV1Snapshot(input, { profile: 'legacy-read' });
    assert.equal(result.classification, 'L1_GRANDFATHERED_OPAQUE', path);
    assert.equal(result.switchReady, true, path);
    assert.deepEqual(result.fragments.map(fragment => fragment.jsonPointer), [path], path);
  }

  const missingTaskId = structuredClone(parity.baseInputs.snapshot);
  missingTaskId.sessions = [];
  delete missingTaskId.tasks[0].id;
  assert.equal(validateV1Snapshot(missingTaskId, { profile: 'legacy-read' }).classification, 'L3_SOURCE_CORRUPT');

  const missingSessionId = structuredClone(parity.baseInputs.snapshot);
  delete missingSessionId.sessions[0].id;
  assert.equal(validateV1Snapshot(missingSessionId, { profile: 'legacy-read' }).classification, 'L3_SOURCE_CORRUPT');

  for (const path of ['/tasks/0/id', '/sessions/0/id']) {
    const input = mutate(parity.baseInputs.snapshot, { op: 'replace', path, value: '   ' });
    assert.equal(validateV1Snapshot(input, { profile: 'legacy-read' }).classification, 'L3_SOURCE_CORRUPT', path);
  }
});

test('legacy-read fails closed on prototype-pollution property names', () => {
  for (const property of ['__proto__', 'constructor', 'prototype']) {
    const input = structuredClone(parity.baseInputs.snapshot);
    Object.defineProperty(input.tasks[0], property, { value: { polluted: true }, enumerable: true, configurable: true });
    const result = validateV1Snapshot(input, { profile: 'legacy-read' });
    assert.equal(result.classification, 'L3_SOURCE_CORRUPT', property);
    assert.equal(result.switchReady, false, property);
    assert.deepEqual(result.fragments, [], property);
  }

  const nested = structuredClone(parity.baseInputs.snapshot);
  nested.tasks[0].taskExtension = { safe: {} };
  Object.defineProperty(nested.tasks[0].taskExtension.safe, 'constructor', {
    value: { polluted: true }, enumerable: true, configurable: true,
  });
  const nestedResult = validateV1Snapshot(nested, { profile: 'legacy-read' });
  assert.equal(nestedResult.classification, 'L3_SOURCE_CORRUPT');
  assert.equal(nestedResult.switchReady, false);
  assert.deepEqual(nestedResult.fragments, []);
});

const validV2Submission = {
  schemaVersion: 2,
  operationId: 'OP-V2-CONTRACT-0001',
  productionType: '平面',
  sku: 'SKU-V2-001',
  name: 'V2 contract fixture',
  kind: '细节',
  shootingSubtype: '细节',
  aspectRatio: '1:1',
  deliverables: { type: 'flat', count: 4 },
  requestedBy: 'fixture requester',
  desiredDate: '2026-09-25',
  note: '',
  coreBriefSummary: 'Four detail photographs',
  sampleStatus: 'arrivedVerified',
  sampleShelfId: 'SHELF-A-01',
  lightingPreset: 'unknown',
  reflectivity: 'unknown',
  priority: 'p1',
  uploadIds: [],
};

test('V2 request uses discriminated deliverables and strict brief/sample fields', () => {
  assert.equal(validateV2Submission(validV2Submission).ok, true);

  const video = {
    ...validV2Submission,
    productionType: '视频',
    shootingSubtype: '口播',
    deliverables: { type: 'video', durationSeconds: 30, audioRequirement: '原声' },
  };
  assert.equal(validateV2Submission(video).ok, true);

  const wrongDeliverables = { ...validV2Submission, deliverables: { type: 'video', durationSeconds: 30, audioRequirement: '音乐' } };
  assert.equal(validateV2Submission(wrongDeliverables).ok, false);

  const missingBrief = structuredClone(validV2Submission);
  delete missingBrief.coreBriefSummary;
  assert.equal(validateV2Submission(missingBrief).ok, false);

  assert.equal(validateV2Submission({ ...validV2Submission, extra: true }).ok, false);
  assert.equal(validateV2Submission({ ...validV2Submission, desiredDate: '2026-02-30' }).ok, false);
  assert.equal(validateV2Submission({ ...validV2Submission, sampleStatus: 'unknown' }).ok, false);
  assert.equal(validateV2Submission({ ...validV2Submission, lightingPreset: '   ' }).ok, false);
  assert.equal(validateV2Submission({ ...validV2Submission, reflectivity: 'mirrorLike' }).ok, false);
  assert.equal(validateV2Submission({ ...validV2Submission, priority: 'urgent' }).ok, false);
  const missingUploads = structuredClone(validV2Submission);
  delete missingUploads.uploadIds;
  assert.equal(validateV2Submission(missingUploads).ok, false);
});

test('V2 briefUrl requires an explicit exact host allowlist', () => {
  const withBrief = { ...validV2Submission, briefUrl: 'https://briefs.example.test/request/1' };
  const missing = validateV2Submission(withBrief);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(error => error.code === 'BRIEF_HOST_ALLOWLIST_REQUIRED'));

  const mismatched = validateV2Submission(withBrief, { allowedBriefHosts: ['other.example.test'] });
  assert.equal(mismatched.ok, false);
  assert.ok(mismatched.errors.some(error => error.code === 'BRIEF_HOST_NOT_ALLOWED'));

  assert.equal(validateV2Submission(withBrief, { allowedBriefHosts: ['briefs.example.test'] }).ok, true);
});

const validV2Snapshot = {
  schemaVersion: 2,
  projectionRevision: 12,
  scheduleRevision: 3,
  updatedAt: '2026-09-22T00:00:00.000Z',
  requests: [{
    id: 'WORK-001',
    sourceOrdinal: 0,
    sku: 'SKU-V2-001',
    name: 'V2 contract fixture',
    client: 'fixture client',
    legacyDeliverText: 'four detail photographs',
    kind: '细节',
    legacyV1Status: 'scheduled',
    v1StatusMode: 'legacyExact',
    requestLifecycle: 'open',
    lifecycleProvenance: 'legacySnapshot',
    source: 'submission',
    productionType: '平面',
    shootingSubtype: '细节',
    aspectRatio: '1:1',
    deliverables: { type: 'flat', count: 4 },
    requestedBy: 'fixture requester',
    desiredDate: '2026-09-25',
    note: 'fixture note',
    sourceOperationId: 'OP-V2-CONTRACT-0001',
    coreBriefSummary: 'Four detail photographs',
    briefUrl: null,
    heroAssetId: null,
    sampleStatus: 'arrivedVerified',
    sampleShelfId: 'SHELF-A-01',
    lightingPreset: 'unknown',
    reflectivity: 'unknown',
    priority: 'p1',
  }],
  scheduleItems: [{
    id: 'SCHEDULE-001',
    taskBindings: [{ taskId: 'WORK-001', displayOrder: 0 }],
    allocationMode: 'single',
    resourceId: 'studio-a',
    resourceResolutionStatus: 'resolved',
    plannedStart: '2026-09-22T09:00:00.000Z',
    plannedEnd: '2026-09-22T10:00:00.000Z',
    bufferAfterMinutes: 10,
    scheduleStatus: 'confirmed',
    lockStatus: 'unlocked',
    source: 'human',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  }],
  productionRuns: [{
    id: 'RUN-001',
    scheduleItemId: 'SCHEDULE-001',
    scope: 'task',
    taskId: 'WORK-001',
    status: 'scheduled',
    runRevision: 0,
  }],
};

test('V2 snapshot exposes scoped revisions and canonical ordered bindings', () => {
  assert.equal(validateV2Snapshot(validV2Snapshot).ok, true);

  const incompleteRequest = structuredClone(validV2Snapshot);
  delete incompleteRequest.requests[0].deliverables;
  assert.equal(validateV2Snapshot(incompleteRequest).ok, false);

  const grouped = structuredClone(validV2Snapshot);
  grouped.requests.push({ ...grouped.requests[0], id: 'WORK-002', sourceOrdinal: 1 });
  grouped.scheduleItems[0].allocationMode = 'groupedUnallocated';
  grouped.scheduleItems[0].taskBindings.push({ taskId: 'WORK-002', displayOrder: 1 });
  grouped.productionRuns = [{ ...grouped.productionRuns[0], scope: 'block', taskId: null }];
  assert.equal(validateV2Snapshot(grouped).ok, true);

  grouped.scheduleItems[0].taskBindings[1].taskId = 'WORK-MISSING';
  assert.equal(validateV2Snapshot(grouped).ok, false);
});

test('V2 snapshot enforces frozen legacy status, lifecycle and provenance combinations', () => {
  for (const [legacyV1Status, requestLifecycle] of [
    ['pending', 'open'], ['scheduled', 'open'], ['completed', 'fulfilled'], ['cancelled', 'cancelled'],
  ]) {
    const candidate = structuredClone(validV2Snapshot);
    Object.assign(candidate.requests[0], {
      legacyV1Status, requestLifecycle, v1StatusMode: 'legacyExact', lifecycleProvenance: 'legacySnapshot',
    });
    assert.equal(validateV2Snapshot(candidate).ok, true, `${legacyV1Status}/${requestLifecycle}`);
  }

  const omitted = structuredClone(validV2Snapshot);
  Object.assign(omitted.requests[0], {
    legacyV1Status: null, requestLifecycle: null, v1StatusMode: 'legacyOmitted', lifecycleProvenance: 'legacySnapshot',
  });
  assert.equal(validateV2Snapshot(omitted).ok, true);

  const canonical = structuredClone(validV2Snapshot);
  Object.assign(canonical.requests[0], {
    legacyV1Status: 'completed', requestLifecycle: 'open', v1StatusMode: 'canonical', lifecycleProvenance: 'domainCommand',
  });
  assert.equal(validateV2Snapshot(canonical).ok, true);

  for (const changes of [
    { legacyV1Status: 'completed', requestLifecycle: 'open', v1StatusMode: 'legacyExact', lifecycleProvenance: 'legacySnapshot' },
    { legacyV1Status: null, requestLifecycle: 'open', v1StatusMode: 'legacyOmitted', lifecycleProvenance: 'legacySnapshot' },
    { legacyV1Status: null, requestLifecycle: null, v1StatusMode: 'canonical', lifecycleProvenance: 'domainCommand' },
    { legacyV1Status: null, requestLifecycle: 'open', v1StatusMode: 'canonical', lifecycleProvenance: 'legacySnapshot' },
  ]) {
    const candidate = structuredClone(validV2Snapshot);
    Object.assign(candidate.requests[0], changes);
    const result = validateV2Snapshot(candidate);
    assert.equal(result.ok, false, JSON.stringify(changes));
    assert.ok(result.errors.some(error => error.code === 'INVALID_REQUEST_LIFECYCLE_COMBINATION'));
  }
});

test('V2 rejects unscoped revision and persistent derived nextStart/diagnostics fields', () => {
  for (const candidate of [
    { ...validV2Snapshot, revision: 12 },
    { ...validV2Snapshot, diagnostics: [] },
    { ...validV2Snapshot, nextStart: '2026-09-22T10:10:00.000Z' },
    {
      ...validV2Snapshot,
      scheduleItems: [{ ...validV2Snapshot.scheduleItems[0], nextStart: '2026-09-22T10:10:00.000Z' }],
    },
  ]) assert.equal(validateV2Snapshot(candidate).ok, false);
});

test('V2 snapshot enforces allocation cardinality, order and schedule/run lifecycle separation', () => {
  const groupedWithOne = structuredClone(validV2Snapshot);
  groupedWithOne.scheduleItems[0].allocationMode = 'groupedUnallocated';
  assert.equal(validateV2Snapshot(groupedWithOne).ok, false);

  const badOrder = structuredClone(validV2Snapshot);
  badOrder.scheduleItems[0].taskBindings[0].displayOrder = 1;
  assert.equal(validateV2Snapshot(badOrder).ok, false);

  const completedSchedule = structuredClone(validV2Snapshot);
  completedSchedule.scheduleItems[0].scheduleStatus = 'completed';
  assert.equal(validateV2Snapshot(completedSchedule).ok, false);

  const completedRun = structuredClone(validV2Snapshot);
  completedRun.productionRuns[0].status = 'completed';
  assert.equal(validateV2Snapshot(completedRun).ok, true);

  const wrongRunScope = structuredClone(validV2Snapshot);
  wrongRunScope.productionRuns[0].scope = 'block';
  wrongRunScope.productionRuns[0].taskId = null;
  assert.equal(validateV2Snapshot(wrongRunScope).ok, false);

  const wrongRunBinding = structuredClone(validV2Snapshot);
  wrongRunBinding.requests.push({ ...wrongRunBinding.requests[0], id: 'WORK-002', sourceOrdinal: 1 });
  wrongRunBinding.productionRuns[0].taskId = 'WORK-002';
  assert.equal(validateV2Snapshot(wrongRunBinding).ok, false);

  const malformedBindings = structuredClone(validV2Snapshot);
  malformedBindings.scheduleItems[0].taskBindings = 'not-an-array';
  assert.equal(validateV2Snapshot(malformedBindings).ok, false);
});

test('legacy compatibility fragment contract verifies shape, pointer safety, JSON and digest', () => {
  const valueJson = JSON.stringify({ keep: ['exactly'] });
  const valid = {
    entity_type: 'task',
    entity_id: 'WORK-001',
    json_pointer: '/taskExtension',
    value_json: valueJson,
    value_digest: `sha256:${createHash('sha256').update(valueJson).digest('hex')}`,
    violation_code: 'ADDITIONAL_PROPERTY',
    classification: 'L1_GRANDFATHERED_OPAQUE',
    mapping_version: 'v1-to-v2-r1',
    source_ordinal: 0,
  };
  assert.equal(validateLegacyCompatFragment(valid).ok, true);

  const fragment = changes => {
    const candidate = { ...valid, ...changes };
    candidate.value_digest = `sha256:${createHash('sha256').update(candidate.value_json).digest('hex')}`;
    return candidate;
  };

  assert.equal(validateLegacyCompatFragment(fragment({
    entity_type: 'root', entity_id: null, json_pointer: '/', value_json: '"empty-key"',
  })).ok, true, 'RFC 6901 / preserves an empty-string additional property name');

  for (const changes of [
    { entity_type: 'root', entity_id: null, json_pointer: '/projectionRevision', value_json: '8' },
    { entity_type: 'root', entity_id: null, json_pointer: '/updatedAt', value_json: '"bad"' },
    { entity_type: 'task', json_pointer: '/status', value_json: '"completed"' },
    { entity_type: 'task', json_pointer: '/extension/priority', value_json: '"p0"' },
    { entity_type: 'task', json_pointer: '/updatedAt', value_json: '"not-rfc3339"', violation_code: 'ADDITIONAL_PROPERTY' },
    { entity_type: 'session', json_pointer: '/updatedAt', value_json: '"not-rfc3339"', violation_code: 'ADDITIONAL_PROPERTY' },
    { entity_type: 'task', json_pointer: '/updatedAt', value_json: '7', violation_code: 'SCHEMA_FORMAT' },
    { entity_type: 'task', json_pointer: '/updatedAt', value_json: '"2026-09-22T00:00:00.000Z"', violation_code: 'SCHEMA_FORMAT' },
  ]) {
    const result = validateLegacyCompatFragment(fragment(changes));
    assert.equal(result.ok, false, `reserved ${JSON.stringify(changes)}`);
    assert.ok(result.errors.some(error => ['RESERVED_FRAGMENT_POINTER', 'INVALID_TIMESTAMP_OVERLAY_VALUE'].includes(error.code)));
  }

  for (const changes of [
    { entity_type: 'task', json_pointer: '/createdAt', value_json: '"not-rfc3339"', violation_code: 'SCHEMA_FORMAT' },
    { entity_type: 'task', json_pointer: '/updatedAt', value_json: '"not-rfc3339"', violation_code: 'SCHEMA_FORMAT' },
    { entity_type: 'session', json_pointer: '/updatedAt', value_json: '"not-rfc3339"', violation_code: 'SCHEMA_FORMAT' },
  ]) assert.equal(validateLegacyCompatFragment(fragment(changes)).ok, true, JSON.stringify(changes));

  for (const changes of [
    { json_pointer: '/__proto__/polluted' },
    { value_json: '{not-json' },
    { value_json: '{"constructor":{"polluted":true}}' },
    { value_digest: `sha256:${'0'.repeat(64)}` },
    { classification: 'L2_REPAIR_REQUIRED' },
    { entity_type: 'root', entity_id: 'MUST-BE-NULL' },
  ]) {
    const result = validateLegacyCompatFragment({ ...valid, ...changes });
    assert.equal(result.ok, false, JSON.stringify(changes));
  }
});

test('planner normalization never preserves an unsafe revision integer', () => {
  assert.equal(normalizePlannerData({ revision: Number.MAX_SAFE_INTEGER + 1 }).revision, 0);
  assert.equal(normalizePlannerData({ revision: Number.MAX_SAFE_INTEGER }).revision, Number.MAX_SAFE_INTEGER);
});
