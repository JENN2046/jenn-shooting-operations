export const KIOSK_POLL_INTERVAL_MS = 3000;
export const KIOSK_MAX_BACKOFF_MS = 30000;
export const KIOSK_LEASE_DURATION_MS = 8000;
export const KIOSK_LEASE_HEARTBEAT_MS = 2500;

export function nextKioskPollDelay(failureCount) {
  const count = Number.isSafeInteger(failureCount) && failureCount > 0 ? failureCount : 0;
  return Math.min(KIOSK_POLL_INTERVAL_MS * (2 ** Math.min(count, 10)), KIOSK_MAX_BACKOFF_MS);
}

export function validateBlockingInput(reasonCode, note = '') {
  const allowed = new Set([
    'sampleWaiting',
    'specConfirming',
    'deviceIssue',
    'talentWaiting',
    'siteIssue',
    'other',
  ]);
  if (!allowed.has(reasonCode)) return { ok: false, code: 'BLOCK_REASON_REQUIRED' };
  if (reasonCode === 'other' && (typeof note !== 'string' || note.trim() === '')) {
    return { ok: false, code: 'BLOCK_NOTE_REQUIRED' };
  }
  return { ok: true };
}

export function deriveKioskActionState({
  serverItem,
  pendingItems = [],
  controlling = false,
  busy = false,
} = {}) {
  if (!serverItem || !Array.isArray(pendingItems)) {
    return { state: 'none', unconfirmed: false, actions: [] };
  }
  let state = serverItem.runState;
  let runId = serverItem.runId;
  let revision = serverItem.runRevision;
  let unconfirmed = false;
  for (const item of pendingItems) {
    if (
      item.scheduleItemId !== serverItem.scheduleItemId
      || (runId !== null && item.runId !== runId)
      || (runId === null && item.eventType !== 'start')
      || item.expectedRunRevision !== revision
    ) {
      return {
        state,
        runId,
        expectedRunRevision: revision,
        unconfirmed: pendingItems.length > 0,
        invalidPendingContext: true,
        actions: [],
      };
    }
    if (runId === null) runId = item.runId;
    const nextByEvent = {
      start: state === 'scheduled' ? 'shooting' : null,
      block: state === 'shooting' ? 'blocked' : null,
      resume: state === 'blocked' ? 'shooting' : null,
      complete: state === 'shooting' ? 'completed' : null,
    };
    if (nextByEvent[item.eventType] === null) {
      return {
        state,
        runId,
        expectedRunRevision: revision,
        unconfirmed: true,
        invalidPendingContext: true,
        actions: [],
      };
    }
    state = nextByEvent[item.eventType];
    revision += 1;
    unconfirmed = true;
  }
  const actionsByState = {
    scheduled: ['start'],
    shooting: ['block', 'complete'],
    blocked: ['resume'],
    completed: [],
    cancelled: [],
  };
  return {
    state,
    runId,
    expectedRunRevision: revision,
    unconfirmed,
    actions: controlling && !busy ? (actionsByState[state] ?? []) : [],
  };
}

export function createVisibilityPoller({
  documentTarget,
  task,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!documentTarget || typeof documentTarget.addEventListener !== 'function') {
    throw new TypeError('documentTarget is required');
  }
  if (typeof task !== 'function') throw new TypeError('task is required');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('timer functions are required');
  }
  let stopped = true;
  let running = false;
  let timer = null;
  let failures = 0;

  function clearScheduled() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    clearScheduled();
    if (stopped || documentTarget.visibilityState !== 'visible') return;
    timer = setTimer(run, nextKioskPollDelay(failures));
  }

  async function run() {
    if (stopped || running || documentTarget.visibilityState !== 'visible') return;
    running = true;
    let succeeded = false;
    try {
      succeeded = await task() === true;
    } catch {
      succeeded = false;
    } finally {
      failures = succeeded ? 0 : Math.min(failures + 1, 10);
      running = false;
      schedule();
    }
  }

  function visibilityChanged() {
    clearScheduled();
    if (!stopped && documentTarget.visibilityState === 'visible') void run();
  }

  return Object.freeze({
    start() {
      if (!stopped) return;
      stopped = false;
      documentTarget.addEventListener('visibilitychange', visibilityChanged);
      if (documentTarget.visibilityState === 'visible') void run();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearScheduled();
      documentTarget.removeEventListener('visibilitychange', visibilityChanged);
    },
    refresh() {
      clearScheduled();
      return run();
    },
    inspect() {
      return { stopped, running, failures };
    },
  });
}

