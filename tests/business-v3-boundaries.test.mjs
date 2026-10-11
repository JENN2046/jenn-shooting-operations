import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,submission,createOrder,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
const snapshot=f=>JSON.stringify(['requests_v2','operations','production_runs','production_events','revision_counters','snapshot_projections','schedule_items'].map(t=>f.server.store.db.prepare(`SELECT * FROM ${t}`).all()));
const time=t=>`2026-10-12T${t}:00.000Z`;
test('canonical intake checks real auth/scope, global ID/version, no guessed sample; unbound edit only',async()=>{const f=await launch();try{
 const rev=(await f.state()).revisions,cmd={submission:{...submission(0),sampleShelfId:'SYNTHETIC-SHELF'},expectedScheduleRevision:rev.scheduleRevision,expectedProjectionRevision:rev.projectionRevision};
 const before=snapshot(f);for(const token of ['bad','b'.repeat(40),'c'.repeat(40)])assert.ok((await f.call('/api/v3/business/requests',cmd,token)).status>=400);assert.equal(snapshot(f),before);
 const created=await f.ok('/api/v3/business/requests',cmd);
 assert.equal((await f.call('/api/v3/business/requests',{...cmd,submission:{...cmd.submission,name:'different'}})).body.code,'IDEMPOTENCY_KEY_REUSE');
 assert.equal((await f.call('/api/v3/business/requests',{...cmd,submission:submission(1)})).body.code,'SCHEDULING_REVISION_CONFLICT');
 const r=(await f.state()).revisions;const edit={requestId:created.requestId,submission:{...submission(0),operationId:'EDIT-SYNTHETIC',sampleStatus:'inTransit'},expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision};
 await f.ok('/api/v3/business/requests/edit',edit);
 assert.equal(f.server.store.db.prepare('SELECT sample_shelf_id FROM requests_v2 WHERE id=?').get(created.requestId).sample_shelf_id,'SYNTHETIC-SHELF');
 const g=await f.ok('/api/v3/business/proposals',{operationId:'PROPOSE-NOT-ARRIVED',planningWindowStart:time('00:00'),planningWindowEnd:'2026-10-12T16:00:00.000Z',resourceScope:[f.resourceId]});assert.equal(JSON.parse(g.proposal.proposedItemsJson).length,0);assert.match(g.proposal.diagnosticsJson,/SAMPLE_NOT_VERIFIED/);
 const r2=(await f.state()).revisions;assert.equal((await f.call('/api/v3/business/requests',{submission:{...submission(1),operationId:'PUBLISH-V3'},expectedScheduleRevision:r2.scheduleRevision,expectedProjectionRevision:r2.projectionRevision})).body.code,'IDEMPOTENCY_KEY_REUSE');
 assert.equal((await f.call('/api/v2/business/state')).body.code,'CLIENT_PROTOCOL_UPGRADE_REQUIRED');
}finally{f.close();}});
test('intake does not claim old assets; owned attachment accepted; write fault rolls back order, receipt and counters',async()=>{const f=await launch();try{
 const db=f.server.store.db;
 const asset=f.server.store.saveUpload({operationId:'SYNTHETIC-ORDER-0',originalName:'synthetic.txt',contentType:'text/plain',kind:'attachment',buffer:Buffer.from('SYNTHETIC attachment'),role:'administrator'});assert.equal(asset.status,201,JSON.stringify(asset));
 const assetId=asset.upload?.id??asset.id;assert.ok(assetId,JSON.stringify(asset));
 const r=(await f.state()).revisions;let cmd={submission:{...submission(1),uploadIds:[assetId]},expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision};assert.equal((await f.call('/api/v3/business/requests',cmd)).body.code,'INVALID_UPLOAD_REFERENCE');
 cmd={...cmd,submission:{...submission(0),uploadIds:[assetId]}};
 const before=snapshot(f);db.exec("CREATE TEMP TRIGGER synthetic_order_failure BEFORE UPDATE ON revision_counters BEGIN SELECT RAISE(ABORT,'synthetic'); END");assert.ok((await f.call('/api/v3/business/requests',cmd)).status>=400);assert.equal(snapshot(f),before);assert.equal(db.prepare('SELECT claimed_task_id FROM uploads WHERE id=?').get(assetId).claimed_task_id,null);db.exec('DROP TRIGGER synthetic_order_failure');
 const created=await f.ok('/api/v3/business/requests',cmd);assert.equal(db.prepare('SELECT claimed_task_id FROM uploads WHERE id=?').get(assetId).claimed_task_id,created.requestId);
}finally{f.close();}});
test('actual event identity, source and server time; exclusivity, replay, rollback, no backdating or historical rerun',async()=>{const f=await launch();try{
 const sessions=await scheduleOrders(f);f.setTime(sessions[0].plannedStart);
 const event={eventId:'START-BOUNDARY',runId:'RUN-BOUNDARY',scheduleItemId:sessions[0].id,eventType:'start',expectedRunRevision:0};
 for(const token of ['b'.repeat(40),'c'.repeat(40)])assert.equal((await f.call('/api/v3/business/run-events',event,token)).status,403);
 assert.equal((await f.call('/api/v3/business/run-events',{...event,occurredAt:'2000-01-01T00:00:00Z'})).body.code,'INVALID_RUN_EVENT_COMMAND');
 const db=f.server.store.db,before=snapshot(f);db.exec("CREATE TEMP TRIGGER synthetic_event_failure BEFORE INSERT ON production_events BEGIN SELECT RAISE(ABORT,'synthetic'); END");assert.ok((await f.call('/api/v3/business/run-events',event)).status>=400);assert.equal(snapshot(f),before);db.exec('DROP TRIGGER synthetic_event_failure');
 const start=await f.ok('/api/v3/business/run-events',event);assert.equal(start.startedAt,sessions[0].plannedStart);assert.equal((await f.ok('/api/v3/business/run-events',event)).replayed,true);
 assert.equal((await f.call('/api/v3/business/run-events',{...event,eventId:'START-OTHER-RUN',runId:'RUN-OTHER-001',scheduleItemId:sessions[1].id})).body.code,'RESOURCE_ALREADY_RUNNING');
 f.setTime(time('00:30'));assert.ok((await f.call('/api/v3/business/run-events',{...event,eventId:'COMPLETE-BACKWARDS',eventType:'complete',expectedRunRevision:1})).status>=400);
 f.setTime(sessions[0].plannedEnd);const done={...event,eventId:'COMPLETE-BOUNDARY',eventType:'complete',expectedRunRevision:1};await f.ok('/api/v3/business/run-events',done);assert.equal((await f.ok('/api/v3/business/run-events',done)).replayed,true);
 assert.ok((await f.call('/api/v3/business/run-events',{...event,eventId:'START-HISTORY',runId:'RUN-HISTORY'})).status>=400);
 const rows=db.prepare('SELECT actor_id,device_id FROM production_events').all();assert.ok(rows.every(r=>r.actor_id==='Jenn'&&r.device_id==='owner-management-v3'));
}finally{f.close();}});
test('newly adopted scenes preview lunch-aware chain, revalidate versions/run and reject impossible day atomically',async()=>{const f=await launch();try{
 const sessions=await scheduleOrders(f,5),db=f.server.store.db;
 const rev=(await f.state()).revisions;assert.equal((await f.call('/api/v3/business/requests/edit',{requestId:db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=?').get(sessions[0].id).task_id,submission:{...submission(0),operationId:'EDIT-BOUND'},expectedScheduleRevision:rev.scheduleRevision,expectedProjectionRevision:rev.projectionRevision})).body.code,'REQUEST_IMMUTABLE');
 f.setTime(sessions[0].plannedStart);const start={eventId:'START-PREVIEW',runId:'RUN-PREVIEW',scheduleItemId:sessions[0].id,eventType:'start',expectedRunRevision:0};await f.ok('/api/v3/business/run-events',start);
 const input={scheduleItemId:sessions[0].id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,endAt:time('04:10'),bufferAfterMinutes:25};
 const p=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(p.preview.canApply,true);assert.equal(p.preview.changes[0].after.plannedStart,time('05:30'));
 f.setTime(time('01:30'));await f.ok('/api/v3/business/run-events',{...start,eventId:'COMPLETE-PREVIEW',eventType:'complete',expectedRunRevision:1});
 const before=snapshot(f);assert.equal((await f.call('/api/v3/business/day-adjustment/apply',{operationId:'STALE-PREVIEW',input,previewDigest:p.previewDigest})).body.code,'DYNAMIC_PREVIEW_CHANGED');assert.equal(snapshot(f),before);
 const future=sessions[1],plan={...input,scheduleItemId:future.id,mode:'plan',plannedStart:time('08:30'),endAt:time('09:50')};const impossible=await f.ok('/api/v3/business/day-adjustment/preview',plan);assert.equal(impossible.preview.canApply,false);assert.equal((await f.call('/api/v3/business/day-adjustment/apply',{operationId:'IMPOSSIBLE-DAY',input:plan,previewDigest:impossible.previewDigest})).body.code,'DYNAMIC_UNRESOLVED');assert.equal(snapshot(f),before);
}finally{f.close();}});
test('notification policy receipt ID conflict rolls back adoption; existing pending confirmation still blocks dynamic changes',async()=>{
 const f=await launch();try{
  const active=(await f.state()).configs[0];
  await f.ok('/api/v3/business/config/publish',{operationId:'notification:ACCEPT-TEST',configVersion:'SYNTHETIC-RESERVED',algorithmVersion:'deterministic-scheduler-v2',calendarCompilerVersion:'calendar-compiler-v3',estimatePolicyVersion:'estimate-policy-v1',configJson:active.configJson,configDigest:active.configDigest});
  await assert.rejects(()=>scheduleOrders(f,2),/IDEMPOTENCY_KEY_REUSE/);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM schedule_items').get().n,0);
  assert.equal(f.server.store.db.prepare("SELECT count(*) n FROM operations WHERE operation_id='notification:ACCEPT-TEST'").get().n,0);
 }finally{f.close();}
 const g=await launch();try{
  const sessions=await scheduleOrders(g,2);const db=g.server.store.db;
  const {buildScheduleConfirmedCardV1}=await import('../src/dingtalk-card-builders-v1.mjs');
  const {buildNotificationIntentV1}=await import('../src/outbox-contract-v1.mjs');
  const {createSqliteOutboxRepositoryV1}=await import('../src/sqlite-outbox-repository-v1.mjs');
  const s=sessions[1],card=buildScheduleConfirmedCardV1({scheduleItemId:s.id,resourceId:g.resourceId,plannedStart:s.plannedStart,plannedEnd:s.plannedEnd,taskCount:1,scheduleRevision:2});assert.equal(card.ok,true);
  const built=buildNotificationIntentV1({outboxId:'out_synthetic-existing',intentType:'schedule.confirmed.v1',aggregateType:'schedule_item',aggregateId:s.id,routeKey:'operations.default',aggregateRevisionScope:'schedule',aggregateRevision:2,cardSchemaVersion:card.cardSchemaVersion,payload:card.card,createdAt:time('00:00')});assert.equal(built.ok,true);
  db.exec('BEGIN IMMEDIATE');assert.equal(createSqliteOutboxRepositoryV1({db}).enqueue(built.intent).ok,true);db.exec('COMMIT');
  const before=JSON.stringify(db.prepare('SELECT * FROM notification_outbox').all());
  const input={scheduleItemId:sessions[0].id,resourceId:g.resourceId,mode:'plan',plannedStart:time('01:00'),endAt:time('02:00'),bufferAfterMinutes:25};
  const p=await g.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(p.preview.canApply,false);assert.ok(p.preview.unresolved.some(i=>i.code==='FIXED_SUCCESSOR_CONFLICT'));
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM notification_outbox').all()),before);
 }finally{g.close();}
});
