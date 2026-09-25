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
const keys = ['access_token', 'VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN'];

function detectsSecret(text) {
  const candidate = structuredClone(base);
  candidate.gates[0].evidence = text;
  const result = validate(candidate);
  assert.equal(result.issues.some(issue => issue.code === 'SCHEMA_INVALID'), false);
  return result.issues.some(issue => issue.code === 'SECRET_MATERIAL_DETECTED');
}

// All values are synthetic in-memory fixtures. No shell or provider is invoked.
function authorizerAccepts(value) {
  const authorize = createAuthorizer({ administrator: value });
  return authorize({ headers: { authorization: `Bearer ${value}` } }, 'administrator').allowed;
}

function yamlSingleQuoted(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

test('YAML doubled apostrophes count as scalar content at the authorizer threshold', () => {
  for (const key of keys) {
    for (const count of [9, 10, 11]) {
      const value = 'abc' + "'".repeat(count) + 'def';
      assert.equal(value.length, 6 + count);
      const accepted = authorizerAccepts(value);
      assert.equal(accepted, count >= 10);
      for (const spelling of [key, `"${key}"`, `'${key.toLowerCase()}'`]) {
        assert.equal(detectsSecret(`${spelling}: ${yamlSingleQuoted(value)}`), accepted,
          `${key}, ${count} doubled pairs`);
      }
    }
  }
});

test('YAML quote pairs preserve leading trailing repeated and astral scalar units', () => {
  const values = [
    "'".repeat(15), "'".repeat(16),
    "'" + 'a'.repeat(14), "'" + 'a'.repeat(15),
    'a'.repeat(14) + "'", 'a'.repeat(15) + "'",
    "a'b'c'd'e'f'g'h", "a'b'c'd'e'f'g'h'",
    '\u{1F600}'.repeat(7) + "'", '\u{1F600}'.repeat(7) + "''",
    '\\' + "'".repeat(13) + 'a', '\\' + "'".repeat(14) + 'a',
  ];
  for (const value of values) {
    const accepted = authorizerAccepts(value);
    assert.equal(accepted, value.length >= 16);
    for (const key of keys) {
      assert.equal(detectsSecret(`${key}: ${yamlSingleQuoted(value)}`), accepted,
        `${key}, ${value.length} UTF-16 units`);
    }
  }
});

test('YAML doubled-quote decoding never leaks into adjacent shell quoting', () => {
  for (const key of keys) {
    // Identical spellings have different scalar/word values in the two grammars.
    const spelling = "'abc" + "''".repeat(10) + "def'";
    assert.equal(detectsSecret(`${key}: ${spelling}`), true);
    assert.equal(detectsSecret(`${key}=${spelling}`), false);
    assert.equal(detectsSecret(`${key}='abcdefgh''ijklmnop'`), true);
    assert.equal(detectsSecret(`${key}: 'short''value'`), false);
  }
});

const literalWhitespace = [
  '\u00a0', '\u1680', '\u2000', '\u2003', '\u2007', '\u2028', '\u2029',
  '\u202f', '\u205f', '\u3000', '\ufeff', '\r', '\v', '\f',
];

test('shell nonseparator whitespace is counted at every position including after equals', () => {
  for (const key of keys) {
    for (const whitespace of literalWhitespace) {
      for (const units of [15, 16, 17]) {
        for (const value of [
          whitespace + 'a'.repeat(units - 1),
          'a'.repeat(7) + whitespace + 'b'.repeat(units - 8),
          'a'.repeat(units - 1) + whitespace,
        ]) {
          assert.equal(value.length, units);
          const accepted = authorizerAccepts(value);
          assert.equal(accepted, units >= 16);
          assert.equal(detectsSecret(`${key}=${value}`), accepted,
            `${key}, U+${whitespace.codePointAt(0).toString(16)}, ${units} units`);
        }
      }
    }
  }
});

test('shell ASCII word breaks remain distinct from quoted escaped and continued content', () => {
  for (const key of keys) {
    for (const separator of [' ', '\t', '\n']) {
      assert.equal(detectsSecret(`${key}=abcdefgh${separator}ijklmnop`), false);
    }
    for (const whitespace of [' ', '\t', '\r', '\u00a0']) {
      const value = 'abcdefgh' + whitespace + 'ijklmnop';
      assert.equal(authorizerAccepts(value), true);
      assert.equal(detectsSecret(`${key}="${value}"`), true);
      assert.equal(detectsSecret(`${key}=abcdefgh\\${whitespace}ijklmnop`), true);
    }
    assert.equal(detectsSecret(`${key}=abcdefgh\\\nijklmnop`), true);
    assert.equal(detectsSecret(`${key}=abcdefg\\\nhijklmn`), false);
    assert.equal(detectsSecret(`${key}=\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u00a0abcdefg`), true);
    assert.equal(detectsSecret(`${key}=\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u00a0abcdef`), false);
  }
});

test('scalar boundary fixes retain prior unsupported-syntax and literal controls', () => {
  for (const key of keys) {
    for (const text of [
      `${key}=abc"correct horse battery staple"`,
      `${key}=abcdefgh\\\nijklmnop`,
      `${key}=$(printf abcdefghijklmnop)`,
      `${key}: |\n  abcdefghijklmnop`,
      `${key}: abcdefgh\n  ijklmnop`,
      `"${key.slice(0, -1)}\\u${key.charCodeAt(key.length - 1).toString(16).padStart(4, '0')}": short`,
    ]) assert.equal(detectsSecret(text), true);
    for (const text of [`${key}=short`, `${key}: 'short'`, `${key}: "short"`, `${key}: short\n`]) {
      assert.equal(detectsSecret(text), false);
    }
  }
});
