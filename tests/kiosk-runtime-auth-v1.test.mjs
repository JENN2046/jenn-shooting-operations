import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import test from 'node:test';

import { loadKioskRuntimeAuthV1 } from '../src/kiosk-runtime-auth-v1.mjs';
import { createKioskRuntimeOptionsFromEnv } from '../src/server.mjs';

const PASSWORD = 'kiosk-test-secret-0001';
const SALT = Buffer.from('0123456789abcdef', 'utf8');

function configFor(overrides = {}, password = PASSWORD) {
  const hash = scryptSync(password, SALT, 32);
  return {
    schemaVersion: 1,
    authMode: 'basic-v1',
    realm: 'Jenn Shooting Kiosk',
    username: 'kiosk-prod-01',
    deviceId: 'DEVICE-KIOSK-PROD-01',
    principal: {
      subjectId: 'DEVICE-KIOSK-PROD-01',
      role: 'operator',
      resourceIds: ['STUDIO-A'],
    },
    businessTimeZone: 'Asia/Shanghai',
    allowedBriefHosts: [],
    credential: {
      algorithm: 'scrypt-v1',
      saltBase64: SALT.toString('base64'),
      hashBase64: hash.toString('base64'),
    },
    ...overrides,
  };
}

function fixture(config = configFor(), mode = 0o600) {
  const root = mkdtempSync(join(tmpdir(), 'kiosk-auth-v1-'));
  const path = join(root, 'kiosk-auth.json');
  writeFileSync(path, JSON.stringify(config), { mode });
  chmodSync(path, mode);
  return {
    root,
    path,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function request(username = 'kiosk-prod-01', password = PASSWORD) {
  return {
    headers: {
      authorization: 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64'),
    },
  };
}

test('runtime auth maps one Basic credential to an exact operator/device/resource principal', async () => {
  const f = fixture();
  try {
    const runtime = loadKioskRuntimeAuthV1({ configPath: f.path });
    const principal = await runtime.authenticate(request());
    assert.ok(principal);
    assert.equal(principal.subjectId, 'DEVICE-KIOSK-PROD-01');
    assert.equal(principal.role, 'operator');
    assert.deepEqual(principal.resourceIds, ['STUDIO-A']);
    assert.equal(principal.capabilities.readSchedule, true);
    assert.equal(principal.capabilities.submitRunEvent, true);
    assert.equal(principal.capabilities.modifySchedule, false);
    assert.equal(principal.capabilities.correctRunEvent, false);
    assert.equal(runtime.businessTimeZone, 'Asia/Shanghai');
    assert.deepEqual(runtime.allowedBriefHosts, []);
    assert.equal(
      runtime.authenticationChallenge,
      'Basic realm="Jenn Shooting Kiosk", charset="UTF-8"',
    );
    assert.equal(runtime.authorizeDeviceId({
      principal,
      deviceId: 'DEVICE-KIOSK-PROD-01',
    }), true);
    assert.equal(runtime.authorizeDeviceId({
      principal,
      deviceId: 'DEVICE-FORGED',
    }), false);
  } finally {
    f.close();
  }
});

test('runtime auth rejects wrong credentials without exposing credential material', async () => {
  const f = fixture();
  try {
    const runtime = loadKioskRuntimeAuthV1({ configPath: f.path });
    assert.equal(await runtime.authenticate(request('kiosk-prod-01', 'wrong')), null);
    assert.equal(await runtime.authenticate(request('wrong-user', PASSWORD)), null);
    assert.equal(await runtime.authenticate(request('kiosk-prod-01', 'x'.repeat(257))), null);
    assert.equal(await runtime.authenticate({ headers: {} }), null);
    assert.equal(await runtime.authenticate({ headers: { authorization: 'Bearer x' } }), null);
    const serialized = JSON.stringify(runtime);
    assert.equal(serialized.includes(PASSWORD), false);
    assert.equal(serialized.includes(configFor().credential.hashBase64), false);
  } finally {
    f.close();
  }
});

test('runtime auth hashes passwords asynchronously and rejects attempts above the fixed concurrency bound', async () => {
  const f = fixture();
  try {
    const runtime = loadKioskRuntimeAuthV1({ configPath: f.path });
    const inFlight = Array.from(
      { length: 4 },
      () => runtime.authenticate(request('kiosk-prod-01', PASSWORD)),
    );
    const overflow = runtime.authenticate(request('kiosk-prod-01', PASSWORD));
    const winner = await Promise.race([
      overflow.then(
        value => ({ source: 'overflow-success', value }),
        error => ({ source: 'overflow-error', code: error?.code }),
      ),
      Promise.race(inFlight).then(value => ({ source: 'inflight', value })),
    ]);
    assert.deepEqual(winner, {
      source: 'overflow-error',
      code: 'KIOSK_AUTH_OVERLOADED',
    });
    const principals = await Promise.all(inFlight);
    assert.equal(principals.every(value => value?.subjectId === 'DEVICE-KIOSK-PROD-01'), true);
  } finally {
    f.close();
  }
});

test('runtime auth fails closed on unsafe paths, permissions, links, and invalid mappings', () => {
  assert.throws(
    () => loadKioskRuntimeAuthV1({ configPath: 'relative-kiosk-auth.json' }),
    /KIOSK_AUTH_CONFIG_PATH_NOT_ABSOLUTE/u,
  );
  assert.throws(
    () => createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE', KIOSK_AUTH_CONFIG_PATH: 'relative-kiosk-auth.json' }),
    /KIOSK_AUTH_CONFIG_PATH_NOT_ABSOLUTE/u,
  );

  for (const mode of [0o644, 0o700]) {
    const unsafe = fixture(configFor(), mode);
    try {
      assert.throws(
        () => loadKioskRuntimeAuthV1({ configPath: unsafe.path }),
        /KIOSK_AUTH_CONFIG_PERMISSIONS_UNSAFE/u,
      );
    } finally {
      unsafe.close();
    }
  }

  const fifoRoot = mkdtempSync(join(tmpdir(), 'kiosk-auth-fifo-'));
  try {
    const fifoPath = join(fifoRoot, 'kiosk-auth.fifo');
    const created = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    assert.throws(
      () => loadKioskRuntimeAuthV1({ configPath: fifoPath }),
      /KIOSK_AUTH_CONFIG_PERMISSIONS_UNSAFE/u,
    );
  } finally {
    rmSync(fifoRoot, { recursive: true, force: true });
  }

  const linked = fixture();
  try {
    const link = join(linked.root, 'kiosk-auth-link.json');
    symlinkSync(linked.path, link);
    assert.throws(
      () => loadKioskRuntimeAuthV1({ configPath: link }),
      /KIOSK_AUTH_CONFIG_PERMISSIONS_UNSAFE/u,
    );
  } finally {
    linked.close();
  }

  for (const mutate of [
    config => ({ ...config, deviceId: 'DEVICE-OTHER' }),
    config => ({ ...config, principal: { ...config.principal, role: 'scheduler' } }),
    config => ({ ...config, businessTimeZone: 'Not/A_Time_Zone' }),
    config => ({ ...config, extra: true }),
  ]) {
    const f = fixture(mutate(configFor()));
    try {
      assert.throws(
        () => loadKioskRuntimeAuthV1({ configPath: f.path }),
        /KIOSK_AUTH_CONFIG_INVALID/u,
      );
    } finally {
      f.close();
    }
  }
});

test('production entrypoint rejects Kiosk credential reuse across every existing role token', () => {
  const shared = 'shared-role-secret-0001';
  for (const key of ['VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN']) {
    const f = fixture(configFor({}, shared));
    try {
      assert.throws(
        () => createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE',
          KIOSK_AUTH_CONFIG_PATH: f.path,
          [key]: shared,
        }),
        /KIOSK_AUTH_CREDENTIAL_COLLISION/u,
        key,
      );
    } finally {
      f.close();
    }
  }
});

test('production entrypoint remains disabled by default and injects only explicit Kiosk auth config', async () => {
  assert.equal(createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE' }).kioskServiceBinding.mode, 'WO03_ISOLATED_ACCEPTANCE');

  const f = fixture();
  try {
    const options = createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE',
      KIOSK_AUTH_CONFIG_PATH: f.path,
    });
    const principal = await options.kioskAuthenticate(request());
    assert.equal(principal.role, 'operator');
    assert.deepEqual(principal.resourceIds, ['STUDIO-A']);
    assert.equal(
      options.kioskAuthenticationChallenge,
      'Basic realm="Jenn Shooting Kiosk", charset="UTF-8"',
    );
    assert.equal(options.kioskDeviceId, 'DEVICE-KIOSK-PROD-01');
    assert.equal(options.kioskBusinessTimeZone, 'Asia/Shanghai');
    assert.deepEqual(options.kioskAllowedBriefHosts, []);
    assert.equal(options.kioskAuthorizeDeviceId({
      principal,
      deviceId: 'DEVICE-KIOSK-PROD-01',
    }), true);
  } finally {
    f.close();
  }
});