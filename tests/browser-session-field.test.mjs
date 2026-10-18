import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
import {createBrowserSessionOptionsFromEnv} from '../src/browser-session-v1.mjs';
import {createHttpApp} from '../src/http-app.mjs';
import {createSchedulingV2Application} from '../src/server.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';
import {createOwnerFieldV1} from '../src/owner-field-v1.mjs';
import {runtimeConfigDigest} from '../src/g3-core-startup-acceptance.mjs';
import {createBrowserQueueStorage,createKioskOfflineQueue} from '../public/kiosk-offline-queue-v2.js';
import {createOwnerFieldTransportV1,kioskCommandV3} from '../public/kiosk-queue-protocol-v3.js';
import {browserStorage} from './support/kiosk-offline-fixture.mjs';
async function fixture(){
 const f=await launch({resourceId:'Jenn'});await scheduleOrders(f);let at=Date.parse('2026-10-12T03:00:00.000Z');
 const env={...process.env,JSO_BROWSER_SESSION_RUNTIME:'enabled',JSO_BROWSER_ORIGIN:'https://synthetic.example',JSO_BROWSER_SESSION_TTL_MS:'600000',JSO_BROWSER_SESSION_IDLE_MS:'300000'};
 const {schedulingAuthenticate}=createBusinessRuntimeOptionsFromEnv(env);
 let runtime,app;
 const reboot=()=>{runtime=createBrowserSessionOptionsFromEnv(env,{now:()=>at}).browserSessionRuntime;const scheduling=createSchedulingV2Application({store:f.server.store,authenticate:r=>runtime.hasCookie(r)?runtime.authenticate(r):schedulingAuthenticate(r),clock:()=>new Date(at)});app=createHttpApp({store:f.server.store,scheduling,browserSessionRuntime:runtime,ownerField:createOwnerFieldV1({store:f.server.store,runtime,clock:()=>new Date(at)})});};reboot();
 let cookie='',csrf='',binding;
 async function call(path,body,extra={},auth=true){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=body?'POST':'GET';req.socket={remoteAddress:'synthetic'};req.headers={...(auth&&cookie?{cookie}:{}),...(body?{'content-type':'application/json',origin:env.JSO_BROWSER_ORIGIN,...(auth&&csrf?{'x-jso-csrf':csrf}:{})}:{}),...(binding?{'x-jso-field-binding':JSON.stringify([binding.subjectId,binding.deviceId,binding.resourceId])}:{}),...extra};let status,headers={},result;await app(req,{setHeader(k,v){headers[k]=v;},writeHead(s,h){status=s;Object.assign(headers,h);},end(b){result=JSON.parse(b);}});return {status,headers,body:result};}
 async function login(token='a'.repeat(40),deviceId='BROWSER-SYNTHETIC-001'){const r=await call('/api/v3/session/login',{token,deviceId});if(r.status===200){cookie=r.headers['set-cookie'].split(';')[0];csrf=r.body.csrfToken;binding={subjectId:r.body.principal.subjectId,deviceId:r.body.deviceId,resourceId:r.body.resourceId};}return r;}
 const item=(type='start',extra={})=>({schemaVersion:4,eventId:type==='start'?'OWNER-START-001':'OWNER-COMPLETE-001',runId:'OWNER-RUN-001',scheduleItemId:f.sessions?.[0]?.id,eventType:type,expectedRunRevision:type==='start'?0:1,expectedScheduleRevision:1,occurredAt:type==='start'?'2026-10-12T01:00:00.000Z':'2026-10-12T01:30:00.000Z',recordingMode:'device-declared',...binding,localSequence:type==='start'?0:1,...extra});
 const count=()=>f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n;
 return {...f,env,call,login,item,count,reboot,get app(){return app;},get runtime(){return runtime;},get binding(){return binding;},get cookie(){return cookie;},get csrf(){return csrf;},setAt:v=>at=Date.parse(v)};
}
test('protected admin Cookie restores same Jenn view, csrf/origin isolation, logout/revoke/expiry/reboot fail closed',async()=>{
 const f=await fixture();try{
  const r=await f.login();assert.equal(r.status,200,JSON.stringify(r));assert.match(r.headers['set-cookie'],/Secure; HttpOnly; SameSite=Strict/);assert.equal(r.body.principal.subjectId,'Jenn');assert.ok(!JSON.stringify(r.body).includes('a'.repeat(40)));
  assert.equal((await f.call('/api/v3/session')).body.authenticated,true);assert.equal((await f.call('/api/v3/business/state')).status,200);
  const who=await f.call('/api/v3/field/identity');assert.equal(who.body.role,'administrator');assert.equal(who.body.subjectId,'Jenn');assert.equal(who.body.protocolVersion,4);
  assert.equal((await f.call('/api/v3/session/logout',{}, {'x-jso-csrf':''})).status,403);
  assert.equal((await f.call('/api/v3/session/logout',{}, {origin:'https://other.example'})).status,403);
  assert.equal((await f.call('/api/v3/field/events',{}, {'x-jso-csrf':''})).status,403);assert.equal(f.count(),0);
  assert.equal((await f.call('/api/v3/field/day',undefined,{'x-jso-field-binding':'["Other","DEVICE-OTHER-001","Jenn"]'})).status,409);
  assert.equal((await f.call('/api/v3/business/state',undefined,{authorization:'Bearer '+'a'.repeat(40)})).status,401);
  assert.equal((await f.call('/api/v3/session/logout',{})).status,200);assert.equal((await f.call('/api/v3/field/identity')).status,401);
  await f.login();f.runtime.revokeSubject('Jenn');assert.equal((await f.call('/api/v3/field/identity')).status,401);
  await f.login();f.setAt('2026-10-12T03:06:00.000Z');assert.equal((await f.call('/api/v3/session')).body.authenticated,false);
  await f.login();f.reboot();assert.equal((await f.call('/api/v3/session')).body.authenticated,false);assert.equal((await f.login()).status,200);
  f.env.JSO_BUSINESS_IDENTITIES_JSON='[]';assert.equal((await f.call('/api/v3/session')).body.authenticated,false);
 }finally{f.close();}
});
test('owner device queue reuses core: Jenn actor and device timestamps, lost receipt, logout and same-context recovery without duplicate POST',async()=>{
 const f=await fixture();try{
  await f.login();const day=(await f.call('/api/v3/field/day')).body;assert.equal(day.ok,true);const a=f.item('start',{scheduleItemId:day.sessions[0].id,expectedScheduleRevision:day.revisions.scheduleRevision}),b=f.item('complete',{scheduleItemId:day.sessions[0].id,expectedScheduleRevision:day.revisions.scheduleRevision});
  const local=browserStorage();let posted=0,lose=true;const calls=[];
  const transport=()=>createOwnerFieldTransportV1({binding:f.binding,fetchImpl:async(path,init)=>{const r=await f.call(path,init.body?JSON.parse(init.body):undefined,init.headers);calls.push({path,status:r.status,body:r.body});if(init.method==='POST'){posted++;if(lose){lose=false;throw Error('synthetic response lost');}}return {status:r.status,json:async()=>r.body};}});
  const queue=()=>createKioskOfflineQueue({storage:createBrowserQueueStorage({storage:local,key:'jso.field.owner:'+JSON.stringify(f.binding),protocolVersion:4}),transport:transport(),clock:()=>new Date('2026-10-12T03:00:00.000Z')});
  const q=queue();assert.equal(q.enqueue(a).ok,true);assert.equal(q.enqueue(b).ok,true);assert.equal(f.count(),0);
  const replay=await q.replay({resourceId:'Jenn'});assert.equal(replay.pendingCount,2);assert.equal(f.count(),1,JSON.stringify({replay,calls}));
  await f.call('/api/v3/session/logout',{});assert.equal((await queue().replay({resourceId:'Jenn'})).pendingCount,2);assert.equal(posted,1);
  await f.login();assert.equal((await queue().replay({resourceId:'Jenn'})).pendingCount,0);assert.equal(f.count(),2);assert.equal(posted,2);
  const rows=f.server.store.db.prepare('SELECT actor_id,device_id,occurred_at FROM production_events ORDER BY rowid').all();assert.ok(rows.every(x=>x.actor_id==='Jenn'&&x.device_id===f.binding.deviceId));assert.deepEqual(rows.map(x=>x.occurred_at),[a.occurredAt,b.occurredAt]);
  const receipt=await f.call('/api/v3/field/events/'+a.eventId);assert.equal(receipt.body.source,'owner-device-declared-v1');assert.equal(receipt.body.actor,'Jenn');
  assert.equal((await f.call('/api/v3/business/run-events',kioskCommandV3(a))).body.code,'INVALID_RUN_EVENT_COMMAND');
 }finally{f.close();}
});
test('session login rejects hostile origin and non-admin; default runtime unchanged, enabled settings bound to R5',async()=>{
 assert.deepEqual(createBrowserSessionOptionsFromEnv({}),{});const off={JSO_KIOSK_ONLINE_RUNTIME:'disabled'};assert.equal(runtimeConfigDigest(off,5),runtimeConfigDigest({...off,JSO_BROWSER_SESSION_RUNTIME:'disabled'},5));
 const f=await fixture();try{assert.equal((await f.call('/api/v3/session/login',{token:'a'.repeat(40),deviceId:'BROWSER-SYNTHETIC-001'},{origin:'https://other.example'},false)).status,403);assert.equal((await f.login('c'.repeat(40))).status,401);for(const v of [3,4,5])assert.notEqual(runtimeConfigDigest(f.env,v),runtimeConfigDigest({...f.env,JSO_BROWSER_SESSION_RUNTIME:'disabled'},v));}finally{f.close();}
});
test('personal field refuses changed actor/device/resource, stale revisions, forbidden time and disabled writes without partial facts',async()=>{
 const f=await fixture();try{
  await f.login();const d=(await f.call('/api/v3/field/day')).body;const item=f.item('start',{scheduleItemId:d.sessions[0].id,expectedScheduleRevision:d.revisions.scheduleRevision});const command=kioskCommandV3(item);
  assert.equal((await f.call('/api/v3/field/events',{...command,expectedScheduleRevision:0})).body.code,'SCHEDULING_REVISION_CONFLICT');assert.equal(f.count(),0);
  assert.equal((await f.call('/api/v3/field/events',{...command,occurredAt:'2025-01-01T00:00:00.000Z'})).body.ok,false);assert.equal(f.count(),0);
  const disabled=createOwnerFieldV1({store:{db:f.server.store.db,writeAdmissionControl:{isDisabled:()=>true}},runtime:f.runtime,clock:()=>new Date('2026-10-12T03:00:00.000Z')});assert.equal(disabled.record(f.runtime.fieldIdentity({headers:{cookie:f.cookie}}),command).code,'WRITE_ADMISSION_DISABLED');assert.equal(f.count(),0);
  assert.equal((await f.call('/api/v3/field/events',command)).status,200);assert.equal(f.count(),1);
  assert.equal((await f.call('/api/v3/field/events',command)).body.replayed,true);assert.equal(f.count(),1);
  assert.equal((await f.call('/api/v3/field/events',{...command,occurredAt:'2026-10-12T01:01:00.000Z'})).body.code,'IDEMPOTENCY_KEY_REUSE');assert.equal(f.count(),1);
  await f.login('a'.repeat(40),'BROWSER-SYNTHETIC-002');assert.equal((await f.call('/api/v3/field/events/'+item.eventId)).status,403);
  await f.login('b'.repeat(40));assert.equal((await f.call('/api/v3/field/events/'+item.eventId)).status,403);assert.equal(f.count(),1);
 }finally{f.close();}
});
test('registered session runtime rejects forged options and fails closed on malformed credential config',async()=>{
 const {requireBrowserSessionRuntime}=await import('../src/browser-session-v1.mjs');assert.throws(()=>requireBrowserSessionRuntime({matchesConfig:()=>true}),/RUNTIME_INVALID/);
 const f=await fixture();try{await f.login();f.env.JSO_BUSINESS_IDENTITIES_JSON='malformed';assert.equal((await f.call('/api/v3/session')).body.authenticated,false);}finally{f.close();}
});
test('actual server factory binds enabled session config to accepted source/runtime and prohibits PREPARED sessions',async()=>{
 const {coreFixture}=await import('./support/greenfield-core-fixture.mjs');const {pathToFileURL}=await import('node:url');
 const saved=Object.fromEntries(['JSO_BROWSER_SESSION_RUNTIME','JSO_BROWSER_ORIGIN'].map(k=>[k,process.env[k]]));let f,server;
 try{
  process.env.JSO_BROWSER_SESSION_RUNTIME='enabled';process.env.JSO_BROWSER_ORIGIN='https://synthetic.example';
  f=await coreFixture({schemaVersion:12});const {createBrowserSessionOptionsFromEnv:make}=await import(pathToFileURL(f.app+'/src/browser-session-v1.mjs'));
  const runtime=make(process.env).browserSessionRuntime;
  assert.throws(()=>f.server('disabled',{browserSessionRuntime:runtime}),/BROWSER_SESSION_CONFIG/);
  f.activate();server=f.server('enabled',{browserSessionRuntime:runtime});server.store.close();server=null;
  assert.throws(()=>f.server('enabled'),/BROWSER_SESSION_CONFIG/);
  process.env.JSO_BROWSER_ORIGIN='https://changed.example';assert.throws(()=>f.server('enabled',{browserSessionRuntime:runtime}),/BROWSER_SESSION_RUNTIME_INVALID/);
 }finally{server?.store.close();f?.close();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('same subject with separate credential scopes never acquires another credential scope',async()=>{
 const env={JSO_BUSINESS_RUNTIME:'enabled',JSO_BROWSER_SESSION_RUNTIME:'enabled',JSO_BROWSER_ORIGIN:'https://synthetic.example',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{subjectId:'Jenn',role:'administrator',resourceIds:['Jenn','Other'],token:'w'.repeat(40)},{subjectId:'Jenn',role:'administrator',resourceIds:['Jenn'],token:'n'.repeat(40)}])};
 const r=createBrowserSessionOptionsFromEnv(env).browserSessionRuntime;const req=Readable.from([Buffer.from(JSON.stringify({token:'n'.repeat(40),deviceId:'BROWSER-SCOPE-001'}))]);req.method='POST';req.headers={origin:env.JSO_BROWSER_ORIGIN,'content-type':'application/json'};let cookie;
 await r.handle(req,{writeHead(s,h){assert.equal(s,200);cookie=h['set-cookie'].split(';')[0];},end(){}},new URL(env.JSO_BROWSER_ORIGIN+'/api/v3/session/login'));
 assert.deepEqual(r.authenticate({headers:{cookie}}).resourceIds,['Jenn']);
});
test('revoke/expiry/config change while body is gated blocks field, business, proposal and upload commits',async()=>{
 const f=await fixture();try{
 for(const mode of ['revoke','logout','expiry','config'])for(const path of ['/api/v3/field/events','/api/v3/business/run-events','/api/v3/proposals/PROPOSAL-SYNTHETIC/decisions','/api/v3/business/references?operationId=UPLOAD-SYNTHETIC']){
  f.setAt('2026-10-12T03:00:00.000Z');await f.login();const day=(await f.call('/api/v3/field/day')).body;
  const body=path.includes('references')?Buffer.from([137,80,78,71]):Buffer.from(JSON.stringify(path.includes('/field/')?kioskCommandV3(f.item('start',{scheduleItemId:day.sessions[0].id,expectedScheduleRevision:day.revisions.scheduleRevision})):{}));
  let proceed,ready;const gate=new Promise(r=>proceed=r),started=new Promise(r=>ready=r);
  const req=Readable.from((async function*(){yield body;ready();await gate;})());req.method='POST';req.url=path;req.headers={cookie:f.cookie,origin:f.env.JSO_BROWSER_ORIGIN,'content-type':path.includes('references')?'image/png':'application/json','x-jso-csrf':f.csrf,'x-jso-field-binding':JSON.stringify([f.binding.subjectId,f.binding.deviceId,f.binding.resourceId])};
  let status,result;const running=f.app(req,{setHeader(){},writeHead(s){status=s;},end(b){result=JSON.parse(b);}});await started;
  const original=f.env.JSO_BUSINESS_IDENTITIES_JSON;if(mode==='revoke')f.runtime.revokeSubject('Jenn');else if(mode==='logout')await f.call('/api/v3/session/logout',{});else if(mode==='expiry')f.setAt('2026-10-12T03:11:00.000Z');else f.env.JSO_BUSINESS_IDENTITIES_JSON='[]';
  proceed();await running;assert.equal(status,401,JSON.stringify({mode,path,status,result}));assert.equal(f.count(),0);assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM uploads').get().n,0);f.env.JSO_BUSINESS_IDENTITIES_JSON=original;
 }
 }finally{f.close();}
});
