import { createSqliteRunEventStore } from './sqlite-run-event-store-v2.mjs';

function kioskReceipt(db, eventId) {
  const operation = db.prepare(`
    SELECT operation_id, kind, response_json, request_digest, created_at
    FROM operations WHERE operation_id = ?
  `).get(eventId) ?? null;
  const event = db.prepare(`
    SELECT event_id, run_id, command_digest, response_digest, event_type,
           occurred_at, received_at, device_id, actor_id, reason_code, note,
           previous_state, resulting_state, resulting_run_revision,
           resulting_projection_revision, resulting_schedule_revision
    FROM production_events WHERE event_id = ?
  `).get(eventId) ?? null;
  const review = db.prepare(`
    SELECT event_id, run_id, schedule_item_id, command_digest, response_digest,
           event_type, expected_run_revision, occurred_at, received_at, device_id,
           actor_id, actor_role, reason_code, note, time_policy_version,
           review_reason, review_status, response_json, created_at
    FROM run_event_reviews WHERE event_id = ?
  `).get(eventId) ?? null;
  const resource = event
    ? db.prepare(`
      SELECT schedule.resource_id
      FROM production_events AS accepted
      JOIN production_runs AS run ON run.id = accepted.run_id
      JOIN schedule_items AS schedule ON schedule.id = run.schedule_item_id
      WHERE accepted.event_id = ?
    `).get(eventId)
    : review
      ? db.prepare('SELECT resource_id FROM schedule_items WHERE id = ?').get(review.schedule_item_id)
      : null;
  const history = event ? db.prepare(`
    SELECT event_id, run_id, event_type, occurred_at, previous_state,
           resulting_state, resulting_run_revision
    FROM production_events
    WHERE run_id = ? AND resulting_run_revision <= ?
    ORDER BY resulting_run_revision
  `).all(event.run_id, event.resulting_run_revision) : [];
  return { operation, event, review, history, resourceId: resource?.resource_id ?? null };
}

function scheduleContext(db, scheduleItemId) {
  const scheduleItem = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(scheduleItemId) ?? null;
  if (!scheduleItem) return { scheduleItem: null };
  const bindings = db.prepare(`
    SELECT task_id FROM schedule_item_tasks
    WHERE schedule_item_id = ? ORDER BY display_order
  `).all(scheduleItemId);
  const requests = bindings.map(binding => db.prepare(`
    SELECT id, request_lifecycle FROM requests_v2 WHERE id = ?
  `).get(binding.task_id)).filter(Boolean);
  const runs = db.prepare(`
    SELECT * FROM production_runs
    WHERE schedule_item_id = ? ORDER BY created_at, id
  `).all(scheduleItemId);
  const counters = db.prepare(`
    SELECT projection_revision, schedule_revision FROM revision_counters WHERE id = 1
  `).get() ?? null;
  return {
    scheduleItem,
    requestIds: bindings.map(binding => binding.task_id),
    requests,
    runs,
    counters,
  };
}

export function createSqliteKioskRunEventStore({
  db,
  businessTimeZone,
  allowedBriefHosts = [],
  projectV1,
  projectV2,
} = {}) {
  const baseStore = createSqliteRunEventStore({
    db,
    businessTimeZone,
    allowedBriefHosts,
    ...(projectV1 ? { projectV1 } : {}),
    ...(projectV2 ? { projectV2 } : {}),
  });

  return {
    withImmediateTransaction(action) {
      return baseStore.withImmediateTransaction(base => action({
        ...base,

        getKioskReceipt(eventId) {
          return kioskReceipt(db, eventId);
        },

        getScheduleContext(scheduleItemId) {
          return scheduleContext(db, scheduleItemId);
        },

        findRunById(runId) {
          return db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId) ?? null;
        },

        insertProvisionedRun({ runId, scheduleItemId, scope, taskId, createdAt }) {
          db.prepare(`
            INSERT INTO production_runs (
              id, schedule_item_id, scope, task_id, status, run_revision,
              blocked_duration_ms, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'scheduled', 0, 0, ?, ?)
          `).run(runId, scheduleItemId, scope, taskId, createdAt, createdAt);
        },

        insertReview({ command, digest, responseDigest, response, receivedAt, reviewDecision }) {
          db.prepare(`
            INSERT INTO run_event_reviews (
              event_id, run_id, schedule_item_id, command_digest, response_digest,
              event_type, expected_run_revision, occurred_at, received_at, device_id,
              actor_id, actor_role, reason_code, note, time_policy_version,
              review_reason, review_status, response_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `).run(
            command.eventId,
            command.runId,
            command.scheduleItemId,
            digest,
            responseDigest,
            command.eventType,
            command.expectedRunRevision,
            command.occurredAt,
            receivedAt,
            command.deviceId,
            command.actorId,
            command.actorRole,
            command.reasonCode,
            command.note,
            reviewDecision.policyVersion,
            reviewDecision.reviewReason,
            JSON.stringify(response),
            receivedAt,
          );
        },
      }));
    },
  };
}
