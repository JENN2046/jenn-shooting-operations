import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  createWriteAdmissionControl,
  normalizeWriteAdmissionMode,
} from '../src/write-admission-v1.mjs';
import { createOperationsServer } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';
import { buildProductionRunCompletedNotificationV1 } from '../src/production-run-completed-notification-v1.mjs';
import { createSqliteOutboxRepositoryV1 } from '../src/sqlite-outbox-repository-v1.mjs';

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

test('ScheduleStore public write helpers and recovery stay fenced while admission is disabled', () => {
  const admission = createWriteAdmissionControl({ initialMode: 'disabled' });
  const store = new ScheduleStore({
    filename: ':memory:',
    writeAdmissionControl: admission,
    orphanCleanupMode: 'disabled',
  });
  try {
    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;

    assert.deepEqual(
      store.recordOperation(
        'DIRECT-OPERATION-0001',
        'direct.test',
        { ok: true },
        '2026-09-27T13:00:00.000Z',
      ),
      { ok: false, status: 503, code: 'WRITE_ADMISSION_DISABLED' },
    );
    assert.deepEqual(
      store.recordAudit(
        'direct.test',
        'administrator',
        null,
        0,
        'blocked',
        '2026-09-27T13:00:00.000Z',
      ),
      { ok: false, status: 503, code: 'WRITE_ADMISSION_DISABLED' },
    );

    const recovery = store.recoverStagedUploadCleanup();
    assert.equal(recovery.ok, false);
    assert.equal(recovery.code, 'WRITE_ADMISSION_DISABLED');

    const enabled = createWriteAdmissionControl({ initialMode: 'enabled' });
    assert.throws(
      () => { store.writeAdmissionControl = enabled; },
      TypeError,
    );
    assert.equal(store.writeAdmissionControl, admission);
    assert.throws(
      () => Object.defineProperty(store, 'writeAdmissionControl', { value: enabled }),
      TypeError,
    );
    assert.equal(store.writeAdmissionControl, admission);

    const after = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(after, before);
  } finally {
    store.close();
  }
});

test('raw SQLite access is hidden behind the live admission authorizer', () => {
  const admission = createWriteAdmissionControl({ initialMode: 'disabled' });
  const store = new ScheduleStore({
    filename: ':memory:',
    writeAdmissionControl: admission,
    orphanCleanupMode: 'disabled',
  });
  try {
    assert.equal(typeof store.db.prepare, 'function');
    assert.equal(typeof store.db.exec, 'function');
    assert.equal(typeof store.db.setAuthorizer, 'undefined');
    assert.equal(typeof store.db.deserialize, 'undefined');
    assert.equal(typeof store.db.createSession, 'undefined');
    assert.equal(typeof store.db.createTagStore, 'undefined');
    assert.equal(typeof store.db.loadExtension, 'undefined');

    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(store.db.prepare('SELECT revision FROM schedule_state WHERE id = 1').get().revision, 0);

    assert.throws(
      () => store.db.prepare(
        "INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('raw', 'admin', NULL, 0, 'blocked', '2026-09-27T13:00:00.000Z')",
      ).run(),
    );
    assert.throws(
      () => store.db.exec('UPDATE schedule_state SET revision = revision + 1 WHERE id = 1'),
    );
    assert.throws(
      () => store.db.exec('PRAGMA user_version = 1'),
    );

    const fenced = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(fenced, before);
    assert.equal(store.getSnapshot().revision, 0);

    const enabled = admission.enable();
    assert.equal(enabled.ok, true);
    assert.equal(enabled.code, 'WRITE_ADMISSION_ENABLED');

    store.db.prepare(
      "INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('raw-after-enable', 'admin', NULL, 0, 'allowed', '2026-09-27T13:00:00.000Z')",
    ).run();
    const after = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(after, before + 1);
  } finally {
    store.close();
  }
});

