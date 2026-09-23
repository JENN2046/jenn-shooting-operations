import {
  buildShadowDatasetManifestV1,
  classifySchedulingSampleV1,
  evaluateShadowMetricsV1,
} from './scheduling-evaluation-contract-v1.mjs';
import { canonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

const FIXTURE_KEYS = Object.freeze(['schemaVersion', 'fixtureId', 'reportInput', 'expected']);
const EXPECTED_KEYS = Object.freeze(['datasetDigest', 'caseClassifications', 'report']);

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function invalid(reason) {
  return Object.freeze({ ok: false, code: 'SHADOW_FIXTURE_REPLAY_INVALID', reason });
}

export function replayShadowEvaluationFixtureV1(value) {
  if (!exactKeys(value, FIXTURE_KEYS) || value.schemaVersion !== 1
    || typeof value.fixtureId !== 'string' || value.fixtureId.length === 0
    || !exactKeys(value.expected, EXPECTED_KEYS)) {
    return invalid('FIXTURE_ENVELOPE_INVALID');
  }

  const manifest = buildShadowDatasetManifestV1(
    value.reportInput?.manifest,
    { expectedApprovalDigest: null },
  );
  if (!manifest.ok) return invalid(`MANIFEST:${manifest.reason ?? manifest.code}`);
  if (manifest.datasetDigest !== value.expected.datasetDigest) {
    return invalid('DATASET_DIGEST_MISMATCH');
  }

  const classifications = [];
  for (const item of manifest.manifest.cases) {
    const classified = classifySchedulingSampleV1(item.qualification);
    if (!classified.ok) return invalid(`CLASSIFIER:${classified.reason ?? classified.code}`);
    classifications.push(classified.classification);
  }
  if (canonicalJsonSchedulingV1(classifications)
    !== canonicalJsonSchedulingV1(value.expected.caseClassifications)) {
    return invalid('CLASSIFICATION_MISMATCH');
  }

  const evaluated = evaluateShadowMetricsV1(value.reportInput, {
    replayHardConstraints: null,
    evaluatePriorityPair: null,
    expectedApprovalDigest: null,
  });
  if (!evaluated.ok) return invalid(`EVALUATOR:${evaluated.reason ?? evaluated.code}`);
  if (canonicalJsonSchedulingV1(evaluated.report)
    !== canonicalJsonSchedulingV1(value.expected.report)) {
    return invalid('REPORT_MISMATCH');
  }

  return Object.freeze({
    ok: true,
    fixtureId: value.fixtureId,
    datasetDigest: manifest.datasetDigest,
    caseClassifications: classifications,
    report: evaluated.report,
  });
}
