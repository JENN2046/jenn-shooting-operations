import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBrowserQueueStorage,
  createFetchKioskTransport,
  createKioskOfflineQueue,
  validateKioskCurrentResponse,
  validateKioskQueueItem,
  validateKioskRunEventResponse,
} from '../public/kiosk-offline-queue-v2.js';
import {
  validateKioskCurrent as validateContractCurrent,
  validateKioskRunEventResult as validateContractRunEventResult,
} from '../src/kiosk-contract-validator-v2.mjs';

const NOW = '2026-09-22T09:30:00.000Z';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function memoryStorage(initial = null) {
  let value = clone(initial);
  const empty = {
    schemaVersion: 2,
    nextLocalSequence: 0,
    syncStatus: 'synced',
    items: [],
    cache: null,
  };
  return {
    saves: 0,
    failWrites: false,
    beforeCommit: null,
    load() { return clone(value); },
    commit({ baseState, nextState }) {
      if (this.failWrites) throw new Error('storage failed');
      this.beforeCommit?.({ baseState: clone(baseState), nextState: clone(nextState) });
      const current = clone(value ?? empty);
      const nextIds = new Set(nextState.items.map(item => item.eventId));
      const removedIds = new Set(baseState.items
        .filter(item => !nextIds.has(item.eventId))
        .map(item => item.eventId));
      const merged = current.items.filter(item => !removedIds.has(item.eventId));
      const mergedIds = new Set(merged.map(item => item.eventId));
      for (const item of nextState.items) {
        if (!mergedIds.has(item.eventId)) {
          merged.push(clone(item));
          mergedIds.add(item.eventId);
        }
      }
      merged.sort((left, right) => left.localSequence - right.localSequence);
      const currentCache = current.cache;
      const cache = !currentCache || (
        nextState.cache
        && nextState.cache.projectionRevision >= currentCache.projectionRevision
      ) ? clone(nextState.cache) : currentCache;
      const currentTerminal = ['conflict', 'reviewRequired'].includes(current.syncStatus)
        && merged[0]?.eventId === nextState.items[0]?.eventId;
      const nextTerminal = ['conflict', 'reviewRequired'].includes(nextState.syncStatus)
        && merged[0]?.eventId === nextState.items[0]?.eventId;
      const terminalStatus = currentTerminal
        ? current.syncStatus
        : nextTerminal ? nextState.syncStatus : null;
      value = {
        schemaVersion: 2,
        nextLocalSequence: Math.max(current.nextLocalSequence, nextState.nextLocalSequence),
        syncStatus: merged.length === 0 ? 'synced' : terminalStatus ?? 'pending',
        items: merged,
        cache,
      };
      this.saves += 1;
      return clone(value);
    },
    value() { return clone(value); },
  };
}

function current(projectionRevision = 10) {
  return {
    schemaVersion: 2,
    serverTime: NOW,
    resourceId: 'STUDIO-A',
    projectionRevision,
    current: {
      scheduleItemId: 'SCHEDULE-0001',
      allocationMode: 'single',
      plannedStart: '2026-09-22T09:00:00.000Z',
      plannedEnd: '2026-09-22T10:00:00.000Z',
      runId: 'RUN-0001',
      runRevision: 1,
      runState: 'shooting',
      tasks: [{ id: 'TASK-0001', sku: 'SKU-001', name: 'Task', summary: 'Summary' }],
      isGrouped: false,
      groupedNotice: null,
    },
    next: null,
  };
}

function scriptedTransport({ refresh, responses = [] } = {}) {
  const calls = [];
  return {
    calls,
    async refreshCurrent(input) {
      calls.push({ type: 'refresh', input: clone(input) });
      if (refresh instanceof Error) throw refresh;
      return clone(refresh ?? { status: 200, body: current() });
    },
    async submitEvent(item) {
      calls.push({ type: 'submit', item: clone(item) });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return clone(response);
    },
  };
}

function queueItem(localSequence = 0, overrides = {}) {
  return {
    schemaVersion: 2,
    eventId: `EVENT-${String(localSequence).padStart(4, '0')}`,
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-0001',
    eventType: 'start',
    expectedRunRevision: localSequence,
    occurredAt: NOW,
    deviceId: 'DEVICE-0001',
    localSequence,
    ...overrides,
  };
}

