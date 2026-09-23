import assert from 'node:assert/strict';
import test from 'node:test';

import { createOutboxWorkerV1 } from '../src/outbox-worker-v1.mjs';

function summary(code, claimedCount = 0) {
  return Object.freeze({
    ok: !['OUTBOX_STORE_BUSY', 'OUTBOX_STORE_ERROR'].includes(code),
    code,
    claimedCount,
    sentCount: 0,
    retryableFailureCount: 0,
    nonRetryableFailureCount: 0,
    settlementFailureCount: 0,
  });
}

function timerHarness() {
  let sequence = 0;
  const pending = new Map();
  const scheduledDelays = [];
  return {
    scheduledDelays,
    setTimer(callback, delay) {
      sequence += 1;
      pending.set(sequence, { callback, delay });
      scheduledDelays.push(delay);
      return sequence;
    },
    clearTimer(token) {
      pending.delete(token);
    },
    pendingCount() {
      return pending.size;
    },
    nextDelay() {
      return pending.values().next().value?.delay ?? null;
    },
    fireNext() {
      const entry = pending.entries().next().value;
      assert.ok(entry, 'expected a scheduled timer');
      const [token, timer] = entry;
      pending.delete(token);
      return timer.callback();
    },
  };
}

function createWorker({ results = [], dispatchOnce, random = () => 0.5 } = {}) {
  const timers = timerHarness();
  const calls = [];
  const dispatcher = {
    async dispatchOnce(input) {
      calls.push(input);
      if (dispatchOnce) return dispatchOnce(input);
      return results.shift() ?? summary('OUTBOX_DISPATCH_IDLE');
    },
  };
  return {
    calls,
    timers,
    worker: createOutboxWorkerV1({
      dispatcher,
      workerId: 'WORKER-0001',
      random,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    }),
  };
}

test('idle polling uses deterministic symmetric jitter around idlePollMs', async () => {
  const randomValues = [0, 1];
  const { worker, timers, calls } = createWorker({
    results: [summary('OUTBOX_DISPATCH_IDLE'), summary('OUTBOX_DISPATCH_IDLE')],
    random: () => randomValues.shift(),
  });

  assert.deepEqual(worker.start(), { ok: true, code: 'OUTBOX_WORKER_STARTED' });
  assert.equal(timers.nextDelay(), 0);
  await timers.fireNext();
  assert.equal(timers.nextDelay(), 1_500);
  await timers.fireNext();
  assert.equal(timers.nextDelay(), 2_500);
  assert.deepEqual(calls, [{ workerId: 'WORKER-0001' }, { workerId: 'WORKER-0001' }]);
  await worker.stop();
});

test('store busy uses 250→500→1000→2000ms capped backoff and resets after nonbusy', async () => {
  const results = [
    ...Array.from({ length: 5 }, () => summary('OUTBOX_STORE_BUSY')),
    summary('OUTBOX_DISPATCH_IDLE'),
    summary('OUTBOX_STORE_BUSY'),
  ];
  const { worker, timers } = createWorker({ results });
  worker.start();

  const observed = [];
  for (let index = 0; index < 5; index += 1) {
    await timers.fireNext();
    observed.push(timers.nextDelay());
  }
  assert.deepEqual(observed, [250, 500, 1_000, 2_000, 2_000]);

  await timers.fireNext();
  assert.equal(timers.nextDelay(), 2_000);
  await timers.fireNext();
  assert.equal(timers.nextDelay(), 250);
  await worker.stop();
});

test('wake cancels a pending timer and schedules one immediate run', async () => {
  const { worker, timers } = createWorker({ results: [summary('OUTBOX_DISPATCH_IDLE')] });
  worker.start();
  await timers.fireNext();
  assert.equal(timers.nextDelay(), 2_000);

  assert.deepEqual(worker.wake(), { ok: true, code: 'OUTBOX_WORKER_WOKEN' });
  assert.equal(timers.pendingCount(), 1);
  assert.equal(timers.nextDelay(), 0);
  await worker.stop();
  assert.equal(timers.pendingCount(), 0);
});

test('wake during an in-flight batch only records one pending wake', async () => {
  let resolveDispatch;
  const pendingDispatch = new Promise(resolve => { resolveDispatch = resolve; });
  const { worker, timers } = createWorker({ dispatchOnce: () => pendingDispatch });
  worker.start();
  const runningCycle = timers.fireNext();
  await Promise.resolve();

  assert.deepEqual(worker.wake(), { ok: true, code: 'OUTBOX_WORKER_WAKE_PENDING' });
  assert.deepEqual(worker.wake(), { ok: true, code: 'OUTBOX_WORKER_WAKE_PENDING' });
  assert.equal(timers.pendingCount(), 0);
  resolveDispatch(summary('OUTBOX_DISPATCH_IDLE'));
  await runningCycle;
  assert.equal(timers.pendingCount(), 1);
  assert.equal(timers.nextDelay(), 0);
  await worker.stop();
});

test('wake during store busy schedules immediately but preserves the busy streak', async () => {
  let resolveDispatch;
  const first = new Promise(resolve => { resolveDispatch = resolve; });
  const results = [first, summary('OUTBOX_STORE_BUSY')];
  const { worker, timers } = createWorker({ dispatchOnce: () => results.shift() });
  worker.start();
  const runningCycle = timers.fireNext();
  await Promise.resolve();
  worker.wake();
  resolveDispatch(summary('OUTBOX_STORE_BUSY'));
  await runningCycle;
  assert.equal(timers.nextDelay(), 0);
  await timers.fireNext();
  assert.equal(timers.nextDelay(), 500);
  await worker.stop();
});

test('stop during in-flight waits for the finite batch and prevents another claim', async () => {
  let resolveDispatch;
  const pendingDispatch = new Promise(resolve => { resolveDispatch = resolve; });
  const { worker, timers, calls } = createWorker({ dispatchOnce: () => pendingDispatch });
  worker.start();
  const runningCycle = timers.fireNext();
  await Promise.resolve();

  let stopped = false;
  const stopping = worker.stop().then(result => { stopped = true; return result; });
  assert.equal(stopped, false);
  assert.deepEqual(worker.wake(), { ok: false, code: 'OUTBOX_WORKER_NOT_RUNNING' });
  resolveDispatch(summary('OUTBOX_DISPATCH_COMPLETED', 2));
  await runningCycle;
  assert.deepEqual(await stopping, { ok: true, code: 'OUTBOX_WORKER_STOPPED' });
  assert.equal(timers.pendingCount(), 0);
  assert.equal(calls.length, 1);
});

test('start and stop are idempotent, and a fully stopped worker can restart', async () => {
  const { worker, timers } = createWorker();
  assert.deepEqual(worker.start(), { ok: true, code: 'OUTBOX_WORKER_STARTED' });
  assert.deepEqual(worker.start(), { ok: true, code: 'OUTBOX_WORKER_ALREADY_STARTED' });
  assert.equal(timers.pendingCount(), 1);

  assert.deepEqual(await worker.stop(), { ok: true, code: 'OUTBOX_WORKER_STOPPED' });
  assert.deepEqual(await worker.stop(), { ok: true, code: 'OUTBOX_WORKER_ALREADY_STOPPED' });
  assert.equal(timers.pendingCount(), 0);
  assert.deepEqual(worker.status(), {
    code: 'OUTBOX_WORKER_STOPPED', running: false, inFlight: false, scheduled: false, wakePending: false,
  });

  assert.deepEqual(worker.start(), { ok: true, code: 'OUTBOX_WORKER_STARTED' });
  assert.equal(timers.pendingCount(), 1);
  await worker.stop();
});
