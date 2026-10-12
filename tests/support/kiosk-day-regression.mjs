// Synthetic DB seeding for query boundaries; never invoked against production.
export function seedKioskDayRegression(db){
 const template=db.prepare('SELECT * FROM schedule_items ORDER BY planned_start,id LIMIT 1').get();
 const task=db.prepare('SELECT * FROM schedule_item_tasks WHERE schedule_item_id=? LIMIT 1').get(template.id);
 let ordinal=db.prepare('SELECT max(source_ordinal) n FROM schedule_items').get().n+1;
 const clone=(id,start,mode='single',resource=template.resource_id)=>{
  const row={...template,id,source_ordinal:ordinal++,planned_start:start,planned_end:new Date(Date.parse(start)+1800000).toISOString(),allocation_mode:mode,resource_id:resource};
  const keys=Object.keys(row);db.prepare(`INSERT INTO schedule_items (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
  db.prepare('INSERT INTO schedule_item_tasks(schedule_item_id,task_id,display_order,created_at,imported_at) VALUES(?,?,?,?,?)').run(id,task.task_id,0,task.created_at,task.imported_at);
 };
 db.exec('BEGIN');try{
  for(let i=0;i<300;i++)clone(`HISTORY-${i}`,'2025-10-12T01:00:00.000Z');
  clone('BEFORE-BEIJING-DAY','2026-10-11T15:59:59.999Z');
  clone('START-BEIJING-DAY','2026-10-12T00:00:00+08:00');
  clone('END-BEIJING-DAY','2026-10-12T16:00:00.000Z');
  clone('OFFSET-GROUPED-DAY','2026-10-13T00:00:00+09:00','grouped_unallocated');
  clone('OTHER-RESOURCE-DAY','2026-10-12T01:00:00.000Z','single','OTHER-RESOURCE');
  for(const status of ['shooting','blocked']){
   const id=`CROSS-DAY-${status}`;clone(id,'2026-10-10T01:00:00.000Z');
   db.prepare(`INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,started_at,created_at,updated_at)
    VALUES(?,?,'task',?,?,1,'2026-10-10T01:00:00.000Z','2026-10-10T01:00:00.000Z','2026-10-10T01:00:00.000Z')`).run(`RUN-${id}`,id,task.task_id,status);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return ['START-BEIJING-DAY','OFFSET-GROUPED-DAY','CROSS-DAY-shooting','CROSS-DAY-blocked'];
}
