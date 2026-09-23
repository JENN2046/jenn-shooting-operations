import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import {
  KIOSK_MAX_BACKOFF_MS,
  KIOSK_POLL_INTERVAL_MS,
  createKioskControlLock,
  createVisibilityPoller,
  deriveKioskActionState,
  nextKioskPollDelay,
  validateBlockingInput,
} from '../public/kiosk-control-lock.js';
import { createHttpApp } from '../src/http-app.mjs';

const html = await readFile(new URL('../public/kiosk.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/kiosk.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/kiosk.css', import.meta.url), 'utf8');

async function getStatic(path) {
  const chunks = [];
  const headers = new Map();
  let status = null;
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.writeHead = (nextStatus, nextHeaders = {}) => {
    status = nextStatus;
    for (const [name, value] of Object.entries(nextHeaders)) headers.set(name.toLowerCase(), value);
  };
  const request = Readable.from([]);
  request.method = 'GET';
  request.url = path;
  request.headers = {};
  const finished = once(response, 'finish');
  await createHttpApp({ store: {} })(request, response);
  await finished;
  return { status, headers, body: Buffer.concat(chunks).toString('utf8') };
}

function serverItem(state = 'scheduled') {
  return {
    scheduleItemId: 'SCHEDULE-1',
    runId: state === 'scheduled' ? null : 'RUN-1',
    runRevision: state === 'scheduled' ? 0 : 4,
    runState: state,
  };
}

function pending(eventType, sequence, runId = 'RUN-NEW') {
  return {
    scheduleItemId: 'SCHEDULE-1',
    runId,
    eventType,
    expectedRunRevision: sequence,
    localSequence: sequence,
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
  };
}

function sharedStorage(targets = []) {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      values.set(key, value);
      for (const target of targets) target.dispatch('storage', { key, newValue: value });
    },
    removeItem(key) {
      values.delete(key);
      for (const target of targets) target.dispatch('storage', { key, newValue: null });
    },
  };
}

test('action state keeps server confirmation separate from immutable pending overlay', () => {
  assert.deepEqual(deriveKioskActionState({ serverItem: serverItem(), controlling: true }), {
    state: 'scheduled', runId: null, expectedRunRevision: 0, unconfirmed: false, actions: ['start'],
  });
  assert.deepEqual(deriveKioskActionState({
    serverItem: serverItem(),
    pendingItems: [pending('start', 0), pending('block', 1)],
    controlling: true,
  }), {
    state: 'blocked', runId: 'RUN-NEW', expectedRunRevision: 2, unconfirmed: true, actions: ['resume'],
  });
  assert.deepEqual(deriveKioskActionState({
    serverItem: serverItem('blocked'),
    pendingItems: [pending('complete', 4, 'RUN-1')],
    controlling: true,
  }).actions, []);
  assert.deepEqual(
    deriveKioskActionState({ serverItem: serverItem('blocked'), controlling: true }).actions,
    ['resume'],
  );
  assert.deepEqual(deriveKioskActionState({
    serverItem: serverItem('shooting'),
    pendingItems: [pending('complete', 4, 'RUN-1')],
    controlling: true,
  }).actions, []);
  assert.deepEqual(deriveKioskActionState({ serverItem: serverItem('shooting'), controlling: false }).actions, []);
  assert.deepEqual(deriveKioskActionState({ serverItem: serverItem('shooting'), controlling: true, busy: true }).actions, []);
  const mismatched = deriveKioskActionState({
    serverItem: serverItem('shooting'),
    pendingItems: [pending('block', 4, 'OTHER-RUN')],
    controlling: true,
  });
  assert.equal(mismatched.invalidPendingContext, true);
  assert.deepEqual(mismatched.actions, []);
  const staleRevision = deriveKioskActionState({
    serverItem: serverItem('shooting'),
    pendingItems: [{ ...pending('block', 4, 'RUN-1'), expectedRunRevision: 3 }],
    controlling: true,
  });
  assert.equal(staleRevision.invalidPendingContext, true);
  assert.deepEqual(staleRevision.actions, []);
});

