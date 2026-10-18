const date=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function readFieldDay({db,identity,clock,writeAdmissionControl,protocolVersion=3}){
   if(db.prepare('SELECT status FROM scheduling_resources WHERE resource_id=?').get(identity.resourceId)?.status!=='active')return {ok:false,code:'FORBIDDEN'};
   const now=clock().toISOString(),today=date(now);
   // Indexed textual date bounds cover timezone offsets; julianday applies the exact Beijing window.
   const start=Date.parse(today+'T00:00:00+08:00'),end=start+86400000;
   const lower=new Date(start-86400000).toISOString().slice(0,10),upper=new Date(end+2*86400000).toISOString().slice(0,10);
   const revisions=db.prepare('SELECT schedule_revision AS scheduleRevision,projection_revision AS projectionRevision FROM revision_counters WHERE id=1').get();
   // CROSS JOIN keeps the active-run partial index driving the cross-day branch, not historical sessions.
   const sessions=db.prepare(`SELECT id,planned_start AS plannedStart,planned_end AS plannedEnd,allocation_mode AS allocationMode FROM schedule_items
     WHERE id IN (
       SELECT id FROM schedule_items WHERE resource_id=? AND schedule_status='confirmed' AND resource_resolution_status='resolved'
         AND planned_start>=? AND planned_start<? AND julianday(planned_start)>=julianday(?) AND julianday(planned_start)<julianday(?)
       UNION
       SELECT s.id FROM production_runs r INDEXED BY production_runs_one_active_per_item_uq CROSS JOIN schedule_items s ON s.id=r.schedule_item_id
         WHERE r.status IN ('scheduled','shooting','blocked') AND r.status IN ('shooting','blocked')
           AND s.resource_id=? AND s.schedule_status='confirmed' AND s.resource_resolution_status='resolved'
     ) ORDER BY planned_start,id`).all(identity.resourceId,lower,upper,new Date(start).toISOString(),new Date(end).toISOString(),identity.resourceId).map(s=>{
    const runs=db.prepare('SELECT id,status,run_revision AS runRevision,started_at AS startedAt,completed_at AS completedAt FROM production_runs WHERE schedule_item_id=? ORDER BY created_at,id').all(s.id);
    const tasks=db.prepare('SELECT r.id,r.sku,r.name,r.kind,r.shooting_subtype AS shootingSubtype FROM schedule_item_tasks b JOIN requests_v2 r ON r.id=b.task_id WHERE b.schedule_item_id=? ORDER BY b.display_order').all(s.id);
    const supported=s.allocationMode==='single'&&tasks.length===1&&runs.length<=1;
    return {...s,tasks,run:runs.length===1?runs[0]:null,state:runs.length===1?runs[0].status:runs.length?'unsupported':'scheduled',supported};
   }).filter(s=>date(s.plannedStart)===today||['shooting','blocked'].includes(s.state));
   const live=sessions.filter(s=>['shooting','blocked'].includes(s.state));
   const current=live.length===1?live[0]:live.length?null:sessions.find(s=>s.state==='scheduled'&&Date.parse(s.plannedStart)<=Date.parse(now)&&Date.parse(now)<Date.parse(s.plannedEnd))??null;
   return {ok:true,protocolVersion,subjectId:identity.principal.subjectId,role:identity.principal.role,deviceId:identity.deviceId,resourceId:identity.resourceId,today,serverTime:now,revisions,sessions,currentId:current?.id??null,conflict:live.length>1,writeAdmission:writeAdmissionControl.status().mode};
}
