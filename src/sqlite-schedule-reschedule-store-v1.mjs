import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1, isSchedulingIdentifierV1 } from './scheduling-contract-v1.mjs';
import { compileSchedulingCalendarDate, normalizeSchedulingConfig } from './scheduling-admin-contract-v2.mjs';
import { validateTrustedPrincipal, authorizeCapability } from './authorization-v2.mjs';
import { assertSchedulingQuiescenceV1, assertGf15CommandPacketV1 } from './sqlite-scheduling-quiescence-v1.mjs';
import { staleDraftProposalsInTransactionV1 } from './sqlite-scheduling-proposal-store-v1.mjs';

const denied = code => ({ ok: false, code });
const keys = ['operationId', 'scheduleItemId', 'resourceId', 'plannedStart', 'plannedEnd',
  'expectedScheduleRevision', 'expectedProjectionRevision', 'configDigest'];
function iso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
export function normalizeScheduleRescheduleCommandV1(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== keys.length
    || !keys.every(key => Object.hasOwn(input, key))
    || !['operationId', 'scheduleItemId', 'resourceId'].every(key => isSchedulingIdentifierV1(input[key]))
    || !['expectedScheduleRevision', 'expectedProjectionRevision'].every(key => Number.isSafeInteger(input[key]) && input[key] >= 0)
    || !iso(input.plannedStart) || !iso(input.plannedEnd) || input.plannedStart >= input.plannedEnd
    || typeof input.configDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.configDigest)) return denied('RESCHEDULE_COMMAND_INVALID');
  const command = Object.fromEntries(keys.map(key => [key, input[key]]));
  return { ok: true, command, commandDigest: digestCanonicalJsonSchedulingV1({ domain: 'schedule-reschedule-v1', command }) };
}
function allowed(principal, resourceId) {
  return validateTrustedPrincipal(principal).ok && ['scheduler', 'administrator'].includes(principal.role)
    && authorizeCapability({ principal, capability: 'modifySchedule', resourceId }).allowed;
}
function localDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function state(row) {
  return { scheduleItemId: row.id, resourceId: row.resource_id, plannedStart: row.planned_start,
    plannedEnd: row.planned_end, bufferAfterMinutes: row.buffer_after_minutes,
    bufferSource: row.buffer_source, scheduleStatus: row.schedule_status, lockStatus: row.lock_status };
}

