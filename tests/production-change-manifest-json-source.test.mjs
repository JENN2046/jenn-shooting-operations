import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseProductionManifestJson as parse, PRODUCTION_MANIFEST_JSON_MAX_BYTES as maxBytes } from '../src/production-manifest-json-v1.mjs';

const synthetic = 'abcdefgh' + 'ijklmnop';
const duplicate = { ok: false, issues: [{ code: 'MANIFEST_JSON_DUPLICATE_KEY', path: '/' }] };
const invalid = { ok: false, issues: [{ code: 'MANIFEST_JSON_INVALID', path: '/' }] };

// Raw strings are essential: constructing JS objects would erase the defect.
test('source unit: duplicate keys fail at every object depth before member overwrite', () => {
  for (const text of [
    '{"a":1,"a":2}', '{"a":1,"a":1}',
    '{"gates":[{"evidence":"hidden","evidence":"canonical"}]}',
    '{"gates":[{"nested":{"id":1,"id":2}}]}',
    '{"gates":[{"evidence":"hidden"}],"gates":[]}',
    '[{"a":1},{"b":{"c":1,"c":2}}]',
    '{"__proto__":{},"__proto__":{}}', '{"":null,"":false}',
    '{"0":1,"0":2}',
  ]) {
    assert.deepEqual(parse(text), duplicate);
    assert.deepEqual(parse(Buffer.from(text)), duplicate);
  }
});

test('source unit: decoded-equivalent keys cannot hide duplicates with Unicode escapes', () => {
  for (const key of ['evidence', 'authorizationPacket', 'ADMIN_TOKEN']) {
    for (let index = 0; index < key.length; index += 1) {
      const encoded = key.slice(0, index) + '\\u' + key.charCodeAt(index).toString(16).padStart(4, '0') + key.slice(index + 1);
      for (const pair of [[key, encoded], [encoded, key]]) {
        assert.deepEqual(parse(`{"${pair[0]}":1,"${pair[1]}":2}`), duplicate);
      }
    }
  }
  for (const text of ['{"😀":1,"\\ud83d\\ude00":2}', '{"a/b":1,"a\\/b":2}', '{"a\\nb":1,"a\\u000ab":2}']) {
    assert.deepEqual(parse(text), duplicate);
  }
});

test('source unit: repeated keys in separate objects and apparent keys inside strings remain valid JSON', () => {
  for (const text of [
    '{"left":{"id":1},"right":{"id":2}}', '[{"id":1},{"id":2}]',
    JSON.stringify({ evidence: '"a":1,"a":2', braces: '{}[]', slash: '\\', quote: '"' }),
    ' \r\n {"values":[null,true,false,0,-0,1.5,-2e3],"text":"源代码"} \t\n',
    '{"__proto__":{"safe":1},"constructor":2,"toString":3}',
    '{"evidence":1,"Evidence":2}',
  ]) {
    const result = parse(text);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)), JSON.parse(JSON.stringify(JSON.parse(text))));
  }
  assert.equal(Object.getPrototypeOf(parse('{"__proto__":{}}').value), null);
});

test('source unit: malformed JSON invalid UTF-8 and excess depth fail without echoing input', () => {
  for (const text of ['', ' ', '{}[]', '{"x":1,}', '[1,]', '{"x":01}', '{"x":NaN}', '{"x":1e309}',
    '{"x":"unterminated', '{"x":"\\q"}', '\ufeff{}', '{"x":1} // ' + synthetic,
    '{"x":"' + synthetic + '\n"}', '['.repeat(65) + '0' + ']'.repeat(65)]) {
    assert.deepEqual(parse(text), invalid);
  }
  assert.equal(parse('['.repeat(64) + '0' + ']'.repeat(64)).ok, true);
  for (const bytes of [Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])]) {
    assert.deepEqual(parse(bytes), invalid);
  }
  for (const value of [null, undefined, {}, [], 1, true, new String('{}')]) assert.deepEqual(parse(value), invalid);
});

