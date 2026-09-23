import { createHash } from 'node:crypto';

import { authorizeCapability, validateTrustedPrincipal } from './authorization-v2.mjs';
import {
  checkExpectedRunRevision,
  foldProductionRunEvent,
  requestEffectsForRunEvent,
  transitionRequest,
} from './domain-rules-v2.mjs';
import { evaluateKioskEventTime } from './event-time-policy-v2.mjs';
import { buildProductionRunCompletedNotificationV1 } from './production-run-completed-notification-v1.mjs';
import { buildFirstStartRunContextSnapshotV1 } from './run-context-capture-v1.mjs';
import {
  digestRunEventResponse,
  rebuildRunAtReceipt,
} from './run-event-use-case-v2.mjs';

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const EVENT_TYPES = new Set(['start', 'block', 'resume', 'complete']);
const BLOCKING_REASONS = new Set([
  'sampleWaiting', 'specConfirming', 'deviceIssue', 'talentWaiting', 'siteIssue', 'other',
]);
const REQUIRED_KEYS = new Set([
  'schemaVersion', 'eventId', 'runId', 'scheduleItemId', 'eventType',
  'expectedRunRevision', 'occurredAt', 'deviceId', 'localSequence',
]);
const OPTIONAL_KEYS = new Set(['reasonCode', 'note']);
const ACCEPTED_RECEIPT_KIND = 'production.run-event';
const REVIEW_RECEIPT_KIND = 'production.run-event-review';
const SQLITE_BUSY_CODES = new Set([5, 261, 517, 773]);

function result(code, details = {}) {
  return { schemaVersion: 2, ok: false, code, replayed: false, ...details };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).toSorted().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number.isFinite(Date.parse(value));
}

function validIdentifier(value) {
  return typeof value === 'string' && [...value].length <= 160 && IDENTIFIER.test(value);
}

function normalizeCommand(input, principal) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return result('INVALID_RUN_EVENT_COMMAND');
  }
  const keys = Object.keys(input);
  if (
    keys.some(key => !REQUIRED_KEYS.has(key) && !OPTIONAL_KEYS.has(key))
    || [...REQUIRED_KEYS].some(key => !Object.hasOwn(input, key))
  ) return result('INVALID_RUN_EVENT_COMMAND');
  if (input.schemaVersion !== 2) return result('INVALID_RUN_EVENT_COMMAND');
  if (typeof input.eventId !== 'string' || !EVENT_ID.test(input.eventId)) return result('INVALID_EVENT_ID');
  for (const field of ['runId', 'scheduleItemId', 'deviceId']) {
    if (!validIdentifier(input[field])) return result('INVALID_RUN_EVENT_COMMAND');
  }
  if (!EVENT_TYPES.has(input.eventType)) return result('INVALID_RUN_EVENT_COMMAND');
  if (!Number.isSafeInteger(input.expectedRunRevision) || input.expectedRunRevision < 0) {
    return result('INVALID_RUN_EVENT_COMMAND');
  }
  if (!Number.isSafeInteger(input.localSequence) || input.localSequence < 0) {
    return result('INVALID_RUN_EVENT_COMMAND');
  }
  if (!validTimestamp(input.occurredAt)) return result('INVALID_EVENT_TIME');
  const reasonCode = input.reasonCode ?? null;
  const note = input.note ?? null;
  if (note !== null && (typeof note !== 'string' || [...note].length > 2000)) {
    return result('INVALID_RUN_EVENT_COMMAND');
  }
  if (input.eventType === 'block') {
    if (!BLOCKING_REASONS.has(reasonCode)) return result('INVALID_BLOCKING_REASON');
    if (reasonCode === 'other' && (note === null || !/\S/u.test(note))) {
      return result('BLOCKING_REASON_NOTE_REQUIRED');
    }
  } else if (reasonCode !== null) {
    return result('INVALID_RUN_EVENT_COMMAND');
  }
  return {
    ok: true,
    command: {
      schemaVersion: 2,
      eventId: input.eventId,
      runId: input.runId,
      scheduleItemId: input.scheduleItemId,
      eventType: input.eventType,
      expectedRunRevision: input.expectedRunRevision,
      occurredAt: input.occurredAt,
      deviceId: input.deviceId,
      localSequence: input.localSequence,
      reasonCode,
      note,
      actorId: principal.subjectId,
      actorRole: principal.role,
    },
  };
}

