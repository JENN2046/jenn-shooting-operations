import {schedulingOperationIdOwnedByOtherV1} from './sqlite-scheduling-operation-id-v1.mjs';
import {randomUUID} from 'node:crypto';
import {validateV3Submission} from './contract-validator.mjs';
import {validateTrustedPrincipal} from './authorization-v2.mjs';
import {canonicalJsonSchedulingV1 as json,digestCanonicalJsonSchedulingV1 as digest} from './scheduling-contract-v1.mjs';
import {assertSchedulingQuiescenceV1} from './sqlite-scheduling-quiescence-v1.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function createBusinessOrderV3({db,now,refreshProjections,writeAdmission}) {
 const authorized=p=>validateTrustedPrincipal(p).ok&&p.role==='administrator'&&(()=>{const r=db.prepare('SELECT resource_id FROM scheduling_resources').all();return r.length>0&&r.every(x=>p.resourceIds.includes(x.resource_id));})();
 function mutate({command,principal},edit=false){
  if(!writeAdmission())return {ok:false,code:'WRITE_ADMISSION_DISABLED'};
  if(!authorized(principal))return {ok:false,code:'FORBIDDEN'};
  const keys=['submission','expectedScheduleRevision','expectedProjectionRevision',...(edit?['requestId']:[])];
  if(!exact(command,keys)||!validateV3Submission(command.submission).ok||!['模特','场景','产品3D主图','细节图','功能图'].includes(command.submission.shootingSubtype)
    ||command.submission.productionType!=='平面'||(command.submission.kind!=='静物'&&command.submission.kind!==command.submission.shootingSubtype)
    ||!Number.isSafeInteger(command.expectedScheduleRevision)||!Number.isSafeInteger(command.expectedProjectionRevision))return {ok:false,code:'INVALID_REQUEST'};
  const sub=command.submission,operationId=sub.operationId,kind=edit?'business.order.edit.v3':'business.order.create.v3';
  const requestDigest=digest({kind,actor:principal.subjectId,command});
  try {db.exec('BEGIN IMMEDIATE');assertSchedulingQuiescenceV1({db,now});
   if(!writeAdmission()||!authorized(principal))fail('FORBIDDEN');
   if(schedulingOperationIdOwnedByOtherV1(db,operationId,['operation']))fail('IDEMPOTENCY_KEY_REUSE');
   const previous=db.prepare('SELECT * FROM operations WHERE operation_id=?').get(operationId);
   if(previous){if(previous.kind!==kind||previous.request_digest!==requestDigest)fail('IDEMPOTENCY_KEY_REUSE');const result=JSON.parse(previous.response_json);db.exec('COMMIT');return {...result,replayed:true};}
   const counters=db.prepare('SELECT * FROM revision_counters WHERE id=1').get();
   if(!counters||counters.schedule_revision!==command.expectedScheduleRevision||counters.projection_revision!==command.expectedProjectionRevision)fail('SCHEDULING_REVISION_CONFLICT');
   if(counters.projection_revision>=Number.MAX_SAFE_INTEGER)fail('REVISION_OVERFLOW');
   const prior=edit?db.prepare('SELECT * FROM requests_v2 WHERE id=?').get(command.requestId):null;
   if(edit&&!prior)fail('REQUEST_NOT_FOUND');
   if(edit&&(prior.request_lifecycle!=='open'||db.prepare('SELECT 1 FROM schedule_item_tasks WHERE task_id=?').get(prior.id)||db.prepare('SELECT 1 FROM production_runs WHERE task_id=?').get(prior.id)))fail('REQUEST_IMMUTABLE');
   // No attachment replacement/transfer in this first release. Existing claimed assets survive fact edits.
   if(edit&&(sub.uploadIds.length||sub.heroAssetId))fail('ATTACHMENT_EDIT_UNSUPPORTED');
   for(const id of sub.uploadIds){const asset=db.prepare('SELECT * FROM uploads WHERE id=?').get(id);if(!asset||asset.operation_id!==operationId||asset.claimed_task_id||!['image','attachment'].includes(asset.kind)||!Number.isSafeInteger(asset.size)||asset.size<=0||!asset.sha256)fail('INVALID_UPLOAD_REFERENCE');}
   if(sub.heroAssetId&&!sub.uploadIds.includes(sub.heroAssetId))fail('INVALID_HERO_ASSET');
   const at=now().toISOString(),id=prior?.id??`REQ-${randomUUID()}`;
   const ordinal=prior?.source_ordinal??((db.prepare('SELECT max(source_ordinal) n FROM requests_v2').get().n??-1)+1);if(!Number.isSafeInteger(ordinal))fail('REVISION_OVERFLOW');
   const values={sku:sub.sku.trim(),name:sub.name.trim(),client:prior?.client??'待确认',legacy_deliver_text:sub.coreBriefSummary,kind:sub.kind,
    production_type:sub.productionType,shooting_subtype:sub.shootingSubtype,deliverable_count:sub.deliverables.count,aspect_ratio:sub.aspectRatio,
    requested_by:sub.requestedBy.trim(),desired_date:sub.desiredDate,note:sub.note,core_brief_summary:sub.coreBriefSummary,
    brief_url:sub.briefUrl??prior?.brief_url??null,hero_asset_id:sub.heroAssetId??prior?.hero_asset_id??null,sample_status:sub.sampleStatus,sample_shelf_id:sub.sampleShelfId??prior?.sample_shelf_id??null,
    lighting_preset:sub.lightingPreset,reflectivity:sub.reflectivity,priority:sub.priority,business_updated_at:at};
   const response={ok:true,operationId,requestId:id,actor:principal.subjectId,projectionRevision:counters.projection_revision+1,scheduleRevision:counters.schedule_revision,createdAt:at};
   db.prepare('INSERT INTO operations(operation_id,kind,response_json,created_at,request_digest) VALUES(?,?,?,?,?)').run(operationId,kind,json(response),at,requestDigest);
   if(edit)db.prepare(`UPDATE requests_v2 SET ${Object.keys(values).map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(values),id);
   else {const row={id,source_ordinal:ordinal,...values,v1_status_mode:'canonical',request_lifecycle:'open',lifecycle_provenance:'domain_command',source:'submission',business_created_at:at,imported_at:at,v1_assets_present:1,v1_request_present:1,source_operation_id:operationId};db.prepare(`INSERT INTO requests_v2(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));}
   sub.uploadIds.forEach((assetId,index)=>{if(db.prepare('UPDATE uploads SET claimed_task_id=?,claimed_order=? WHERE id=? AND claimed_task_id IS NULL AND operation_id=?').run(id,index,assetId,operationId).changes!==1)fail('INVALID_UPLOAD_REFERENCE');});
   db.prepare('UPDATE revision_counters SET projection_revision=?,updated_at=? WHERE id=1').run(response.projectionRevision,at);
   refreshProjections({db,projectionRevision:response.projectionRevision,scheduleRevision:response.scheduleRevision,updatedAt:at});
   db.prepare('INSERT INTO audit_log(action,role,entity_id,revision,result,created_at) VALUES(?,?,?,?,?,?)').run(kind,principal.role,id,response.projectionRevision,'success',at);
   db.exec('COMMIT');return response;
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');return {ok:false,code:e.code??'ORDER_WRITE_FAILED'};}
 }
 return {create:input=>mutate(input),edit:input=>mutate(input,true)};
}
