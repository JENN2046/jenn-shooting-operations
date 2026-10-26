import {validateDynamicReceiptRow} from './dynamic-day-adjustment-v1.mjs';

// Shared read model only; callers select order rows and resource scope. Never grants authority.
export function readSchedulingBoardFacts({db, resourceIds, orderRows}) {
      // Confirmed estimates live in immutable adjustment receipts, independently of the plan.
      // Revision ordering remains deterministic even when multiple confirmations share a clock tick.
      const forecasts=new Map();
      for(const row of db.prepare(`SELECT r.* FROM schedule_reschedule_operations r
        JOIN operations o ON o.operation_id=r.operation_id WHERE o.kind='dynamicDayAdjustment'`).all()) {
        if(!resourceIds.includes(row.resource_id))continue;
        const receipt=validateDynamicReceiptRow(row),input=receipt.preview.input;
        if(input.mode!=='forecast')continue;
        const prior=forecasts.get(input.scheduleItemId);
        if(!prior||receipt.scheduleRevision>prior.scheduleRevision)forecasts.set(input.scheduleItemId,{
          estimatedEnd:input.endAt,bufferAfterMinutes:input.bufferAfterMinutes,
          confirmedAt:receipt.createdAt,operationId:receipt.operationId,scheduleRevision:receipt.scheduleRevision});
      }
      const orderFacts=orderRows.map(r=>({references:db.prepare("SELECT id,original_name AS name,content_type AS contentType,size FROM uploads WHERE claimed_task_id=? AND kind='image' ORDER BY claimed_order,id").all(r.id),id:r.id,name:r.name,client:r.client,kind:r.kind,shootingSubtype:r.shooting_subtype,lifecycle:r.request_lifecycle,
        editable:r.request_lifecycle==='open'&&!db.prepare('SELECT 1 FROM schedule_item_tasks WHERE task_id=?').get(r.id)&&!db.prepare('SELECT 1 FROM production_runs WHERE task_id=?').get(r.id),
        submission:{schemaVersion:3,productionType:r.production_type,sku:r.sku,name:r.name,kind:r.kind,shootingSubtype:r.shooting_subtype,aspectRatio:r.aspect_ratio,
          deliverables:{type:'flat',count:r.deliverable_count},requestedBy:r.requested_by,desiredDate:r.desired_date,note:r.note??'',coreBriefSummary:r.core_brief_summary??'',sampleStatus:r.sample_status,lightingPreset:r.lighting_preset,reflectivity:r.reflectivity,priority:r.priority,uploadIds:[]}}));
      return {orderFacts, sessions: db.prepare(`SELECT id, resource_id AS resourceId, planned_start AS plannedStart, planned_end AS plannedEnd,
          buffer_after_minutes AS bufferAfterMinutes, schedule_status AS status, lock_status AS lockStatus,
          resource_resolution_status AS resourceResolutionStatus, allocation_mode AS allocationMode,
          legacy_place_text AS legacyPlaceText, note,
          EXISTS(SELECT 1 FROM production_runs r WHERE r.schedule_item_id=s.id) AS hasRunHistory
          FROM schedule_items s ORDER BY planned_start,id`).all().filter(s => resourceIds.includes(s.resourceId)).map(s=>({...s,requestIds:db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=? ORDER BY display_order').all(s.id).map(r=>r.task_id),confirmedForecast:forecasts.get(s.id)??null,runs:db.prepare('SELECT id,status,run_revision AS runRevision,started_at AS startedAt,completed_at AS completedAt FROM production_runs WHERE schedule_item_id=? ORDER BY created_at,id').all(s.id),requestNames:db.prepare('SELECT r.name FROM schedule_item_tasks b JOIN requests_v2 r ON r.id=b.task_id WHERE b.schedule_item_id=? ORDER BY b.display_order').all(s.id).map(r=>r.name)}))};
}

// Fixed daily Jenn scope. Only non-cancelled scheduled orders are public.
export function readPublicSchedulingBoard(db) {
 db.exec('BEGIN');
 try {
  const orderRows=db.prepare(`SELECT r.* FROM requests_v2 r WHERE r.request_lifecycle!='cancelled' AND EXISTS (
   SELECT 1 FROM schedule_item_tasks t JOIN schedule_items s ON s.id=t.schedule_item_id
   WHERE t.task_id=r.id AND s.resource_id='Jenn' AND s.resource_resolution_status='resolved'
   AND s.schedule_status='confirmed') ORDER BY r.source_ordinal`).all();
  const facts=readSchedulingBoardFacts({db,resourceIds:['Jenn'],orderRows});
  const orderFacts=facts.orderFacts.map(({id,name,client,kind,shootingSubtype,lifecycle,submission,references})=>
   ({id,name,client,kind,shootingSubtype,lifecycle,submission,references}));
  const visibleSessions=new Set(db.prepare("SELECT id FROM schedule_items WHERE resource_id='Jenn' AND resource_resolution_status='resolved' AND schedule_status='confirmed'").all().map(s=>s.id));
  const sessions=facts.sessions.filter(s=>visibleSessions.has(s.id)&&s.requestIds.some(id=>orderFacts.some(r=>r.id===id))).map(s=>({
   id:s.id,resourceId:s.resourceId,plannedStart:s.plannedStart,plannedEnd:s.plannedEnd,
   bufferAfterMinutes:s.bufferAfterMinutes,status:s.status,requestIds:s.requestIds.filter(id=>orderFacts.some(r=>r.id===id)),
   runs:s.runs.map(({status,startedAt,completedAt})=>({status,startedAt,completedAt})),
   confirmedForecast:s.confirmedForecast?{estimatedEnd:s.confirmedForecast.estimatedEnd,bufferAfterMinutes:s.confirmedForecast.bufferAfterMinutes}:null
  }));
  const revisions=db.prepare('SELECT projection_revision AS projectionRevision FROM revision_counters WHERE id=1').get();
  return {ok:true,protocolVersion:3,revisions,orderFacts,sessions};
 } finally {db.exec('ROLLBACK');}
}
