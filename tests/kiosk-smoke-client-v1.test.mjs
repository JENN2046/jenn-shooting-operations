import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('exact Kiosk client uses Web Crypto UUIDs for run/event IDs and fails closed without it', () => {
  const source = readFileSync(new URL('../public/kiosk.js', import.meta.url), 'utf8');
  const fn = source.match(/function secureId\(prefix\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(fn);
  let calls = 0;
  const crypto = { randomUUID() { calls++; return '7d188cc5-cd8f-47e8-8aa5-57a36586c9d7'; } };
  for (const prefix of ['RUN', 'EVENT']) {
    assert.equal(runInNewContext(`${fn}; secureId('${prefix}')`, { crypto }), `${prefix}-7d188cc5-cd8f-47e8-8aa5-57a36586c9d7`);
    assert.throws(() => runInNewContext(`${fn}; secureId('${prefix}')`, {}));
    assert.throws(() => runInNewContext(`${fn}; secureId('${prefix}')`, { crypto: {} }));
  }
  assert.equal(calls, 2);
  assert.match(source, /const runId = action\.runId \?\? secureId\('RUN'\)/u);
  assert.match(source, /eventId: secureId\('EVENT'\)/u);
});
