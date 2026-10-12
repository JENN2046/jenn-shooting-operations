import {requireKioskOnlineRuntimeV3} from './kiosk-online-runtime-v3.mjs';
import {createKioskRunV3} from './business-run-v3.mjs';
const date=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function createKioskOnlineV3({store,runtime,clock=()=>new Date()}){
 requireKioskOnlineRuntimeV3(runtime);
 const db=store.db,writeAdmissionControl=store.writeAdmissionControl;
 const record=createKioskRunV3({db,now:clock,writeAdmission:()=>!writeAdmissionControl.isDisabled()});
 return Object.freeze({version:3,writeAdmissionControl,authenticate:runtime.authenticate,
  identity(identity){return {ok:true,protocolVersion:3,subjectId:identity.principal.subjectId,role:'operator',deviceId:identity.deviceId,resourceId:identity.resourceId};},
  day(identity){
   if(db.prepare('SELECT status FROM scheduling_resources WHERE resource_id=?').get(identity.resourceId)?.status!=='active')return {ok:false,code:'FORBIDDEN'};
   const now=clock().toISOString(),today=date(now);
   const revisions=db.prepare('SELECT schedule_revision AS scheduleRevision,projection_revision AS projectionRevision FROM revision_counters WHERE id=1').get();
   const sessions=db.prepare(`SELECT id,planned_start AS plannedStart,planned_end AS plannedEnd,allocation_mode AS allocationMode FROM schedule_items
     WHERE resource_id=? AND schedule_status='confirmed' AND resource_resolution_status='resolved' ORDER BY planned_start,id`).all(identity.resourceId).map(s=>{
    const runs=db.prepare('SELECT id,status,run_revision AS runRevision,started_at AS startedAt,completed_at AS completedAt FROM production_runs WHERE schedule_item_id=? ORDER BY created_at,id').all(s.id);
    const tasks=db.prepare('SELECT r.id,r.sku,r.name,r.kind,r.shooting_subtype AS shootingSubtype FROM schedule_item_tasks b JOIN requests_v2 r ON r.id=b.task_id WHERE b.schedule_item_id=? ORDER BY b.display_order').all(s.id);
    const supported=s.allocationMode==='single'&&tasks.length===1&&runs.length<=1;
    return {...s,tasks,run:runs.length===1?runs[0]:null,state:runs.length===1?runs[0].status:runs.length?'unsupported':'scheduled',supported};
   }).filter(s=>date(s.plannedStart)===today||['shooting','blocked'].includes(s.state));
   const live=sessions.filter(s=>['shooting','blocked'].includes(s.state));
   const current=live.length===1?live[0]:live.length?null:sessions.find(s=>s.state==='scheduled'&&Date.parse(s.plannedStart)<=Date.parse(now)&&Date.parse(now)<Date.parse(s.plannedEnd))??null;
   return {ok:true,protocolVersion:3,...this.identity(identity),today,serverTime:now,revisions,sessions,currentId:current?.id??null,conflict:live.length>1,writeAdmission:writeAdmissionControl.status().mode};
  },
  record(identity,command){return record({command,...identity});},
  receipt(identity,eventId){
   const row=db.prepare('SELECT kind,response_json FROM operations WHERE operation_id=?').get(`kiosk-online:${eventId}`);
   if(!row)return {ok:false,code:'EVENT_NOT_FOUND'};
   if(row.kind!=='kiosk.online.run.v3')return {ok:false,code:'FORBIDDEN'};
   const receipt=JSON.parse(row.response_json);
   if(receipt.actor!==identity.principal.subjectId||receipt.deviceId!==identity.deviceId||receipt.resourceId!==identity.resourceId)return {ok:false,code:'FORBIDDEN'};
   return {...receipt,replayed:true};
  }
 });
}
