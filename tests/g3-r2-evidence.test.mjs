import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('R2 preparation contract references match actual bytes without changing R1', () => {
  const result = JSON.parse(execFileSync('python3', [new URL('scripts/validate-g3-r2-preparation.py', root).pathname], { encoding: 'utf8' }));
  assert.equal(result.status, 'R2_PREPARATION_CONTRACTS_VALID_NOT_EXECUTABLE_AUTHORITY');
  assert.equal(sha(read('scripts/g3-forward-adoption-readonly-witness.py')), '95ca51db7174eaffc8ce9cee8f85f0440ec1253fb8a2e00dc89b42649775ccfc');
  assert.equal(sha(read('scripts/verify-g3-forward-adoption-witness-signature.mjs')), '5ec8892c4f1b1c14a43ff204d483b3b8ccadfb74b737829ec88ed4097ebc91cb');
  assert.equal(sha(read('docs/operations/G3_05_RESTRICTED_RECOVERY_REFERENCE_METHOD_R2.md')), 'e1acba51102404d87e756b0e6a502c6a9cd92bbe4a2136c0f6d8c41b19b6ffd0');
});

test('R2 strict acceptance, bounded I/O and durable replay tests', () => {
  execFileSync('python3', ['-m', 'unittest', 'discover', '-s', new URL('tests/', root).pathname,
    '-p', 'test_g3_r2_evidence.py', '-v'], { timeout: 60000, stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
});
