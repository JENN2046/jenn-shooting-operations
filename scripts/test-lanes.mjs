import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_LANES = Object.freeze(['current', 'compat', 'historical']);
const fail = message => { throw new Error(`TEST_LANES: ${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// The full npm test entry intentionally still uses tests/*.test.mjs. Reject nested
// tests as well as missing classifications so a new test cannot escape that gate.
export async function discoverTests(root = ROOT) {
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) fail(`symlink in tests/: ${relative}`);
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative + '/');
      else if (entry.name.endsWith('.test.mjs')) {
        if (!entry.isFile() || prefix) fail(`test outside full npm test glob: ${relative}`);
        files.push(relative);
      }
    }
  }
  await walk(join(root, 'tests'));
  return files.sort();
}

export function validateTestLanes(manifest, discovered) {
  if (!exactKeys(manifest, ['schemaVersion', 'auditCommit', 'tests'])
      || manifest.schemaVersion !== 1 || typeof manifest.auditCommit !== 'string'
      || !/^[a-f0-9]{40}$/.test(manifest.auditCommit)
      || !Array.isArray(manifest.tests) || manifest.tests.length === 0) fail('invalid manifest header');
  const actual = new Set(discovered);
  if (actual.size !== discovered.length) fail('duplicate discovered test');
  const seen = new Set();
  const lanes = Object.fromEntries(TEST_LANES.map(lane => [lane, []]));
  for (const entry of manifest.tests) {
    if (!exactKeys(entry, ['file', 'lanes', 'invariant'])
        || typeof entry.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.test\.mjs$/.test(entry.file)
        || typeof entry.invariant !== 'string' || !entry.invariant.trim()) fail('invalid test entry');
    if (seen.has(entry.file)) fail(`duplicate classification: ${entry.file}`);
    seen.add(entry.file);
    if (!actual.has(entry.file)) fail(`classified test does not exist: ${entry.file}`);
    if (!Array.isArray(entry.lanes) || entry.lanes.length === 0
        || new Set(entry.lanes).size !== entry.lanes.length
        || entry.lanes.some(lane => !TEST_LANES.includes(lane))) fail(`invalid lanes: ${entry.file}`);
    for (const lane of entry.lanes) lanes[lane].push(entry.file);
  }
  const missing = discovered.filter(file => !seen.has(file));
  if (missing.length) fail(`unclassified tests: ${missing.join(', ')}`);
  for (const lane of TEST_LANES) {
    if (!lanes[lane].length) fail(`empty lane: ${lane}`);
    lanes[lane].sort();
  }
  return lanes;
}

export async function loadTestLanes(root = ROOT) {
  const manifest = JSON.parse(await readFile(join(root, 'tests/test-lanes.json'), 'utf8'));
  return validateTestLanes(manifest, await discoverTests(root));
}

async function main(args) {
  const list = args.length === 2 && args[0] === '--list' && TEST_LANES.includes(args[1]);
  const check = args.length === 1 && args[0] === '--check';
  const run = args.length === 1 && TEST_LANES.includes(args[0]);
  if (!list && !check && !run) fail('usage: test-lanes.mjs --check | --list <lane> | <lane>');
  const lanes = await loadTestLanes(); // Always check completeness before selecting a subset.
  if (check) {
    console.log(`TEST_LANES complete: ${JSON.stringify(Object.fromEntries(
      TEST_LANES.map(lane => [lane, lanes[lane].length])))}`);
    return;
  }
  const lane = list ? args[1] : args[0];
  if (list) {
    console.log(JSON.stringify({ lane, files: lanes[lane] }, null, 2));
    return;
  }
  console.log(`TEST_LANES ${lane}: ${lanes[lane].length} files (whole-file selection; shared files may overlap)`);
  const started = performance.now();
  const child = spawn(process.execPath, ['--test', ...lanes[lane].map(file => `tests/${file}`)], {
    cwd: ROOT, stdio: 'inherit',
  });
  const forward = signal => child.kill(signal);
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('close', (code, signal) => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    console.log(`TEST_LANES ${lane}: elapsed=${((performance.now() - started) / 1000).toFixed(3)}s`);
    if (signal) console.error(`TEST_LANES ${lane}: terminated by ${signal}`);
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
