import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createOperationsServer } from '../src/server.mjs';

const require = createRequire(import.meta.url);
const configuredAdapterPath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_PATH || '';
const syncAdapterPath = configuredAdapterPath ? resolve(configuredAdapterPath) : null;

if (syncAdapterPath && !existsSync(syncAdapterPath)) {
  throw new Error('configured VCP Shooting Operations adapter path does not exist');
}

const syncAdapterAvailable = Boolean(syncAdapterPath);
const ShootingOperationsSyncAdapter = syncAdapterAvailable
  ? require(syncAdapterPath).ShootingOperationsSyncAdapter
  : null;

if (syncAdapterAvailable && typeof ShootingOperationsSyncAdapter !== 'function') {
  throw new TypeError('configured VCP Shooting Operations adapter does not expose ShootingOperationsSyncAdapter');
}

const schedulerToken = 'scheduler-token-integration-0001';
let operations;
let client;

before(async () => {
  if (!syncAdapterAvailable) return;
  operations = createOperationsServer({
    databasePath: ':memory:',
    tokens: { scheduler: schedulerToken },
    clock: () => new Date('2026-09-22T09:00:00.000Z'),
  });
  operations.server.listen(0, '127.0.0.1');
  await once(operations.server, 'listening');
  const address = operations.server.address();
  client = new ShootingOperationsSyncAdapter({
    baseUrl: `http://127.0.0.1:${address.port}`,
    schedulerCredential: schedulerToken,
  });
});

after(async () => {
  if (!operations) return;
  operations.server.close();
  await once(operations.server, 'close');
});

test('VCPToolBox Jenn adapter completes pull, guarded push, and verification pull', {
  skip: syncAdapterAvailable
    ? false
    : 'identified VCPToolBox/JENN-Extensions Shooting Operations adapter path was not supplied',
}, async () => {
  const initial = await client.pull();
  assert.equal(initial.revision, 0);

  const snapshot = {
    ...initial,
    products: [['SKU-INTEGRATION', '联调产品']],
    tasks: [{
      id: 'TASK-INTEGRATION',
      sku: 'SKU-INTEGRATION',
      name: '联调产品',
      client: '待确认',
      deliver: '主图模特',
      kind: '模特',
    }],
  };

  const result = await client.guardedPushAndVerify(snapshot, {
    expectedRevision: initial.revision,
    operationId: 'integration-push-0001',
  });

  assert.equal(result.write.revision, 1);
  assert.equal(result.verifiedSnapshot.revision, 1);
  assert.equal(result.verifiedSnapshot.tasks[0].id, 'TASK-INTEGRATION');
});
