import {
  projectV1CompatibilitySnapshot,
  projectV2Snapshot,
} from './projections-v2.mjs';
import {
  validateV1Snapshot,
  validateV2Snapshot,
} from './contract-validator.mjs';

function requireChanges(result, code) {
  if (result.changes !== 1) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function projectionRecords(db) {
  const requests = db.prepare('SELECT * FROM requests_v2 ORDER BY source_ordinal').all().map(request => ({
    ...request,
    v1_assets_present: Boolean(request.v1_assets_present),
    v1_request_present: Boolean(request.v1_request_present),
  }));
  return {
    revision_counters: db.prepare(`
      SELECT projection_revision, schedule_revision, updated_at
      FROM revision_counters WHERE id = 1
    `).get(),
    product_catalog_entries: db.prepare('SELECT * FROM product_catalog_entries ORDER BY display_order').all(),
    requests_v2: requests,
    schedule_items: db.prepare('SELECT * FROM schedule_items ORDER BY source_ordinal').all(),
    schedule_item_tasks: db.prepare(`
      SELECT * FROM schedule_item_tasks ORDER BY schedule_item_id, display_order
    `).all(),
    legacy_asset_entries: db.prepare(`
      SELECT * FROM legacy_asset_entries ORDER BY request_id, display_order
    `).all(),
    legacy_compat_fragments: db.prepare(`
      SELECT * FROM legacy_compat_fragments ORDER BY source_ordinal
    `).all(),
    production_runs: db.prepare('SELECT * FROM production_runs ORDER BY created_at, id').all(),
    uploads: db.prepare('SELECT * FROM uploads ORDER BY created_at, id').all(),
    resources: [],
  };
}

export function createSqliteRunEventStore({
  db,
  businessTimeZone,
  allowedBriefHosts = [],
  projectV1 = projectV1CompatibilitySnapshot,
  projectV2 = projectV2Snapshot,
} = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('SQLite database is required');
  }
  if (typeof businessTimeZone !== 'string' || !businessTimeZone) {
    throw new TypeError('businessTimeZone is required');
  }

  const transaction = {
    getEventReceipt(eventId) {
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
      return {
        operation,
        event,
        history: event ? db.prepare(`
          SELECT event_id, run_id, event_type, occurred_at, previous_state,
                 resulting_state, resulting_run_revision
          FROM production_events
          WHERE run_id = ? AND resulting_run_revision <= ?
          ORDER BY resulting_run_revision
        `).all(event.run_id, event.resulting_run_revision) : [],
      };
    },

    getRunContext(runId) {
      const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId);
      if (!run) return { run: null };
      const scheduleItem = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(run.schedule_item_id);
      const bindings = db.prepare(`
        SELECT task_id FROM schedule_item_tasks
        WHERE schedule_item_id = ? ORDER BY display_order
      `).all(run.schedule_item_id);
      const requests = bindings.map(binding => db.prepare(`
        SELECT id, request_lifecycle FROM requests_v2 WHERE id = ?
      `).get(binding.task_id)).filter(Boolean);
      const counters = db.prepare(`
        SELECT projection_revision, schedule_revision FROM revision_counters WHERE id = 1
      `).get() ?? null;
      const lastEvent = db.prepare(`
        SELECT occurred_at FROM production_events
        WHERE run_id = ? ORDER BY resulting_run_revision DESC LIMIT 1
      `).get(runId);
      return {
        run,
        scheduleItem,
        requestIds: bindings.map(binding => binding.task_id),
        requests,
        counters,
        lastOccurredAt: lastEvent?.occurred_at ?? null,
      };
    },

    updateRun({ runId, expectedRunRevision, nextRunRevision, receivedAt, run }) {
      return db.prepare(`
        UPDATE production_runs
        SET status = ?, run_revision = ?, started_at = ?, completed_at = ?,
            active_block_started_at = ?, gross_duration_ms = ?, blocked_duration_ms = ?,
            net_duration_ms = ?, metrics_algorithm_version = ?, updated_at = ?
        WHERE id = ? AND run_revision = ?
      `).run(
        run.status,
        nextRunRevision,
        run.started_at,
        run.completed_at,
        run.active_block_started_at,
        run.gross_duration_ms,
        run.blocked_duration_ms,
        run.net_duration_ms,
        run.metrics_algorithm_version,
        receivedAt,
        runId,
        expectedRunRevision,
      ).changes;
    },

    fulfillRequest(requestId, updatedAt) {
      return db.prepare(`
        UPDATE requests_v2
        SET request_lifecycle = 'fulfilled', lifecycle_provenance = 'domain_command',
            v1_status_mode = 'canonical', business_updated_at = ?
        WHERE id = ? AND request_lifecycle = 'open'
      `).run(updatedAt, requestId).changes;
    },

    insertEvent({
      command,
      digest,
      responseDigest,
      receivedAt,
      previousState,
      resultingState,
      resultingRunRevision,
      resultingProjectionRevision,
      resultingScheduleRevision,
    }) {
      db.prepare(`
        INSERT INTO production_events (
          event_id, run_id, command_digest, response_digest, event_type, occurred_at,
          received_at, device_id, actor_id, reason_code, note, previous_state,
          resulting_state, resulting_run_revision, resulting_projection_revision,
          resulting_schedule_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        command.eventId,
        command.runId,
        digest,
        responseDigest,
        command.eventType,
        command.occurredAt,
        receivedAt,
        command.deviceId,
        command.actorId,
        command.reasonCode,
        command.note,
        previousState,
        resultingState,
        resultingRunRevision,
        resultingProjectionRevision,
        resultingScheduleRevision,
      );
    },

    advanceProjectionRevision({
      currentProjectionRevision,
      scheduleRevision,
      nextProjectionRevision,
      updatedAt,
    }) {
      return db.prepare(`
        UPDATE revision_counters
        SET projection_revision = ?, updated_at = ?
        WHERE id = 1 AND projection_revision = ? AND schedule_revision = ?
      `).run(nextProjectionRevision, updatedAt, currentProjectionRevision, scheduleRevision).changes;
    },

    refreshSnapshotProjections({ projectionRevision, scheduleRevision, updatedAt }) {
      const records = projectionRecords(db);
      if (
        records.revision_counters?.projection_revision !== projectionRevision
        || records.revision_counters?.schedule_revision !== scheduleRevision
      ) {
        const error = new Error('PROJECTION_COUNTER_MISMATCH');
        error.code = 'PROJECTION_COUNTER_MISMATCH';
        throw error;
      }
      const v1 = projectV1(records, { businessTimeZone, updatedAt });
      const v2 = projectV2(records, { allowedBriefHosts, updatedAt });
      const v1Validation = validateV1Snapshot(v1, { profile: 'legacy-read' });
      if (
        v1Validation.switchReady !== true
        || !['L0_STRICT', 'L1_GRANDFATHERED_OPAQUE'].includes(v1Validation.classification)
      ) {
        const error = new Error('V1_PROJECTION_CONTRACT_INVALID');
        error.code = 'V1_PROJECTION_CONTRACT_INVALID';
        throw error;
      }
      const v2Validation = validateV2Snapshot(v2, { allowedBriefHosts });
      if (!v2Validation.ok) {
        const error = new Error('V2_PROJECTION_CONTRACT_INVALID');
        error.code = 'V2_PROJECTION_CONTRACT_INVALID';
        throw error;
      }
      const upsert = db.prepare(`
        INSERT INTO snapshot_projections (
          projection_name, schema_version, revision, schedule_revision,
          updated_at, payload_json, source_schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, 2)
        ON CONFLICT(projection_name) DO UPDATE SET
          schema_version = excluded.schema_version,
          revision = excluded.revision,
          schedule_revision = excluded.schedule_revision,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json,
          source_schema_version = excluded.source_schema_version
      `);
      requireChanges(upsert.run(
        'schedule-v1-compat', 1, projectionRevision, null, updatedAt, JSON.stringify(v1),
      ), 'V1_PROJECTION_WRITE_FAILED');
      requireChanges(upsert.run(
        'schedule-v2', 2, projectionRevision, scheduleRevision, updatedAt, JSON.stringify(v2),
      ), 'V2_PROJECTION_WRITE_FAILED');
      return { v1, v2 };
    },

    saveEventReceipt({ eventId, kind, digest, response, createdAt }) {
      db.prepare(`
        INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
        VALUES (?, ?, ?, ?, ?)
      `).run(eventId, kind, JSON.stringify(response), createdAt, digest);
    },

    recordAudit({ action, role, entityId, revision, result, createdAt }) {
      db.prepare(`
        INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(action, role, entityId, revision, result, createdAt);
    },
  };

  return {
    withImmediateTransaction(action) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = action(transaction);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    },
  };
}
