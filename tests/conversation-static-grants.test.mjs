import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFactoryFromEnv} from '../src/conversation-runtime-v1.mjs';
import {agentCommandDigest,createJsoAgentApplication,JSO_AGENT_COMMANDS} from '../src/jso-agent-api-v1.mjs';

const token='synthetic-agent'.padEnd(40,'x');
const identity={token,subjectId:'assistant',mode:'executor',resourceIds:['R']};
const envFor=identities=>({JSO_BUSINESS_RUNTIME:'enabled',
 JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'synthetic-owner'.padEnd(40,'x'),
   subjectId:'owner',role:'administrator',resourceIds:['R']}]),
 JSO_AGENT_IDENTITIES_JSON:JSON.stringify(identities)});

for(const action of ['reschedule','adopt_proposal']){
 test(`conversation rejects otherwise valid static ${action} grants before creating a factory`,async()=>{
  const command={operationId:'synthetic-operation',resourceId:'R'};
  const grant={approvalRef:'static-approval',subjectId:identity.subjectId,action,
    commandDigest:agentCommandDigest(action,command),notBefore:'2026-10-15T00:00:00.000Z',
    expiresAt:'2026-10-15T00:05:00.000Z'};
  const granted={...identity,grants:[grant]};
  // This is a valid grant for the generic API; only the conversation composition forbids it.
  const service=Object.fromEntries(Object.values(JSO_AGENT_COMMANDS).map(method=>[method,()=>({ok:true})]));
  const generic=createJsoAgentApplication({service,identities:[granted],
    clock:()=>new Date('2026-10-15T00:01:00.000Z'),claimGrantAttempt:()=>({ok:true})});
  assert.equal((await generic.call({authorization:'Bearer '+token,
    arguments:{command:action,payload_json:JSON.stringify(command)}})).ok,true);
  const env=envFor([{...identity,token:'other-agent'.padEnd(40,'x'),subjectId:'other'},granted]);
  assert.throws(()=>conversationFactoryFromEnv(env),{message:'CONVERSATION_STATIC_GRANTS_FORBIDDEN'});
 });
}

test('conversation accepts omitted and empty grants for both identity modes',()=>{
 for(const mode of ['executor','planner'])for(const extra of [{},{grants:[]}]){
  assert.equal(typeof conversationFactoryFromEnv(envFor([{...identity,mode,...extra}])),'function');
 }
});

test('conversation rejects malformed grant configuration without disclosing credentials',()=>{
 for(const grants of [null,{},'synthetic-private-grant',[{}]]){
  assert.throws(()=>conversationFactoryFromEnv(envFor([{...identity,grants}])),
    {message:'CONVERSATION_STATIC_GRANTS_FORBIDDEN'});
 }
});
