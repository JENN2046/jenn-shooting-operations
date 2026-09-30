import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import test from 'node:test';

import {
  createKioskRuntimeOptionsFromEnv,
  createOperationsServer,
} from '../src/server.mjs';

const USERNAME = 'kiosk-prod-01';
const PASSWORD = 'kiosk-test-secret-0001';
const DEVICE_ID = 'DEVICE-KIOSK-PROD-01';
const RESOURCE_ID = 'STUDIO-A';
const SALT = Buffer.from('0123456789abcdef', 'utf8');

function authorization(password = PASSWORD) {
  return 'Basic ' + Buffer.from(USERNAME + ':' + password, 'utf8').toString('base64');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kiosk-runtime-auth-integration-'));
  const uploadRoot = join(root, 'uploads');
  mkdirSync(uploadRoot);
  const configPath = join(root, 'kiosk-auth.json');
  const hash = scryptSync(PASSWORD, SALT, 32);
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    authMode: 'basic-v1',
    realm: 'Jenn Shooting Kiosk',
    username: USERNAME,
    deviceId: DEVICE_ID,
    principal: {
      subjectId: DEVICE_ID,
      role: 'operator',
      resourceIds: [RESOURCE_ID],
    },
    businessTimeZone: 'Asia/Shanghai',
    allowedBriefHosts: [],
    credential: {
      algorithm: 'scrypt-v1',
      saltBase64: SALT.toString('base64'),
      hashBase64: hash.toString('base64'),
    },
  }), { mode: 0o600 });
  return {
    root,
    uploadRoot,
    configPath,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function withRuntime(action) {
  const f = fixture();
  const options = createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE',
    KIOSK_AUTH_CONFIG_PATH: f.configPath,
  });
  const runtime = createOperationsServer({
    databasePath: ':memory:',
    uploadRoot: f.uploadRoot,
    orphanCleanupMode: 'disabled',
    writeAdmissionMode: 'enabled',
    ...options,
  });
  runtime.store.db.prepare('INSERT INTO revision_counters ' +
    '(id, projection_revision, schedule_revision, updated_at) VALUES (1, 0, 0, ?)')
    .run('2026-09-29T02:00:00.000Z');
  runtime.server.listen(0, '127.0.0.1');
  await new Promise(resolve => runtime.server.once('listening', resolve));
  const address = runtime.server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    await action({ baseUrl });
  } finally {
    await new Promise(resolve => runtime.server.close(resolve));
    f.close();
  }
}

function eventBody(deviceId) {
  return {
    schemaVersion: 2,
    eventId: 'EVENT-KIOSK-AUTH-0001',
    runId: 'RUN-KIOSK-AUTH-0001',
    scheduleItemId: 'SCHEDULE-KIOSK-AUTH-0001',
    eventType: 'start',
    expectedRunRevision: 0,
    occurredAt: '2026-09-29T02:00:00.000Z',
    deviceId,
    localSequence: 0,
  };
}

test('production Kiosk auth env wiring reaches HTTP challenge, resource scope, and device binding', async () => {
  await withRuntime(async ({ baseUrl }) => {
    const pageUnauth = await fetch(baseUrl + '/kiosk', { redirect: 'manual' });
    assert.equal(pageUnauth.status, 401);
    assert.equal(
      pageUnauth.headers.get('www-authenticate'),
      'Basic realm="Jenn Shooting Kiosk", charset="UTF-8"',
    );

    const wrong = await fetch(baseUrl + '/api/v2/kiosk/current?resourceId=' + RESOURCE_ID, {
      headers: { Authorization: authorization('wrong-secret') },
    });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).code, 'UNAUTHENTICATED');

    const validRead = await fetch(baseUrl + '/api/v2/kiosk/current?resourceId=' + RESOURCE_ID, {
      headers: { Authorization: authorization() },
    });
    assert.equal(validRead.status, 200);
    const current = await validRead.json();
    assert.equal(current.resourceId, RESOURCE_ID);
    assert.equal(current.current, null);
    assert.equal(current.next, null);
    assert.equal(current.projectionRevision, 0);

    const wrongScope = await fetch(baseUrl + '/api/v2/kiosk/current?resourceId=STUDIO-B', {
      headers: { Authorization: authorization() },
    });
    assert.equal(wrongScope.status, 403);
    assert.equal((await wrongScope.json()).code, 'FORBIDDEN');

    const forgedDevice = await fetch(
      baseUrl + '/api/v2/schedule-items/SCHEDULE-KIOSK-AUTH-0001/events',
      {
        method: 'POST',
        headers: {
          Authorization: authorization(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody('DEVICE-FORGED')),
      },
    );
    assert.equal(forgedDevice.status, 403);
    assert.equal((await forgedDevice.json()).code, 'FORBIDDEN');

    const exactDevice = await fetch(
      baseUrl + '/api/v2/schedule-items/SCHEDULE-KIOSK-AUTH-0001/events',
      {
        method: 'POST',
        headers: {
          Authorization: authorization(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody(DEVICE_ID)),
      },
    );
    assert.equal(exactDevice.status, 404);
    assert.equal((await exactDevice.json()).code, 'SCHEDULE_ITEM_NOT_FOUND');
  });
});
