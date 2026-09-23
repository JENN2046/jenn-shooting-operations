import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitLowDisclosureShadowReportV1,
} from '../src/shadow-low-disclosure-report-v1.mjs';
import {
  replayShadowEvaluationFixtureJsonV1,
} from '../src/shadow-evaluation-fixture-replay-v1.mjs';
import {
  digestCanonicalJsonSchedulingV1,
} from '../src/scheduling-contract-v1.mjs';

const fixtureUrl = new URL(
  '../fixtures/shadow-evaluation-v1/synthetic-level-a-b.v1.json',
  import.meta.url,
);


function recomputeResultDigest(report) {
  const {
    generatedAt: _generatedAt,
    resultDigest: _resultDigest,
    ...body
  } = report;
  return digestCanonicalJsonSchedulingV1({
    domain: 'shadow-report-v1',
    report: body,
  });
}

async function replayReport() {
  const replay = replayShadowEvaluationFixtureJsonV1(await readFile(fixtureUrl, 'utf8'));
  assert.equal(replay.ok, true, JSON.stringify(replay));
  return replay.report;
}

test('fixture report closes through exact low-disclosure admission', async () => {
  const report = await replayReport();
  const admitted = admitLowDisclosureShadowReportV1(report);
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.deepEqual(admitted.report, report);
  assert.equal(admitted.resultDigest, report.resultDigest);
  assert.equal(admitted.report.gateStatus, 'BLOCKED_DATA');
  assert.equal(admitted.report.eligibilityCounts.levelC, 0);

  const serialized = admitted.reportJson;
  for (const forbidden of [
    'sampleId', 'requestId', 'scheduleItemId', 'runId', 'client', 'requestedBy',
    'brief', 'note', 'rawEvents', 'provider', 'attachment', 'deviceId', 'actorId',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('generatedAt is normalized but remains outside the report fact digest', async () => {
  const report = await replayReport();
  const changed = structuredClone(report);
  changed.generatedAt = '2026-10-04T08:00:00+08:00';
  const admitted = admitLowDisclosureShadowReportV1(changed);
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.equal(admitted.report.generatedAt, '2026-10-04T00:00:00.000Z');
  assert.equal(admitted.resultDigest, report.resultDigest);
});

test('low-disclosure admission rejects root and nested disclosure widening', async () => {
  const report = await replayReport();

  const rootExtra = { ...report, sampleId: 'CASE-B' };
  assert.deepEqual(admitLowDisclosureShadowReportV1(rootExtra), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_SHAPE_INVALID',
  });

  const nestedExtra = structuredClone(report);
  nestedExtra.metrics.medianAbsoluteDurationErrorMs.rawEvents = [];
  assert.deepEqual(admitLowDisclosureShadowReportV1(nestedExtra), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });

  const eligibilityExtra = structuredClone(report);
  eligibilityExtra.eligibilityCounts.requestIds = ['REQUEST-B'];
  assert.deepEqual(admitLowDisclosureShadowReportV1(eligibilityExtra), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });
});

test('low-disclosure admission rejects fake zero-success and digest drift', async () => {
  const report = await replayReport();

  const fakeZero = structuredClone(report);
  fakeZero.metrics.medianAbsoluteDurationErrorMs.value = 0;
  assert.deepEqual(admitLowDisclosureShadowReportV1(fakeZero), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });

  const wrongDigest = structuredClone(report);
  wrongDigest.resultDigest = `sha256:${'0'.repeat(64)}`;
  assert.deepEqual(admitLowDisclosureShadowReportV1(wrongDigest), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_DIGEST_MISMATCH',
  });
});

test('low-disclosure admission rejects unstable exclusion structures', async () => {
  const report = await replayReport();

  const unknown = structuredClone(report);
  unknown.exclusionCounts[0].code = 'RAW_EVENT_MISSING';
  assert.deepEqual(admitLowDisclosureShadowReportV1(unknown), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });

  const tooLarge = structuredClone(report);
  tooLarge.exclusionCounts[0].count = report.eligibilityCounts.total + 1;
  assert.deepEqual(admitLowDisclosureShadowReportV1(tooLarge), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });

  const reversed = structuredClone(report);
  reversed.exclusionCounts.reverse();
  assert.deepEqual(admitLowDisclosureShadowReportV1(reversed), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });
});


test('eligibility counts constrain which metrics may be OK even with a recomputed digest', async () => {
  const report = await replayReport();

  const fakeLevelC = structuredClone(report);
  fakeLevelC.metrics.medianAbsoluteDurationErrorMs = {
    status: 'OK',
    value: 100,
    numerator: null,
    denominator: 1,
  };
  fakeLevelC.resultDigest = recomputeResultDigest(fakeLevelC);
  assert.deepEqual(admitLowDisclosureShadowReportV1(fakeLevelC), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });

  const noLevelB = structuredClone(report);
  noLevelB.eligibilityCounts.levelB = 0;
  noLevelB.metrics.retrospectiveDurationBaselineMedianAbsoluteErrorMs = {
    status: 'OK',
    value: 100,
    numerator: null,
    denominator: 1,
  };
  noLevelB.metrics.retrospectiveDurationBaselineP90OverrunMs = {
    status: 'OK',
    value: 100,
    numerator: null,
    denominator: 1,
  };
  noLevelB.resultDigest = recomputeResultDigest(noLevelB);
  assert.deepEqual(admitLowDisclosureShadowReportV1(noLevelB), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });
});

test('metric-specific count and rate semantics reject impossible OK values', async () => {
  const report = await replayReport();

  const badRate = structuredClone(report);
  badRate.eligibilityCounts.levelC = 1;
  badRate.metrics.setupBufferMissRate = {
    status: 'OK',
    value: 0.4,
    numerator: 1,
    denominator: 2,
  };
  badRate.resultDigest = recomputeResultDigest(badRate);
  assert.deepEqual(admitLowDisclosureShadowReportV1(badRate), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });

  const badCount = structuredClone(report);
  badCount.eligibilityCounts.levelC = 1;
  badCount.metrics.hardConflictCount = {
    status: 'OK',
    value: 2,
    numerator: 1,
    denominator: 1,
  };
  badCount.resultDigest = recomputeResultDigest(badCount);
  assert.deepEqual(admitLowDisclosureShadowReportV1(badCount), {
    ok: false,
    code: 'LOW_DISCLOSURE_SHADOW_REPORT_INVALID',
    reason: 'REPORT_CONTENT_INVALID',
  });
});
