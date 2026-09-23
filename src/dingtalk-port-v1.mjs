import { validateDingTalkCardV1 } from './dingtalk-card-builders-v1.mjs';
import { OUTBOX_DISPATCH_POLICY_V1 } from './outbox-contract-v1.mjs';

const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const SEND_KEYS = new Set(['dedupeKey', 'routeKey', 'card']);
const UPDATE_KEYS = new Set(['dedupeKey', 'routeKey', 'providerRef', 'card']);
const RETRYABLE_CODES = new Set([
  'DINGTALK_TIMEOUT',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_UNAVAILABLE',
  'DINGTALK_TRANSPORT_ERROR',
]);
const NON_RETRYABLE_CODES = new Set([
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_AUTH_REJECTED',
  'DINGTALK_REQUEST_REJECTED',
  'DINGTALK_RESPONSE_INVALID',
  'DINGTALK_ADAPTER_PROTOCOL_ERROR',
]);

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

function validOpaque(value, maxCodePoints) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= maxCodePoints
    && /\S/u.test(value)
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

function validProviderRef(value) {
  return validOpaque(value, 256) && /^[A-Za-z0-9._:/+=@-]+$/u.test(value);
}

function protocolError() {
  return Object.freeze({ ok: false, code: 'DINGTALK_ADAPTER_PROTOCOL_ERROR' });
}

function transportError() {
  return Object.freeze({ ok: false, code: 'DINGTALK_TRANSPORT_ERROR' });
}

function requestRejected() {
  return Object.freeze({ ok: false, code: 'DINGTALK_REQUEST_REJECTED' });
}

function notConfigured() {
  return Object.freeze({ ok: false, code: 'DINGTALK_NOT_CONFIGURED' });
}

function validOperation(operation) {
  return operation === 'sendCard' || operation === 'updateCard';
}

export function normalizeDingTalkResultV1(result, { operation } = {}) {
  if (!validOperation(operation) || !isRecord(result) || typeof result.ok !== 'boolean') {
    return protocolError();
  }
  if (result.ok === true) {
    const expectedCode = operation === 'sendCard' ? 'DINGTALK_CARD_SENT' : 'DINGTALK_CARD_UPDATED';
    if (
      !exactKeys(result, new Set(['ok', 'code', 'providerRef']))
      || result.code !== expectedCode
      || !validProviderRef(result.providerRef)
    ) return protocolError();
    return Object.freeze({ ok: true, code: expectedCode, providerRef: result.providerRef });
  }

  if (!RETRYABLE_CODES.has(result.code) && !NON_RETRYABLE_CODES.has(result.code)) {
    return protocolError();
  }
  if (result.code === 'DINGTALK_RATE_LIMITED') {
    if (exactKeys(result, new Set(['ok', 'code']))) {
      return Object.freeze({ ok: false, code: result.code });
    }
    if (
      !exactKeys(result, new Set(['ok', 'code', 'retryAfterMs']))
      || !Number.isSafeInteger(result.retryAfterMs)
      || result.retryAfterMs < 0
      || result.retryAfterMs > OUTBOX_DISPATCH_POLICY_V1.retryMaxDelayMs
    ) return protocolError();
    return Object.freeze({ ok: false, code: result.code, retryAfterMs: result.retryAfterMs });
  }
  if (!exactKeys(result, new Set(['ok', 'code']))) return protocolError();
  return Object.freeze({ ok: false, code: result.code });
}

export function classifyDingTalkFailureV1(code) {
  if (RETRYABLE_CODES.has(code)) return Object.freeze({ known: true, retryable: true });
  if (NON_RETRYABLE_CODES.has(code)) return Object.freeze({ known: true, retryable: false });
  return Object.freeze({ known: false, retryable: false });
}

function normalizedInput(input, operation) {
  const expected = operation === 'sendCard' ? SEND_KEYS : UPDATE_KEYS;
  if (
    !exactKeys(input, expected)
    || !validOpaque(input.dedupeKey, 1024)
    || !validOpaque(input.routeKey, 128)
    || !validateDingTalkCardV1(input.card).ok
    || (operation === 'updateCard' && !validProviderRef(input.providerRef))
  ) return null;
  const cloned = operation === 'sendCard'
    ? { dedupeKey: input.dedupeKey, routeKey: input.routeKey, card: Object.freeze({ ...input.card }) }
    : {
        dedupeKey: input.dedupeKey,
        routeKey: input.routeKey,
        providerRef: input.providerRef,
        card: Object.freeze({ ...input.card }),
      };
  return Object.freeze(cloned);
}

export function createUnconfiguredDingTalkAdapterV1() {
  return Object.freeze({
    readiness() {
      return notConfigured();
    },
    async sendCard() {
      return notConfigured();
    },
    async updateCard() {
      return notConfigured();
    },
  });
}

export function createMockDingTalkAdapterV1({ sendCard, updateCard } = {}) {
  if (typeof sendCard !== 'function') throw new TypeError('explicit sendCard handler is required');
  if (typeof updateCard !== 'function') throw new TypeError('explicit updateCard handler is required');
  return Object.freeze({
    readiness() {
      return Object.freeze({ ok: true });
    },
    async sendCard(input) {
      const request = normalizedInput(input, 'sendCard');
      if (!request) return requestRejected();
      try {
        return normalizeDingTalkResultV1(await sendCard(request), { operation: 'sendCard' });
      } catch {
        return transportError();
      }
    },
    async updateCard(input) {
      const request = normalizedInput(input, 'updateCard');
      if (!request) return requestRejected();
      try {
        return normalizeDingTalkResultV1(await updateCard(request), { operation: 'updateCard' });
      } catch {
        return transportError();
      }
    },
  });
}
