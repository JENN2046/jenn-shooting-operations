import { authorizeCapability } from './authorization-v2.mjs';
import { validateKioskCurrentRelationships } from './kiosk-contract-rules-v2.mjs';

const IDENTIFIER = /^\S(?:[\s\S]*\S)?$/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const GROUPED_NOTICE = '组合场次，未拆分单任务工时';
const ACTIVE_STATES = new Set(['shooting', 'blocked']);
const PUBLIC_CURRENT_FAILURES = new Set([
  'RESOURCE_NOT_FOUND',
  'MULTIPLE_ACTIVE_RUNS',
  'MULTIPLE_CURRENT_CANDIDATES',
  'MULTIPLE_NEXT_CANDIDATES',
]);

function failure(code, details = {}) {
  return Object.freeze({ ok: false, code, ...details });
}

function validIdentifier(value) {
  return typeof value === 'string' && [...value].length <= 160 && IDENTIFIER.test(value);
}

function normalizeAuthorizationFailure(code) {
  if (['UNAUTHENTICATED', 'INVALID_TRUSTED_PRINCIPAL', 'PRINCIPAL_CAPABILITY_MISMATCH'].includes(code)) {
    return failure('UNAUTHENTICATED');
  }
  if (code === 'AUTH_NOT_CONFIGURED') return failure('AUTH_NOT_CONFIGURED');
  if (['RESOURCE_ID_REQUIRED', 'INVALID_RESOURCE_ID'].includes(code)) {
    return failure('INVALID_REQUEST');
  }
  if (['FORBIDDEN', 'RESOURCE_FORBIDDEN'].includes(code)) return failure('FORBIDDEN');
  return failure('INTERNAL_ERROR');
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareSchedule(left, right) {
  const leftTime = timestamp(left.planned_start);
  const rightTime = timestamp(right.planned_start);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
  return left.planned_start.localeCompare(right.planned_start) || left.id.localeCompare(right.id);
}

function controlledSummary(task) {
  const source = [task.core_brief_summary, task.legacy_deliver_text, task.name]
    .find(value => typeof value === 'string' && value.trim() !== '');
  if (!source) return null;
  return [...source.trim()].slice(0, 100).join('');
}

function projectTasks(scheduleItem, tasksBySchedule) {
  const tasks = tasksBySchedule.get(scheduleItem.id) ?? [];
  if (
    (scheduleItem.allocation_mode === 'single' && tasks.length !== 1)
    || (scheduleItem.allocation_mode === 'grouped_unallocated' && tasks.length < 2)
    || !['single', 'grouped_unallocated'].includes(scheduleItem.allocation_mode)
  ) return failure('INVALID_KIOSK_TASK_BINDINGS');

  const projected = [];
  let expectedOrder = 0;
  const taskIds = new Set();
  for (const task of tasks) {
    if (
      task.display_order !== expectedOrder
      || taskIds.has(task.id)
      || !validIdentifier(task.id)
      || typeof task.sku !== 'string'
      || [...task.sku].length < 1
      || [...task.sku].length > 120
      || !/\S/u.test(task.sku)
      || typeof task.name !== 'string'
      || [...task.name].length < 1
      || [...task.name].length > 240
      || !/\S/u.test(task.name)
    ) return failure('INVALID_KIOSK_TASK_FACT');
    const summary = controlledSummary(task);
    if (!summary) return failure('INVALID_KIOSK_TASK_FACT');
    const projectedTask = {
      id: task.id,
      sku: task.sku,
      name: task.name,
      summary,
    };
    if (task.hero_asset_id !== null && task.hero_asset_id !== undefined) {
      if (!validIdentifier(task.hero_asset_id)) return failure('INVALID_KIOSK_TASK_FACT');
      projectedTask.heroAssetId = task.hero_asset_id;
    }
    projected.push(projectedTask);
    taskIds.add(task.id);
    expectedOrder += 1;
  }
  return { ok: true, tasks: projected };
}

function projectItem(scheduleItem, run, tasksBySchedule) {
  const start = timestamp(scheduleItem.planned_start);
  const end = timestamp(scheduleItem.planned_end);
  if (
    !validIdentifier(scheduleItem.id)
    || start === null
    || end === null
    || end <= start
  ) return failure('INVALID_KIOSK_SCHEDULE_FACT');
  const taskProjection = projectTasks(scheduleItem, tasksBySchedule);
  if (!taskProjection.ok) return taskProjection;
  if (run && (
    !validIdentifier(run.id)
    || !ACTIVE_STATES.has(run.status)
    || !Number.isSafeInteger(run.run_revision)
    || run.run_revision < 1
  )) return failure('INVALID_KIOSK_RUN_FACT');
  if (run && (
    (scheduleItem.allocation_mode === 'single'
      && (run.scope !== 'task' || run.task_id !== taskProjection.tasks[0].id))
    || (scheduleItem.allocation_mode === 'grouped_unallocated'
      && (run.scope !== 'block' || run.task_id !== null))
  )) return failure('INVALID_KIOSK_RUN_SCOPE');

  const grouped = scheduleItem.allocation_mode === 'grouped_unallocated';
  return {
    ok: true,
    item: {
      scheduleItemId: scheduleItem.id,
      allocationMode: scheduleItem.allocation_mode,
      plannedStart: scheduleItem.planned_start,
      plannedEnd: scheduleItem.planned_end,
      runId: run?.id ?? null,
      runRevision: run?.run_revision ?? 0,
      runState: run?.status ?? 'scheduled',
      tasks: taskProjection.tasks,
      isGrouped: grouped,
      groupedNotice: grouped ? GROUPED_NOTICE : null,
    },
  };
}

function groupTasks(tasks, scheduleIds) {
  const grouped = new Map([...scheduleIds].map(id => [id, []]));
  for (const task of tasks) {
    if (!grouped.has(task.schedule_item_id)) return null;
    grouped.get(task.schedule_item_id).push(task);
  }
  for (const rows of grouped.values()) {
    rows.sort((left, right) => left.display_order - right.display_order || left.id.localeCompare(right.id));
  }
  return grouped;
}

export function buildKioskCurrentDto({ facts, resourceId, serverTime } = {}) {
  if (
    !facts
    || typeof facts !== 'object'
    || facts.resourceExists !== true
    || !Array.isArray(facts.scheduleItems)
    || !Array.isArray(facts.runs)
    || !Array.isArray(facts.tasks)
  ) return failure(facts?.resourceExists === false ? 'RESOURCE_NOT_FOUND' : 'KIOSK_CURRENT_FACTS_INVALID');
  if (!Number.isSafeInteger(facts.projectionRevision) || facts.projectionRevision < 0) {
    return failure('REVISION_COUNTERS_MISSING');
  }
  const now = timestamp(serverTime);
  if (now === null) return failure('INVALID_SERVER_TIME');

  const scheduleItems = [...facts.scheduleItems].sort(compareSchedule);
  const scheduleById = new Map();
  for (const schedule of scheduleItems) {
    const plannedStart = timestamp(schedule.planned_start);
    const plannedEnd = timestamp(schedule.planned_end);
    if (
      scheduleById.has(schedule.id)
      || schedule.resource_id !== resourceId
      || schedule.resource_resolution_status !== 'resolved'
      || plannedStart === null
      || plannedEnd === null
      || plannedEnd <= plannedStart
      || !['draft', 'confirmed', 'cancelled'].includes(schedule.schedule_status)
      || !['single', 'grouped_unallocated'].includes(schedule.allocation_mode)
    ) return failure('INVALID_KIOSK_SCHEDULE_FACT');
    scheduleById.set(schedule.id, schedule);
  }

  const runsBySchedule = new Map([...scheduleById.keys()].map(id => [id, []]));
  const runIds = new Set();
  for (const run of facts.runs) {
    if (!scheduleById.has(run.schedule_item_id) || runIds.has(run.id)) {
      return failure('INVALID_KIOSK_RUN_FACT');
    }
    runsBySchedule.get(run.schedule_item_id).push(run);
    runIds.add(run.id);
  }
  const tasksBySchedule = groupTasks(facts.tasks, scheduleById.keys());
  if (!tasksBySchedule) return failure('INVALID_KIOSK_TASK_FACT');

  const activeRuns = facts.runs.filter(run => ACTIVE_STATES.has(run.status));
  if (activeRuns.length > 1) return failure('MULTIPLE_ACTIVE_RUNS');

  let currentSchedule = null;
  let currentRun = null;
  if (activeRuns.length === 1) {
    currentRun = activeRuns[0];
    currentSchedule = scheduleById.get(currentRun.schedule_item_id);
  } else {
    const currentCandidates = scheduleItems.filter(schedule => (
      schedule.schedule_status === 'confirmed'
      && runsBySchedule.get(schedule.id).length === 0
      && timestamp(schedule.planned_start) !== null
      && timestamp(schedule.planned_end) !== null
      && timestamp(schedule.planned_start) <= now
      && now < timestamp(schedule.planned_end)
    ));
    if (currentCandidates.length > 1) return failure('MULTIPLE_CURRENT_CANDIDATES');
    currentSchedule = currentCandidates[0] ?? null;
  }

  const futureCandidates = scheduleItems.filter(schedule => (
    schedule.schedule_status === 'confirmed'
    && runsBySchedule.get(schedule.id).length === 0
    && timestamp(schedule.planned_start) !== null
    && timestamp(schedule.planned_start) > now
  ));
  let nextSchedule = null;
  if (futureCandidates.length > 0) {
    const earliestStart = timestamp(futureCandidates[0].planned_start);
    if (futureCandidates.filter(schedule => timestamp(schedule.planned_start) === earliestStart).length > 1) {
      return failure('MULTIPLE_NEXT_CANDIDATES');
    }
    nextSchedule = futureCandidates[0];
  }

  const currentProjection = currentSchedule
    ? projectItem(currentSchedule, currentRun, tasksBySchedule)
    : { ok: true, item: null };
  if (!currentProjection.ok) return currentProjection;
  const nextProjection = nextSchedule
    ? projectItem(nextSchedule, null, tasksBySchedule)
    : { ok: true, item: null };
  if (!nextProjection.ok) return nextProjection;

  const dto = {
    schemaVersion: 2,
    serverTime,
    projectionRevision: facts.projectionRevision,
    resourceId,
    current: currentProjection.item,
    next: nextProjection.item,
  };
  const relationships = validateKioskCurrentRelationships(dto);
  if (!relationships.ok) {
    return failure(relationships.issues[0]?.code ?? 'KIOSK_CURRENT_CONTRACT_INVALID');
  }
  return Object.freeze({ ok: true, dto });
}

export function createReadKioskCurrent({
  store,
  clock,
  authorize = authorizeCapability,
} = {}) {
  if (!store || typeof store.readResourceFacts !== 'function') {
    throw new TypeError('store with readResourceFacts is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock is required');
  if (typeof authorize !== 'function') throw new TypeError('authorize is required');

  return function readKioskCurrent({ principal, resourceId } = {}) {
    const authorization = authorize({ principal, capability: 'readSchedule', resourceId });
    if (!authorization?.allowed) return normalizeAuthorizationFailure(authorization?.code);
    let serverTime;
    try {
      serverTime = clock()?.toISOString?.();
    } catch {
      return failure('INVALID_SERVER_TIME');
    }
    if (typeof serverTime !== 'string' || timestamp(serverTime) === null) {
      return failure('INVALID_SERVER_TIME');
    }
    let facts;
    try {
      facts = store.readResourceFacts(resourceId);
    } catch {
      return failure('INTERNAL_ERROR');
    }
    // A validated trusted principal's resource scope is the authority that the
    // resource exists. Schedule rows are mutable workload facts and cannot act
    // as the resource registry; a known resource may legitimately be empty.
    const built = buildKioskCurrentDto({
      facts: { ...facts, resourceExists: true },
      resourceId,
      serverTime,
    });
    if (built.ok || PUBLIC_CURRENT_FAILURES.has(built.code)) return built;
    return failure('INTERNAL_ERROR');
  };
}
