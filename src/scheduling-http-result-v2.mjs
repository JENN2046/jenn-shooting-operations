const STATUS_BY_CODE = Object.freeze({
  SCHEDULING_PROPOSAL_DECISION_COMMAND_INVALID: 422,
  PROPOSAL_ACCEPT_DECISION_TYPE_INVALID: 422,
  DECISION_ID_RESERVED: 422,
  IDEMPOTENCY_KEY_REUSE: 409,
  PROPOSAL_NOT_DRAFT: 409,
  SCHEDULING_CONFIG_NOT_ACTIVE: 409,
  SCHEDULING_INPUT_CHANGED_RETRY: 409,
  SCHEDULING_INPUT_INVALID: 409,
  SCHEDULING_CALENDAR_COMPILE_FAILED: 409,
  SCHEDULING_RESOURCE_NOT_REGISTERED: 409,
  SCHEDULING_PLANNING_RANGE_UNSUPPORTED: 409,
  SCHEDULING_REVISION_NOT_READY: 409,
  PROPOSAL_NOT_FOUND: 404,
  TRUSTED_SCHEDULER_REQUIRED: 403,
  SCHEDULING_INPUT_ASSEMBLY_FAILED: 503,
  PROPOSAL_ACCEPT_NOT_WIRED: 503,
});

function internalError() {
  return Object.freeze({
    status: 500,
    body: Object.freeze({ ok: false, code: 'INTERNAL_ERROR' }),
  });
}

export function mapSchedulingDecisionHttpResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return internalError();
  if (result.ok === true) {
    if (!result.receipt || typeof result.receipt !== 'object' || Array.isArray(result.receipt)) {
      return internalError();
    }
    return Object.freeze({
      status: 200,
      body: Object.freeze({
        ok: true,
        receipt: result.receipt,
        exactReplay: result.exactReplay === true,
      }),
    });
  }
  if (result.ok !== false || typeof result.code !== 'string') return internalError();
  const status = STATUS_BY_CODE[result.code];
  if (status === undefined) return internalError();
  return Object.freeze({
    status,
    body: Object.freeze({ ok: false, code: result.code }),
  });
}
