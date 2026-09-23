import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_ROLES,
  authorizeCapability,
  capabilitiesForRole,
  createTrustedPrincipal,
  validateTrustedPrincipal,
} from '../src/authorization-v2.mjs';

const EXPECTED_MATRIX = {
  viewer: ['readSchedule'],
  submitter: ['readSchedule', 'submitRequest'],
  operator: ['readSchedule', 'submitRunEvent'],
  scheduler: [
    'readSchedule',
    'submitRequest',
    'submitRunEvent',
    'modifySchedule',
    'correctRunEvent',
  ],
  administrator: [...AUTHORIZATION_CAPABILITIES],
};

function expectedRecord(granted) {
  return Object.fromEntries(AUTHORIZATION_CAPABILITIES.map(capability => [
    capability,
    granted.includes(capability),
  ]));
}

function principal(role = 'operator', overrides = {}) {
  const result = createTrustedPrincipal({
    subjectId: 'USER-OPERATOR-01',
    role,
    resourceIds: ['STUDIO-A'],
    ...overrides,
  });
  assert.equal(result.ok, true);
  return result.principal;
}

test('the five-role capability matrix is explicit and non-linear', () => {
  assert.deepEqual([...AUTHORIZATION_ROLES], Object.keys(EXPECTED_MATRIX));
  for (const [role, granted] of Object.entries(EXPECTED_MATRIX)) {
    assert.deepEqual({ ...capabilitiesForRole(role) }, expectedRecord(granted));
  }

  assert.equal(capabilitiesForRole('submitter').submitRequest, true);
  assert.equal(capabilitiesForRole('submitter').submitRunEvent, false);
  assert.equal(capabilitiesForRole('operator').submitRequest, false);
  assert.equal(capabilitiesForRole('operator').submitRunEvent, true);
  assert.equal(capabilitiesForRole('unknown'), null);
});

test('trusted principals derive immutable capabilities from role', () => {
  const result = createTrustedPrincipal({
    subjectId: 'USER-01',
    role: 'operator',
    resourceIds: ['STUDIO-A', 'STUDIO-B'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.principal, {
    subjectId: 'USER-01',
    role: 'operator',
    capabilities: expectedRecord(['readSchedule', 'submitRunEvent']),
    resourceIds: ['STUDIO-A', 'STUDIO-B'],
  });
  assert.equal(Object.isFrozen(result.principal), true);
  assert.equal(Object.isFrozen(result.principal.capabilities), true);
  assert.equal(Object.isFrozen(result.principal.resourceIds), true);
  assert.equal(validateTrustedPrincipal(result.principal).ok, true);
});

test('principal construction rejects client-declared capabilities and unknown fields', () => {
  const base = { subjectId: 'USER-01', role: 'operator', resourceIds: ['STUDIO-A'] };
  assert.equal(createTrustedPrincipal({
    ...base,
    capabilities: { administer: true },
  }).code, 'INVALID_PRINCIPAL_INPUT');
  assert.equal(createTrustedPrincipal({ ...base, actorId: 'SPOOFED' }).code, 'INVALID_PRINCIPAL_INPUT');
});

test('principal construction fails closed for invalid identity, role, and resource scope', () => {
  assert.equal(createTrustedPrincipal(null).code, 'INVALID_PRINCIPAL_INPUT');
  assert.equal(createTrustedPrincipal({ subjectId: '', role: 'operator', resourceIds: [] }).code, 'INVALID_SUBJECT_ID');
  assert.equal(createTrustedPrincipal({ subjectId: ' USER ', role: 'operator', resourceIds: [] }).code, 'INVALID_SUBJECT_ID');
  assert.equal(createTrustedPrincipal({ subjectId: 'USER', role: 'owner', resourceIds: [] }).code, 'UNKNOWN_ROLE');
  assert.equal(createTrustedPrincipal({ subjectId: 'USER', role: 'operator', resourceIds: 'STUDIO-A' }).code, 'INVALID_RESOURCE_SCOPE');
  assert.equal(createTrustedPrincipal({
    subjectId: 'USER', role: 'operator', resourceIds: ['STUDIO-A', 'STUDIO-A'],
  }).code, 'INVALID_RESOURCE_SCOPE');
  assert.equal(createTrustedPrincipal({
    subjectId: 'USER', role: 'operator', resourceIds: [' BAD '],
  }).code, 'INVALID_RESOURCE_SCOPE');
});

test('validation rejects capability escalation, downgrade, missing keys, and extra keys', () => {
  const valid = principal();
  for (const capabilities of [
    { ...valid.capabilities, administer: true },
    { ...valid.capabilities, submitRunEvent: false },
    Object.fromEntries(Object.entries(valid.capabilities).filter(([key]) => key !== 'readSchedule')),
    { ...valid.capabilities, deploy: true },
  ]) {
    assert.equal(validateTrustedPrincipal({ ...valid, capabilities }).code, 'PRINCIPAL_CAPABILITY_MISMATCH');
  }
  assert.equal(validateTrustedPrincipal({ ...valid, token: 'not-allowed' }).code, 'INVALID_TRUSTED_PRINCIPAL');
  assert.equal(validateTrustedPrincipal({ ...valid, role: 'owner' }).code, 'INVALID_TRUSTED_PRINCIPAL');
});

test('authorization checks capability membership rather than role rank', () => {
  const submitter = principal('submitter');
  const operator = principal('operator');
  assert.deepEqual(authorizeCapability({
    principal: submitter, capability: 'submitRequest', resourceId: 'STUDIO-A',
  }), { allowed: true });
  assert.deepEqual(authorizeCapability({
    principal: submitter, capability: 'submitRunEvent', resourceId: 'STUDIO-A',
  }), { allowed: false, code: 'FORBIDDEN' });
  assert.deepEqual(authorizeCapability({
    principal: operator, capability: 'submitRunEvent', resourceId: 'STUDIO-A',
  }), { allowed: true });
  assert.deepEqual(authorizeCapability({
    principal: operator, capability: 'submitRequest', resourceId: 'STUDIO-A',
  }), { allowed: false, code: 'FORBIDDEN' });
});

test('authorization enforces explicit resource scope and fails closed for invalid inputs', () => {
  const operator = principal();
  assert.deepEqual(authorizeCapability({
    principal: operator, capability: 'submitRunEvent',
  }), { allowed: false, code: 'RESOURCE_ID_REQUIRED' });
  assert.deepEqual(authorizeCapability({
    principal: operator, capability: 'submitRunEvent', resourceId: 'STUDIO-B',
  }), { allowed: false, code: 'RESOURCE_FORBIDDEN' });
  assert.deepEqual(authorizeCapability({
    principal: operator, capability: 'submitRunEvent', resourceId: ' BAD ',
  }), { allowed: false, code: 'INVALID_RESOURCE_ID' });
  assert.deepEqual(authorizeCapability({
    principal: operator, capability: 'launchProduction', resourceId: 'STUDIO-A',
  }), { allowed: false, code: 'UNKNOWN_CAPABILITY' });
  assert.deepEqual(authorizeCapability({
    principal: { ...operator, capabilities: { ...operator.capabilities, administer: true } },
    capability: 'administer',
  }), { allowed: false, code: 'PRINCIPAL_CAPABILITY_MISMATCH' });
  assert.deepEqual(authorizeCapability(), { allowed: false, code: 'INVALID_TRUSTED_PRINCIPAL' });
});
