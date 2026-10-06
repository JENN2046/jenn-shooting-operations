import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ScheduleStore } from '../src/store.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { createJsoAgentBoundary } from '../src/jso-agent-host-v1.mjs';
import { createSqliteAgentGrantAttemptStoreV1 } from '../src/sqlite-agent-grant-attempt-store-v1.mjs';
import {
  JSO_AGENT_COMMANDS,
  JSO_AGENT_PATH,
  parseJsoAgentArguments,
  parseJsoAgentEnvelope,
  agentCommandDigest,
  createJsoAgentApplication,
  createJsoAgentHttpHandler,
} from '../src/jso-agent-api-v1.mjs';

const plannerToken = 'local-test-planner-'.padEnd(40, 'p');
const executorToken = 'local-test-executor-'.padEnd(40, 'e');
const command = { operationId: 'MOVE-1', resourceId: 'R1' };
const args = (action, payload = {}) => ({ command: action, payload_json: JSON.stringify(payload) });

function fixture({ mode = 'planner', grants = [], result = { ok: true }, handler, claimGrantAttempt } = {}) {
  const calls = [], attempted = new Set();
  const claim = claimGrantAttempt ?? (input => {
    const key = JSON.stringify(input);
    if (attempted.has(key)) return { ok: false, code: 'RECONCILIATION_REQUIRED' };
    attempted.add(key);
    return { ok: true };
  });
  const service = Object.fromEntries(Object.values(JSO_AGENT_COMMANDS).map(method => [method, input => {
    calls.push({ method, input });
    return handler ? handler(input) : result;
  }]));
  let at = '2026-10-01T12:30:00.000Z';
  const identity = {
    token: mode === 'planner' ? plannerToken : executorToken,
    subjectId: 'agent-JSO',
    mode,
    resourceIds: ['R1'],
    grants,
  };
  const application = createJsoAgentApplication({ service, identities: [identity],
    claimGrantAttempt: claim, clock: () => new Date(at) });
  return {
    calls,
    identity,
    application,
    setTime: value => { at = value; },
    call: (action, payload = {}) => application.call({
      authorization: `Bearer ${identity.token}`,
      arguments: args(action, payload),
    }),
  };
}

