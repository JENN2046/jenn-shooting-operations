import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {createHttpApp} from '../src/http-app.mjs';
import {createKioskOnlineRuntimeV3,createKioskOnlineOptionsFromEnv} from '../src/kiosk-online-runtime-v3.mjs';
import {createKioskOnlineV3} from '../src/kiosk-online-v3.mjs';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
const TOKEN='KIOSK-SYNTHETIC-OPERATOR-NOT-PRODUCTION-001';
const identity={token:TOKEN,subjectId:'OPERATOR-TEST-001',deviceId:'DEVICE-TEST-001',resourceId:'JSO-BIZ-RESOURCE-001'};
async function setup(){
 const f=await launch();let at='2026-10-12T01:00:00.000Z';
 const runtime=createKioskOnlineRuntimeV3({identities:[identity,{...identity,token:'OTHER-DEVICE-SYNTHETIC-ONLY-0000001',deviceId:'DEVICE-TEST-002',resourceId:'OTHER-RESOURCE'}]});
 const online=createKioskOnlineV3({store:f.server.store,runtime,clock:()=>new Date(at)});
 const app=createHttpApp({store:f.server.store,kioskOnline:online});
 const call=async(path,body,token=TOKEN)=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url=path;req.method=body===undefined?'GET':'POST';req.headers={authorization:'Bearer '+token};let status,raw;
  raw='';const res=new Writable({write(chunk,encoding,done){raw+=chunk.toString();done();}});res.setHeader=()=>{};res.writeHead=s=>{status=s;};const finished=new Promise(resolve=>res.on('finish',resolve));
  await app(req,res);await finished;let result;try{result=JSON.parse(raw);}catch{result=raw;}return {status,body:result};
 };
 return {...f,online,callKiosk:call,setKioskTime:v=>at=v};
}
const command=(s,revision,type='start')=>({eventId:'KIOSK-EVENT-START-001',runId:s.run?.id??'KIOSK-RUN-TEST-001',scheduleItemId:s.id,eventType:type,expectedRunRevision:s.run?.runRevision??0,expectedScheduleRevision:revision});
test('online runtime is explicit, operator-only, scoped, distinct from business credentials',()=>{
 assert.deepEqual(createKioskOnlineOptionsFromEnv({}),{});
 assert.throws(()=>createKioskOnlineRuntimeV3({identities:[{...identity,role:'administrator'}]}),/INVALID/);
 assert.throws(()=>createKioskOnlineRuntimeV3({identities:[identity],forbiddenTokens:[TOKEN]}),/INVALID/);
 assert.throws(()=>createKioskOnlineRuntimeV3({identities:[identity,identity]}),/INVALID/);
 assert.throws(()=>createKioskOnlineOptionsFromEnv({JSO_KIOSK_ONLINE_RUNTIME:'enabled',JSO_KIOSK_ONLINE_IDENTITIES_JSON:JSON.stringify([identity]),JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:TOKEN}])}),/INVALID/);
 const runtime=createKioskOnlineRuntimeV3({identities:[identity]});const who=runtime.authenticate({headers:{authorization:'Bearer '+TOKEN}});
 assert.equal(who.principal.role,'operator');assert.equal(who.principal.capabilities.administer,false);assert.equal(who.principal.capabilities.modifySchedule,false);
});
test('five categories, device identity, resource isolation and legacy protocol gate remain explicit',async()=>{
 const f=await setup();try{
 await scheduleOrders(f,5);
 const r=await f.callKiosk('/api/v3/kiosk/day');assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.body.sessions.length,5);assert.equal(new Set(r.body.sessions.flatMap(s=>s.tasks.map(t=>t.shootingSubtype))).size,5);
 assert.equal(r.body.resourceId,identity.resourceId);assert.equal(r.body.subjectId,identity.subjectId);
 assert.match((await f.callKiosk('/kiosk')).body,/kiosk-online-v3.js/);
 assert.equal((await f.callKiosk('/api/v2/updates')).body.code,'CLIENT_PROTOCOL_UPGRADE_REQUIRED');
 assert.equal((await f.callKiosk('/api/v3/kiosk/day',undefined,'a'.repeat(40))).status,401);
 assert.equal((await f.callKiosk('/api/v3/kiosk/day?resourceId=OTHER')).status,400);
 assert.equal((await f.call('/api/v3/business/state',undefined,TOKEN)).status,401);
 assert.equal((await f.call('/api/v3/business/run-events',{},TOKEN)).status,401);
 assert.equal((await f.callKiosk('/api/v3/kiosk/day',undefined,'OTHER-DEVICE-SYNTHETIC-ONLY-0000001')).status,403);
 const cmd=command(r.body.sessions[0],r.body.revisions.scheduleRevision);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',cmd,'OTHER-DEVICE-SYNTHETIC-ONLY-0000001')).status,403);
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n,0);
 }finally{f.close();}
});
test('online events: stale revisions, duplicate requests, lost response lookup, complete and actor/device provenance',async()=>{
 const f=await setup();try{
 await scheduleOrders(f,1);let day=(await f.callKiosk('/api/v3/kiosk/day')).body;
 const cmd=command(day.sessions[0],day.revisions.scheduleRevision);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...cmd,expectedScheduleRevision:0})).body.code,'SCHEDULING_REVISION_CONFLICT');
 const first=await f.callKiosk('/api/v3/kiosk/events',cmd);assert.equal(first.status,200,JSON.stringify(first));
 assert.equal(first.body.source,'kiosk-online-v3');assert.equal(first.body.deviceId,identity.deviceId);assert.equal(first.body.actor,identity.subjectId);
 const repeat=await f.callKiosk('/api/v3/kiosk/events',cmd);assert.equal(repeat.body.replayed,true);assert.equal(repeat.body.startedAt,first.body.startedAt);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events/'+cmd.eventId)).body.replayed,true);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events/'+cmd.eventId,undefined,'OTHER-DEVICE-SYNTHETIC-ONLY-0000001')).status,403);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events/KIOSK-EVENT-UNKNOWN')).status,404);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...cmd,eventType:'complete'})).body.code,'IDEMPOTENCY_KEY_REUSE');
 day=(await f.callKiosk('/api/v3/kiosk/day')).body;
 const complete={...command(day.sessions[0],day.revisions.scheduleRevision,'complete'),eventId:'KIOSK-EVENT-COMPLETE-001'};
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...complete,expectedRunRevision:0})).status,409);
 f.setKioskTime('2026-10-12T01:30:00.000Z');const done=await f.callKiosk('/api/v3/kiosk/events',complete);assert.equal(done.status,200,JSON.stringify(done));
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',complete)).body.replayed,true);
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n,2);
 const events=f.server.store.db.prepare('SELECT actor_id,device_id FROM production_events').all();assert.ok(events.every(x=>x.actor_id===identity.subjectId&&x.device_id===identity.deviceId));
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,0);
 }finally{f.close();}
});
test('online API enforces write admission, today boundary, supported state and command shape',async()=>{
 const f=await setup();try{
 await scheduleOrders(f,1);const d=(await f.callKiosk('/api/v3/kiosk/day')).body,cmd=command(d.sessions[0],d.revisions.scheduleRevision);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...cmd,deviceId:'FORGED-DEVICE'})).status,422);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',{...cmd,eventType:'block'})).status,422);
 f.setKioskTime('2026-10-13T01:00:00.000Z');assert.equal((await f.callKiosk('/api/v3/kiosk/day')).body.sessions.length,0);
 assert.equal((await f.callKiosk('/api/v3/kiosk/events',cmd)).body.code,'KIOSK_TODAY_ONLY');
 const store=f.server.store;const disabled={isDisabled:()=>true,status:()=>({mode:'disabled'})};
 const app=createHttpApp({store:{...store,db:store.db,writeAdmissionControl:disabled},kioskOnline:{...f.online,writeAdmissionControl:disabled}});
 const req=Readable.from([Buffer.from(JSON.stringify(cmd))]);req.method='POST';req.url='/api/v3/kiosk/events';req.headers={authorization:'Bearer '+TOKEN};let status;
 await app(req,{setHeader(){},writeHead(s){status=s;},end(){}});assert.equal(status,503);
 assert.equal(store.db.prepare('SELECT count(*) n FROM production_events').get().n,0);
 }finally{f.close();}
});

