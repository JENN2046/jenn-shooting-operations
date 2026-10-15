import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFactoryFromEnv,assertConversationStartupBinding} from '../src/conversation-runtime-v1.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';
import {createAuthorizer} from '../src/auth.mjs';
import {createKioskOnlineOptionsFromEnv} from '../src/kiosk-online-runtime-v3.mjs';

const token=label=>label.padEnd(40,'x');
const business=(credential,role='administrator')=>({token:credential,subjectId:role,role,resourceIds:['OWNER-R']});
const agent=(credential,mode='executor')=>({token:credential,subjectId:mode,mode,resourceIds:['AGENT-R']});
const config=(owners,agents)=>({JSO_BUSINESS_RUNTIME:'enabled',
  JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify(owners),JSO_AGENT_IDENTITIES_JSON:JSON.stringify(agents)});

for(const role of ['administrator','scheduler'])for(const mode of ['executor','planner']){
 test(`factory rejects ${mode} credentials shared with a ${role} before store construction`,()=>{
  const shared=token('shared-secret');
  const env=config([business(token('other-owner')),business(shared,role)],
    [agent(token('other-agent')),agent(shared,mode)]);
  assert.throws(()=>conversationFactoryFromEnv(env),error=>{
    assert.equal(error.message,'CONVERSATION_CREDENTIAL_OVERLAP');
    assert.ok(!String(error).includes(shared));return true;
  });
 });
}

test('overlap is checked using authentication bytes, including UTF-8 replacement aliases',()=>{
 const env=config([business(token('shared')+'\ud800')],[agent(token('shared')+'\ufffd')]);
 assert.throws(()=>conversationFactoryFromEnv(env),/CONVERSATION_CREDENTIAL_OVERLAP/);
});

for(const key of ['SCHEDULER_TOKEN','ADMIN_TOKEN']){
 test(`conversation rejects agent credentials shared with legacy ${key}`,()=>{
  const credential=token('agent');
  const env=config([business(token('owner'))],[agent(credential)]);
  const legacy=createAuthorizer({[key==='ADMIN_TOKEN'?'administrator':'scheduler']:credential});
  assert.equal(legacy({headers:{authorization:'Bearer '+credential}},'scheduler').allowed,true);
  for(const [agentToken,legacyToken] of [[credential,credential],[credential+'\ud800',credential+'\ufffd']]){
   assert.throws(()=>conversationFactoryFromEnv({...env,[key]:legacyToken,
     JSO_AGENT_IDENTITIES_JSON:JSON.stringify([agent(agentToken)])}),
     {message:'CONVERSATION_CREDENTIAL_OVERLAP'});
  }
  assert.equal(typeof conversationFactoryFromEnv({...env,[key]:token('separate-legacy')}),'function');
 });

 test(`startup rejects a factory checked before legacy ${key} changed`,()=>{
  const env=config([business(token('owner'))],[agent(token('agent'))]);
  const factory=conversationFactoryFromEnv(env);
  const {schedulingAuthenticate:ownerAuthenticate}=createBusinessRuntimeOptionsFromEnv(env);
  assert.throws(()=>assertConversationStartupBinding({
    startup:{reason:'PROSPECTIVE_CORE_ACCEPTANCE',integrations:'native-vcp-conversation-v1'},
    factory,ownerAuthenticate,env:{...env,[key]:token('agent')}}),/CONVERSATION_CONFIG/);
 });
}

test('factory requires valid explicit business identities to establish separation',()=>{
 const env=config([business(token('owner'))],[agent(token('agent'))]);
 for(const invalid of [undefined,'{','null','{}','[]',JSON.stringify([business('short')])]){
  assert.throws(()=>conversationFactoryFromEnv({...env,JSO_BUSINESS_IDENTITIES_JSON:invalid}),
    /CONVERSATION_BUSINESS_AUTH_REQUIRED/);
 }
});

for(const mode of ['planner','executor'])test(`conversation rejects ${mode} credentials shared with online kiosk`,()=>{
 const credential=token('agent');
 const env={...config([business(token('owner'))],[agent(credential,mode)]),
  JSO_KIOSK_ONLINE_RUNTIME:'enabled',
  JSO_KIOSK_ONLINE_IDENTITIES_JSON:JSON.stringify([{token:credential,subjectId:'operator-001',deviceId:'device-001',resourceId:'resource-001'}])};
 const {kioskOnlineRuntime}=createKioskOnlineOptionsFromEnv(env);
 assert.ok(kioskOnlineRuntime.authenticate({headers:{authorization:'Bearer '+credential}}));
 assert.throws(()=>conversationFactoryFromEnv(env),{message:'CONVERSATION_CREDENTIAL_OVERLAP'});
 assert.equal(typeof conversationFactoryFromEnv({...env,JSO_AGENT_IDENTITIES_JSON:JSON.stringify([agent(token('separate-agent'),mode)])}),'function');
 assert.equal(typeof conversationFactoryFromEnv({...env,JSO_KIOSK_ONLINE_RUNTIME:'disabled'}),'function');
});

test('conversation validates enabled online kiosk configuration before creating its factory',()=>{
 const env={...config([business(token('owner'))],[agent(token('agent'))]),JSO_KIOSK_ONLINE_RUNTIME:'enabled'};
 for(const raw of [undefined,'{','null','[]',JSON.stringify([{token:token('agent')}])]){
  assert.throws(()=>conversationFactoryFromEnv({...env,JSO_KIOSK_ONLINE_IDENTITIES_JSON:raw}),/KIOSK_V3_/);
 }
});

test('distinct credentials retain valid startup binding and cannot cross-authenticate',()=>{
 const env=config([business(token('owner'))],[agent(token('agent'))]);
 const factory=conversationFactoryFromEnv(env);
 const {schedulingAuthenticate:ownerAuthenticate}=createBusinessRuntimeOptionsFromEnv(env);
 assert.equal(ownerAuthenticate({headers:{authorization:'Bearer '+token('agent')}}),null);
 assert.doesNotThrow(()=>assertConversationStartupBinding({
   startup:{reason:'PROSPECTIVE_CORE_ACCEPTANCE',integrations:'native-vcp-conversation-v1'},
   factory,ownerAuthenticate,env}));
 const changed=config([business(token('agent'))],[agent(token('agent'))]);
 const changedAuth=createBusinessRuntimeOptionsFromEnv(changed).schedulingAuthenticate;
 assert.throws(()=>assertConversationStartupBinding({
   startup:{reason:'PROSPECTIVE_CORE_ACCEPTANCE',integrations:'native-vcp-conversation-v1'},
   factory,ownerAuthenticate:changedAuth,env:changed}),/CONVERSATION_CONFIG/);
});