function applied(replayed = false, item = queueItem(0)) {
  return {
    status: replayed ? 200 : 201,
    body: {
      schemaVersion: 2,
      ok: true,
      code: 'RUN_EVENT_APPLIED',
      replayed,
      eventId: item.eventId,
      runId: item.runId,
      previousState: 'scheduled',
      resultingState: 'shooting',
      runRevision: 1,
      projectionRevision: 11,
      scheduleRevision: 3,
      startedAt: NOW,
      completedAt: null,
      grossDurationMs: null,
      blockedDurationMs: 0,
      netDurationMs: null,
      metricsAlgorithmVersion: null,
    },
  };
}

function createQueue(storage, transport) {
  return createKioskOfflineQueue({
    storage,
    transport,
    clock: () => new Date(NOW),
  });
}

test('browser-safe response validators enforce the full frozen schemas', () => {
  const validCurrent = current();
  const validApplied = applied(false).body;
  assert.equal(validateContractCurrent(validCurrent).ok, true);
  assert.equal(validateKioskCurrentResponse(validCurrent).ok, true);
  assert.equal(validateContractRunEventResult(validApplied).ok, true);
  assert.equal(validateKioskRunEventResponse(validApplied).ok, true);

  const truncated = {
    schemaVersion: 2,
    ok: true,
    code: 'RUN_EVENT_APPLIED',
    replayed: false,
    eventId: 'EVENT-0000',
    runId: 'RUN-0001',
  };
  assert.equal(validateContractRunEventResult(truncated).ok, false);
  assert.equal(validateKioskRunEventResponse(truncated).ok, false);
  assert.equal(validateKioskCurrentResponse({ ...validCurrent, next: validCurrent.current }).ok, false);

  for (const numericEventId of [
    {
      schemaVersion: 2,
      ok: false,
      code: 'REVISION_CONFLICT',
      replayed: false,
      eventId: 12345678,
      runId: 'RUN-0001',
      scope: 'run',
      currentRunRevision: 1,
    },
    {
      schemaVersion: 2,
      ok: false,
      code: 'EVENT_TIME_REVIEW_REQUIRED',
      replayed: false,
      eventId: 12345678,
      runId: 'RUN-0001',
      scheduleItemId: 'SCHEDULE-0001',
      reviewStatus: 'pending',
      reviewReason: 'tooOld',
      policyVersion: 'kiosk-event-time-local-v1',
      receivedAt: NOW,
    },
  ]) {
    assert.equal(validateContractRunEventResult(numericEventId).ok, false);
    assert.equal(validateKioskRunEventResponse(numericEventId).ok, false);
  }

  const lowercaseTimestamp = {
    ...validCurrent,
    serverTime: '2026-09-22t09:30:00.000z',
    current: {
      ...validCurrent.current,
      plannedStart: '2026-09-22t09:00:00.000z',
      plannedEnd: '2026-09-22t10:00:00.000z',
    },
  };
  assert.equal(validateContractCurrent(lowercaseTimestamp).ok, true);
  assert.equal(validateKioskCurrentResponse(lowercaseTimestamp).ok, true);
});

