import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeWritableSchema} from '../src/sqlite-schema-v2.mjs';
import {createAgentSchedulingServiceV1} from '../src/agent-scheduling-service-v1.mjs';
import {createTrustedPrincipal} from '../src/authorization-v2.mjs';
import {createSqliteSchedulingProposalStoreV1} from '../src/sqlite-scheduling-proposal-store-v1.mjs';
import {assembleSchedulingInputFromSqliteV1} from '../src/sqlite-scheduling-input-assembler-v1.mjs';
import {createSqliteScheduleRescheduleStoreV1} from '../src/sqlite-schedule-reschedule-store-v1.mjs';
import {refreshSqliteSnapshotProjectionsV2} from '../src/sqlite-run-event-store-v2.mjs';
import {createSqliteOutboxRepositoryV1} from '../src/sqlite-outbox-repository-v1.mjs';
import {businessInitialConfig,businessInitialResource} from '../src/business-defaults-v1.mjs';
import {normalizeSchedulingConfig} from '../src/scheduling-admin-contract-v2.mjs';
const principal=(role='viewer',resourceIds=['PHOTO'])=>createTrustedPrincipal({subjectId:'agent:local',role,resourceIds}).principal;
const viewer=principal(),executor=principal('scheduler'),elsewhere=principal('scheduler',['OTHER']);
function fixture(options={}) {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');initializeWritableSchema(db);
 const at='2026-10-01T00:00:00.000Z',now=()=>new Date(at),r=businessInitialResource('PHOTO'),c=normalizeSchedulingConfig(businessInitialConfig(r,'2026-01-01'));
 db.prepare('INSERT INTO revision_counters VALUES (1,0,0,?)').run(at);
 db.prepare('INSERT INTO scheduling_resources VALUES (?,?,?,?,?,?,?,?)').run(r.resourceId,r.v1DisplayPlace,r.status,JSON.stringify(r.capabilityJson),r.capabilityDigest,at,at,'RESOURCE');
 db.prepare('INSERT INTO scheduling_config_versions VALUES (?,?,?,?,?,?,?,?,?,?)').run('config-1',2,'deterministic-scheduler-v1','calendar-compiler-v2','estimate-policy-v1',c.configJson,c.configDigest,'Jenn',at,'PUB');
 db.prepare('INSERT INTO scheduling_active_config VALUES (1,?,?,?,0)').run('config-1',at,'ACT');
 db.prepare(`INSERT INTO requests_v2 (id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,deliverable_count,aspect_ratio,requested_by,desired_date,note,sample_status,lighting_preset,reflectivity,priority)
 VALUES ('REQ',0,'SKU','Product','PRIVATE_CLIENT','Photo','细节','canonical','open','domain_command','submission',?,1,1,'平面','细节',1,'1:1','Jenn','2026-10-02','PRIVATE_NOTE','arrivedVerified','SOFT','low','p1')`).run(at);
 db.prepare('INSERT INTO scheduling_request_requirements VALUES (?,?,?,?,?)').run('REQ','["FLAT"]',null,at,'REQ-FACTS');
 let disabled=false;
 const refreshProjections=context=>{if(options.projectionFailure)throw Error('synthetic projection failure');return refreshSqliteSnapshotProjectionsV2({...context,businessTimeZone:'Asia/Shanghai'});};
 const proposalStore=createSqliteSchedulingProposalStoreV1({db,assembleInput:assembleSchedulingInputFromSqliteV1,now,refreshProjections,authorizeAcceptance:()=>true});
 const moves=createSqliteScheduleRescheduleStoreV1({db,now,refreshProjections,writeAdmission:()=>!disabled});
 const service=createAgentSchedulingServiceV1({db,proposalStore,application:{reschedule:({command,principal,executionGuard})=>moves.reschedule(command,principal,{executionGuard})},writeAdmissionControl:{isDisabled:()=>disabled}});
 const command={operationId:'GEN-1',planningWindowStart:'2026-10-02T00:00:00.000Z',planningWindowEnd:'2026-10-02T11:00:00.000Z',resourceScope:['PHOTO']};
 const state=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name}"`).all()]));
 return {db,service,proposalStore,command,state,config:c,disable:()=>{disabled=true;}};
}
function adoption(preview) {return {generationCommand:preview.generationCommand,expectedPreview:Object.fromEntries(['inputDigest','resultDigest','baseScheduleRevision','configVersion','configDigest'].map(k=>[k,preview[k]])),decision:{decisionId:'ADOPT-1',proposalId:preview.proposalId,decisionType:'accept',selectedProposalItemIds:preview.proposedItems.map(i=>i.proposalItemId),decisionNote:null,reasonCode:null}};}
function getPreview(f){const result=f.service.generateProposal({principal:viewer,command:f.command});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.preview.proposedItems.length,1);return result.preview;}
function settleConfirmed(f){
 const outbox=createSqliteOutboxRepositoryV1({db:f.db,tokenFactory:()=> 'LEASE-AGENT-TEST',random:()=>0});
 const claimed=outbox.claimBatch({workerId:'agent-test',now:'2026-10-01T00:00:00.000Z',limit:8});
 assert.equal(claimed.ok,true,JSON.stringify(claimed));
 for(const item of claimed.items){
  assert.equal(outbox.settleDelivery({outboxId:item.outboxId,leaseToken:item.leaseToken,result:{ok:true,code:'DINGTALK_CARD_SENT',providerRef:`dt:test/${item.outboxId}`},now:'2026-10-01T00:00:01.000Z'}).code,'OUTBOX_SENT');
 }
}

