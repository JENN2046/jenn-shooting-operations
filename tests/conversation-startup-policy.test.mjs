import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {coreFixture} from './support/greenfield-core-fixture.mjs';

const agents=JSON.stringify([{token:'synthetic-agent'.padEnd(40,'x'),subjectId:'test-agent',mode:'executor',resourceIds:['JSO-BIZ-RESOURCE-001']}]);
async function fixture(version=5) {
 const prior=process.env.JSO_AGENT_IDENTITIES_JSON;
 process.env.JSO_AGENT_IDENTITIES_JSON=agents;
 const f=await coreFixture({schemaVersion:12});
 const runtime=await import(pathToFileURL(join(f.app,'src/server-conversation.mjs')));
 const auth=await import(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')));
 if(version===5){f.record.version=5;f.record.purpose='CORE_SCHEMA12_NATIVE_VCP_CONVERSATION_ACCEPTANCE';f.record.policy.integrations='native-vcp-conversation-v1';f.record.policy.runtimeConfigSha256=f.m.runtimeConfigDigest(process.env,5);f.install();}
 return {...f,runtime,auth,factory:()=>runtime.conversationFactoryFromEnv(process.env),close(){f.close();if(prior===undefined)delete process.env.JSO_AGENT_IDENTITIES_JSON;else process.env.JSO_AGENT_IDENTITIES_JSON=prior;}};
}
test('R4 retains its digest and core-only behavior; conversation cannot mount',async()=>{
 const f=await fixture(4);try{
 const pin=f.m.runtimeConfigDigest();process.env.JSO_AGENT_IDENTITIES_JSON=agents+' ';
 assert.equal(f.m.runtimeConfigDigest(),pin);process.env.JSO_AGENT_IDENTITIES_JSON=agents;
 f.activate();const core=f.server('enabled');core.store.close();
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}),/CONVERSATION_DISABLED/);
 f.record.policy.integrations='native-vcp-conversation-v1';f.install();assert.throws(()=>f.m.loadCoreAcceptance(f.filename),/RECORD_INVALID/);
 }finally{f.close();}
});
test('R5 PREPARED stays byte-identical and cannot mount the boundary or enable writes',async()=>{
 const f=await fixture();try{
 const before=readFileSync(f.filename);const app=f.server();assert.equal(app.store.readOnly,true);
 assert.equal(app.writeAdmissionControl.enable().ok,false);app.store.close();
 assert.throws(()=>f.server('disabled',{conversationBoundaryFactory:f.factory()}),/CONVERSATION_DISABLED/);
 assert.deepEqual(readFileSync(f.filename),before);
 }finally{f.close();}
});
test('R5 ACTIVE requires the real matching factory and authenticated identity configuration',async()=>{
 const f=await fixture();try{
 f.activate();const before=readFileSync(f.filename);
 for(const factory of [undefined,()=>({handler(){}}),Object.assign(()=>null,{integration:'native-vcp-conversation-v1'})])assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:factory}),/CONVERSATION_CONFIG/);
 const stale=f.runtime.conversationFactoryFromEnv({...process.env,JSO_AGENT_IDENTITIES_JSON:agents.replace('test-agent','another-agent')});
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:stale}),/CONVERSATION_CONFIG/);
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory(),schedulingAuthenticate:()=>null}),/CONVERSATION_CONFIG/);
 const other=f.auth.createBusinessRuntimeOptionsFromEnv({...process.env,JSO_BUSINESS_IDENTITIES_JSON:process.env.JSO_BUSINESS_IDENTITIES_JSON.replace('test-admin','other-admin')});
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory(),...other}),/CONVERSATION_CONFIG/);
 assert.deepEqual(readFileSync(f.filename),before);
 }finally{f.close();}
});
test('R5 agent credential, resource, subject, mode and owner drift fail before store opening',async()=>{
 const f=await fixture();try{
 f.activate();const before=readFileSync(f.filename);
 for(const [key,replacement] of [['token','another-token'.padEnd(40,'x')],['subjectId','other'],['resourceIds',['OTHER']],['mode','observer']]){
 const parsed=JSON.parse(agents);parsed[0][key]=replacement;process.env.JSO_AGENT_IDENTITIES_JSON=JSON.stringify(parsed);
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}),/CONFIG_CHANGED/);
 }
 delete process.env.JSO_AGENT_IDENTITIES_JSON;
 assert.throws(()=>f.m.loadCoreAcceptance(f.filename),/CONFIG_CHANGED/);
 process.env.JSO_AGENT_IDENTITIES_JSON=agents;
 const owner=process.env.JSO_BUSINESS_IDENTITIES_JSON;process.env.JSO_BUSINESS_IDENTITIES_JSON=owner.replace('test-admin','other');
 assert.throws(()=>f.m.loadCoreAcceptance(f.filename),/CONFIG_CHANGED/);process.env.JSO_BUSINESS_IDENTITIES_JSON=owner;
 assert.deepEqual(readFileSync(f.filename),before);
 }finally{f.close();}
});
test('R5 missing/revoked materials and unknown integration do not authorize a boundary',async()=>{
 const f=await fixture();try{
 f.activate();f.record.policy.integrations='all';f.install();assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}),/RECORD_INVALID/);
 f.record.policy.integrations='native-vcp-conversation-v1';f.activate();
 rmSync(join(f.custody,'owner-approval.json'));assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}));
 f.install();rmSync(join(f.custody,'acceptance.json'));assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}));
 }finally{f.close();}
});
test('R5 certified boundary serves owner identity with unchanged grants and restarts in separate processes',async()=>{
 const f=await fixture();try{
 f.activate();
 const code=`import {createOperationsServer,createKioskRuntimeOptionsFromEnv} from ${JSON.stringify(pathToFileURL(join(f.app,'src/server.mjs')).href)};
 import {conversationFactoryFromEnv} from ${JSON.stringify(pathToFileURL(join(f.app,'src/server-conversation.mjs')).href)};
 import {createBusinessRuntimeOptionsFromEnv} from ${JSON.stringify(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')).href)};
 import assert from 'node:assert/strict';
 const app=createOperationsServer({databasePath:${JSON.stringify(f.filename)},uploadRoot:${JSON.stringify(f.uploads)},orphanCleanupMode:'disabled',cleanupIntervalMs:0,...createKioskRuntimeOptionsFromEnv(process.env),...createBusinessRuntimeOptionsFromEnv(process.env),conversationBoundaryFactory:conversationFactoryFromEnv(process.env)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetch(base+'/healthz')).status,200);
 assert.equal((await fetch(base+'/api/v2/agent/owner-session')).status,403);
 const result=await(await fetch(base+'/api/v2/agent/owner-session',{headers:{authorization:'Bearer '+'a'.repeat(40)}})).json();
 assert.deepEqual(result,{ok:true,subjectId:'test-admin',role:'administrator',resourceIds:['JSO-BIZ-RESOURCE-001']});
 await new Promise(r=>app.server.close(r));console.log('R5_SAME_TARGET_BOUNDARY_OK');`;
 for(let i=0;i<2;i++){const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/R5_SAME_TARGET_BOUNDARY_OK/);}
 }finally{f.close();}
});