test('strict queue items reject unknown authority fields and write-ahead storage failure prevents replay', async () => {
  assert.equal(validateKioskQueueItem(queueItem()).ok, true);
  assert.equal(validateKioskQueueItem(queueItem(0, { note: '😀'.repeat(1500) })).ok, true);
  for (const invalid of [
    { ...queueItem(), actorId: 'FORGED' },
    { ...queueItem(), role: 'administrator' },
    { ...queueItem(), previousState: 'scheduled' },
    { ...queueItem(), schemaVersion: 3 },
    { ...queueItem(), eventType: 'cancel' },
    { ...queueItem(), eventType: 'block' },
    { ...queueItem(), eventType: 'start', reasonCode: 'deviceIssue' },
    { ...queueItem(), occurredAt: 'not-a-time' },
  ]) assert.deepEqual(validateKioskQueueItem(invalid), { ok: false, code: 'INVALID_QUEUE_ITEM' });

  const storage = memoryStorage();
  storage.failWrites = true;
  const transport = scriptedTransport();
  const queue = createQueue(storage, transport);
  assert.deepEqual(queue.enqueue(queueItem()), { ok: false, code: 'QUEUE_STORAGE_WRITE_FAILED' });
  const result = await queue.replay({ resourceId: 'STUDIO-A' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'QUEUE_STORAGE_WRITE_FAILED');
  assert.equal(result.syncStatus, 'reviewRequired');
  assert.equal(transport.calls.filter(call => call.type === 'submit').length, 0);
});

test('enqueue requires one exact increasing local sequence and preserves immutable command fields', () => {
  const storage = memoryStorage();
  const queue = createQueue(storage, scriptedTransport());
  const first = queueItem(0);
  assert.equal(queue.enqueue(first).ok, true);
  first.eventId = 'EVENT-MUTATED';
  first.expectedRunRevision = 99;
  assert.deepEqual(
    queue.enqueue(queueItem(0, { eventId: 'EVENT-OTHER' })),
    { ok: false, code: 'LOCAL_SEQUENCE_MISMATCH', expectedLocalSequence: 1 },
  );
  assert.equal(queue.enqueue(queueItem(2)).code, 'LOCAL_SEQUENCE_MISMATCH');
  assert.equal(queue.enqueue(queueItem(1, { eventId: 'EVENT-0000' })).code, 'DUPLICATE_EVENT_ID');
  assert.equal(queue.enqueue(queueItem(1)).ok, true);
  const inspected = queue.inspect();
  assert.equal(inspected.syncStatus, 'pending');
  assert.deepEqual(inspected.items.map(item => ({
    eventId: item.eventId,
    expectedRunRevision: item.expectedRunRevision,
    localSequence: item.localSequence,
  })), [
    { eventId: 'EVENT-0000', expectedRunRevision: 0, localSequence: 0 },
    { eventId: 'EVENT-0001', expectedRunRevision: 1, localSequence: 1 },
  ]);
});

test('refreshes first, replays immutable heads in sequence, and deletes only applied or exact replayed heads', async () => {
  const storage = memoryStorage();
  const transport = scriptedTransport({
    responses: [applied(false, queueItem(0)), applied(true, queueItem(1))],
  });
  const queue = createQueue(storage, transport);
  queue.enqueue(queueItem(0));
  queue.enqueue(queueItem(1, { eventType: 'complete' }));
  const before = clone(storage.value().items);

  const result = await queue.replay({ resourceId: 'STUDIO-A' });

  assert.equal(result.ok, true);
  assert.equal(result.syncStatus, 'synced');
  assert.equal(result.pendingCount, 0);
  assert.equal(result.processed, 2);
  assert.equal(result.serverStatus.kind, 'fresh');
  assert.deepEqual(transport.calls.map(call => call.type), ['refresh', 'submit', 'submit']);
  assert.deepEqual(transport.calls.filter(call => call.type === 'submit').map(call => call.item), before);
  assert.deepEqual(storage.value(), {
    schemaVersion: 2,
    nextLocalSequence: 2,
    syncStatus: 'synced',
    items: [],
    cache: { projectionRevision: 10, lastSyncedAt: NOW },
  });
});

test('conflict, invalid transition, ambiguous context, and review stop at the immutable head', async t => {
  const cases = [
    ['revision conflict', 409, 'REVISION_CONFLICT', 'conflict'],
    ['invalid transition', 409, 'INVALID_RUN_TRANSITION', 'conflict'],
    ['ambiguous context', 409, 'MULTIPLE_ACTIVE_RUNS', 'conflict'],
    ['time review', 202, 'EVENT_TIME_REVIEW_REQUIRED', 'reviewRequired'],
  ];
  for (const [name, status, code, syncStatus] of cases) {
    await t.test(name, async () => {
      const storage = memoryStorage();
      const transport = scriptedTransport({
        responses: [{
          status,
          body: {
            schemaVersion: 2,
            ok: false,
            code,
            replayed: false,
            ...(code === 'EVENT_TIME_REVIEW_REQUIRED'
              ? {
                  eventId: 'EVENT-0000',
                  runId: 'RUN-0001',
                  scheduleItemId: 'SCHEDULE-0001',
                  reviewStatus: 'pending',
                  reviewReason: 'tooOld',
                  policyVersion: 'kiosk-event-time-local-v1',
                  receivedAt: NOW,
                }
              : code === 'REVISION_CONFLICT'
                ? {
                    eventId: 'EVENT-0000',
                    runId: 'RUN-0001',
                    scope: 'run',
                    currentRunRevision: 1,
                  }
                : {}),
          },
        }],
      });
      const queue = createQueue(storage, transport);
      queue.enqueue(queueItem(0));
      queue.enqueue(queueItem(1));
      const before = clone(storage.value().items);

      const result = await queue.replay({ resourceId: 'STUDIO-A' });

      assert.equal(result.syncStatus, syncStatus);
      assert.equal(result.stopCode, code);
      assert.equal(result.pendingCount, 2);
      assert.equal(result.serverStatus.kind, 'fresh');
      assert.deepEqual(storage.value().items, before);
      assert.equal(transport.calls.filter(call => call.type === 'submit').length, 1);
      assert.equal(queue.enqueue(queueItem(2)).code, 'QUEUE_REPLAY_BLOCKED');
    });
  }
});

test('network, 5xx, malformed response, and parse failure retain the head as pending', async t => {
  const cases = [
    ['network', new Error('offline')],
    ['5xx', {
      status: 503,
      body: { schemaVersion: 2, ok: false, code: 'INTERNAL_ERROR', replayed: false },
    }],
    ['malformed response', { status: 200, body: 'not-json-object' }],
    ['schema-invalid truncated success', {
      status: 201,
      body: {
        schemaVersion: 2,
        ok: true,
        code: 'RUN_EVENT_APPLIED',
        replayed: false,
        eventId: 'EVENT-0000',
        runId: 'RUN-0001',
      },
    }],
    ['schema-invalid numeric conflict event id', {
      status: 409,
      body: {
        schemaVersion: 2,
        ok: false,
        code: 'REVISION_CONFLICT',
        replayed: false,
        eventId: 12345678,
        runId: 'RUN-0001',
        scope: 'run',
        currentRunRevision: 1,
      },
    }],
    ['mismatched success receipt', {
      status: 201,
      body: {
        ...applied(false, queueItem(0)).body,
        ok: true,
        code: 'RUN_EVENT_APPLIED',
        replayed: false,
        eventId: 'EVENT-DIFFERENT',
        runId: 'RUN-0001',
      },
    }],
    ['wrong applied status', {
      status: 202,
      body: {
        ...applied(false, queueItem(0)).body,
        ok: true,
        code: 'RUN_EVENT_APPLIED',
        replayed: false,
        eventId: 'EVENT-0000',
        runId: 'RUN-0001',
      },
    }],
    ['wrong replay flag for 200', {
      status: 200,
      body: {
        ...applied(false, queueItem(0)).body,
        ok: true,
        code: 'RUN_EVENT_APPLIED',
        replayed: false,
        eventId: 'EVENT-0000',
        runId: 'RUN-0001',
      },
    }],
    ['parse failure', new SyntaxError('bad json')],
  ];
  for (const [name, response] of cases) {
    await t.test(name, async () => {
      const storage = memoryStorage();
      const transport = scriptedTransport({ responses: [response] });
      const queue = createQueue(storage, transport);
      queue.enqueue(queueItem(0));
      const before = clone(storage.value().items[0]);

      const result = await queue.replay({ resourceId: 'STUDIO-A' });

      assert.equal(result.syncStatus, 'pending');
      assert.equal(result.pendingCount, 1);
      assert.equal(result.processed, 0);
      assert.deepEqual(storage.value().items[0], before);
    });
  }
});

test('unknown versions, forbidden cache fields, and duplicate or descending sequences fail closed before transport', async t => {
  const base = {
    schemaVersion: 2,
    nextLocalSequence: 2,
    syncStatus: 'pending',
    items: [queueItem(0), queueItem(1)],
    cache: null,
  };
  const corruptions = [
    { ...base, schemaVersion: 99 },
    { ...base, token: 'SECRET' },
    { ...base, cache: { projectionRevision: 1, lastSyncedAt: NOW, actorId: 'FORGED' } },
    { ...base, items: [queueItem(0), queueItem(0)] },
    { ...base, items: [queueItem(1), queueItem(0)], nextLocalSequence: 1 },
    { ...base, items: [queueItem(0), queueItem(2)], nextLocalSequence: 3 },
  ];
  for (const [index, state] of corruptions.entries()) {
    await t.test(`corruption ${index + 1}`, async () => {
      const storage = memoryStorage(state);
      const transport = scriptedTransport();
      const queue = createQueue(storage, transport);
      const result = await queue.replay({ resourceId: 'STUDIO-A' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'QUEUE_STATE_INVALID');
      assert.equal(result.syncStatus, 'reviewRequired');
      assert.equal(transport.calls.length, 0);
      assert.deepEqual(storage.value(), state);
    });
  }
});

test('server current state and queue sync status remain separate while cache stays minimal', async () => {
  const storage = memoryStorage();
  const transport = scriptedTransport({
    refresh: { status: 200, body: current(44) },
    responses: [{
      status: 409,
      body: {
        schemaVersion: 2,
        ok: false,
        code: 'REVISION_CONFLICT',
        replayed: false,
        eventId: 'EVENT-0000',
        runId: 'RUN-0001',
        scope: 'run',
        currentRunRevision: 1,
      },
    }],
  });
  const queue = createQueue(storage, transport);
  queue.enqueue(queueItem(0));

  const result = await queue.replay({ resourceId: 'STUDIO-A' });

  assert.equal(result.syncStatus, 'conflict');
  assert.equal(result.serverStatus.kind, 'fresh');
  assert.equal(result.serverStatus.current.current.runState, 'shooting');
  assert.deepEqual(result.cache, { projectionRevision: 44, lastSyncedAt: NOW });
  assert.deepEqual(Object.keys(storage.value().cache).sort(), ['lastSyncedAt', 'projectionRevision']);
});

test('two workers may submit the same immutable event but converge through server idempotency', async () => {
  const storage = memoryStorage();
  const submitted = [];
  const transport = {
    async refreshCurrent() { return { status: 200, body: current() }; },
    async submitEvent(item) {
      submitted.push(clone(item));
      await Promise.resolve();
      return applied(submitted.length > 1, item);
    },
  };
  const firstWorker = createQueue(storage, transport);
  const secondWorker = createQueue(storage, transport);
  firstWorker.enqueue(queueItem(0));

  const [first, second] = await Promise.all([
    firstWorker.replay({ resourceId: 'STUDIO-A' }),
    secondWorker.replay({ resourceId: 'STUDIO-A' }),
  ]);

  assert.equal(first.syncStatus, 'synced');
  assert.equal(second.syncStatus, 'synced');
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0].eventId, submitted[1].eventId);
  assert.equal(storage.value().items.length, 0);
});

