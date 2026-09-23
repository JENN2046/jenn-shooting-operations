import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthorizer } from './auth.mjs';
import { authorizeCapability, validateTrustedPrincipal } from './authorization-v2.mjs';
import { validateKioskRunEvent } from './kiosk-contract-validator-v2.mjs';
import { mapSchedulingDecisionHttpResult } from './scheduling-http-result-v2.mjs';
import {
  mapKioskCurrentHttpResult,
  mapKioskRunEventHttpResult,
} from './kiosk-http-result-v2.mjs';

const PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const STATIC = new Map([
  ['/', 'board.html'],
  ['/board', 'board.html'],
  ['/submit', 'submit.html'],
  ['/submit/print', 'submit-print.html'],
  ['/submit/video', 'submit-video.html'],
  ['/kiosk', 'kiosk.html'],
  ['/app.css', 'app.css'],
  ['/kiosk.css', 'kiosk.css'],
  ['/common.js', 'common.js'],
  ['/board.js', 'board.js'],
  ['/submit.js', 'submit.js'],
  ['/kiosk.js', 'kiosk.js'],
  ['/kiosk-control-lock.js', 'kiosk-control-lock.js'],
  ['/kiosk-offline-queue-v2.js', 'kiosk-offline-queue-v2.js'],
]);
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
}

function sendMapped(response, mapped, headers = {}) {
  if (mapped.body === null) {
    response.writeHead(mapped.status, { 'Cache-Control': 'no-store', ...headers });
    response.end();
    return;
  }
  const body = JSON.stringify(mapped.body);
  response.writeHead(mapped.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function kioskFailure(code) {
  return mapKioskRunEventHttpResult({ ok: false, code });
}

const KIOSK_CURRENT_FAILURE_CODES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_RESOURCE_ID: 'INVALID_REQUEST',
  RESOURCE_ID_REQUIRED: 'INVALID_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTH_NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
  INVALID_TRUSTED_PRINCIPAL: 'UNAUTHENTICATED',
  PRINCIPAL_CAPABILITY_MISMATCH: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RESOURCE_FORBIDDEN: 'FORBIDDEN',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  MULTIPLE_ACTIVE_RUNS: 'MULTIPLE_ACTIVE_RUNS',
  MULTIPLE_CURRENT_CANDIDATES: 'MULTIPLE_CURRENT_CANDIDATES',
  MULTIPLE_NEXT_CANDIDATES: 'MULTIPLE_NEXT_CANDIDATES',
  STORE_BUSY: 'STORE_BUSY',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

function mapKioskCurrentFailure(value) {
  const publicCode = value?.ok === false ? KIOSK_CURRENT_FAILURE_CODES[value.code] : undefined;
  return kioskFailure(publicCode ?? 'INTERNAL_ERROR');
}

function validIdentifier(value) {
  return typeof value === 'string'
    && [...value].length <= 160
    && /^\S(?:[\s\S]*\S)?$/u.test(value);
}

function readOnlyResourceId(url) {
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'resourceId' || !validIdentifier(entries[0][1])) {
    return null;
  }
  return entries[0][1];
}

async function authenticateKiosk(kiosk, request) {
  if (!kiosk || typeof kiosk.authenticate !== 'function') {
    return { ok: false, code: 'AUTH_NOT_CONFIGURED' };
  }
  let principal;
  try {
    principal = await kiosk.authenticate(request);
  } catch {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }
  return validateTrustedPrincipal(principal).ok
    ? { ok: true, principal }
    : { ok: false, code: 'UNAUTHENTICATED' };
}

async function authenticateScheduling(scheduling, request) {
  if (!scheduling || typeof scheduling.authenticate !== 'function') {
    return { ok: false, code: 'AUTH_NOT_CONFIGURED' };
  }
  let principal;
  try {
    principal = await scheduling.authenticate(request);
  } catch {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }
  if (!validateTrustedPrincipal(principal).ok) {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }
  if (!['scheduler', 'administrator'].includes(principal.role)) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  return { ok: true, principal };
}

function readProjectionCondition(request) {
  const candidate = request.headers['if-none-match'];
  if (candidate === undefined) return { ok: true, candidate: null };
  if (typeof candidate !== 'string') return { ok: false };
  const match = /^"projection-(0|[1-9]\d*)"$/u.exec(candidate);
  if (!match || BigInt(match[1]) > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false };
  return { ok: true, candidate };
}

function conditionalProjection(candidate, dto) {
  const etag = `"projection-${dto.projectionRevision}"`;
  return {
    ok: true,
    etag,
    mapped: mapKioskCurrentHttpResult(dto, { unchanged: candidate === etag }),
  };
}

async function readJson(request, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('invalid JSON');
    error.status = 400;
    throw error;
  }
}

