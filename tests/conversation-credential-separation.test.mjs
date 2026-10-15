import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFactoryFromEnv,assertConversationStartupBinding} from '../src/conversation-runtime-v1.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';

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

test('factory requires valid explicit business identities to establish separation',()=>{
 const env=config([business(token('owner'))],[agent(token('agent'))]);
 for(const invalid of [undefined,'{','null','{}','[]',JSON.stringify([business('short')])]){
  assert.throws(()=>conversationFactoryFromEnv({...env,JSO_BUSINESS_IDENTITIES_JSON:invalid}),
    /CONVERSATION_BUSINESS_AUTH_REQUIRED/);
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
