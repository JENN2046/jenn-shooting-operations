import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createHttpApp } from '../src/http-app.mjs';

function principal(role = 'scheduler', resourceIds = ['STUDIO-A']) {
  const created = createTrustedPrincipal({
    subjectId: `ACTOR-${role}`,
    role,
    resourceIds,
  });
  assert.equal(created.ok, true);
  return created.principal;
}

function fakeStore() {
  return {
    getSnapshot: () => ({
      schemaVersion: 1,
      revision: 0,
      updatedAt: '2026-09-23T08:00:00.000Z',
      products: [],
      tasks: [],
      sessions: [],
    }),
  };
}

async function invoke(app, {
  method = 'POST',
  url = '/api/v2/proposals/sp_123/decisions',
  headers = {},
  body,
} = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  let status = null;
  const chunks = [];
  const response = {
    setHeader() {},
    writeHead(nextStatus) { status = nextStatus; },
    end(chunk) { if (chunk !== undefined) chunks.push(Buffer.from(chunk)); },
  };
  await app(request, response);
  const text = Buffer.concat(chunks).toString('utf8');
  return { status, body: text === '' ? null : JSON.parse(text) };
}

function command(overrides = {}) {
  return {
    decisionId: 'DEC-HTTP-0001',
    proposalId: 'sp_123',
    decisionType: 'accept',
    selectedProposalItemIds: ['spi_1'],
    decisionNote: null,
    reasonCode: null,
    ...overrides,
  };
}

test('scheduling decisions fail closed without a trusted HTTP principal', async () => {
  for (const { scheduling, expectedStatus, expectedCode } of [
    { scheduling: null, expectedStatus: 401, expectedCode: 'AUTH_NOT_CONFIGURED' },
    {
      scheduling: {
        authenticate: () => ({
          subjectId: 'forged',
          role: 'administrator',
          resourceIds: ['STUDIO-A'],
        }),
      },
      expectedStatus: 401,
      expectedCode: 'UNAUTHENTICATED',
    },
    {
      scheduling: { authenticate: () => principal('viewer') },
      expectedStatus: 403,
      expectedCode: 'FORBIDDEN',
    },
  ]) {
    const app = createHttpApp({ store: fakeStore(), scheduling });
    const response = await invoke(app, { body: JSON.stringify(command()) });
    assert.equal(response.status, expectedStatus);
    assert.equal(response.body.code, expectedCode);
  }
});

test('body role claims cannot upgrade an unprivileged principal', async () => {
  let calls = 0;
  const app = createHttpApp({
    store: fakeStore(),
    scheduling: {
      authenticate: () => principal('viewer'),
      acceptProposal: () => { calls += 1; return { ok: true, receipt: {} }; },
    },
  });
  const response = await invoke(app, {
    body: JSON.stringify({ ...command(), role: 'administrator', subjectId: 'forged-admin' }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'FORBIDDEN');
  assert.equal(calls, 0);
});

test('proposal path is authoritative and query parameters are rejected', async () => {
  let calls = 0;
  const scheduling = {
    authenticate: () => principal(),
    acceptProposal: () => { calls += 1; return { ok: true, receipt: {} }; },
  };
  const app = createHttpApp({ store: fakeStore(), scheduling });

  const mismatch = await invoke(app, {
    body: JSON.stringify(command({ proposalId: 'sp_other' })),
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.code, 'PROPOSAL_ID_MISMATCH');

  const query = await invoke(app, {
    url: '/api/v2/proposals/sp_123/decisions?actor=admin',
    body: JSON.stringify(command()),
  });
  assert.equal(query.status, 400);
  assert.equal(query.body.code, 'INVALID_REQUEST');
  assert.equal(calls, 0);
});

test('trusted scheduler/admin principals reach the acceptance application unchanged', async () => {
  for (const role of ['scheduler', 'administrator']) {
    const expectedPrincipal = principal(role, ['STUDIO-A', 'STUDIO-B']);
    let received = null;
    const app = createHttpApp({
      store: fakeStore(),
      scheduling: {
        authenticate: () => expectedPrincipal,
        acceptProposal: input => {
          received = input;
          return {
            ok: true,
            receipt: {
              decisionId: input.command.decisionId,
              proposalId: input.command.proposalId,
              decisionType: input.command.decisionType,
            },
            exactReplay: false,
          };
        },
      },
    });
    const expectedCommand = command({ decisionId: `DEC-${role}-0001` });
    const response = await invoke(app, { body: JSON.stringify(expectedCommand) });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.exactReplay, false);
    assert.deepEqual(received, { command: expectedCommand, principal: expectedPrincipal });
  }
});

test('scheduling application denials use stable low-disclosure HTTP mappings', async () => {
  const cases = [
    ['SCHEDULING_PROPOSAL_DECISION_COMMAND_INVALID', 422],
    ['IDEMPOTENCY_KEY_REUSE', 409],
    ['PROPOSAL_NOT_DRAFT', 409],
    ['SCHEDULING_CALENDAR_COMPILE_FAILED', 409],
    ['PROPOSAL_NOT_FOUND', 404],
    ['TRUSTED_SCHEDULER_REQUIRED', 403],
    ['SCHEDULING_INPUT_ASSEMBLY_FAILED', 503],
    ['PROPOSAL_ACCEPT_NOT_WIRED', 503],
  ];
  for (const [code, status] of cases) {
    const app = createHttpApp({
      store: fakeStore(),
      scheduling: {
        authenticate: () => principal(),
        acceptProposal: () => ({ ok: false, code, internalDetail: 'must-not-leak' }),
      },
    });
    const response = await invoke(app, { body: JSON.stringify(command()) });
    assert.equal(response.status, status, code);
    assert.deepEqual(response.body, { ok: false, code }, code);
  }
});

test('unexpected scheduling failures are reduced to INTERNAL_ERROR', async () => {
  const throwing = createHttpApp({
    store: fakeStore(),
    scheduling: {
      authenticate: () => principal(),
      acceptProposal: () => { throw new Error('SQLITE SECRET PATH'); },
    },
  });
  const thrown = await invoke(throwing, { body: JSON.stringify(command()) });
  assert.equal(thrown.status, 500);
  assert.deepEqual(thrown.body, { ok: false, code: 'INTERNAL_ERROR' });

  const invalid = createHttpApp({
    store: fakeStore(),
    scheduling: {
      authenticate: () => principal(),
      acceptProposal: () => ({ ok: false, code: 'UNRECOGNIZED_INTERNAL_FAILURE' }),
    },
  });
  const mapped = await invoke(invalid, { body: JSON.stringify(command()) });
  assert.equal(mapped.status, 500);
  assert.deepEqual(mapped.body, { ok: false, code: 'INTERNAL_ERROR' });
});
