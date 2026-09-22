import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateSnapshot,
  validateV1Snapshot,
  validateV1Submission,
  validateV2Snapshot,
  validateV2Submission,
  validateLegacyCompatFragment,
} from '../src/contract-validator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'));
}

for (const file of [
  'contracts/schedule-snapshot.schema.json',
  'contracts/request-submission.schema.json',
  'contracts/schedule-snapshot.v2.schema.json',
  'contracts/request-submission.v2.schema.json',
  'contracts/legacy-compat-fragment.v2.schema.json',
]) await readJson(file);

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

const fixture = await readJson('fixtures/schedule-snapshot.v1.json');
assert.equal(validateV1Snapshot(fixture).ok, true);
assert.deepEqual(validateSnapshot(fixture), []);

const parity = await readJson('fixtures/migration-v2/v1-contract-parity-matrix.json');
for (const testCase of parity.cases) {
  const input = mutate(parity.baseInputs[testCase.base], testCase.mutation);
  if (testCase.base === 'snapshot') {
    const strict = validateV1Snapshot(input);
    const legacy = validateV1Snapshot(input, { profile: 'legacy-read' });
    assert.equal(strict.ok ? 'PASS' : 'REJECT', testCase.expected.strictWrite, `${testCase.id}: strict-write`);
    assert.equal(legacy.classification, testCase.expected.legacyRead, `${testCase.id}: legacy-read`);
  } else {
    const strict = validateV1Submission(input);
    assert.equal(strict.ok ? 'PASS' : 'REJECT', testCase.expected.strictWrite, `${testCase.id}: strict-write`);
  }
}

assert.equal(validateV2Submission({
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
  lightingPreset: 'unknown',
  reflectivity: 'unknown',
  priority: 'p1',
  uploadIds: [],
}).ok, true);

assert.equal(validateV2Snapshot({
  schemaVersion: 2,
  projectionRevision: 0,
  scheduleRevision: 0,
  updatedAt: '2026-09-22T00:00:00.000Z',
  requests: [],
  scheduleItems: [],
  productionRuns: [],
}).ok, true);

const fragmentValue = '{"kept":true}';
assert.equal(validateLegacyCompatFragment({
  entity_type: 'root',
  entity_id: null,
  json_pointer: '/rootExtension',
  value_json: fragmentValue,
  value_digest: `sha256:${createHash('sha256').update(fragmentValue).digest('hex')}`,
  violation_code: 'ADDITIONAL_PROPERTY',
  classification: 'L1_GRANDFATHERED_OPAQUE',
  mapping_version: 'v1-to-v2-r1',
  source_ordinal: 0,
}).ok, true);

console.log(`PASS five Draft 2020-12 schemas compile and execute; ${parity.cases.length} V1 parity cases, V2 smoke fixtures, and legacy fragment contract validate`);
