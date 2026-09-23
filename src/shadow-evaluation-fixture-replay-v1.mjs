import {
  buildShadowDatasetManifestV1,
  classifySchedulingSampleV1,
  evaluateShadowMetricsV1,
} from './scheduling-evaluation-contract-v1.mjs';
import { canonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

const FIXTURE_KEYS = Object.freeze(['schemaVersion', 'fixtureId', 'reportInput', 'expected']);
const EXPECTED_KEYS = Object.freeze(['datasetDigest', 'caseClassifications', 'report']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function ownDataRecord(value, expected) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length
      || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
      return null;
    }
    const snapshot = {};
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function deepOwnDataSnapshot(value, ancestors = new WeakSet()) {
  try {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return { ok: true, value };
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? { ok: true, value } : { ok: false };
    }
    if (typeof value !== 'object' || ancestors.has(value)) return { ok: false };

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) return { ok: false };
        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
        if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
          || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          return { ok: false };
        }
        const length = lengthDescriptor.value;
        const keys = Reflect.ownKeys(value);
        if (keys.some(key => typeof key !== 'string')
          || keys.length !== length + 1
          || !keys.includes('length')) {
          return { ok: false };
        }
        const snapshot = [];
        for (let index = 0; index < length; index += 1) {
          const key = String(index);
          if (!keys.includes(key)) return { ok: false };
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) return { ok: false };
          const nested = deepOwnDataSnapshot(descriptor.value, ancestors);
          if (!nested.ok) return nested;
          snapshot.push(nested.value);
        }
        return { ok: true, value: Object.freeze(snapshot) };
      }

      if (Object.getPrototypeOf(value) !== Object.prototype) return { ok: false };
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => typeof key !== 'string' || UNSAFE_KEYS.has(key))) {
        return { ok: false };
      }
      const snapshot = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) return { ok: false };
        const nested = deepOwnDataSnapshot(descriptor.value, ancestors);
        if (!nested.ok) return nested;
        Object.defineProperty(snapshot, key, {
          value: nested.value,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      return { ok: true, value: Object.freeze(snapshot) };
    } finally {
      ancestors.delete(value);
    }
  } catch {
    return { ok: false };
  }
}

function invalid(reason) {
  return Object.freeze({ ok: false, code: 'SHADOW_FIXTURE_REPLAY_INVALID', reason });
}

export function replayShadowEvaluationFixtureV1(value) {
  try {
    const fixture = ownDataRecord(value, FIXTURE_KEYS);
    if (!fixture || fixture.schemaVersion !== 1
      || typeof fixture.fixtureId !== 'string' || fixture.fixtureId.length === 0) {
      return invalid('FIXTURE_ENVELOPE_INVALID');
    }
    const expected = ownDataRecord(fixture.expected, EXPECTED_KEYS);
    if (!expected) return invalid('FIXTURE_ENVELOPE_INVALID');

    const reportInputSnapshot = deepOwnDataSnapshot(fixture.reportInput);
    const classificationSnapshot = deepOwnDataSnapshot(expected.caseClassifications);
    const reportSnapshot = deepOwnDataSnapshot(expected.report);
    if (!reportInputSnapshot.ok || !classificationSnapshot.ok || !reportSnapshot.ok) {
      return invalid('FIXTURE_ENVELOPE_INVALID');
    }

    const reportInput = reportInputSnapshot.value;
    const fixtureId = fixture.fixtureId;
    const datasetDigest = expected.datasetDigest;
    const expectedClassifications = classificationSnapshot.value;
    const expectedReport = reportSnapshot.value;

    const manifest = buildShadowDatasetManifestV1(
      reportInput?.manifest,
      { expectedApprovalDigest: null },
    );
    if (!manifest.ok) return invalid(`MANIFEST:${manifest.reason ?? manifest.code}`);
    if (manifest.datasetDigest !== datasetDigest) {
      return invalid('DATASET_DIGEST_MISMATCH');
    }

    const classifications = [];
    for (const item of manifest.manifest.cases) {
      const classified = classifySchedulingSampleV1(item.qualification);
      if (!classified.ok) return invalid(`CLASSIFIER:${classified.reason ?? classified.code}`);
      classifications.push(classified.classification);
    }
    if (canonicalJsonSchedulingV1(classifications)
      !== canonicalJsonSchedulingV1(expectedClassifications)) {
      return invalid('CLASSIFICATION_MISMATCH');
    }

    const evaluated = evaluateShadowMetricsV1(reportInput, {
      replayHardConstraints: null,
      evaluatePriorityPair: null,
      expectedApprovalDigest: null,
    });
    if (!evaluated.ok) return invalid(`EVALUATOR:${evaluated.reason ?? evaluated.code}`);
    if (canonicalJsonSchedulingV1(evaluated.report)
      !== canonicalJsonSchedulingV1(expectedReport)) {
      return invalid('REPORT_MISMATCH');
    }

    return Object.freeze({
      ok: true,
      fixtureId,
      datasetDigest: manifest.datasetDigest,
      caseClassifications: classifications,
      report: evaluated.report,
    });
  } catch {
    return invalid('FIXTURE_ENVELOPE_INVALID');
  }
}


export function replayShadowEvaluationFixtureJsonV1(text) {
  if (typeof text !== 'string') return invalid('FIXTURE_JSON_INVALID');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid('FIXTURE_JSON_INVALID');
  }
  return replayShadowEvaluationFixtureV1(value);
}
