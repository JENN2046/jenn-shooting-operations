import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {createBusinessRuntimeOptionsFromEnv} from './business-runtime-auth-v1.mjs';
const runtimes=new WeakSet(),cookieName='__Host-jso-session';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(v);
const random=()=>randomBytes(32).toString('base64url');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function browserSessionConfig(env){
 if(env.JSO_BROWSER_SESSION_RUNTIME===undefined||env.JSO_BROWSER_SESSION_RUNTIME==='disabled')return null;
 if(env.JSO_BROWSER_SESSION_RUNTIME!=='enabled')throw Error('BROWSER_SESSION_MODE_INVALID');
 const u=new URL(env.JSO_BROWSER_ORIGIN);if(u.protocol!=='https:'||u.origin!==env.JSO_BROWSER_ORIGIN||u.username||u.password)throw Error('BROWSER_SESSION_HTTPS_ORIGIN_REQUIRED');
 const ttl=Number(env.JSO_BROWSER_SESSION_TTL_MS??28800000),idle=Number(env.JSO_BROWSER_SESSION_IDLE_MS??1800000);
 if(!Number.isSafeInteger(ttl)||ttl<60000||ttl>86400000||!Number.isSafeInteger(idle)||idle<60000||idle>ttl)throw Error('BROWSER_SESSION_EXPIRY_INVALID');
 return {origin:u.origin,ttl,idle};
}
export const browserSessionConfigDigest=env=>{const c=browserSessionConfig(env);return c?createHash('sha256').update(JSON.stringify([c,env.JSO_BUSINESS_RUNTIME,env.JSO_BUSINESS_IDENTITIES_JSON])).digest('hex'):null;};
export function requireBrowserSessionRuntime(runtime,env){if(!runtimes.has(runtime)||(env&&!runtime.matchesConfig(env)))throw Error('BROWSER_SESSION_RUNTIME_INVALID');return runtime;}
export function createBrowserSessionOptionsFromEnv(env=process.env,{now=()=>Date.now()}={}){
 const config=browserSessionConfig(env);if(!config)return {};
 const original=browserSessionConfigDigest(env),sessions=new Map(),attempts=new Map();
 const credentialsVersion=()=>createHash('sha256').update(env.JSO_BUSINESS_IDENTITIES_JSON??'').digest('hex');
 const bearer=()=>createBusinessRuntimeOptionsFromEnv(env).schedulingAuthenticate;
 if(typeof bearer()!=='function')throw Error('BROWSER_BUSINESS_AUTH_REQUIRED');
 function cookie(req){const parts=String(req.headers?.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));return parts.length===1?parts[0].slice(cookieName.length+1):null;}
 function get(req){
  if(req.headers?.authorization)return null;
  const sid=cookie(req),s=sessions.get(sid);if(!s)return null;
  try{
  if(now()>=s.expires||now()-s.touched>=config.idle||s.version!==credentialsVersion()||original!==browserSessionConfigDigest(env)){sessions.delete(sid);return null;}
  const identities=JSON.parse(env.JSO_BUSINESS_IDENTITIES_JSON),current=identities[s.credentialIndex];
  if(!current||current.subjectId!==s.subjectId||current.role!=='administrator'){sessions.delete(sid);return null;}
  const principal=bearer()({headers:{authorization:'Bearer '+current.token}});if(!principal)return null;
  if(!principal.resourceIds.includes(s.resourceId)){sessions.delete(sid);return null;}
  return {sid,s,principal};
  }catch{sessions.delete(sid);return null;}
 }
 function json(res,status,body,headers={}){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(body));}
 const setCookie=(sid,age)=>`${cookieName}=${sid}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
 async function body(req){let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>8192)throw Error('BODY_TOO_LARGE');}return JSON.parse(raw||'{}');}
 function origin(req){return req.headers?.origin===config.origin&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']));}
 function checkWrite(req){const current=get(req);if(!current)return {ok:false,status:401,code:'SESSION_REQUIRED'};if(!origin(req)||!same(req.headers['x-jso-csrf'],current.s.csrf))return {ok:false,status:403,code:'CSRF_REJECTED'};current.s.touched=now();return {ok:true,...current};}
 function description(current){return {authenticated:true,principal:{subjectId:current.principal.subjectId,role:current.principal.role,resourceIds:[...current.principal.resourceIds]},deviceId:current.s.deviceId,resourceId:current.s.resourceId,csrfToken:current.s.csrf,expiresAt:new Date(current.s.expires).toISOString()};}
 const runtime={
  matchesConfig(other){return browserSessionConfigDigest(other)===original;},
  hasCookie:req=>cookie(req)!==null,
  authenticate(req){return get(req)?.principal??null;},
  fieldIdentity(req){const c=get(req);return c?{principal:c.principal,deviceId:c.s.deviceId,resourceId:c.s.resourceId}:null;},
  checkWrite,
  revokeSubject(subjectId){for(const[k,v]of sessions)if(v.subjectId===subjectId)sessions.delete(k);},
  async handle(req,res,url){
   if(!url.pathname.startsWith('/api/v3/session'))return false;
   if(url.search){json(res,400,{ok:false,code:'INVALID_REQUEST'});return true;}
   if(req.method==='GET'&&url.pathname==='/api/v3/session'){const c=get(req);json(res,200,{ok:true,enabled:true,...(c?description(c):{authenticated:false})});return true;}
   if(req.method==='POST'&&url.pathname==='/api/v3/session/login'){
    if(!origin(req)||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){json(res,403,{ok:false,code:'ORIGIN_REJECTED'});return true;}
    const ip=req.socket?.remoteAddress??'local',old=attempts.get(ip),counter=old&&old.until>now()?old:{n:0,until:now()+60000};
    for(const[k,v]of attempts)if(v.until<=now())attempts.delete(k);
    if(counter.n>=5||attempts.size>=1024){json(res,429,{ok:false,code:'LOGIN_RATE_LIMITED'});return true;}
    counter.n++;attempts.set(ip,counter);
    let input;try{input=await body(req);}catch{json(res,400,{ok:false,code:'INVALID_REQUEST'});return true;}
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['token','deviceId','resourceId'].includes(k))||typeof input.token!=='string'||input.token.length>4096||!id(input.deviceId)){json(res,400,{ok:false,code:'INVALID_REQUEST'});return true;}
    const principal=bearer()({headers:{authorization:'Bearer '+input.token}});
    if(!principal||principal.role!=='administrator'){json(res,401,{ok:false,code:'UNAUTHENTICATED'});return true;}
    const resourceId=input.resourceId??[...principal.resourceIds].sort()[0];if(!principal.resourceIds.includes(resourceId)){json(res,403,{ok:false,code:'FORBIDDEN'});return true;}
    for(const[k,v]of sessions)if(v.expires<=now()||now()-v.touched>=config.idle)sessions.delete(k);
    if(sessions.size>=1024){json(res,503,{ok:false,code:'SESSION_CAPACITY'});return true;}
    const previous=cookie(req);if(previous)sessions.delete(previous);
    const sid=random(),s={credentialIndex:JSON.parse(env.JSO_BUSINESS_IDENTITIES_JSON).findIndex(x=>x.token===input.token&&x.subjectId===principal.subjectId),subjectId:principal.subjectId,deviceId:input.deviceId,resourceId,csrf:random(),expires:now()+config.ttl,touched:now(),version:credentialsVersion()};sessions.set(sid,s);attempts.delete(ip);
    json(res,200,{ok:true,enabled:true,...description({s,principal})},{'set-cookie':setCookie(sid,Math.floor(config.ttl/1000))});return true;
   }
   if(req.method==='POST'&&['/api/v3/session/logout','/api/v3/session/revoke'].includes(url.pathname)){
    const c=checkWrite(req);if(!c.ok){json(res,c.status,{ok:false,code:c.code});return true;}
    if(url.pathname.endsWith('/revoke'))runtime.revokeSubject(c.principal.subjectId);else sessions.delete(c.sid);
    json(res,200,{ok:true},{'set-cookie':setCookie('',0)});return true;
   }
   json(res,404,{ok:false,code:'NOT_FOUND'});return true;
  },
 };
 runtimes.add(runtime);return {browserSessionRuntime:Object.freeze(runtime)};
}
