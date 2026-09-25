import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAuthorizer } from '../src/auth.mjs';
import { containsForbiddenEvidenceInput as forbidden } from '../src/production-evidence-input-boundary-v1.mjs';

const base = JSON.parse(readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));
const keys = ['access_token', 'VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN'];
const synthetic = 'abcdefgh' + 'ijklmnop';
const continuation = '\\' + '\n';
const reviewCases = [
  ['4104724822', `curl -H "Authorization: Bearer abcdefgh${continuation}ijklmnop"`],
  ['4104786571', `ADMIN_TOKEN+=${synthetic}`],
  ['4105069439', 'ADMIN_TOKEN: abcdefg\\hijklmno'],
  ['4105112228', `ADMIN_${continuation}TOKEN=${synthetic}`],
  ['4105165136', `- name: ADMIN_TOKEN\n  value: ${synthetic}`],
];
const surfaces = [
  (value, text) => { value.gates[0].evidence = text; },
  (value, text) => { value.actions[0].title = text; },
  (value, text) => { value.actions[0].authorityTarget = text; },
  (value, text) => { value.actions[0].effects[0] = text; },
];
function withText(text, surface = surfaces[0]) {
  const value = structuredClone(base);
  surface(value, text);
  return value;
}

// Only synthetic, inert strings are generated. No shell/config/provider executes.
test('boundary unit: canonical declaration-only manifest remains admitted and unchanged', () => {
  const before = JSON.stringify(base);
  assert.equal(forbidden(base), false);
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(base.secrets.map(entry => entry.id), keys.slice(1));
  for (const entry of base.secrets) {
    assert.equal(entry.valuePresent, false);
    assert.equal(entry.repositoryAllowed, false);
    assert.equal(entry.logsAllowed, false);
  }
});

test('boundary unit: all five review classes fail across every free-text surface', () => {
  for (const [id, text] of reviewCases) {
    for (const surface of surfaces) assert.equal(forbidden(withText(text, surface)), true, id);
  }
  for (const value of [synthetic, 'abcdefg\\hijklmno']) {
    assert.equal(value.length, 16);
    const authorize = createAuthorizer({ administrator: value });
    assert.equal(authorize({ headers: { authorization: `Bearer ${value}` } }, 'administrator').allowed, true);
  }
});

test('boundary unit: credential labels are forbidden independently of layout value length or case', () => {
  for (const key of keys) {
    for (const name of [key, key.toLowerCase(), key.toUpperCase()]) {
      for (const value of ['', 'x', 'short', 'x'.repeat(15), synthetic, '😀'.repeat(8)]) {
        for (const text of [
          `${name}=${value}`, `${name}+=${value}`, `${name}: ${value}`,
          `${name}: '${value}'`, `name: ${name}; value: ${value}`,
          `value: ${value}; name: ${name}`, `- name: ${name}\n  value: ${value}`,
          `{"name":"${name}","value":"${value}"}`,
          `{"value":"${value}","name":"${name}"}`,
          `${name}: [REDACTED]`, `${name}: EXAMPLE_ONLY`,
        ]) assert.equal(forbidden(withText(text)), true);
      }
    }
  }
  for (const value of ['', 'short', synthetic]) {
    for (const separator of [' ', '\t', '\n', '\r\n', '\u00a0']) {
      assert.equal(forbidden(withText(`Bearer${separator}${value}`)), true);
    }
  }
});

test('boundary unit: name and header fragmentation cannot evade the plain-text profile', () => {
  for (const name of [...keys, 'Bearer']) {
    for (let i = 0; i <= name.length; i += 1) {
      for (const joiner of [continuation, '\\\r\n', "''", '""', '\\', '\u200b']) {
        const written = name.slice(0, i) + joiner + name.slice(i);
        assert.equal(forbidden(withText(`${written}: ${synthetic}`)), true);
        assert.equal(forbidden(withText(`name: ${written}; value: ${synthetic}`)), true);
      }
    }
  }
  for (const text of [
    '"\\u0041DMIN_TOKEN": short', 'ADMIN_TOKEN: abcdefg\\hijklmno',
    'name: ADMIN_""TOKEN; value: short', 'ADMIN_$(printf TOKEN)=short',
    'Authorization: B""earer short', '%41DMIN_TOKEN: short',
  ]) assert.equal(forbidden(withText(text)), true);
});

test('boundary unit: every nonprofile ASCII character and terminal line break is rejected', () => {
  for (let code = 0; code < 128; code += 1) {
    const char = String.fromCodePoint(code);
    const allowed = /[A-Za-z0-9 .,:;()/+_-]/u.test(char);
    for (const text of [char + 'Summary', 'Sum' + char + 'mary', 'Summary' + char]) {
      assert.equal(forbidden(withText(text)), !allowed, `ASCII ${code}`);
    }
  }
  for (const char of ['\r\n', '\u00a0', '\u1680', '\u2003', '\u2028', '\u2029', '\ufeff', '\u200b', '\u0000', '\ud800', '😀']) {
    for (const text of [char + 'Summary', 'Sum' + char + 'mary', 'Summary' + char]) {
      assert.equal(forbidden(withText(text)), true);
    }
  }
});

