const SURFACES = Object.freeze([
  Object.freeze({ family: 'operation', table: 'operations', column: 'operation_id' }),
  Object.freeze({ family: 'admin', table: 'scheduling_admin_operations', column: 'operation_id' }),
  Object.freeze({ family: 'proposalGeneration', table: 'scheduling_proposals', column: 'generation_operation_id' }),
  Object.freeze({ family: 'proposalDecision', table: 'scheduling_proposal_decisions', column: 'decision_id' }),
  Object.freeze({ family: 'reschedule', table: 'schedule_reschedule_operations', column: 'operation_id' }),
]);

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table));
}

export function schedulingOperationIdOwnersV1(db, operationId) {
  if (!db || typeof operationId !== 'string' || operationId.length === 0) {
    throw new TypeError('database and operation id required');
  }
  const owners = [];
  for (const surface of SURFACES) {
    if (!tableExists(db, surface.table)) continue;
    const row = db.prepare(`SELECT 1 FROM "${surface.table}" WHERE "${surface.column}" = ? LIMIT 1`).get(operationId);
    if (row) owners.push(surface.family);
  }
  return Object.freeze(owners);
}

export function schedulingOperationIdOwnedByOtherV1(db, operationId, allowedFamilies = []) {
  const allowed = new Set(allowedFamilies);
  return schedulingOperationIdOwnersV1(db, operationId).some(family => !allowed.has(family));
}