test('replay never overwrites an event enqueued while refresh is in flight', async () => {
  const storage = memoryStorage();
  let finishRefresh;
  const refreshGate = new Promise(resolve => { finishRefresh = resolve; });
  const transport = {
    async refreshCurrent() {
      await refreshGate;
      return { status: 200, body: current() };
    },
    async submitEvent() {
      throw new Error('remain offline');
    },
  };
  const replaying = createQueue(storage, transport);
  const enqueueing = createQueue(storage, transport);
  replaying.enqueue(queueItem(0));

  const replay = replaying.replay({ resourceId: 'STUDIO-A' });
  await Promise.resolve();
  assert.equal(enqueueing.enqueue(queueItem(1)).ok, true);
  finishRefresh();
  const result = await replay;

  assert.equal(result.syncStatus, 'pending');
  assert.equal(result.pendingCount, 2);
  assert.equal(storage.value().nextLocalSequence, 2);
  assert.deepEqual(storage.value().items.map(item => item.eventId), ['EVENT-0000', 'EVENT-0001']);
});

test('refresh accepts only frozen 200 or 304 status codes', async () => {
  const storage = memoryStorage();
  const transport = scriptedTransport({
    refresh: { status: 204, body: current() },
    responses: [applied(false, queueItem(0))],
  });
  const queue = createQueue(storage, transport);
  queue.enqueue(queueItem(0));

  const result = await queue.replay({ resourceId: 'STUDIO-A' });

  assert.equal(result.serverStatus.kind, 'unavailable');
  assert.equal(result.syncStatus, 'pending');
  assert.equal(result.pendingCount, 1);
  assert.equal(transport.calls.filter(call => call.type === 'submit').length, 0);
});

