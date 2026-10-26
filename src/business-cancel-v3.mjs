import {canonicalJsonSchedulingV1 as json,digestCanonicalJsonSchedulingV1 as digest,isSchedulingIdentifierV1 as identifier} from './scheduling-contract-v1.mjs';
import {validateTrustedPrincipal,authorizeCapability} from './authorization-v2.mjs';
import {normalizeSchedulingConfig} from './scheduling-admin-contract-v2.mjs';
import {assertSchedulingQuiescenceV1,assertGf15CommandPacketV1} from './sqlite-scheduling-quiescence-v1.mjs';
import {schedulingOperationIdOwnedByOtherV1} from './sqlite-scheduling-operation-id-v1.mjs';
import {staleDraftProposalsInTransactionV1} from './sqlite-scheduling-proposal-store-v1.mjs';
const denied=code=>({ok:false,code});
const keys=['operationId','scheduleItemId','requestId','resourceId','expectedScheduleRevision','expectedProjectionRevision','configDigest','reasonCode','reasonNote'];
const summary=(row,request)=>({scheduleItemId:row.id,requestId:request.id,resourceId:row.resource_id,plannedStart:row.planned_start,plannedEnd:row.planned_end,bufferAfterMinutes:row.buffer_after_minutes,scheduleStatus:row.schedule_status,requestLifecycle:request.request_lifecycle});

