import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitLowDisclosureShadowReportV1,
} from '../src/shadow-low-disclosure-report-v1.mjs';
import {
  replayShadowEvaluationFixtureJsonV1,
} from '../src/shadow-evaluation-fixture-replay-v1.mjs';

const fixtureUrl = new URL(
  '../fixtures/shadow-evaluation-v1/synthetic-level-a-b.v1.json',
  import.meta.url,
);

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
