import { buildProductionRunCompletedCardV1 } from './dingtalk-card-builders-v1.mjs';
import { buildNotificationIntentV1 } from './outbox-contract-v1.mjs';

export const PRODUCTION_RUN_COMPLETED_ROUTE_KEY_V1 = 'operations.default';

export function buildProductionRunCompletedNotificationV1({
  eventId,
  runId,
  scheduleItemId,
  resourceId,
  scope,
  taskCount,
  completedAt,
  netDurationMs,
  runRevision,
  createdAt,
  routeKey = PRODUCTION_RUN_COMPLETED_ROUTE_KEY_V1,
} = {}) {
  const card = buildProductionRunCompletedCardV1({
    runId,
    scheduleItemId,
    resourceId,
    scope,
    taskCount,
    completedAt,
    netDurationMs,
    runRevision,
  });
  if (!card.ok) return card;
  return buildNotificationIntentV1({
    outboxId: eventId,
    intentType: 'production-run.completed.v1',
    aggregateType: 'production_run',
    aggregateId: runId,
    routeKey,
    aggregateRevisionScope: 'run',
    aggregateRevision: runRevision,
    cardSchemaVersion: card.cardSchemaVersion,
    payload: card.card,
    createdAt,
  });
}
