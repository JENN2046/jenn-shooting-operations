import { readFile } from 'node:fs/promises';

import {
  replayShadowEvaluationFixtureJsonV1,
} from '../src/shadow-evaluation-fixture-replay-v1.mjs';
import {
  admitLowDisclosureShadowReportV1,
} from '../src/shadow-low-disclosure-report-v1.mjs';

const fixtureUrl = new URL(
  '../fixtures/shadow-evaluation-v1/synthetic-level-a-b.v1.json',
  import.meta.url,
);

let text;
try {
  text = await readFile(fixtureUrl, 'utf8');
} catch {
  process.stderr.write('SHADOW_REPORT_FIXTURE_READ_FAILED\n');
  process.exitCode = 1;
}

if (text !== undefined) {
  const replay = replayShadowEvaluationFixtureJsonV1(text);
  if (!replay.ok) {
    process.stderr.write(`${replay.code}:${replay.reason}\n`);
    process.exitCode = 1;
  } else {
    const admitted = admitLowDisclosureShadowReportV1(replay.report);
    if (!admitted.ok) {
      process.stderr.write(`${admitted.code}:${admitted.reason}\n`);
      process.exitCode = 1;
    } else if (process.argv.includes('--check')) {
      process.stdout.write(`PASS low-disclosure shadow report ${admitted.resultDigest}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(admitted.report, null, 2)}\n`);
    }
  }
}
