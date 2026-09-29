import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKioskDeviceProvisioner,
  validateKioskDeviceIdentityResponse,
} from '../public/kiosk-device-identity-v1.js';

function storage(initial = null, { failBlockedWrite = false } = {}) {
  const values = new Map();
  if (initial !== null) values.set('jenn.kiosk.device-id.v2', initial);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (failBlockedWrite && key === 'jenn.kiosk.device-id.v2.blocked-v1') {
        throw new Error('storage write denied');
      }
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
    snapshot() { return values.get('jenn.kiosk.device-id.v2') ?? null; },
    blocked() { return values.get('jenn.kiosk.device-id.v2.blocked-v1') === '1'; },
  };
}

function response(deviceId = 'DEVICE-KIOSK-PROD-01') {
  return {
    status: 200,
    async json() {
      return { schemaVersion: 1, deviceId };
    },
  };
}

test('device provisioning writes the server-bound device identity exactly once', async () => {
  const target = storage();
  const calls = [];
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async (...args) => {
      calls.push(args);
      return response();
    },
  });
  const result = await provisioner.provision();
  assert.deepEqual(result, {
    ok: true,
    deviceId: 'DEVICE-KIOSK-PROD-01',
    verified: true,
  });
  assert.equal(target.snapshot(), 'DEVICE-KIOSK-PROD-01');
  assert.equal(provisioner.current(), 'DEVICE-KIOSK-PROD-01');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/v2/kiosk/identity');
  assert.deepEqual(calls[0][1], {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
});

test('device provisioning fails closed on an existing mismatched browser identity', async () => {
  const target = storage('DEVICE-OTHER');
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response(),
  });
  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_MISMATCH',
  });
  assert.equal(target.snapshot(), 'DEVICE-OTHER');
});

test('identity mismatch stays latched across a following outage until a matching server identity returns', async () => {
  const target = storage('DEVICE-OTHER');
  let mode = 'mismatch';
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => {
      if (mode === 'offline') throw new Error('offline');
      return response(mode === 'match' ? 'DEVICE-OTHER' : 'DEVICE-KIOSK-PROD-01');
    },
  });

  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_MISMATCH',
  });
  assert.equal(target.blocked(), true);
  assert.equal(provisioner.current(), null);

  mode = 'offline';
  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_BLOCKED',
  });

  mode = 'match';
  assert.deepEqual(await provisioner.provision(), {
    ok: true,
    deviceId: 'DEVICE-OTHER',
    verified: true,
  });
  assert.equal(target.blocked(), false);
  assert.equal(provisioner.current(), 'DEVICE-OTHER');
});

test('authoritative mismatch remains fail-closed in memory when blocked-latch persistence fails', async () => {
  const target = storage('DEVICE-OTHER', { failBlockedWrite: true });
  let online = true;
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => {
      if (!online) throw new Error('offline');
      return response('DEVICE-KIOSK-PROD-01');
    },
  });

  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_MISMATCH',
  });
  assert.equal(provisioner.current(), null);

  online = false;
  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_BLOCKED',
  });
});

test('HTTP auth rejection latches identity while 5xx remains transient for a clean cached identity', async () => {
  const revoked = storage('DEVICE-KIOSK-PROD-01');
  let mode = 'unauthorized';
  const revokedProvisioner = createKioskDeviceProvisioner({
    storage: revoked,
    fetchImpl: async () => {
      if (mode === 'offline') throw new Error('offline');
      return { status: 401, async json() { return {}; } };
    },
  });
  assert.deepEqual(await revokedProvisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_UNAUTHORIZED',
  });
  assert.equal(revoked.blocked(), true);
  mode = 'offline';
  assert.deepEqual(await revokedProvisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_BLOCKED',
  });

  const transient = storage('DEVICE-KIOSK-PROD-01');
  const transientProvisioner = createKioskDeviceProvisioner({
    storage: transient,
    fetchImpl: async () => ({ status: 503, async json() { return {}; } }),
  });
  assert.deepEqual(await transientProvisioner.provision(), {
    ok: true,
    deviceId: 'DEVICE-KIOSK-PROD-01',
    verified: false,
  });
  assert.equal(transient.blocked(), false);
});

test('blocked marker from another provisioner revokes the shared cached identity immediately', async () => {
  const target = storage('DEVICE-KIOSK-PROD-01');
  const controllingTab = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response('DEVICE-KIOSK-PROD-01'),
  });
  const rejectingTab = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response('DEVICE-OTHER'),
  });

  assert.equal(controllingTab.current(), 'DEVICE-KIOSK-PROD-01');
  assert.deepEqual(await rejectingTab.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_MISMATCH',
  });
  assert.equal(controllingTab.current(), null);
});

test('previously provisioned identity can queue offline but remains unverified until server recovery', async () => {
  const target = storage('DEVICE-KIOSK-PROD-01');
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(await provisioner.provision(), {
    ok: true,
    deviceId: 'DEVICE-KIOSK-PROD-01',
    verified: false,
  });
  assert.equal(target.snapshot(), 'DEVICE-KIOSK-PROD-01');
});

test('first-use offline browser cannot invent an identity', async () => {
  const target = storage();
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_UNAVAILABLE',
  });
  assert.equal(target.snapshot(), null);
});

test('identity response parser rejects extra fields and invalid identifiers', () => {
  assert.equal(validateKioskDeviceIdentityResponse({
    schemaVersion: 1,
    deviceId: 'DEVICE-KIOSK-PROD-01',
  }), true);
  assert.equal(validateKioskDeviceIdentityResponse({
    schemaVersion: 1,
    deviceId: 'DEVICE-KIOSK-PROD-01',
    role: 'operator',
  }), false);
  assert.equal(validateKioskDeviceIdentityResponse({
    schemaVersion: 1,
    deviceId: ' bad ',
  }), false);
});