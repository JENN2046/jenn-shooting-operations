import { timingSafeEqual } from 'node:crypto';
import { createTrustedPrincipal } from './authorization-v2.mjs';

// Explicit server-side identities; never derive role/scope from browser input.
export function createBusinessRuntimeAuthV1({ identities }) {
  if (!Array.isArray(identities) || identities.length === 0) throw new TypeError('Business identities required');
  const seen = new Set();
  const entries = identities.map(({ token, subjectId, role, resourceIds }) => {
    if (typeof token !== 'string' || Buffer.byteLength(token) < 32 || seen.has(token)
      || !['administrator','scheduler'].includes(role) || !resourceIds?.length) throw new TypeError('Invalid business identity');
    seen.add(token);
    const principal = createTrustedPrincipal({ subjectId, role, resourceIds });
    if (!principal.ok) throw new TypeError('Invalid business identity');
    return { bytes: Buffer.from(token), principal: principal.principal };
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
  return { schedulingAuthenticate: createBusinessRuntimeAuthV1({ identities }) };
}