test('boundary unit: the exact declaration-path exception cannot authorize inline or sibling values', () => {
  for (const key of keys.slice(1)) {
    assert.equal(forbidden({ secrets: [{ id: key }] }), false);
    for (const value of [
      key, { id: key }, { name: key, value: synthetic },
      { other: { secrets: [{ id: key }] } }, { secrets: { 0: { id: key } } },
      { 'secrets[0].id': key }, { secrets: [{ id: key + ': short' }] },
      { secrets: [{ id: key.toLowerCase() }] },
      { secrets: [{ id: key, note: `Bearer ${synthetic}` }] },
      { [key]: synthetic },
    ]) assert.equal(forbidden(value), true);
    assert.equal(forbidden({ secrets: [null, null, null, null, { id: key }] }), true);
  }
  assert.equal(forbidden({ secrets: [{ id: 'access_token' }] }), true);
});

test('boundary unit: ordinary nonsecret summaries retain a useful declarative vocabulary', () => {
  for (const text of [
    'SECRET_STORAGE_PROOF', 'No credential values recorded', '源代码核验通过',
    'Cafe\u0301 readiness', 'sha256:0123456789abcdef', 'src/auth.mjs:17',
    'Production readiness (local only); 0 failures / 1 expected skip.',
  ]) assert.equal(forbidden(withText(text)), false, text);
});

test('boundary unit: original decoded values are checked without normalization or mutation', () => {
  for (const [, text] of reviewCases) {
    const value = JSON.parse(JSON.stringify(withText(text)));
    const before = JSON.stringify(value);
    for (let i = 0; i < 3; i += 1) assert.equal(forbidden(value), true);
    assert.equal(JSON.stringify(value), before);
    assert.equal(forbidden(base), false);
  }
});

test('boundary unit: prior secret shapes and placeholders remain blocked', () => {
  for (const text of ['sk-' + 'a'.repeat(16), 'replace-with-random-viewer-token']) {
    assert.equal(forbidden(withText(text)), true);
  }
});

// Lazily import the public validator so the pure boundary subset can also be
// checked offline. CI runs this entire file without a name filter or new skips.
async function publicValidator() {
  const { createProductionChangeManifestValidator } = await import('../src/production-change-manifest-v1.mjs');
  const schema = JSON.parse(readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
  return createProductionChangeManifestValidator(schema);
}

test('boundary integration: all five classes receive one low-disclosure rejection before semantic paths or digest', async () => {
  const validate = await publicValidator();
  for (const [id, text] of reviewCases) {
    for (const surface of surfaces) {
      const value = withText(text, surface);
      const before = JSON.stringify(value);
      const result = validate(value);
      assert.deepEqual(result, { ok: false, issues: [{ code: 'SECRET_MATERIAL_DETECTED', path: '/' }] }, id);
      assert.equal(JSON.stringify(value), before);
      assert.equal(JSON.stringify(result).includes(synthetic), false);
      assert.equal('digest' in result, false);
    }
  }
});

test('boundary integration: real secret fields and forged declarations remain schema-rejected', async () => {
  const validate = await publicValidator();
  for (const mutate of [
    value => { value.secrets[0].value = synthetic; },
    value => { value.secrets[0].valuePresent = true; },
    value => { value.secrets[0].repositoryAllowed = true; },
    value => { value.secrets[0].id = 'access_token'; },
    value => { value.gates[0].evidence = { name: 'ADMIN_TOKEN', value: synthetic }; },
  ]) {
    const value = structuredClone(base);
    mutate(value);
    const result = validate(value);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'SCHEMA_INVALID'));
  }
});

test('boundary integration: admitted text cannot replace frozen evidence or expand authorization', async () => {
  const validate = await publicValidator();
  assert.equal(validate(base).ok, true);
  const wrong = validate(withText('SOURCE_PROOF_PENDING'));
  assert.equal(wrong.ok, false);
  assert.ok(wrong.issues.some(issue => issue.code === 'GATE_EVIDENCE_INVALID'));
  assert.equal(wrong.issues.some(issue => issue.code === 'SECRET_MATERIAL_DETECTED'), false);
  for (const field of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds', 'derivedRollbackActionIds']) {
    assert.deepEqual(base.authorizationPacket[field], []);
    const value = structuredClone(base);
    value.authorizationPacket[field] = ['PROD-01-TARGET-READONLY-PREFLIGHT'];
    assert.equal(validate(value).ok, false);
  }
});

test('boundary integration: schema-valid credential-bearing identifiers are not echoed in diagnostic paths', async () => {
  const validate = await publicValidator();
  const value = structuredClone(base);
  value.authorizationPacket.actionSpecificRevalidation['ADMIN_TOKEN_' + synthetic] = ['CHECK_PENDING'];
  assert.deepEqual(validate(value), { ok: false, issues: [{ code: 'SECRET_MATERIAL_DETECTED', path: '/' }] });
});
