import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  replayShadowEvaluationFixtureJsonV1,
  replayShadowEvaluationFixtureV1,
} from '../src/shadow-evaluation-fixture-replay-v1.mjs';

const fixtureUrl = new URL(
  '../fixtures/shadow-evaluation-v1/synthetic-level-a-b.v1.json',
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('checked-in synthetic fixture replays deterministically with no Level C promotion', async () => {
  const value = await fixture();
  const replay = replayShadowEvaluationFixtureV1(value);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.datasetDigest, value.expected.datasetDigest);
  assert.deepEqual(replay.caseClassifications, value.expected.caseClassifications);
  assert.deepEqual(replay.report, value.expected.report);
  assert.equal(replay.report.gateStatus, 'BLOCKED_DATA');
  assert.equal(replay.report.datasetClass, 'synthetic');
  assert.equal(replay.report.eligibilityCounts.total, 2);
  assert.equal(replay.report.eligibilityCounts.levelA, 2);
  assert.equal(replay.report.eligibilityCounts.levelB, 1);
  assert.equal(replay.report.eligibilityCounts.levelC, 0);

  for (const metricName of [
    'medianAbsoluteDurationErrorMs',
    'p90OverrunMs',
    'setupBufferMissRate',
    'hardConflictCount',
    'humanOverrideRate',
    'priorityViolationCount',
  ]) {
    assert.deepEqual(replay.report.metrics[metricName], {
      status: 'NOT_ENOUGH_DATA',
      value: null,
      numerator: null,
      denominator: 0,
    }, metricName);
  }
  assert.deepEqual(
    replay.report.metrics.retrospectiveDurationBaselineMedianAbsoluteErrorMs,
    { status: 'OK', value: 100, numerator: null, denominator: 1 },
  );
  assert.deepEqual(
    replay.report.metrics.retrospectiveDurationBaselineP90OverrunMs,
    { status: 'OK', value: 100, numerator: null, denominator: 1 },
  );
});

test('fixture replay fails closed on dataset digest or expected-report tampering', async () => {
  const value = await fixture();

  const wrongDigest = structuredClone(value);
  wrongDigest.expected.datasetDigest = `sha256:${'0'.repeat(64)}`;
  assert.deepEqual(replayShadowEvaluationFixtureV1(wrongDigest), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'DATASET_DIGEST_MISMATCH',
  });

  const wrongReport = structuredClone(value);
  wrongReport.expected.report.gateStatus = 'PASS';
  assert.deepEqual(replayShadowEvaluationFixtureV1(wrongReport), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'REPORT_MISMATCH',
  });
});

test('fixture envelope rejects extra keys and keeps raw evidence out of replay output', async () => {
  const value = await fixture();
  const extra = { ...value, productionDatabasePath: '/secret/db.sqlite' };
  assert.deepEqual(replayShadowEvaluationFixtureV1(extra), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_ENVELOPE_INVALID',
  });

  const replay = replayShadowEvaluationFixtureV1(value);
  assert.equal(replay.ok, true);
  const serialized = JSON.stringify(replay);
  for (const forbidden of ['client', 'requestedBy', 'briefUrl', 'note', 'attachment', 'provider']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});


test('JSON fixture replay rejects falsy valid JSON instead of silently succeeding', () => {
  for (const text of ['null', 'false', '0', '""']) {
    assert.deepEqual(replayShadowEvaluationFixtureJsonV1(text), {
      ok: false,
      code: 'SHADOW_FIXTURE_REPLAY_INVALID',
      reason: 'FIXTURE_ENVELOPE_INVALID',
    }, text);
  }
  assert.deepEqual(replayShadowEvaluationFixtureJsonV1('{'), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_JSON_INVALID',
  });
});

test('fixture envelope rejects accessors, symbols, non-enumerables and hostile proxies', async () => {
  const value = await fixture();

  let getterReads = 0;
  const accessor = { ...value };
  Object.defineProperty(accessor, 'fixtureId', {
    enumerable: true,
    get() {
      getterReads += 1;
      return value.fixtureId;
    },
  });
  assert.deepEqual(replayShadowEvaluationFixtureV1(accessor), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_ENVELOPE_INVALID',
  });
  assert.equal(getterReads, 0);

  const symbol = { ...value };
  symbol[Symbol('hidden')] = true;
  assert.deepEqual(replayShadowEvaluationFixtureV1(symbol), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_ENVELOPE_INVALID',
  });

  const nonEnumerable = { ...value };
  Object.defineProperty(nonEnumerable, 'hidden', {
    enumerable: false,
    value: true,
  });
  assert.deepEqual(replayShadowEvaluationFixtureV1(nonEnumerable), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_ENVELOPE_INVALID',
  });

  const expectedAccessor = { ...value, expected: { ...value.expected } };
  Object.defineProperty(expectedAccessor.expected, 'report', {
    enumerable: true,
    get() {
      throw new Error('should not be invoked');
    },
  });
  assert.deepEqual(replayShadowEvaluationFixtureV1(expectedAccessor), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_ENVELOPE_INVALID',
  });

  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('hostile');
    },
  });
  assert.deepEqual(replayShadowEvaluationFixtureV1(hostile), {
    ok: false,
    code: 'SHADOW_FIXTURE_REPLAY_INVALID',
    reason: 'FIXTURE_ENVELOPE_INVALID',
  });
});
