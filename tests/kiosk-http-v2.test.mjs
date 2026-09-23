import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createHttpApp } from '../src/http-app.mjs';
import { validateKioskRunEventResult } from '../src/kiosk-contract-validator-v2.mjs';

function principal(role = 'operator', resourceIds = ['RESOURCE-A']) {
  const result = createTrustedPrincipal({ subjectId: `ACTOR-${role}`, role, resourceIds });
  assert.equal(result.ok, true);
  return result.principal;
}

function currentDto() {
  return {
    schemaVersion: 2,
    serverTime: '2026-09-22T09:30:00.000Z',
    projectionRevision: 17,
    resourceId: 'RESOURCE-A',
    current: {
      scheduleItemId: 'SCHEDULE-ITEM-0001',
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

function eventCommand(overrides = {}) {
  return {
    schemaVersion: 2,
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    scheduleItemId: 'SCHEDULE-ITEM-0001',
    eventType: 'start',
    expectedRunRevision: 0,
    occurredAt: '2026-09-22T09:00:00.000Z',
    deviceId: 'KIOSK-0001',
    localSequence: 0,
    ...overrides,
  };
}

function appliedResult(overrides = {}) {
  return {
    ok: true,
    code: 'RUN_EVENT_APPLIED',
    eventId: 'EVENT-0001',
    runId: 'RUN-0001',
    previousState: 'scheduled',
    resultingState: 'shooting',
    runRevision: 1,
    projectionRevision: 18,
    scheduleRevision: 7,
    startedAt: '2026-09-22T09:00:00.000Z',
    completedAt: null,
    grossDurationMs: null,
    blockedDurationMs: 0,
    netDurationMs: null,
    metricsAlgorithmVersion: null,
    ...overrides,
  };
}

function fakeStore() {
  return {
    getSnapshot: () => ({ schemaVersion: 1, revision: 0, updatedAt: '2026-09-22T09:00:00.000Z', products: [], tasks: [], sessions: [] }),
  };
}

async function invoke(app, {
  method = 'GET',
  url = '/',
  headers = {},
  body,
} = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const responseHeaders = new Map();
  let status = null;
  const chunks = [];
  const response = {
    setHeader(name, value) {
      responseHeaders.set(name.toLowerCase(), value);
    },
    writeHead(nextStatus, nextHeaders = {}) {
      status = nextStatus;
      for (const [name, value] of Object.entries(nextHeaders)) responseHeaders.set(name.toLowerCase(), value);
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk));
    },
  };
  await app(request, response);
  const text = Buffer.concat(chunks).toString('utf8');
  return {
    status,
    headers: responseHeaders,
    text,
    body: text === '' ? null : JSON.parse(text),
  };
}

function appWith(kiosk) {
  return createHttpApp({ store: fakeStore(), kiosk });
}

test('V1 routes keep their existing public behavior when Kiosk is not configured', async () => {
  const app = appWith(null);
  const health = await invoke(app, { url: '/healthz' });
  assert.deepEqual(health.body, { ok: true, service: 'jenn-shooting-operations' });
  const snapshot = await invoke(app, { url: '/api/v1/snapshot' });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.ok, true);
});

test('Kiosk endpoints fail closed when authentication is not configured or principal is invalid', async () => {
  for (const { app, expectedCode } of [
    { app: appWith(null), expectedCode: 'AUTH_NOT_CONFIGURED' },
    {
      app: appWith({
        authenticate: () => ({ subjectId: 'forged', role: 'administrator', resourceIds: ['RESOURCE-A'] }),
        readCurrent: () => ({ ok: true, dto: currentDto() }),
      }),
      expectedCode: 'UNAUTHENTICATED',
    },
  ]) {
    const response = await invoke(app, { url: '/api/v2/kiosk/current?resourceId=RESOURCE-A' });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, expectedCode);
    assert.equal(validateKioskRunEventResult(response.body).ok, true);
  }
});