test('R5 rejects other integrations in both PREPARED and ACTIVE',async()=>{
 const f=await fixture();const old=process.env.JSO_KIOSK_ONLINE_RUNTIME;
 try{
 const {assertConversationStartupBinding}=await import(pathToFileURL(join(f.app,'src/conversation-runtime-v1.mjs')));
 for(const prepared of [true,false]){
  const startup={reason:'PROSPECTIVE_CORE_ACCEPTANCE',integrations:'native-vcp-conversation-v1',prepared};
  assert.throws(()=>assertConversationStartupBinding({startup,kioskOnlineRuntime:{},env:{}}),/OTHER_INTEGRATION/);
  assert.throws(()=>assertConversationStartupBinding({startup,env:{JSO_KIOSK_ONLINE_RUNTIME:'enabled'}}),/OTHER_INTEGRATION/);
 }
 // End-to-end startup rejection even when the unwanted configuration is freshly pinned.
 process.env.JSO_KIOSK_ONLINE_RUNTIME='enabled';
 f.record.policy.runtimeConfigSha256=f.m.runtimeConfigDigest(process.env,5);f.install();
 assert.throws(()=>f.server(),/OTHER_INTEGRATION/);
 f.activate();assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}),/OTHER_INTEGRATION/);
 }finally{if(old===undefined)delete process.env.JSO_KIOSK_ONLINE_RUNTIME;else process.env.JSO_KIOSK_ONLINE_RUNTIME=old;f.close();}
});
