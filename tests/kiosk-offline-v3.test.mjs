import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineFixture,browserStorage,binding,token,identities} from './support/kiosk-offline-fixture.mjs';
import {kioskCommandV3,createKioskTransportV3} from '../public/kiosk-queue-protocol-v3.js';
import {createBrowserQueueStorage,createKioskOfflineQueue} from '../public/kiosk-offline-queue-v2.js';
function queueFor(f,local=browserStorage(),options={}){
 const calls=[];const transport=createKioskTransportV3({binding,getToken:()=>token,fetchImpl:async(url,init)=>{
  calls.push({url,init});const r=await f.callKiosk(url,init.body?JSON.parse(init.body):undefined,init.headers.Authorization.slice(7));
  if(options.loseResponse&&init.method==='POST'){options.loseResponse=false;throw Error('synthetic lost response');}
  return {status:r.status,json:async()=>r.body};
 }});
 const storage=createBrowserQueueStorage({storage:local,key:'SYNTHETIC-V3:'+JSON.stringify(binding),protocolVersion:3});
 return {q:createKioskOfflineQueue({storage,transport,clock:()=>new Date('2026-10-12T03:00:00.000Z')}),storage,local,calls};
}
test('device-declared start and complete preserve time, immutable commands, original versions and receipts across next-day replay',async()=>{
 const f=await offlineFixture();try{
  f.setReceivedAt('2026-10-13T00:30:00.000Z');
  const a=f.item(),b=f.item('complete'),qa=queueFor(f);assert.ok(qa.q.enqueue(a).ok);assert.ok(qa.q.enqueue(b).ok);
  const restored=queueFor(f,qa.local),r=await restored.q.replay({resourceId:binding.resourceId});assert.equal(r.pendingCount,0,JSON.stringify(r));assert.equal(f.count(),2);
  const start=await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3(a));assert.equal(start.body.replayed,true);assert.equal(start.body.startedAt,a.occurredAt);assert.equal(start.body.recordedAt,'2026-10-13T00:30:00.000Z');assert.equal(start.body.timeSource,'device-declared');
  assert.deepEqual(start.body.command,kioskCommandV3(a));assert.equal(start.body.scheduleRevision,a.expectedScheduleRevision);
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3(b))).body.completedAt,b.occurredAt);
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...kioskCommandV3(a),occurredAt:'2026-10-12T01:01:00.000Z'})).body.code,'IDEMPOTENCY_KEY_REUSE');
  f.setReceivedAt('2026-10-20T00:00:00.000Z');assert.equal((await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3(a))).body.replayed,true);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,0);
 }finally{f.close();}
});
test('lost response keeps original queue head; reload queries receipt without a second POST, then completes in order',async()=>{
 const f=await offlineFixture();try{
  const original=queueFor(f,undefined,{loseResponse:true});original.q.enqueue(f.item());original.q.enqueue(f.item('complete'));
  const r=await original.q.replay({resourceId:binding.resourceId});assert.equal(r.pendingCount,2);assert.equal(f.count(),1);
  const restored=queueFor(f,original.local);const done=await restored.q.replay({resourceId:binding.resourceId});assert.equal(done.pendingCount,0);assert.equal(f.count(),2);
  assert.equal(restored.calls.filter(c=>c.init.method==='POST').length,1);assert.equal(JSON.parse(restored.calls.find(c=>c.init.method==='POST').init.body).eventId,f.item('complete').eventId);
 }finally{f.close();}
});
test('time window and future skew stop at review without dropping or modifying either queued record',async()=>{
 for(const occurredAt of ['2026-10-11T02:59:59.999Z','2026-10-12T03:05:00.001Z']){
  const f=await offlineFixture();try{
   const qa=queueFor(f),a=f.item('start',{occurredAt});qa.q.enqueue(a);qa.q.enqueue(f.item('complete'));
   const r=await qa.q.replay({resourceId:binding.resourceId});assert.equal(r.syncStatus,'reviewRequired');assert.equal(r.pendingCount,2);assert.equal(f.count(),0);assert.deepEqual(qa.q.inspect().items[0],a);
  }finally{f.close();}
 }
});
test('changed schedule/run versions and invalid event order preserve original head and all following records',async()=>{
 for(const mode of ['schedule','run','order']){
  const f=await offlineFixture();try{
   const a=f.item(),b=f.item('complete',mode==='order'?{occurredAt:'2026-10-12T00:59:59.000Z'}:{}),qa=queueFor(f);qa.q.enqueue(a);qa.q.enqueue(b);
   if(mode==='schedule')f.server.store.db.exec('UPDATE revision_counters SET schedule_revision=schedule_revision+1 WHERE id=1');
   if(mode==='run')assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...kioskCommandV3(a),eventId:'EXTERNAL-START-001'})).status,200);
   const r=await qa.q.replay({resourceId:binding.resourceId});assert.equal(r.syncStatus,'conflict');
   const items=qa.q.inspect().items;assert.deepEqual(items.at(-1),b);if(mode!=='order')assert.deepEqual(items[0],a);
   assert.equal(r.pendingCount,mode==='order'?1:2);
  }finally{f.close();}
 }
});
test('revoked identity, different identity and mismatched receipts never acknowledge or transfer records',async()=>{
 const f=await offlineFixture();try{
  const qa=queueFor(f);const a=f.item();qa.q.enqueue(a);f.revoke();
  const r=await qa.q.replay({resourceId:binding.resourceId});assert.equal(r.pendingCount,1);assert.equal(r.serverStatus.httpStatus,401);assert.deepEqual(qa.q.inspect().items,[a]);
  const other=createKioskTransportV3({binding,getToken:()=>identities[1].token,fetchImpl:async(url,init)=>{const r=await f.callKiosk(url,undefined,identities[1].token);return {status:r.status,json:async()=>r.body};}});
  assert.equal((await other.refreshCurrent()).status,401);
  const separate=createBrowserQueueStorage({storage:qa.local,key:'SYNTHETIC-V3:OTHER',protocolVersion:3});assert.equal(separate.load(),null);
 }finally{f.close();}
});
test('new device-time contract does not permit administrator or original online backdating; rollback remains atomic',async()=>{
 const f=await offlineFixture();try{
  const a=f.item(),command=kioskCommandV3(a);
  assert.equal((await f.call('/api/v3/business/run-events',command)).body.code,'INVALID_RUN_EVENT_COMMAND');
  const {recordingMode,...missingMode}=command;assert.equal((await f.callKiosk('/api/v3/kiosk/events',missingMode)).status,422);
  const online=kioskCommandV3({...a,recordingMode:'server-received'}),r=await f.callKiosk('/api/v3/kiosk/events',online);
  assert.equal(r.body.source,'kiosk-online-v3');assert.equal(r.body.startedAt,'2026-10-12T03:00:00.000Z');assert.equal(r.body.command,undefined);
 }finally{f.close();}
 const g=await offlineFixture();try{
  const before=g.server.store.db.prepare('SELECT * FROM revision_counters').get();
  g.server.store.db.exec("CREATE TEMP TRIGGER offline_fail BEFORE INSERT ON operations WHEN NEW.kind='kiosk.online.run.v3' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.equal((await g.callKiosk('/api/v3/kiosk/events',kioskCommandV3(g.item()))).status,500);assert.equal(g.count(),0);
  assert.deepEqual(g.server.store.db.prepare('SELECT * FROM revision_counters').get(),before);
 }finally{g.close();}
});
test('queue storage failure blocks send, V2 remains separate, and a mismatched successful receipt stays a conflict',async()=>{
 const local=browserStorage();local.setItem('jenn.kiosk.offline-queue.v2','PRESERVE-LEGACY');
 const f=await offlineFixture();try{
  const qa=queueFor(f,local);local.setItem=()=>{throw Error('synthetic full storage');};
  assert.equal(qa.q.enqueue(f.item()).ok,false);assert.equal(qa.calls.length,0);assert.equal(local.getItem('jenn.kiosk.offline-queue.v2'),'PRESERVE-LEGACY');
  const bad=createKioskTransportV3({binding,getToken:()=>token,fetchImpl:async()=>({status:200,json:async()=>({ok:true,code:'RUN_EVENT_APPLIED',eventId:f.item().eventId})})});
  const result=await bad.submitEvent(f.item());assert.equal(result.status,409);assert.equal(result.body.code,'IDEMPOTENCY_KEY_REUSE');
 }finally{f.close();}
});

test('completed actual runs prevent overlapping or out-of-order retrospective starts on the same resource',async()=>{
 const f=await offlineFixture();try{
  const first={...f.item(),recordingMode:'server-received'};f.setReceivedAt('2026-10-12T01:00:00.000Z');
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3(first))).status,200);
  f.setReceivedAt('2026-10-12T01:30:00.000Z');assert.equal((await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3({...first,eventId:'ONLINE-COMPLETE-A',eventType:'complete',expectedRunRevision:1}))).status,200);
  f.setReceivedAt('2026-10-12T03:00:00.000Z');const second=f.day.sessions[1];
  const a=f.item('start',{scheduleItemId:second.id,eventId:'OFFLINE-START-B',runId:'OFFLINE-RUN-B',occurredAt:'2026-10-12T01:10:00.000Z'});
  const b=f.item('complete',{scheduleItemId:second.id,eventId:'OFFLINE-COMPLETE-B',runId:a.runId,occurredAt:'2026-10-12T01:20:00.000Z'});
  const qa=queueFor(f);qa.q.enqueue(a);qa.q.enqueue(b);const r=await qa.q.replay({resourceId:binding.resourceId});
  assert.equal(r.stopCode,'RUN_EVENT_TIME_RESOURCE_CONFLICT');assert.equal(r.syncStatus,'conflict');assert.deepEqual(qa.q.inspect().items,[a,b]);assert.equal(f.count(),2);
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...kioskCommandV3(a),occurredAt:'2026-10-12T00:30:00.000Z'})).body.code,'RUN_EVENT_TIME_RESOURCE_CONFLICT');
  // An adjacent start is allowed; no overlap or historical reorder is introduced.
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...kioskCommandV3(a),occurredAt:'2026-10-12T01:30:00.000Z'})).status,200);
 }finally{f.close();}
});

