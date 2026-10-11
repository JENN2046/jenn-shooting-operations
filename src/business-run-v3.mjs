import {schedulingOperationIdOwnedByOtherV1} from './sqlite-scheduling-operation-id-v1.mjs';
import {createApplyRunEvent} from './run-event-use-case-v2.mjs';
import {createSqliteRunEventStore} from './sqlite-run-event-store-v2.mjs';
import {authorizeCapability,validateTrustedPrincipal} from './authorization-v2.mjs';
import {canonicalJsonSchedulingV1 as json,digestCanonicalJsonSchedulingV1 as digest} from './scheduling-contract-v1.mjs';
import {assertSchedulingQuiescenceV1} from './sqlite-scheduling-quiescence-v1.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(v);
export function createBusinessRunV3({db,now,writeAdmission}) {
 return ({command,principal})=>{
  if(!writeAdmission())return {ok:false,code:'WRITE_ADMISSION_DISABLED'};
  if(!validateTrustedPrincipal(principal).ok||principal.role!=='administrator')return {ok:false,code:'FORBIDDEN'};
  const keys=['eventId','runId','scheduleItemId','eventType','expectedRunRevision'];
  if(!command||Object.keys(command).length!==keys.length||!keys.every(k=>Object.hasOwn(command,k))||!identifier(command.eventId)||!identifier(command.runId)||typeof command.scheduleItemId!=='string'||!['start','complete'].includes(command.eventType)||!Number.isSafeInteger(command.expectedRunRevision)||command.expectedRunRevision<0)return {ok:false,code:'INVALID_RUN_EVENT_COMMAND'};
  const operationId=`admin:${command.eventId}`,requestDigest=digest({kind:'business.run.v3',actor:principal.subjectId,command});
  try {db.exec('BEGIN IMMEDIATE');assertSchedulingQuiescenceV1({db,now});
   const item=db.prepare('SELECT * FROM schedule_items WHERE id=?').get(command.scheduleItemId);
   if(!item)fail('SCHEDULE_ITEM_NOT_FOUND');
   if(!writeAdmission()||!authorizeCapability({principal,capability:'submitRunEvent',resourceId:item.resource_id}).allowed)fail('FORBIDDEN');
   if(schedulingOperationIdOwnedByOtherV1(db,operationId,['operation'])||schedulingOperationIdOwnedByOtherV1(db,command.eventId,['operation']))fail('IDEMPOTENCY_KEY_REUSE');
   const prior=db.prepare('SELECT * FROM operations WHERE operation_id=?').get(operationId);
   if(prior){if(prior.kind!=='business.run.v3'||prior.request_digest!==requestDigest)fail('IDEMPOTENCY_KEY_REUSE');const receipt=JSON.parse(prior.response_json);db.exec('COMMIT');return {...receipt,replayed:true};}
   if(db.prepare('SELECT 1 FROM operations WHERE operation_id=?').get(command.eventId))fail('IDEMPOTENCY_KEY_REUSE');
   if(item.schedule_status!=='confirmed'||item.resource_resolution_status!=='resolved'||item.allocation_mode!=='single')fail('RUN_PREPARATION_REQUIRED');
   const active=db.prepare('SELECT v.schema_version,v.config_json FROM scheduling_active_config a JOIN scheduling_config_versions v ON v.config_version=a.config_version WHERE a.id=1').get();
   if(active?.schema_version!==3||JSON.parse(active.config_json).externalNotifications!=='disabled')fail('NOTIFICATION_POLICY_INVALID');
   const bindings=db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=?').all(item.id);
   if(bindings.length!==1)fail('RUN_PREPARATION_REQUIRED');
   const history=db.prepare('SELECT * FROM production_runs WHERE schedule_item_id=?').all(item.id);
   const at=now().toISOString();
   if(command.eventType==='start'){
    if(db.prepare("SELECT 1 FROM production_runs r JOIN schedule_items s ON s.id=r.schedule_item_id WHERE s.resource_id=? AND r.status IN ('shooting','blocked')").get(item.resource_id))fail('RESOURCE_ALREADY_RUNNING');
    if(history.length===0){
     if(command.expectedRunRevision!==0||db.prepare('SELECT 1 FROM production_runs WHERE id=?').get(command.runId))fail('RUN_PREPARATION_REQUIRED');
     db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,blocked_duration_ms,created_at,updated_at) VALUES(?,?,'task',?,'scheduled',0,0,?,?)").run(command.runId,item.id,bindings[0].task_id,at,at);
    }else if(history.length!==1||history[0].id!==command.runId||history[0].status!=='scheduled')fail('RUN_PREPARATION_REQUIRED');
   }else if(history.length!==1||history[0].id!==command.runId||history[0].status!=='shooting')fail('RUN_PREPARATION_REQUIRED');
   const store=createSqliteRunEventStore({db,businessTimeZone:'Asia/Shanghai',ownsTransaction:false});
   const apply=createApplyRunEvent({store,clock:()=>new Date(at),auditRole:principal.role,notifications:'disabled',eventTimePolicy:({occurredAt,receivedAt})=>({ok:occurredAt===receivedAt})});
   const result=apply({...command,occurredAt:at,actorId:principal.subjectId,deviceId:'owner-management-v3'});
   if(!result.ok)fail(result.code);
   const response={...result,source:'owner-management-v3',actor:principal.subjectId,recordedAt:at};
   db.prepare('INSERT INTO operations(operation_id,kind,response_json,created_at,request_digest) VALUES(?,?,?,?,?)').run(operationId,'business.run.v3',json(response),at,requestDigest);
   db.exec('COMMIT');return response;
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');return {ok:false,code:e.code??'RUN_EVENT_WRITE_FAILED'};}
 };
}