function schema11Store({ disabled = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jso-agent-api-'));
  const filename = join(root, 'db.sqlite');
  const uploadRoot = join(root, 'uploads');
  mkdirSync(uploadRoot);
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  initializeWritableSchema(db);
  db.close();
  const store = new ScheduleStore({
    filename,
    uploadRoot,
    writeAdmissionMode: disabled ? 'disabled' : 'enabled',
    orphanCleanupMode: 'disabled',
  });
  return { store, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

function grant(payload = command) {
  return {
    approvalRef: 'JSO-LOCAL-TEST',
    subjectId: 'agent-JSO',
    action: 'reschedule',
    commandDigest: agentCommandDigest('reschedule', payload),
    notBefore: '2026-10-01T12:00:00.000Z',
    expiresAt: '2026-10-01T13:00:00.000Z',
  };
}

test('agent API accepts only the exact stable envelope and rejects reserved/framing input', () => {
  assert.equal(parseJsoAgentArguments(args('read_state', { resourceScope: ['R1'] })).ok, true);
  for (const extra of ['archery', 'ink', 'river', 'vref', 'tool_ref', 'role']) {
    assert.equal(parseJsoAgentArguments({ ...args('read_state'), [extra]: 'yes' }).ok, false);
  }
  for (const json of [
    '{"x":1,"x":2}',
    '{"x":{"a":1,"a":2}}',
    '{"__proto__":{}}',
    '{"token":"secret"}',
    '{"role":"administrator"}',
    '[]',
    'null',
    '{',
  ]) {
    assert.equal(parseJsoAgentArguments({ command: 'read_state', payload_json: json }).ok, false);
  }
  assert.equal(parseJsoAgentArguments({ command: 'read_state', payload_json: '{"x":"file:///etc/secret"}' }).ok, false);
});

test('duplicate wire keys and invalid unicode fail before service dispatch', async () => {
  const f = fixture({ mode: 'executor' });
  for (const payload_json of ['{"operationId":"\\ud800"}', '{"operationId":"\\u0000"}', '{"operationId":"\\n"}']) {
    const result = await f.application.call({
      authorization: `Bearer ${executorToken}`,
      arguments: { command: 'reschedule', payload_json },
    });
    assert.equal(result.code, 'INVALID_AGENT_ARGUMENTS');
  }
  for (const text of [
    '{"command":"read_state","command":"reschedule","payload_json":"{}"}',
    '{"command":"read_state","\\u0063ommand":"reschedule","payload_json":"{}"}',
  ]) {
    assert.equal(parseJsoAgentEnvelope(text).ok, false);
  }
  assert.equal(f.calls.length, 0);
});

test('planner is read/advice only and never dispatches mutation methods', async () => {
  const f = fixture();
  for (const action of ['read_state', 'preview_calendar', 'generate_proposal', 'read_receipt']) {
    assert.equal((await f.call(action)).ok, true);
  }
  for (const action of ['adopt_proposal', 'reschedule']) {
    assert.equal((await f.call(action)).code, 'AGENT_SUGGEST_ONLY');
  }
  assert.equal(f.calls.length, 4);
  for (const call of f.calls) {
    assert.equal(call.input.principal.role, 'viewer');
    assert.equal(call.input.principal.capabilities.modifySchedule, false);
  }
});

test('executor requires exact command grant and bounded time window', async () => {
  assert.equal((await fixture({ mode: 'executor' }).call('reschedule', command)).code, 'EXACT_APPROVAL_REQUIRED');
  const f = fixture({ mode: 'executor', grants: [grant()] });
  assert.equal((await f.call('reschedule', { ...command, resourceId: 'R2' })).code, 'EXACT_APPROVAL_REQUIRED');
  assert.equal((await f.call('adopt_proposal', command)).code, 'EXACT_APPROVAL_REQUIRED');
  f.setTime('2026-10-01T11:59:59.999Z');
  assert.equal((await f.call('reschedule', command)).code, 'EXACT_APPROVAL_REQUIRED');
  f.setTime('2026-10-01T13:00:00.000Z');
  assert.equal((await f.call('reschedule', command)).code, 'EXACT_APPROVAL_REQUIRED');
  f.setTime('2026-10-01T12:00:00.000Z');
  const result = await f.call('reschedule', command);
  assert.equal(result.ok, true);
  assert.equal(result.agent.approvalRef, 'JSO-LOCAL-TEST');
  assert.equal((await f.call('reschedule', command)).code, 'RECONCILIATION_REQUIRED');
  assert.equal(f.calls.length, 1);
});

test('credentials and grants are trusted construction inputs, not request data', async () => {
  const f = fixture();
  assert.equal((await f.application.call({
    authorization: 'Bearer wrong',
    arguments: args('read_state'),
  })).code, 'UNAUTHENTICATED');
  assert.throws(() => fixture({ grants: [grant()] }));
  assert.throws(() => fixture({ mode: 'executor', grants: [{ ...grant(), subjectId: 'other' }] }));
  assert.throws(() => fixture({ mode: 'executor', grants: [{ ...grant(), expiresAt: 'invalid' }] }));
  assert.equal(f.calls.length, 0);
});

test('write dispatch receives a live trusted expiry guard', async () => {
  const f = fixture({
    mode: 'executor',
    grants: [grant()],
    handler: ({ executionGuard }) => {
      assert.equal(executionGuard(), true);
      f.setTime('2026-10-01T13:00:00.000Z');
      return { ok: executionGuard(), code: 'AGENT_EXECUTION_WINDOW_CLOSED' };
    },
  });
  assert.equal((await f.call('reschedule', command)).ok, false);
});

test('unknown write is never retried and original receipt read remains available', async () => {
  const f = fixture({
    mode: 'executor',
    grants: [grant()],
    handler: () => { throw new Error('secret-path-and-token'); },
  });
  assert.deepEqual(await f.call('reschedule', command), { ok: false, code: 'RESULT_UNKNOWN' });
  assert.equal((await f.call('reschedule', command)).code, 'RECONCILIATION_REQUIRED');
  assert.equal(f.calls.length, 1);
  await f.call('read_receipt', { operationId: 'MOVE-1' });
  assert.equal(f.calls.length, 2);
});

test('simultaneous write attempts consume at most one exact grant', async () => {
  const g = grant();
  const f = fixture({ mode: 'executor', grants: [g], result: { ok: false, code: 'WRITE_ADMISSION_DISABLED' } });
  g.commandDigest = agentCommandDigest('reschedule', { ...command, resourceId: 'R2' });
  const results = await Promise.all([f.call('reschedule', command), f.call('reschedule', command)]);
  assert.deepEqual(results.map(x => x.code), ['WRITE_ADMISSION_DISABLED', 'RECONCILIATION_REQUIRED']);
  assert.equal(f.calls.length, 1);
});

test('dedicated HTTP endpoint preserves server-side enforcement and rejects duplicate envelope keys', async () => {
  const f = fixture();
  const server = createServer(createJsoAgentHttpHandler(f.application));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(origin + JSO_AGENT_PATH, {
      method: 'POST',
      headers: { authorization: `Bearer ${plannerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(args('read_state', { resourceScope: ['R1'] })),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    const legacy = await fetch(origin + '/api/v2/business/resources', { method: 'POST', body: '{}' });
    assert.equal(legacy.status, 404);
    const duplicate = await fetch(origin + JSO_AGENT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"command":"read_state","command":"reschedule","payload_json":"{}"}',
    });
    assert.equal(duplicate.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('agent boundary fails closed before Schema11 cutover', async () => {
  const store = new ScheduleStore({ filename: ':memory:', orphanCleanupMode: 'disabled' });
  try {
    const boundary = createJsoAgentBoundary({
      store,
      clock: () => new Date('2026-10-01T12:30:00.000Z'),
      identities: [{ token: plannerToken, subjectId: 'planner', mode: 'planner', resourceIds: ['R1'] }],
    });
    const result = await boundary.application.call({
      authorization: `Bearer ${plannerToken}`,
      arguments: args('read_state', { resourceScope: ['R1'] }),
    });
    assert.equal(result.code, 'BUSINESS_SCHEMA11_REQUIRED');
    assert.equal(store.db.prepare('SELECT max(version) version FROM schema_migrations').get().version, 10);
  } finally {
    store.close();
  }
});

test('durable grant consumption survives restart and blocks a second dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-agent-grant-restart-'));
  const filename = join(root, 'db.sqlite');
  const uploadRoot = join(root, 'uploads');
  mkdirSync(uploadRoot);
  const bootstrap = new DatabaseSync(filename);
  bootstrap.exec('PRAGMA foreign_keys = ON');
  initializeWritableSchema(bootstrap);
  bootstrap.close();

  const identity = { token: executorToken, subjectId: 'agent-JSO', mode: 'executor',
    resourceIds: ['R1'], grants: [grant()] };
  let serviceCalls = 0;
  const service = Object.fromEntries(Object.values(JSO_AGENT_COMMANDS).map(method => [method, () => {
    serviceCalls += 1;
    if (method === 'reschedule') throw new Error('synthetic unknown outcome');
    return { ok: true };
  }]));

  const firstStore = new ScheduleStore({ filename, uploadRoot, orphanCleanupMode: 'disabled' });
  try {
    const attempts = createSqliteAgentGrantAttemptStoreV1({ db: firstStore.db,
      now: () => new Date('2026-10-01T12:30:00.000Z') });
    const first = createJsoAgentApplication({ service, identities: [identity],
      claimGrantAttempt: attempts.claim, clock: () => new Date('2026-10-01T12:30:00.000Z') });
    const result = await first.call({ authorization: `Bearer ${executorToken}`,
      arguments: args('reschedule', command) });
    assert.equal(result.code, 'RESULT_UNKNOWN');
    assert.equal(serviceCalls, 1);
    assert.equal(firstStore.db.prepare('SELECT count(*) n FROM agent_grant_attempts').get().n, 1);
    assert.throws(() => firstStore.db.exec('DELETE FROM agent_grant_attempts'), /immutable/);
    assert.throws(() => firstStore.db.exec("UPDATE agent_grant_attempts SET subject_id='other'"), /immutable/);
  } finally {
    firstStore.close();
  }

  const secondStore = new ScheduleStore({ filename, uploadRoot, orphanCleanupMode: 'disabled' });
  try {
    const attempts = createSqliteAgentGrantAttemptStoreV1({ db: secondStore.db,
      now: () => new Date('2026-10-01T12:30:00.000Z') });
    const second = createJsoAgentApplication({ service, identities: [identity],
      claimGrantAttempt: attempts.claim, clock: () => new Date('2026-10-01T12:30:00.000Z') });
    const result = await second.call({ authorization: `Bearer ${executorToken}`,
      arguments: args('reschedule', command) });
    assert.equal(result.code, 'RECONCILIATION_REQUIRED');
    assert.equal(serviceCalls, 1);
    assert.equal(secondStore.db.prepare('SELECT count(*) n FROM agent_grant_attempts').get().n, 1);
  } finally {
    secondStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('actual JSO host composition exposes read scope but respects global write admission', async () => {
  const fixture = schema11Store({ disabled: true });
  try {
    const boundary = createJsoAgentBoundary({
      store: fixture.store,
      clock: () => new Date('2026-10-01T12:30:00.000Z'),
      identities: [
        { token: plannerToken, subjectId: 'planner', mode: 'planner', resourceIds: ['R1'] },
        { token: executorToken, subjectId: 'agent-JSO', mode: 'executor', resourceIds: ['R1'], grants: [grant()] },
      ],
    });
    const read = await boundary.application.call({
      authorization: `Bearer ${plannerToken}`,
      arguments: args('read_state', { resourceScope: ['R1'] }),
    });
    assert.equal(read.ok, true);
    assert.equal(read.writeAdmission, 'disabled');
    assert.deepEqual(read.resources, []);
    const denied = await boundary.application.call({
      authorization: `Bearer ${executorToken}`,
      arguments: args('reschedule', command),
    });
    assert.equal(denied.code, 'WRITE_ADMISSION_DISABLED');
    assert.equal(fixture.store.db.prepare('SELECT count(*) n FROM schedule_reschedule_operations').get().n, 0);
  } finally {
    fixture.close();
  }
});
