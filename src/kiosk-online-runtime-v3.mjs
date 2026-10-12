import {timingSafeEqual} from 'node:crypto';
import {createTrustedPrincipal} from './authorization-v2.mjs';
const runtimes=new WeakSet();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(v);
// Trusted startup configuration; browser input cannot select role, device or resource scope.
export function createKioskOnlineRuntimeV3({identities,forbiddenTokens=[]}) {
 if(!Array.isArray(identities)||!identities.length)throw new TypeError('KIOSK_V3_IDENTITIES_REQUIRED');
 const tokens=new Set(forbiddenTokens),devices=new Set();
 const entries=identities.map(identity=>{
  if(!identity||Object.keys(identity).sort().join(',')!=='deviceId,resourceId,subjectId,token'
   ||!id(identity.deviceId)||!id(identity.resourceId)||!id(identity.subjectId)
   ||typeof identity.token!=='string'||Buffer.byteLength(identity.token)<32||tokens.has(identity.token)||devices.has(identity.deviceId))throw new TypeError('KIOSK_V3_IDENTITY_INVALID');
  tokens.add(identity.token);devices.add(identity.deviceId);
  const principal=createTrustedPrincipal({subjectId:identity.subjectId,role:'operator',resourceIds:[identity.resourceId]}).principal;
  return {bytes:Buffer.from(identity.token),identity:Object.freeze({principal,deviceId:identity.deviceId,resourceId:identity.resourceId})};
 });
 const canonical=list=>JSON.stringify(list.map(x=>['token','subjectId','deviceId','resourceId'].map(k=>x[k])));
 const approved=canonical(identities);
 const runtime=Object.freeze({version:3,matchesConfig(raw){try{return canonical(JSON.parse(raw))===approved;}catch{return false;}},authenticate(request){
  const h=request.headers?.authorization;if(typeof h!=='string'||!h.startsWith('Bearer '))return null;
  const b=Buffer.from(h.slice(7));return entries.find(e=>b.length===e.bytes.length&&timingSafeEqual(b,e.bytes))?.identity??null;
 }});runtimes.add(runtime);return runtime;
}
export function requireKioskOnlineRuntimeV3(runtime){if(!runtimes.has(runtime))throw new TypeError('KIOSK_V3_RUNTIME_REQUIRED');return runtime;}
export function createKioskOnlineOptionsFromEnv(env){
 if(env.JSO_KIOSK_ONLINE_RUNTIME===undefined||env.JSO_KIOSK_ONLINE_RUNTIME==='disabled')return {};
 if(env.JSO_KIOSK_ONLINE_RUNTIME!=='enabled')throw new TypeError('KIOSK_V3_RUNTIME_MODE_INVALID');
 let identities,business;
 try{identities=JSON.parse(env.JSO_KIOSK_ONLINE_IDENTITIES_JSON);business=JSON.parse(env.JSO_BUSINESS_IDENTITIES_JSON??'[]');}catch{throw new TypeError('KIOSK_V3_IDENTITIES_REQUIRED');}
 if(!Array.isArray(business))throw new TypeError('KIOSK_V3_IDENTITIES_REQUIRED');
 const forbiddenTokens=[...business.map(x=>x.token),env.ADMIN_TOKEN,env.SCHEDULER_TOKEN,env.SUBMITTER_TOKEN,env.VIEWER_TOKEN].filter(Boolean);
 return {kioskOnlineRuntime: createKioskOnlineRuntimeV3({identities,forbiddenTokens})};
}
