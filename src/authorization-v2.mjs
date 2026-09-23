const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const MAX_IDENTIFIER_LENGTH = 160;

export const AUTHORIZATION_CAPABILITIES = Object.freeze([
  'readSchedule',
  'submitRequest',
  'submitRunEvent',
  'modifySchedule',
  'correctRunEvent',
  'administer',
]);

export const AUTHORIZATION_ROLES = Object.freeze([
  'viewer',
  'submitter',
  'operator',
  'scheduler',
  'administrator',
]);

const ROLE_CAPABILITY_NAMES = new Map([
  ['viewer', ['readSchedule']],
  ['submitter', ['readSchedule', 'submitRequest']],
  ['operator', ['readSchedule', 'submitRunEvent']],
  ['scheduler', [
    'readSchedule',
    'submitRequest',
    'submitRunEvent',
    'modifySchedule',
    'correctRunEvent',
  ]],
  ['administrator', [...AUTHORIZATION_CAPABILITIES]],
]);

const PRINCIPAL_INPUT_KEYS = new Set(['subjectId', 'role', 'resourceIds']);
const PRINCIPAL_KEYS = new Set([...PRINCIPAL_INPUT_KEYS, 'capabilities']);
const RESOURCE_SCOPED_CAPABILITIES = new Set([
  'readSchedule',
  'submitRunEvent',
  'modifySchedule',
  'correctRunEvent',
]);

function failure(code, details = {}) {
  return Object.freeze({ ok: false, code, ...details });
}

function validIdentifier(value) {
  return typeof value === 'string'
    && value.length <= MAX_IDENTIFIER_LENGTH
    && IDENTIFIER.test(value);
}

function exactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every(key => expected.has(key));
}

function capabilityRecord(role) {
  const names = ROLE_CAPABILITY_NAMES.get(role);
  if (!names) return null;
  const granted = new Set(names);
  return Object.freeze(Object.fromEntries(
    AUTHORIZATION_CAPABILITIES.map(capability => [capability, granted.has(capability)]),
  ));
}

function validateResourceIds(resourceIds) {
  if (!Array.isArray(resourceIds)) return failure('INVALID_RESOURCE_SCOPE');
  const seen = new Set();
  for (const resourceId of resourceIds) {
    if (!validIdentifier(resourceId) || seen.has(resourceId)) {
      return failure('INVALID_RESOURCE_SCOPE');
    }
    seen.add(resourceId);
  }
  return { ok: true, resourceIds: Object.freeze([...resourceIds]) };
}

function validateCapabilityRecord(capabilities, expected) {
  if (
    !capabilities
    || typeof capabilities !== 'object'
    || Array.isArray(capabilities)
    || !exactKeys(capabilities, new Set(AUTHORIZATION_CAPABILITIES))
  ) return false;
  return AUTHORIZATION_CAPABILITIES.every(capability => (
    typeof capabilities[capability] === 'boolean'
    && capabilities[capability] === expected[capability]
  ));
}

export function capabilitiesForRole(role) {
  return capabilityRecord(role);
}

export function createTrustedPrincipal(input) {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || !exactKeys(input, PRINCIPAL_INPUT_KEYS)
  ) return failure('INVALID_PRINCIPAL_INPUT');
  if (!validIdentifier(input.subjectId)) return failure('INVALID_SUBJECT_ID');
  const capabilities = capabilityRecord(input.role);
  if (!capabilities) return failure('UNKNOWN_ROLE');
  const resources = validateResourceIds(input.resourceIds);
  if (!resources.ok) return resources;
  const principal = Object.freeze({
    subjectId: input.subjectId,
    role: input.role,
    capabilities,
    resourceIds: resources.resourceIds,
  });
  return Object.freeze({ ok: true, principal });
}

export function validateTrustedPrincipal(principal) {
  if (
    !principal
    || typeof principal !== 'object'
    || Array.isArray(principal)
    || !exactKeys(principal, PRINCIPAL_KEYS)
  ) return failure('INVALID_TRUSTED_PRINCIPAL');
  if (!validIdentifier(principal.subjectId)) return failure('INVALID_TRUSTED_PRINCIPAL');
  const expectedCapabilities = capabilityRecord(principal.role);
  if (!expectedCapabilities) return failure('INVALID_TRUSTED_PRINCIPAL');
  if (!validateCapabilityRecord(principal.capabilities, expectedCapabilities)) {
    return failure('PRINCIPAL_CAPABILITY_MISMATCH');
  }
  const resources = validateResourceIds(principal.resourceIds);
  if (!resources.ok) return failure('INVALID_TRUSTED_PRINCIPAL');
  return Object.freeze({ ok: true });
}

export function authorizeCapability({ principal, capability, resourceId } = {}) {
  const validation = validateTrustedPrincipal(principal);
  if (!validation.ok) return Object.freeze({ allowed: false, code: validation.code });
  if (!AUTHORIZATION_CAPABILITIES.includes(capability)) {
    return Object.freeze({ allowed: false, code: 'UNKNOWN_CAPABILITY' });
  }
  if (!principal.capabilities[capability]) {
    return Object.freeze({ allowed: false, code: 'FORBIDDEN' });
  }
  if (resourceId === undefined && RESOURCE_SCOPED_CAPABILITIES.has(capability)) {
    return Object.freeze({ allowed: false, code: 'RESOURCE_ID_REQUIRED' });
  }
  if (resourceId !== undefined) {
    if (!validIdentifier(resourceId)) {
      return Object.freeze({ allowed: false, code: 'INVALID_RESOURCE_ID' });
    }
    if (!principal.resourceIds.includes(resourceId)) {
      return Object.freeze({ allowed: false, code: 'RESOURCE_FORBIDDEN' });
    }
  }
  return Object.freeze({ allowed: true });
}
