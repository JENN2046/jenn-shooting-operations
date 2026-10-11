import { canonicalJsonSchedulingV1 as json, digestCanonicalJsonSchedulingV1 as digest, isSchedulingIdentifierV1 as identifier } from './scheduling-contract-v1.mjs';
import { compileSchedulingCalendarDate, normalizeSchedulingConfig } from './scheduling-admin-contract-v2.mjs';
import { validateTrustedPrincipal } from './authorization-v2.mjs';
import { assertSchedulingQuiescenceV1, assertGf15CommandPacketV1 } from './sqlite-scheduling-quiescence-v1.mjs';
import { staleDraftProposalsInTransactionV1 } from './sqlite-scheduling-proposal-store-v1.mjs';
import { schedulingOperationIdOwnedByOtherV1 } from './sqlite-scheduling-operation-id-v1.mjs';

const fail=code=>({ok:false,code});
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const date=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const state=r=>({scheduleItemId:r.id,plannedStart:r.planned_start,plannedEnd:r.planned_end,bufferAfterMinutes:r.buffer_after_minutes,bufferSource:r.buffer_source});
const allowed=(p,id)=>validateTrustedPrincipal(p).ok&&p.role==='administrator'&&p.resourceIds.includes(id);
function validInput(v){return exact(v,['scheduleItemId','resourceId','mode','plannedStart','endAt','bufferAfterMinutes'])
  &&identifier(v.scheduleItemId)&&identifier(v.resourceId)&&['plan','forecast'].includes(v.mode)
  &&iso(v.endAt)&&(v.mode==='forecast'?v.plannedStart===null:iso(v.plannedStart)&&v.plannedStart<v.endAt)
  &&Number.isSafeInteger(v.bufferAfterMinutes)&&v.bufferAfterMinutes>=0&&v.bufferAfterMinutes<=1440;}

