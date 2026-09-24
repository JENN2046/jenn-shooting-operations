import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { buildProductionRunCompletedCardV1 } from '../src/dingtalk-card-builders-v1.mjs';
import { createUnconfiguredDingTalkAdapterV1 } from '../src/dingtalk-port-v1.mjs';
import { createOperationsServer } from '../src/server.mjs';

const FIXED_NOW = '2026-09-24T08:00:00.000Z';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  server.close();
  await once(server, 'close');
}

async function verifyKioskBoundary(root) {
  const defaultRuntime = createOperationsServer({
    databasePath: join(root, 'kiosk-default.sqlite'),
    uploadRoot: join(root, 'uploads-default'),
    tokens: {},
    clock: () => new Date(FIXED_NOW),
    cleanupIntervalMs: 0,
  });
  const defaultBase = await listen(defaultRuntime.server);
  try {
    const staticResponse = await fetch(`${defaultBase}/kiosk`);
    assert.equal(staticResponse.status, 200);
    assert.match(staticResponse.headers.get('content-type') ?? '', /^text\/html/u);

    const blocked = await fetch(
      `${defaultBase}/api/v2/kiosk/current?resourceId=STUDIO-A`,
    );
    assert.equal(blocked.status, 401);
    assert.deepEqual(await blocked.json(), {
      schemaVersion: 2,
      ok: false,
      code: 'AUTH_NOT_CONFIGURED',
      replayed: false,
    });
  } finally {
    await close(defaultRuntime.server);
  }

  const principalResult = createTrustedPrincipal({
    subjectId: 'WO-06C-KIOSK-OPERATOR',
    role: 'operator',
    resourceIds: ['STUDIO-A'],
  });
  assert.equal(principalResult.ok, true);

  const configuredRuntime = createOperationsServer({
    databasePath: join(root, 'kiosk-configured.sqlite'),
    uploadRoot: join(root, 'uploads-configured'),
    tokens: {},
    clock: () => new Date(FIXED_NOW),
    cleanupIntervalMs: 0,
    kioskAuthenticate: () => principalResult.principal,
    kioskBusinessTimeZone: 'UTC',
  });
  const configuredBase = await listen(configuredRuntime.server);
  try {
    const current = await fetch(
      `${configuredBase}/api/v2/kiosk/current?resourceId=STUDIO-A`,
    );
    assert.equal(current.status, 200);
    const body = await current.json();
    assert.equal(body.schemaVersion, 2);
    assert.equal(body.resourceId, 'STUDIO-A');
    assert.equal(body.current, null);
    assert.equal(body.next, null);
    assert.equal(current.headers.get('etag'), '"projection-0"');
  } finally {
    await close(configuredRuntime.server);
  }

  return {
    localHttpBoundary: 'PASS',
    defaultAuth: 'AUTH_NOT_CONFIGURED',
    explicitTrustedPrincipal: 'PASS',
    realBrowserDevice: 'EXTERNAL_BLOCKED_DEVICE',
  };
}

async function verifyDingTalkBoundary() {
  const card = buildProductionRunCompletedCardV1({
    runId: 'RUN-WO06C-0001',
    scheduleItemId: 'SCHEDULE-WO06C-0001',
    resourceId: 'STUDIO-A',
    scope: 'task',
    taskCount: 1,
    completedAt: FIXED_NOW,
    netDurationMs: 3_300_000,
    runRevision: 4,
  }).card;
  const sendInput = {
    dedupeKey: 'dingtalk:card:intent:aggregate:wo06c:4',
    routeKey: 'shooting-operations',
    card,
  };

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network forbidden in WO-06C local readiness');
  };
  try {
    const adapter = createUnconfiguredDingTalkAdapterV1();
    assert.deepEqual(adapter.readiness(), {
      ok: false,
      code: 'DINGTALK_NOT_CONFIGURED',
    });
    assert.deepEqual(await adapter.sendCard(sendInput), {
      ok: false,
      code: 'DINGTALK_NOT_CONFIGURED',
    });
    assert.deepEqual(await adapter.updateCard({
      ...sendInput,
      providerRef: 'CARD-REF-WO06C-1',
    }), {
      ok: false,
      code: 'DINGTALK_NOT_CONFIGURED',
    });
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  return {
    localBoundary: 'PASS',
    readinessCode: 'DINGTALK_NOT_CONFIGURED',
    networkCalls: 0,
    providerIntegration: 'READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION',
    callbackRuntime: 'NOT_WIRED',
  };
}

function verifyVcpBoundary() {
  const adapterPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../runtime/VCPChat/modules/services/shootingPlannerSyncService.js',
  );
  const present = existsSync(adapterPath);
  return {
    externalAdapterPresent: present,
    compatibility: present
      ? 'EXTERNAL_ADAPTER_PRESENT_REQUIRES_COMPATIBILITY_RUN'
      : 'EXTERNAL_BLOCKED_RUNTIME',
  };
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'jso-wo06c-readiness-'));
  try {
    const kiosk = await verifyKioskBoundary(root);
    const dingtalk = await verifyDingTalkBoundary();
    const vcp = verifyVcpBoundary();

    process.stdout.write(JSON.stringify({
      status: 'WO_06C_LOCAL_EXTERNAL_BOUNDARY_PASS',
      vcp,
      kiosk,
      dingtalk,
      deploymentGate: 'BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE',
      overallExternalClosure: 'PENDING',
    }) + '\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
