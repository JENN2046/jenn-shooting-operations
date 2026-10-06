import { createHash, timingSafeEqual } from 'node:crypto';
import { createTrustedPrincipal } from './authorization-v2.mjs';
import { canonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

export const JSO_AGENT_PATH = '/api/v2/agent/tools';
export const JSO_AGENT_COMMANDS = Object.freeze({
  read_state: 'readState', preview_calendar: 'previewCalendar',
  generate_proposal: 'generateProposal', adopt_proposal: 'adoptProposal',
  reschedule: 'reschedule', read_receipt: 'readReceipt',
});
const WRITES = new Set(['adopt_proposal', 'reschedule']);
const MAX_BYTES = 256 * 1024;
const RESERVED = new Set(['tool_name', 'archery', 'ink', 'river', 'vref', '__proto__',
  'prototype', 'constructor', 'authorization', 'token', 'principal', 'role', 'mode', 'grant']);
const forbiddenText = value => /TOOL_REQUEST|[「{](?:始|末)|ROLE_DIVIDE|file:\/\/|[\u0000-\u001f\u007f-\u009f\u2028\u2029]/i.test(value)
  || !value.isWellFormed();
const fail = code => ({ ok: false, code });
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

// JSON.parse alone silently takes the last duplicate key, which is unsafe for review digests.
function parseUniqueJson(text) {
  const value = JSON.parse(text);
  const stack = [];
  for (const token of text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []) {
    if (token === '{') stack.push({ object: true, key: true, keys: new Set() });
    else if (token === '[') stack.push({ object: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':') stack.at(-1).key = false;
    else if (token === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (token.startsWith('"') && stack.at(-1)?.object && stack.at(-1).key) {
      const name = JSON.parse(token);
      if (stack.at(-1).keys.has(name)) throw new TypeError('Duplicate JSON key');
      stack.at(-1).keys.add(name);
    }
  }
  return value;
}

function safeJson(value, depth = 0) {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return !forbiddenText(value);
  if (Array.isArray(value)) return value.length <= 2000 && value.every(x => safeJson(x, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, v]) => !RESERVED.has(key)
    && !forbiddenText(key) && safeJson(v, depth + 1));
}

/** Stable JSO agent API envelope. External adapters translate into this boundary. */
export function parseJsoAgentArguments(args) {
  if (!exact(args, ['command', 'payload_json']) || typeof args.command !== 'string' || !Object.hasOwn(JSO_AGENT_COMMANDS, args.command)
    || typeof args.payload_json !== 'string' || Buffer.byteLength(args.payload_json) > MAX_BYTES
    || forbiddenText(args.payload_json)) return fail('INVALID_AGENT_ARGUMENTS');
  try {
    const command = parseUniqueJson(args.payload_json);
    if (!command || Array.isArray(command) || typeof command !== 'object' || !safeJson(command)) {
      return fail('INVALID_AGENT_ARGUMENTS');
    }
    return { ok: true, action: args.command, command };
  } catch { return fail('INVALID_AGENT_ARGUMENTS'); }
}

export function parseJsoAgentEnvelope(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES + 4096) return fail('INVALID_AGENT_ARGUMENTS');
  try {
    const args = parseUniqueJson(text);
    return parseJsoAgentArguments(args).ok ? { ok: true, arguments: args } : fail('INVALID_AGENT_ARGUMENTS');
  } catch { return fail('INVALID_AGENT_ARGUMENTS'); }
}

export function agentCommandDigest(action, command) {
  return `sha256:${createHash('sha256').update(canonicalJsonSchedulingV1({
    domain: 'jso-agent-command-v1', action, command,
  })).digest('hex')}`;
}

function validGrant(g, subjectId) {
  return exact(g, ['approvalRef', 'subjectId', 'action', 'commandDigest', 'notBefore', 'expiresAt'])
    && typeof g.approvalRef === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(g.approvalRef)
    && g.subjectId === subjectId && WRITES.has(g.action)
    && /^sha256:[a-f0-9]{64}$/.test(g.commandDigest)
    && typeof g.notBefore === 'string' && typeof g.expiresAt === 'string'
    && /(?:Z|[+-]\d\d:\d\d)$/.test(g.notBefore) && /(?:Z|[+-]\d\d:\d\d)$/.test(g.expiresAt)
    && Number.isFinite(Date.parse(g.notBefore)) && Date.parse(g.expiresAt) > Date.parse(g.notBefore);
}

/** Trusted server construction only. Identity/grants are never read from model arguments.
 * Planner principals have the existing viewer capability, not a scheduler credential.
 * A service instance must own a single serialized SQLite connection.
 */
export function createJsoAgentApplication({ service, identities, clock = () => new Date() }) {
  if (!service || Object.values(JSO_AGENT_COMMANDS).some(k => typeof service[k] !== 'function')
    || !Array.isArray(identities) || identities.length === 0) throw new TypeError('Trusted agent service and identities required');
  const tokens = new Set();
  const entries = identities.map(identity => {
    const { token, subjectId, mode, resourceIds, grants = [] } = identity;
    if (typeof token !== 'string' || Buffer.byteLength(token) < 32 || tokens.has(token)
      || !['planner', 'executor'].includes(mode) || !resourceIds?.length
      || !Array.isArray(grants) || (mode === 'planner' && grants.length)
      || grants.some(g => !validGrant(g, subjectId))) throw new TypeError('Invalid agent identity');
    tokens.add(token);
    const trusted = createTrustedPrincipal({ subjectId, role: mode === 'planner' ? 'viewer' : 'scheduler', resourceIds });
    if (!trusted.ok) throw new TypeError('Invalid agent principal');
    return { bytes: Buffer.from(token), mode, principal: trusted.principal, grants: structuredClone(grants) };
  });
  const attempted = new Set();
  function authenticate(header) {
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4096) return null;
    const bytes = Buffer.from(header.slice(7));
    return entries.find(x => bytes.length === x.bytes.length && timingSafeEqual(bytes, x.bytes)) ?? null;
  }
  return Object.freeze({
    async call({ authorization, arguments: args }) {
      const identity = authenticate(authorization);
      if (!identity) return fail('UNAUTHENTICATED');
      const parsed = parseJsoAgentArguments(args);
      if (!parsed.ok) return parsed;
      const { action, command } = parsed;
      const write = WRITES.has(action);
      let grant = null;
      if (write) {
        if (identity.mode !== 'executor') return fail('AGENT_SUGGEST_ONLY');
        let digest;
        try { digest = agentCommandDigest(action, command); }
        catch { return fail('INVALID_AGENT_ARGUMENTS'); }
        const time = clock().getTime();
        if (!Number.isFinite(time)) return fail('APPROVAL_WINDOW_INVALID');
        grant = identity.grants.find(g => g.action === action && g.commandDigest === digest
          && time >= Date.parse(g.notBefore) && time < Date.parse(g.expiresAt));
        if (!grant) return fail('EXACT_APPROVAL_REQUIRED');
        const key = `${grant.approvalRef}:${grant.subjectId}:${digest}`;
        if (attempted.has(key)) return fail('RECONCILIATION_REQUIRED');
        // Consume before dispatch, including exceptions/unknown outcomes; never auto retry.
        attempted.add(key);
      }
      try {
        const executionGuard = () => {
          const time = clock().getTime();
          return !write || (Number.isFinite(time) && time >= Date.parse(grant.notBefore) && time < Date.parse(grant.expiresAt));
        };
        const result = await service[JSO_AGENT_COMMANDS[action]]({ command, principal: identity.principal, executionGuard });
        if (typeof result?.ok !== 'boolean') return fail(write ? 'RESULT_UNKNOWN' : 'SERVICE_RESULT_INVALID');
        return { ...result, agent: { action, mode: identity.mode,
          approvalRef: grant?.approvalRef ?? null, retry: 'NEVER_AUTOMATIC',
          ...(write ? { commandDigest: grant.commandDigest } : {}) } };
      } catch { return fail(write ? 'RESULT_UNKNOWN' : 'SERVICE_UNAVAILABLE'); }
    },
  });
}

/** Dedicated opt-in handler: do not mount the token on legacy scheduler/admin routes. */
export function createJsoAgentHttpHandler(application) {
  return async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST' || request.url !== JSO_AGENT_PATH) return send(404, fail('NOT_FOUND'));
    if ((request.headers['content-type'] ?? '').split(';')[0] !== 'application/json') return send(415, fail('JSON_REQUIRED'));
    let args;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_BYTES + 4096) return send(413, fail('REQUEST_TOO_LARGE'));
        chunks.push(Buffer.from(chunk));
      }
      args = parseUniqueJson(Buffer.concat(chunks).toString('utf8'));
    } catch { return send(400, fail('INVALID_AGENT_ARGUMENTS')); }
    let result;
    try { result = await application.call({ authorization: request.headers.authorization, arguments: args }); }
    catch { result = fail('RESULT_UNKNOWN'); }
    return send(result.code === 'UNAUTHENTICATED' ? 401 : 200, result);
  };
}

/** VCP-side fixed destination transport. No URL/token/approval override exists in tool arguments. */