function parseLease(raw) {
  if (raw === null) return { ok: true, lease: null };
  try {
    const value = JSON.parse(raw);
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || Object.keys(value).length !== 2
      || typeof value.ownerId !== 'string'
      || value.ownerId === ''
      || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt < 0
    ) return { ok: false };
    return { ok: true, lease: value };
  } catch {
    return { ok: false };
  }
}

export function createKioskControlLock({
  locks,
  storage,
  eventTarget,
  ownerId,
  clock = () => Date.now(),
  setRepeating = globalThis.setInterval,
  clearRepeating = globalThis.clearInterval,
  key = 'jenn.kiosk.control-lock.v2',
  onChange = () => {},
} = {}) {
  if (typeof ownerId !== 'string' || ownerId === '') throw new TypeError('ownerId is required');
  if (typeof clock !== 'function' || typeof onChange !== 'function') throw new TypeError('callbacks are required');
  let stopped = true;
  let controlling = false;
  let mode = locks && typeof locks.request === 'function' ? 'web-lock' : 'lease';
  let interval = null;
  let releaseWebLock = null;
  let status = 'idle';

  function publish(nextStatus) {
    controlling = nextStatus === 'controlling';
    if (nextStatus === status) return;
    status = nextStatus;
    onChange(Object.freeze({ mode, status, controlling }));
  }

  function currentLease() {
    try {
      return parseLease(storage.getItem(key));
    } catch {
      return { ok: false };
    }
  }

  function writeLease() {
    const expiresAt = clock() + KIOSK_LEASE_DURATION_MS;
    try {
      storage.setItem(key, JSON.stringify({ ownerId, expiresAt }));
    } catch {
      return false;
    }
    const readBack = currentLease();
    return readBack.ok
      && readBack.lease?.ownerId === ownerId
      && readBack.lease.expiresAt === expiresAt;
  }

  function attemptLease() {
    const observed = currentLease();
    if (!observed.ok || (observed.lease && observed.lease.expiresAt > clock() && observed.lease.ownerId !== ownerId)) {
      publish('readOnly');
      return;
    }
    publish(writeLease() ? 'controlling' : 'readOnly');
  }

  function heartbeat() {
    if (stopped) return;
    if (!controlling) {
      attemptLease();
      return;
    }
    const observed = currentLease();
    if (!observed.ok || observed.lease?.ownerId !== ownerId || !writeLease()) {
      publish('readOnly');
    }
  }

  function storageChanged(event) {
    if (event.key !== key) return;
    const observed = parseLease(event.newValue);
    if (controlling && (
      !observed.ok
      || observed.lease?.ownerId !== ownerId
      || observed.lease.expiresAt <= clock()
    )) {
      publish('readOnly');
      return;
    }
    if (!controlling && observed.ok && (!observed.lease || observed.lease.expiresAt <= clock())) attemptLease();
  }

  function startLease() {
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
    ) {
      publish('readOnly');
      return;
    }
    eventTarget?.addEventListener?.('storage', storageChanged);
    attemptLease();
    interval = setRepeating(heartbeat, KIOSK_LEASE_HEARTBEAT_MS);
  }

  function startWebLock() {
    publish('acquiring');
    let request;
    try {
      request = locks.request(
        'jenn.kiosk.control.v2',
        { mode: 'exclusive', ifAvailable: true },
        async lock => {
          if (stopped) return;
          if (!lock) {
            publish('readOnly');
            return;
          }
          publish('controlling');
          await new Promise(resolve => { releaseWebLock = resolve; });
        },
      );
    } catch {
      publish('readOnly');
      return;
    }
    Promise.resolve(request).catch(() => {
      if (!stopped) publish('readOnly');
    });
  }

  return Object.freeze({
    start() {
      if (!stopped) return;
      stopped = false;
      if (mode === 'web-lock') startWebLock();
      else startLease();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      releaseWebLock?.();
      releaseWebLock = null;
      if (interval !== null) clearRepeating(interval);
      interval = null;
      eventTarget?.removeEventListener?.('storage', storageChanged);
      if (mode === 'lease' && controlling) {
        const observed = currentLease();
        if (observed.ok && observed.lease?.ownerId === ownerId) {
          try { storage.removeItem?.(key); } catch {}
        }
      }
      controlling = false;
      status = 'stopped';
    },
    inspect() {
      return Object.freeze({ mode, controlling, stopped });
    },
  });
}