// Explicit Owner cancellation of a single unstarted order and its only session.
// No run events, deletion, notification or occupancy-rule exception is created.
export function createBusinessCancelV3({db,now,refreshProjections,writeAdmission}) {
 return ({command,principal})=>{
  if(!validateTrustedPrincipal(principal).ok||principal.role!=='administrator')return denied('FORBIDDEN');
  if(!command||Object.getPrototypeOf(command)!==Object.prototype||Object.keys(command).length!==keys.length||!keys.every(k=>Object.hasOwn(command,k))
   ||!['operationId','scheduleItemId','requestId','resourceId'].every(k=>identifier(command[k]))
   ||!['expectedScheduleRevision','expectedProjectionRevision'].every(k=>Number.isSafeInteger(command[k])&&command[k]>=0)
   ||!/^sha256:[a-f0-9]{64}$/.test(command.configDigest)||command.reasonCode!=='OWNER_CONFIRMED_NOT_STARTED'
   ||typeof command.reasonNote!=='string'||!command.reasonNote.trim()||command.reasonNote.length>500)return denied('CANCEL_COMMAND_INVALID');
  if(!authorizeCapability({principal,capability:'modifySchedule',resourceId:command.resourceId}).allowed)return denied('FORBIDDEN');
  if(!writeAdmission())return denied('WRITE_ADMISSION_DISABLED');
  const commandDigest=digest({domain:'business-cancel-v3',actor:principal.subjectId,command});
  db.exec('BEGIN IMMEDIATE');
  try {
   const result=apply();db.exec('COMMIT');return result;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  function apply(){
   if(!writeAdmission())return denied('WRITE_ADMISSION_DISABLED');
   if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())return denied('BUSINESS_SCHEMA12_REQUIRED');
   assertSchedulingQuiescenceV1({db,now});assertGf15CommandPacketV1(db,command,null);
   const prior=db.prepare('SELECT kind,response_json,request_digest FROM operations WHERE operation_id=?').get(command.operationId);
   if(prior)return prior.kind==='business.cancel.v3'&&prior.request_digest===commandDigest
    ?{ok:true,receipt:JSON.parse(prior.response_json),exactReplay:true}:denied('IDEMPOTENCY_KEY_REUSE');
   if(schedulingOperationIdOwnedByOtherV1(db,command.operationId,[]))return denied('IDEMPOTENCY_KEY_REUSE');
   const revisions=db.prepare('SELECT schedule_revision,projection_revision FROM revision_counters WHERE id=1').get();
   if(!revisions||revisions.schedule_revision!==command.expectedScheduleRevision||revisions.projection_revision!==command.expectedProjectionRevision)return denied('SCHEDULING_REVISION_CONFLICT');
   if(Math.max(revisions.schedule_revision,revisions.projection_revision)>=Number.MAX_SAFE_INTEGER)return denied('SCHEDULE_REVISION_EXHAUSTED');
   const active=db.prepare('SELECT v.* FROM scheduling_active_config a JOIN scheduling_config_versions v ON v.config_version=a.config_version WHERE a.id=1').get();
   if(!active||active.config_digest!==command.configDigest)return denied('CANCEL_CONFIG_CONFLICT');
   const config=normalizeSchedulingConfig(JSON.parse(active.config_json));
   if(!config.ok||config.configDigest!==active.config_digest||config.configJson!==active.config_json)return denied('CANCEL_CONFIG_INVALID');
   if(config.config.schemaVersion!==3||config.config.externalNotifications!=='disabled')return denied('NOTIFICATION_POLICY_INVALID');
   const row=db.prepare('SELECT * FROM schedule_items WHERE id=?').get(command.scheduleItemId);
   if(!row)return denied('SCHEDULE_ITEM_NOT_FOUND');
   if(row.resource_id!==command.resourceId||row.resource_resolution_status!=='resolved')return denied('CANCEL_RESOURCE_MISMATCH');
   if(row.schedule_status!=='confirmed'||row.lock_status!=='unlocked'||row.allocation_mode!=='single'
    ||db.prepare('SELECT 1 FROM production_runs WHERE schedule_item_id=? LIMIT 1').get(row.id))return denied('CANCEL_ITEM_IMMUTABLE');
   const bindings=db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=?').all(row.id);
   if(bindings.length!==1||bindings[0].task_id!==command.requestId)return denied('CANCEL_REQUEST_MISMATCH');
   const request=db.prepare('SELECT * FROM requests_v2 WHERE id=?').get(command.requestId);
   if(!request||request.request_lifecycle!=='open'||request.v1_status_mode!=='canonical')return denied('CANCEL_REQUEST_IMMUTABLE');
   // Closing an order must not affect a different session, including historical execution.
   if(db.prepare('SELECT 1 FROM schedule_item_tasks WHERE task_id=? AND schedule_item_id<>? LIMIT 1').get(request.id,row.id))return denied('CANCEL_REQUEST_SHARED');
   if(db.prepare("SELECT 1 FROM notification_outbox WHERE aggregate_type='schedule_item' AND aggregate_id=? AND status IN ('pending','retryableFailed','leased') LIMIT 1").get(row.id))return denied('CANCEL_NOTIFICATION_IN_FLIGHT');
   const at=now().toISOString(),before=summary(row,request),scheduleRevision=revisions.schedule_revision+1,projectionRevision=revisions.projection_revision+1;
   db.prepare("UPDATE schedule_items SET schedule_status='cancelled',schedule_status_provenance='domain_command',business_updated_at=? WHERE id=?").run(at,row.id);
   db.prepare("UPDATE requests_v2 SET request_lifecycle='cancelled',lifecycle_provenance='domain_command',business_updated_at=? WHERE id=?").run(at,request.id);
   if(db.prepare('UPDATE revision_counters SET schedule_revision=?,projection_revision=?,updated_at=? WHERE id=1 AND schedule_revision=? AND projection_revision=?').run(scheduleRevision,projectionRevision,at,revisions.schedule_revision,revisions.projection_revision).changes!==1)throw Error('SCHEDULING_REVISION_CONFLICT');
   staleDraftProposalsInTransactionV1({db,triggerOperationId:command.operationId,reasonCode:'SCHEDULE_REVISION_CHANGED',now});
   refreshProjections({db,scheduleRevision,projectionRevision,updatedAt:at});
   const receipt={schemaVersion:1,kind:'business.cancel.v3',operationId:command.operationId,commandDigest,actor:principal.subjectId,scheduleItemId:row.id,requestId:request.id,resourceId:row.resource_id,before,after:{...before,scheduleStatus:'cancelled',requestLifecycle:'cancelled'},reasonCode:command.reasonCode,reasonNote:command.reasonNote,scheduleRevision,projectionRevision,createdAt:at,notificationStatus:'NOT_ENQUEUED_EXTERNAL_DELIVERY_DISABLED'};
   db.prepare('INSERT INTO operations(operation_id,kind,response_json,created_at,request_digest) VALUES(?,?,?,?,?)').run(command.operationId,receipt.kind,json(receipt),at,commandDigest);
   db.prepare('INSERT INTO audit_log(action,role,entity_id,revision,result,created_at) VALUES(?,?,?,?,?,?)').run(receipt.kind,principal.role,row.id,scheduleRevision,'cancelled-not-started',at);
   return {ok:true,receipt,exactReplay:false};
  }
 };
}
