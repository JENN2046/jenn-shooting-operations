import { createHash } from 'node:crypto';

import {
  DINGTALK_CARD_SCHEMA_V1,
  validateDingTalkCardV1,
} from './dingtalk-card-builders-v1.mjs';

const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const INTENT_INPUT_KEYS = new Set([
  'outboxId', 'intentType', 'aggregateType', 'aggregateId', 'routeKey',
  'aggregateRevisionScope', 'aggregateRevision', 'cardSchemaVersion', 'payload', 'createdAt',
]);
const INTENT_KEYS = new Set([
  'outboxId', 'dedupeKey', 'intentType', 'aggregateType', 'aggregateId', 'routeKey',
  'aggregateRevisionScope', 'aggregateRevision', 'cardSchemaVersion',
  'deliveryPolicyVersion', 'payloadJson', 'payloadDigest', 'createdAt',
]);

const retryDelays = Object.freeze([50, 100, 200]);

export const OUTBOX_DISPATCH_POLICY_V1 = Object.freeze({
  policyVersion: 'outbox-dispatch-v1',
  batchSize: 8,
  leaseDurationMs: 30_000,
  deliveryTimeoutMs: 8_000,
  maxAttempts: 5,
  retryBaseDelayMs: 2_000,
  retryMaxDelayMs: 300_000,
  retryJitterRatio: 0.25,
  idlePollMs: 2_000,
  idlePollJitterRatio: 0.25,
  busyBaseDelayMs: 250,
  busyMaxDelayMs: 2_000,
  resultBusyTimeoutMs: 100,
  resultRetryMs: retryDelays,
});

export const NOTIFICATION_INTENT_ADMISSION_V1 = Object.freeze({
  'request.submitted.v1': Object.freeze({ status: 'NOT_WIRED', aggregateRevisionScope: null }),
  'schedule.confirmed.v1': Object.freeze({ status: 'NOT_WIRED', aggregateRevisionScope: 'schedule' }),
  'production-run.completed.v1': Object.freeze({ status: 'WIRED', aggregateRevisionScope: 'run' }),
});

const INTENT_SPEC = new Map([
  ['request.submitted.v1', Object.freeze({
    aggregateType: 'request',
    cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.requestSubmitted,
  })],
  ['schedule.confirmed.v1', Object.freeze({
    aggregateType: 'schedule_item',
    cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.scheduleConfirmed,
  })],
  ['production-run.completed.v1', Object.freeze({
    aggregateType: 'production_run',
    cardSchemaVersion: DINGTALK_CARD_SCHEMA_V1.productionRunCompleted,
  })],
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

function canonical(value, ancestors) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('CANONICAL_JSON_INVALID');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('CANONICAL_JSON_INVALID');
  if (ancestors.has(value)) throw new TypeError('CANONICAL_JSON_INVALID');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('CANONICAL_JSON_INVALID');
      }
      if (Reflect.ownKeys(value).some(key => key !== 'length' && !/^\d+$/u.test(String(key)))) {
        throw new TypeError('CANONICAL_JSON_INVALID');
      }
      return `[${value.map(item => canonical(item, ancestors)).join(',')}]`;
    }
    if (!isRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('CANONICAL_JSON_INVALID');
    }
    const keys = Object.keys(value).toSorted();
    const parts = keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('CANONICAL_JSON_INVALID');
      return `${JSON.stringify(key)}:${canonical(descriptor.value, ancestors)}`;
    });
    return `{${parts.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonV1(value) {
  return canonical(value, new WeakSet());
}

export function digestCanonicalJsonV1(value) {
  return `sha256:${createHash('sha256').update(canonicalJsonV1(value), 'utf8').digest('hex')}`;
}

function validIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= 128
    && /\S/u.test(value)
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number.isFinite(Date.parse(value));
}

function invalid(code = 'NOTIFICATION_INTENT_INVALID', details = {}) {
  return Object.freeze({ ok: false, code, ...details });
}

function validCommonInput(input) {
  return exactKeys(input, INTENT_INPUT_KEYS)
    && validIdentifier(input.outboxId)
    && validIdentifier(input.aggregateId)
    && validIdentifier(input.routeKey)
    && validIdentifier(input.cardSchemaVersion)
    && Number.isSafeInteger(input.aggregateRevision)
    && input.aggregateRevision >= 0
    && validTimestamp(input.createdAt);
}

export function buildNotificationIntentV1(input) {
  if (!exactKeys(input, INTENT_INPUT_KEYS)) return invalid();
  const admission = NOTIFICATION_INTENT_ADMISSION_V1[input.intentType];
  if (!admission) return invalid();
  if (admission.status !== 'WIRED') {
    return invalid('NOTIFICATION_INTENT_NOT_WIRED', { intentType: input.intentType });
  }
  if (!validCommonInput(input)) return invalid();
  const spec = INTENT_SPEC.get(input.intentType);
  const cardValidation = validateDingTalkCardV1(input.payload);
  if (
    !spec
    || input.aggregateType !== spec.aggregateType
    || input.aggregateRevisionScope !== admission.aggregateRevisionScope
    || input.cardSchemaVersion !== spec.cardSchemaVersion
    || !cardValidation.ok
    || cardValidation.cardSchemaVersion !== spec.cardSchemaVersion
  ) return invalid();

  let payloadJson;
  let payloadDigest;
  try {
    payloadJson = canonicalJsonV1(input.payload);
    payloadDigest = digestCanonicalJsonV1(input.payload);
  } catch {
    return invalid();
  }
  const dedupeKey = [
    'dingtalk', input.cardSchemaVersion, input.intentType, input.aggregateType,
    input.aggregateId, input.aggregateRevisionScope, String(input.aggregateRevision),
  ].join(':');
  const intent = Object.freeze({
    outboxId: input.outboxId,
    dedupeKey,
    intentType: input.intentType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    routeKey: input.routeKey,
    aggregateRevisionScope: input.aggregateRevisionScope,
    aggregateRevision: input.aggregateRevision,
    cardSchemaVersion: input.cardSchemaVersion,
    deliveryPolicyVersion: OUTBOX_DISPATCH_POLICY_V1.policyVersion,
    payloadJson,
    payloadDigest,
    createdAt: input.createdAt,
  });
  return Object.freeze({ ok: true, intent });
}

const DEDUPE_EQUIVALENCE_FIELDS = Object.freeze([
  'dedupeKey', 'intentType', 'aggregateType', 'aggregateId', 'routeKey',
  'aggregateRevisionScope', 'aggregateRevision', 'cardSchemaVersion',
  'deliveryPolicyVersion', 'payloadJson', 'payloadDigest',
]);

export function compareNotificationIntentV1(existing, candidate) {
  if (!exactKeys(existing, INTENT_KEYS) || !exactKeys(candidate, INTENT_KEYS)) {
    return invalid('OUTBOX_DEDUPE_MISMATCH');
  }
  const equivalent = DEDUPE_EQUIVALENCE_FIELDS.every(field => existing[field] === candidate[field]);
  if (!equivalent) return invalid('OUTBOX_DEDUPE_MISMATCH');
  return Object.freeze({ ok: true, code: 'OUTBOX_EXACT_NOOP', outboxId: existing.outboxId });
}