test('future-skew declared completion blocks overlapping online and administrator starts but permits adjacency',async()=>{
 const f=await offlineFixture();try{
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3(f.item()))).status,200);
  const end=f.item('complete',{occurredAt:'2026-10-12T03:04:00.000Z'});
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',kioskCommandV3(end))).status,200);
  const second=f.day.sessions[1],online=kioskCommandV3(f.item('start',{scheduleItemId:second.id,eventId:'NEXT-ONLINE-START',runId:'NEXT-ONLINE-RUN',recordingMode:'server-received'}));
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',online)).body.code,'RUN_EVENT_TIME_RESOURCE_CONFLICT');
  f.setTime('2026-10-12T03:00:00.000Z');const {expectedScheduleRevision,...admin}=online;
  assert.equal((await f.call('/api/v3/business/run-events',admin)).body.code,'RUN_EVENT_TIME_RESOURCE_CONFLICT');
  assert.equal(f.count(),2);f.setReceivedAt('2026-10-12T03:04:00.000Z');
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',online)).status,200);
  assert.equal(f.count(),3);
 }finally{f.close();}
});

test('legacy server-received queue items only look up receipts: no automatic POST, no conversion, later exact receipt recovers',async()=>{
 const f=await offlineFixture();try{
  const a=f.item('start',{recordingMode:'server-received'}),qa=queueFor(f);qa.q.enqueue(a);
  const first=await qa.q.replay({resourceId:binding.resourceId});
  assert.equal(first.stopCode,'LEGACY_ONLINE_EVENT_REVIEW_REQUIRED');assert.equal(first.pendingCount,1);assert.equal(first.syncStatus,'pending');
  assert.deepEqual(qa.q.inspect().items,[a]);assert.equal(qa.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(f.count(),0);
  // An original request previously in flight arrives unchanged; a subsequent lookup can acknowledge it.
  f.setReceivedAt('2026-10-12T01:00:00.000Z');const original=kioskCommandV3(a);
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',original)).status,200);
  assert.equal((await qa.q.replay({resourceId:binding.resourceId})).pendingCount,0);
  assert.equal(qa.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(f.count(),1);
  const converted=kioskCommandV3({...a,recordingMode:'device-declared'});
  assert.equal((await f.callKiosk('/api/v3/kiosk/events',converted)).body.code,'IDEMPOTENCY_KEY_REUSE');
 }finally{f.close();}
});
test('existing mixed-mode queue with missing legacy receipt remains intact instead of creating a later server-timed start',async()=>{
 const f=await offlineFixture();try{
  const a=f.item('start',{recordingMode:'server-received'}),b=f.item('complete'),qa=queueFor(f);qa.q.enqueue(a);qa.q.enqueue(b);
  const r=await qa.q.replay({resourceId:binding.resourceId});assert.equal(r.stopCode,'LEGACY_ONLINE_EVENT_REVIEW_REQUIRED');
  assert.deepEqual(qa.q.inspect().items,[a,b]);assert.equal(f.count(),0);assert.equal(qa.calls.filter(c=>c.init.method==='POST').length,0);
 }finally{f.close();}
});
