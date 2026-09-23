import { createHash } from 'node:crypto';

import {
  checkExpectedRunRevision,
  foldProductionRunEvent,
  requestEffectsForRunEvent,
  transitionRequest,
} from './domain-rules-v2.mjs';

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const IDENTIFIER = /^\S(?:.*\S)?$/u;
const EVENT_TYPES = new Set(['start', 'block', 'resume', 'complete', 'cancel']);
const BLOCKING_REASONS = new Set([
  'sampleWaiting',
  'specConfirming',
  'deviceIssue',
  'talentWaiting',
  'siteIssue',
  'other',
]);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const RECEIPT_KIND = 'production.run-event';

function failure(code, details = {}) {
  return { ok: false, code, ...details };
}

function abort(code, details = {}, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  error.details = details;
  return error;
}

function normalizedText(value, { nullable = false, maxLength = 2000 } = {}) {
  if (value === undefined || value === null) return nullable ? null : undefined;
  if (typeof value !== 'string' || value.length > maxLength) return undefined;
  return value;
}

function normalizedTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).toSorted().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function normalizeCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return failure('INVALID_RUN_EVENT_COMMAND');
  if (typeof command.eventId !== 'string' || !EVENT_ID.test(command.eventId)) return failure('INVALID_EVENT_ID');
  for (const field of ['runId', 'scheduleItemId', 'deviceId', 'actorId']) {
    if (typeof command[field] !== 'string' || command[field].length > 160 || !IDENTIFIER.test(command[field])) {
      return failure('INVALID_RUN_EVENT_COMMAND', { field });
    }
  }
  if (!EVENT_TYPES.has(command.eventType)) return failure('INVALID_RUN_EVENT');
  if (!Number.isSafeInteger(command.expectedRunRevision) || command.expectedRunRevision < 0) {
    return failure('INVALID_REVISION', { scope: 'run' });
  }
  const occurredAt = normalizedTimestamp(command.occurredAt);
  if (occurredAt === null) return failure('INVALID_EVENT_TIME');
  const reasonCode = normalizedText(command.reasonCode, { nullable: true, maxLength: 120 });
  const note = normalizedText(command.note, { nullable: true });
  if ((command.reasonCode !== undefined && reasonCode === undefined) || (command.note !== undefined && note === undefined)) {
    return failure('INVALID_RUN_EVENT_COMMAND');
  }
  if (command.eventType === 'block') {
    if (!BLOCKING_REASONS.has(reasonCode)) return failure('INVALID_BLOCKING_REASON');
    if (reasonCode === 'other' && (note === null || note.trim() === '')) {
      return failure('BLOCKING_REASON_NOTE_REQUIRED');
    }
  } else if (reasonCode !== null) {
    return failure('BLOCKING_REASON_NOT_ALLOWED');
  }
  return {
    ok: true,
    command: {
      eventId: command.eventId,
      runId: command.runId,
      scheduleItemId: command.scheduleItemId,
      eventType: command.eventType,
      expectedRunRevision: command.expectedRunRevision,
      occurredAt,
      deviceId: command.deviceId,
      actorId: command.actorId,
      reasonCode,
      note,
    },
  };
}

