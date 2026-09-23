function issue(code, path) {
  return { code, path };
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateSlotRange(slot, path, issues) {
  if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) return null;
  const start = timestamp(slot.plannedStart);
  const end = timestamp(slot.plannedEnd);
  if (start === null) issues.push(issue('INVALID_KIOSK_TIMESTAMP', `${path}/plannedStart`));
  if (end === null) issues.push(issue('INVALID_KIOSK_TIMESTAMP', `${path}/plannedEnd`));
  if (start !== null && end !== null && end <= start) {
    issues.push(issue('INVALID_PLANNED_RANGE', `${path}/plannedEnd`));
  }
  return { start, end };
}

function validateTaskIdentities(slot, path, issues) {
  if (slot === null || typeof slot !== 'object' || Array.isArray(slot) || !Array.isArray(slot.tasks)) return;
  const seen = new Set();
  for (let index = 0; index < slot.tasks.length; index += 1) {
    const taskId = slot.tasks[index]?.id;
    if (typeof taskId === 'string' && seen.has(taskId)) {
      issues.push(issue('DUPLICATE_KIOSK_TASK', `${path}/tasks/${index}/id`));
    }
    if (typeof taskId === 'string') seen.add(taskId);
  }
}

export function validateKioskCurrentRelationships(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [issue('INVALID_KIOSK_CURRENT_DTO', '/')] };
  }

  const issues = [];
  const serverTime = timestamp(value.serverTime);
  if (serverTime === null) issues.push(issue('INVALID_KIOSK_TIMESTAMP', '/serverTime'));

  const currentRange = validateSlotRange(value.current, '/current', issues);
  const nextRange = validateSlotRange(value.next, '/next', issues);
  validateTaskIdentities(value.current, '/current', issues);
  validateTaskIdentities(value.next, '/next', issues);

  if (currentRange && serverTime !== null && value.current.runId === null
      && (currentRange.start === null || currentRange.end === null
        || currentRange.start > serverTime || serverTime >= currentRange.end)) {
    issues.push(issue('CURRENT_CANDIDATE_OUTSIDE_WINDOW', '/current'));
  }

  if (nextRange && serverTime !== null
      && (nextRange.start === null || nextRange.start <= serverTime)) {
    issues.push(issue('NEXT_CANDIDATE_NOT_FUTURE', '/next/plannedStart'));
  }

  if (value.current && value.next) {
    if (value.current.scheduleItemId === value.next.scheduleItemId) {
      issues.push(issue('DUPLICATE_KIOSK_SLOT', '/next/scheduleItemId'));
    }
    if (currentRange && nextRange && currentRange.end !== null && nextRange.start !== null
        && nextRange.start < currentRange.end) {
      issues.push(issue('KIOSK_SLOT_ORDER_CONFLICT', '/next/plannedStart'));
    }
  }

  return { ok: issues.length === 0, issues };
}