test('current read requires one exact resourceId and enforces principal resource scope', async () => {
  let reads = 0;
  const app = appWith({
    authenticate: () => principal('viewer'),
    readCurrent: () => { reads += 1; return { ok: true, dto: currentDto() }; },
  });
  for (const url of [
    '/api/v2/kiosk/current',
    '/api/v2/kiosk/current?resourceId=',
    '/api/v2/kiosk/current?resourceId=RESOURCE-A&resourceId=RESOURCE-A',
    '/api/v2/kiosk/current?resourceId=RESOURCE-A&extra=1',
  ]) {
    const response = await invoke(app, { url });
    assert.equal(response.status, 400, url);
    assert.equal(response.body.code, 'INVALID_REQUEST', url);
  }
  const forbidden = await invoke(app, { url: '/api/v2/kiosk/current?resourceId=RESOURCE-B' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 'FORBIDDEN');
  assert.equal(reads, 0);
});

test('current and updates return schema-valid views with projection-only ETags and exact 304', async () => {
  const calls = [];
  const app = appWith({
    authenticate: () => principal('viewer'),
    readCurrent: input => { calls.push(input); return { ok: true, dto: currentDto() }; },
  });
  for (const path of ['/api/v2/kiosk/current', '/api/v2/updates']) {
    const changed = await invoke(app, { url: `${path}?resourceId=RESOURCE-A` });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body, currentDto());
    assert.equal(changed.headers.get('etag'), '"projection-17"');

    const unchanged = await invoke(app, {
      url: `${path}?resourceId=RESOURCE-A`,
      headers: { 'If-None-Match': '"projection-17"' },
    });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.body, null);
    assert.equal(unchanged.text, '');
    assert.equal(unchanged.headers.get('etag'), '"projection-17"');

    const stale = await invoke(app, {
      url: `${path}?resourceId=RESOURCE-A`,
      headers: { 'If-None-Match': '"projection-16"' },
    });
    assert.equal(stale.status, 200);
    assert.deepEqual(stale.body, currentDto());
  }
  assert.equal(calls.length, 6);
  assert.equal(calls.every(call => call.resourceId === 'RESOURCE-A' && call.principal.role === 'viewer'), true);
});

