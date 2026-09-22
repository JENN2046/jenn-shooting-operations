import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createOperationsServer } from '../src/server.mjs';

const require = createRequire(import.meta.url);
const { ShootingPlannerSyncService } = require('../../../runtime/VCPChat/modules/services/shootingPlannerSyncService.js');

const schedulerToken = 'scheduler-token-integration-0001';
let operations;
let client;

before(async () => {
  operations = createOperationsServer({
    databasePath: ':memory:',
    tokens: { scheduler: schedulerToken },
    clock: () => new Date('2026-09-22T09:00:00.000Z'),
  });
  operations.server.listen(0, '127.0.0.1');
  await once(operations.server, 'listening');
  const address = operations.server.address();
  client = new ShootingPlannerSyncService({
    baseUrl: `http://127.0.0.1:${address.port}`,
    schedulerToken,
  });
});

after(async () => {
  operations.server.close();
  await once(operations.server, 'close');
});

test('VCP sync client completes pull, guarded push, and verification pull', async () => {
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
  const pushed = await client.push(snapshot, {
    expectedRevision: initial.revision,
    operationId: 'integration-push-0001',
  });
  assert.equal(pushed.revision, 1);

  const verified = await client.pull();
  assert.equal(verified.revision, 1);
  assert.equal(verified.tasks[0].id, 'TASK-INTEGRATION');
});
