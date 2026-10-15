import { createHash, timingSafeEqual } from 'node:crypto';
import { createTrustedPrincipal } from './authorization-v2.mjs';

const configBindings = new WeakMap();
const configDigest = value => createHash('sha256').update(value ?? '').digest('hex');
export function matchesBusinessRuntimeConfig(authenticate, env) {
  return env.JSO_BUSINESS_RUNTIME === 'enabled'
    && configBindings.get(authenticate) === configDigest(env.JSO_BUSINESS_IDENTITIES_JSON);
}

// Explicit server-side identities; never derive role/scope from browser input.
export function createBusinessRuntimeAuthV1({ identities }) {
  if (!Array.isArray(identities) || identities.length === 0) throw new TypeError('Business identities required');
  const seen = new Set();
  const entries = identities.map(({ token, subjectId, role, resourceIds }) => {
    const bytes = typeof token === 'string' ? Buffer.from(token) : null;
    const tokenKey = bytes?.toString('hex');
    if (!bytes || bytes.length < 32 || seen.has(tokenKey)
      || !['administrator','scheduler'].includes(role) || !resourceIds?.length) throw new TypeError('Invalid business identity');
    seen.add(tokenKey);
    const principal = createTrustedPrincipal({ subjectId, role, resourceIds });
    if (!principal.ok) throw new TypeError('Invalid business identity');
    return { bytes, principal: principal.principal };
  });
  return request => {
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const bytes = Buffer.from(header.slice(7));
    return entries.find(e => bytes.length === e.bytes.length && timingSafeEqual(bytes,e.bytes))?.principal ?? null;
  };
}

// Opt-in. No identity, scope, credential or normal-business authority is granted by default.
export function createBusinessRuntimeOptionsFromEnv(env) {
  if (env.JSO_BUSINESS_RUNTIME !== 'enabled') return {};
  let identities;
  try { identities = JSON.parse(env.JSO_BUSINESS_IDENTITIES_JSON); }
  catch { throw new TypeError('Explicit business identities required'); }
  const schedulingAuthenticate = createBusinessRuntimeAuthV1({ identities });
  configBindings.set(schedulingAuthenticate, configDigest(env.JSO_BUSINESS_IDENTITIES_JSON));
  return { schedulingAuthenticate };
}