test('viewer reads scoped state/calendar and nonempty proposal without any persistent write, including disabled admission',()=>{
 const f=fixture();try{f.disable();f.db.exec('PRAGMA query_only=ON');const before=f.state();
 const state=f.service.readState({principal:viewer,command:{resourceScope:['PHOTO']}});assert.equal(state.ok,true);assert.equal(state.writeAdmission,'disabled');assert.equal(state.resources.length,1);
 assert.equal(JSON.stringify(state).includes('PRIVATE'),false);
 const calendar=f.service.previewCalendar({principal:viewer,command:{resourceId:'PHOTO',startDate:'2026-10-10',endDate:'2026-10-17'}});assert.equal(calendar.ok,true);assert.equal(calendar.days[0].windows.length,2);assert.equal(calendar.days.at(-1).windows.length,0);
 getPreview(f);assert.equal(f.state(),before);assert.equal(f.service.readReceipt({principal:viewer,command:{operationId:'GEN-1'}}).code,'OPERATION_NOT_FOUND');
 }finally{f.db.close();}
});
test('exact preview adoption commits one nonempty schedule and replays without regenerating or duplicating facts',()=>{
 const f=fixture();try{const command=adoption(getPreview(f));const accepted=f.service.adoptProposal({principal:executor,command});assert.equal(accepted.ok,true,JSON.stringify(accepted));assert.equal(accepted.receipt.adoptedItems.length,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM scheduling_proposals').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM schedule_items').get().n,1);
 const before=f.state();const replay=f.service.adoptProposal({principal:executor,command});assert.equal(replay.ok,true);assert.equal(replay.exactReplay,true);assert.equal(f.state(),before);
 const receipt=f.service.readReceipt({principal:viewer,command:{operationId:'ADOPT-1'}});assert.equal(receipt.ok,true);assert.equal(receipt.receipt.decisionType,'accept');assert.equal(Object.hasOwn(receipt.receipt,'decidedBy'),false);
 assert.equal(f.service.readReceipt({principal:elsewhere,command:{operationId:'ADOPT-1'}}).code,'FORBIDDEN');
 }finally{f.db.close();}
});
for(const [label,mutate] of [
 ['changed revision',f=>f.db.exec('UPDATE revision_counters SET schedule_revision=1,projection_revision=1 WHERE id=1')],
 ['changed request facts',f=>f.db.exec("UPDATE requests_v2 SET priority='p0' WHERE id='REQ'")],
])test(`preview adoption refuses ${label} with no draft, stale receipt or schedule write`,()=>{
 const f=fixture();try{const command=adoption(getPreview(f));mutate(f);const before=f.state();const r=f.service.adoptProposal({principal:executor,command});assert.equal(r.code,'SCHEDULING_PREVIEW_CHANGED');assert.equal(f.state(),before);}finally{f.db.close();}
});
test('wrong result digest or proposal id is rejected and the new draft rolls back',()=>{
 for(const bad of ['proof','proposalId','selection']){const f=fixture();try{const command=adoption(getPreview(f));if(bad==='proof')command.expectedPreview.resultDigest='sha256:'+'0'.repeat(64);if(bad==='proposalId')command.decision.proposalId='wrong';if(bad==='selection')command.decision.selectedProposalItemIds=['not-proposed'];const before=f.state();assert.equal(f.service.adoptProposal({principal:executor,command}).ok,false);assert.equal(f.state(),before);}finally{f.db.close();}}
});
test('projection error rolls back generated draft, schedule, counters, outbox and receipts together',()=>{
 const f=fixture({projectionFailure:true});try{const command=adoption(getPreview(f));const before=f.state();assert.throws(()=>f.service.adoptProposal({principal:executor,command}),/synthetic projection failure/);assert.equal(f.state(),before);}finally{f.db.close();}
});
test('viewer, disabled gate and another resource cannot write; other resource cannot read or preview',()=>{
 const f=fixture();try{const command=adoption(getPreview(f));const before=f.state();assert.equal(f.service.adoptProposal({principal:viewer,command}).code,'FORBIDDEN');assert.equal(f.service.adoptProposal({principal:elsewhere,command}).code,'FORBIDDEN');
 assert.equal(f.service.readState({principal:elsewhere,command:{resourceScope:['PHOTO']}}).code,'FORBIDDEN');assert.equal(f.service.previewCalendar({principal:elsewhere,command:{resourceId:'PHOTO',startDate:'2026-10-10',endDate:'2026-10-10'}}).code,'FORBIDDEN');assert.equal(f.service.generateProposal({principal:elsewhere,command:f.command}).code,'FORBIDDEN');
 f.disable();assert.equal(f.service.adoptProposal({principal:executor,command}).code,'WRITE_ADMISSION_DISABLED');assert.equal(f.state(),before);
 }finally{f.db.close();}
});
test('accepted session reschedules through canonical application and viewer reads scoped safe receipt',()=>{
 const f=fixture();try{const accepted=f.service.adoptProposal({principal:executor,command:adoption(getPreview(f))});assert.equal(accepted.ok,true);settleConfirmed(f);const id=accepted.receipt.adoptedItems[0].scheduleItemId;const rev=f.db.prepare('SELECT * FROM revision_counters').get();
 const command={operationId:'MOVE-1',scheduleItemId:id,resourceId:'PHOTO',plannedStart:'2026-10-02T05:30:00.000Z',plannedEnd:'2026-10-02T06:30:00.000Z',expectedScheduleRevision:rev.schedule_revision,expectedProjectionRevision:rev.projection_revision,configDigest:f.config.configDigest};
 assert.equal(f.service.reschedule({principal:viewer,command}).code,'FORBIDDEN');assert.equal(f.service.reschedule({principal:elsewhere,command}).code,'FORBIDDEN');const moved=f.service.reschedule({principal:executor,command});assert.equal(moved.ok,true,JSON.stringify(moved));assert.equal(moved.receipt.scheduleItemId,id);
 const receipt=f.service.readReceipt({principal:viewer,command:{operationId:'MOVE-1'}});assert.equal(receipt.ok,true);assert.equal(receipt.receipt.resourceId,'PHOTO');assert.equal(Object.hasOwn(receipt.receipt,'actor'),false);assert.equal(f.service.readReceipt({principal:elsewhere,command:{operationId:'MOVE-1'}}).code,'FORBIDDEN');
 f.disable();assert.equal(f.service.reschedule({principal:executor,command}).code,'WRITE_ADMISSION_DISABLED');
 }finally{f.db.close();}
});
test('calendar range rejects malformed dates, reversed ranges and more than366 days',()=>{
 const f=fixture();try{for(const [startDate,endDate] of [['2026-02-30','2026-03-01'],['2026-10-11','2026-10-10'],['2026-01-01','2027-01-02']])assert.equal(f.service.previewCalendar({principal:viewer,command:{resourceId:'PHOTO',startDate,endDate}}).ok,false);}finally{f.db.close();}
});

