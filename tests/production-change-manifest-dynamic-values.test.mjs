import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(readFileSync(
  new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8',
));
const base = JSON.parse(readFileSync(
  new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8',
));
// Input Boundary V1 intentionally rejects inline credential values at every length.
// Retain these historical fixtures; authorizer assertions still describe runtime only.
const validate = createProductionChangeManifestValidator(schema);
const tokenKeys = ['access_token', 'VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN'];

function detectsSecret(text) {
  const value = structuredClone(base);
  value.gates[0].evidence = text;
  const result = validate(value);
  assert.equal(result.issues.some(issue => issue.code === 'SCHEMA_INVALID'), false);
  return result.issues.some(issue => issue.code === 'SECRET_MATERIAL_DETECTED');
}

test('role assignments reject active shell substitutions before word termination', () => {
  // Synthetic strings only: never execute shell text or resolve substitutions.
  const values = [
    '$(printf abcdefghijklmnop)',
    '$(printf "$(printf abcdefghijklmnop)")',
    '$(printf\nabcdefghijklmnop)',
    '"$(printf abcdefghijklmnop)"',
    'abc"$(printf abcdefghijklmnop)"',
    "'abc'$(printf abcdefghijklmnop)",
    '`printf abcdefghijklmnop`',
    '"`printf abcdefghijklmnop`"',
    '${VALUE}', '$VALUE', '$((1 + 2))', '$[1 + 2]',
    "$'abcdefghijklmnop'", '$"abcdefghijklmnop"',
    '$' + '\\' + '\n' + '(printf abcdefghijklmnop)',
    'abc' + '\\' + '\n' + '$(printf abcdefghijklmnop)',
  ];
  for (const key of tokenKeys) {
    for (const rhs of values) assert.equal(detectsSecret(`${key}=${rhs}`), true);
  }
});

test('reference-only boundary rejects short literal quoting as well as dynamic credential values', () => {
  for (const key of tokenKeys) {
    for (const rhs of [
      "'$(x)'", "'`x`'", "'${x}'", "'$x'", '\\$x',
      '"\\$x"', '"\\`x\\`"', 'abc\\$x',
      "'$'x", "'ab'cd", '"ab"cd',
    ]) assert.equal(detectsSecret(`${key}=${rhs}`), true);

    assert.equal(detectsSecret(`${key}='$(printf abcdefghijklmnop)'`), true,
      'all inline credential values are outside the declarative input boundary');
    assert.equal(detectsSecret(`${key}=\\$abcdefghijklmnop`), true,
      'escaping a dollar does not exempt a long literal credential');
    assert.equal(detectsSecret(`${key}=abcdefgh\n$(printf abcdefghijklmnop)`), true,
      'the entire unsupported snippet is rejected, not only the first assignment');
  }
});

test('reference-only boundary rejects all retained length and continuation variants', () => {
  const continuation = '\\' + '\n';
  for (const key of tokenKeys) {
    for (const value of ['abcdefghijklmnop', 'abcdefghijklmno', '😀'.repeat(8), '😀'.repeat(7) + 'a']) {
      assert.equal(detectsSecret(`${key}=${value}`), true);
      assert.equal(detectsSecret(`${key}="${value}"`), true);
      assert.equal(detectsSecret(`${key}='${value}'`), true);
      assert.equal(detectsSecret(`${key}=${value.slice(0, 8)}${continuation}${value.slice(8)}`), true);
    }
  }
});

test('YAML token block scalars fail closed including modifiers and quoted keys', () => {
  for (const key of tokenKeys) {
    for (const writtenKey of [key, `"${key}"`, `'${key}'`, key.toLowerCase()]) {
      for (const header of ['|', '|-', '|+', '|2', '|2-', '|-2', '>', '>-', '>+', '>2', '>+2', '>2+']) {
        for (const newline of ['\n', '\r\n']) {
          assert.equal(detectsSecret(`${writtenKey}: ${header}${newline}  abcdefghijklmnop`), true);
          assert.equal(detectsSecret(`${writtenKey}: ${header} # synthetic${newline}  abcdefghijklmnop`), true);
          assert.equal(detectsSecret(`${writtenKey}: ${header}${newline}  short`), true,
            'unsupported scalar syntax is rejected independently of apparent length');
        }
      }
    }
  }
});

test('YAML tags anchors and aliases cannot hide an unsupported token scalar', () => {
  for (const key of tokenKeys) {
    for (const rhs of ['!!str |\n  abcdefghijklmnop', '&value >-\n  abcdefghijklmnop', '!tag &value |2\n  abcdefghijklmnop', '*value']) {
      assert.equal(detectsSecret(`${key}: ${rhs}`), true);
    }
  }
});

test('reference-only boundary no longer admits short ordinary credential config literals', () => {
  for (const key of tokenKeys) {
    for (const rhs of ['short', '"short"', "'short'", '"|"', "'>-'", '"&value"', "'*value'", '"$(x)"']) {
      assert.equal(detectsSecret(`${key}: ${rhs}`), true);
    }
    assert.equal(detectsSecret(`${key}: "${'😀'.repeat(8)}"`), true);
  }
});
