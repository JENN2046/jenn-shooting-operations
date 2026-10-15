import {createHash} from 'node:crypto';
import {createConversationBoundary} from './jso-conversation-boundary-v1.mjs';
import {createBusinessRuntimeAuthV1,matchesBusinessRuntimeConfig} from './business-runtime-auth-v1.mjs';

const factories = new WeakMap();
const identityDigest = value => createHash('sha256').update(value ?? '').digest('hex');

export function conversationFactoryFromEnv(env=process.env){
 if(env.JSO_BUSINESS_RUNTIME!=='enabled')throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED');
 let identities;try{identities=JSON.parse(env.JSO_AGENT_IDENTITIES_JSON);}catch{throw Error('CONVERSATION_AGENT_IDENTITIES_REQUIRED');}
 if(!Array.isArray(identities)||!identities.length)throw Error('CONVERSATION_AGENT_IDENTITIES_REQUIRED');
 let businessIdentities;
 try {
  businessIdentities=JSON.parse(env.JSO_BUSINESS_IDENTITIES_JSON);
  createBusinessRuntimeAuthV1({identities:businessIdentities});
 } catch { throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED'); }
 // Compare the same UTF-8 bytes used by both authenticators, across every role/scope.
 const businessTokens=businessIdentities.map(({token})=>Buffer.from(token));
 if(identities.some(identity=>typeof identity?.token==='string'
   && businessTokens.some(token=>token.equals(Buffer.from(identity.token))))) {
  throw Error('CONVERSATION_CREDENTIAL_OVERLAP');
 }
 const factory = ({store,ownerAuthenticate,clock})=>{
  if(typeof ownerAuthenticate!=='function')throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED');
  return createConversationBoundary({store,identities,ownerAuthenticate,clock});
 };
 factories.set(factory, {agents:identityDigest(env.JSO_AGENT_IDENTITIES_JSON),
  business:identityDigest(env.JSO_BUSINESS_IDENTITIES_JSON)});
 return factory;
}

// Run before any store opens. Public properties on arbitrary callbacks cannot impersonate
// the reviewed composition. The trusted administrator/source pin remains the code boundary.
export function assertConversationStartupBinding({startup, factory, ownerAuthenticate, kioskOnlineRuntime, env=process.env}) {
 if (startup.reason !== 'PROSPECTIVE_CORE_ACCEPTANCE') return;
 const allowed = startup.integrations === 'native-vcp-conversation-v1';
 if (allowed && (kioskOnlineRuntime || env.JSO_KIOSK_ONLINE_RUNTIME === 'enabled')) throw Error('G3_CORE_ACCEPTANCE_CONVERSATION_OTHER_INTEGRATION');
 if (!allowed || startup.prepared) {
  if (factory !== undefined) throw Error('G3_CORE_ACCEPTANCE_CONVERSATION_DISABLED');
  return;
 }
 if (!factories.has(factory)
   || factories.get(factory).agents !== identityDigest(env.JSO_AGENT_IDENTITIES_JSON)
   || factories.get(factory).business !== identityDigest(env.JSO_BUSINESS_IDENTITIES_JSON)
   || !matchesBusinessRuntimeConfig(ownerAuthenticate, env)) {
  throw Error('G3_CORE_ACCEPTANCE_CONVERSATION_CONFIG');
 }
}
