import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createWriteAdmissionControl,
  normalizeWriteAdmissionMode,
} from '../src/write-admission-v1.mjs';
import { createOperationsServer } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';

const tokens = {
  viewer: 'viewer-token-000000000001',
  submitter: 'submitter-token-00000001',
  scheduler: 'scheduler-token-00000001',
  administrator: 'administrator-token-0001',
};

function requestPayload(operationId = 'write-admission-request-0001') {
  return {
    schemaVersion: 1,
    operationId,
    productionType: '平面',
    shootingSubtype: '产品',
    deliverableCount: 1,
    aspectRatio: '1:1',
    sku: 'SKU-WRITE-ADMISSION',
    name: 'Write admission test',
    kind: '产品',
    deliver: 'test',
    requestedBy: 'test',
  };
}

test('pre-activation fence stays closed until one in-process admission transition', async () => {
  const service = createOperationsServer({
    databasePath: ':memory:',
    tokens,
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
    cleanupIntervalMs: 0,
    clock: () => new Date('2026-09-27T12:00:00.000Z'),
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const origin = `http://127.0.0.1:${service.server.address().port}`;

  try {
    const healthBefore = await fetch(`${origin}/healthz`);
    assert.equal(healthBefore.status, 200);
    assert.equal(healthBefore.headers.get('x-write-admission'), 'disabled');
    assert.deepEqual(await healthBefore.json(), {
      ok: true,
      service: 'jenn-shooting-operations',
    });

    const before = await fetch(`${origin}/api/v1/snapshot`);
    const beforeBody = await before.json();
    assert.equal(beforeBody.snapshot.revision, 0);

    const blocked = await fetch(`${origin}/api/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload()),
    });
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).code, 'WRITE_ADMISSION_DISABLED');

    assert.deepEqual(
      service.store.submitRequest({ submission: requestPayload(), role: 'direct-store' }),
      { ok: false, status: 503, code: 'WRITE_ADMISSION_DISABLED' },
    );

    const cleanupBefore = service.orphanCleanupControl.status();
    assert.equal(cleanupBefore.enabled, false);
    const cleanupEnableBlocked = service.orphanCleanupControl.enable({
      expectedEpoch: cleanupBefore.epoch,
    });
    assert.equal(cleanupEnableBlocked.ok, false);
    assert.equal(cleanupEnableBlocked.code, 'WRITE_ADMISSION_DISABLED');
    assert.equal(service.orphanCleanupControl.status().enabled, false);

    const admission = service.writeAdmissionControl.enable();
    assert.equal(admission.ok, true);
    assert.equal(admission.code, 'WRITE_ADMISSION_ENABLED');
    assert.equal(admission.mode, 'enabled');
    assert.equal(admission.transitionCount, 1);

    const healthAfter = await fetch(`${origin}/healthz`);
    assert.equal(healthAfter.status, 200);
    assert.equal(healthAfter.headers.get('x-write-admission'), 'enabled');
    assert.deepEqual(await healthAfter.json(), {
      ok: true,
      service: 'jenn-shooting-operations',
    });

    const admitted = await fetch(`${origin}/api/v1/snapshot`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokens.scheduler}`,
        'Content-Type': 'application/json',
        'If-Match': '0',
        'Idempotency-Key': 'write-admission-snapshot-0002',
      },
      body: JSON.stringify(beforeBody.snapshot),
    });
    assert.equal(admitted.status, 200);

    const after = await fetch(`${origin}/api/v1/snapshot`);
    const afterBody = await after.json();
    assert.equal(afterBody.snapshot.revision, 1);
    assert.equal(afterBody.snapshot.tasks.length, 0);

    assert.equal(service.orphanCleanupControl.status().enabled, false);
  } finally {
    service.server.close();
    await once(service.server, 'close');
  }
});

test('pre-activation HTTP fence blocks all mutating methods before dispatch', async () => {
  const service = createOperationsServer({
    databasePath: ':memory:',
    tokens,
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
    cleanupIntervalMs: 0,
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${origin}/api/v1/snapshot`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : '{}',
      });
      assert.equal(response.status, 503, method);
      assert.equal((await response.json()).code, 'WRITE_ADMISSION_DISABLED');
    }
  } finally {
    service.server.close();
    await once(service.server, 'close');
  }
});

test('ScheduleStore directly rejects disabled admission unless cleanup is disabled before filesystem mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'jso-write-admission-store-'));
  const databasePath = join(root, 'nested', 'shooting-operations.sqlite');
  const admission = createWriteAdmissionControl({ initialMode: 'disabled' });

  try {
    for (const orphanCleanupMode of ['inherit', 'enabled']) {
      assert.throws(
        () => new ScheduleStore({
          filename: databasePath,
          writeAdmissionControl: admission,
          orphanCleanupMode,
        }),
        /disabled write admission requires disabled orphan cleanup/u,
      );
      assert.equal(existsSync(join(root, 'nested')), false);
    }

    const allowed = new ScheduleStore({
      filename: ':memory:',
      writeAdmissionControl: admission,
      orphanCleanupMode: 'disabled',
    });
    try {
      assert.equal(allowed.getSnapshot().revision, 0);
      assert.equal(allowed.getOrphanCleanupControlStatus().enabled, false);
    } finally {
      allowed.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pre-activation write admission cannot start with cleanup enabled', () => {
  assert.throws(
    () => createOperationsServer({
      databasePath: ':memory:',
      tokens,
      writeAdmissionMode: 'disabled',
      orphanCleanupMode: 'enabled',
      cleanupIntervalMs: 0,
    }),
    /disabled write admission requires disabled orphan cleanup/u,
  );
});

test('write admission mode rejects unknown deployment values', () => {
  assert.equal(normalizeWriteAdmissionMode('enabled'), 'enabled');
  assert.equal(normalizeWriteAdmissionMode('DISABLED'), 'disabled');
  assert.throws(
    () => normalizeWriteAdmissionMode('staging'),
    /write admission mode must be enabled or disabled/u,
  );
});
