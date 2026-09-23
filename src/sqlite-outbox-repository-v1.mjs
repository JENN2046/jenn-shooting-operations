import { randomUUID } from 'node:crypto';

import {
  OUTBOX_DISPATCH_POLICY_V1,
  compareNotificationIntentV1,
  digestCanonicalJsonV1,
  validateNotificationIntentV1,
} from './outbox-contract-v1.mjs';
import {
  classifyDingTalkFailureV1,
  normalizeDingTalkResultV1,
} from './dingtalk-port-v1.mjs';

const SQLITE_BUSY_CODES = new Set([5, 261, 517, 773]);
const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const OUTBOX_ROW_COLUMNS = `
  outbox_id, channel, dedupe_key, intent_type, aggregate_type, aggregate_id,
  aggregate_revision_scope, aggregate_revision, route_key, card_schema_version,
  delivery_policy_version, payload_json, payload_digest, status, attempt_count,
  available_at, lease_token, lease_owner, lease_expires_at, provider_ref,
  delivery_receipt_digest, last_error_code, created_at, updated_at, sent_at
`;

function result(code, details = {}) {
  return Object.freeze({ ok: false, code, ...details });
}

function success(code, details = {}) {
  return Object.freeze({ ok: true, code, ...details });
}

function isBusy(error) {
  return error?.code === 'SQLITE_BUSY'
    || error?.code === 'SQLITE_BUSY_SNAPSHOT'
    || SQLITE_BUSY_CODES.has(error?.errcode);
}

function validOpaque(value, maxCodePoints = 128) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= maxCodePoints
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

