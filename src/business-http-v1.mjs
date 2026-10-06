// Explicit business route adapter; caller authenticates and applies global write admission.
const POST = new Map([
  ['/api/v2/business/resources', ['manage', 'registerResource']],
  ['/api/v2/business/config/preview', ['previewConfig']],
  ['/api/v2/business/config/publish', ['manage', 'publishConfig']],
  ['/api/v2/business/config/activate', ['manage', 'activateConfig']],
  ['/api/v2/business/proposals', ['generateProposal']],
]);
export function businessRoute(method, pathname) {
  if (method === 'GET' && pathname === '/api/v2/business/state') return { method: 'readManagement' };
  if (method === 'POST' && POST.has(pathname)) { const [method,kind]=POST.get(pathname);return {method,kind}; }
  const read = method === 'GET' && /^\/api\/v2\/business\/(operations|proposals)\/([^/]+)$/u.exec(pathname);
  if (read) return {method:read[1]==='operations'?'readBusinessOperation':'readBusinessProposal',key:read[1]==='operations'?'operationId':'proposalId',encoded:read[2]};
  const edit = method === 'POST' && /^\/api\/v2\/business\/schedule-items\/([^/]+)\/reschedule$/u.exec(pathname);
  if (edit) return {method:'reschedule',key:'scheduleItemId',encoded:edit[1]};
  return null;
}
const RETRY_LATER = new Set(['WRITE_ADMISSION_DISABLED','SCHEDULING_QUIESCENCE_HELD','SCHEDULING_LEASE_EXPIRED','SERVICE_UNAVAILABLE']);
export function businessHttpStatus(result) {
  if (result?.ok === true) return 200;
  const c=result?.code;
  if (typeof c !== 'string' || !/^[A-Z0-9_]+$/u.test(c)) return 500;
  if (['FORBIDDEN','RESOURCE_FORBIDDEN','TRUSTED_ADMIN_REQUIRED','TRUSTED_SCHEDULER_REQUIRED'].includes(c)) return 403;
  if (c.endsWith('_NOT_FOUND')) return 404;
  if (RETRY_LATER.has(c)) return 503;
  if (/INVALID|UNSUPPORTED|REQUIRED|FORBIDDEN/u.test(c)) return 422;
  return 409;
}
export function safeBusinessException(error) {
  return RETRY_LATER.has(error?.code) ? {ok:false,code:error.code} : {ok:false,code:'INTERNAL_ERROR'};
}
