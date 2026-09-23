import {
  classifyDingTalkFailureV1,
  normalizeDingTalkResultV1,
} from './dingtalk-port-v1.mjs';
import { validateDingTalkCardV1 } from './dingtalk-card-builders-v1.mjs';
import { OUTBOX_DISPATCH_POLICY_V1 } from './outbox-contract-v1.mjs';

const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const SQLITE_BUSY_CODES = new Set([5, 261, 517, 773]);
const SETTLE_SUCCESS_CODES = new Set([
  'OUTBOX_SENT', 'OUTBOX_RETRY_SCHEDULED', 'OUTBOX_DEAD_LETTERED',
]);

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validOpaque(value, maxCodePoints) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && [...value].length <= maxCodePoints
    && /\S/u.test(value)
    && !CONTROL_OR_LINE_SEPARATOR.test(value);
}

function summary({
  ok,
  code,
  claimedCount = 0,
  sentCount = 0,
  retryableFailureCount = 0,
  nonRetryableFailureCount = 0,
  settlementFailureCount = 0,
}) {
  return Object.freeze({
    ok,
    code,
    claimedCount,
    sentCount,
    retryableFailureCount,
    nonRetryableFailureCount,
    settlementFailureCount,
  });
}

function validReadiness(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (value.ok === true) return keys.length === 1 && keys[0] === 'ok';
  return value.ok === false
    && value.code === 'DINGTALK_NOT_CONFIGURED'
    && keys.length === 2
    && keys.every(key => key === 'ok' || key === 'code');
}

function validClaimedItem(value) {
  return isRecord(value)
    && validOpaque(value.outboxId, 160)
    && validOpaque(value.leaseToken, 128)
    && validOpaque(value.dedupeKey, 1024)
    && validOpaque(value.routeKey, 128)
    && validateDingTalkCardV1(value.card).ok;
}

function validClaimBatch(value, limit) {
  if (!Array.isArray(value) || value.length > limit) return false;
  const seen = new Set();
  for (const claimed of value) {
    if (!validClaimedItem(claimed) || seen.has(claimed.outboxId)) return false;
    seen.add(claimed.outboxId);
  }
  return true;
}

function normalizeClaimResult(value, limit) {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.code !== 'string') return null;
  if (value.ok === false) {
    if (!Array.isArray(value.items) || value.items.length !== 0) return null;
    return { ok: false, code: value.code };
  }
  if (
    value.code !== 'OUTBOX_CLAIMED'
    || !validClaimBatch(value.items, limit)
    || !Number.isSafeInteger(value.expiredDeadLettered)
    || value.expiredDeadLettered < 0
  ) return null;
  return { ok: true, items: value.items };
}

function validSettleResult(value) {
  return isRecord(value)
    && value.ok === true
    && SETTLE_SUCCESS_CODES.has(value.code);
}

function clockIso(clock) {
  try {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
    return value.toISOString();
  } catch {
    return null;
  }
}

function isBusy(error) {
  return error?.code === 'SQLITE_BUSY'
    || error?.code === 'SQLITE_BUSY_SNAPSHOT'
    || SQLITE_BUSY_CODES.has(error?.errcode);
}

async function deliverWithTimeout({ adapter, input, timeoutMs, setTimer, clearTimer }) {
  let timerToken;
  const timeout = new Promise(resolve => {
    timerToken = setTimer(
      () => resolve(Object.freeze({ ok: false, code: 'DINGTALK_TIMEOUT' })),
      timeoutMs,
    );
  });
  const delivery = Promise.resolve()
    .then(() => adapter.sendCard(input))
    .then(
      value => normalizeDingTalkResultV1(value, { operation: 'sendCard' }),
      () => Object.freeze({ ok: false, code: 'DINGTALK_TRANSPORT_ERROR' }),
    );
  try {
    return await Promise.race([delivery, timeout]);
  } catch {
    return Object.freeze({ ok: false, code: 'DINGTALK_TRANSPORT_ERROR' });
  } finally {
    try {
      clearTimer(timerToken);
    } catch {
      // Timer cleanup is best-effort and must not expose runtime errors or replace delivery results.
    }
  }
}

async function waitForRetry(delay, setTimer) {
  try {
    await new Promise((resolve, reject) => {
      try {
        setTimer(resolve, delay);
      } catch (error) {
        reject(error);
      }
    });
    return true;
  } catch {
    return false;
  }
}

async function settleWithBusyRetry({ repository, input, policy, setTimer }) {
  for (let attempt = 0; attempt <= policy.resultRetryMs.length; attempt += 1) {
    let settlement;
    let settlementError;
    try {
      settlement = await repository.settleDelivery(input);
    } catch (error) {
      settlementError = error;
    }
    const busy = (settlement?.ok === false && settlement.code === 'STORE_BUSY')
      || isBusy(settlementError);
    if (!busy) return settlementError === undefined ? settlement : null;
    if (attempt === policy.resultRetryMs.length) return null;
    if (!await waitForRetry(policy.resultRetryMs[attempt], setTimer)) return null;
  }
  return null;
}

