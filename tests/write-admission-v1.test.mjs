import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { normalizeWriteAdmissionMode } from '../src/http-app.mjs';
import { createOperationsServer } from '../src/server.mjs';

const tokens = {
  viewer: 'viewer-token-000000000001',
  submitter: 'submitter-token-00000001',
  scheduler: 'scheduler-token-00000001',
  administrator: 'administrator-token-0001',
};

test('pre-activation write admission blocks every HTTP mutation before store dispatch', async () => {
  const service = createOperationsServer({
    databasePath: ':memory:',
    tokens,
    writeAdmissionMode: 'disabled',
    cleanupIntervalMs: 0,
    clock: () => new Date('2026-09-27T12:00:00.000Z'),
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const origin = `http://127.0.0.1:${service.server.address().port}`;

  try {
    const before = await fetch(`${origin}/api/v1/snapshot`);
    assert.equal(before.status, 200);
    const beforeBody = await before.json();
    assert.equal(beforeBody.snapshot.revision, 0);

    const cases = [
      {
        path: '/api/v1/requests',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      },
      {
        path: '/api/v1/uploads?operationId=write-admission-0001&kind=attachment',
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-File-Name': 'blocked.txt',
          },
          body: 'blocked',
        },
      },
      {
        path: '/api/v1/snapshot',
        init: {
          method: 'PUT',
          headers: {
            ...{ Authorization: `Bearer ${tokens.scheduler}` },
            'Content-Type': 'application/json',
            'If-Match': '0',
            'Idempotency-Key': 'write-admission-snapshot-0001',
          },
          body: JSON.stringify(beforeBody.snapshot),
        },
      },
      {
        path: '/api/v2/schedule-items/example/events',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      },
      {
        path: '/api/v2/proposals/example/decisions',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      },
    ];

    for (const candidate of cases) {
      const response = await fetch(origin + candidate.path, candidate.init);
      assert.equal(response.status, 503, candidate.path);
      assert.deepEqual(await response.json(), {
        ok: false,
        code: 'WRITE_ADMISSION_DISABLED',
      });
    }

    const after = await fetch(`${origin}/api/v1/snapshot`);
    assert.equal(after.status, 200);
    const afterBody = await after.json();
    assert.equal(afterBody.snapshot.revision, 0);
    assert.deepEqual(afterBody.snapshot.tasks, []);
  } finally {
    service.server.close();
    await once(service.server, 'close');
  }
});

test('write admission mode rejects unknown deployment values', () => {
  assert.equal(normalizeWriteAdmissionMode('enabled'), 'enabled');
  assert.equal(normalizeWriteAdmissionMode('DISABLED'), 'disabled');
  assert.throws(
    () => normalizeWriteAdmissionMode('staging'),
    /write admission mode must be enabled or disabled/u,
  );
});
