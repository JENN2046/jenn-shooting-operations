import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
const tables=['requests_v2','schedule_items','schedule_item_tasks','production_runs','production_events','operations','audit_log','revision_counters','snapshot_projections','scheduling_proposals','scheduling_proposal_decisions','notification_outbox'];
const snapshot=f=>JSON.stringify(tables.map(t=>f.server.store.db.prepare(`SELECT * FROM ${t}`).all()));
async function fixture(){
 const f=await launch();const rows=await scheduleOrders(f,2),s=rows[0],v=await f.state();
 assert.equal(s.resourceResolutionStatus,'resolved');assert.equal(s.allocationMode,'single');assert.ok(Object.hasOwn(s,'legacyPlaceText'));assert.ok(Object.hasOwn(s,'note'));
 const command={operationId:'CANCEL-SYNTHETIC-001',scheduleItemId:s.id,requestId:s.requestIds[0],resourceId:f.resourceId,expectedScheduleRevision:v.revisions.scheduleRevision,expectedProjectionRevision:v.revisions.projectionRevision,configDigest:v.configs.find(c=>c.active).configDigest,reasonCode:'OWNER_CONFIRMED_NOT_STARTED',reasonNote:'Synthetic Owner confirms this test never started and is void.'};
 return Object.assign(f,{rows,command,path:`/api/v3/business/schedule-items/${s.id}/cancel`});
}
test('authenticated cancellation retains history/binding/time, closes order/session once, audits, recovers original receipt, no run/notification',async()=>{
 const f=await fixture();try{
  f.setTime('2026-10-13T00:00:00.000Z'); // Past unstarted orders remain cancellable with explicit Owner intent.
  const db=f.server.store.db,bindings=JSON.stringify(db.prepare('SELECT * FROM schedule_item_tasks').all()),other=JSON.stringify(db.prepare('SELECT * FROM schedule_items WHERE id<>?').all(f.command.scheduleItemId));
  const result=await f.ok(f.path,f.command),r=result.receipt;
  assert.equal(r.actor,'Jenn');assert.equal(r.before.scheduleStatus,'confirmed');assert.equal(r.after.scheduleStatus,'cancelled');assert.equal(r.after.requestLifecycle,'cancelled');assert.equal(r.notificationStatus,'NOT_ENQUEUED_EXTERNAL_DELIVERY_DISABLED');
  assert.equal(r.scheduleRevision,f.command.expectedScheduleRevision+1);assert.equal(r.projectionRevision,f.command.expectedProjectionRevision+1);
  assert.equal(r.before.plannedStart,r.after.plannedStart);assert.equal(r.before.plannedEnd,r.after.plannedEnd);assert.equal(r.before.bufferAfterMinutes,r.after.bufferAfterMinutes);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM schedule_item_tasks').all()),bindings);assert.equal(JSON.stringify(db.prepare('SELECT * FROM schedule_items WHERE id<>?').all(f.command.scheduleItemId)),other);
  assert.equal(db.prepare('SELECT count(*) n FROM production_runs').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM production_events').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM notification_outbox').get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_log WHERE action='business.cancel.v3'").get().n,1);
  const after=snapshot(f);assert.equal((await f.ok(f.path,f.command)).exactReplay,true);assert.equal(snapshot(f),after);
  assert.deepEqual((await f.ok('/api/v3/business/operations/'+f.command.operationId)).receipt,r);
  assert.equal((await f.call('/api/v3/business/operations/'+f.command.operationId,null,'b'.repeat(40))).status,403);
  const proposal=await f.ok('/api/v3/business/proposals',{operationId:'PLAN-AFTER-CANCEL',planningWindowStart:'2026-10-13T00:00:00.000Z',planningWindowEnd:'2026-10-13T16:00:00.000Z',resourceScope:[f.resourceId]});assert.ok(!JSON.parse(proposal.proposal.proposedItemsJson).some(i=>i.requestId===f.command.requestId));
 }finally{f.close();}
});
test('historical unknown occupancy still blocks until explicit cancellation; new future session preview then works',async()=>{
 const f=await fixture();try{
  const db=f.server.store.db,s=f.rows[1];db.prepare('UPDATE schedule_items SET planned_start=?,planned_end=? WHERE id=?').run('2026-10-13T01:00:00.000Z','2026-10-13T01:30:00.000Z',s.id);f.setTime('2026-10-12T16:00:00.000Z');
  const input={scheduleItemId:s.id,resourceId:f.resourceId,mode:'plan',plannedStart:'2026-10-13T01:15:00.000Z',endAt:'2026-10-13T01:45:00.000Z',bufferAfterMinutes:20};
  const before=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(before.preview.canApply,false);assert.ok(before.preview.unresolved.some(x=>x.code==='OTHER_RUN_END_UNKNOWN'&&x.scheduleItemId===f.command.scheduleItemId));
  await f.ok(f.path,f.command);const after=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(after.preview.canApply,true,JSON.stringify(after));assert.equal(after.preview.changes.length,1);assert.equal(after.preview.changes[0].after.scheduleItemId,s.id);
 }finally{f.close();}
});
for(const [name,mutate,code] of [
 ['stale schedule',f=>f.command.expectedScheduleRevision--,'SCHEDULING_REVISION_CONFLICT'],
 ['stale projection',f=>f.command.expectedProjectionRevision--,'SCHEDULING_REVISION_CONFLICT'],
 ['wrong config',f=>f.command.configDigest='sha256:'+'0'.repeat(64),'CANCEL_CONFIG_CONFLICT'],
 ['wrong resource',f=>f.command.resourceId='OTHER','FORBIDDEN'],
 ['wrong binding',f=>f.command.requestId=f.rows[1].requestIds[0],'CANCEL_REQUEST_MISMATCH'],
 ['locked',f=>f.server.store.db.prepare("UPDATE schedule_items SET lock_status='locked' WHERE id=?").run(f.command.scheduleItemId),'CANCEL_ITEM_IMMUTABLE'],
 ['any run history',f=>f.server.store.db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,status,run_revision,created_at,updated_at) VALUES('CANCEL-OLD-RUN',?,'block','cancelled',0,?,?)").run(f.command.scheduleItemId,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z'),'CANCEL_ITEM_IMMUTABLE'],
 ['closed request',f=>f.server.store.db.prepare("UPDATE requests_v2 SET request_lifecycle='cancelled' WHERE id=?").run(f.command.requestId),'CANCEL_REQUEST_IMMUTABLE'],
 ['invalid reason',f=>f.command.reasonCode='FORCE_COMPLETE','CANCEL_COMMAND_INVALID'],
 ['extra command field',f=>f.command.bypass=true,'CANCEL_COMMAND_INVALID'],
 ['shared order',f=>f.server.store.db.prepare('INSERT INTO schedule_item_tasks VALUES(?,?,2,?,?)').run(f.rows[1].id,f.command.requestId,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z'),'CANCEL_REQUEST_SHARED'],
 ])test(`reject ${name} atomically`,async()=>{const f=await fixture();try{mutate(f);const before=snapshot(f),r=await f.call(f.path,f.command);assert.equal(r.body.code,code,JSON.stringify(r));assert.equal(snapshot(f),before);}finally{f.close();}});
test('actual HTTP auth, path binding, conflicting ID and projection fault cause no writes',async()=>{
 const f=await fixture();try{
  const before=snapshot(f);
  for(const token of ['bad','b'.repeat(40),'c'.repeat(40)])assert.ok((await f.call(f.path,f.command,token)).status>=400);assert.equal(snapshot(f),before);
  assert.equal((await f.call(f.path,{...f.command,scheduleItemId:f.rows[1].id})).body.code,'PATH_COMMAND_MISMATCH');assert.equal(snapshot(f),before);
  assert.equal((await f.call(f.path,{...f.command,operationId:'ACCEPT-TEST'})).body.code,'IDEMPOTENCY_KEY_REUSE');assert.equal(snapshot(f),before);
  const db=f.server.store.db;db.exec("CREATE TEMP TRIGGER cancel_projection_fault BEFORE INSERT ON snapshot_projections BEGIN SELECT RAISE(ABORT,'synthetic cancellation fault'); END");assert.ok((await f.call(f.path,f.command)).status>=500);assert.equal(snapshot(f),before);db.exec('DROP TRIGGER cancel_projection_fault');
  await f.ok(f.path,f.command);const after=snapshot(f);assert.equal((await f.call(f.path,{...f.command,reasonNote:'different intent'})).body.code,'IDEMPOTENCY_KEY_REUSE');assert.equal(snapshot(f),after);
 }finally{f.close();}
});
test('write freeze and pending delivery block cancellation without changing historical notification',async()=>{
 const f=await fixture();try{
  const {createBusinessCancelV3}=await import('../src/business-cancel-v3.mjs');const {createTrustedPrincipal}=await import('../src/authorization-v2.mjs');const before=snapshot(f);const frozen=createBusinessCancelV3({db:f.server.store.db,now:()=>new Date('2026-10-12T00:00:00.000Z'),refreshProjections:()=>{throw Error('must not project while frozen');},writeAdmission:()=>false});assert.equal(frozen({command:f.command,principal:createTrustedPrincipal({subjectId:'Jenn',role:'administrator',resourceIds:[f.resourceId]}).principal}).code,'WRITE_ADMISSION_DISABLED');assert.equal(snapshot(f),before);
  const {buildScheduleConfirmedCardV1}=await import('../src/dingtalk-card-builders-v1.mjs');const {buildNotificationIntentV1}=await import('../src/outbox-contract-v1.mjs');const {createSqliteOutboxRepositoryV1}=await import('../src/sqlite-outbox-repository-v1.mjs');
  const s=f.rows[0],db=f.server.store.db,card=buildScheduleConfirmedCardV1({scheduleItemId:s.id,resourceId:f.resourceId,plannedStart:s.plannedStart,plannedEnd:s.plannedEnd,taskCount:1,scheduleRevision:f.command.expectedScheduleRevision});assert.equal(card.ok,true);
  const intent=buildNotificationIntentV1({outboxId:'out_cancel_synthetic',intentType:'schedule.confirmed.v1',aggregateType:'schedule_item',aggregateId:s.id,routeKey:'operations.default',aggregateRevisionScope:'schedule',aggregateRevision:f.command.expectedScheduleRevision,cardSchemaVersion:card.cardSchemaVersion,payload:card.card,createdAt:'2026-10-12T00:00:00.000Z'});assert.equal(intent.ok,true);
  db.exec('BEGIN');assert.equal(createSqliteOutboxRepositoryV1({db}).enqueue(intent.intent).ok,true);db.exec('COMMIT');const queued=snapshot(f);assert.equal((await f.call(f.path,f.command)).body.code,'CANCEL_NOTIFICATION_IN_FLIGHT');assert.equal(snapshot(f),queued);
 }finally{f.close();}
});