/** Internal canonical store: the caller supplies a server-authenticated principal and admission gate. */
export function createSqliteScheduleRescheduleStoreV1({ db, now, refreshProjections, writeAdmission = () => true } = {}) {
  if (!db || typeof now !== 'function' || typeof refreshProjections !== 'function' || typeof writeAdmission !== 'function') throw new TypeError('db, clock, projections, admission required');
  function readOperation(operationId, principal) {
    if (!isSchedulingIdentifierV1(operationId) || !validateTrustedPrincipal(principal).ok) return denied('TRUSTED_SCHEDULER_REQUIRED');
    const row = db.prepare('SELECT * FROM schedule_reschedule_operations WHERE operation_id = ?').get(operationId);
    if (!row) return denied('RESCHEDULE_OPERATION_NOT_FOUND');
    if (!allowed(principal, row.resource_id)) return denied('RESOURCE_FORBIDDEN');
    const receipt = JSON.parse(row.receipt_json);
    if (canonicalJsonSchedulingV1(receipt) !== row.receipt_json || digestCanonicalJsonSchedulingV1(receipt) !== row.receipt_digest) throw new Error('RESCHEDULE_RECEIPT_CORRUPT');
    return { ok: true, receipt };
  }
  return Object.freeze({ readOperation,
    reschedule(input, principal, { executionGuard = () => true } = {}) {
      if (typeof executionGuard !== 'function') return denied('INVALID_EXECUTION_GUARD');
      const normalized = normalizeScheduleRescheduleCommandV1(input);
      if (!normalized.ok) return normalized;
      const { command, commandDigest } = normalized;
      if (!allowed(principal, command.resourceId)) return denied('RESOURCE_FORBIDDEN');
      if (writeAdmission() !== true) return denied('WRITE_ADMISSION_CLOSED');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = apply();
        if (result.ok && executionGuard() !== true) {
          db.exec('ROLLBACK');
          return denied('AGENT_EXECUTION_WINDOW_CLOSED');
        }
        db.exec('COMMIT');
        return result;
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      function apply() {
        if (writeAdmission() !== true) return denied('WRITE_ADMISSION_CLOSED');
        assertSchedulingQuiescenceV1({ db, now });
        assertGf15CommandPacketV1(db, command, null);
        const prior = db.prepare('SELECT command_digest, actor_id FROM schedule_reschedule_operations WHERE operation_id = ?').get(command.operationId);
        if (prior) return prior.command_digest === commandDigest && prior.actor_id === principal.subjectId
          ? { ...readOperation(command.operationId, principal), exactReplay: true } : denied('IDEMPOTENCY_KEY_REUSE');
        // Prevent reusing a key owned by another canonical operation family.
        if (db.prepare('SELECT 1 FROM operations WHERE operation_id = ?').get(command.operationId)
          || db.prepare('SELECT 1 FROM scheduling_admin_operations WHERE operation_id = ?').get(command.operationId)) return denied('IDEMPOTENCY_KEY_REUSE');
        const counters = db.prepare('SELECT schedule_revision, projection_revision FROM revision_counters WHERE id = 1').get();
        if (!counters || counters.schedule_revision !== command.expectedScheduleRevision || counters.projection_revision !== command.expectedProjectionRevision) return denied('SCHEDULING_REVISION_CONFLICT');
        if (Math.max(counters.schedule_revision, counters.projection_revision) >= Number.MAX_SAFE_INTEGER) return denied('SCHEDULE_REVISION_EXHAUSTED');
        const row = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(command.scheduleItemId);
        if (!row) return denied('SCHEDULE_ITEM_NOT_FOUND');
        if (row.resource_id !== command.resourceId || row.resource_resolution_status !== 'resolved') return denied('RESCHEDULE_RESOURCE_MISMATCH');
        if (row.schedule_status === 'cancelled' || row.lock_status !== 'unlocked' || row.allocation_mode !== 'single'
          || db.prepare('SELECT 1 FROM production_runs WHERE schedule_item_id = ? LIMIT 1').get(row.id)) return denied('RESCHEDULE_ITEM_IMMUTABLE');
        // Original confirmed intents remain historical facts. A leased send has an unknown
        // external outcome, including after lease expiry; never race it with a time change.
        if (db.prepare(`SELECT 1 FROM notification_outbox WHERE aggregate_type = 'schedule_item'
          AND aggregate_id = ? AND intent_type = 'schedule.confirmed.v1' AND status = 'leased' LIMIT 1`).get(row.id)) return denied('RESCHEDULE_NOTIFICATION_IN_FLIGHT');
        const at = now().toISOString();
        if (!iso(row.planned_start) || row.planned_start <= at || command.plannedStart <= at) return denied('RESCHEDULE_PAST_INTERVAL');
        const resource = db.prepare('SELECT * FROM scheduling_resources WHERE resource_id = ?').get(command.resourceId);
        if (resource?.status !== 'active') return denied('SCHEDULE_RESOURCE_INACTIVE');
        const active = db.prepare(`SELECT v.* FROM scheduling_active_config a JOIN scheduling_config_versions v ON a.config_version = v.config_version WHERE a.id = 1`).get();
        if (!active || active.config_digest !== command.configDigest) return denied('RESCHEDULE_CONFIG_CONFLICT');
        const config = normalizeSchedulingConfig(JSON.parse(active.config_json));
        if (!config.ok || config.configDigest !== active.config_digest || config.configJson !== active.config_json) return denied('RESCHEDULE_CONFIG_INVALID');
        const calendar = config.config.resourceCalendars.find(item => item.resourceId === command.resourceId);
        if (!calendar || calendar.capabilityDigest !== resource.capability_digest) return denied('RESCHEDULE_CONFIG_INVALID');
        const tasks = db.prepare(`SELECT r.* FROM schedule_item_tasks b JOIN requests_v2 r ON r.id = b.task_id WHERE b.schedule_item_id = ? ORDER BY b.display_order`).all(row.id);
        if (tasks.length !== 1 || tasks[0].request_lifecycle !== 'open') return denied('RESCHEDULE_REQUEST_NOT_OPEN');
        const task = tasks[0];
        const buffer = config.config.bufferRules.find(rule => (rule.productionType === null || rule.productionType === task.production_type)
          && (rule.shootingSubtype === null || rule.shootingSubtype === task.shooting_subtype));
        if (!buffer) return denied('RESCHEDULE_BUFFER_UNKNOWN');
        const occupiedEnd = Date.parse(command.plannedEnd) + buffer.bufferAfterMinutes * 60_000;
        const compiled = compileSchedulingCalendarDate({ configJson: config.config, resourceId: command.resourceId,
          date: localDate(command.plannedStart, config.config.businessTimeZone), calendarCompilerVersion: active.calendar_compiler_version, timeZoneDataVersion: process.versions.tz });
        if (!compiled.ok || !compiled.windows.some(window => Date.parse(window.start) <= Date.parse(command.plannedStart) && occupiedEnd <= Date.parse(window.end))) return denied('RESCHEDULE_OUTSIDE_WORK_WINDOW');
        const occupied = db.prepare(`SELECT * FROM schedule_items WHERE id <> ? AND schedule_status <> 'cancelled' AND (resource_id = ? OR resource_resolution_status = 'unresolved')`).all(row.id, command.resourceId);
        if (occupied.some(item => item.resource_resolution_status !== 'resolved' || item.buffer_after_minutes === null
          || !iso(item.planned_start) || !iso(item.planned_end) || item.planned_end <= item.planned_start
          || (Date.parse(item.planned_start) < occupiedEnd && Date.parse(item.planned_end) + item.buffer_after_minutes * 60_000 > Date.parse(command.plannedStart)))) return denied('SCHEDULE_RESOURCE_OVERLAP_OR_UNKNOWN');
        const after = { ...state(row), plannedStart: command.plannedStart, plannedEnd: command.plannedEnd,
          bufferAfterMinutes: buffer.bufferAfterMinutes, bufferSource: active.config_version };
        if (canonicalJsonSchedulingV1(after) === canonicalJsonSchedulingV1(state(row))) return denied('RESCHEDULE_NO_CHANGE');
        const nextSchedule = counters.schedule_revision + 1, nextProjection = counters.projection_revision + 1;
        db.prepare(`UPDATE schedule_items SET planned_start = ?, planned_end = ?, buffer_after_minutes = ?, buffer_source = ?, business_updated_at = ? WHERE id = ?`).run(after.plannedStart, after.plannedEnd, after.bufferAfterMinutes, after.bufferSource, at, row.id);
        const changed = db.prepare(`UPDATE revision_counters SET schedule_revision = ?, projection_revision = ?, updated_at = ? WHERE id = 1 AND schedule_revision = ? AND projection_revision = ?`).run(nextSchedule, nextProjection, at, counters.schedule_revision, counters.projection_revision).changes;
        if (changed !== 1) throw new Error('SCHEDULING_REVISION_CONFLICT');
        staleDraftProposalsInTransactionV1({ db, triggerOperationId: command.operationId, reasonCode: 'SCHEDULE_REVISION_CHANGED', now });
        refreshProjections({ db, projectionRevision: nextProjection, scheduleRevision: nextSchedule, updatedAt: at });
        const receipt = { schemaVersion: 1, operationId: command.operationId, commandDigest, actor: { subjectId: principal.subjectId, role: principal.role },
          configVersion: active.config_version, configDigest: active.config_digest, before: state(row), after, requestIds: tasks.map(task => task.id),
          scheduleRevision: nextSchedule, projectionRevision: nextProjection, notificationStatus: 'NOT_WIRED_NO_EVENT_ENQUEUED', createdAt: at };
        db.prepare(`INSERT INTO schedule_reschedule_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(command.operationId, row.id, row.resource_id, principal.subjectId, commandDigest,
          canonicalJsonSchedulingV1(command), canonicalJsonSchedulingV1(receipt), digestCanonicalJsonSchedulingV1(receipt), at);
        db.prepare(`INSERT INTO operations (operation_id,kind,response_json,created_at,request_digest) VALUES (?, 'rescheduleScheduleItem', ?, ?, ?)`).run(command.operationId, canonicalJsonSchedulingV1(receipt), at, commandDigest);
        db.prepare(`INSERT INTO audit_log (action,role,entity_id,revision,result,created_at) VALUES ('rescheduleScheduleItem', ?, ?, ?, 'accepted', ?)`).run(principal.role, row.id, nextSchedule, at);
        return { ok: true, receipt, exactReplay: false };
      }
    },
  });
}
