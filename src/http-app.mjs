import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthorizer } from './auth.mjs';

const PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const STATIC = new Map([
  ['/', 'board.html'],
  ['/board', 'board.html'],
  ['/submit', 'submit.html'],
  ['/submit/print', 'submit-print.html'],
  ['/submit/video', 'submit-video.html'],
  ['/app.css', 'app.css'],
  ['/common.js', 'common.js'],
  ['/board.js', 'board.js'],
  ['/submit.js', 'submit.js'],
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

export function createHttpApp({ store, tokens = {} }) {
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