test('blocking reason requires a controlled reason and a note only for other', () => {
  assert.deepEqual(validateBlockingInput('', ''), { ok: false, code: 'BLOCK_REASON_REQUIRED' });
  assert.deepEqual(validateBlockingInput('deviceIssue', ''), { ok: true });
  assert.deepEqual(validateBlockingInput('other', ' '), { ok: false, code: 'BLOCK_NOTE_REQUIRED' });
  assert.deepEqual(validateBlockingInput('other', '临时原因'), { ok: true });
});

test('poll delay starts at three seconds and exponential backoff never exceeds thirty seconds', () => {
  assert.equal(nextKioskPollDelay(0), KIOSK_POLL_INTERVAL_MS);
  assert.equal(nextKioskPollDelay(1), 6000);
  assert.equal(nextKioskPollDelay(2), 12000);
  assert.equal(nextKioskPollDelay(3), 24000);
  assert.equal(nextKioskPollDelay(4), KIOSK_MAX_BACKOFF_MS);
  assert.equal(nextKioskPollDelay(100), KIOSK_MAX_BACKOFF_MS);
});

test('visibility poller pauses while hidden, refreshes immediately when visible, and resets backoff on success', async () => {
  const documentTarget = eventTarget();
  const timers = [];
  let calls = 0;
  const outcomes = [false, true, true];
  const poller = createVisibilityPoller({
    documentTarget,
    task: async () => { calls += 1; return outcomes.shift(); },
    setTimer(callback, delay) { timers.push({ callback, delay, cancelled: false }); return timers.length - 1; },
    clearTimer(id) { if (timers[id]) timers[id].cancelled = true; },
  });
  poller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(timers.at(-1).delay, 6000);

  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatch('visibilitychange');
  assert.equal(timers.at(-1).cancelled, true);
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatch('visibilitychange');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(timers.at(-1).delay, 3000);
  poller.stop();
});

test('Web Locks is primary and a denied lock keeps the tab read-only', async () => {
  const states = [];
  const lock = createKioskControlLock({
    locks: { request: async (_name, options, callback) => {
      assert.equal(options.ifAvailable, true);
      await callback(null);
    } },
    ownerId: 'TAB-1',
    onChange: state => states.push(state),
  });
  lock.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0].mode, 'web-lock');
  assert.equal(states.at(-1).status, 'readOnly');
  assert.equal(lock.inspect().controlling, false);
  lock.stop();
});

test('an acquired Web Lock grants control until explicit stop releases it', async () => {
  const states = [];
  let requestFinished = false;
  const lock = createKioskControlLock({
    locks: {
      request: async (_name, _options, callback) => {
        await callback({ name: 'jenn.kiosk.control.v2' });
        requestFinished = true;
      },
    },
    ownerId: 'TAB-1',
    onChange: state => states.push(state),
  });
  lock.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lock.inspect().controlling, true);
  assert.equal(states.at(-1).status, 'controlling');
  lock.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestFinished, true);
});

test('lease fallback admits one tab and a storage ownership change downgrades it to read-only', () => {
  let now = 1000;
  const firstTarget = eventTarget();
  const secondTarget = eventTarget();
  const storage = sharedStorage([firstTarget, secondTarget]);
  const intervals = [];
  const firstStates = [];
  const secondStates = [];
  const options = {
    storage,
    clock: () => now,
    setRepeating(callback, delay) { intervals.push({ callback, delay }); return intervals.length - 1; },
    clearRepeating() {},
  };
  const first = createKioskControlLock({ ...options, eventTarget: firstTarget, ownerId: 'TAB-1', onChange: state => firstStates.push(state) });
  const second = createKioskControlLock({ ...options, eventTarget: secondTarget, ownerId: 'TAB-2', onChange: state => secondStates.push(state) });
  first.start();
  second.start();
  assert.equal(first.inspect().controlling, true);
  assert.equal(second.inspect().controlling, false);
  assert.equal(intervals[0].delay, 2500);

  now += 1;
  storage.setItem('jenn.kiosk.control-lock.v2', JSON.stringify({ ownerId: 'TAB-2', expiresAt: now + 8000 }));
  assert.equal(first.inspect().controlling, false);
  assert.equal(firstStates.at(-1).status, 'readOnly');
  first.stop();
  second.stop();
});

