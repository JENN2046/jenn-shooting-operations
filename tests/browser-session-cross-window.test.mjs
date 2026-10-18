import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../public/browser-session.js',import.meta.url),'utf8').replace('export const browserSession=','const browserSession=')+'\nglobalThis.api=browserSession;';
const response=v=>new Response(JSON.stringify({ok:true,enabled:true,...v}),{headers:{'content-type':'application/json'}});
function windows(){const saved=new Map([['queue-original','preserved']]),tabs=[];return {saved,tab(fetch){const handlers={},tab={handlers};tabs.push(tab);const storage={getItem:k=>saved.get(k)??null,setItem(k,v){saved.set(k,v);for(const other of tabs)if(other!==tab)queueMicrotask(()=>other.handlers.storage?.({key:k,newValue:v}));},removeItem:k=>saved.delete(k)};const context=vm.createContext({fetch,Headers,Response,AbortSignal,crypto:{randomUUID},navigator:{},localStorage:storage,CustomEvent:class{},window:{dispatchEvent(){},addEventListener:(k,fn)=>handlers[k]=fn}});vm.runInContext(source,context);tab.api=context.api;return tab;}};}
for(const authenticatedReply of [false,true])test(`login broadcast cancels stale init=${authenticatedReply} without logging out the new session`,async()=>{
 const w=windows();let issued=false,revoked=0,release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const common=async(path,init={})=>{if(path.endsWith('/login')){issued=true;return response({authenticated:true,deviceId:JSON.parse(init.body).deviceId,csrfToken:'SYNTHETIC-CSRF'});}if(path.endsWith('/logout')){revoked++;issued=false;return response({});}return response({authenticated:issued,csrfToken:'SYNTHETIC-CSRF'});};
 const a=w.tab(common);await a.api.init();const b=w.tab(async(path,init)=>{if(path==='/api/v3/session'){entered();await gate;return response({authenticated:authenticatedReply,csrfToken:'SYNTHETIC-CSRF'});}return common(path,init);});
 const pending=b.api.init().catch(e=>e.message);await ready;await a.api.login('SYNTHETIC-ONLY');release();assert.equal(await pending,'SESSION_CONTEXT_CHANGED');await new Promise(r=>setImmediate(r));
 assert.equal(a.api.authenticated,true);assert.equal(b.api.authenticated,false);assert.equal(issued,true);assert.equal(revoked,0);assert.equal(w.saved.has('jso.browser.logout-pending'),false);
 await a.api.logout();await new Promise(r=>setImmediate(r));assert.equal(a.api.authenticated,false);assert.equal(b.api.authenticated,false);assert.equal(issued,false);assert.equal(revoked,1);assert.equal(w.saved.get('queue-original'),'preserved');
});
test('a stale read after another window login cannot render or revoke the replacement; explicit logout still propagates',async()=>{
 const w=windows();let issued=false,revoked=0,release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const backend=async(path,init={})=>{if(path.endsWith('/login')){issued=true;return response({authenticated:true,deviceId:JSON.parse(init.body).deviceId,csrfToken:'SYNTHETIC-CSRF'});}if(path.endsWith('/logout')){issued=false;revoked++;return response({});}if(path==='/api/v3/business/state'){entered();await gate;return response({privateOldSnapshot:true});}return response({authenticated:issued,csrfToken:'SYNTHETIC-CSRF'});};
 const a=w.tab(backend);await a.api.init();await a.api.login('SYNTHETIC-ONLY');const b=w.tab(backend);await b.api.init();const reading=b.api.request('/api/v3/business/state').catch(e=>e.message);await ready;await a.api.login('SYNTHETIC-ONLY');release();assert.equal(await reading,'SESSION_CONTEXT_CHANGED');assert.equal(a.api.authenticated,true);assert.equal(issued,true);assert.equal(revoked,0);assert.equal(w.saved.has('jso.browser.logout-pending'),false);
 await a.api.logout();await new Promise(r=>setImmediate(r));assert.equal(issued,false);assert.equal(b.api.authenticated,false);assert.equal(revoked,1);
});
