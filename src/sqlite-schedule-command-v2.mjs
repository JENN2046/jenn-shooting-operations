import { buildScheduleConfirmedCardV1 } from './dingtalk-card-builders-v1.mjs';
import { buildNotificationIntentV1 } from './outbox-contract-v1.mjs';
import { createSqliteOutboxRepositoryV1 } from './sqlite-outbox-repository-v1.mjs';
import { deriveAcceptedScheduleItemIdV1 } from './scheduling-proposal-contract-v1.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
export const SCHEDULE_CONFIRMED_ROUTE_KEY_V1 = 'operations.default';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

/** Canonical V2 schedule mutation kernel. The caller owns one BEGIN IMMEDIATE transaction. */
export function applyCanonicalScheduleAcceptanceInTransactionV2({ db, proposal, selectedItems,
  decisionId, currentScheduleRevision, currentProjectionRevision, at, refreshProjections,
  routeKey = SCHEDULE_CONFIRMED_ROUTE_KEY_V1 } = {}) {
  if (!db?.isTransaction || typeof refreshProjections !== 'function') fail('SCHEDULE_TRANSACTION_REQUIRED');
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) fail('SCHEDULE_SELECTION_EMPTY');
  if (currentScheduleRevision >= MAX_SAFE || currentProjectionRevision >= MAX_SAFE) {
    fail('SCHEDULE_REVISION_EXHAUSTED');
  }
  const maxOrdinal = db.prepare('SELECT max(source_ordinal) AS value FROM schedule_items').get().value ?? -1;
  if (!Number.isSafeInteger(maxOrdinal) || maxOrdinal > MAX_SAFE - selectedItems.length) {
    fail('SCHEDULE_ORDINAL_EXHAUSTED');
  }
  const nextScheduleRevision = currentScheduleRevision + 1;
  const nextProjectionRevision = currentProjectionRevision + 1;
  const outbox = createSqliteOutboxRepositoryV1({ db });
  const inserted = [];
  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (item.configVersion !== proposal.configVersion) fail('SCHEDULE_CONFIG_VERSION_MISMATCH');
    const resource = db.prepare(`SELECT status FROM scheduling_resources WHERE resource_id = ?`)
      .get(item.resourceId);
    if (resource?.status !== 'active') fail('SCHEDULE_RESOURCE_INACTIVE');
    const request = db.prepare('SELECT request_lifecycle FROM requests_v2 WHERE id = ?')
      .get(item.requestId);
    if (request?.request_lifecycle !== 'open') fail('SCHEDULE_REQUEST_NOT_OPEN');
    const bound = db.prepare(`SELECT 1 FROM schedule_item_tasks AS binding
      JOIN schedule_items AS schedule ON schedule.id = binding.schedule_item_id
      WHERE binding.task_id = ? AND schedule.schedule_status <> 'cancelled' LIMIT 1`)
      .get(item.requestId);
    if (bound) fail('SCHEDULE_REQUEST_ALREADY_BOUND');
    const id = deriveAcceptedScheduleItemIdV1(decisionId, item.proposalItemId);
    if (!id.ok) fail(id.code);
    const sourceOrdinal = maxOrdinal + index + 1;
    const occupied = db.prepare(`SELECT resource_id, resource_resolution_status,
      planned_start, planned_end, buffer_after_minutes FROM schedule_items
      WHERE schedule_status <> 'cancelled' AND
        (resource_id = ? OR resource_resolution_status = 'unresolved')`)
      .all(item.resourceId);
    const start = Date.parse(item.plannedStart);
    const end = Date.parse(item.plannedEnd) + item.bufferAfterMinutes * 60_000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      fail('SCHEDULE_INTERVAL_INVALID');
    }
    const overlap = occupied.some(row => row.resource_resolution_status === 'unresolved'
      || row.buffer_after_minutes === null
      || (Date.parse(row.planned_start) < end
        && Date.parse(row.planned_end) + row.buffer_after_minutes * 60_000 > start));
    if (overlap) fail('SCHEDULE_RESOURCE_OVERLAP_OR_UNKNOWN');
    db.prepare(`INSERT INTO schedule_items
      (id, source_ordinal, resource_id, resource_resolution_status, resource_mapping_version,
       legacy_place_text, planned_start, planned_end, buffer_after_minutes, buffer_source,
       schedule_status, schedule_status_provenance, lock_status, lock_status_provenance,
       note, allocation_mode, source, source_ref, business_created_at, business_updated_at,
       imported_at, migration_batch_id)
       VALUES (?, ?, ?, 'resolved', 'resource-catalog-v1', NULL, ?, ?, ?,
         ?, 'confirmed', 'domain_command', 'unlocked', 'domain_command',
         '', 'single', 'agent_proposal', ?, ?, ?, ?, NULL)`).run(
      id.scheduleItemId, sourceOrdinal, item.resourceId, item.plannedStart, item.plannedEnd,
      item.bufferAfterMinutes, proposal.configVersion, proposal.proposalId, at, at, at,
    );
    db.prepare(`INSERT INTO schedule_item_tasks
      (schedule_item_id, task_id, display_order, created_at, imported_at)
      VALUES (?, ?, 0, ?, ?)`).run(id.scheduleItemId, item.requestId, at, at);
    inserted.push({ proposalItemId: item.proposalItemId,
      scheduleItemId: id.scheduleItemId, sourceOrdinal });
  }
  const changed = db.prepare(`UPDATE revision_counters SET schedule_revision = ?,
    projection_revision = ?, updated_at = ? WHERE id = 1 AND schedule_revision = ?
    AND projection_revision = ?`).run(nextScheduleRevision, nextProjectionRevision, at,
    currentScheduleRevision, currentProjectionRevision).changes;
  if (changed !== 1) fail('SCHEDULE_REVISION_CONFLICT');
  refreshProjections({ db, projectionRevision: nextProjectionRevision,
    scheduleRevision: nextScheduleRevision, updatedAt: at });
  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    const scheduleItemId = inserted[index].scheduleItemId;
    const card = buildScheduleConfirmedCardV1({ scheduleItemId,
      resourceId: item.resourceId, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd,
      taskCount: 1, scheduleRevision: nextScheduleRevision });
    if (!card.ok) fail(card.code);
    const intent = buildNotificationIntentV1({ outboxId: `out_${scheduleItemId}`,
      intentType: 'schedule.confirmed.v1', aggregateType: 'schedule_item',
      aggregateId: scheduleItemId, routeKey, aggregateRevisionScope: 'schedule',
      aggregateRevision: nextScheduleRevision, cardSchemaVersion: card.cardSchemaVersion,
      payload: card.card, createdAt: at });
    if (!intent.ok) fail(intent.code);
    const queued = outbox.enqueue(intent.intent);
    if (!queued.ok || queued.code !== 'OUTBOX_ENQUEUED') fail(queued.code);
  }
  return { adoptedItems: inserted, scheduleRevision: nextScheduleRevision,
    projectionRevision: nextProjectionRevision };
}
