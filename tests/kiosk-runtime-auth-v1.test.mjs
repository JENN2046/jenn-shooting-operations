import assert from 'node:assert/strict';
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

function configFor(overrides = {}) {
  const hash = scryptSync(PASSWORD, SALT, 32);
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

test('runtime auth maps one Basic credential to an exact operator/device/resource principal', () => {
  const f = fixture();
  try {
    const runtime = loadKioskRuntimeAuthV1({ configPath: f.path });
    const principal = runtime.authenticate(request());
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

test('runtime auth rejects wrong credentials without exposing credential material', () => {
  const f = fixture();
  try {
    const runtime = loadKioskRuntimeAuthV1({ configPath: f.path });
    assert.equal(runtime.authenticate(request('kiosk-prod-01', 'wrong')), null);
    assert.equal(runtime.authenticate(request('wrong-user', PASSWORD)), null);
    assert.equal(runtime.authenticate(request('kiosk-prod-01', 'x'.repeat(257))), null);
    assert.equal(runtime.authenticate({ headers: {} }), null);
    assert.equal(runtime.authenticate({ headers: { authorization: 'Bearer x' } }), null);
    const serialized = JSON.stringify(runtime);
    assert.equal(serialized.includes(PASSWORD), false);
    assert.equal(serialized.includes(configFor().credential.hashBase64), false);
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
    () => createKioskRuntimeOptionsFromEnv({ KIOSK_AUTH_CONFIG_PATH: 'relative-kiosk-auth.json' }),
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

test('production entrypoint remains disabled by default and injects only explicit Kiosk auth config', () => {
  assert.deepEqual(createKioskRuntimeOptionsFromEnv({}), {});

  const f = fixture();
  try {
    const options = createKioskRuntimeOptionsFromEnv({
      KIOSK_AUTH_CONFIG_PATH: f.path,
    });
    const principal = options.kioskAuthenticate(request());
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