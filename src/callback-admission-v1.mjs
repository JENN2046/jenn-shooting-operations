import { createHash } from 'node:crypto';

import {
  AUTHORIZATION_CAPABILITIES,
  authorizeCapability,
  validateTrustedPrincipal,
} from './authorization-v2.mjs';
import {
  DuplicateCallbackJsonKeyError,
  parseCallbackJsonRejectingDuplicateKeysV1,
} from './callback-json-v1.mjs';
import {
  createEmptyCallbackActionRegistryV1,
  createUnconfiguredCallbackPrincipalMapperV1,
  createUnconfiguredCallbackReplayStoreV1,
  createUnconfiguredCallbackVerifierV1,
  isCallbackSha256DigestV1,
  isMinimalCallbackReceiptV1,
} from './callback-ports-v1.mjs';

export const CALLBACK_ENABLED_ACTIONS_V1 = Object.freeze([]);

const MAX_RAW_BODY_BYTES = 65_536;
const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const PAYLOAD_KEYS = new Set([
  'callbackId',
  'actionId',
  'cardTemplateId',
  'providerCardRef',
  'aggregateType',
  'aggregateId',
  'revisionScope',
  'expectedRevision',
]);
const VERIFIED_KEYS = new Set([
  'ok', 'code', 'plaintext', 'nonceDigest', 'providerPrincipalRef',
]);
const PRINCIPAL_RESULT_KEYS = new Set(['ok', 'code', 'principal']);
const ACTION_RESULT_KEYS = new Set(['ok', 'code', 'action']);
const ACTION_KEYS = new Set([
  'actionId',
  'cardTemplateId',
  'providerCardRef',
  'aggregateType',
  'aggregateId',
  'revisionScope',
  'expectedRevision',
  'requiredCapability',
  'resourceId',
]);
const VERIFIER_FAILURE_CODES = new Set([
  'CALLBACK_NOT_CONFIGURED',
  'CALLBACK_SIGNATURE_INVALID',
  'CALLBACK_TIMESTAMP_EXPIRED',
]);
const PRINCIPAL_FAILURE_CODES = new Set([
  'CALLBACK_NOT_CONFIGURED',
  'CALLBACK_PRINCIPAL_UNKNOWN',
]);
const ACTION_FAILURE_CODES = new Set([
  'CALLBACK_NOT_CONFIGURED',
  'CALLBACK_ACTION_NOT_ALLOWED',
]);
const REPLAY_FAILURE_CODES = new Set([
  'CALLBACK_NOT_CONFIGURED',
  'CALLBACK_NONCE_REPLAY',
  'CALLBACK_REPLAY_IN_PROGRESS',
  'CALLBACK_REPLAY_STORE_PROTOCOL_ERROR',
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
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

function validUtcInstant(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function result(code, extra = {}) {
  return Object.freeze({ ok: false, code, ...extra });
}

function success(code, extra = {}) {
  return Object.freeze({ ok: true, code, ...extra });
}

function readinessOk(port) {
  if (!port || typeof port.readiness !== 'function') return false;
  try {
    const ready = port.readiness();
    return exactKeys(ready, new Set(['ok'])) && ready.ok === true;
  } catch {
    return false;
  }
}

function normalizeHeaders(headers) {
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > 32) return null;
  const normalized = Object.create(null);
  for (const entry of headers) {
    if (
      !Array.isArray(entry)
      || entry.length !== 2
      || typeof entry[0] !== 'string'
      || typeof entry[1] !== 'string'
      || entry[0].length > 128
      || entry[1].length > 4_096
    ) return null;
    const name = entry[0].toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(name) || name in normalized) return null;
    if (entry[1].length === 0 || CONTROL_OR_LINE_SEPARATOR.test(entry[1])) return null;
    normalized[name] = entry[1];
  }
  const contentType = normalized['content-type']?.toLowerCase();
  if (contentType !== 'application/json' && contentType !== 'application/json; charset=utf-8') return null;
  return Object.freeze(normalized);
}

function normalizeRequest(input) {
  if (!exactKeys(input, new Set(['rawBody', 'headers', 'receivedAt']))) return null;
  if (
    !(input.rawBody instanceof Uint8Array)
    || input.rawBody.byteLength === 0
    || input.rawBody.byteLength > MAX_RAW_BODY_BYTES
    || !validUtcInstant(input.receivedAt)
  ) return null;
  const headers = normalizeHeaders(input.headers);
  if (!headers) return null;
  return Object.freeze({
    rawBody: input.rawBody,
    headers,
    contentType: headers['content-type'],
    receivedAt: input.receivedAt,
  });
}

function normalizeVerifierResult(value) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return result('CALLBACK_VERIFIER_PROTOCOL_ERROR');
  if (value.ok === false) {
    if (
      !exactKeys(value, new Set(['ok', 'code']))
      || !VERIFIER_FAILURE_CODES.has(value.code)
    ) return result('CALLBACK_VERIFIER_PROTOCOL_ERROR');
    return result(value.code);
  }
  if (
    !exactKeys(value, VERIFIED_KEYS)
    || value.code !== 'CALLBACK_VERIFIED'
    || typeof value.plaintext !== 'string'
    || Buffer.byteLength(value.plaintext, 'utf8') === 0
    || Buffer.byteLength(value.plaintext, 'utf8') > MAX_RAW_BODY_BYTES
    || !isCallbackSha256DigestV1(value.nonceDigest)
    || !validOpaque(value.providerPrincipalRef, 160)
  ) return result('CALLBACK_VERIFIER_PROTOCOL_ERROR');
  return Object.freeze({
    ok: true,
    code: 'CALLBACK_VERIFIED',
    plaintext: value.plaintext,
    nonceDigest: value.nonceDigest,
    providerPrincipalRef: value.providerPrincipalRef,
  });
}

