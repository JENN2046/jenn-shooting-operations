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

// Synthetic fixtures only: no configured runtime token or external request.
function authorizerAccepts(token) {
  const authorize = createAuthorizer({ administrator: token });
  return authorize({ headers: { authorization: `Bearer ${token}` } }, 'administrator').allowed;
}

test('role-token scanner measures ordinary quoted escaped and concatenated astral values in UTF-16 units', () => {
  const astral = '\u{1F600}';
  const cases = [
    ['shell unquoted admin', value => `ADMIN_TOKEN=${value}`],
    ['shell double-quoted viewer', value => `VIEWER_TOKEN="${value}"`],
    ['shell single-quoted submitter', value => `SUBMITTER_TOKEN='${value}'`],
    ['shell escaped scheduler', value => `SCHEDULER_TOKEN=\\${value}`],
    ['shell concatenated segments', value => `ADMIN_TOKEN=${value.slice(0, 2)}"${value.slice(2, 8)}"'${value.slice(8)}'`],
    ['config unquoted admin', value => `ADMIN_TOKEN: ${value}`],
    ['config double-quoted viewer', value => `VIEWER_TOKEN:"${value}"`],
    ['config single-quoted submitter', value => `'SUBMITTER_TOKEN': '${value}'`],
  ];
  for (const units of [15, 16]) {
    const value = units === 16 ? astral.repeat(8) : astral.repeat(7) + 'a';
    assert.equal(value.length, units);
    assert.equal(authorizerAccepts(value), units === 16);
    for (const [label, format] of cases) {
      assert.equal(detectsSecret(format(value)), units === 16, `${label}: ${units} UTF-16 units`);
    }
  }
  // Exercise every escaped branch without assuming that config/shell escape
  // spellings share the same decoded length or declaring shorter ones safe.
  const value = astral.repeat(8);
  for (const text of [
    `access_token="\\${value}"`,
    `SCHEDULER_TOKEN: \\${value}`,
    `"access_token": "\\${value}"`,
  ]) {
    assert.equal(detectsSecret(text), true, 'escaped astral credential must be rejected');
  }
});

test('Bearer scanner shares the authorizer UTF-16 threshold for astral and mixed Unicode values', () => {
  const astral = '\u{1F600}';
  for (const value of [astral.repeat(8), 'ab' + astral.repeat(7), astral.repeat(7) + 'a']) {
    const accepted = authorizerAccepts(value);
    assert.equal(accepted, value.length >= 16);
    for (const separator of [' ', '\t', '\n', '\r\n']) {
      assert.equal(detectsSecret(`Bearer${separator}${value}`), accepted,
        `Bearer separator ${JSON.stringify(separator)}: ${value.length} UTF-16 units`);
    }
  }
});
