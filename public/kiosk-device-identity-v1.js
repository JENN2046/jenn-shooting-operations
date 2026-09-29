const MAX_IDENTIFIER_LENGTH = 160;
const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const RESPONSE_KEYS = new Set(['schemaVersion', 'deviceId']);
const DEFAULT_IDENTITY_REQUEST_TIMEOUT_MS = 5000;

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

function defaultRevocationToken() {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('DEVICE_IDENTITY_RANDOM_UNAVAILABLE');
  }
  return globalThis.crypto.randomUUID();
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
  blockedKey = storageKey + '.blocked-v2',
  healedKey = blockedKey + '.healed-v1',
  createRevocationToken = defaultRevocationToken,
  requestTimeoutMs = DEFAULT_IDENTITY_REQUEST_TIMEOUT_MS,
  createAbortController = () => new AbortController(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
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
  if (typeof healedKey !== 'string'
      || healedKey.length === 0
      || healedKey === storageKey
      || healedKey === blockedKey) {
    throw new TypeError('Kiosk device identity healed key is required');
  }
  if (typeof createRevocationToken !== 'function') {
    throw new TypeError('Kiosk revocation token factory is required');
  }

  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30000) {
    throw new TypeError('Kiosk identity request timeout must be an integer between 1 and 30000 ms');
  }
  if (typeof createAbortController !== 'function') {
    throw new TypeError('Kiosk identity abort-controller factory is required');
  }
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('Kiosk identity timer functions are required');
  }

  let blockedInMemory = false;
  const persistedBlock = () => storage.getItem(blockedKey);
  const persistedHealed = () => storage.getItem(healedKey);
  const isBlocked = () => {
    if (blockedInMemory) return true;
    const blocked = persistedBlock();
    return blocked !== null && blocked !== persistedHealed();
  };
  const block = () => {
    blockedInMemory = true;
    try {
      const token = createRevocationToken();
      if (!validIdentifier(token)) {
        throw new Error('DEVICE_IDENTITY_REVOCATION_TOKEN_INVALID');
      }
      storage.setItem(blockedKey, token);
    } catch {
      // The in-memory latch is authoritative for this page even if persistence fails.
    }
  };
  const healThrough = token => {
    try {
      if (persistedBlock() !== token) return false;
      if (token !== null) storage.setItem(healedKey, token);
      if (persistedBlock() !== token) return false;
      if (token !== null && persistedHealed() !== token) return false;
    } catch {
      return false;
    }
    blockedInMemory = false;
    return true;
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
      const blockTokenAtStart = persistedBlock();
      const existing = storage.getItem(storageKey);
      if (existing !== null && !validIdentifier(existing)) {
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_INVALID' });
      }

      let response;
      let timeoutHandle;
      let controller;
      try {
        controller = createAbortController();
        if (!controller
            || typeof controller.abort !== 'function'
            || !controller.signal) {
          throw new Error('DEVICE_IDENTITY_ABORT_CONTROLLER_INVALID');
        }
        const timeout = new Promise((_, reject) => {
          timeoutHandle = setTimer(() => {
            try {
              controller.abort();
            } catch {
              // The Promise.race timeout remains authoritative even if abort fails.
            }
            reject(new Error('DEVICE_IDENTITY_REQUEST_TIMEOUT'));
          }, requestTimeoutMs);
        });
        response = await Promise.race([
          fetchImpl(identityUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch {
        if (isBlocked()) {
          return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_BLOCKED' });
        }
        return existing === null
          ? Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_UNAVAILABLE' })
          : Object.freeze({ ok: true, deviceId: existing, verified: false });
      } finally {
        if (timeoutHandle !== undefined) clearTimer(timeoutHandle);
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
      const blockTokenAtEnd = persistedBlock();
      if (blockTokenAtEnd !== blockTokenAtStart
          || !healThrough(blockTokenAtStart)) {
        blockedInMemory = true;
        return Object.freeze({ ok: false, code: 'DEVICE_IDENTITY_BLOCKED' });
      }

      return Object.freeze({ ok: true, deviceId: body.deviceId, verified: true });
    },
  });
}
