export function createSqliteKioskCurrentStore({ db } = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('SQLite database is required');
  }

  return Object.freeze({
    readResourceFacts(resourceId) {
      let inTransaction = false;
      try {
        db.exec('BEGIN');
        inTransaction = true;
        const scheduleItems = db.prepare(`
          SELECT id, resource_id, resource_resolution_status, planned_start, planned_end,
                 schedule_status, allocation_mode
          FROM schedule_items
          WHERE resource_id = ?
          ORDER BY planned_start, id
        `).all(resourceId);
        const runs = db.prepare(`
          SELECT run.id, run.schedule_item_id, run.scope, run.task_id,
                 run.status, run.run_revision
          FROM production_runs AS run
          JOIN schedule_items AS item ON item.id = run.schedule_item_id
          WHERE item.resource_id = ?
          ORDER BY run.created_at, run.id
        `).all(resourceId);
        const tasks = db.prepare(`
          SELECT binding.schedule_item_id, binding.display_order,
                 request.id, request.sku, request.name, request.legacy_deliver_text,
                 request.core_brief_summary, request.hero_asset_id
          FROM schedule_item_tasks AS binding
          JOIN schedule_items AS item ON item.id = binding.schedule_item_id
          JOIN requests_v2 AS request ON request.id = binding.task_id
          WHERE item.resource_id = ?
          ORDER BY binding.schedule_item_id, binding.display_order, request.id
        `).all(resourceId);
        const counter = db.prepare(`
          SELECT projection_revision FROM revision_counters WHERE id = 1
        `).get() ?? null;
        db.exec('COMMIT');
        inTransaction = false;
        return {
          projectionRevision: counter?.projection_revision ?? null,
          scheduleItems,
          runs,
          tasks,
        };
      } catch (error) {
        if (inTransaction) {
          try { db.exec('ROLLBACK'); } catch {}
        }
        throw error;
      }
    },
  });
}