function normalizePayload(plaintext) {
  let parsed;
  try {
    parsed = parseCallbackJsonRejectingDuplicateKeysV1(plaintext);
  } catch (error) {
    return result(error instanceof DuplicateCallbackJsonKeyError
      ? 'CALLBACK_DUPLICATE_KEY'
      : 'CALLBACK_PAYLOAD_INVALID');
  }
  if (
    !exactKeys(parsed, PAYLOAD_KEYS)
    || !validOpaque(parsed.callbackId, 160)
    || !validOpaque(parsed.actionId, 128)
    || !validOpaque(parsed.cardTemplateId, 128)
    || !validOpaque(parsed.providerCardRef, 256)
    || !/^[A-Za-z0-9._:/+=@-]+$/u.test(parsed.providerCardRef)
    || !validOpaque(parsed.aggregateType, 128)
    || !validOpaque(parsed.aggregateId, 160)
    || !validOpaque(parsed.revisionScope, 128)
    || !Number.isSafeInteger(parsed.expectedRevision)
    || parsed.expectedRevision < 0
  ) return result('CALLBACK_PAYLOAD_INVALID');
  return Object.freeze({ ok: true, payload: Object.freeze({ ...parsed }) });
}

function normalizePrincipalResult(value) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return result('CALLBACK_PRINCIPAL_PROTOCOL_ERROR');
  }
  if (value.ok === false) {
    if (
      !exactKeys(value, new Set(['ok', 'code']))
      || !PRINCIPAL_FAILURE_CODES.has(value.code)
    ) return result('CALLBACK_PRINCIPAL_PROTOCOL_ERROR');
    return result(value.code);
  }
  if (
    !exactKeys(value, PRINCIPAL_RESULT_KEYS)
    || value.code !== 'CALLBACK_PRINCIPAL_MAPPED'
    || !validateTrustedPrincipal(value.principal).ok
  ) return result('CALLBACK_PRINCIPAL_UNKNOWN');
  const principal = Object.freeze({
    subjectId: value.principal.subjectId,
    role: value.principal.role,
    capabilities: Object.freeze({ ...value.principal.capabilities }),
    resourceIds: Object.freeze([...value.principal.resourceIds]),
  });
  return Object.freeze({ ok: true, principal });
}