test('trusted expiry or admission closure at commit rolls back atomic adoption and reschedule',()=>{
 for(const gate of ['false','throw','admission']) {const f=fixture();try {
  const command=adoption(getPreview(f));const before=f.state();
  const executionGuard=()=>{if(gate==='throw')throw Error('expiry');if(gate==='admission'){f.disable();return false;}return false;};
  if(gate==='throw')assert.throws(()=>f.service.adoptProposal({principal:executor,command,executionGuard}),/expiry/);
  else assert.equal(f.service.adoptProposal({principal:executor,command,executionGuard}).code,'AGENT_EXECUTION_WINDOW_CLOSED');
  assert.equal(f.state(),before);
 }finally{f.db.close();}}
 const f=fixture();try {
  const adopted=f.service.adoptProposal({principal:executor,command:adoption(getPreview(f))});settleConfirmed(f);const rev=f.db.prepare('SELECT * FROM revision_counters').get();
  const command={operationId:'MOVE-EXPIRY',scheduleItemId:adopted.receipt.adoptedItems[0].scheduleItemId,resourceId:'PHOTO',plannedStart:'2026-10-02T05:30:00.000Z',plannedEnd:'2026-10-02T06:30:00.000Z',expectedScheduleRevision:rev.schedule_revision,expectedProjectionRevision:rev.projection_revision,configDigest:f.config.configDigest};
  const before=f.state();assert.equal(f.service.reschedule({principal:executor,command,executionGuard:()=>false}).code,'AGENT_EXECUTION_WINDOW_CLOSED');assert.equal(f.state(),before);
 }finally{f.db.close();}
});

