// Called only inside the authenticated agent's scoped read transaction.
// Unassigned orders belong to the whole catalogue, so require every registered resource.
export function readAgentBusinessFactsV3(db, scope) {
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()) return {};
  const all = db.prepare('SELECT resource_id FROM scheduling_resources').all();
  const catalogue = all.length > 0 && all.every(r => scope.includes(r.resource_id));
  const orders = db.prepare(`SELECT id,name,kind,shooting_subtype AS shootingSubtype,
    request_lifecycle AS lifecycle,sample_status AS sampleStatus,priority,desired_date AS desiredDate
    FROM requests_v2 ORDER BY source_ordinal`).all().filter(order => {
    const assignments = db.prepare(`SELECT s.resource_id,s.resource_resolution_status
      FROM schedule_item_tasks b JOIN schedule_items s ON s.id=b.schedule_item_id WHERE b.task_id=?`).all(order.id);
    return assignments.length ? assignments.every(s => s.resource_resolution_status === 'resolved' && scope.includes(s.resource_id)) : catalogue;
  });
  const sessions = db.prepare(`SELECT id,resource_id AS resourceId FROM schedule_items ORDER BY planned_start,id`).all()
    .filter(s => scope.includes(s.resourceId));
  const progress = sessions.map(s => ({ scheduleItemId:s.id,
    requestIds:db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=? ORDER BY display_order').all(s.id).map(r=>r.task_id),
    runs:db.prepare(`SELECT id,status,run_revision AS runRevision,started_at AS startedAt,completed_at AS completedAt
      FROM production_runs WHERE schedule_item_id=? ORDER BY created_at,id`).all(s.id) }));
  return {businessSchemaVersion:12, orders, progress, unassignedOrdersIncluded:catalogue};
}