test('malformed conditional headers and invalid read results fail with low-disclosure envelopes', async () => {
  let reads = 0;
  const app = appWith({
    authenticate: () => principal('viewer'),
    readCurrent: () => { reads += 1; return { ok: true, dto: { ...currentDto(), projectionRevision: -1 } }; },
  });
  const malformed = await invoke(app, {
    url: '/api/v2/updates?resourceId=RESOURCE-A',
    headers: { 'If-None-Match': '*' },
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'INVALID_REQUEST');
  assert.equal(validateKioskRunEventResult(malformed.body).ok, true);
  assert.equal(reads, 0);

  const invalidResult = await invoke(app, { url: '/api/v2/updates?resourceId=RESOURCE-A' });
  assert.equal(invalidResult.status, 500);
  assert.equal(invalidResult.body.code, 'INTERNAL_ERROR');
  assert.equal(reads, 1);

  const validApp = appWith({
    authenticate: () => principal('viewer'),
    readCurrent: () => ({ ok: true, dto: currentDto() }),
  });
  for (const candidate of ['*', '"projection-01"', `"projection-${Number.MAX_SAFE_INTEGER + 1}"`]) {
    const invalidHeader = await invoke(validApp, {
      url: '/api/v2/updates?resourceId=RESOURCE-A',
      headers: { 'If-None-Match': candidate },
    });
    assert.equal(invalidHeader.status, 400, candidate);
    assert.equal(invalidHeader.body.code, 'INVALID_REQUEST', candidate);
  }
});

test('current use-case failures are explicitly normalized to the frozen public surface', async () => {
  const cases = [
    ['INVALID_REQUEST', 400, 'INVALID_REQUEST'],
    ['INVALID_RESOURCE_ID', 400, 'INVALID_REQUEST'],
    ['RESOURCE_ID_REQUIRED', 400, 'INVALID_REQUEST'],
    ['UNAUTHENTICATED', 401, 'UNAUTHENTICATED'],
    ['AUTH_NOT_CONFIGURED', 401, 'AUTH_NOT_CONFIGURED'],
    ['INVALID_TRUSTED_PRINCIPAL', 401, 'UNAUTHENTICATED'],
    ['PRINCIPAL_CAPABILITY_MISMATCH', 401, 'UNAUTHENTICATED'],
    ['FORBIDDEN', 403, 'FORBIDDEN'],
    ['RESOURCE_FORBIDDEN', 403, 'FORBIDDEN'],
    ['RESOURCE_NOT_FOUND', 404, 'RESOURCE_NOT_FOUND'],
    ['MULTIPLE_ACTIVE_RUNS', 409, 'MULTIPLE_ACTIVE_RUNS'],
    ['MULTIPLE_CURRENT_CANDIDATES', 409, 'MULTIPLE_CURRENT_CANDIDATES'],
    ['MULTIPLE_NEXT_CANDIDATES', 409, 'MULTIPLE_NEXT_CANDIDATES'],
    ['STORE_BUSY', 503, 'STORE_BUSY'],
    ['SERVICE_UNAVAILABLE', 503, 'SERVICE_UNAVAILABLE'],
    ['KIOSK_CURRENT_READ_FAILED', 500, 'INTERNAL_ERROR'],
    ['INVALID_KIOSK_SCHEDULE_FACT', 500, 'INTERNAL_ERROR'],
    ['KIOSK_CURRENT_CONTRACT_INVALID', 500, 'INTERNAL_ERROR'],
    ['INTERNAL_ERROR', 500, 'INTERNAL_ERROR'],
    ['UNKNOWN_PRIVATE_FAILURE', 500, 'INTERNAL_ERROR'],
  ];
  for (const [internalCode, status, publicCode] of cases) {
    const app = appWith({
      authenticate: () => principal('viewer'),
      readCurrent: () => ({ ok: false, code: internalCode, details: 'SQL /private/db token' }),
    });
    const response = await invoke(app, { url: '/api/v2/kiosk/current?resourceId=RESOURCE-A' });
    assert.equal(response.status, status, internalCode);
    assert.equal(response.body.code, publicCode, internalCode);
    assert.equal(validateKioskRunEventResult(response.body).ok, true, internalCode);
    assert.equal(JSON.stringify(response.body).includes('private'), false, internalCode);
  }
});

test('event route rejects query ambiguity, invalid JSON, forbidden roles, forged fields, and path/body mismatch', async () => {
  let writes = 0;
  const operatorApp = appWith({
    authenticate: () => principal('operator'),
    applyRunEvent: () => { writes += 1; return appliedResult(); },
  });
  const query = await invoke(operatorApp, {
    method: 'POST',
    url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events?extra=1',
    body: JSON.stringify(eventCommand()),
  });
  assert.equal(query.status, 400);
  assert.equal(query.body.code, 'INVALID_REQUEST');

  const invalidJson = await invoke(operatorApp, {
    method: 'POST',
    url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
    body: '{',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.code, 'INVALID_JSON');

  const oversized = await invoke(operatorApp, {
    method: 'POST',
    url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
    body: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
  });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.code, 'INVALID_REQUEST');

  const forged = await invoke(operatorApp, {
    method: 'POST',
    url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
    body: JSON.stringify(eventCommand({ actorId: 'FORGED-ACTOR' })),
  });
  assert.equal(forged.status, 422);
  assert.equal(forged.body.code, 'INVALID_RUN_EVENT_COMMAND');

  const mismatch = await invoke(operatorApp, {
    method: 'POST',
    url: '/api/v2/schedule-items/OTHER-SCHEDULE/events',
    body: JSON.stringify(eventCommand()),
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'SCHEDULE_ITEM_ID_MISMATCH');

  for (const role of ['viewer', 'submitter']) {
    const forbiddenApp = appWith({
      authenticate: () => principal(role),
      applyRunEvent: () => { writes += 1; return appliedResult(); },
    });
    const forbidden = await invoke(forbiddenApp, {
      method: 'POST',
      url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
      body: JSON.stringify(eventCommand()),
    });
    assert.equal(forbidden.status, 403, role);
    assert.equal(forbidden.body.code, 'FORBIDDEN', role);
  }
  assert.equal(writes, 0);
});

test('event route passes only validated command and trusted principal, then applies stable result mapping', async () => {
  for (const role of ['operator', 'scheduler', 'administrator']) {
    const received = [];
    const app = appWith({
      authenticate: () => principal(role),
      applyRunEvent: input => {
        received.push(input);
        return appliedResult({ replayed: role === 'scheduler' });
      },
    });
    const response = await invoke(app, {
      method: 'POST',
      url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
      body: JSON.stringify(eventCommand()),
    });
    assert.equal(response.status, role === 'scheduler' ? 200 : 201, role);
    assert.equal(validateKioskRunEventResult(response.body).ok, true, role);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].command, eventCommand());
    assert.equal(received[0].principal.role, role);
    assert.equal(received[0].command.actorId, undefined);
  }
});