test('stale refresh commit cannot reopen a concurrently terminal queue head', async () => {
  const storage = memoryStorage();
  const transport = {
    async refreshCurrent() { return { status: 200, body: current() }; },
    async submitEvent() { throw new Error('terminal head must not be submitted'); },
  };
  const queue = createQueue(storage, transport);
  queue.enqueue(queueItem(0));
  storage.beforeCommit = ({ baseState, nextState }) => {
    if (baseState.syncStatus !== 'pending' || nextState.cache === null) return;
    storage.beforeCommit = null;
    const concurrent = storage.value();
    storage.commit({
      baseState: concurrent,
      nextState: { ...concurrent, syncStatus: 'conflict' },
    });
    assert.equal(storage.value().syncStatus, 'conflict');
  };

  const result = await queue.replay({ resourceId: 'STUDIO-A' });

  assert.equal(result.syncStatus, 'conflict');
  assert.equal(result.processed, 0);
  assert.equal(storage.value().syncStatus, 'conflict');
  assert.equal(storage.value().items[0].eventId, 'EVENT-0000');
});

test('delta commit preserves an enqueue that lands after final head reload', async () => {
  const storage = memoryStorage();
  const transport = scriptedTransport({ responses: [applied(false, queueItem(0))] });
  const replaying = createQueue(storage, transport);
  const enqueueing = createQueue(storage, transport);
  replaying.enqueue(queueItem(0));
  storage.beforeCommit = ({ baseState, nextState }) => {
    if (baseState.items.length === 1 && nextState.items.length === 0) {
      storage.beforeCommit = null;
      assert.equal(enqueueing.enqueue(queueItem(1)).ok, true);
    }
  };

  const result = await replaying.replay({ resourceId: 'STUDIO-A' });

  assert.equal(result.syncStatus, 'pending');
  assert.equal(result.pendingCount, 1);
  assert.equal(storage.value().nextLocalSequence, 2);
  assert.deepEqual(storage.value().items.map(item => item.eventId), ['EVENT-0001']);
});

