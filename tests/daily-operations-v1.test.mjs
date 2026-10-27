import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDailyOperations} from '../src/daily-operations-v1.mjs';
import {createBusinessSchedulingApplication} from '../src/business-scheduling-application-v1.mjs';
import {createWriteAdmissionControl} from '../src/write-admission-v1.mjs';
import {createTrustedPrincipal} from '../src/authorization-v2.mjs';
import {createApplyRunEvent} from '../src/run-event-use-case-v2.mjs';
import {createSqliteRunEventStore} from '../src/sqlite-run-event-store-v2.mjs';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
import {studioDayFixture,databaseFacts,studioNow} from './support/studio-day-fixture.mjs';

test('real Schema12 facts project today/current/next and ready orders without any persistent write',async()=>{
 const f=await studioDayFixture();try{
  const db=f.server.store.db,before=databaseFacts(db),changes=db.prepare('SELECT total_changes() AS n').get().n;
  const daily=await f.ok('/api/v3/business/daily-operations');
  assert.equal(daily.date,'2026-10-12');assert.equal(daily.timeZone,'Asia/Shanghai');
  assert.equal(daily.todaySessions.length,4);assert.equal(daily.summary.completed,1);assert.equal(daily.summary.shooting,1);assert.equal(daily.summary.pending,2);
  assert.equal(daily.currentSession.scheduleItemId,f.current.id);assert.equal(daily.nextSession.scheduleItemId,f.next.id);
  assert.equal(daily.currentSession.confirmedForecast.operationId,'STUDIO-FORECAST');
  assert.equal(daily.currentSession.completedAt,null);
  assert.deepEqual(new Set(daily.readyUnscheduledOrders.map(r=>r.id)),new Set([f.extras.readyOne,f.extras.readyTwo]));
  const find=(code,id)=>daily.attentionQueue.find(item=>item.code===code&&item.entityId===id);
  for(const [code,id]of [['UNSCHEDULED_READY',f.extras.readyOne],['SAMPLE_NOT_READY',f.extras.sample],['DURATION_MISSING',f.extras.missing],['PAST_CONFIRMED_WITHOUT_RUN_FACT',f.past.id],['DESIRED_DATE_AT_RISK',f.extras.readyOne]])assert.ok(find(code,id),code);
  for(const item of daily.attentionQueue)for(const key of ['code','severity','entityType','entityId','summary','recommendedAction','reason','sourceFacts'])assert.ok(item[key]);
  assert.deepEqual(daily,await f.ok('/api/v3/business/daily-operations'));
  assert.equal(databaseFacts(db),before);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,changes);
  f.setTime('2026-10-12T14:00:00.000Z');const overdue=await f.ok('/api/v3/business/daily-operations');
  assert.equal(overdue.summary.completed,1);assert.equal(overdue.currentSession.runStatus,'shooting');
  assert.equal(overdue.nextSession.scheduleItemId,f.next.id);assert.equal(databaseFacts(db),before);
 }finally{f.close();}
});

test('scope, exact calendar dates, duplicate/unknown query rejection and Shanghai default day',async()=>{
 const f=await studioDayFixture();try{
  const before=databaseFacts(f.server.store.db);
  assert.equal((await f.call('/api/v3/business/daily-operations',undefined,'bad')).status,401);
  const other=await f.call('/api/v3/business/daily-operations',undefined,'b'.repeat(40));
  assert.equal(other.status,200);assert.deepEqual(other.body.todaySessions,[]);assert.deepEqual(other.body.readyUnscheduledOrders,[]);
  for(const query of ['date=2026-02-30','date=2026-13-01','date=','date=2026-1-1'])assert.equal((await f.call('/api/v3/business/daily-operations?'+query)).status,422);
  for(const query of ['date=2026-10-12&date=2026-10-13','principal=admin','date=2026-10-12&mode=write'])assert.equal((await f.call('/api/v3/business/daily-operations?'+query)).status,400);
  const old=await f.ok('/api/v3/business/daily-operations?date=2026-10-11');assert.equal(old.todaySessions[0].runStatus,'notStarted');assert.equal(old.currentSession,null);
  f.setTime('2026-10-12T16:01:00.000Z');assert.equal((await f.ok('/api/v3/business/daily-operations')).date,'2026-10-13');
  assert.equal(databaseFacts(f.server.store.db),before);
 }finally{f.close();}
});

