import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCallbackNonceDigestV1,
  createFakeCallbackReplayStoreV1,
} from '../src/callback-ports-v1.mjs';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;

test('nonce digest is deterministic, domain-separated, and low disclosure', () => {
  const first = createCallbackNonceDigestV1('nonce-value');
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first, createCallbackNonceDigestV1('nonce-value'));
  assert.notEqual(first, createCallbackNonceDigestV1('other-value'));
  assert.equal(first.includes('nonce-value'), false);
  assert.throws(() => createCallbackNonceDigestV1(''), /nonce/u);
});

test('explicit fake replay store models claim, in-flight, receipt replay, and mismatched reuse', async () => {
  const store = createFakeCallbackReplayStoreV1();
  assert.deepEqual(store.readiness(), { ok: true });
  assert.deepEqual(await store.claim({ nonceDigest: digestA, callbackDigest: digestB }), {
    ok: true,
    code: 'CALLBACK_REPLAY_CLAIMED',
  });
  assert.deepEqual(await store.claim({ nonceDigest: digestA, callbackDigest: digestB }), {
    ok: false,
    code: 'CALLBACK_REPLAY_IN_PROGRESS',
  });
  assert.deepEqual(await store.claim({ nonceDigest: digestA, callbackDigest: digestA }), {
    ok: false,
    code: 'CALLBACK_NONCE_REPLAY',
  });

  const receipt = Object.freeze({ code: 'CALLBACK_ACTION_NOT_WIRED' });
  assert.deepEqual(await store.storeReceipt({
    nonceDigest: digestA,
    callbackDigest: digestB,
    receipt,
  }), { ok: true, code: 'CALLBACK_RECEIPT_STORED' });
  assert.deepEqual(await store.claim({ nonceDigest: digestA, callbackDigest: digestB }), {
    ok: true,
    code: 'CALLBACK_REPLAYED',
    receipt,
  });
});

test('fake replay store validates exact low-disclosure inputs and copies receipts', async () => {
  const store = createFakeCallbackReplayStoreV1();
  for (const input of [
    null,
    { nonceDigest: digestA },
    { nonceDigest: 'nonce', callbackDigest: digestA },
    { nonceDigest: digestA, callbackDigest: digestB, rawBody: 'forbidden' },
  ]) {
    assert.deepEqual(await store.claim(input), {
      ok: false,
      code: 'CALLBACK_REPLAY_STORE_PROTOCOL_ERROR',
    });
  }

  const receipt = { code: 'CALLBACK_REJECTED' };
  const seeded = createFakeCallbackReplayStoreV1({
    entries: [{ nonceDigest: digestA, callbackDigest: digestB, receipt }],
  });
  receipt.code = 'MUTATED';
  const replayed = await seeded.claim({ nonceDigest: digestA, callbackDigest: digestB });
  assert.deepEqual(replayed, {
    ok: true,
    code: 'CALLBACK_REPLAYED',
    receipt: { code: 'CALLBACK_REJECTED' },
  });
  assert.equal(Object.isFrozen(replayed.receipt), true);
});
