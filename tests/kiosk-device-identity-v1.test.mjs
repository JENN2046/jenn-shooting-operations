import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKioskDeviceProvisioner,
  validateKioskDeviceIdentityResponse,
} from '../public/kiosk-device-identity-v1.js';

function storage(initial = null) {
  const values = new Map();
  if (initial !== null) values.set('jenn.kiosk.device-id.v2', initial);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    snapshot() { return values.get('jenn.kiosk.device-id.v2') ?? null; },
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