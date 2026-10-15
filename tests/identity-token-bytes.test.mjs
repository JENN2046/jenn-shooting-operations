import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessRuntimeAuthV1} from '../src/business-runtime-auth-v1.mjs';
import {assertValidJsoAgentIdentities,createJsoAgentApplication,JSO_AGENT_COMMANDS} from '../src/jso-agent-api-v1.mjs';

const prefix='identity-byte-regression-'.padEnd(40,'x');
const business=(token,role)=>({token,role,subjectId:role,resourceIds:['R']});
const agent=(token,mode)=>({token,mode,subjectId:mode,resourceIds:['R']});
const service=Object.fromEntries(Object.values(JSO_AGENT_COMMANDS).map(name=>[name,()=>({ok:true})]));

for(const [name,a,b] of [['identical strings',prefix,prefix],
 ['unpaired high surrogate',prefix+'\ud800',prefix+'\ufffd'],
 ['unpaired low surrogate',prefix+'\udc00',prefix+'\ufffd']]){
 test(`business validator rejects ${name} in either role order`,()=>{
  assert.deepEqual(Buffer.from(a),Buffer.from(b));
  for(const identities of [[business(a,'administrator'),business(b,'scheduler')],
   [business(b,'scheduler'),business(a,'administrator')]]){
   assert.throws(()=>createBusinessRuntimeAuthV1({identities}),{message:'Invalid business identity'});
  }
 });
 test(`agent validator rejects ${name} in either mode order`,()=>{
  for(const identities of [[agent(a,'executor'),agent(b,'planner')],
   [agent(b,'planner'),agent(a,'executor')]]){
   assert.throws(()=>assertValidJsoAgentIdentities(identities),{message:'Invalid agent identity'});
   assert.throws(()=>createJsoAgentApplication({identities,service}),{message:'Invalid agent identity'});
  }
 });
}

test('distinct UTF-8 credentials retain separate business roles without Unicode normalization',()=>{
 const admin=prefix+'\u00e9',scheduler=prefix+'e\u0301';
 const authenticate=createBusinessRuntimeAuthV1({identities:[business(admin,'administrator'),business(scheduler,'scheduler')]});
 assert.equal(authenticate({headers:{authorization:'Bearer '+admin}}).role,'administrator');
 assert.equal(authenticate({headers:{authorization:'Bearer '+scheduler}}).role,'scheduler');
});

test('distinct UTF-8 credentials retain planner and executor restrictions',async()=>{
 const executor=prefix+'\u00e9',planner=prefix+'e\u0301';
 const identities=[agent(executor,'executor'),agent(planner,'planner')];
 assert.doesNotThrow(()=>assertValidJsoAgentIdentities(identities));
 const application=createJsoAgentApplication({identities,service});
 const args={command:'reschedule',payload_json:JSON.stringify({operationId:'op-1',resourceId:'R'})};
 assert.equal((await application.call({authorization:'Bearer '+planner,arguments:args})).code,'AGENT_SUGGEST_ONLY');
 assert.equal((await application.call({authorization:'Bearer '+executor,arguments:args})).code,'EXACT_APPROVAL_REQUIRED');
});