async function readBuffer(request, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(response, file) {
  const path = join(PUBLIC_ROOT, file);
  const info = await stat(path);
  response.writeHead(200, {
    'Content-Type': TYPES.get(extname(path)) || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=300',
  });
  createReadStream(path).pipe(response);
}

function requireRole(authorize, request, response, role) {
  const auth = authorize(request, role);
  if (!auth.allowed) {
    sendJson(response, 401, {
      ok: false,
      code: auth.configured ? 'UNAUTHORIZED' : 'AUTH_NOT_CONFIGURED',
    });
    return null;
  }
  return auth;
}

export function createHttpApp({ store, tokens = {}, kiosk = null, scheduling = null }) {
  const authorize = createAuthorizer(tokens);

  return async function app(request, response) {
    securityHeaders(response);
    const url = new URL(request.url, 'http://local.invalid');
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(response, 200, { ok: true, service: 'jenn-shooting-operations' });
      }

      if (request.method === 'GET' && STATIC.has(url.pathname)) {
        return serveStatic(response, STATIC.get(url.pathname));
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/snapshot') {
        return sendJson(response, 200, { ok: true, snapshot: store.getSnapshot() });
      }

      if (request.method === 'GET' && (
        url.pathname === '/api/v2/kiosk/current'
        || url.pathname === '/api/v2/updates'
      )) {
        const resourceId = readOnlyResourceId(url);
        if (resourceId === null) return sendMapped(response, kioskFailure('INVALID_REQUEST'));
        const condition = readProjectionCondition(request);
        if (!condition.ok) return sendMapped(response, kioskFailure('INVALID_REQUEST'));
        const authenticated = await authenticateKiosk(kiosk, request);
        if (!authenticated.ok) return sendMapped(response, kioskFailure(authenticated.code));
        const authorization = authorizeCapability({
          principal: authenticated.principal,
          capability: 'readSchedule',
          resourceId,
        });
        if (!authorization.allowed) return sendMapped(response, kioskFailure('FORBIDDEN'));
        if (typeof kiosk.readCurrent !== 'function') {
          return sendMapped(response, kioskFailure('SERVICE_UNAVAILABLE'));
        }
        let result;
        try {
          result = await kiosk.readCurrent({ principal: authenticated.principal, resourceId });
        } catch {
          return sendMapped(response, kioskFailure('INTERNAL_ERROR'));
        }
        if (!result || result.ok !== true) {
          return sendMapped(response, mapKioskCurrentFailure(result));
        }
        const mapped = mapKioskCurrentHttpResult(result.dto);
        if (mapped.status !== 200) return sendMapped(response, mapped);
        const conditional = conditionalProjection(condition.candidate, mapped.body);
        return sendMapped(response, conditional.mapped, { ETag: conditional.etag });
      }

      const kioskEventRoute = request.method === 'POST'
        ? /^\/api\/v2\/schedule-items\/([^/]+)\/events$/u.exec(url.pathname)
        : null;
      if (kioskEventRoute) {
        if ([...url.searchParams].length !== 0) {
          return sendMapped(response, kioskFailure('INVALID_REQUEST'));
        }
        let scheduleItemId;
        try {
          scheduleItemId = decodeURIComponent(kioskEventRoute[1]);
        } catch {
          return sendMapped(response, kioskFailure('INVALID_REQUEST'));
        }
        if (!validIdentifier(scheduleItemId)) {
          return sendMapped(response, kioskFailure('INVALID_REQUEST'));
        }
        const authenticated = await authenticateKiosk(kiosk, request);
        if (!authenticated.ok) return sendMapped(response, kioskFailure(authenticated.code));
        if (!authenticated.principal.capabilities.submitRunEvent) {
          return sendMapped(response, kioskFailure('FORBIDDEN'));
        }
        let command;
        try {
          command = await readJson(request);
        } catch (error) {
          return sendMapped(response, kioskFailure(
            error?.message === 'invalid JSON' ? 'INVALID_JSON' : 'INVALID_REQUEST',
          ));
        }
        if (!validateKioskRunEvent(command).ok) {
          return sendMapped(response, kioskFailure('INVALID_RUN_EVENT_COMMAND'));
        }
        if (command.scheduleItemId !== scheduleItemId) {
          return sendMapped(response, kioskFailure('SCHEDULE_ITEM_ID_MISMATCH'));
        }
        if (typeof kiosk.applyRunEvent !== 'function') {
          return sendMapped(response, kioskFailure('SERVICE_UNAVAILABLE'));
        }
        let result;
        try {
          result = await kiosk.applyRunEvent({ command, principal: authenticated.principal });
        } catch {
          return sendMapped(response, kioskFailure('INTERNAL_ERROR'));
        }
        return sendMapped(response, mapKioskRunEventHttpResult(result));
      }

      const proposalDecisionRoute = request.method === 'POST'
        ? /^\/api\/v2\/proposals\/([^/]+)\/decisions$/u.exec(url.pathname)
        : null;
      if (proposalDecisionRoute) {
        if ([...url.searchParams].length !== 0) {
          return sendJson(response, 400, { ok: false, code: 'INVALID_REQUEST' });
        }
        let proposalId;
        try {
          proposalId = decodeURIComponent(proposalDecisionRoute[1]);
        } catch {
          return sendJson(response, 400, { ok: false, code: 'INVALID_REQUEST' });
        }
        if (!validIdentifier(proposalId)) {
          return sendJson(response, 400, { ok: false, code: 'INVALID_REQUEST' });
        }
        const authenticated = await authenticateScheduling(scheduling, request);
        if (!authenticated.ok) {
          const status = authenticated.code === 'FORBIDDEN' ? 403 : 401;
          return sendJson(response, status, { ok: false, code: authenticated.code });
        }
        let command;
        try {
          command = await readJson(request);
        } catch (error) {
          return sendJson(response, 400, {
            ok: false,
            code: error?.message === 'invalid JSON' ? 'INVALID_JSON' : 'INVALID_REQUEST',
          });
        }
        if (!command || typeof command !== 'object' || Array.isArray(command)) {
          return sendJson(response, 400, { ok: false, code: 'INVALID_REQUEST' });
        }
        if (command.proposalId !== proposalId) {
          return sendJson(response, 400, { ok: false, code: 'PROPOSAL_ID_MISMATCH' });
        }
        if (typeof scheduling?.acceptProposal !== 'function') {
          return sendJson(response, 503, { ok: false, code: 'SERVICE_UNAVAILABLE' });
        }
        let result;
        try {
          result = await scheduling.acceptProposal({
            command,
            principal: authenticated.principal,
          });
        } catch {
          return sendJson(response, 500, { ok: false, code: 'INTERNAL_ERROR' });
        }
        return sendMapped(response, mapSchedulingDecisionHttpResult(result));
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/requests') {
        const submission = await readJson(request);
        const result = store.submitRequest({ submission, role: 'public-submitter' });
        return sendJson(response, result.status, result);
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/uploads') {
        const operationId = url.searchParams.get('operationId') || '';
        const kind = url.searchParams.get('kind') || '';
        let originalName = String(request.headers['x-file-name'] || 'attachment');
        try { originalName = decodeURIComponent(originalName); } catch { originalName = 'attachment'; }
        const contentType = String(request.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const buffer = await readBuffer(request, 20 * 1024 * 1024);
        const result = store.saveUpload({ operationId, originalName, contentType, kind, buffer, role: 'public-submitter' });
        return sendJson(response, result.status, result);
      }

      if (request.method === 'PUT' && url.pathname === '/api/v1/snapshot') {
        const auth = requireRole(authorize, request, response, 'scheduler');
        if (!auth) return;
        const operationId = request.headers['idempotency-key'];
        const expectedRevision = Number(request.headers['if-match']);
        if (!operationId || !Number.isInteger(expectedRevision)) {
          return sendJson(response, 400, { ok: false, code: 'MISSING_CONCURRENCY_HEADERS' });
        }
        const snapshot = await readJson(request);
        const result = store.replaceSnapshot({ expectedRevision, snapshot, operationId, role: auth.role });
        return sendJson(response, result.status, result);
      }

      return sendJson(response, 404, { ok: false, code: 'NOT_FOUND' });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const code = status === 500 ? 'INTERNAL_ERROR' : error.message === 'invalid JSON' ? 'INVALID_JSON' : 'REQUEST_TOO_LARGE';
      return sendJson(response, status, { ok: false, code });
    }
  };
}
