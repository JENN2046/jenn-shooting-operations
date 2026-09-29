const MAX_IDENTIFIER_LENGTH = 160;
const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const RESPONSE_KEYS = new Set(['schemaVersion', 'deviceId']);

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every(key => expected.has(key));
}

function validIdentifier(value) {
  return typeof value === 'string'
    && [...value].length <= MAX_IDENTIFIER_LENGTH
    && IDENTIFIER.test(value);
}

export function validateKioskDeviceIdentityResponse(value) {
  return exactKeys(value, RESPONSE_KEYS)
    && value.schemaVersion === 1
    && validIdentifier(value.deviceId);
}

export function createKioskDeviceProvisioner({
  storage,
  fetchImpl,
  storageKey = 'jenn.kiosk.device-id.v2',
  identityUrl = '/api/v2/kiosk/identity',
} = {}) {
  if (!storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function') {
    throw new TypeError('Kiosk device identity storage is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Kiosk device identity fetch implementation is required');
  }
  if (typeof storageKey !== 'string' || storageKey.length === 0) {
    throw new TypeError('Kiosk device identity storage key is required');
  }
  if (typeof identityUrl !== 'string' || identityUrl.length === 0) {
    throw new TypeError('Kiosk device identity URL is required');
  }

  return Object.freeze({
    current() {
      const value = storage.getItem(storageKey);
      return validIdentifier(value) ? value : null;
    },
    async provision() {
      const existing = storage.getItem(storageKey);
      if (existing !== null && !validIdentifier(existing)) {
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }

      let response;
      try {
        response = await fetchImpl(identityUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
      } catch {
        return existing === null
          ? Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_UNAVAILABLE' })
          : Object.freeze({ ok: true, deviceId: existing, verified: false });
      }
      if (!response || response.status !== 200) {
        return existing === null
          ? Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_UNAVAILABLE' })
          : Object.freeze({ ok: true, deviceId: existing, verified: false });
      }

      let body;
      try {
        body = await response.json();
      } catch {
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }
      if (!validateKioskDeviceIdentityResponse(body)) {
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }

      if (existing !== null && existing !== body.deviceId) {
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_MISMATCH' });
      }
      if (existing === null) {
        storage.setItem(storageKey, body.deviceId);
      }

      return Object.freeze({ ok: true, deviceId: body.deviceId, verified: true });
    },
  });
}