function normalizeActionResult(value, payload, principal) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return result('CALLBACK_ACTION_PROTOCOL_ERROR');
  if (value.ok === false) {
    if (
      !exactKeys(value, new Set(['ok', 'code']))
      || !ACTION_FAILURE_CODES.has(value.code)
    ) return result('CALLBACK_ACTION_PROTOCOL_ERROR');
    return result(value.code);
  }
  if (
    !exactKeys(value, ACTION_RESULT_KEYS)
    || value.code !== 'CALLBACK_ACTION_RESOLVED'
    || !exactKeys(value.action, ACTION_KEYS)
    || value.action.actionId !== payload.actionId
    || value.action.cardTemplateId !== payload.cardTemplateId
    || value.action.providerCardRef !== payload.providerCardRef
    || value.action.aggregateType !== payload.aggregateType
    || value.action.aggregateId !== payload.aggregateId
    || value.action.revisionScope !== payload.revisionScope
    || value.action.expectedRevision !== payload.expectedRevision
    || !AUTHORIZATION_CAPABILITIES.includes(value.action.requiredCapability)
    || !validOpaque(value.action.resourceId, 160)
  ) return result('CALLBACK_ACTION_NOT_ALLOWED');
  const authorization = authorizeCapability({
    principal,
    capability: value.action.requiredCapability,
    resourceId: value.action.resourceId,
  });
  if (!authorization.allowed) return result('CALLBACK_ACTION_NOT_ALLOWED');
  return Object.freeze({ ok: true });
}

function normalizeEnabledActions(enabledActions) {
  if (!Array.isArray(enabledActions)) return null;
  const normalized = [];
  const seen = new Set();
  for (const actionId of enabledActions) {
    if (!validOpaque(actionId, 128) || seen.has(actionId)) return null;
    seen.add(actionId);
    normalized.push(actionId);
  }
  return Object.freeze(normalized);
}

function normalizeReplayResult(value) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return result('CALLBACK_REPLAY_STORE_PROTOCOL_ERROR');
  }
  if (value.ok === false) {
    if (
      !exactKeys(value, new Set(['ok', 'code']))
      || !REPLAY_FAILURE_CODES.has(value.code)
    ) return result('CALLBACK_REPLAY_STORE_PROTOCOL_ERROR');
    return result(value.code);
  }
  if (
    exactKeys(value, new Set(['ok', 'code']))
    && value.code === 'CALLBACK_REPLAY_CLAIMED'
  ) return success('CALLBACK_REPLAY_CLAIMED');
  if (
    exactKeys(value, new Set(['ok', 'code', 'receipt']))
    && value.code === 'CALLBACK_REPLAYED'
    && isMinimalCallbackReceiptV1(value.receipt)
  ) return success('CALLBACK_REPLAYED', { receipt: Object.freeze({ code: value.receipt.code }) });
  return result('CALLBACK_REPLAY_STORE_PROTOCOL_ERROR');
}

export function digestVerifiedCallbackV1(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('verified callback plaintext is required');
  }
  return `sha256:${createHash('sha256')
    .update('jenn-shooting-operations/verified-callback/v1\0', 'utf8')
    .update(plaintext, 'utf8')
    .digest('hex')}`;
}

