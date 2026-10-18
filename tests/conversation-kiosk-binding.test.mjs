import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {coreFixture} from './support/greenfield-core-fixture.mjs';
const kiosk={token:'k'.repeat(40),subjectId:'operator-001',deviceId:'device-001',resourceId:'resource-001'};
const agents=JSON.stringify([{token:'z'.repeat(40),subjectId:'agent-001',mode:'executor',resourceIds:['resource-001']}]);
async function fixture(){
 const old=process.env.JSO_AGENT_IDENTITIES_JSON;process.env.JSO_AGENT_IDENTITIES_JSON=agents;
 const f=await coreFixture({schemaVersion:12,kioskIdentities:[kiosk]});
 const runtime=await import(pathToFileURL(join(f.app,'src/conversation-runtime-v1.mjs')));
 const online=await import(pathToFileURL(join(f.app,'src/kiosk-online-runtime-v3.mjs')));
 f.record.version=5;f.record.purpose='CORE_SCHEMA12_NATIVE_VCP_CONVERSATION_ACCEPTANCE';f.record.policy.integrations='native-vcp-conversation-v1';
 const pin=()=>{f.record.policy.runtimeConfigSha256=f.m.runtimeConfigDigest(process.env,5);f.install();};pin();
 return {...f,pin,online,factory:()=>runtime.conversationFactoryFromEnv(process.env),close(){f.close();if(old===undefined)delete process.env.JSO_AGENT_IDENTITIES_JSON;else process.env.JSO_AGENT_IDENTITIES_JSON=old;}};
}
test('R5 PREPARED denies Kiosk; ACTIVE matching Bearer composition shares authenticated HTTP',async()=>{
 const f=await fixture();try{
 const before=readFileSync(f.filename);assert.throws(()=>f.server(),/OTHER_INTEGRATION/);assert.deepEqual(readFileSync(f.filename),before);
 f.activate();const app=f.server('enabled',{conversationBoundaryFactory:f.factory()});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{
 const base='http://127.0.0.1:'+app.server.address().port;
 const call=(path,token)=>fetch(base+path,{headers:{authorization:'Bearer '+token}});
 assert.equal((await call('/api/v3/kiosk/identity',kiosk.token)).status,200);
 assert.equal((await call('/api/v3/kiosk/identity','a'.repeat(40))).status,401);
 assert.equal((await call('/api/v2/agent/owner-session',kiosk.token)).status,403);
 assert.equal((await call('/api/v2/agent/owner-session','a'.repeat(40))).status,200);
 }finally{await new Promise(r=>app.server.close(r));}
 }finally{f.close();}
});
test('R5 repinned Kiosk drift rejects stale factories and actual runtimes before opening store',async()=>{
 const f=await fixture();try{
 const original=process.env.JSO_KIOSK_ONLINE_IDENTITIES_JSON,stale=f.factory(),before=readFileSync(f.filename);
 const unchanged=()=>{assert.deepEqual(readFileSync(f.filename),before);for(const suffix of ['-wal','-shm','-journal'])assert.equal(existsSync(f.filename+suffix),false);};
 for(const change of [{token:'replacement'.padEnd(40,'x')},{deviceId:'device-002'},{resourceId:'resource-002'},{subjectId:'operator-002'}]){
 process.env.JSO_KIOSK_ONLINE_IDENTITIES_JSON=JSON.stringify([{...kiosk,...change}]);f.pin();f.activate();
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:stale}),/CONVERSATION_CONFIG/);
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}),/KIOSK_CONFIG/);unchanged();
 }
 process.env.JSO_KIOSK_ONLINE_IDENTITIES_JSON=original;f.pin();f.activate();
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory(),kioskOnlineRuntime:undefined}),/KIOSK_CONFIG/);
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory(),kioskOnlineRuntime:{matchesConfig:()=>true}}),/RUNTIME_REQUIRED/);
 const mismatch=f.online.createKioskOnlineOptionsFromEnv({...process.env,JSO_KIOSK_ONLINE_IDENTITIES_JSON:JSON.stringify([{...kiosk,deviceId:'device-003'}])});
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory(),...mismatch}),/KIOSK_CONFIG/);
 process.env.JSO_KIOSK_ONLINE_RUNTIME='disabled';f.pin();f.activate();
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:stale}),/CONVERSATION_CONFIG/);unchanged();
 }finally{f.close();}
});
test('R5 freshly pinned invalid or overlapping Kiosk configuration fails before opening store',async()=>{
 const f=await fixture();try{
 const before=readFileSync(f.filename);
 for(const raw of ['', '{', '[]',JSON.stringify([{...kiosk,token:'z'.repeat(40)}]),JSON.stringify([{...kiosk,token:'a'.repeat(40)}]),JSON.stringify([{...kiosk,deviceId:'short'}]),JSON.stringify([{...kiosk,resourceId:'short'}])]){
 process.env.JSO_KIOSK_ONLINE_IDENTITIES_JSON=raw;f.pin();f.activate();
 assert.throws(()=>f.server('enabled',{conversationBoundaryFactory:f.factory()}),/KIOSK_V3_|CREDENTIAL_OVERLAP/);
 assert.deepEqual(readFileSync(f.filename),before);
 for(const suffix of ['-wal','-shm','-journal'])assert.equal(existsSync(f.filename+suffix),false);
 }
 }finally{f.close();}
});