export function digestKioskRunEventCommand(command) {
  const payload = {
    actorId: command.actorId,
    actorRole: command.actorRole,
    deviceId: command.deviceId,
    eventId: command.eventId,
    eventType: command.eventType,
    expectedRunRevision: command.expectedRunRevision,
    localSequence: command.localSequence,
    note: command.note,
    occurredAt: command.occurredAt,
    reasonCode: command.reasonCode,
    runId: command.runId,
    scheduleItemId: command.scheduleItemId,
    schemaVersion: command.schemaVersion,
  };
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

function parseReceipt(receipt, command, digest) {
  const { operation, event, review } = receipt ?? {};
  if (!operation && !event && !review) return null;
  if (operation && ![ACCEPTED_RECEIPT_KIND, REVIEW_RECEIPT_KIND].includes(operation.kind)) {
    return result('IDEMPOTENCY_KEY_REUSE');
  }
  if (!operation || Boolean(event) === Boolean(review)) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  if (operation.request_digest !== digest) return result('IDEMPOTENCY_KEY_REUSE');
  const fact = event ?? review;
  const expectedKind = event ? ACCEPTED_RECEIPT_KIND : REVIEW_RECEIPT_KIND;
  if (
    operation.kind !== expectedKind
    || operation.operation_id !== command.eventId
    || fact.event_id !== command.eventId
    || fact.command_digest !== digest
    || fact.run_id !== command.runId
    || fact.event_type !== command.eventType
    || fact.occurred_at !== command.occurredAt
    || fact.device_id !== command.deviceId
    || fact.actor_id !== command.actorId
    || fact.reason_code !== command.reasonCode
    || fact.note !== command.note
    || operation.created_at !== fact.received_at
  ) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  if (review && (
    review.schedule_item_id !== command.scheduleItemId
    || review.expected_run_revision !== command.expectedRunRevision
    || review.actor_role !== command.actorRole
    || review.response_json !== operation.response_json
  )) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  let response;
  try {
    response = JSON.parse(operation.response_json);
  } catch {
    return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  }
  const rebuiltRun = event ? rebuildRunAtReceipt(receipt.history, event) : null;
  if (
    digestRunEventResponse(response) !== fact.response_digest
    || response?.schemaVersion !== 2
    || response.eventId !== command.eventId
    || response.runId !== command.runId
    || response.replayed !== false
  ) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  if (event && (
    rebuiltRun === null
    || response.ok !== true
    || response.code !== 'RUN_EVENT_APPLIED'
    || response.previousState !== event.previous_state
    || response.resultingState !== event.resulting_state
    || response.resultingState !== rebuiltRun.status
    || response.runRevision !== event.resulting_run_revision
    || response.projectionRevision !== event.resulting_projection_revision
    || response.scheduleRevision !== event.resulting_schedule_revision
    || !Number.isSafeInteger(response.blockedDurationMs)
    || response.blockedDurationMs < 0
    || !Object.hasOwn(response, 'startedAt')
    || !Object.hasOwn(response, 'completedAt')
    || !Object.hasOwn(response, 'grossDurationMs')
    || !Object.hasOwn(response, 'netDurationMs')
    || !Object.hasOwn(response, 'metricsAlgorithmVersion')
    || response.startedAt !== rebuiltRun.started_at
    || response.completedAt !== rebuiltRun.completed_at
    || response.grossDurationMs !== rebuiltRun.gross_duration_ms
    || response.blockedDurationMs !== rebuiltRun.blocked_duration_ms
    || response.netDurationMs !== rebuiltRun.net_duration_ms
    || response.metricsAlgorithmVersion !== rebuiltRun.metrics_algorithm_version
  )) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  if (review && (
    response.ok !== false
    || response.code !== 'EVENT_TIME_REVIEW_REQUIRED'
    || response.scheduleItemId !== review.schedule_item_id
    || response.reviewStatus !== review.review_status
    || response.reviewReason !== review.review_reason
    || response.policyVersion !== review.time_policy_version
    || response.receivedAt !== review.received_at
  )) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
  return { ...response, replayed: true };
}

function scopeFor(scheduleItem, requestIds, requests) {
  if (requests.length !== requestIds.length) return null;
  if (scheduleItem.allocation_mode === 'single' && requestIds.length === 1) {
    return { scope: 'task', taskId: requestIds[0] };
  }
  if (scheduleItem.allocation_mode === 'grouped_unallocated' && requestIds.length >= 2) {
    return { scope: 'block', taskId: null };
  }
  return null;
}

function runMatchesScope(run, derivedScope, requestIds) {
  return run.scope === derivedScope.scope
    && run.task_id === derivedScope.taskId
    && (run.scope !== 'task' || requestIds[0] === run.task_id);
}

function revisionConflict(command, currentRunRevision) {
  return result('REVISION_CONFLICT', {
    eventId: command.eventId,
    runId: command.runId,
    scope: 'run',
    currentRevision: currentRunRevision,
  });
}

function virtualRun(command, scope) {
  return {
    id: command.runId,
    schedule_item_id: command.scheduleItemId,
    scope: scope.scope,
    task_id: scope.taskId,
    status: 'scheduled',
    run_revision: 0,
    started_at: null,
    completed_at: null,
    active_block_started_at: null,
    gross_duration_ms: null,
    blocked_duration_ms: 0,
    net_duration_ms: null,
    metrics_algorithm_version: null,
  };
}

function internalFailure(error) {
  if (
    error?.code === 'SQLITE_BUSY'
    || error?.code === 'SQLITE_BUSY_SNAPSHOT'
    || SQLITE_BUSY_CODES.has(error?.errcode)
  ) return result('STORE_BUSY');
  return result('INTERNAL_ERROR');
}

export function createApplyKioskRunEvent({ store, clock, eventTimePolicy = evaluateKioskEventTime } = {}) {
  if (!store || typeof store.withImmediateTransaction !== 'function') {
    throw new TypeError('store with withImmediateTransaction is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock is required');
  if (typeof eventTimePolicy !== 'function') throw new TypeError('eventTimePolicy is required');

  return function applyKioskRunEvent({ command: input, principal } = {}) {
    const principalValidation = validateTrustedPrincipal(principal);
    if (!principalValidation.ok) return result('UNAUTHENTICATED');
    if (!principal.capabilities.submitRunEvent) return result('FORBIDDEN');
    const normalized = normalizeCommand(input, principal);
    if (!normalized.ok) return normalized;
    const command = normalized.command;
    let receivedAt;
    try {
      receivedAt = clock()?.toISOString?.();
    } catch {
      return result('INTERNAL_ERROR');
    }
    if (!validTimestamp(receivedAt)) return result('INTERNAL_ERROR');
    const digest = digestKioskRunEventCommand(command);

    try {
      return store.withImmediateTransaction(transaction => {
        const receipt = transaction.getKioskReceipt(command.eventId);
        if (receipt.operation && ![ACCEPTED_RECEIPT_KIND, REVIEW_RECEIPT_KIND].includes(receipt.operation.kind)) {
          return result('IDEMPOTENCY_KEY_REUSE');
        }
        if (receipt.operation || receipt.event || receipt.review) {
          if (receipt.resourceId === null) return result('EVENT_RECEIPT_INTEGRITY_ERROR');
          const replayAuthorization = authorizeCapability({
            principal,
            capability: 'submitRunEvent',
            resourceId: receipt.resourceId,
          });
          if (!replayAuthorization.allowed) return result('FORBIDDEN');
        }
        const replay = parseReceipt(receipt, command, digest);
        if (replay) return replay;

        const context = transaction.getScheduleContext(command.scheduleItemId);
        if (!context.scheduleItem) return result('SCHEDULE_ITEM_NOT_FOUND');
        const authorization = authorizeCapability({
          principal,
          capability: 'submitRunEvent',
          resourceId: context.scheduleItem.resource_id,
        });
        if (!authorization.allowed) return result('FORBIDDEN');
        if (
          context.scheduleItem.schedule_status !== 'confirmed'
          || context.scheduleItem.resource_resolution_status !== 'resolved'
        ) return result('RUN_PREPARATION_REQUIRED');
        const derivedScope = scopeFor(context.scheduleItem, context.requestIds, context.requests);
        if (!derivedScope || !context.counters) return result('RUN_PREPARATION_REQUIRED');

        const activeRuns = context.runs.filter(run => ['scheduled', 'shooting', 'blocked'].includes(run.status));
        if (activeRuns.length > 1) return result('MULTIPLE_ACTIVE_RUNS');
        let run;
        let firstStart = false;
        let lastOccurredAt = null;
        if (activeRuns.length === 1) {
          run = activeRuns[0];
          if (run.id !== command.runId) return result('RUN_ID_MISMATCH');
          if (!runMatchesScope(run, derivedScope, context.requestIds)) return result('RUN_PREPARATION_REQUIRED');
          lastOccurredAt = transaction.getRunContext(run.id).lastOccurredAt;
        } else {
          if (context.runs.length !== 0 || command.eventType !== 'start') {
            return result('RUN_PREPARATION_REQUIRED');
          }
          if (transaction.findRunById(command.runId)) return result('RUN_ID_REUSE');
          firstStart = true;
          run = virtualRun(command, derivedScope);
        }

        const revision = checkExpectedRunRevision({
          expectedRunRevision: command.expectedRunRevision,
          currentRunRevision: run.run_revision,
        });
        if (!revision.ok) return revisionConflict(command, run.run_revision);

        const timeDecision = eventTimePolicy({ occurredAt: command.occurredAt, receivedAt });
        if (timeDecision?.code === 'EVENT_TIME_REVIEW_REQUIRED') {
          const response = {
            schemaVersion: 2,
            ok: false,
            code: 'EVENT_TIME_REVIEW_REQUIRED',
            replayed: false,
            eventId: command.eventId,
            runId: command.runId,
            scheduleItemId: command.scheduleItemId,
            reviewStatus: 'pending',
            reviewReason: timeDecision.reviewReason,
            policyVersion: timeDecision.policyVersion,
            receivedAt,
          };
          transaction.insertReview({
            command,
            digest,
            response,
            responseDigest: digestRunEventResponse(response),
            receivedAt,
            reviewDecision: timeDecision,
          });
          transaction.saveEventReceipt({
            eventId: command.eventId,
            kind: REVIEW_RECEIPT_KIND,
            digest,
            response,
            createdAt: receivedAt,
          });
          transaction.recordAudit({
            action: REVIEW_RECEIPT_KIND,
            role: principal.role,
            entityId: command.runId,
            revision: context.counters.projection_revision,
            result: 'pending',
            createdAt: receivedAt,
          });
          return response;
        }
        if (!timeDecision?.ok) return result(timeDecision?.code === 'INVALID_EVENT_TIME' ? 'INVALID_EVENT_TIME' : 'INTERNAL_ERROR');

        if (
          run.run_revision === Number.MAX_SAFE_INTEGER
          || context.counters.projection_revision === Number.MAX_SAFE_INTEGER
          || !Number.isSafeInteger(context.counters.projection_revision)
          || !Number.isSafeInteger(context.counters.schedule_revision)
        ) return result('INTERNAL_ERROR');
        const folded = foldProductionRunEvent({
          run,
          eventType: command.eventType,
          occurredAt: command.occurredAt,
          lastOccurredAt,
        });
        if (!folded.ok) {
          return result(['INVALID_RUN_TRANSITION', 'EVENT_TIME_OUT_OF_ORDER'].includes(folded.code)
            ? folded.code
            : 'INTERNAL_ERROR');
        }
        const requestEffects = requestEffectsForRunEvent({
          scope: run.scope,
          eventType: command.eventType,
          requestIds: context.requestIds,
        });
        for (const effect of requestEffects) {
          const request = context.requests.find(entry => entry.id === effect.requestId);
          const transition = transitionRequest({
            state: request?.request_lifecycle,
            commandType: effect.commandType,
          });
          if (!transition.ok) return result('INVALID_RUN_TRANSITION');
        }

        const nextRunRevision = run.run_revision + 1;
        const nextProjectionRevision = context.counters.projection_revision + 1;
        const response = {
          schemaVersion: 2,
          ok: true,
          code: 'RUN_EVENT_APPLIED',
          replayed: false,
          eventId: command.eventId,
          runId: command.runId,
          previousState: folded.previousState,
          resultingState: folded.resultingState,
          runRevision: nextRunRevision,
          projectionRevision: nextProjectionRevision,
          scheduleRevision: context.counters.schedule_revision,
          startedAt: folded.run.started_at,
          completedAt: folded.run.completed_at,
          grossDurationMs: folded.run.gross_duration_ms,
          blockedDurationMs: folded.run.blocked_duration_ms,
          netDurationMs: folded.run.net_duration_ms,
          metricsAlgorithmVersion: folded.run.metrics_algorithm_version,
        };

        if (firstStart) {
          transaction.insertProvisionedRun({
            runId: run.id,
            scheduleItemId: run.schedule_item_id,
            scope: run.scope,
            taskId: run.task_id,
            createdAt: receivedAt,
          });
          const captured = buildFirstStartRunContextSnapshotV1({
            runId: run.id,
            scope: run.scope,
            scheduleItem: context.scheduleItem,
            requests: context.requests,
            resource: context.resource,
            requestRequirements: context.requestRequirements,
            activeConfig: context.activeConfig,
            capturedAt: receivedAt,
          });
          if (!captured.ok) throw new Error(`RUN_CONTEXT_CAPTURE_FAILED:${captured.code}`);
          if (transaction.insertRunContextSnapshot(captured) !== 1) {
            throw new Error('RUN_CONTEXT_CAPTURE_WRITE_FAILED');
          }
        }
        if (transaction.updateRun({
          runId: run.id,
          expectedRunRevision: run.run_revision,
          nextRunRevision,
          receivedAt,
          run: folded.run,
        }) !== 1) throw new Error('RUN_CONCURRENT_UPDATE');
        for (const effect of requestEffects) {
          if (transaction.fulfillRequest(effect.requestId, receivedAt) !== 1) {
            throw new Error('REQUEST_CONCURRENT_UPDATE');
          }
        }
        transaction.insertEvent({
          command,
          digest,
          responseDigest: digestRunEventResponse(response),
          receivedAt,
          previousState: folded.previousState,
          resultingState: folded.resultingState,
          resultingRunRevision: nextRunRevision,
          resultingProjectionRevision: nextProjectionRevision,
          resultingScheduleRevision: context.counters.schedule_revision,
        });
        if (transaction.advanceProjectionRevision({
          currentProjectionRevision: context.counters.projection_revision,
          scheduleRevision: context.counters.schedule_revision,
          nextProjectionRevision,
          updatedAt: receivedAt,
        }) !== 1) throw new Error('REVISION_CONCURRENT_UPDATE');
        transaction.refreshSnapshotProjections({
          projectionRevision: nextProjectionRevision,
          scheduleRevision: context.counters.schedule_revision,
          updatedAt: receivedAt,
        });
        if (command.eventType === 'complete') {
          const notification = buildProductionRunCompletedNotificationV1({
            eventId: command.eventId,
            runId: run.id,
            scheduleItemId: context.scheduleItem.id,
            resourceId: context.scheduleItem.resource_id,
            scope: run.scope,
            taskCount: context.requestIds.length,
            completedAt: folded.run.completed_at,
            netDurationMs: folded.run.net_duration_ms,
            runRevision: nextRunRevision,
            createdAt: receivedAt,
          });
          if (!notification.ok) throw new Error(notification.code);
          const enqueued = transaction.enqueueNotification(notification.intent);
          if (!enqueued?.ok) throw new Error(enqueued?.code ?? 'OUTBOX_ENQUEUE_FAILED');
        }
        transaction.saveEventReceipt({
          eventId: command.eventId,
          kind: ACCEPTED_RECEIPT_KIND,
          digest,
          response,
          createdAt: receivedAt,
        });
        transaction.recordAudit({
          action: ACCEPTED_RECEIPT_KIND,
          role: principal.role,
          entityId: run.id,
          revision: nextProjectionRevision,
          result: 'success',
          createdAt: receivedAt,
        });
        return response;
      });
    } catch (error) {
      return internalFailure(error);
    }
  };
}