// A bounded, manual day adjustment. Estimates are receipt facts, never run events.
export function createDynamicDayAdjustment({db,now,refreshProjections,writeAdmission}) {
  function calculate(input,principal){
    if(!validInput(input))return fail('DYNAMIC_INPUT_INVALID');
    if(!allowed(principal,input.resourceId))return fail('FORBIDDEN');
    const at=now().toISOString(),today=date(at);
    if(date(input.endAt)!==today||input.endAt<=at||(input.mode==='plan'&&(date(input.plannedStart)!==today||input.plannedStart<=at)))return fail('DYNAMIC_TODAY_ONLY');
    const revisions=db.prepare('SELECT * FROM revision_counters WHERE id=1').get();
    const active=db.prepare(`SELECT v.* FROM scheduling_active_config a JOIN scheduling_config_versions v ON v.config_version=a.config_version WHERE a.id=1`).get();
    const resource=db.prepare('SELECT * FROM scheduling_resources WHERE resource_id=?').get(input.resourceId);
    if(!revisions||!active||resource?.status!=='active')return fail('DYNAMIC_CONFIG_REQUIRED');
    const normalized=normalizeSchedulingConfig(JSON.parse(active.config_json));
    if(!normalized.ok||normalized.configDigest!==active.config_digest||normalized.config.businessTimeZone!=='Asia/Shanghai')return fail('DYNAMIC_CONFIG_INVALID');
    const calendar=normalized.config.resourceCalendars.find(c=>c.resourceId===input.resourceId);
    if(calendar?.capabilityDigest!==resource.capability_digest)return fail('DYNAMIC_CONFIG_INVALID');
    const compiled=compileSchedulingCalendarDate({configJson:normalized.config,resourceId:input.resourceId,date:today,calendarCompilerVersion:active.calendar_compiler_version,timeZoneDataVersion:process.versions.tz});
    if(!compiled.ok)return compiled;
    const rows=db.prepare(`SELECT * FROM schedule_items WHERE schedule_status<>'cancelled' AND (resource_id=? OR resource_resolution_status='unresolved') ORDER BY planned_start,id`).all(input.resourceId);
    if(rows.some(r=>r.resource_resolution_status!=='resolved'||!iso(r.planned_start)||!iso(r.planned_end)||r.planned_end<=r.planned_start||!Number.isSafeInteger(r.buffer_after_minutes)||r.buffer_after_minutes<0))return fail('DYNAMIC_OCCUPANCY_UNKNOWN');
    const anchor=rows.find(r=>r.id===input.scheduleItemId&&r.resource_id===input.resourceId);
    if(!anchor||!iso(anchor.planned_start)||date(anchor.planned_start)!==today)return fail('DYNAMIC_ANCHOR_NOT_FOUND');
    const ids=new Set(rows.map(r=>r.id));
    const runs=db.prepare('SELECT * FROM production_runs ORDER BY id').all().filter(r=>ids.has(r.schedule_item_id));
    const bindings=db.prepare(`SELECT b.*,r.request_lifecycle FROM schedule_item_tasks b JOIN requests_v2 r ON r.id=b.task_id ORDER BY b.schedule_item_id,b.display_order`).all().filter(r=>ids.has(r.schedule_item_id));
    const notifications=db.prepare(`SELECT * FROM notification_outbox WHERE aggregate_type='schedule_item' AND intent_type='schedule.confirmed.v1' AND status IN ('pending','retryableFailed','leased') ORDER BY outbox_id`).all().filter(r=>ids.has(r.aggregate_id));
    const rowRuns=r=>runs.filter(x=>x.schedule_item_id===r.id);
    const movable=r=>r.lock_status==='unlocked'&&r.allocation_mode==='single'&&r.resource_resolution_status==='resolved'
      &&r.planned_start>at&&!rowRuns(r).length&&bindings.filter(b=>b.schedule_item_id===r.id).length===1
      &&bindings.filter(b=>b.schedule_item_id===r.id).every(b=>b.request_lifecycle==='open')&&!notifications.some(n=>n.aggregate_id===r.id);
    if(input.mode==='plan'&&!movable(anchor))return fail('DYNAMIC_ANCHOR_IMMUTABLE');
    if(input.mode==='forecast'&&(anchor.planned_start>at||rowRuns(anchor).length!==1||rowRuns(anchor).some(r=>!['shooting','blocked'].includes(r.status))))return fail('DYNAMIC_FORECAST_NOT_CURRENT');
    const unresolved=[],warnings=[],changes=[],fixed=[];
    if(rows.some(r=>r.resource_resolution_status!=='resolved'||!iso(r.planned_start)||!iso(r.planned_end)||r.planned_end<=r.planned_start||!Number.isSafeInteger(r.buffer_after_minutes)))unresolved.push({code:'UNKNOWN_OCCUPANCY'});
    const windows=compiled.windows.map(w=>({start:Date.parse(w.start),end:Date.parse(w.end)}));
    const fits=(s,e)=>windows.some(w=>s>=w.start&&e<=w.end);
    const index=rows.indexOf(anchor),suffix=rows.slice(index+1).filter(r=>iso(r.planned_start)&&date(r.planned_start)===today);
    const end=Date.parse(input.endAt)+input.bufferAfterMinutes*60000;
    const start=Date.parse(input.mode==='plan'?input.plannedStart:anchor.planned_start);
    if(!fits(start,end)){if(input.mode==='forecast')warnings.push({code:'FORECAST_OUTSIDE_DEFAULT_WINDOW',scheduleItemId:anchor.id});else unresolved.push({code:'ANCHOR_OUTSIDE_WORK_WINDOW',scheduleItemId:anchor.id});}
    // Preserve both planned occupancy and known actual completion. A past plan
    // without completed execution evidence does not prove the resource is free.
    const release=r=>{
      const history=rowRuns(r),planned=Date.parse(r.planned_end)+r.buffer_after_minutes*60000;
      const began=r.planned_start<=at;
      if(history.some(x=>['shooting','blocked'].includes(x.status))||(began&&(history.length!==1||history[0].status!=='completed'||!iso(history[0].completed_at)))){
        unresolved.push({code:'OTHER_RUN_END_UNKNOWN',scheduleItemId:r.id});return planned;
      }
      return history.length===1&&history[0].status==='completed'&&iso(history[0].completed_at)
        ?Math.max(planned,Date.parse(history[0].completed_at)+r.buffer_after_minutes*60000):planned;
    };
    for(const r of rows.filter(r=>r!==anchor&&!suffix.includes(r))){
      const occupiedEnd=release(r);
      if(rows.indexOf(r)<index&&date(r.planned_start)===today&&start<occupiedEnd)unresolved.push({code:'PREDECESSOR_ORDER_CONFLICT',scheduleItemId:r.id});
      if(Date.parse(r.planned_start)<end&&occupiedEnd>start)unresolved.push({code:'ANCHOR_FIXED_CONFLICT',scheduleItemId:r.id});
      fixed.push({start:Date.parse(r.planned_start),end:occupiedEnd});
    }
    if(input.mode==='plan')changes.push({before:state(anchor),after:{...state(anchor),plannedStart:input.plannedStart,plannedEnd:input.endAt,bufferAfterMinutes:input.bufferAfterMinutes,bufferSource:'owner-single-adjustment-v1'}});
    let cursor=end;
    for(const r of suffix){
      const before=state(r),originalStart=Date.parse(r.planned_start),duration=Date.parse(r.planned_end)-originalStart,total=duration+r.buffer_after_minutes*60000;
      if(!movable(r)){
        const occupiedEnd=release(r);
        if(originalStart<cursor||(r.planned_start<=at&&!rowRuns(r).length)||rowRuns(r).some(x=>['shooting','blocked'].includes(x.status)))unresolved.push({code:'FIXED_SUCCESSOR_CONFLICT',scheduleItemId:r.id});
        cursor=Math.max(cursor,occupiedEnd);continue;
      }
      let selected=null;
      for(const w of windows){let candidate=Math.max(cursor,originalStart,w.start);
        for(const f of fixed.filter(f=>f.end>candidate&&f.start<w.end).sort((a,b)=>a.start-b.start))if(candidate<f.end&&candidate+total>f.start)candidate=f.end;
        if(candidate+total<=w.end){selected=candidate;break;}}
      if(selected===null){unresolved.push({code:'NO_ROOM_TODAY',scheduleItemId:r.id});cursor=Infinity;continue;}
      const after={...before,plannedStart:new Date(selected).toISOString(),plannedEnd:new Date(selected+duration).toISOString()};
      if(json(before)!==json(after))changes.push({before,after});
      cursor=selected+total;
    }
    const snapshotDigest=digest(JSON.parse(JSON.stringify({revisions,active,resource,rows,runs,bindings,notifications})));
    const preview={version:1,kind:'dynamic-day-adjustment',input,today,snapshotDigest,configDigest:active.config_digest,configVersion:active.config_version,
      expectedScheduleRevision:revisions.schedule_revision,expectedProjectionRevision:revisions.projection_revision,
      forecast:input.mode==='forecast'?{source:'owner-estimate',scheduleItemId:anchor.id,estimatedEnd:input.endAt,bufferAfterMinutes:input.bufferAfterMinutes,actualFactsChanged:false}:null,
      changes,unresolved,warnings,canApply:unresolved.length===0};
    return {ok:true,preview,previewDigest:digest(preview)};
  }
  return {
    preview(input,principal){db.exec('BEGIN');try{const result=calculate(input,principal);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},
    apply(command,principal){
      if(!exact(command,['operationId','input','previewDigest'])||!identifier(command.operationId)||!validInput(command.input)||!/^sha256:[a-f0-9]{64}$/.test(command.previewDigest))return fail('DYNAMIC_COMMAND_INVALID');
      if(!allowed(principal,command.input.resourceId))return fail('FORBIDDEN');
      if(!writeAdmission())return fail('WRITE_ADMISSION_DISABLED');
      const commandDigest=digest({domain:'dynamic-day-adjustment-v1',command});
      db.exec('BEGIN IMMEDIATE');
      try{
        assertSchedulingQuiescenceV1({db,now});assertGf15CommandPacketV1(db,command,null);
        const prior=db.prepare('SELECT * FROM schedule_reschedule_operations WHERE operation_id=?').get(command.operationId);
        if(prior){
          if(prior.command_digest!==commandDigest||prior.actor_id!==principal.subjectId){db.exec('ROLLBACK');return fail('IDEMPOTENCY_KEY_REUSE');}
          const receipt=validateDynamicReceiptRow(prior);
          db.exec('COMMIT');return {ok:true,receipt,exactReplay:true};
        }
        if(schedulingOperationIdOwnedByOtherV1(db,command.operationId,[])){db.exec('ROLLBACK');return fail('IDEMPOTENCY_KEY_REUSE');}
        const calculated=calculate(command.input,principal);
        if(!calculated.ok||calculated.previewDigest!==command.previewDigest){db.exec('ROLLBACK');return fail('DYNAMIC_PREVIEW_CHANGED');}
        const p=calculated.preview;
        if(!p.canApply){db.exec('ROLLBACK');return {ok:false,code:'DYNAMIC_UNRESOLVED',unresolved:p.unresolved};}
        const scheduleRevision=p.expectedScheduleRevision+1,projectionRevision=p.expectedProjectionRevision+1,at=now().toISOString();
        if(!Number.isSafeInteger(scheduleRevision)||!Number.isSafeInteger(projectionRevision))throw new Error('SCHEDULE_REVISION_EXHAUSTED');
        for(const {after} of p.changes)db.prepare('UPDATE schedule_items SET planned_start=?,planned_end=?,buffer_after_minutes=?,buffer_source=?,business_updated_at=? WHERE id=?').run(after.plannedStart,after.plannedEnd,after.bufferAfterMinutes,after.bufferSource,at,after.scheduleItemId);
        if(db.prepare('UPDATE revision_counters SET schedule_revision=?,projection_revision=?,updated_at=? WHERE id=1 AND schedule_revision=? AND projection_revision=?').run(scheduleRevision,projectionRevision,at,p.expectedScheduleRevision,p.expectedProjectionRevision).changes!==1)throw new Error('SCHEDULING_REVISION_CONFLICT');
        staleDraftProposalsInTransactionV1({db,triggerOperationId:command.operationId,reasonCode:'SCHEDULE_REVISION_CHANGED',now});
        refreshProjections({db,scheduleRevision,projectionRevision,updatedAt:at});
        const receipt={schemaVersion:2,kind:'dynamic-day-adjustment',operationId:command.operationId,commandDigest,actor:{subjectId:principal.subjectId,role:principal.role},preview:p,previewDigest:command.previewDigest,scheduleRevision,projectionRevision,createdAt:at,notificationStatus:'NOT_WIRED_NO_EVENT_ENQUEUED'};
        db.prepare('INSERT INTO schedule_reschedule_operations VALUES (?,?,?,?,?,?,?,?,?)').run(command.operationId,command.input.scheduleItemId,command.input.resourceId,principal.subjectId,commandDigest,json(command),json(receipt),digest(receipt),at);
        db.prepare('INSERT INTO operations (operation_id,kind,response_json,created_at,request_digest) VALUES (?,?,?,?,?)').run(command.operationId,'dynamicDayAdjustment',json(receipt),at,commandDigest);
        db.prepare('INSERT INTO audit_log (action,role,entity_id,revision,result,created_at) VALUES (?,?,?,?,?,?)').run('dynamicDayAdjustment',principal.role,command.input.scheduleItemId,scheduleRevision,'accepted',at);
        db.exec('COMMIT');return {ok:true,receipt,exactReplay:false};
      }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
    },
  };
}

export function validateDynamicReceiptRow(row) {
  const c=JSON.parse(row.command_json),r=JSON.parse(row.receipt_json);
  if(!exact(c,['operationId','input','previewDigest'])||!validInput(c.input)||r.schemaVersion!==2||r.kind!=='dynamic-day-adjustment'
    ||json(c)!==row.command_json||json(r)!==row.receipt_json||digest(r)!==row.receipt_digest
    ||digest({domain:'dynamic-day-adjustment-v1',command:c})!==row.command_digest||r.commandDigest!==row.command_digest
    ||c.operationId!==row.operation_id||r.operationId!==row.operation_id||c.input.scheduleItemId!==row.schedule_item_id||c.input.resourceId!==row.resource_id
    ||r.actor?.subjectId!==row.actor_id||r.actor?.role!=='administrator'||r.previewDigest!==c.previewDigest
    ||digest(r.preview)!==c.previewDigest||json(r.preview.input)!==json(c.input)||r.preview.canApply!==true
    ||r.preview.unresolved.length!==0||!Array.isArray(r.preview.changes)||r.scheduleRevision!==r.preview.expectedScheduleRevision+1
    ||r.projectionRevision!==r.preview.expectedProjectionRevision+1)throw new Error('DYNAMIC_RECEIPT_CORRUPT');
  return r;
}