test('source unit: size limits apply to original UTF-8 bytes and do not normalize source', () => {
  const exact = '""' + ' '.repeat(maxBytes - 2);
  assert.equal(parse(exact).ok, true);
  assert.equal(parse(Buffer.from(exact)).ok, true);
  for (const value of [exact + ' ', Buffer.from(exact + ' '), '"' + '界'.repeat(Math.ceil(maxBytes / 3)) + '"']) {
    assert.deepEqual(parse(value), { ok: false, issues: [{ code: 'MANIFEST_JSON_TOO_LARGE', path: '/' }] });
  }
  const bytes = Buffer.from('{"a":1,"a":2}');
  const before = Buffer.from(bytes);
  for (let index = 0; index < 3; index += 1) assert.deepEqual(parse(bytes), duplicate);
  assert.deepEqual(bytes, before);
  assert.equal('value' in parse(bytes), false);
  assert.equal('digest' in parse(bytes), false);
});

test('source unit: generated unique JSON matches standard decoding without object-level reparsing', () => {
  let seed = 23;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  function value(depth) {
    if (depth === 0) return [null, true, false, next() / 17, 'text\\\"\n😀'][next() % 5];
    return next() % 2 ? { ['key_' + next()]: value(depth - 1), nested: value(depth - 1) }
      : [value(depth - 1), value(depth - 1)];
  }
  for (let index = 0; index < 100; index += 1) {
    const text = JSON.stringify(value(4), null, index % 3);
    const result = parse(text);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)), JSON.parse(text));
  }
});

