import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorizer} from '../src/auth.mjs';
import {createBusinessRuntimeAuthV1,createBusinessRuntimeOptionsFromEnv,matchesBusinessRuntimeConfig} from '../src/business-runtime-auth-v1.mjs';
import {conversationFactoryFromEnv} from '../src/conversation-runtime-v1.mjs';

const token='business-legacy-test-'.padEnd(40,'x');
const envFor=(credential,role)=>({JSO_BUSINESS_RUNTIME:'enabled',
 JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:credential,subjectId:'business-user',role,resourceIds:['R']}]),
 JSO_AGENT_IDENTITIES_JSON:JSON.stringify([{token:'agent-'.padEnd(40,'a'),subjectId:'agent',mode:'executor',resourceIds:['R']}])});

test('reused scheduler credential would authenticate as a business owner without configuration separation',()=>{
 const request={headers:{authorization:'Bearer '+token}};
 assert.equal(createAuthorizer({scheduler:token})(request,'administrator').allowed,false);
 const identities=JSON.parse(envFor(token,'administrator').JSO_BUSINESS_IDENTITIES_JSON);
 assert.equal(createBusinessRuntimeAuthV1({identities})(request).role,'administrator');
 assert.throws(()=>createBusinessRuntimeAuthV1({identities,forbiddenTokens:[token]}),/Invalid business identity/);
});

for(const key of ['VIEWER_TOKEN','SUBMITTER_TOKEN','SCHEDULER_TOKEN','ADMIN_TOKEN']){
 test(`business configuration rejects ${key} reuse for either business role`,()=>{
  for(const role of ['administrator','scheduler'])for(const [businessToken,legacyToken] of [
   [token,token],[token+'\ud800',token+'\ufffd']]){
   const env={...envFor(businessToken,role),[key]:legacyToken};
   assert.throws(()=>createBusinessRuntimeOptionsFromEnv(env),{message:'Invalid business identity'});
   assert.throws(()=>conversationFactoryFromEnv(env),{message:'CONVERSATION_BUSINESS_AUTH_REQUIRED'});
  }
 });
 test(`distinct ${key} remains usable and changes invalidate an existing business binding`,()=>{
  const env={...envFor(token,'administrator'),[key]:'legacy-'.padEnd(40,'l')};
  const {schedulingAuthenticate}=createBusinessRuntimeOptionsFromEnv(env);
  assert.equal(matchesBusinessRuntimeConfig(schedulingAuthenticate,env),true);
  assert.equal(schedulingAuthenticate({headers:{authorization:'Bearer '+env[key]}}),null);
  assert.equal(typeof conversationFactoryFromEnv(env),'function');
  assert.equal(matchesBusinessRuntimeConfig(schedulingAuthenticate,{...env,[key]:token}),false);
 });
}

test('business-disabled configuration keeps legacy-only startup unchanged',()=>{
 assert.deepEqual(createBusinessRuntimeOptionsFromEnv({VIEWER_TOKEN:token}),{});
});
