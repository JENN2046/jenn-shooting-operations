import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
const time=t=>`2026-10-12T${t}:00.000Z`;
const add=(t,m)=>new Date(Date.parse(t)+m*60000).toISOString();
const preview=(f,input)=>f.call('/api/v3/business/day-adjustment/preview',input);
const input=(f,s,endAt=time('03:10'))=>({scheduleItemId:s.id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,endAt,bufferAfterMinutes:20});
const event=(s,id)=>({eventId:`START-${id}`,runId:`RUN-${id}`,scheduleItemId:s.id,eventType:'start',expectedRunRevision:0});
const actualFacts=f=>JSON.stringify(['production_runs','production_events'].map(t=>f.server.store.db.prepare(`SELECT * FROM ${t} ORDER BY ${t==='production_runs'?'id':'event_id'}`).all()));
const planFacts=(f,id)=>JSON.stringify(f.server.store.db.prepare('SELECT * FROM schedule_items WHERE id=?').get(id));
const allFacts=f=>JSON.stringify(['schedule_items','production_runs','production_events','revision_counters','operations','schedule_reschedule_operations'].map(t=>f.server.store.db.prepare(`SELECT * FROM ${t}`).all()));

for(const [label,offset] of [['early',-10],['on-time',0],['late',10]])test(`admin ${label} start → forecast preview → confirm moves successors without changing plan or actual facts`,async()=>{
 const f=await launch();try{
  let sessions=await scheduleOrders(f,3);
  // Move the first reservation to 10:00 through the real preview/confirm API.
  const plan={...input(f,sessions[0],time('02:30')),mode:'plan',plannedStart:time('02:00')};
  const p=await f.ok('/api/v3/business/day-adjustment/preview',plan);assert.equal(p.preview.canApply,true);
  await f.ok('/api/v3/business/day-adjustment/apply',{operationId:`PLAN-${label}`,input:plan,previewDigest:p.previewDigest});
  sessions=(await f.state()).sessions;const anchor=sessions[0],startedAt=add(anchor.plannedStart,offset),start=event(anchor,label);
  f.setTime(startedAt);const accepted=await f.ok('/api/v3/business/run-events',start);assert.equal(accepted.startedAt,startedAt);
  f.setTime(add(startedAt,5));const originalPlan=planFacts(f,anchor.id),originalActual=actualFacts(f),i=input(f,anchor);
  const before=allFacts(f),forecast=await f.ok('/api/v3/business/day-adjustment/preview',i);
  assert.equal(forecast.preview.canApply,true,JSON.stringify(forecast));assert.equal(allFacts(f),before);
  assert.equal(forecast.preview.forecast.actualFactsChanged,false);
  assert.ok(forecast.preview.changes.length>0);assert.ok(forecast.preview.changes.every(c=>c.after.scheduleItemId!==anchor.id));
  assert.equal(forecast.preview.changes[0].after.plannedStart,time('05:30'));
  const command={operationId:`FORECAST-${label}`,input:i,previewDigest:forecast.previewDigest};
  await f.ok('/api/v3/business/day-adjustment/apply',command);
  assert.equal(planFacts(f,anchor.id),originalPlan);assert.equal(actualFacts(f),originalActual);
  for(const {after} of forecast.preview.changes){const saved=f.server.store.db.prepare('SELECT planned_start,planned_end FROM schedule_items WHERE id=?').get(after.scheduleItemId);assert.equal(saved.planned_start,after.plannedStart);assert.equal(saved.planned_end,after.plannedEnd);}
  assert.equal((await f.ok('/api/v3/business/day-adjustment/apply',command)).exactReplay,true);
 }finally{f.close();}
});

test('forecast rejects unstarted, future actual start, completed and invalid time windows without writes',async()=>{
 const f=await launch();try{
  const [s]=await scheduleOrders(f,2),i=input(f,s),start=event(s,'admission');
  f.setTime(add(s.plannedStart,5));let before=allFacts(f);assert.equal((await preview(f,i)).body.code,'DYNAMIC_FORECAST_NOT_CURRENT');assert.equal(allFacts(f),before);
  await f.ok('/api/v3/business/run-events',start);before=allFacts(f);
  f.setTime(s.plannedStart);assert.equal((await preview(f,i)).body.code,'DYNAMIC_FORECAST_NOT_CURRENT');assert.equal(allFacts(f),before);
  f.setTime(add(s.plannedStart,10));
  for(const endAt of [add(s.plannedStart,10),'2026-10-13T03:00:00.000Z'])assert.equal((await preview(f,{...i,endAt})).body.code,'DYNAMIC_TODAY_ONLY');
  assert.equal(allFacts(f),before);
  f.setTime(s.plannedEnd);await f.ok('/api/v3/business/run-events',{...start,eventId:'COMPLETE-admission',eventType:'complete',expectedRunRevision:1});before=allFacts(f);
  assert.equal((await preview(f,i)).body.code,'DYNAMIC_FORECAST_NOT_CURRENT');assert.equal(allFacts(f),before);
 }finally{f.close();}
});

for(const [label,completeAt,startAt,canApply] of [
 ['early-overlap',time('01:10'),time('01:40'),false],
 ['actual-buffer-overlap',time('01:35'),time('01:50'),false],
 ['released-predecessor',time('01:10'),time('01:50'),true],
])test(`actual forecast occupancy retains fixed predecessor reservation and actual completion buffer: ${label}`,async()=>{
 const f=await launch();try{
  const [a,b]=await scheduleOrders(f,3);assert.equal(b.plannedStart,time('01:50'));
  const first=event(a,`first-${label}`);f.setTime(a.plannedStart);await f.ok('/api/v3/business/run-events',first);
  f.setTime(completeAt);await f.ok('/api/v3/business/run-events',{...first,eventId:`COMPLETE-${label}`,eventType:'complete',expectedRunRevision:1});
  f.setTime(startAt);await f.ok('/api/v3/business/run-events',event(b,`second-${label}`));f.setTime(add(startAt,5));
  const i=input(f,b,time('02:50')),before=allFacts(f),p=await f.ok('/api/v3/business/day-adjustment/preview',i);
  assert.equal(p.preview.canApply,canApply,JSON.stringify(p));assert.equal(allFacts(f),before);
  if(!canApply){assert.ok(p.preview.unresolved.some(x=>x.code==='PREDECESSOR_ORDER_CONFLICT'&&x.scheduleItemId===a.id));assert.equal((await f.call('/api/v3/business/day-adjustment/apply',{operationId:`APPLY-${label}`,input:i,previewDigest:p.previewDigest})).body.code,'DYNAMIC_UNRESOLVED');assert.equal(allFacts(f),before);}
 }finally{f.close();}
});
