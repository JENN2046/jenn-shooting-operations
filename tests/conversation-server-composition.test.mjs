import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeWritableSchema,MIGRATIONS} from '../src/sqlite-schema-v2.mjs';
import {createKioskServiceBindingV1} from '../src/kiosk-service-context-v1.mjs';
import {createOperationsServer} from '../src/server.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';
import {conversationFactoryFromEnv} from '../src/server-conversation.mjs';
const env={JSO_BUSINESS_RUNTIME:'enabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'owner'.padEnd(40,'x'),subjectId:'synthetic-owner',role:'administrator',resourceIds:['R']}]),JSO_AGENT_IDENTITIES_JSON:JSON.stringify([{token:'agent'.padEnd(40,'x'),subjectId:'synthetic-agent',mode:'executor',resourceIds:['R']}])};
test('direct composition rejects legacy kiosk before opening any store',t=>{
 const root=mkdtempSync(join(tmpdir(),'jso-conversation-legacy-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 assert.throws(()=>createOperationsServer({databasePath:join(root,'db.sqlite'),
  kioskAuthenticate:()=>null,conversationBoundaryFactory:conversationFactoryFromEnv(env)}),
  {message:'CONVERSATION_LEGACY_KIOSK_CONFLICT'});
 assert.deepEqual(readdirSync(root),[]);
});
test('opt-in composition uses same initialized store and normal verifier; no token leaks',async t=>{
 const factory=conversationFactoryFromEnv(env);let observed;
 const runtime=createBusinessRuntimeOptionsFromEnv(env);
 const app=createOperationsServer({databasePath:':memory:',orphanCleanupMode:'disabled',cleanupIntervalMs:0,kioskServiceBinding:createKioskServiceBindingV1({context:'PROD11_PRODUCTION'}),...runtime,conversationBoundaryFactory:input=>{observed=input;return factory(input);}});
 assert.equal(observed.store,app.store);assert.equal(observed.ownerAuthenticate,runtime.schedulingAuthenticate);
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 assert.equal((await fetch(base+'/healthz')).status,200);
 assert.equal((await fetch(base+'/api/v2/agent/owner-session')).status,403);
 const result=await (await fetch(base+'/api/v2/agent/owner-session',{headers:{authorization:'Bearer '+'owner'.padEnd(40,'x')}})).json();
 assert.deepEqual(result,{ok:true,subjectId:'synthetic-owner',role:'administrator',resourceIds:['R']});
 assert.doesNotMatch(JSON.stringify(result),/ownerxxx/);
});
test('missing explicit identity fails closed; existing protected path remains blocked',()=>{
 assert.throws(()=>conversationFactoryFromEnv({}),/AUTH_REQUIRED/);
 assert.throws(()=>createOperationsServer({databasePath:'/app/data/shooting-operations.sqlite',orphanCleanupMode:'disabled',...createBusinessRuntimeOptionsFromEnv(env),conversationBoundaryFactory:conversationFactoryFromEnv(env)}),/G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/);
});

test('conversation writes share admission and cannot pre-stage an owner grant while disabled',async t=>{
 const root=mkdtempSync(join(tmpdir(),'jso-conversation-admission-'));
 const databasePath=join(root,'db.sqlite');
 const bootstrap=new DatabaseSync(databasePath);
 initializeWritableSchema(bootstrap,{migrations:MIGRATIONS.slice(0,11)});
 bootstrap.close();
 let dispatched=0;
 const factory=conversationFactoryFromEnv(env);
 const app=createOperationsServer({databasePath,uploadRoot:join(root,'uploads'),
   orphanCleanupMode:'disabled',cleanupIntervalMs:0,writeAdmissionMode:'disabled',
   kioskServiceBinding:createKioskServiceBindingV1({context:'PROD11_PRODUCTION'}),
   ...createBusinessRuntimeOptionsFromEnv(env),conversationBoundaryFactory:input=>{
     const boundary=factory(input);
     return {...boundary,handler(req,res){dispatched++;return boundary.handler(req,res);}};
   }});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.server.close(r));rmSync(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const headers={authorization:'Bearer '+'owner'.padEnd(40,'x'),'content-type':'application/json'};
 const command={operationId:'admission-op',scheduleItemId:'item1',resourceId:'R',
   plannedStart:'2026-10-15T01:00:00.000Z',plannedEnd:'2026-10-15T02:00:00.000Z',
   expectedScheduleRevision:0,expectedProjectionRevision:0,configDigest:'sha256:'+'a'.repeat(64)};
 const body=JSON.stringify({sourceRef:'admission-source',assistantSubjectId:'synthetic-agent',command});
 for(const path of ['/api/v2/agent/owner-delegation','/api/v2/agent/tools']){
   for(const method of ['POST','PUT','PATCH','DELETE']){
     const response=await fetch(base+path,{method,headers,body});
     assert.equal(response.status,503);
     assert.deepEqual(await response.json(),{ok:false,code:'WRITE_ADMISSION_DISABLED'});
   }
 }
 assert.equal(dispatched,0,'disabled mutations must not reach the boundary');
 const session=await fetch(base+'/api/v2/agent/owner-session',{headers});
 assert.equal(session.status,200);
 assert.equal((await session.json()).subjectId,'synthetic-owner');
 assert.equal((await fetch(base+'/healthz')).headers.get('x-write-admission'),'disabled');
 assert.equal(app.writeAdmissionControl.enable().ok,true);
 const execute=await fetch(base+'/api/v2/agent/tools',{method:'POST',
   headers:{...headers,authorization:'Bearer '+'agent'.padEnd(40,'x')},
   body:JSON.stringify({command:'reschedule',payload_json:JSON.stringify(command)})});
 assert.equal((await execute.json()).code,'EXACT_APPROVAL_REQUIRED');
 assert.equal(app.store.db.prepare('SELECT COUNT(*) AS count FROM agent_grant_attempts').get().count,0);
 const fresh=await fetch(base+'/api/v2/agent/owner-delegation',{method:'POST',headers,body});
 assert.equal(fresh.status,200);
 assert.equal((await fresh.json()).ok,true,'a fresh owner delegation is accepted after enabling writes');
});