export function createOutboxDispatcherV1({
  repository,
  dingTalkAdapter,
  clock = () => new Date(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  policy = OUTBOX_DISPATCH_POLICY_V1,
} = {}) {
  if (
    !repository
    || typeof repository.claimBatch !== 'function'
    || typeof repository.settleDelivery !== 'function'
  ) throw new TypeError('repository claimBatch/settleDelivery ports are required');
  if (
    !dingTalkAdapter
    || typeof dingTalkAdapter.readiness !== 'function'
    || typeof dingTalkAdapter.sendCard !== 'function'
  ) throw new TypeError('DingTalk readiness/sendCard ports are required');
  if (typeof clock !== 'function') throw new TypeError('clock is required');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('timer ports are required');
  }
  if (
    !isRecord(policy)
    || !Number.isSafeInteger(policy.batchSize)
    || policy.batchSize < 1
    || !Number.isSafeInteger(policy.deliveryTimeoutMs)
    || policy.deliveryTimeoutMs < 1
    || !Number.isSafeInteger(policy.resultBusyTimeoutMs)
    || policy.resultBusyTimeoutMs < 1
    || !Array.isArray(policy.resultRetryMs)
    || policy.resultRetryMs.some(delay => !Number.isSafeInteger(delay) || delay < 0)
  ) throw new TypeError('valid outbox dispatch policy is required');

  async function dispatchOnce({ workerId } = {}) {
    if (!validOpaque(workerId, 128)) {
      return summary({ ok: false, code: 'OUTBOX_INVALID_WORKER' });
    }

    let readiness;
    try {
      readiness = await dingTalkAdapter.readiness();
    } catch {
      return summary({ ok: false, code: 'DINGTALK_TRANSPORT_ERROR' });
    }
    if (!validReadiness(readiness)) {
      return summary({ ok: false, code: 'DINGTALK_ADAPTER_PROTOCOL_ERROR' });
    }
    if (!readiness.ok) return summary({ ok: false, code: readiness.code });

    const claimTime = clockIso(clock);
    if (claimTime === null) return summary({ ok: false, code: 'OUTBOX_CLOCK_ERROR' });

    let rawClaim;
    try {
      rawClaim = await repository.claimBatch({
        workerId,
        now: claimTime,
        limit: policy.batchSize,
      });
    } catch (error) {
      return summary({ ok: false, code: isBusy(error) ? 'OUTBOX_STORE_BUSY' : 'OUTBOX_STORE_ERROR' });
    }
    const claim = normalizeClaimResult(rawClaim, policy.batchSize);
    if (claim === null) {
      return summary({ ok: false, code: 'OUTBOX_REPOSITORY_PROTOCOL_ERROR' });
    }
    if (!claim.ok) {
      return summary({
        ok: false,
        code: claim.code === 'STORE_BUSY' ? 'OUTBOX_STORE_BUSY' : 'OUTBOX_STORE_ERROR',
      });
    }
    const claimed = claim.items;
    if (claimed.length === 0) return summary({ ok: true, code: 'OUTBOX_DISPATCH_IDLE' });

    const outcomes = await Promise.all(claimed.map(async claimedItem => {
      const adapterInput = Object.freeze({
        dedupeKey: claimedItem.dedupeKey,
        routeKey: claimedItem.routeKey,
        card: Object.freeze({ ...claimedItem.card }),
      });
      const result = await deliverWithTimeout({
        adapter: dingTalkAdapter,
        input: adapterInput,
        timeoutMs: policy.deliveryTimeoutMs,
        setTimer,
        clearTimer,
      });
      const retryableFailure = !result.ok && classifyDingTalkFailureV1(result.code).retryable;

      // A post-send clock fault must not skip the settlement attempt; the already validated
      // claim timestamp is the bounded fallback and keeps the lease recoverable.
      const settledAt = clockIso(clock) ?? claimTime;
      const settlement = await settleWithBusyRetry({
        repository,
        input: {
          outboxId: claimedItem.outboxId,
          leaseToken: claimedItem.leaseToken,
          result,
          now: settledAt,
        },
        policy,
        setTimer,
      });
      const settlementSucceeded = validSettleResult(settlement);
      return Object.freeze({
        sent: result.ok && settlementSucceeded && settlement.code === 'OUTBOX_SENT',
        retryableFailure,
        nonRetryableFailure: !result.ok && !retryableFailure,
        settlementFailed: !settlementSucceeded,
      });
    }));

    const sentCount = outcomes.filter(outcome => outcome.sent).length;
    const retryableFailureCount = outcomes.filter(outcome => outcome.retryableFailure).length;
    const nonRetryableFailureCount = outcomes.filter(outcome => outcome.nonRetryableFailure).length;
    const settlementFailureCount = outcomes.filter(outcome => outcome.settlementFailed).length;

    return summary({
      ok: settlementFailureCount === 0,
      code: settlementFailureCount === 0 ? 'OUTBOX_DISPATCH_COMPLETED' : 'OUTBOX_SETTLEMENT_INCOMPLETE',
      claimedCount: claimed.length,
      sentCount,
      retryableFailureCount,
      nonRetryableFailureCount,
      settlementFailureCount,
    });
  }

  return Object.freeze({ dispatchOnce });
}