test('adopting an existing stale draft leaves its lifecycle and receipt history untouched',()=>{
 const f=fixture();try {
  const preview=getPreview(f), command=adoption(preview);
  assert.equal(f.proposalStore.generate(f.command,executor.subjectId).ok,true);
  f.db.exec('UPDATE revision_counters SET schedule_revision=1,projection_revision=1 WHERE id=1');
  const before=f.state();assert.equal(f.service.adoptProposal({principal:executor,command}).ok,false);assert.equal(f.state(),before);
  assert.equal(f.db.prepare('SELECT status FROM scheduling_proposals').get().status,'draft');
 }finally{f.db.close();}
});

for (const kind of ['proposalDecision','reschedule']) for (const corruption of ['digest','noncanonical','malformed']) {
 test(`receipt reconciliation rejects ${kind} ${corruption} corruption without writing`,()=>{
  const f=fixture();try {
   const adopted=f.service.adoptProposal({principal:executor,command:adoption(getPreview(f))});assert.equal(adopted.ok,true);
   let operationId='ADOPT-1', table='scheduling_proposal_decisions';
   if(kind==='reschedule') {
    settleConfirmed(f);const rev=f.db.prepare('SELECT * FROM revision_counters').get();operationId='MOVE-CORRUPT';table='schedule_reschedule_operations';
    assert.equal(f.service.reschedule({principal:executor,command:{operationId,scheduleItemId:adopted.receipt.adoptedItems[0].scheduleItemId,resourceId:'PHOTO',plannedStart:'2026-10-02T05:30:00.000Z',plannedEnd:'2026-10-02T06:30:00.000Z',expectedScheduleRevision:rev.schedule_revision,expectedProjectionRevision:rev.projection_revision,configDigest:f.config.configDigest}}).ok,true);
   }
   // Synthetic corruption deliberately bypasses immutability; production access never does.
   f.db.exec(`DROP TRIGGER ${table}_no_update`);
   if(corruption==='digest') f.db.prepare(`UPDATE ${table} SET receipt_digest=?`).run('sha256:'+'0'.repeat(64));
   if(corruption==='noncanonical') f.db.exec(`UPDATE ${table} SET receipt_json=' '||receipt_json`);
   if(corruption==='malformed') {
    if(kind==='reschedule') f.db.exec('PRAGMA ignore_check_constraints=ON');
    f.db.exec(`UPDATE ${table} SET receipt_json='invalid'`);
   }
   const before=f.state();assert.equal(f.service.readReceipt({principal:viewer,command:{operationId}}).code,'AGENT_RECEIPT_INTEGRITY_FAILED');assert.equal(f.state(),before);
  }finally{f.db.close();}
 });
}
for(const operationId of ['ADOPT-1','GEN-1'])test(`receipt ${operationId} validates associated proposal rather than trusting its scope JSON`,()=>{
 const f=fixture();try {
  assert.equal(f.service.adoptProposal({principal:executor,command:adoption(getPreview(f))}).ok,true);
  f.db.exec('DROP TRIGGER scheduling_proposals_content_immutable; DROP TRIGGER scheduling_proposals_terminal_sealed;');
  const p=JSON.parse(f.db.prepare('SELECT proposal_json FROM scheduling_proposals').get().proposal_json);p.resourceScope=['OTHER'];
  f.db.prepare('UPDATE scheduling_proposals SET proposal_json=?').run(JSON.stringify(p));
  const before=f.state();assert.equal(f.service.readReceipt({principal:elsewhere,command:{operationId}}).code,'AGENT_RECEIPT_INTEGRITY_FAILED');assert.equal(f.state(),before);
 }finally{f.db.close();}
});
