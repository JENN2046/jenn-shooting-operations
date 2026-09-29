import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { createTrustedPrincipal, validateTrustedPrincipal } from './authorization-v2.mjs';

const MAX_IDENTIFIER_LENGTH = 160;
const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const USERNAME = /^[A-Za-z0-9._-]{1,80}$/u;
const REALM = /^[A-Za-z0-9 ._:-]{1,80}$/u;
const CONFIG_KEYS = new Set([
  'schemaVersion', 'authMode', 'realm', 'username', 'deviceId',
  'principal', 'businessTimeZone', 'allowedBriefHosts', 'credential',
]);
const PRINCIPAL_KEYS = new Set(['subjectId', 'role', 'resourceIds']);
const CREDENTIAL_KEYS = new Set(['algorithm', 'saltBase64', 'hashBase64']);
const MAX_CONCURRENT_AUTHENTICATION_ATTEMPTS = 4;

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
function decodeBase64(value, expectedBytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error('KIOSK_AUTH_CONFIG_INVALID');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedBytes || decoded.toString('base64') !== value) {
    throw new Error('KIOSK_AUTH_CONFIG_INVALID');
  }
  return decoded;
}

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validateAllowedBriefHosts(value) {
  if (!Array.isArray(value)) throw new Error('KIOSK_AUTH_CONFIG_INVALID');
  const seen = new Set();
  for (const host of value) {
    if (typeof host !== 'string' || host.length === 0 || host.length > 253
      || host !== host.toLowerCase()
      || !/^[a-z0-9.-]+$/u.test(host)
      || seen.has(host)) {
      throw new Error('KIOSK_AUTH_CONFIG_INVALID');
    }
    seen.add(host);
  }
  return Object.freeze([...value]);
}
function validateConfig(raw) {
  if (!exactKeys(raw, CONFIG_KEYS)
    || raw.schemaVersion !== 1
    || raw.authMode !== 'basic-v1'
    || !REALM.test(raw.realm)
    || !USERNAME.test(raw.username)
    || !validIdentifier(raw.deviceId)
    || !validTimeZone(raw.businessTimeZone)
    || !exactKeys(raw.principal, PRINCIPAL_KEYS)
    || raw.principal.role !== 'operator'
    || raw.principal.subjectId !== raw.deviceId
    || !Array.isArray(raw.principal.resourceIds)
    || raw.principal.resourceIds.length === 0
    || raw.principal.resourceIds.some(id => !validIdentifier(id))
    || new Set(raw.principal.resourceIds).size !== raw.principal.resourceIds.length
    || !exactKeys(raw.credential, CREDENTIAL_KEYS)
    || raw.credential.algorithm !== 'scrypt-v1') {
    throw new Error('KIOSK_AUTH_CONFIG_INVALID');
  }

  const principalResult = createTrustedPrincipal(raw.principal);
  if (!principalResult.ok || !validateTrustedPrincipal(principalResult.principal).ok) {
    throw new Error('KIOSK_AUTH_CONFIG_INVALID');
  }

  return Object.freeze({
    realm: raw.realm,
    username: raw.username,
    deviceId: raw.deviceId,
    principal: principalResult.principal,
    businessTimeZone: raw.businessTimeZone,
    allowedBriefHosts: validateAllowedBriefHosts(raw.allowedBriefHosts),
    salt: decodeBase64(raw.credential.saltBase64, 16),
    hash: decodeBase64(raw.credential.hashBase64, 32),
  });
}
function parseBasicAuthorization(value) {
  if (typeof value !== 'string') return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match) return null;
  let decoded;
  try {
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64') !== match[1]) return null;
    decoded = bytes.toString('utf8');
  } catch {
    return null;
  }
  const index = decoded.indexOf(':');
  if (index <= 0) return null;
  return {
    username: decoded.slice(0, index),
    password: decoded.slice(index + 1),
  };
}

function validPasswordCandidate(password) {
  return typeof password === 'string' && password.length > 0 && password.length <= 256;
}

function credentialMatchesSync(config, password) {
  if (!validPasswordCandidate(password)) return false;
  let candidate;
  try {
    candidate = scryptSync(password, config.salt, config.hash.length);
  } catch {
    return false;
  }
  return candidate.length === config.hash.length && timingSafeEqual(candidate, config.hash);
}

function credentialMatchesAsync(config, password) {
  if (!validPasswordCandidate(password)) return Promise.resolve(false);
  return new Promise(resolve => {
    scrypt(password, config.salt, config.hash.length, (error, candidate) => {
      if (error || !Buffer.isBuffer(candidate) || candidate.length !== config.hash.length) {
        resolve(false);
        return;
      }
      resolve(timingSafeEqual(candidate, config.hash));
    });
  });
}

export function loadKioskRuntimeAuthV1({
  configPath,
  forbiddenCredentialValues = [],
} = {}) {
  if (typeof configPath !== 'string' || configPath.length === 0) {
    throw new TypeError('Kiosk auth config path is required');
  }
  if (!isAbsolute(configPath)) {
    throw new Error('KIOSK_AUTH_CONFIG_PATH_NOT_ABSOLUTE');
  }
  if (!Array.isArray(forbiddenCredentialValues)
      || forbiddenCredentialValues.some(value => typeof value !== 'string')) {
    throw new TypeError('Kiosk forbidden credential values must be strings');
  }
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    throw new Error('KIOSK_AUTH_CONFIG_SAFE_OPEN_UNAVAILABLE');
  }

  let descriptor;
  try {
    descriptor = openSync(
      configPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new Error('KIOSK_AUTH_CONFIG_PERMISSIONS_UNSAFE');
  }

  let body;
  try {
    const info = fstatSync(descriptor);
    const wrongOwner = typeof process.getuid === 'function' && info.uid !== process.getuid();
    if (!info.isFile() || wrongOwner || (info.mode & 0o177) !== 0) {
      throw new Error('KIOSK_AUTH_CONFIG_PERMISSIONS_UNSAFE');
    }
    body = readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('KIOSK_AUTH_CONFIG_INVALID');
  }
  const config = validateConfig(parsed);
  if (forbiddenCredentialValues.some(value => credentialMatchesSync(config, value))) {
    throw new Error('KIOSK_AUTH_CREDENTIAL_COLLISION');
  }
  const challenge = `Basic realm="${config.realm}", charset="UTF-8"`;

  let activeAuthenticationAttempts = 0;

  return Object.freeze({
    authenticationChallenge: challenge,
    businessTimeZone: config.businessTimeZone,
    allowedBriefHosts: config.allowedBriefHosts,
    deviceId: config.deviceId,
    principal: config.principal,
    async authenticate(request) {
      const supplied = parseBasicAuthorization(request?.headers?.authorization);
      if (!supplied
          || supplied.username !== config.username
          || !validPasswordCandidate(supplied.password)) {
        return null;
      }
      if (activeAuthenticationAttempts >= MAX_CONCURRENT_AUTHENTICATION_ATTEMPTS) {
        const error = new Error('Kiosk authentication capacity exhausted');
        error.code = 'KIOSK_AUTH_OVERLOADED';
        throw error;
      }

      activeAuthenticationAttempts += 1;
      try {
        return await credentialMatchesAsync(config, supplied.password)
          ? config.principal
          : null;
      } finally {
        activeAuthenticationAttempts -= 1;
      }
    },
    authorizeDeviceId({ principal, deviceId } = {}) {
      return validateTrustedPrincipal(principal).ok
        && principal === config.principal
        && deviceId === config.deviceId;
    },
  });
}