export function createDingTalkCallbackAdmissionV1({
  verifier = createUnconfiguredCallbackVerifierV1(),
  principalMapper = createUnconfiguredCallbackPrincipalMapperV1(),
  actionRegistry = createEmptyCallbackActionRegistryV1(),
  replayStore = createUnconfiguredCallbackReplayStoreV1(),
  enabledActions = CALLBACK_ENABLED_ACTIONS_V1,
} = {}) {
  const admittedActions = normalizeEnabledActions(enabledActions);
  return async function admitCallback(input) {
    if (
      admittedActions === null
      || !readinessOk(verifier)
      || typeof verifier.verify !== 'function'
    ) return result('CALLBACK_NOT_CONFIGURED');

    const normalizedRequest = normalizeRequest(input);
    if (!normalizedRequest) return result('CALLBACK_REQUEST_INVALID');

    let rawVerified;
    try {
      rawVerified = await verifier.verify(normalizedRequest);
    } catch {
      return result('CALLBACK_VERIFIER_PROTOCOL_ERROR');
    }
    const verified = normalizeVerifierResult(rawVerified);
    if (!verified.ok) return verified;

    const parsed = normalizePayload(verified.plaintext);
    if (!parsed.ok) return parsed;
    if (!admittedActions.includes(parsed.payload.actionId)) {
      return result('CALLBACK_ACTION_NOT_ALLOWED');
    }
    if (
      !readinessOk(principalMapper)
      || !readinessOk(actionRegistry)
      || !readinessOk(replayStore)
      || typeof principalMapper.mapPrincipal !== 'function'
      || typeof actionRegistry.resolveAction !== 'function'
      || typeof replayStore.claim !== 'function'
      || typeof replayStore.storeReceipt !== 'function'
    ) return result('CALLBACK_NOT_CONFIGURED');

    let rawPrincipal;
    try {
      rawPrincipal = await principalMapper.mapPrincipal(Object.freeze({
        providerPrincipalRef: verified.providerPrincipalRef,
      }));
    } catch {
      return result('CALLBACK_PRINCIPAL_PROTOCOL_ERROR');
    }
    const mapped = normalizePrincipalResult(rawPrincipal);
    if (!mapped.ok) return mapped;

    let rawAction;
    try {
      rawAction = await actionRegistry.resolveAction(Object.freeze({
        actionId: parsed.payload.actionId,
        cardTemplateId: parsed.payload.cardTemplateId,
        providerCardRef: parsed.payload.providerCardRef,
        aggregateType: parsed.payload.aggregateType,
        aggregateId: parsed.payload.aggregateId,
        revisionScope: parsed.payload.revisionScope,
        expectedRevision: parsed.payload.expectedRevision,
      }));
    } catch {
      return result('CALLBACK_ACTION_PROTOCOL_ERROR');
    }
    const action = normalizeActionResult(rawAction, parsed.payload, mapped.principal);
    if (!action.ok) return action;

    const callbackDigest = digestVerifiedCallbackV1(verified.plaintext);
    let rawReplay;
    try {
      rawReplay = await replayStore.claim(Object.freeze({
        nonceDigest: verified.nonceDigest,
        callbackDigest,
      }));
    } catch {
      return result('CALLBACK_REPLAY_STORE_PROTOCOL_ERROR');
    }
    const replay = normalizeReplayResult(rawReplay);
    if (!replay.ok || replay.code === 'CALLBACK_REPLAYED') return replay;

    const receipt = Object.freeze({ code: 'CALLBACK_ACTION_NOT_WIRED' });
    let stored;
    try {
      stored = await replayStore.storeReceipt(Object.freeze({
        nonceDigest: verified.nonceDigest,
        callbackDigest,
        receipt,
      }));
    } catch {
      return result('CALLBACK_REPLAY_STORE_PROTOCOL_ERROR');
    }
    if (
      !exactKeys(stored, new Set(['ok', 'code']))
      || stored.ok !== true
      || stored.code !== 'CALLBACK_RECEIPT_STORED'
    ) return result('CALLBACK_REPLAY_STORE_PROTOCOL_ERROR');
    return result('CALLBACK_ACTION_NOT_WIRED');
  };
}
