import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dom} from './support/manage-synthetic-dom.mjs';
import {browserStorage} from './support/kiosk-offline-fixture.mjs';
import {deriveKioskActionState,createKioskControlLock} from '../public/kiosk-control-lock.js';
const settle=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
function lockManager(){const held=new Map();return {held,request:async(name,options,callback)=>{if(held.has(name))return callback(null);const entry={};held.set(name,entry);try{return await callback({name});}finally{if(held.get(name)===entry)held.delete(name);}}};}
function page(locks,{request=async()=>{throw TypeError('synthetic offline');}}={}){
 const {ids,document}=dom(),handlers=new Map();document.getElementById=id=>ids.get(id);document.hidden=false;
 ids.get('complete-dialog').close=()=>{};
 const window={addEventListener(name,fn){const a=handlers.get(name)??[];a.push(fn);handlers.set(name,a);},removeEventListener(){}};
 const browserSession={authenticated:false,request};
 const context=vm.createContext({document,window,navigator:{locks,onLine:false},localStorage:browserStorage(),browserSession,deriveKioskActionState,createKioskControlLock,crypto:{randomUUID},Date,Intl,AbortSignal,structuredClone,setInterval:()=>1});
 const source=readFileSync(new URL('../public/kiosk-online-v3.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(source+`\nglobalThis.seed=()=>{identity={subjectId:'Jenn',deviceId:'BROWSER-SYNTHETIC-001',resourceId:'Jenn'};model={sessions:[{id:'SESSION-SYNTHETIC-001',state:'scheduled',supported:true,run:null,tasks:[{name:'synthetic',sku:'synthetic',shootingSubtype:'产品3D主图'}]}],revisions:{scheduleRevision:1},writeAdmission:'enabled',conflict:false};selected=model.sessions[0].id;queue={inspect:()=>({ok:true,items:[],pendingCount:0,syncStatus:'idle'})};render();};globalThis.state=()=>({controlling,viewActive,identity});`,context);
 context.seed();return {ids,browserSession,state:context.state,async fire(name,detail){await Promise.all((handlers.get(name)??[]).map(fn=>fn({detail})));await settle();}};
}
test('loaded personal field reacquires existing control after management → offline → field',async()=>{
 const locks=lockManager(),p=page(locks);
 await p.fire('jso-field-view',{active:true});assert.equal(p.state().controlling,true);
 await p.fire('jso-field-view',{active:false});assert.equal(locks.held.size,0);
 await p.fire('jso-field-view',{active:true});assert.equal(p.state().controlling,true);assert.equal(p.ids.get('action-start').disabled,false);assert.equal(locks.held.size,1);
 await p.fire('pagehide');assert.equal(locks.held.size,0);
});
test('offline field reentry never steals another window control; leaving makes it available',async()=>{
 const locks=lockManager(),a=page(locks),b=page(locks);
 await a.fire('jso-field-view',{active:true});await b.fire('jso-field-view',{active:true});assert.equal(a.state().controlling,true);assert.equal(b.state().controlling,false);assert.equal(b.ids.get('action-start').disabled,true);assert.equal(locks.held.size,1);
 await a.fire('jso-field-view',{active:false});assert.equal(locks.held.size,0);
 await b.fire('jso-field-view',{active:false});await b.fire('jso-field-view',{active:true});assert.equal(b.state().controlling,true);
 await b.fire('pagehide');assert.equal(locks.held.size,0);
});
test('logout and leave during delayed refresh cannot leave or reacquire a hidden field lock',async()=>{
 const locks=lockManager(),a=page(locks);await a.fire('jso-field-view',{active:true});
 await a.fire('jso-session-changed');assert.equal(a.state().identity,null);assert.equal(locks.held.size,0);
 await a.fire('jso-field-view',{active:true});assert.equal(locks.held.size,0);
 let fail,entered;const ready=new Promise(r=>entered=r),b=page(locks,{request:()=>{entered();return new Promise((_,r)=>fail=r);}});
 const opening=b.fire('jso-field-view',{active:true});await ready;await b.fire('jso-field-view',{active:false});fail(TypeError('synthetic offline'));await opening;
 assert.equal(b.state().viewActive,false);assert.equal(b.state().controlling,false);assert.equal(locks.held.size,0);
});
