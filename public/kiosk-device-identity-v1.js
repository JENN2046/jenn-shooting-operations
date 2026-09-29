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
  blockedKey = storageKey + '.blocked-v1',
  blockedGenerationKey = blockedKey + '.generation-v1',
} = {}) {
  if (!storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function') {
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
  if (typeof blockedKey !== 'string' || blockedKey.length === 0 || blockedKey === storageKey) {
    throw new TypeError('Kiosk device identity blocked key is required');
  }
  if (typeof blockedGenerationKey !== 'string'
      || blockedGenerationKey.length === 0
      || blockedGenerationKey === storageKey
      || blockedGenerationKey === blockedKey) {
    throw new TypeError('Kiosk device identity blocked generation key is required');
  }

  let blockedInMemory = false;
  const persistedBlock = () => storage.getItem(blockedKey);
  const persistedGeneration = () => storage.getItem(blockedGenerationKey);
  const isBlocked = () => blockedInMemory || persistedBlock() !== null;
  const block = () => {
    blockedInMemory = true;
    try {
      const parsed = Number.parseInt(persistedGeneration() ?? '0', 10);
      const generation = Number.isSafeInteger(parsed) && parsed >= 0
        ? (parsed === Number.MAX_SAFE_INTEGER ? 1 : parsed + 1)
        : 1;
      const value = String(generation);
      storage.setItem(blockedGenerationKey, value);
      storage.setItem(blockedKey, value);
    } catch {
      // The in-memory latch is authoritative for this page even if persistence fails.
    }
  };
  const unblock = () => {
    storage.removeItem(blockedKey);
    blockedInMemory = false;
  };

  return Object.freeze({
    current() {
      if (isBlocked()) return null;
      const value = storage.getItem(storageKey);
      return validIdentifier(value) ? value : null;
    },
    revoke() {
      block();
    },
    async provision() {
      const blockMarkerAtStart = persistedBlock();
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
        if (isBlocked()) {
          return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_BLOCKED' });
        }
        return existing === null
          ? Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_UNAVAILABLE' })
          : Object.freeze({ ok: true, deviceId: existing, verified: false });
      }

      if (!response || !Number.isInteger(response.status)) {
        block();
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }
      if (response.status !== 200) {
        if (response.status >= 500 && response.status <= 599 && !isBlocked()) {
          return existing === null
            ? Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_UNAVAILABLE' })
            : Object.freeze({ ok: true, deviceId: existing, verified: false });
        }
        block();
        return Object.freeze({
          ok: false,
          code: [401, 403].includes(response.status)
            ? 'DEVICE_IDENTITY_UNAUTHORIZED'
            : 'DEVICE_IDENTITY_REJECTED',
        });
      }

      let body;
      try {
        body = await response.json();
      } catch {
        block();
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }
      if (!validateKioskDeviceIdentityResponse(body)) {
        block();
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }

      if (existing !== null && existing !== body.deviceId) {
        block();
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_MISMATCH' });
      }
      if (existing === null) {
        storage.setItem(storageKey, body.deviceId);
      }
      const blockMarkerAtEnd = persistedBlock();
      if (blockMarkerAtEnd !== null && blockMarkerAtEnd !== blockMarkerAtStart) {
        blockedInMemory = true;
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_BLOCKED' });
      }
      unblock();

      return Object.freeze({ ok: true, deviceId: body.deviceId, verified: true });
    },
  });
}
