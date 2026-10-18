import {createHash} from 'node:crypto';
import {createConversationBoundary} from './jso-conversation-boundary-v1.mjs';
import {createBusinessRuntimeOptionsFromEnv,matchesBusinessRuntimeConfig} from './business-runtime-auth-v1.mjs';
import {assertValidJsoAgentIdentities} from './jso-agent-api-v1.mjs';
import {createKioskOnlineOptionsFromEnv,requireKioskOnlineRuntimeV3} from './kiosk-online-runtime-v3.mjs';

const factories = new WeakMap();
const identityDigest = value => createHash('sha256').update(value ?? '').digest('hex');

export function conversationFactoryFromEnv(env=process.env){
 if(typeof env.KIOSK_AUTH_CONFIG_PATH==='string' && env.KIOSK_AUTH_CONFIG_PATH.trim())
  throw Error('CONVERSATION_LEGACY_KIOSK_CONFLICT');
 if(env.JSO_BUSINESS_RUNTIME!=='enabled')throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED');
 let identities;try{identities=JSON.parse(env.JSO_AGENT_IDENTITIES_JSON);}catch{throw Error('CONVERSATION_AGENT_IDENTITIES_REQUIRED');}
 if(!Array.isArray(identities)||!identities.length)throw Error('CONVERSATION_AGENT_IDENTITIES_REQUIRED');
 // Conversation authority comes only from live per-command owner delegation.
 if(identities.some(identity=>identity?.grants!==undefined
   && (!Array.isArray(identity.grants)||identity.grants.length!==0))) {
  throw Error('CONVERSATION_STATIC_GRANTS_FORBIDDEN');
 }
 assertValidJsoAgentIdentities(identities);
 let businessIdentities;
 try {
  businessIdentities=JSON.parse(env.JSO_BUSINESS_IDENTITIES_JSON);
  createBusinessRuntimeOptionsFromEnv(env);
 } catch { throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED'); }
 // Validate the co-mounted runtime before trusting its credential list.
 const {kioskOnlineRuntime}=createKioskOnlineOptionsFromEnv(env);
 const kioskIdentities=kioskOnlineRuntime ? JSON.parse(env.JSO_KIOSK_ONLINE_IDENTITIES_JSON) : [];
 // Compare the same UTF-8 bytes used by both authenticators, across every role/scope.
 const businessTokens=[...businessIdentities.map(({token})=>token),...kioskIdentities.map(({token})=>token),
  env.SCHEDULER_TOKEN,env.ADMIN_TOKEN].filter(token=>typeof token==='string').map(token=>Buffer.from(token));
 if(identities.some(identity=>typeof identity?.token==='string'
   && businessTokens.some(token=>token.equals(Buffer.from(identity.token))))) {
  throw Error('CONVERSATION_CREDENTIAL_OVERLAP');
 }
 const factory = ({store,ownerAuthenticate,clock})=>{
  if(typeof ownerAuthenticate!=='function')throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED');
  return createConversationBoundary({store,identities,ownerAuthenticate,clock});
 };
 factories.set(factory, {agents:identityDigest(env.JSO_AGENT_IDENTITIES_JSON),
  business:identityDigest(env.JSO_BUSINESS_IDENTITIES_JSON),
  kioskMode:identityDigest(env.JSO_KIOSK_ONLINE_RUNTIME),
  kioskIdentities:identityDigest(env.JSO_KIOSK_ONLINE_IDENTITIES_JSON),
  legacyScheduler:identityDigest(env.SCHEDULER_TOKEN),legacyAdmin:identityDigest(env.ADMIN_TOKEN)});
 return factory;
}

// Run before any store opens. Public properties on arbitrary callbacks cannot impersonate
// the reviewed composition. The trusted administrator/source pin remains the code boundary.
export function assertConversationStartupBinding({startup, factory, ownerAuthenticate, kioskOnlineRuntime, env=process.env}) {
 if (startup.reason !== 'PROSPECTIVE_CORE_ACCEPTANCE') return;
 const allowed = startup.integrations === 'native-vcp-conversation-v1';
 if (allowed && startup.prepared && (kioskOnlineRuntime || env.JSO_KIOSK_ONLINE_RUNTIME === 'enabled')) throw Error('G3_CORE_ACCEPTANCE_CONVERSATION_OTHER_INTEGRATION');
 if (!allowed || startup.prepared) {
  if (factory !== undefined) throw Error('G3_CORE_ACCEPTANCE_CONVERSATION_DISABLED');
  return;
 }
 if (!factories.has(factory)
   || factories.get(factory).agents !== identityDigest(env.JSO_AGENT_IDENTITIES_JSON)
   || factories.get(factory).business !== identityDigest(env.JSO_BUSINESS_IDENTITIES_JSON)
   || factories.get(factory).legacyScheduler !== identityDigest(env.SCHEDULER_TOKEN)
   || factories.get(factory).legacyAdmin !== identityDigest(env.ADMIN_TOKEN)
   || factories.get(factory).kioskMode !== identityDigest(env.JSO_KIOSK_ONLINE_RUNTIME)
   || factories.get(factory).kioskIdentities !== identityDigest(env.JSO_KIOSK_ONLINE_IDENTITIES_JSON)
   || !matchesBusinessRuntimeConfig(ownerAuthenticate, env)) {
  throw Error('G3_CORE_ACCEPTANCE_CONVERSATION_CONFIG');
 }
 // Bind the actual runtime as well as the configuration validated by the factory.
 if (Boolean(kioskOnlineRuntime) !== (env.JSO_KIOSK_ONLINE_RUNTIME === 'enabled'))
  throw Error('G3_CORE_ACCEPTANCE_KIOSK_CONFIG');
 if (kioskOnlineRuntime) {
  requireKioskOnlineRuntimeV3(kioskOnlineRuntime);
  if (!kioskOnlineRuntime.matchesConfig(env.JSO_KIOSK_ONLINE_IDENTITIES_JSON))
   throw Error('G3_CORE_ACCEPTANCE_KIOSK_CONFIG');
 }
}
