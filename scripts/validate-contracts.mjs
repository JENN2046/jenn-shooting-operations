import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateSnapshot } from '../src/contract-validator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

for (const file of [
  'contracts/schedule-snapshot.schema.json',
  'contracts/request-submission.schema.json',
]) {
  JSON.parse(await readFile(join(root, file), 'utf8'));
}

const fixture = JSON.parse(await readFile(join(root, 'fixtures/schedule-snapshot.v1.json'), 'utf8'));
assert.deepEqual(validateSnapshot(fixture), []);

const invalid = structuredClone(fixture);
invalid.tasks.push({ ...invalid.tasks[0] });
assert.ok(validateSnapshot(invalid).some(error => error.includes('duplicated')));

console.log('PASS contracts parse, fixture validates, duplicate task fails closed');
