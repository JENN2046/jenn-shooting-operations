import { createHash } from 'node:crypto';

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const CLAIM_KEYS = new Set(['nonceDigest', 'callbackDigest']);
const STORE_RECEIPT_KEYS = new Set(['nonceDigest', 'callbackDigest', 'receipt']);
const ENTRY_KEYS = new Set(['nonceDigest', 'callbackDigest', 'receipt']);
const RECEIPT_KEYS = new Set(['code']);

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every(key => expected.has(key));
}

function validOpaque(value, maxCodePoints = 160) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= maxCodePoints
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

export function isCallbackSha256DigestV1(value) {
  return typeof value === 'string' && SHA256_DIGEST.test(value);
}

export function isMinimalCallbackReceiptV1(value) {
  return exactKeys(value, RECEIPT_KEYS) && validOpaque(value.code, 128);
}

function copyReceipt(receipt) {
  return Object.freeze({ code: receipt.code });
}

function notConfigured() {
  return Object.freeze({ ok: false, code: 'CALLBACK_NOT_CONFIGURED' });
}

function protocolError() {
  return Object.freeze({ ok: false, code: 'CALLBACK_REPLAY_STORE_PROTOCOL_ERROR' });
}

function validateReplayKeyInput(input, expected) {
  return exactKeys(input, expected)
    && isCallbackSha256DigestV1(input.nonceDigest)
    && isCallbackSha256DigestV1(input.callbackDigest);
}

export function createCallbackNonceDigestV1(nonce) {
  if (!validOpaque(nonce, 512)) throw new TypeError('callback nonce must be a bounded non-empty string');
  return `sha256:${createHash('sha256')
    .update('jenn-shooting-operations/callback-nonce/v1\0', 'utf8')
    .update(nonce, 'utf8')
    .digest('hex')}`;
}

export function createUnconfiguredCallbackVerifierV1() {
  return Object.freeze({
    readiness: notConfigured,
    async verify() {
      return notConfigured();
    },
  });
}

export function createUnconfiguredCallbackPrincipalMapperV1() {
  return Object.freeze({
    readiness: notConfigured,
    async mapPrincipal() {
      return notConfigured();
    },
  });
}

export function createEmptyCallbackActionRegistryV1() {
  return Object.freeze({
    readiness: notConfigured,
    async resolveAction() {
      return notConfigured();
    },
  });
}

export function createUnconfiguredCallbackReplayStoreV1() {
  return Object.freeze({
    readiness: notConfigured,
    async claim() {
      return notConfigured();
    },
    async storeReceipt() {
      return notConfigured();
    },
  });
}

export function createFakeCallbackReplayStoreV1({ entries = [] } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const records = new Map();
  for (const entry of entries) {
    if (
      !validateReplayKeyInput(entry, ENTRY_KEYS)
      || !isMinimalCallbackReceiptV1(entry.receipt)
      || records.has(entry.nonceDigest)
    ) throw new TypeError('invalid fake callback replay entry');
    records.set(entry.nonceDigest, Object.freeze({
      callbackDigest: entry.callbackDigest,
      receipt: copyReceipt(entry.receipt),
    }));
  }

  return Object.freeze({
    readiness() {
      return Object.freeze({ ok: true });
    },
    async claim(input) {
      if (!validateReplayKeyInput(input, CLAIM_KEYS)) return protocolError();
      const existing = records.get(input.nonceDigest);
      if (!existing) {
        records.set(input.nonceDigest, Object.freeze({
          callbackDigest: input.callbackDigest,
          receipt: null,
        }));
        return Object.freeze({ ok: true, code: 'CALLBACK_REPLAY_CLAIMED' });
      }
      if (existing.callbackDigest !== input.callbackDigest) {
        return Object.freeze({ ok: false, code: 'CALLBACK_NONCE_REPLAY' });
      }
      if (existing.receipt === null) {
        return Object.freeze({ ok: false, code: 'CALLBACK_REPLAY_IN_PROGRESS' });
      }
      return Object.freeze({
        ok: true,
        code: 'CALLBACK_REPLAYED',
        receipt: existing.receipt,
      });
    },
    async storeReceipt(input) {
      if (
        !validateReplayKeyInput(input, STORE_RECEIPT_KEYS)
        || !isMinimalCallbackReceiptV1(input.receipt)
      ) return protocolError();
      const existing = records.get(input.nonceDigest);
      if (!existing || existing.callbackDigest !== input.callbackDigest) return protocolError();
      if (existing.receipt !== null) {
        if (existing.receipt.code !== input.receipt.code) return protocolError();
        return Object.freeze({ ok: true, code: 'CALLBACK_RECEIPT_STORED' });
      }
      records.set(input.nonceDigest, Object.freeze({
        callbackDigest: input.callbackDigest,
        receipt: copyReceipt(input.receipt),
      }));
      return Object.freeze({ ok: true, code: 'CALLBACK_RECEIPT_STORED' });
    },
  });
}
