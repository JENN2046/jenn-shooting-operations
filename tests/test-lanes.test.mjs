import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverTests, loadTestLanes, validateTestLanes } from '../scripts/test-lanes.mjs';

const entry = (file = 'sample.test.mjs') => ({
  file, lanes: ['current', 'compat', 'historical'], invariant: 'Synthetic guard fixture, not a product test.',
});
const manifest = () => ({ schemaVersion: 1, auditCommit: 'a'.repeat(40), tests: [entry()] });

test('repository manifest covers the full test glob; overlaps are explicit and selections contain no duplicate files', async () => {
  const lanes = await loadTestLanes();
  const actual = await discoverTests();
  assert.deepEqual([...new Set(Object.values(lanes).flat())].sort(), actual);
  for (const files of Object.values(lanes)) assert.equal(files.length, new Set(files).size);
  assert.deepEqual(validateTestLanes(manifest(), ['sample.test.mjs']), {
    current: ['sample.test.mjs'], compat: ['sample.test.mjs'], historical: ['sample.test.mjs'],
  });
});

test('new tests and removed/renamed tests fail completeness before any lane runs', () => {
  assert.throws(() => validateTestLanes(manifest(), ['sample.test.mjs', 'new.test.mjs']), /unclassified tests: new/);
  assert.throws(() => validateTestLanes(manifest(), ['renamed.test.mjs']), /classified test does not exist/);
  const duplicate = manifest(); duplicate.tests.push(entry());
  assert.throws(() => validateTestLanes(duplicate, ['sample.test.mjs']), /duplicate classification/);
});

test('invalid paths, empty/unknown/duplicate lanes and missing invariant explanations cannot silently change selection', () => {
  for (const mutate of [
    m => { m.tests[0].file = '../sample.test.mjs'; },
    m => { m.tests[0].file = 'support/sample.test.mjs'; },
    m => { m.tests[0].lanes = []; },
    m => { m.tests[0].lanes = ['currnet']; },
    m => { m.tests[0].lanes = ['current', 'current']; },
    m => { m.tests[0].lanes = ['current']; }, // No silently empty compat/historical lane.
    m => { m.tests[0].invariant = ' '; },
    m => { m.tests[0].exclude = true; },
    m => { m.schemaVersion = 2; },
    m => { m.auditCommit = 'main'; },
    m => { m.auditCommit = ['a'.repeat(40)]; },
    m => { m.tests = []; },
  ]) {
    const value = manifest(); mutate(value);
    assert.throws(() => validateTestLanes(value, ['sample.test.mjs']), /TEST_LANES/);
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jso-test-lanes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'tests'));
  await copyFile(new URL('../scripts/test-lanes.mjs', import.meta.url), join(root, 'scripts/test-lanes.mjs'));
  await writeFile(join(root, 'tests/test-lanes.json'), JSON.stringify(manifest()));
  await writeFile(join(root, 'tests/sample.test.mjs'), "import test from 'node:test'; test.skip('external integration unavailable',()=>{});\n");
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const cli = (...args) => spawnSync(process.execPath, ['scripts/test-lanes.mjs', ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 20000,
  });
  return { root, cli };
}

test('CLI reports skipped tests honestly, lists exact paths, and propagates child test failures', async t => {
  const { root, cli } = await fixture(t);
  const listed = cli('--list', 'current');
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).files, ['sample.test.mjs']);
  const skipped = cli('historical');
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /(?:skipped 1|skip 1)/);
  await writeFile(join(root, 'tests/sample.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('must fail',()=>assert.fail('intentional fixture failure'));\n");
  const failed = cli('current');
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /intentional fixture failure/);
});

test('CLI fails closed on unclassified and nested files, symlinks, malformed JSON and unsupported arguments', async t => {
  const { root, cli } = await fixture(t);
  await writeFile(join(root, 'tests/new.test.mjs'), 'throw Error("must not run");');
  const missing = cli('current');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /unclassified tests/);
  assert.doesNotMatch(missing.stdout, /must not run/);
  await rm(join(root, 'tests/new.test.mjs'));
  await mkdir(join(root, 'tests/nested'));
  await writeFile(join(root, 'tests/nested/new.test.mjs'), '');
  assert.match(cli('--check').stderr, /test outside full npm test glob/);
  await rm(join(root, 'tests/nested'), { recursive: true });
  await symlink(join(root, 'tests/sample.test.mjs'), join(root, 'tests/link.test.mjs'));
  assert.match(cli('--check').stderr, /symlink in tests/);
  await rm(join(root, 'tests/link.test.mjs'));
  await writeFile(join(root, 'tests/test-lanes.json'), '{');
  assert.equal(cli('--check').status, 1);
  assert.match(cli('current', '--test-name-pattern=none').stderr, /usage:/);
  assert.match(cli('--list', 'currnet').stderr, /usage:/);
});
