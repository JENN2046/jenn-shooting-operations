import test from 'node:test';
import assert from 'node:assert/strict';
import {createKioskServiceBindingV1} from '../src/kiosk-service-context-v1.mjs';
import {createOperationsServer} from '../src/server.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';
import {conversationFactoryFromEnv} from '../src/server-conversation.mjs';
const env={JSO_BUSINESS_RUNTIME:'enabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'owner'.padEnd(40,'x'),subjectId:'synthetic-owner',role:'administrator',resourceIds:['R']}]),JSO_AGENT_IDENTITIES_JSON:JSON.stringify([{token:'agent'.padEnd(40,'x'),subjectId:'synthetic-agent',mode:'executor',resourceIds:['R']}])};
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
