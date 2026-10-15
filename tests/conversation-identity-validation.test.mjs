import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFactoryFromEnv} from '../src/conversation-runtime-v1.mjs';
import {assertValidJsoAgentIdentities} from '../src/jso-agent-api-v1.mjs';

const identity={token:'synthetic-agent'.padEnd(40,'x'),subjectId:'assistant',mode:'executor',resourceIds:['R']};
const env={JSO_BUSINESS_RUNTIME:'enabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([
 {token:'synthetic-owner'.padEnd(40,'x'),subjectId:'owner',role:'administrator',resourceIds:['R']}])};
for(const [name,identities] of [
 ['short token',[{...identity,token:'short'}]],
 ['non-string token',[{...identity,token:42}]],
 ['unsupported mode',[{...identity,mode:'observer'}]],
 ['empty resources',[{...identity,resourceIds:[]}]],
 ['invalid resource',[{...identity,resourceIds:['']}]],
 ['duplicate resources',[{...identity,resourceIds:['R','R']}]],
 ['invalid subject',[{...identity,subjectId:''}]],
 ['duplicate token',[identity,{...identity,subjectId:'other'}]],
 ['null identity',[null]],
]){
 test(`conversation validates ${name} before returning a trusted factory`,()=>{
  assert.throws(()=>assertValidJsoAgentIdentities(identities),/Invalid agent/);
  assert.throws(()=>conversationFactoryFromEnv({...env,JSO_AGENT_IDENTITIES_JSON:JSON.stringify(identities)}),/Invalid agent/);
 });
}