test('event mapper preserves 202 review and 409 conflict semantics without internal disclosure', async () => {
  const outcomes = [
    {
      result: {
        ok: false,
        code: 'EVENT_TIME_REVIEW_REQUIRED',
        replayed: true,
        eventId: 'EVENT-0001',
        runId: 'RUN-0001',
        scheduleItemId: 'SCHEDULE-ITEM-0001',
        reviewStatus: 'pending',
        reviewReason: 'tooOld',
        policyVersion: 'kiosk-event-time-local-v1',
        receivedAt: '2026-09-22T09:30:00.000Z',
        details: 'private',
      },
      status: 202,
      code: 'EVENT_TIME_REVIEW_REQUIRED',
    },
    {
      result: {
        ok: false,
        code: 'REVISION_CONFLICT',
        eventId: 'EVENT-0001',
        runId: 'RUN-0001',
        scope: 'run',
        currentRevision: 4,
        stack: 'private',
      },
      status: 409,
      code: 'REVISION_CONFLICT',
    },
  ];
  for (const outcome of outcomes) {
    const app = appWith({
      authenticate: () => principal('operator'),
      applyRunEvent: () => outcome.result,
    });
    const response = await invoke(app, {
      method: 'POST',
      url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
      body: JSON.stringify(eventCommand()),
    });
    assert.equal(response.status, outcome.status);
    assert.equal(response.body.code, outcome.code);
    assert.equal(validateKioskRunEventResult(response.body).ok, true);
    assert.equal(JSON.stringify(response.body).includes('private'), false);
  }
});

test('Kiosk dependency exceptions and missing use cases never expose internal details', async () => {
  const readFailure = appWith({
    authenticate: () => principal('viewer'),
    readCurrent: () => { throw new Error('SQL /private/db token'); },
  });
  const readResponse = await invoke(readFailure, { url: '/api/v2/kiosk/current?resourceId=RESOURCE-A' });
  assert.equal(readResponse.status, 500);
  assert.deepEqual(readResponse.body, { schemaVersion: 2, ok: false, code: 'INTERNAL_ERROR', replayed: false });

  const missingWrite = appWith({ authenticate: () => principal('operator') });
  const writeResponse = await invoke(missingWrite, {
    method: 'POST',
    url: '/api/v2/schedule-items/SCHEDULE-ITEM-0001/events',
    body: JSON.stringify(eventCommand()),
  });
  assert.equal(writeResponse.status, 503);
  assert.equal(writeResponse.body.code, 'SERVICE_UNAVAILABLE');
});
