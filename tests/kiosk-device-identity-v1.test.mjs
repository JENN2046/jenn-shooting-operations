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
      if (failBlockedWrite && key === 'jenn.kiosk.device-id.v2.blocked-v2') {
        throw new Error('storage write denied');
      }
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
    snapshot() { return values.get('jenn.kiosk.device-id.v2') ?? null; },
    blocked() {
      const blocked = values.get('jenn.kiosk.device-id.v2.blocked-v2') ?? null;
      const healed = values.get('jenn.kiosk.device-id.v2.blocked-v2.healed-v1') ?? null;
      return blocked !== null && blocked !== healed;
    },
    blockValue() { return values.get('jenn.kiosk.device-id.v2.blocked-v2') ?? null; },
    healedValue() { return values.get('jenn.kiosk.device-id.v2.blocked-v2.healed-v1') ?? null; },
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
  assert.equal(calls[0][1].method, 'GET');
  assert.deepEqual(calls[0][1].headers, { Accept: 'application/json' });
  assert.equal(Boolean(calls[0][1].signal), true);
});

test('stalled identity fetch is bounded and returns unavailable so recovery polling can continue', async () => {
  const target = storage();
  let timeoutCallback;
  let aborted = false;
  let cleared = false;
  const controller = {
    signal: Object.freeze({ type: 'test-signal' }),
    abort() { aborted = true; },
  };
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => new Promise(() => {}),
    requestTimeoutMs: 17,
    createAbortController: () => controller,
    setTimer(callback, delay) {
      assert.equal(delay, 17);
      timeoutCallback = callback;
      return 73;
    },
    clearTimer(handle) {
      assert.equal(handle, 73);
      cleared = true;
    },
  });

  const pending = provisioner.provision();
  await Promise.resolve();
  assert.equal(typeof timeoutCallback, 'function');
  timeoutCallback();

  assert.deepEqual(await pending, {
    ok: false,
    code: 'DEVICE_IDENTITY_UNAVAILABLE',
  });
  assert.equal(aborted, true);
  assert.equal(cleared, true);
  assert.equal(target.snapshot(), null);
});

test('identity deadline remains active through a stalled 200 response body', async () => {
  const target = storage();
  let timeoutCallback;
  let aborted = false;
  let cleared = false;
  const controller = {
    signal: Object.freeze({ type: 'body-test-signal' }),
    abort() { aborted = true; },
  };
  const provisioner = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => ({
      status: 200,
      async json() {
        return new Promise(() => {});
      },
    }),
    requestTimeoutMs: 19,
    createAbortController: () => controller,
    setTimer(callback, delay) {
      assert.equal(delay, 19);
      timeoutCallback = callback;
      return 79;
    },
    clearTimer(handle) {
      assert.equal(handle, 79);
      cleared = true;
    },
  });

  const pending = provisioner.provision();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof timeoutCallback, 'function');
  assert.equal(cleared, false);
  timeoutCallback();

  assert.deepEqual(await pending, {
    ok: false,
    code: 'DEVICE_IDENTITY_UNAVAILABLE',
  });
  assert.equal(aborted, true);
  assert.equal(cleared, true);
  assert.equal(target.snapshot(), null);
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
  assert.equal(target.healedValue(), target.blockValue());
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

test('delayed matching success cannot clear a newer block from another provisioner', async () => {
  const target = storage('DEVICE-KIOSK-PROD-01');
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  const delayed = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => firstResponse,
  });
  const rejecting = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response('DEVICE-OTHER'),
  });

  const pending = delayed.provision();
  assert.deepEqual(await rejecting.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_MISMATCH',
  });
  assert.equal(target.blocked(), true);

  releaseFirst(response('DEVICE-KIOSK-PROD-01'));
  assert.deepEqual(await pending, {
    ok: false,
    code: 'DEVICE_IDENTITY_BLOCKED',
  });
  assert.equal(target.blocked(), true);
  assert.equal(delayed.current(), null);

  assert.deepEqual(await delayed.provision(), {
    ok: true,
    deviceId: 'DEVICE-KIOSK-PROD-01',
    verified: true,
  });
  assert.equal(target.blocked(), false);
  assert.equal(target.healedValue(), target.blockValue());
});

test('unique revocation tokens prevent concurrent lost-update ABA', async () => {
  const target = storage('DEVICE-KIOSK-PROD-01');
  const mismatch = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response('DEVICE-OTHER'),
    createRevocationToken: () => 'REVOCATION-A',
  });
  assert.equal((await mismatch.provision()).ok, false);
  assert.equal(target.blockValue(), 'REVOCATION-A');

  let releaseDelayed;
  const delayedResponse = new Promise(resolve => { releaseDelayed = resolve; });
  const delayed = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => delayedResponse,
  });
  const pending = delayed.provision();

  const healer = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response('DEVICE-KIOSK-PROD-01'),
  });
  assert.deepEqual(await healer.provision(), {
    ok: true,
    deviceId: 'DEVICE-KIOSK-PROD-01',
    verified: true,
  });
  assert.equal(target.blocked(), false);
  assert.equal(target.healedValue(), 'REVOCATION-A');

  const newerMismatch = createKioskDeviceProvisioner({
    storage: target,
    fetchImpl: async () => response('DEVICE-OTHER'),
    createRevocationToken: () => 'REVOCATION-B',
  });
  assert.equal((await newerMismatch.provision()).ok, false);
  assert.equal(target.blockValue(), 'REVOCATION-B');

  releaseDelayed(response('DEVICE-KIOSK-PROD-01'));
  assert.deepEqual(await pending, {
    ok: false,
    code: 'DEVICE_IDENTITY_BLOCKED',
  });
  assert.equal(target.blockValue(), 'REVOCATION-B');
  assert.equal(target.healedValue(), 'REVOCATION-A');
});

test('matching success never heals through a newer revocation written during healing', async () => {
  const target = storage('DEVICE-KIOSK-PROD-01');
  let injected = false;
  const originalSet = target.setItem.bind(target);
  const racingStorage = {
    ...target,
    setItem(key, value) {
      if (!injected && key === 'jenn.kiosk.device-id.v2.blocked-v2.healed-v1') {
        injected = true;
        originalSet('jenn.kiosk.device-id.v2.blocked-v2', 'REVOCATION-B');
      }
      originalSet(key, value);
    },
  };
  originalSet('jenn.kiosk.device-id.v2.blocked-v2', 'REVOCATION-A');

  const provisioner = createKioskDeviceProvisioner({
    storage: racingStorage,
    fetchImpl: async () => response('DEVICE-KIOSK-PROD-01'),
  });
  assert.deepEqual(await provisioner.provision(), {
    ok: false,
    code: 'DEVICE_IDENTITY_BLOCKED',
  });
  assert.equal(target.blockValue(), 'REVOCATION-B');
  assert.equal(target.healedValue(), 'REVOCATION-A');
  assert.equal(target.blocked(), true);
  assert.equal(provisioner.current(), null);
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