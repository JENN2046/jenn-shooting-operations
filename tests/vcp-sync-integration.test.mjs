import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createOperationsServer } from '../src/server.mjs';

const EXPECTED_ADAPTER_OWNER = 'JENN2046/VCPToolBox-JENN-Extensions';
const EXPECTED_ADAPTER_SOURCE_PATH = 'ShootingOperationsPackages/VcpSyncAdapter/index.cjs';
const EXPECTED_ADAPTER_REVISION = '1d4ac43183296adccc570ac62598bc078d140317';
const EXPECTED_ADAPTER_SHA256 = 'cef5a9c7f2b0f41dd5a9bd9faa5cd490be005fb31f16c28ede221a05883ef2d3';

const require = createRequire(import.meta.url);
const configuredAdapterPath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_PATH || '';
const syncAdapterPath = configuredAdapterPath ? resolve(configuredAdapterPath) : null;

function verifyConfiguredAdapterIdentity() {
  if (!syncAdapterPath) return false;
  if (!existsSync(syncAdapterPath)) {
    throw new Error('configured VCP Shooting Operations adapter path does not exist');
  }
  const owner = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_OWNER || '';
  const sourcePath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_SOURCE_PATH || '';
  const revision = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_REVISION || '';
  const declaredSha256 = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_SHA256 || '';
  const actualSha256 = createHash('sha256').update(readFileSync(syncAdapterPath)).digest('hex');

  if (owner !== EXPECTED_ADAPTER_OWNER
      || sourcePath !== EXPECTED_ADAPTER_SOURCE_PATH
      || revision !== EXPECTED_ADAPTER_REVISION
      || declaredSha256 !== EXPECTED_ADAPTER_SHA256
      || actualSha256 !== EXPECTED_ADAPTER_SHA256) {
    throw new Error('configured VCP Shooting Operations adapter identity does not match the reviewed source');
  }
  return true;
}

const syncAdapterAvailable = verifyConfiguredAdapterIdentity();
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

test('identified VCPToolBox Jenn adapter completes pull, guarded push, and verification pull', {
  skip: syncAdapterAvailable
    ? false
    : 'identified VCPToolBox/JENN-Extensions Shooting Operations adapter identity was not supplied',
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