export function digestRunEventCommand(command) {
  const payload = {
    actorId: command.actorId,
    deviceId: command.deviceId,
    eventType: command.eventType,
    expectedRunRevision: command.expectedRunRevision,
    note: command.note,
    occurredAt: command.occurredAt,
    reasonCode: command.reasonCode,
    runId: command.runId,
    scheduleItemId: command.scheduleItemId,
  };
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

export function digestRunEventResponse(response) {
  return `sha256:${createHash('sha256').update(canonicalJson(response)).digest('hex')}`;
}

export function rebuildRunAtReceipt(history, event) {
  if (!Array.isArray(history) || history.length !== event.resulting_run_revision) return null;
  let run = {
    status: 'scheduled',
    started_at: null,
    completed_at: null,
    active_block_started_at: null,
    gross_duration_ms: null,
    blocked_duration_ms: 0,
    net_duration_ms: null,
    metrics_algorithm_version: null,
  };
  let lastOccurredAt = null;
  for (let index = 0; index < history.length; index += 1) {
    const historicalEvent = history[index];
    if (
      historicalEvent.run_id !== event.run_id
      || historicalEvent.resulting_run_revision !== index + 1
      || historicalEvent.previous_state !== run.status
    ) return null;
    const folded = foldProductionRunEvent({
      run,
      eventType: historicalEvent.event_type,
      occurredAt: historicalEvent.occurred_at,
      lastOccurredAt,
    });
    if (!folded.ok || folded.resultingState !== historicalEvent.resulting_state) return null;
    run = { ...run, ...folded.run };
    lastOccurredAt = historicalEvent.occurred_at;
  }
  return run;
}

function parseReceipt(receipt, command, digest) {
  const operation = receipt?.operation ?? null;
  const event = receipt?.event ?? null;
  if (!operation && !event) return null;
  if (operation && operation.kind !== RECEIPT_KIND) return failure('IDEMPOTENCY_KEY_REUSE');
  if (!operation || !event) return failure('EVENT_RECEIPT_INTEGRITY_ERROR');
  if (operation.request_digest !== event.command_digest) return failure('EVENT_RECEIPT_INTEGRITY_ERROR');
  if (operation.request_digest !== digest) return failure('IDEMPOTENCY_KEY_REUSE');
  if (
    operation.operation_id !== command.eventId
    || event.event_id !== command.eventId
    || operation.operation_id !== event.event_id
    || operation.created_at !== event.received_at
    || event.run_id !== command.runId
    || event.event_type !== command.eventType
    || event.occurred_at !== command.occurredAt
    || event.device_id !== command.deviceId
    || event.actor_id !== command.actorId
    || event.reason_code !== command.reasonCode
    || event.note !== command.note
  ) return failure('EVENT_RECEIPT_INTEGRITY_ERROR');
  let response;
  try {
    response = JSON.parse(operation.response_json);
  } catch {
    return failure('EVENT_RECEIPT_INTEGRITY_ERROR');
  }
  const rebuiltRun = rebuildRunAtReceipt(receipt.history, event);
  const responseDigest = digestRunEventResponse(response);
  if (
    rebuiltRun === null
    || event.response_digest !== responseDigest
    || response?.ok !== true
    || response.code !== 'RUN_EVENT_APPLIED'
    || response.eventId !== command.eventId
    || response.runId !== event.run_id
    || response.runRevision !== event.resulting_run_revision
    || response.previousState !== event.previous_state
    || response.resultingState !== event.resulting_state
    || response.resultingState !== rebuiltRun.status
    || !Number.isSafeInteger(response.projectionRevision)
    || response.projectionRevision < 0
    || response.projectionRevision !== event.resulting_projection_revision
    || !Number.isSafeInteger(response.scheduleRevision)
    || response.scheduleRevision < 0
    || response.scheduleRevision !== event.resulting_schedule_revision
    || response.startedAt !== rebuiltRun.started_at
    || response.completedAt !== rebuiltRun.completed_at
    || response.grossDurationMs !== rebuiltRun.gross_duration_ms
    || response.blockedDurationMs !== rebuiltRun.blocked_duration_ms
    || response.netDurationMs !== rebuiltRun.net_duration_ms
    || response.metricsAlgorithmVersion !== rebuiltRun.metrics_algorithm_version
  ) return failure('EVENT_RECEIPT_INTEGRITY_ERROR');
  return { ...response, replayed: true };
}

function validateRunContext(context, command) {
  if (!context?.run) return failure('RUN_NOT_FOUND');
  const { run, scheduleItem, requestIds } = context;
  if (!scheduleItem || run.schedule_item_id !== command.scheduleItemId || scheduleItem.id !== command.scheduleItemId) {
    return failure('RUN_SCHEDULE_ITEM_MISMATCH');
  }
  if (scheduleItem.schedule_status !== 'confirmed' || scheduleItem.resource_resolution_status !== 'resolved') {
    return failure('RUN_SCHEDULE_ITEM_NOT_EXECUTABLE');
  }
  if (!Array.isArray(requestIds)) return failure('INVALID_RUN_SCOPE_BINDING');
  if (run.scope === 'task') {
    if (scheduleItem.allocation_mode !== 'single' || requestIds.length !== 1 || run.task_id !== requestIds[0]) {
      return failure('INVALID_RUN_SCOPE_BINDING');
    }
  } else if (run.scope === 'block') {
    if (scheduleItem.allocation_mode !== 'grouped_unallocated' || requestIds.length < 2 || run.task_id !== null) {
      return failure('INVALID_RUN_SCOPE_BINDING');
    }
  } else {
    return failure('INVALID_RUN_SCOPE');
  }
  return { ok: true };
}

export function createApplyRunEvent({ store, clock, eventTimePolicy } = {}) {
  if (!store || typeof store.withImmediateTransaction !== 'function') {
    throw new TypeError('store with withImmediateTransaction is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock is required');
  if (typeof eventTimePolicy !== 'function') throw new TypeError('eventTimePolicy is required');

  return function applyRunEvent(input) {
    const normalized = normalizeCommand(input);
    if (!normalized.ok) return normalized;
    const command = normalized.command;
    let receivedAt;
    try {
      receivedAt = normalizedTimestamp(clock()?.toISOString?.());
    } catch {
      return failure('INVALID_SERVER_TIME');
    }
    if (receivedAt === null) return failure('INVALID_SERVER_TIME');
    const digest = digestRunEventCommand(command);

    try {
      return store.withImmediateTransaction(transaction => {
        const replay = parseReceipt(transaction.getEventReceipt(command.eventId), command, digest);
        if (replay) return replay;

        const timeDecision = eventTimePolicy({
          occurredAt: command.occurredAt,
          receivedAt,
          command: { ...command },
        });
        if (!timeDecision || timeDecision.ok !== true) {
          return failure(timeDecision?.code ?? 'EVENT_TIME_REVIEW_REQUIRED');
        }

        const context = transaction.getRunContext(command.runId);
        const contextValidation = validateRunContext(context, command);
        if (!contextValidation.ok) return contextValidation;
        const { run, requestIds, counters } = context;
        if (!counters) return failure('REVISION_COUNTERS_MISSING');

        const revisionCheck = checkExpectedRunRevision({
          expectedRunRevision: command.expectedRunRevision,
          currentRunRevision: run.run_revision,
        });
        if (!revisionCheck.ok) return revisionCheck;
        if (
          run.run_revision === Number.MAX_SAFE_INTEGER
          || !Number.isSafeInteger(counters.projection_revision)
          || counters.projection_revision < 0
          || counters.projection_revision === Number.MAX_SAFE_INTEGER
          || !Number.isSafeInteger(counters.schedule_revision)
          || counters.schedule_revision < 0
        ) return failure('REVISION_OVERFLOW');

        const folded = foldProductionRunEvent({
          run,
          eventType: command.eventType,
          occurredAt: command.occurredAt,
          lastOccurredAt: context.lastOccurredAt,
        });
        if (!folded.ok) return folded;

        const requestEffects = requestEffectsForRunEvent({
          scope: run.scope,
          eventType: command.eventType,
          requestIds,
        });
        for (const effect of requestEffects) {
          const request = context.requests.find(entry => entry.id === effect.requestId);
          const transition = transitionRequest({ state: request?.request_lifecycle, commandType: effect.commandType });
          if (!transition.ok) return transition;
        }

        const nextRunRevision = run.run_revision + 1;
        const nextProjectionRevision = counters.projection_revision + 1;
        const response = {
          ok: true,
          code: 'RUN_EVENT_APPLIED',
          eventId: command.eventId,
          runId: run.id,
          previousState: folded.previousState,
          resultingState: folded.resultingState,
          runRevision: nextRunRevision,
          projectionRevision: nextProjectionRevision,
          scheduleRevision: counters.schedule_revision,
          startedAt: folded.run.started_at,
          completedAt: folded.run.completed_at,
          grossDurationMs: folded.run.gross_duration_ms,
          blockedDurationMs: folded.run.blocked_duration_ms,
          netDurationMs: folded.run.net_duration_ms,
          metricsAlgorithmVersion: folded.run.metrics_algorithm_version,
        };
        if (transaction.updateRun({
          runId: run.id,
          expectedRunRevision: run.run_revision,
          nextRunRevision,
          receivedAt,
          run: folded.run,
        }) !== 1) throw abort('RUN_CONCURRENT_UPDATE');

        for (const effect of requestEffects) {
          if (transaction.fulfillRequest(effect.requestId, receivedAt) !== 1) {
            throw abort('REQUEST_CONCURRENT_UPDATE', { requestId: effect.requestId });
          }
        }

        transaction.insertEvent({
          command,
          digest,
          receivedAt,
          previousState: folded.previousState,
          resultingState: folded.resultingState,
          resultingRunRevision: nextRunRevision,
          resultingProjectionRevision: nextProjectionRevision,
          resultingScheduleRevision: counters.schedule_revision,
          responseDigest: digestRunEventResponse(response),
        });
        if (transaction.advanceProjectionRevision({
          currentProjectionRevision: counters.projection_revision,
          scheduleRevision: counters.schedule_revision,
          nextProjectionRevision,
          updatedAt: receivedAt,
        }) !== 1) throw abort('REVISION_CONCURRENT_UPDATE');

        transaction.refreshSnapshotProjections({
          projectionRevision: nextProjectionRevision,
          scheduleRevision: counters.schedule_revision,
          updatedAt: receivedAt,
        });

        transaction.saveEventReceipt({
          eventId: command.eventId,
          kind: RECEIPT_KIND,
          digest,
          response,
          createdAt: receivedAt,
        });
        transaction.recordAudit({
          action: 'production.run-event',
          role: 'system',
          entityId: run.id,
          revision: nextProjectionRevision,
          result: 'success',
          createdAt: receivedAt,
        });
        return response;
      });
    } catch (error) {
      return failure(error?.code ?? 'RUN_EVENT_WRITE_FAILED', error?.details);
    }
  };
}