test('prepared statement facade cannot expose or extend the raw StatementSync target', () => {
  const admission = createWriteAdmissionControl({ initialMode: 'disabled' });
  const store = new ScheduleStore({
    filename: ':memory:',
    writeAdmissionControl: admission,
    orphanCleanupMode: 'disabled',
  });
  try {
    const statement = store.db.prepare(
      "INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('proxy-bypass', 'admin', NULL, 0, 'blocked', '2026-09-27T13:00:00.000Z')",
    );
    assert.equal(Object.getPrototypeOf(statement), null);
    assert.equal(Object.isFrozen(statement), true);
    assert.equal(Object.isExtensible(statement), false);
    assert.equal('unwrap' in statement, false);

    assert.throws(
      () => Object.defineProperty(statement, 'unwrap', {
        value() { return this; },
      }),
      TypeError,
    );
    assert.equal('unwrap' in statement, false);

    assert.throws(
      () => { statement.unwrap = () => statement; },
      TypeError,
    );
    assert.throws(
      () => Object.setPrototypeOf(statement, {
        unwrap() { return this; },
      }),
      TypeError,
    );

    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.throws(() => statement.run());
    const after = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(after, before);
  } finally {
    store.close();
  }
});

test('SQLite bootstrap and facades ignore runtime native prototype replacement', () => {
  const admission = createWriteAdmissionControl({ initialMode: 'disabled' });

  const databaseDescriptors = Object.fromEntries(
    ['prepare', 'exec', 'setAuthorizer', 'close'].map(name => [
      name,
      Object.getOwnPropertyDescriptor(DatabaseSync.prototype, name),
    ]),
  );
  const statementDescriptors = Object.fromEntries(
    ['setAllowBareNamedParameters', 'run'].map(name => [
      name,
      Object.getOwnPropertyDescriptor(StatementSync.prototype, name),
    ]),
  );

  const originalDatabasePrepare = databaseDescriptors.prepare.value;
  const originalDatabaseExec = databaseDescriptors.exec.value;
  const originalDatabaseSetAuthorizer = databaseDescriptors.setAuthorizer.value;
  const originalDatabaseClose = databaseDescriptors.close.value;
  const originalStatementSetBare = statementDescriptors.setAllowBareNamedParameters.value;
  const originalStatementRun = statementDescriptors.run.value;

  let capturedDatabaseFromPrepare = null;
  let capturedDatabaseFromExec = null;
  let capturedDatabaseFromAuthorizer = null;
  let capturedDatabaseFromClose = null;
  let capturedStatementFromSetBare = null;
  let capturedStatementFromRun = null;
  let store = null;

  try {
    Object.defineProperty(DatabaseSync.prototype, 'prepare', {
      ...databaseDescriptors.prepare,
      value(...args) {
        capturedDatabaseFromPrepare = this;
        return originalDatabasePrepare.apply(this, args);
      },
    });
    Object.defineProperty(DatabaseSync.prototype, 'exec', {
      ...databaseDescriptors.exec,
      value(...args) {
        capturedDatabaseFromExec = this;
        return originalDatabaseExec.apply(this, args);
      },
    });
    Object.defineProperty(DatabaseSync.prototype, 'setAuthorizer', {
      ...databaseDescriptors.setAuthorizer,
      value(...args) {
        capturedDatabaseFromAuthorizer = this;
        return originalDatabaseSetAuthorizer.apply(this, args);
      },
    });
    Object.defineProperty(DatabaseSync.prototype, 'close', {
      ...databaseDescriptors.close,
      value(...args) {
        capturedDatabaseFromClose = this;
        return originalDatabaseClose.apply(this, args);
      },
    });
    Object.defineProperty(StatementSync.prototype, 'setAllowBareNamedParameters', {
      ...statementDescriptors.setAllowBareNamedParameters,
      value(...args) {
        capturedStatementFromSetBare = this;
        return originalStatementSetBare.apply(this, args);
      },
    });
    Object.defineProperty(StatementSync.prototype, 'run', {
      ...statementDescriptors.run,
      value(...args) {
        capturedStatementFromRun = this;
        return originalStatementRun.apply(this, args);
      },
    });

    assert.equal(new Set(['read']).has('write'), true);

    store = new ScheduleStore({
      filename: ':memory:',
      writeAdmissionControl: admission,
      orphanCleanupMode: 'disabled',
    });

    assert.equal(capturedDatabaseFromPrepare, null);
    assert.equal(capturedDatabaseFromExec, null);
    assert.equal(capturedDatabaseFromAuthorizer, null);

    const read = store.db.prepare('SELECT revision FROM schedule_state WHERE id = 1');
    assert.equal(read.get().revision, 0);
    assert.equal(capturedDatabaseFromPrepare, null);
    assert.equal(capturedDatabaseFromExec, null);
    assert.equal(capturedDatabaseFromAuthorizer, null);

    const write = store.db.prepare(
      "INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('prototype-bypass', 'admin', NULL, 0, 'blocked', '2026-09-27T13:00:00.000Z')",
    );
    write.setAllowBareNamedParameters(true);
    assert.equal(capturedStatementFromSetBare, null);

    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.throws(() => write.run());
    assert.equal(capturedStatementFromRun, null);
    assert.equal(
      store.db.prepare('SELECT total_changes() AS changes').get().changes,
      before,
    );

    admission.enable();
    write.run();
    assert.equal(capturedStatementFromRun, null);
    assert.equal(
      store.db.prepare('SELECT total_changes() AS changes').get().changes,
      before + 1,
    );

    store.close();
    store = null;
    assert.equal(capturedDatabaseFromClose, null);
    assert.equal(capturedDatabaseFromPrepare, null);
    assert.equal(capturedDatabaseFromExec, null);
    assert.equal(capturedDatabaseFromAuthorizer, null);
  } finally {
    for (const [name, descriptor] of Object.entries(databaseDescriptors)) {
      Object.defineProperty(DatabaseSync.prototype, name, descriptor);
    }
    for (const [name, descriptor] of Object.entries(statementDescriptors)) {
      Object.defineProperty(StatementSync.prototype, name, descriptor);
    }
    if (store) store.close();
  }
});

