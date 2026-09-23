export const KIOSK_EVENT_TIME_POLICY_VERSION = 'kiosk-event-time-local-v1';
export const KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS = 24 * 60 * 60 * 1000;

export const KIOSK_EVENT_TIME_POLICY = Object.freeze({
  policyVersion: KIOSK_EVENT_TIME_POLICY_VERSION,
  maximumFutureSkewMs: KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS,
  maximumOfflineAgeMs: KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS,
});

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function timestampMillis(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function invalid(code, field) {
  return Object.freeze({
    ok: false,
    code,
    field,
    policyVersion: KIOSK_EVENT_TIME_POLICY_VERSION,
  });
}

function review(reviewReason) {
  return Object.freeze({
    ok: false,
    code: 'EVENT_TIME_REVIEW_REQUIRED',
    reviewReason,
    policyVersion: KIOSK_EVENT_TIME_POLICY_VERSION,
  });
}

export function evaluateKioskEventTime({ occurredAt, receivedAt } = {}) {
  const occurredAtMillis = timestampMillis(occurredAt);
  if (occurredAtMillis === null) return invalid('INVALID_EVENT_TIME', 'occurredAt');
  const receivedAtMillis = timestampMillis(receivedAt);
  if (receivedAtMillis === null) return invalid('INVALID_RECEIVED_TIME', 'receivedAt');

  if (occurredAtMillis > receivedAtMillis + KIOSK_EVENT_MAXIMUM_FUTURE_SKEW_MS) {
    return review('tooFarFuture');
  }
  if (occurredAtMillis < receivedAtMillis - KIOSK_EVENT_MAXIMUM_OFFLINE_AGE_MS) {
    return review('tooOld');
  }
  return Object.freeze({
    ok: true,
    decision: 'allow',
    policyVersion: KIOSK_EVENT_TIME_POLICY_VERSION,
  });
}
