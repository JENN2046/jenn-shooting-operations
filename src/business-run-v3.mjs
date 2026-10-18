import {evaluateKioskEventTime} from './event-time-policy-v2.mjs';
import {schedulingOperationIdOwnedByOtherV1} from './sqlite-scheduling-operation-id-v1.mjs';
import {createApplyRunEvent} from './run-event-use-case-v2.mjs';
import {createSqliteRunEventStore} from './sqlite-run-event-store-v2.mjs';
import {authorizeCapability,validateTrustedPrincipal} from './authorization-v2.mjs';
import {canonicalJsonSchedulingV1 as json,digestCanonicalJsonSchedulingV1 as digest,isSchedulingIdentifierV1} from './scheduling-contract-v1.mjs';
import {assertSchedulingQuiescenceV1} from './sqlite-scheduling-quiescence-v1.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(v);
export function createBusinessRunV3(options) { return createRunRecorder(options, 'owner-server'); }
export function createKioskRunV3(options) { return createRunRecorder(options, 'operator-device'); }
export function createOwnerDeviceRunV1(options) { return createRunRecorder(options, 'owner-device'); }
function createRunRecorder({db,now,writeAdmission}, mode) {
 const kiosk=mode!=='owner-server',ownerDevice=mode==='owner-device';
 return ({command,principal,deviceId,resourceId})=>{
  if(!writeAdmission())return {ok:false,code:'WRITE_ADMISSION_DISABLED'};
  if(!validateTrustedPrincipal(principal).ok||principal.role!==(!kiosk||ownerDevice?'administrator':'operator'))return {ok:false,code:'FORBIDDEN'};
  if(kiosk&&(!identifier(deviceId)||!isSchedulingIdentifierV1(resourceId)||(!ownerDevice&&principal.resourceIds.length!==1)||!principal.resourceIds.includes(resourceId)))return {ok:false,code:'FORBIDDEN'};
  const declared=kiosk&&command?.recordingMode==='device-declared';
  if(ownerDevice&&!declared)return {ok:false,code:'INVALID_RUN_EVENT_COMMAND'};
  const keys=['eventId','runId','scheduleItemId','eventType','expectedRunRevision',...(kiosk?['expectedScheduleRevision']:[]),...(declared?['recordingMode','occurredAt']:[])];
  if(!command||Object.keys(command).length!==keys.length||!keys.every(k=>Object.hasOwn(command,k))||!identifier(command.eventId)||!identifier(command.runId)||typeof command.scheduleItemId!=='string'||!['start','complete'].includes(command.eventType)||!Number.isSafeInteger(command.expectedRunRevision)||command.expectedRunRevision<0||(kiosk&&(!Number.isSafeInteger(command.expectedScheduleRevision)||command.expectedScheduleRevision<0)))return {ok:false,code:'INVALID_RUN_EVENT_COMMAND'};
  const source=ownerDevice?'owner-device-declared-v1':declared?'kiosk-device-declared-v3':kiosk?'kiosk-online-v3':'owner-management-v3',kind=ownerDevice?'business.owner-device.run.v1':kiosk?'kiosk.online.run.v3':'business.run.v3';
  const operationId=`${ownerDevice?'owner-device':kiosk?'kiosk-online':'admin'}:${command.eventId}`,requestDigest=digest({kind,actor:principal.subjectId,...(kiosk?{deviceId,resourceId}:{}),command});
  try {db.exec('BEGIN IMMEDIATE');assertSchedulingQuiescenceV1({db,now});
   const item=db.prepare('SELECT * FROM schedule_items WHERE id=?').get(command.scheduleItemId);
   if(!item)fail('SCHEDULE_ITEM_NOT_FOUND');
   if(kiosk&&item.resource_id!==resourceId)fail('FORBIDDEN');
   if(!writeAdmission()||!authorizeCapability({principal,capability:'submitRunEvent',resourceId:item.resource_id}).allowed)fail('FORBIDDEN');
   if(schedulingOperationIdOwnedByOtherV1(db,operationId,['operation'])||schedulingOperationIdOwnedByOtherV1(db,command.eventId,['operation']))fail('IDEMPOTENCY_KEY_REUSE');
   const prior=db.prepare('SELECT * FROM operations WHERE operation_id=?').get(operationId);
   if(prior){if(prior.kind!==kind||prior.request_digest!==requestDigest)fail('IDEMPOTENCY_KEY_REUSE');const receipt=JSON.parse(prior.response_json);db.exec('COMMIT');return {...receipt,replayed:true};}
   if(db.prepare('SELECT 1 FROM operations WHERE operation_id=?').get(command.eventId))fail('IDEMPOTENCY_KEY_REUSE');
   const at=now().toISOString(),occurredAt=declared?command.occurredAt:at;
   if(declared){const decision=evaluateKioskEventTime({occurredAt,receivedAt:at});if(!decision.ok)fail(decision.code);}
   if(kiosk){
    if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())fail('BUSINESS_SCHEMA12_REQUIRED');
    if(db.prepare('SELECT schedule_revision FROM revision_counters WHERE id=1').get()?.schedule_revision!==command.expectedScheduleRevision)fail('SCHEDULING_REVISION_CONFLICT');
    if(db.prepare('SELECT status FROM scheduling_resources WHERE resource_id=?').get(resourceId)?.status!=='active')fail('FORBIDDEN');
    const date=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
    if(command.eventType==='start'&&date(item.planned_start)!==date(occurredAt))fail('KIOSK_TODAY_ONLY');
   }
   if(item.schedule_status!=='confirmed'||item.resource_resolution_status!=='resolved'||item.allocation_mode!=='single')fail('RUN_PREPARATION_REQUIRED');
   const active=db.prepare('SELECT v.schema_version,v.config_json FROM scheduling_active_config a JOIN scheduling_config_versions v ON v.config_version=a.config_version WHERE a.id=1').get();
   if(active?.schema_version!==3||JSON.parse(active.config_json).externalNotifications!=='disabled')fail('NOTIFICATION_POLICY_INVALID');
   const bindings=db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=?').all(item.id);
   if(bindings.length!==1)fail('RUN_PREPARATION_REQUIRED');
   const history=db.prepare('SELECT * FROM production_runs WHERE schedule_item_id=?').all(item.id);
   if(command.eventType==='start'&&db.prepare("SELECT 1 FROM production_runs r JOIN schedule_items s ON s.id=r.schedule_item_id WHERE s.resource_id=? AND r.status IN ('shooting','blocked')").get(item.resource_id))fail('RESOURCE_ALREADY_RUNNING');
   {
    const others=db.prepare('SELECT r.started_at,r.completed_at FROM production_runs r JOIN schedule_items s ON s.id=r.schedule_item_id WHERE s.resource_id=? AND r.id<>? AND r.started_at IS NOT NULL').all(item.resource_id,command.runId);
    const end=Date.parse(occurredAt),start=command.eventType==='start'?end:Date.parse(history[0]?.started_at);
    // The current run model permits one active run, not retrospective insertion
    // before later confirmed runs. This also protects server-timed starts
    // from a previously accepted device declaration with allowed future skew.
    if(others.some(r=>command.eventType==='start'?(!r.completed_at||Date.parse(r.completed_at)>start)
      :(Date.parse(r.started_at)<end&&(!r.completed_at||Date.parse(r.completed_at)>start))))fail('RUN_EVENT_TIME_RESOURCE_CONFLICT');
   }
   if(command.eventType==='start'){
    if(history.length===0){
     if(command.expectedRunRevision!==0||db.prepare('SELECT 1 FROM production_runs WHERE id=?').get(command.runId))fail('RUN_PREPARATION_REQUIRED');
     db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,blocked_duration_ms,created_at,updated_at) VALUES(?,?,'task',?,'scheduled',0,0,?,?)").run(command.runId,item.id,bindings[0].task_id,at,at);
    }else if(history.length!==1||history[0].id!==command.runId||history[0].status!=='scheduled')fail('RUN_PREPARATION_REQUIRED');
   }else if(history.length!==1||history[0].id!==command.runId||history[0].status!=='shooting')fail('RUN_PREPARATION_REQUIRED');
   const store=createSqliteRunEventStore({db,businessTimeZone:'Asia/Shanghai',ownsTransaction:false});
   const apply=createApplyRunEvent({store,clock:()=>new Date(at),auditRole:principal.role,notifications:'disabled',eventTimePolicy:declared?evaluateKioskEventTime:({occurredAt,receivedAt})=>({ok:occurredAt===receivedAt})});
   const {expectedScheduleRevision,recordingMode,occurredAt:deviceTime,...eventCommand}=command;
   const result=apply({...eventCommand,occurredAt,actorId:principal.subjectId,deviceId:kiosk?deviceId:'owner-management-v3'});
   if(!result.ok)fail(result.code);
   const response={...result,source,actor:principal.subjectId,...(kiosk?{deviceId,resourceId,eventId:command.eventId}:{}),recordedAt:at,...(declared?{replayed:false,timeSource:'device-declared',command:{...command}}:{})};
   db.prepare('INSERT INTO operations(operation_id,kind,response_json,created_at,request_digest) VALUES(?,?,?,?,?)').run(operationId,kind,json(response),at,requestDigest);
   db.exec('COMMIT');return response;
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');return {ok:false,code:e.code??'RUN_EVENT_WRITE_FAILED'};}
 };
}