test('SQLite admission classification ignores Set.prototype.has replacement', () => {
  const admission = createWriteAdmissionControl({ initialMode: 'disabled' });
  const originalHas = Set.prototype.has;
  let store = null;

  try {
    Object.defineProperty(Set.prototype, 'has', {
      configurable: true,
      writable: true,
      value() {
        return true;
      },
    });

    store = new ScheduleStore({
      filename: ':memory:',
      writeAdmissionControl: admission,
      orphanCleanupMode: 'disabled',
    });

    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(
      store.db.prepare('SELECT revision FROM schedule_state WHERE id = 1').get().revision,
      0,
    );

    const preparedWrite = store.db.prepare(
      "INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('set-has-bypass', 'admin', NULL, 0, 'blocked', '2026-09-27T13:00:00.000Z')",
    );
    assert.throws(() => preparedWrite.run());
    assert.throws(
      () => store.db.exec(
        "INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES ('set-has-exec-bypass', 'admin', NULL, 0, 'blocked', '2026-09-27T13:00:00.000Z')",
      ),
    );
    assert.throws(
      () => store.db.exec('UPDATE schedule_state SET revision = revision + 1 WHERE id = 1'),
    );

    const after = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.equal(after, before);
    assert.equal(store.getSnapshot().revision, 0);
  } finally {
    Object.defineProperty(Set.prototype, 'has', {
      configurable: true,
      writable: true,
      value: originalHas,
    });
    if (store) store.close();
  }
});

test('database facade preserves native transaction state for outbox atomicity', () => {
  const store = new ScheduleStore({ filename: ':memory:' });
  try {
    const repository = createSqliteOutboxRepositoryV1({ db: store.db });
    const built = buildProductionRunCompletedNotificationV1({
      eventId: 'EVENT-FACADE-TX-0001',
      runId: 'RUN-FACADE-TX-0001',
      scheduleItemId: 'SCHEDULE-FACADE-TX-0001',
      resourceId: 'RESOURCE-A',
      scope: 'task',
      taskCount: 1,
      completedAt: '2026-09-27T13:00:00.000Z',
      netDurationMs: 60_000,
      runRevision: 2,
      createdAt: '2026-09-27T13:00:00.000Z',
    });
    assert.equal(built.ok, true, built.code);

    assert.equal(store.db.isTransaction, false);
    assert.deepEqual(repository.enqueue(built.intent), {
      ok: false,
      code: 'OUTBOX_TRANSACTION_REQUIRED',
    });

    store.db.exec('BEGIN IMMEDIATE');
    assert.equal(store.db.isTransaction, true);
    assert.deepEqual(repository.enqueue(built.intent), {
      ok: true,
      code: 'OUTBOX_ENQUEUED',
      outboxId: built.intent.outboxId,
      status: 'pending',
    });
    store.db.exec('COMMIT');
    assert.equal(store.db.isTransaction, false);

    assert.equal(
      store.db.prepare(
        'SELECT COUNT(*) AS count FROM notification_outbox WHERE outbox_id = ?',
      ).get(built.intent.outboxId).count,
      1,
    );

    store.db.exec('BEGIN IMMEDIATE');
    assert.equal(store.db.isTransaction, true);
    store.db.exec('ROLLBACK');
    assert.equal(store.db.isTransaction, false);
  } finally {
    store.close();
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
