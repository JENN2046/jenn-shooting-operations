import { OUTBOX_DISPATCH_POLICY_V1 } from './outbox-contract-v1.mjs';

function frozen(value) {
  return Object.freeze(value);
}

function validPolicy(policy) {
  return policy !== null
    && typeof policy === 'object'
    && Number.isSafeInteger(policy.idlePollMs)
    && policy.idlePollMs >= 0
    && typeof policy.idlePollJitterRatio === 'number'
    && Number.isFinite(policy.idlePollJitterRatio)
    && policy.idlePollJitterRatio >= 0
    && policy.idlePollJitterRatio <= 1
    && Number.isSafeInteger(policy.busyBaseDelayMs)
    && policy.busyBaseDelayMs >= 0
    && Number.isSafeInteger(policy.busyMaxDelayMs)
    && policy.busyMaxDelayMs >= policy.busyBaseDelayMs;
}

function validWorkerId(workerId) {
  return typeof workerId === 'string'
    && workerId.length > 0
    && workerId === workerId.trim()
    && [...workerId].length <= 128
    && /\S/u.test(workerId)
    && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(workerId);
}

function safeRandom(random) {
  try {
    const value = random();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : 0.5;
  } catch {
    return 0.5;
  }
}

function idleDelay(policy, random) {
  const offset = (safeRandom(random) * 2) - 1;
  return Math.max(0, Math.round(policy.idlePollMs * (1 + offset * policy.idlePollJitterRatio)));
}

function busyDelay(policy, busyStreak) {
  return Math.min(policy.busyBaseDelayMs * (2 ** busyStreak), policy.busyMaxDelayMs);
}

function validDispatchResult(result) {
  return result !== null
    && typeof result === 'object'
    && !Array.isArray(result)
    && typeof result.code === 'string'
    && Number.isSafeInteger(result.claimedCount)
    && result.claimedCount >= 0;
}

export function createOutboxWorkerV1({
  dispatcher,
  workerId,
  policy = OUTBOX_DISPATCH_POLICY_V1,
  random = Math.random,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!dispatcher || typeof dispatcher.dispatchOnce !== 'function') {
    throw new TypeError('dispatcher dispatchOnce port is required');
  }
  if (!validWorkerId(workerId)) throw new TypeError('valid workerId is required');
  if (!validPolicy(policy)) throw new TypeError('valid outbox worker policy is required');
  if (typeof random !== 'function') throw new TypeError('random port is required');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('timer ports are required');
  }

  let running = false;
  let inFlight = null;
  let timerToken = null;
  let wakePending = false;
  let busyStreak = 0;
  let stopPromise = null;
  let resolveStop = null;

  function clearScheduledTimer() {
    if (timerToken === null) return;
    const token = timerToken;
    timerToken = null;
    try {
      clearTimer(token);
    } catch {
      // Timer cleanup is best-effort; running state remains authoritative.
    }
  }

  function finishPendingStop() {
    if (resolveStop === null) return;
    const resolve = resolveStop;
    resolveStop = null;
    stopPromise = null;
    resolve(frozen({ ok: true, code: 'OUTBOX_WORKER_STOPPED' }));
  }

  function schedule(delay) {
    if (!running || timerToken !== null || inFlight !== null) return true;
    try {
      timerToken = setTimer(runCycle, delay);
      return true;
    } catch {
      timerToken = null;
      running = false;
      wakePending = false;
      finishPendingStop();
      return false;
    }
  }

  async function runCycle() {
    timerToken = null;
    if (!running || inFlight !== null) return;

    const task = Promise.resolve().then(() => dispatcher.dispatchOnce({ workerId }));
    inFlight = task;
    let result;
    try {
      result = await task;
    } catch {
      result = frozen({ ok: false, code: 'OUTBOX_DISPATCH_EXCEPTION', claimedCount: 0 });
    } finally {
      inFlight = null;
    }

    if (!running) {
      finishPendingStop();
      return;
    }
    const storeBusy = validDispatchResult(result) && result.code === 'OUTBOX_STORE_BUSY';
    let nextBusyDelay = null;
    if (storeBusy) {
      nextBusyDelay = busyDelay(policy, busyStreak);
      busyStreak += 1;
    } else {
      busyStreak = 0;
    }

    if (wakePending) {
      wakePending = false;
      schedule(0);
      return;
    }
    if (storeBusy) {
      schedule(nextBusyDelay);
      return;
    }

    if (
      validDispatchResult(result)
      && result.code === 'OUTBOX_DISPATCH_COMPLETED'
      && result.claimedCount > 0
    ) {
      schedule(0);
      return;
    }
    schedule(idleDelay(policy, random));
  }

  function start() {
    if (running) return frozen({ ok: true, code: 'OUTBOX_WORKER_ALREADY_STARTED' });
    if (inFlight !== null || stopPromise !== null) {
      return frozen({ ok: false, code: 'OUTBOX_WORKER_STOPPING' });
    }
    running = true;
    wakePending = false;
    busyStreak = 0;
    if (!schedule(0)) return frozen({ ok: false, code: 'OUTBOX_WORKER_TIMER_ERROR' });
    return frozen({ ok: true, code: 'OUTBOX_WORKER_STARTED' });
  }

  function wake() {
    if (!running) return frozen({ ok: false, code: 'OUTBOX_WORKER_NOT_RUNNING' });
    if (inFlight !== null) {
      wakePending = true;
      return frozen({ ok: true, code: 'OUTBOX_WORKER_WAKE_PENDING' });
    }
    clearScheduledTimer();
    if (!schedule(0)) return frozen({ ok: false, code: 'OUTBOX_WORKER_TIMER_ERROR' });
    return frozen({ ok: true, code: 'OUTBOX_WORKER_WOKEN' });
  }

  function stop() {
    if (!running) {
      if (stopPromise !== null) return stopPromise;
      return Promise.resolve(frozen({ ok: true, code: 'OUTBOX_WORKER_ALREADY_STOPPED' }));
    }
    running = false;
    wakePending = false;
    clearScheduledTimer();
    if (inFlight === null) {
      return Promise.resolve(frozen({ ok: true, code: 'OUTBOX_WORKER_STOPPED' }));
    }
    if (stopPromise === null) {
      stopPromise = new Promise(resolve => { resolveStop = resolve; });
    }
    return stopPromise;
  }

  function status() {
    return frozen({
      code: running ? 'OUTBOX_WORKER_RUNNING' : 'OUTBOX_WORKER_STOPPED',
      running,
      inFlight: inFlight !== null,
      scheduled: timerToken !== null,
      wakePending,
    });
  }

  return frozen({ start, stop, wake, status });
}