async function context() {
  const { createProductionChangeManifestValidator } = await import('../src/production-change-manifest-v1.mjs');
  const schemaText = readFileSync(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8');
  const manifestText = readFileSync(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8');
  const schema = parse(schemaText);
  const manifest = parse(manifestText);
  assert.equal(schema.ok, true);
  assert.equal(manifest.ok, true);
  return { schemaText, manifestText, base: manifest.value, validate: createProductionChangeManifestValidator(schema.value) };
}

function hiddenDuplicateCases(base) {
  const canonical = JSON.stringify(base);
  const evidence = JSON.stringify(base.gates[0].evidence);
  const secret = JSON.stringify('ADMIN_TOKEN=' + synthetic);
  return [
    canonical.replace('"evidence":' + evidence, '"evidence":' + secret + ',"evidence":' + evidence),
    canonical.replace('"evidence":' + evidence, '"\\u0065vidence":' + secret + ',"evidence":' + evidence),
    canonical.replace('"evidence":' + evidence, '"evidence":' + evidence + ',"evidence":' + secret),
    '{"gates":[{"evidence":' + secret + '}],' + canonical.slice(1),
    '{"secrets":[{"id":"ADMIN_TOKEN","value":' + JSON.stringify(synthetic) + '}],' + canonical.slice(1),
    '{"authorizationPacket":{"approvedActionIds":["PROD-13-CUTOVER-SWITCH"]},' + canonical.slice(1),
    canonical.replace('"evidence":' + evidence, '"evidence":' + evidence + ',"evidence":' + evidence),
  ];
}

test('source integration: canonical format variants keep identical validated digest and empty authority', async () => {
  const { base, manifestText, validate } = await context();
  const reference = validate(base);
  assert.equal(reference.ok, true);
  for (const text of [manifestText, JSON.stringify(base), JSON.stringify(base, null, '\t'), '\r\n' + manifestText + '\r\n']) {
    const parsed = parse(Buffer.from(text));
    assert.equal(parsed.ok, true);
    assert.deepEqual(validate(parsed.value), reference);
    for (const key of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds', 'derivedRollbackActionIds']) {
      assert.deepEqual(parsed.value.authorizationPacket[key], []);
    }
  }
});

test('source integration: the reported overwritten-secret exploit fails before evidence or digest', async () => {
  const { base, validate } = await context();
  const cases = hiddenDuplicateCases(base);
  // Demonstrate the old lossy loader would accept these exact hostile sources.
  for (const index of [0, 1, 3, 4, 5, 6]) assert.equal(validate(JSON.parse(cases[index])).ok, true);
  for (const text of cases) {
    const result = parse(text);
    assert.deepEqual(result, duplicate);
    assert.equal(JSON.stringify(result).includes(synthetic), false);
    assert.equal('digest' in result || 'value' in result, false);
  }
});

test('source integration: every original scanner class reaches the unified boundary from raw JSON', async () => {
  const { base, validate } = await context();
  const continuation = '\\' + '\n';
  for (const text of [
    `curl -H "Authorization: Bearer abcdefgh${continuation}ijklmnop"`,
    `ADMIN_TOKEN+=${synthetic}`, 'ADMIN_TOKEN: abcdefg\\hijklmno',
    `ADMIN_${continuation}TOKEN=${synthetic}`, `- name: ADMIN_TOKEN\n  value: ${synthetic}`,
  ]) {
    const candidate = structuredClone(base);
    candidate.gates[0].evidence = text;
    const parsed = parse(JSON.stringify(candidate));
    assert.equal(parsed.ok, true);
    assert.deepEqual(validate(parsed.value), { ok: false, issues: [{ code: 'SECRET_MATERIAL_DETECTED', path: '/' }] });
  }
});

// Execute the real CLI against an isolated copied layout, never the checkout's
// authority files. Only this temporary fixture directory is written or removed.
function cli(manifestSource, schemaSource) {
  const root = mkdtempSync(join(tmpdir(), 'wo06d-json-source-'));
  try {
    for (const dir of ['scripts', 'contracts', 'docs/operations']) mkdirSync(join(root, dir), { recursive: true });
    symlinkSync(fileURLToPath(new URL('../src', import.meta.url)), join(root, 'src'), 'junction');
    copyFileSync(new URL('../scripts/validate-production-change-manifest.mjs', import.meta.url), join(root, 'scripts/validate-production-change-manifest.mjs'));
    writeFileSync(join(root, 'contracts/production-change-manifest.v1.schema.json'), schemaSource);
    if (manifestSource !== null) writeFileSync(join(root, 'docs/operations/production-change-manifest.v1.json'), manifestSource);
    const result = spawnSync(process.execPath, [join(root, 'scripts/validate-production-change-manifest.mjs')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.error, undefined);
    if (manifestSource !== null) assert.deepEqual(readFileSync(join(root, 'docs/operations/production-change-manifest.v1.json')), Buffer.from(manifestSource));
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('source CLI: real file loader rejects hidden duplicates and preserves normal verdict', async () => {
  const { schemaText, manifestText, base, validate } = await context();
  const success = cli(manifestText, schemaText);
  assert.equal(success.status, 0);
  const verdict = JSON.parse(success.stdout);
  assert.equal(verdict.status, 'WO_06D_MANIFEST_VALID');
  assert.equal(verdict.manifestDigest, validate(base).digest);
  assert.deepEqual(verdict.requestableActionIds, []);
  for (const text of hiddenDuplicateCases(base)) {
    const result = cli(text, schemaText);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { status: 'WO_06D_MANIFEST_INVALID', issues: duplicate.issues });
    assert.equal(result.stderr.includes(synthetic), false);
  }
});

test('source CLI: schema duplicates malformed bytes syntax and I/O errors disclose no source', async () => {
  const { schemaText, manifestText, base } = await context();
  const hostileSchema = '{"type":"' + synthetic + '",' + schemaText.trim().slice(1);
  for (const [manifest, schema] of [
    [manifestText, hostileSchema],
    [manifestText, '{"type":"' + synthetic + '"'],
    ['{"evidence":"' + synthetic + '\n"}', schemaText],
    [Buffer.from([0xff]), schemaText], [null, schemaText],
  ]) {
    const result = cli(manifest, schema);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).status, 'WO_06D_MANIFEST_INVALID');
    assert.equal(result.stderr.includes(synthetic), false);
    assert.equal(result.stderr.includes('manifestDigest'), false);
  }
  // Even schema error paths must not echo hostile user-controlled keys.
  const candidate = structuredClone(base);
  candidate.authorizationPacket.actionSpecificRevalidation[synthetic] = 'wrong-shape';
  const result = cli(JSON.stringify(candidate), schemaText);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes(synthetic), false);
  assert.ok(JSON.parse(result.stderr).issues.every(issue => issue.path === '/'));
});
