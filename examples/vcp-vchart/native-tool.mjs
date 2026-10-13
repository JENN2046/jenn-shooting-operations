import {parseJsoAgentArguments} from '../../src/jso-agent-api-v1.mjs';
// Local native-plugin candidate, intended for the Extensions repository after separate review.
// The runtime injects the fixed authenticated port. Tool arguments cannot select destination,
// credentials, grants, Owner identity or a generic HTTP method.
export function createNativeJsoTool({call}) {
  if(typeof call !== 'function') throw new TypeError('fixed JSO port required');
  return Object.freeze({async processToolCall(args) {
    const parsed=parseJsoAgentArguments(args);
    if(!parsed.ok)return {status:'error',result:parsed};
    const result=await call(args);
    return {status:result.ok?'success':'error',result};
  }});
}

export function fixedLocalJsoPort({endpoint,token,fetchImpl=fetch}) {
  const url=new URL(endpoint);
  if(url.protocol!=='http:' || !['127.0.0.1','[::1]'].includes(url.hostname)
    || url.pathname!=='/api/v2/agent/tools' || url.search || url.hash || url.username || url.password
    || typeof token!=='string' || token.length<32 || !/^[\x21-\x7e]+$/.test(token)) throw new TypeError('local candidate binding invalid');
  return async args=>{
    if(!parseJsoAgentArguments(args).ok)return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};
    try {
      const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(args)});
      const result=await response.json();
      return typeof result?.ok==='boolean'?result:{ok:false,code:'SERVICE_RESULT_INVALID'};
    }catch{return {ok:false,code:['reschedule','adopt_proposal'].includes(args.command)?'RESULT_UNKNOWN':'SERVICE_UNAVAILABLE'};}
  };
}
// Same isolated stdio contract as the existing JennShootingOperations plugin.
if(process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>270336)throw new Error('too large');}
    const {parseJsoAgentEnvelope}=await import('../../src/jso-agent-api-v1.mjs');
    const parsed=parseJsoAgentEnvelope(text);
    if(!parsed.ok)throw new Error('invalid envelope');
    const tool=createNativeJsoTool({call:fixedLocalJsoPort({endpoint:process.env.JSO_LOCAL_AGENT_ENDPOINT,token:process.env.JSO_LOCAL_AGENT_TOKEN})});
    process.stdout.write(JSON.stringify(await tool.processToolCall(parsed.arguments))+'\n');
  }catch{process.stdout.write(JSON.stringify({status:'error',result:{ok:false,code:'LOCAL_BINDING_OR_ARGUMENTS_INVALID'}})+'\n');}
}
