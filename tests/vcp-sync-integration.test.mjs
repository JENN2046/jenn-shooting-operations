import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createOperationsServer } from '../src/server.mjs';

const EXPECTED_ADAPTER_OWNER = 'JENN2046/VCPToolBox-JENN-Extensions';
const EXPECTED_ADAPTER_SOURCE_PATH = 'ShootingOperationsPackages/VcpSyncAdapter/index.cjs';
const EXPECTED_ADAPTER_MANIFEST_SOURCE_PATH = 'ShootingOperationsPackages/VcpSyncAdapter/package-manifest.json';
const EXPECTED_ADAPTER_REVISION = 'e184e15b80b4480cc34bf7940266ca293a0973b1';
const EXPECTED_ADAPTER_SHA256 = 'e7d438e4833d0eed8d260f87479cb00d2adea86ae4f2c63461ad4fe80dd55b81';
const EXPECTED_ADAPTER_MANIFEST_SHA256 = 'f52d13cbd9b7c38422304916a88fbba16825e5f7ffbacc8644b624b3c6f72161';
const EXPECTED_PACKAGE_FILES = Object.freeze(['index.cjs', 'package-manifest.json']);

const require = createRequire(import.meta.url);
const configuredAdapterPath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_PATH || '';
const configuredManifestPath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_MANIFEST_PATH || '';
const syncAdapterPath = configuredAdapterPath ? resolve(configuredAdapterPath) : null;
const syncManifestPath = configuredManifestPath ? resolve(configuredManifestPath) : null;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verifyConfiguredAdapterIdentity() {
  if (!syncAdapterPath && !syncManifestPath) return false;
  if (!syncAdapterPath || !syncManifestPath
      || !existsSync(syncAdapterPath) || !existsSync(syncManifestPath)) {
    throw new Error('configured VCP Shooting Operations adapter package is incomplete');
  }

  const owner = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_OWNER || '';
  const sourcePath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_SOURCE_PATH || '';
  const manifestSourcePath = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_MANIFEST_SOURCE_PATH || '';
  const revision = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_REVISION || '';
  const declaredSha256 = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_SHA256 || '';
  const declaredManifestSha256 = process.env.VCP_SHOOTING_OPERATIONS_ADAPTER_MANIFEST_SHA256 || '';

  const realAdapterPath = realpathSync(syncAdapterPath);
  const realManifestPath = realpathSync(syncManifestPath);
  const packageDirectory = dirname(realAdapterPath);
  const actualFiles = readdirSync(packageDirectory).sort();
  const actualSha256 = sha256File(realAdapterPath);
  const actualManifestSha256 = sha256File(realManifestPath);

  if (dirname(realManifestPath) !== packageDirectory
      || !isSameStringArray(actualFiles, EXPECTED_PACKAGE_FILES)
      || owner !== EXPECTED_ADAPTER_OWNER
      || sourcePath !== EXPECTED_ADAPTER_SOURCE_PATH
      || manifestSourcePath !== EXPECTED_ADAPTER_MANIFEST_SOURCE_PATH
      || revision !== EXPECTED_ADAPTER_REVISION
      || declaredSha256 !== EXPECTED_ADAPTER_SHA256
      || declaredManifestSha256 !== EXPECTED_ADAPTER_MANIFEST_SHA256
      || actualSha256 !== EXPECTED_ADAPTER_SHA256
      || actualManifestSha256 !== EXPECTED_ADAPTER_MANIFEST_SHA256) {
    throw new Error('configured VCP Shooting Operations adapter package identity does not match the reviewed source');
  }

  const manifest = JSON.parse(readFileSync(realManifestPath, 'utf8'));
  if (manifest.packageId !== 'jenn.shooting-operations.vcp-sync-adapter'
      || manifest.runtimeEnabled !== false
      || manifest.activationState !== 'SOURCE_ONLY_RUNTIME_DISABLED'
      || manifest.productionActionRequired !== 'PROD-10-ENABLE-VCP-REMOTE-SYNC'
      || manifest.rollbackActionId !== 'ROLLBACK-09-DISABLE-VCP-CONFIG') {
    throw new Error('configured VCP Shooting Operations adapter manifest boundary does not match the reviewed package');
  }
  return true;
}

function isSameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
let requestTrace = [];

before(async () => {
  if (!syncAdapterAvailable) return;
  requestTrace = [];
  operations = createOperationsServer({
    databasePath: ':memory:',
    tokens: { scheduler: schedulerToken },
    clock: () => new Date('2026-09-22T09:00:00.000Z'),
  });
  operations.server.on('request', request => {
    const url = new URL(request.url, 'http://local.invalid');
    requestTrace.push(`${request.method} ${url.pathname}`);
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
    : 'identified VCPToolBox/JENN-Extensions Shooting Operations adapter package identity was not supplied',
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

  const independentlyObserved = operations.store.getSnapshot();
  assert.equal(independentlyObserved.revision, 1);
  assert.equal(independentlyObserved.tasks[0].id, 'TASK-INTEGRATION');
  assert.deepEqual(requestTrace, [
    'GET /api/v1/snapshot',
    'PUT /api/v1/snapshot',
    'GET /api/v1/snapshot',
  ]);
});
