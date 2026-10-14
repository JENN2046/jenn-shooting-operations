import {startOperationsFromEnv} from './server.mjs';
import {createConversationBoundary} from './jso-conversation-boundary-v1.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function conversationFactoryFromEnv(env=process.env){
 if(env.JSO_BUSINESS_RUNTIME!=='enabled')throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED');
 let identities;try{identities=JSON.parse(env.JSO_AGENT_IDENTITIES_JSON);}catch{throw Error('CONVERSATION_AGENT_IDENTITIES_REQUIRED');}
 if(!Array.isArray(identities)||!identities.length)throw Error('CONVERSATION_AGENT_IDENTITIES_REQUIRED');
 return ({store,ownerAuthenticate,clock})=>{
  if(typeof ownerAuthenticate!=='function')throw Error('CONVERSATION_BUSINESS_AUTH_REQUIRED');
  return createConversationBoundary({store,identities,ownerAuthenticate,clock});
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startOperationsFromEnv({conversationBoundaryFactory:conversationFactoryFromEnv()});
