let current={enabled:false,authenticated:false},epoch=0,initial,logoutInFlight,authenticationInFlight;
const logoutKey='jso.browser.logout-pending',deviceKey='jso.browser.device-id.v1',sessionKey='jso.browser.session-changed.v1';
const emit=()=>window.dispatchEvent(new CustomEvent('jso-session-changed',{detail:{authenticated:current.authenticated}}));
const publish=value=>{current=value;epoch++;emit();};
const json=async response=>{const r=await response.json();if(!response.ok||!r.ok)throw Object.assign(Error(r.code??'SESSION_REQUEST_FAILED'),{status:response.status});return r;};
async function device(){
 const make=()=>{let v=localStorage.getItem(deviceKey);if(!v){v='BROWSER-'+crypto.randomUUID();localStorage.setItem(deviceKey,v);}if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(v))throw Error('BROWSER_DEVICE_INVALID');return v;};
 return navigator.locks?navigator.locks.request('jso-browser-device-init',make):make();
}
async function raw(path,body,csrf){return json(await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000),method:body?'POST':'GET',headers:body?{'content-type':'application/json',...(csrf?{'X-JSO-CSRF':csrf}:{})}:{},...(body?{body:JSON.stringify(body)}:{})}));}
async function discardAuthentication(s){
 localStorage.setItem(logoutKey,'1');
 try{if(s?.authenticated)await raw('/api/v3/session/logout',{},s.csrfToken);localStorage.removeItem(logoutKey);}catch(e){if(e.status===401)localStorage.removeItem(logoutKey);}
 throw Error('SESSION_CONTEXT_CHANGED');
}
export const browserSession={
 get enabled(){return current.enabled;},get authenticated(){return current.authenticated;},get state(){return current;},
 init(){return initial??=(async()=>{const generation=epoch;let s;try{s=await raw('/api/v3/session');}catch(e){if(e.status===404){publish({enabled:false,authenticated:false});return current;}throw e;}
  if(generation!==epoch)return discardAuthentication(s);
  if(s.enabled&&localStorage.getItem(logoutKey)){
   if(s.authenticated){try{await raw('/api/v3/session/logout',{},s.csrfToken);}catch(e){if(e.status!==401)throw e;}}
   localStorage.removeItem(logoutKey);s={enabled:true,authenticated:false};
  }
  if(generation!==epoch)return discardAuthentication(s);publish(s);return current;})().catch(e=>{initial=null;throw e;});},
 async login(token){
  const intent=epoch;if(logoutInFlight)await logoutInFlight;if(authenticationInFlight)await authenticationInFlight.catch(()=>{});
  if(intent!==epoch)throw Error('SESSION_CONTEXT_CHANGED');const generation=epoch;
  const operation=(async()=>{const deviceId=await device();if(generation!==epoch)throw Error('SESSION_CONTEXT_CHANGED');
   const s=await raw('/api/v3/session/login',{token,deviceId});if(generation!==epoch)return discardAuthentication(s);
   if(localStorage.getItem(deviceKey)!==s.deviceId)return discardAuthentication(s);
   localStorage.removeItem(logoutKey);localStorage.setItem(sessionKey,crypto.randomUUID());publish(s);return s;
  })();authenticationInFlight=operation;
  try{return await operation;}finally{if(authenticationInFlight===operation)authenticationInFlight=null;}
 },
 async request(path,init={}){
  if(!current.authenticated)throw Object.assign(Error('登录已退出或失效；本机记录保留。'),{status:401});
  const generation=epoch,headers=new Headers(init.headers??{});if(headers.has('authorization'))throw Error('SESSION_BEARER_MIX_FORBIDDEN');
  if(!['GET','HEAD','OPTIONS'].includes(init.method??'GET'))headers.set('X-JSO-CSRF',current.csrfToken??'');
  const r=await fetch(path,{...init,headers,credentials:'same-origin',cache:'no-store'});
  const bytes=await r.arrayBuffer();
  if(generation!==epoch)throw Error('SESSION_CONTEXT_CHANGED');
  if(r.status===401){publish({enabled:true,authenticated:false});throw Object.assign(Error('登录已失效，请重新登录；本机待同步记录已保留。'),{status:401});}
  return new Response([204,205,304].includes(r.status)?null:bytes,{status:r.status,statusText:r.statusText,headers:r.headers});
 },
 async logout(){
  if(logoutInFlight)return logoutInFlight;
  const pendingAuthentication=authenticationInFlight??initial;localStorage.setItem(logoutKey,'1');publish({enabled:true,authenticated:false});
  logoutInFlight=(async()=>{try{await pendingAuthentication?.catch(()=>{});const latest=await raw('/api/v3/session');if(latest.authenticated){try{await raw('/api/v3/session/logout',{},latest.csrfToken);}catch(e){if(e.status!==401)throw e;}}localStorage.removeItem(logoutKey);return true;}catch{return false;}finally{logoutInFlight=null;}})();return logoutInFlight;
 },
};
window.addEventListener('storage',e=>{if((e.key===logoutKey||e.key===sessionKey)&&e.newValue)publish({enabled:current.enabled,authenticated:false});});
