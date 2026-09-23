import { compileSchedulingCalendarDateV1 } from './scheduling-admin-contract-v1.mjs';
import { SCHEDULING_TIME_ZONE_DATA_VERSION } from './scheduling-contract-v1.mjs';

const DAY_MS = 86_400_000;
const MAX_CALENDAR_DAYS = 366;
const FACT_KEYS = Object.freeze([
  'productionType', 'shootingSubtype', 'desiredDate', 'sampleStatus', 'lightingPreset',
  'reflectivity', 'priority', 'requiredCapabilityIds', 'durationEstimate',
]);

function localDate(formatter, instant) {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function datesWithinScope(start, end, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const first = Date.parse(`${localDate(formatter, start)}T00:00:00.000Z`);
  const last = Date.parse(`${localDate(formatter, end - 1)}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first
    || Math.floor((last - first) / DAY_MS) + 1 > MAX_CALENDAR_DAYS) {
    throw new Error('SCHEDULING_PLANNING_RANGE_UNSUPPORTED');
  }
  const dates = [];
  for (let day = first; day <= last; day += DAY_MS) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}

/** Read only; caller owns the SQLite read or write transaction. No free-text inference. */
export function assembleSchedulingInputFromSqliteV1({ db, command, activeConfig } = {}) {
  if (!db || !command || !activeConfig?.config) throw new TypeError('trusted assembly context required');
  const start = Date.parse(command.planningWindowStart);
  const end = Date.parse(command.planningWindowEnd);
  const config = activeConfig.config;
  const dates = datesWithinScope(start, end, config.businessTimeZone);
  const resources = command.resourceScope.map(resourceId => {
    const row = db.prepare(`SELECT resource_id, v1_display_place, status,
      capability_json, capability_digest FROM scheduling_resources
      WHERE resource_id = ?`).get(resourceId);
    if (!row) throw new Error('SCHEDULING_RESOURCE_NOT_REGISTERED');
    const businessWindows = [];
    for (const date of dates) {
      const compiled = compileSchedulingCalendarDateV1({
        configJson: config, resourceId, date,
        calendarCompilerVersion: activeConfig.calendar_compiler_version,
        timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
      });
      if (!compiled.ok) throw new Error('SCHEDULING_CALENDAR_COMPILE_FAILED');
      for (const window of compiled.windows) {
        const clippedStart = Math.max(Date.parse(window.start), start);
        const clippedEnd = Math.min(Date.parse(window.end), end);
        if (clippedStart < clippedEnd) businessWindows.push({
          start: new Date(clippedStart).toISOString(), end: new Date(clippedEnd).toISOString(),
        });
      }
    }
    return {
      resourceId, v1DisplayPlace: row.v1_display_place, status: row.status,
      capabilityJson: JSON.parse(row.capability_json), capabilityDigest: row.capability_digest,
      businessWindows,
    };
  });

  const candidateRows = db.prepare(`SELECT request.*,
    requirements.required_capability_ids_json,
    requirements.duration_estimate_json
    FROM requests_v2 AS request
    LEFT JOIN scheduling_request_requirements AS requirements ON requirements.request_id = request.id
    WHERE request.request_lifecycle = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM schedule_item_tasks AS binding
        JOIN schedule_items AS item ON item.id = binding.schedule_item_id
        WHERE binding.task_id = request.id AND item.schedule_status <> 'cancelled'
      )
    ORDER BY request.source_ordinal, request.id`).all();
  const candidates = candidateRows.map(row => {
    const provenance = row.source_operation_id === null ? 'legacy-snapshot-v1' : 'domain-command-v1';
    const factProvenance = Object.fromEntries(FACT_KEYS.map(key => [key, provenance]));
    factProvenance.requiredCapabilityIds = row.required_capability_ids_json === null
      ? 'unrecorded-v1' : 'scheduling-request-requirements-v1';
    factProvenance.durationEstimate = row.duration_estimate_json === null
      ? 'unrecorded-v1' : 'scheduling-request-requirements-v1';
    return {
      requestId: row.id, sourceOrdinal: row.source_ordinal,
      requestLifecycle: 'open', lifecycleProvenance: row.lifecycle_provenance === 'domain_command'
        ? 'domainCommand' : 'legacySnapshot',
      nonCancelledScheduleItemIds: [],
      productionType: row.production_type, shootingSubtype: row.shooting_subtype,
      desiredDate: row.desired_date, sampleStatus: row.sample_status,
      lightingPreset: row.lighting_preset, reflectivity: row.reflectivity,
      priority: row.priority,
      requiredCapabilityIds: row.required_capability_ids_json === null
        ? null : JSON.parse(row.required_capability_ids_json),
      durationEstimate: row.duration_estimate_json === null
        ? null : JSON.parse(row.duration_estimate_json),
      factProvenance,
    };
  });

  // Unknown legacy Buffer or resource resolution blocks the whole scoped planning window.
  const occupiedRows = db.prepare(`SELECT * FROM schedule_items
    WHERE schedule_status <> 'cancelled' ORDER BY planned_start, id`).all();
  const bindings = db.prepare(`SELECT schedule_item_id, task_id, display_order
    FROM schedule_item_tasks ORDER BY schedule_item_id, display_order`).all();
  const byItem = new Map();
  for (const binding of bindings) {
    const list = byItem.get(binding.schedule_item_id) ?? [];
    list.push({ requestId: binding.task_id, displayOrder: binding.display_order });
    byItem.set(binding.schedule_item_id, list);
  }
  const occupied = occupiedRows.map(row => ({
    scheduleItemId: row.id, sourceOrdinal: row.source_ordinal,
    resourceId: row.resource_id, resourceResolutionStatus: row.resource_resolution_status,
    allocationMode: row.allocation_mode === 'single' ? 'single' : 'groupedUnallocated',
    taskBindings: byItem.get(row.id) ?? [], plannedStart: row.planned_start,
    plannedEnd: row.planned_end, bufferAfterMinutes: row.buffer_after_minutes,
    bufferSource: row.buffer_source, scheduleStatus: row.schedule_status,
    lockStatus: row.lock_status, lockStatusProvenance: row.lock_status_provenance,
    source: row.source === 'agent_proposal' ? 'agentProposal' : row.source,
  }));
  const activeRuns = db.prepare(`SELECT id, schedule_item_id, status FROM production_runs
    WHERE status IN ('shooting', 'blocked') ORDER BY id`).all().map(row => ({
    runId: row.id, scheduleItemId: row.schedule_item_id, status: row.status,
  }));
  const scheduleRevision = db.prepare(`SELECT schedule_revision FROM revision_counters
    WHERE id = 1`).get()?.schedule_revision;
  if (scheduleRevision === undefined) throw new Error('SCHEDULING_REVISION_NOT_READY');
  return {
    schemaVersion: 1, planningWindowStart: command.planningWindowStart,
    planningWindowEnd: command.planningWindowEnd,
    businessTimeZone: config.businessTimeZone,
    baseScheduleRevision: scheduleRevision,
    algorithmVersion: activeConfig.algorithm_version,
    calendarCompilerVersion: activeConfig.calendar_compiler_version,
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: activeConfig.estimate_policy_version,
    configVersion: activeConfig.config_version,
    configDigest: activeConfig.config_digest,
    resources, candidates, occupied, activeRuns, durationStats: [],
  };
}
