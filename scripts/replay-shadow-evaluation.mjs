import { readFile } from 'node:fs/promises';

import { replayShadowEvaluationFixtureJsonV1 } from '../src/shadow-evaluation-fixture-replay-v1.mjs';

const fixtureUrl = new URL(
  '../fixtures/shadow-evaluation-v1/synthetic-level-a-b.v1.json',
  import.meta.url,
);

let text;
try {
  text = await readFile(fixtureUrl, 'utf8');
} catch {
  process.stderr.write('SHADOW_FIXTURE_READ_FAILED\n');
  process.exitCode = 1;
}

if (text !== undefined) {
  const replay = replayShadowEvaluationFixtureJsonV1(text);
  if (!replay.ok) {
    process.stderr.write(`${replay.code}:${replay.reason}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({
      fixtureId: replay.fixtureId,
      datasetDigest: replay.datasetDigest,
      caseClassifications: replay.caseClassifications,
      report: replay.report,
    }, null, 2)}\n`);
  }
}