function validUtcIso(value) {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function addMilliseconds(timestamp, milliseconds) {
  const next = Date.parse(timestamp) + milliseconds;
  if (!Number.isSafeInteger(next)) return null;
  try {
    return new Date(next).toISOString();
  } catch {
    return null;
  }
}

function rollbackQuietly(db) {
  if (!db.isTransaction) return;
  try { db.exec('ROLLBACK'); } catch {}
}

function intentFromRow(row) {
  return {
    outboxId: row.outbox_id,
    dedupeKey: row.dedupe_key,
    intentType: row.intent_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    routeKey: row.route_key,
    aggregateRevisionScope: row.aggregate_revision_scope,
    aggregateRevision: row.aggregate_revision,
    cardSchemaVersion: row.card_schema_version,
    deliveryPolicyVersion: row.delivery_policy_version,
    payloadJson: row.payload_json,
    payloadDigest: row.payload_digest,
    createdAt: row.created_at,
  };
}

function recordFromRow(row) {
  if (!row) return null;
  return Object.freeze({
    outboxId: row.outbox_id,
    channel: row.channel,
    dedupeKey: row.dedupe_key,
    intentType: row.intent_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateRevisionScope: row.aggregate_revision_scope,
    aggregateRevision: row.aggregate_revision,
    routeKey: row.route_key,
    cardSchemaVersion: row.card_schema_version,
    deliveryPolicyVersion: row.delivery_policy_version,
    payloadJson: row.payload_json,
    payloadDigest: row.payload_digest,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    leaseToken: row.lease_token,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    providerRef: row.provider_ref,
    deliveryReceiptDigest: row.delivery_receipt_digest,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  });
}

function claimItem(row, leaseToken) {
  const card = JSON.parse(row.payload_json);
  return Object.freeze({
    outboxId: row.outbox_id,
    intentType: row.intent_type,
    dedupeKey: row.dedupe_key,
    routeKey: row.route_key,
    card: Object.freeze(card),
    leaseToken,
    attemptCount: row.attempt_count + 1,
  });
}

export function createSqliteOutboxRepositoryV1({
  db,
  tokenFactory = randomUUID,
  random = Math.random,
} = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('SQLite database is required');
  }
  if (typeof tokenFactory !== 'function') throw new TypeError('tokenFactory must be a function');
  if (typeof random !== 'function') throw new TypeError('random must be a function');

  const byId = db.prepare(`SELECT ${OUTBOX_ROW_COLUMNS} FROM notification_outbox WHERE outbox_id = ?`);
  const byDedupe = db.prepare(`SELECT ${OUTBOX_ROW_COLUMNS} FROM notification_outbox WHERE dedupe_key = ?`);
  const insert = db.prepare(`
    INSERT INTO notification_outbox (
      outbox_id, channel, dedupe_key, intent_type, aggregate_type, aggregate_id,
      aggregate_revision_scope, aggregate_revision, route_key, card_schema_version,
      delivery_policy_version, payload_json, payload_digest, status, attempt_count,
      available_at, created_at, updated_at
    ) VALUES (?, 'dingtalk', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `);

  function enqueue(intent) {
    if (!db.isTransaction) return result('OUTBOX_TRANSACTION_REQUIRED');
    const validation = validateNotificationIntentV1(intent);
    if (!validation.ok) return result(validation.code);
    try {
      const existingDedupe = byDedupe.get(intent.dedupeKey);
      if (existingDedupe) {
        const comparison = compareNotificationIntentV1(intentFromRow(existingDedupe), intent);
        if (!comparison.ok) return result('OUTBOX_DEDUPE_MISMATCH');
        return success('OUTBOX_EXACT_NOOP', {
          outboxId: existingDedupe.outbox_id,
          status: existingDedupe.status,
        });
      }
      if (byId.get(intent.outboxId)) return result('OUTBOX_ID_REUSE');
      const inserted = insert.run(
        intent.outboxId,
        intent.dedupeKey,
        intent.intentType,
        intent.aggregateType,
        intent.aggregateId,
        intent.aggregateRevisionScope,
        intent.aggregateRevision,
        intent.routeKey,
        intent.cardSchemaVersion,
        intent.deliveryPolicyVersion,
        intent.payloadJson,
        intent.payloadDigest,
        intent.createdAt,
        intent.createdAt,
        intent.createdAt,
      );
      if (inserted.changes !== 1) return result('OUTBOX_STORE_ERROR');
      return success('OUTBOX_ENQUEUED', {
        outboxId: intent.outboxId,
        status: 'pending',
      });
    } catch (error) {
      if (isBusy(error)) return result('STORE_BUSY');
      return result('OUTBOX_STORE_ERROR');
    }
  }

  function claimBatch({ workerId, now, limit } = {}) {
    if (
      db.isTransaction
      || !validOpaque(workerId)
      || !validUtcIso(now)
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > OUTBOX_DISPATCH_POLICY_V1.batchSize
    ) return result('OUTBOX_CLAIM_INVALID', { items: Object.freeze([]) });

    const leaseExpiresAt = addMilliseconds(now, OUTBOX_DISPATCH_POLICY_V1.leaseDurationMs);
    if (!leaseExpiresAt) return result('OUTBOX_CLAIM_INVALID', { items: Object.freeze([]) });
    try {
      db.exec('BEGIN IMMEDIATE');
      const expiredFinal = db.prepare(`
        UPDATE notification_outbox
        SET status = 'deadLetter', available_at = NULL,
            lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
            last_error_code = 'OUTBOX_DELIVERY_OUTCOME_UNKNOWN', updated_at = ?
        WHERE status = 'leased' AND attempt_count = ? AND lease_expires_at <= ?
      `).run(now, OUTBOX_DISPATCH_POLICY_V1.maxAttempts, now).changes;
      const eligible = db.prepare(`
        SELECT ${OUTBOX_ROW_COLUMNS}
        FROM notification_outbox
        WHERE
          (status = 'pending' AND attempt_count = 0 AND available_at <= ?)
          OR (status = 'retryableFailed' AND attempt_count BETWEEN 1 AND ? AND available_at <= ?)
          OR (status = 'leased' AND attempt_count BETWEEN 1 AND ? AND lease_expires_at <= ?)
        ORDER BY
          CASE WHEN status = 'leased' THEN lease_expires_at ELSE available_at END,
          created_at,
          outbox_id
        LIMIT ?
      `).all(
        now,
        OUTBOX_DISPATCH_POLICY_V1.maxAttempts - 1,
        now,
        OUTBOX_DISPATCH_POLICY_V1.maxAttempts - 1,
        now,
        limit,
      );
      const items = [];
      for (const row of eligible) {
        const leaseToken = tokenFactory();
        if (!validOpaque(leaseToken, 128)) throw new TypeError('invalid lease token');
        const claimed = db.prepare(`
          UPDATE notification_outbox
          SET status = 'leased', attempt_count = attempt_count + 1, available_at = NULL,
              lease_token = ?, lease_owner = ?, lease_expires_at = ?,
              provider_ref = NULL, delivery_receipt_digest = NULL,
              last_error_code = NULL, sent_at = NULL, updated_at = ?
          WHERE outbox_id = ? AND status = ? AND attempt_count = ?
            AND CASE WHEN status = 'leased' THEN lease_expires_at ELSE available_at END <= ?
        `).run(
          leaseToken,
          workerId,
          leaseExpiresAt,
          now,
          row.outbox_id,
          row.status,
          row.attempt_count,
          now,
        ).changes;
        if (claimed !== 1) throw new Error('claim compare-and-swap failed');
        items.push(claimItem(row, leaseToken));
      }
      db.exec('COMMIT');
      return success('OUTBOX_CLAIMED', {
        items: Object.freeze(items),
        expiredDeadLettered: expiredFinal,
      });
    } catch (error) {
      rollbackQuietly(db);
      if (isBusy(error)) return result('STORE_BUSY', { items: Object.freeze([]) });
      return result('OUTBOX_STORE_ERROR', { items: Object.freeze([]) });
    }
  }

  function settleDelivery({ outboxId, leaseToken, result: deliveryResult, now } = {}) {
    if (
      db.isTransaction
      || !validOpaque(outboxId, 160)
      || !validOpaque(leaseToken, 128)
      || !validUtcIso(now)
    ) return result('OUTBOX_SETTLE_INVALID');

    try {
      db.exec('BEGIN IMMEDIATE');
      const row = byId.get(outboxId);
      if (!row) {
        db.exec('COMMIT');
        return result('OUTBOX_NOT_FOUND');
      }
      if (row.status !== 'leased' || row.lease_token !== leaseToken) {
        db.exec('COMMIT');
        return result('OUTBOX_LEASE_MISMATCH');
      }
      if (row.lease_expires_at <= now) {
        db.exec('COMMIT');
        return result('OUTBOX_LEASE_EXPIRED');
      }

      const normalized = normalizeDingTalkResultV1(deliveryResult, { operation: 'sendCard' });
      if (normalized.ok) {
        const receiptDigest = digestCanonicalJsonV1({
          outboxId: row.outbox_id,
          dedupeKey: row.dedupe_key,
          payloadDigest: row.payload_digest,
          attemptCount: row.attempt_count,
          providerRef: normalized.providerRef,
          sentAt: now,
        });
        const settled = db.prepare(`
          UPDATE notification_outbox
          SET status = 'sent', available_at = NULL,
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
              provider_ref = ?, delivery_receipt_digest = ?, last_error_code = NULL,
              sent_at = ?, updated_at = ?
          WHERE outbox_id = ? AND status = 'leased' AND lease_token = ?
        `).run(normalized.providerRef, receiptDigest, now, now, outboxId, leaseToken).changes;
        if (settled !== 1) throw new Error('settle compare-and-swap failed');
        db.exec('COMMIT');
        return success('OUTBOX_SENT', {
          outboxId,
          status: 'sent',
          attemptCount: row.attempt_count,
          providerRef: normalized.providerRef,
          deliveryReceiptDigest: receiptDigest,
        });
      }

      const classification = classifyDingTalkFailureV1(normalized.code);
      if (classification.retryable && row.attempt_count < OUTBOX_DISPATCH_POLICY_V1.maxAttempts) {
        const randomValue = random();
        if (typeof randomValue !== 'number' || randomValue < 0 || randomValue >= 1) {
          throw new TypeError('random must return a value in [0, 1)');
        }
        const exponentialDelay = Math.min(
          OUTBOX_DISPATCH_POLICY_V1.retryBaseDelayMs * (2 ** (row.attempt_count - 1)),
          OUTBOX_DISPATCH_POLICY_V1.retryMaxDelayMs,
        );
        const requestedDelay = normalized.code === 'DINGTALK_RATE_LIMITED'
          ? Math.max(exponentialDelay, normalized.retryAfterMs ?? 0)
          : exponentialDelay;
        const jitter = Math.floor(requestedDelay * OUTBOX_DISPATCH_POLICY_V1.retryJitterRatio * randomValue);
        const delay = Math.min(
          OUTBOX_DISPATCH_POLICY_V1.retryMaxDelayMs,
          requestedDelay + jitter,
        );
        const availableAt = addMilliseconds(now, delay);
        if (!availableAt) throw new TypeError('retry time overflow');
        const settled = db.prepare(`
          UPDATE notification_outbox
          SET status = 'retryableFailed', available_at = ?,
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
              provider_ref = NULL, delivery_receipt_digest = NULL,
              last_error_code = ?, sent_at = NULL, updated_at = ?
          WHERE outbox_id = ? AND status = 'leased' AND lease_token = ?
        `).run(availableAt, normalized.code, now, outboxId, leaseToken).changes;
        if (settled !== 1) throw new Error('settle compare-and-swap failed');
        db.exec('COMMIT');
        return success('OUTBOX_RETRY_SCHEDULED', {
          outboxId,
          status: 'retryableFailed',
          attemptCount: row.attempt_count,
          lastErrorCode: normalized.code,
          availableAt,
        });
      }

      const settled = db.prepare(`
        UPDATE notification_outbox
        SET status = 'deadLetter', available_at = NULL,
            lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
            provider_ref = NULL, delivery_receipt_digest = NULL,
            last_error_code = ?, sent_at = NULL, updated_at = ?
        WHERE outbox_id = ? AND status = 'leased' AND lease_token = ?
      `).run(normalized.code, now, outboxId, leaseToken).changes;
      if (settled !== 1) throw new Error('settle compare-and-swap failed');
      db.exec('COMMIT');
      return success('OUTBOX_DEAD_LETTERED', {
        outboxId,
        status: 'deadLetter',
        attemptCount: row.attempt_count,
        lastErrorCode: normalized.code,
      });
    } catch (error) {
      rollbackQuietly(db);
      if (isBusy(error)) return result('STORE_BUSY');
      return result('OUTBOX_STORE_ERROR');
    }
  }

  function getById(id) {
    if (!validOpaque(id, 160)) return result('OUTBOX_ID_INVALID');
    try {
      const row = byId.get(id);
      return row
        ? success('OUTBOX_FOUND', { record: recordFromRow(row) })
        : result('OUTBOX_NOT_FOUND');
    } catch (error) {
      return isBusy(error) ? result('STORE_BUSY') : result('OUTBOX_STORE_ERROR');
    }
  }

  return Object.freeze({ enqueue, claimBatch, settleDelivery, getById });
}
