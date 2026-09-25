import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAuthorizer } from '../src/auth.mjs';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(
  new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8',
));
const base = JSON.parse(readFileSync(
  new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8',
));
const validate = createProductionChangeManifestValidator(schema);

function detectsSecret(text) {
  const candidate = structuredClone(base);
  candidate.gates[0].evidence = text;
  const result = validate(candidate);
  assert.equal(result.issues.some(issue => issue.code === 'SCHEMA_INVALID'), false);
  return result.issues.some(issue => issue.code === 'SECRET_MATERIAL_DETECTED');
}

test('shell continuations join credential segments before UTF-16 threshold checks', () => {
  // Synthetic strings only. No shell execution, configured secret, or network.
  const continuation = '\\' + '\n';
  const formats = [
    (left, right) => `ADMIN_TOKEN=${left}${continuation}${right}`,
    (left, right) => `VIEWER_TOKEN="${left}${continuation}${right}"`,
    (left, right) => `SUBMITTER_TOKEN=${left}"${continuation}${right}"`,
    (left, right) => `SCHEDULER_TOKEN=${left}${continuation}${continuation}${right}`,
    (left, right) => `access_token="${left}"${continuation}'${right}'`,
  ];
  for (const value of [
    'abcdefghijklmnop',
    'abcdefghijklmno',
    '\u{1F600}'.repeat(8),
    '\u{1F600}'.repeat(7) + 'a',
  ]) {
    const authorize = createAuthorizer({ administrator: value });
    const accepted = authorize(
      { headers: { authorization: `Bearer ${value}` } }, 'administrator',
    ).allowed;
    assert.equal(accepted, value.length >= 16);
    for (const format of formats) {
      assert.equal(detectsSecret(format(value.slice(0, 8), value.slice(8))), accepted,
        `continued assignment with ${value.length} UTF-16 units`);
    }
  }
});

test('shell newline and quote handling distinguishes continuations from literal value bytes', () => {
  assert.equal(detectsSecret('ADMIN_TOKEN=abcdefgh\nijklmnop'), false,
    'an ordinary newline ends an unquoted assignment');
  assert.equal(detectsSecret('ADMIN_TOKEN=abcdefgh' + '\\\\' + '\nijklmnop'), false,
    'an escaped backslash does not escape the following newline');
  assert.equal(detectsSecret('ADMIN_TOKEN="abcdefgh\nijklmnop"'), true,
    'an unescaped newline inside quotes is part of the value');
  assert.equal(detectsSecret("VIEWER_TOKEN='abcdefgh" + '\\' + "\nijklmnop'"), true,
    'single quotes retain both the backslash and newline');
  assert.equal(detectsSecret('SUBMITTER_TOKEN="abcdefgh' + '\\' + 'ijklmno"'), true,
    'double quotes preserve a backslash before a non-special character');
});