test('blocked is an actual run fact; disabled admission remains readable; deterministic ordering survives input order',async()=>{
 const f=await studioDayFixture();try{
  const db=f.server.store.db;
  const apply=createApplyRunEvent({store:createSqliteRunEventStore({db,businessTimeZone:'Asia/Shanghai'}),clock:()=>new Date(studioNow),eventTimePolicy:()=>({ok:true}),auditRole:'administrator',notifications:'disabled'});
  assert.equal(apply({eventId:'STUDIO-BLOCK',runId:'STUDIO-RUN-2',scheduleItemId:f.current.id,eventType:'block',expectedRunRevision:1,
   occurredAt:studioNow,deviceId:'SYNTHETIC-STUDIO',actorId:'Jenn',reasonCode:'sampleWaiting',note:null}).ok,true);
  const snapshot=await f.state(),before=databaseFacts(db);
  const app=createBusinessSchedulingApplication({db,writeAdmissionControl:createWriteAdmissionControl({initialMode:'disabled'}),clock:()=>new Date(studioNow),refreshProjections:()=>assert.fail('projection write'),proposalStore:{}});
  const principal=createTrustedPrincipal({subjectId:'Jenn',role:'administrator',resourceIds:[f.resourceId]}).principal;
  const daily=app.readDailyOperations({principal});assert.equal(daily.currentSession.runStatus,'blocked');assert.equal(daily.attentionQueue[0].code,'BLOCKED_RUN');
  assert.ok(daily.attentionQueue.some(item=>item.code==='WRITE_ADMISSION_DISABLED'));
  const shuffled={...snapshot,writeAdmission:'disabled',sessions:[...snapshot.sessions].reverse(),orderFacts:[...snapshot.orderFacts].reverse(),requests:[...snapshot.requests].reverse()};
  assert.deepEqual(projectDailyOperations(shuffled,{now:studioNow}),JSON.parse(JSON.stringify(daily)));
  assert.equal(databaseFacts(db),before);
 }finally{f.close();}
});

test('confirmed forecast outside the canonical work window is attention, never completion or overtime authority',async()=>{
 const f=await launch();try{
  const [s]=await scheduleOrders(f,1);f.setTime(s.plannedStart);
  await f.ok('/api/v3/business/run-events',{eventId:'OUTSIDE-START',runId:'OUTSIDE-RUN',scheduleItemId:s.id,eventType:'start',expectedRunRevision:0});
  const input={scheduleItemId:s.id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,endAt:'2026-10-12T11:00:00.000Z',bufferAfterMinutes:20};
  const preview=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(preview.preview.canApply,true);
  await f.ok('/api/v3/business/day-adjustment/apply',{operationId:'OUTSIDE-FORECAST',input,previewDigest:preview.previewDigest});
  const before=databaseFacts(f.server.store.db),daily=await f.ok('/api/v3/business/daily-operations');
  const issue=daily.attentionQueue.find(item=>item.code==='FORECAST_OUTSIDE_WINDOW');assert.ok(issue);assert.equal(issue.sourceFacts.confirmedForecast.operationId,'OUTSIDE-FORECAST');
  assert.equal(daily.currentSession.completedAt,null);assert.equal(daily.summary.completed,0);assert.equal(databaseFacts(f.server.store.db),before);
 }finally{f.close();}
});

test('duration reuses active fallback rules, cancelled bindings release readiness, and ambiguous occupancy stays explicit',async()=>{
 const f=await studioDayFixture();try{
  const facts=await f.state(),config=facts.configs.find(c=>c.active).configJson;
  const currentOrder=facts.orderFacts.find(order=>order.id===f.current.requestIds[0]);
  currentOrder.references=[{id:'SYNTHETIC-REFERENCE',name:'参考图.png',contentType:'image/png',size:128}];
  config.durationFallbackRules=[{ruleId:'STUDIO-DEFAULT',productionType:'平面',shootingSubtype:'产品3D主图',durationMs:1800000}];
  facts.sessions.find(s=>s.id===f.later.id).bufferAfterMinutes=null;
  const daily=projectDailyOperations(facts,{now:studioNow});
  assert.equal(daily.currentSession.referenceImagesAvailable,true);
  assert.deepEqual(daily.currentSession.referenceImages,currentOrder.references);
  assert.ok(daily.readyUnscheduledOrders.some(r=>r.id===f.extras.missing&&r.duration.durationSource==='fallback'));
  assert.ok(!daily.readyUnscheduledOrders.some(r=>r.id===f.extras.sample));
  assert.ok(daily.attentionQueue.some(item=>item.code==='UNKNOWN_OCCUPANCY'&&item.entityId===f.later.id));
  const current=facts.sessions.find(s=>s.id===f.current.id);current.status='cancelled';
  assert.equal(projectDailyOperations(facts,{now:studioNow}).currentSession,null);
  current.status='confirmed';current.bufferAfterMinutes=null;
  assert.equal(projectDailyOperations(facts,{now:studioNow}).currentSession.runStatus,'shooting','unknown plan occupancy cannot erase a real shooting fact');
  assert.ok(projectDailyOperations(facts,{now:studioNow}).attentionQueue.some(item=>item.code==='UNKNOWN_OCCUPANCY'&&item.entityId===current.id));
  facts.sessions.find(session=>session.id===f.next.id).runs=[{id:'SYNTHETIC-CONFLICT',status:'shooting',runRevision:1,startedAt:studioNow,completedAt:null}];
  const ambiguous=projectDailyOperations(facts,{now:studioNow});assert.equal(ambiguous.currentSession,null);
  assert.ok(ambiguous.attentionQueue.some(item=>item.code==='UNKNOWN_OCCUPANCY'&&item.entityType==='day'));
 }finally{f.close();}
});