test('transport cannot mutate the authoritative immutable queue head', async () => {
  const storage = memoryStorage();
  const transport = {
    async refreshCurrent() { return { status: 200, body: current() }; },
    async submitEvent(item) {
      item.eventId = 'EVENT-MUTATED';
      return applied(false, item);
    },
  };
  const queue = createQueue(storage, transport);
  queue.enqueue(queueItem(0));

  const result = await queue.replay({ resourceId: 'STUDIO-A' });

  assert.equal(result.syncStatus, 'pending');
  assert.equal(result.pendingCount, 1);
  assert.equal(storage.value().items[0].eventId, 'EVENT-0000');
});

test('browser storage and fetch transport adapters serialize only queue data and use ETag without real I/O', async () => {
  const values = new Map();
  let beforeMetaWrite = null;
  const browserStorage = createBrowserQueueStorage({
    storage: {
      get length() { return values.size; },
      key(index) { return [...values.keys()][index] ?? null; },
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) {
        if (key === 'jenn.kiosk.offline-queue.v2.meta' && beforeMetaWrite) {
          const callback = beforeMetaWrite;
          beforeMetaWrite = null;
          callback();
        }
        values.set(key, value);
      },
      removeItem(key) { values.delete(key); },
    },
  });
  const emptyState = {
    schemaVersion: 2,
    nextLocalSequence: 0,
    syncStatus: 'synced',
    items: [],
    cache: null,
  };
  assert.deepEqual(browserStorage.load(), null);
  assert.deepEqual(browserStorage.commit({ baseState: emptyState, nextState: emptyState }), emptyState);
  assert.deepEqual(browserStorage.load(), emptyState);
  assert.throws(
    () => browserStorage.commit({
      baseState: emptyState,
      nextState: { ...emptyState, token: 'SECRET' },
    }),
    /QUEUE_STATE_INVALID/u,
  );

  const pendingState = {
    ...emptyState,
    nextLocalSequence: 1,
    syncStatus: 'pending',
    items: [queueItem(0)],
  };
  browserStorage.commit({ baseState: emptyState, nextState: pendingState });
  const terminalState = { ...pendingState, syncStatus: 'reviewRequired' };
  const staleCacheCommit = {
    ...pendingState,
    cache: { projectionRevision: 10, lastSyncedAt: NOW },
  };
  beforeMetaWrite = () => {
    browserStorage.commit({ baseState: pendingState, nextState: terminalState });
    assert.equal(browserStorage.load().syncStatus, 'reviewRequired');
  };
  browserStorage.commit({ baseState: pendingState, nextState: staleCacheCommit });
  assert.equal(browserStorage.load().syncStatus, 'reviewRequired');
  browserStorage.commit({
    baseState: terminalState,
    nextState: { ...emptyState, nextLocalSequence: 1 },
  });
  assert.equal(browserStorage.load().syncStatus, 'synced');

  const calls = [];
  const transport = createFetchKioskTransport({
    fetchImpl: async (url, options) => {
      calls.push({ url, options: clone(options) });
      return {
        status: options.method === 'GET' ? 304 : 201,
        async json() {
          const item = JSON.parse(options.body);
          return applied(false, item).body;
        },
      };
    },
  });
  assert.deepEqual(
    await transport.refreshCurrent({ resourceId: 'STUDIO A', projectionRevision: 7 }),
    { status: 304, body: null },
  );
  assert.deepEqual(await transport.submitEvent(queueItem(0)), applied(false, queueItem(0)));
  assert.equal(calls[0].url, '/api/v2/kiosk/current?resourceId=STUDIO%20A');
  assert.equal(calls[0].options.headers['If-None-Match'], '"projection-7"');
  assert.equal(calls[1].url, '/api/v2/schedule-items/SCHEDULE-0001/events');
  assert.deepEqual(JSON.parse(calls[1].options.body), queueItem(0));
  assert.equal(Object.hasOwn(calls[1].options.headers, 'Authorization'), false);
});

