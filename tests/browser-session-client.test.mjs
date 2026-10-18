import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function client(fetch,saved=new Map([['queue-original','preserved']])){const context=vm.createContext({fetch,Response,Headers,AbortSignal,crypto:{randomUUID:()=> 'SYNTHETIC-UUID-001'},navigator:{},window:{dispatchEvent(){},addEventListener(){}},CustomEvent:class{},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}});vm.runInContext(readFileSync(new URL('../public/browser-session.js',import.meta.url),'utf8').replace('export const browserSession=','const browserSession=')+'\nglobalThis.api=browserSession;',context);return {api:context.api,saved};}
const response=v=>new Response(JSON.stringify({ok:true,enabled:true,...v}),{headers:{'content-type':'application/json'}});
for(const phase of ['login','init'])for(const failLogout of [false,true])test(`late ${phase} cannot undo logout; cleanup failure=${failLogout} is honest and durable`,async()=>{
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let revoked=0,issued=false,first=true;
 const authenticated=()=>({authenticated:issued,deviceId:'BROWSER-SYNTHETIC-UUID-001',csrfToken:'SYNTHETIC-CSRF'});
 const backend=async path=>{
  if(path.endsWith('/logout')){if(failLogout)throw Error('synthetic network unavailable');issued=false;revoked++;return response({});}
  if(path==='/api/v3/session'&&(phase==='login'||!first))return response(authenticated());
  first=false;entered();await gate;issued=true;return response(authenticated());
 };const {api,saved}=client(backend);
 if(phase==='login')await api.init();const pending=phase==='login'?api.login('SYNTHETIC-ONLY'):api.init();const settled=pending.catch(e=>e);await ready;
 const logout=api.logout();assert.equal(api.authenticated,false);release();await settled;const confirmed=await logout;
 assert.equal(api.authenticated,false);assert.equal(confirmed,!failLogout);assert.equal(revoked,failLogout?0:1);assert.equal(saved.get('queue-original'),'preserved');
 assert.equal(saved.has('jso.browser.logout-pending'),failLogout);
 await assert.rejects(api.request('/api/v3/field/events',{method:'POST'}));
 if(failLogout){const reloaded=client(backend,saved).api;await assert.rejects(reloaded.init());assert.equal(reloaded.authenticated,false);assert.equal(saved.get('jso.browser.logout-pending'),'1');}
});