test('prospective startup accepts only branded Schema12 online runtime; PREPARED stays read-only',async()=>{
 const {coreFixture}=await import('./support/greenfield-core-fixture.mjs');
 const {pathToFileURL}=await import('node:url');const {join}=await import('node:path');
 for(const version of [11,12]){
  const f=await coreFixture({schemaVersion:version,kioskIdentities:[identity]});let server;
  try{
   const {createKioskOnlineRuntimeV3:make}=await import(pathToFileURL(join(f.app,'src/kiosk-online-runtime-v3.mjs')));
   const runtime=make({identities:[identity]});
   assert.throws(()=>f.server('disabled',{kioskOnlineRuntime:{version:3}}),/KIOSK_V3_RUNTIME_REQUIRED/);
   assert.throws(()=>f.server('disabled',{kioskOnlineRuntime:runtime,kioskAuthenticate:()=>null}),/LEGACY_RUNTIME_CONFLICT/);
   if(version===11)assert.throws(()=>f.server('disabled',{kioskOnlineRuntime:runtime}),/SCHEMA12_REQUIRED/);
   else {assert.throws(()=>f.server('disabled',{kioskOnlineRuntime:make({identities:[{...identity,deviceId:'DIFFERENT-DEVICE'}]})}),/KIOSK_CONFIG/);server=f.server('disabled',{kioskOnlineRuntime:runtime});assert.equal(server.store.readOnly,true);assert.equal(server.writeAdmissionControl.isDisabled(),true);assert.equal(server.writeAdmissionControl.enable().ok,false);}
  }finally{server?.store.close();f.close();}
 }
});

test('all five Schema12 categories retain facts through online start/complete and exact replay',async()=>{
 const f=await setup();try{
  await scheduleOrders(f,5);
  for(let i=0;i<5;i++){
   let day=(await f.callKiosk('/api/v3/kiosk/day')).body;const s=day.sessions[i];f.setKioskTime(s.plannedStart);
   const start={...command(s,day.revisions.scheduleRevision),eventId:`FIVE-START-${i}`,runId:`FIVE-RUN-00${i}`};
   assert.equal((await f.callKiosk('/api/v3/kiosk/events',start)).status,200);
   day=(await f.callKiosk('/api/v3/kiosk/day')).body;f.setKioskTime(s.plannedEnd);
   const end={...command(day.sessions[i],day.revisions.scheduleRevision,'complete'),eventId:`FIVE-COMPLETE-${i}`};
   assert.equal((await f.callKiosk('/api/v3/kiosk/events',end)).status,200);
   assert.equal((await f.callKiosk('/api/v3/kiosk/events',end)).body.replayed,true);
  }
  const day=(await f.callKiosk('/api/v3/kiosk/day')).body;
  assert.ok(day.sessions.every(s=>s.state==='completed'));
  assert.equal(new Set(day.sessions.flatMap(s=>s.tasks.map(t=>t.shootingSubtype))).size,5);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n,10);
 }finally{f.close();}
});