test('browser storage fails closed when concurrent event ids claim one local sequence', () => {
  const values = new Map();
  let beforeSequenceWrite = null;
  const adapter = createBrowserQueueStorage({
    storage: {
      get length() { return values.size; },
      key(index) { return [...values.keys()][index] ?? null; },
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) {
        if (key.endsWith('.sequence.0000000000000000') && beforeSequenceWrite) {
          const callback = beforeSequenceWrite;
          beforeSequenceWrite = null;
          callback();
        }
        values.set(key, value);
      },
      removeItem(key) { values.delete(key); },
    },
  });
  const empty = {
    schemaVersion: 2,
    nextLocalSequence: 0,
    syncStatus: 'synced',
    items: [],
    cache: null,
  };
  const stateFor = eventId => ({
    ...empty,
    nextLocalSequence: 1,
    syncStatus: 'pending',
    items: [queueItem(0, { eventId })],
  });
  beforeSequenceWrite = () => {
    adapter.commit({ baseState: empty, nextState: stateFor('EVENT-BBBB') });
  };

  assert.throws(
    () => adapter.commit({ baseState: empty, nextState: stateFor('EVENT-AAAA') }),
    /QUEUE_STATE_INVALID/u,
  );
  assert.throws(() => adapter.load(), /QUEUE_STATE_INVALID/u);
  assert.equal(
    [...values.keys()].filter(key => key.includes('.item.')).length,
    2,
    'neither concurrent durable command is silently discarded',
  );
});
