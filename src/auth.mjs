import { timingSafeEqual } from 'node:crypto';

const ROLE_LEVEL = new Map([
  ['viewer', 1],
  ['submitter', 2],
  ['scheduler', 3],
  ['administrator', 4],
]);

function sameToken(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthorizer(tokens = {}) {
  const configured = Object.entries(tokens).filter(([, value]) => typeof value === 'string' && value.length >= 16);

  return function authorize(request, minimumRole) {
    const header = request.headers.authorization || '';
    const actual = header.startsWith('Bearer ') ? header.slice(7) : '';
    let role = null;
    for (const [candidate, expected] of configured) {
      if (sameToken(actual, expected)) {
        role = candidate;
        break;
      }
    }
    const allowed = role !== null && ROLE_LEVEL.get(role) >= ROLE_LEVEL.get(minimumRole);
    return { allowed, role, configured: configured.length > 0 };
  };
}