test('lease fallback contender acquires only after the prior lease expires', () => {
  let now = 1000;
  const firstTarget = eventTarget();
  const secondTarget = eventTarget();
  const storage = sharedStorage([firstTarget, secondTarget]);
  const intervals = [];
  const options = {
    storage,
    clock: () => now,
    setRepeating(callback) { intervals.push(callback); return intervals.length - 1; },
    clearRepeating() {},
  };
  const first = createKioskControlLock({ ...options, eventTarget: firstTarget, ownerId: 'TAB-1' });
  const second = createKioskControlLock({ ...options, eventTarget: secondTarget, ownerId: 'TAB-2' });
  first.start();
  second.start();
  assert.equal(second.inspect().controlling, false);
  now += 8001;
  intervals[1]();
  assert.equal(second.inspect().controlling, true);
  assert.equal(first.inspect().controlling, false, 'storage ownership event downgrades the stale holder');
  first.stop();
  second.stop();
});

test('HTML provides semantic controls, live status, labels, all-task lists, and confirmation dialog', () => {
  assert.match(html, /<main id="kiosk-main"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /aria-label="当前场次全部任务"/u);
  assert.match(html, /aria-label="下一场全部任务"/u);
  assert.match(html, /组合场次，未拆分单任务工时/u);
  for (const action of ['start', 'block', 'resume', 'complete']) assert.match(html, new RegExp(`data-action="${action}"`, 'u'));
  assert.match(html, /<label[^>]+for="block-reason"/u);
  assert.match(html, /<dialog id="complete-dialog"/u);
  assert.match(html, /id="complete-confirm"/u);
});

test('browser source uses the frozen queue surface, second confirmation, and contains no V1 write or credential material', () => {
  assert.match(script, /from '\/kiosk-offline-queue-v2\.js'/u);
  assert.match(script, /createBrowserQueueStorage/u);
  assert.match(script, /createFetchKioskTransport/u);
  assert.match(script, /createKioskOfflineQueue/u);
  assert.match(script, /validateKioskCurrentResponse/u);
  assert.match(script, /currentUrl: '\/api\/v2\/updates'/u);
  assert.match(script, /showModal\(\)/u);
  assert.match(script, /queue\.enqueue\(command\)/u);
  assert.match(script, /void synchronize\(\)/u);
  assert.match(script, /if \(serverModel === null \|\| !controlling\)/u);
  assert.doesNotMatch(script, /\/api\/v1\//u);
  assert.doesNotMatch(`${html}\n${script}`, /bearer|password|credential|access[_-]?token|actorId|role\s*:/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
});

test('styles guarantee touch size, responsive breakpoints, focus visibility, and reduced motion', () => {
  assert.match(css, /min-height:\s*48px/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(max-width: 980px\)/u);
  assert.match(css, /@media \(max-width: 620px\)/u);
  assert.match(css, /prefers-reduced-motion/u);
});

test('Kiosk assets are served only through the static whitelist with CSP and cache policy', async () => {
  for (const [path, contentType] of [
    ['/kiosk', 'text/html; charset=utf-8'],
    ['/kiosk.css', 'text/css; charset=utf-8'],
    ['/kiosk.js', 'text/javascript; charset=utf-8'],
    ['/kiosk-control-lock.js', 'text/javascript; charset=utf-8'],
    ['/kiosk-offline-queue-v2.js', 'text/javascript; charset=utf-8'],
  ]) {
    const response = await getStatic(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), contentType);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/u);
    assert.equal(response.headers.get('cache-control'), path === '/kiosk' ? 'no-store' : 'public, max-age=300');
    assert.notEqual(response.body, '');
  }
});
