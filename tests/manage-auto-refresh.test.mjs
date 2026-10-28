import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {randomUUID} from 'node:crypto';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';import {dom,managementScript} from './support/manage-synthetic-dom.mjs';
test('automatic page read times out, resumes and preserves draft base; older replies and logged-out replies cannot render',async()=>{
 const f=await launch();try{await scheduleOrders(f,1);const {ids,document}=dom();let timeout,hang=false,held=false,release,calls=0,next;
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,AbortController,crypto:{randomUUID},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async(url,opt)=>{
  calls++;if(hang)return new Promise((_resolve,reject)=>opt.signal.addEventListener('abort',()=>reject(Error('aborted'))));
  if(held)await new Promise(r=>release=r);const value=next||await f.state();return {ok:true,status:200,json:async()=>value};
 }});
 vm.runInContext(managementScript(),context);context.window={setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}};
 const initial=await f.state();vm.runInContext(`token='${'a'.repeat(40)}';state=${JSON.stringify(initial)};render()`,context);
 hang=true;const pending=vm.runInContext('refreshScheduleAutomatically()',context);await new Promise(r=>setImmediate(r));assert.equal(vm.runInContext('automaticRead',context),true);
 await vm.runInContext('refreshScheduleAutomatically()',context);assert.equal(calls,1);timeout();await pending;assert.equal(vm.runInContext('automaticRead',context),false);
 hang=false;next={...initial,revisions:{scheduleRevision:initial.revisions.scheduleRevision+2,projectionRevision:initial.revisions.projectionRevision+2},sessions:initial.sessions.map(s=>({...s,plannedStart:'2026-10-12T01:15:00.000Z'}))};
 vm.runInContext("pageDraftDirty=true;document.querySelector('#am-start').value='07:45'",context);
 await vm.runInContext('refreshScheduleAutomatically()',context);assert.equal(ids.get('am-start').value,'07:45');assert.equal(vm.runInContext('state.revisions.scheduleRevision',context),initial.revisions.scheduleRevision);assert.match(ids.get('sessions').children[0].children[1].textContent,/09:15/);
 const displayedRow=ids.get('sessions').children[0];await vm.runInContext('refreshScheduleAutomatically()',context);assert.equal(ids.get('sessions').children[0],displayedRow,'unchanged displayed revision preserves schedule controls');
 next={...initial,revisions:{scheduleRevision:initial.revisions.scheduleRevision+1,projectionRevision:initial.revisions.projectionRevision+1}};await vm.runInContext('refreshScheduleAutomatically()',context);assert.match(ids.get('sessions').children[0].children[1].textContent,/09:15/);
 held=true;next={...next,revisions:{scheduleRevision:initial.revisions.scheduleRevision+3,projectionRevision:initial.revisions.projectionRevision+3}};
 const old=vm.runInContext('refreshScheduleAutomatically()',context);await new Promise(r=>setImmediate(r));vm.runInContext("token='';state=null",context);release();await old;assert.equal(vm.runInContext('state',context),null);
 }finally{f.close();}
});
test('button-only calendar exception additions and removals survive background snapshots',async()=>{
 const f=await launch();try{for(const action of ['add','remove']){
  const {ids,document}=dom(),initial=await f.state();
  if(action==='remove')initial.configs.find(c=>c.active).configJson.resourceCalendars[0].dateOverrides=[{date:'2026-10-13',status:'closed',windows:[]}];
  const next={...initial,revisions:{scheduleRevision:initial.revisions.scheduleRevision+1,projectionRevision:initial.revisions.projectionRevision+1}};
  const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,AbortController,crypto:{randomUUID},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async()=>({ok:true,status:200,json:async()=>next})});
  vm.runInContext(managementScript(),context);context.window={setTimeout(){return 1;},clearTimeout(){}};
  vm.runInContext(`token='${'a'.repeat(40)}';state=${JSON.stringify(initial)};render()`,context);
  const list=ids.get('exceptions');
  if(action==='add')await ids.get('add-exception').fire('click');
  else{const item=list.children[0];item.remove=()=>{list.children=list.children.filter(e=>e!==item);};await item.children.at(-1).fire('click');}
  assert.equal(vm.runInContext('pageDraftDirty',context),true,action);
  const localRows=[...list.children];await vm.runInContext('refreshScheduleAutomatically()',context);
  assert.deepEqual(list.children,localRows,action+' stays local without input/change');assert.equal(vm.runInContext('state.revisions.scheduleRevision',context),initial.revisions.scheduleRevision);
 }}finally{f.close();}
});

async function recoveryPage(f){
 const {ids,document}=dom(),storage=new Map();let failure=false,hold=false,release,calls=0;
 let next=await f.state();
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,AbortController,crypto:{randomUUID},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  fetch:async()=>{calls++;if(hold){hold=false;await new Promise(r=>release=r);throw Error('late failure');}if(failure)throw Error('offline');return {ok:true,status:200,json:async()=>structuredClone(next)};}});
 vm.runInContext(managementScript(),context);context.window={setTimeout(){return 1;},clearTimeout(){}};
 context.initial=next;vm.runInContext("token='a'.repeat(40);state=initial;automaticDisplayed=state.revisions;render()",context);
 return {ids,context,storage,setFailure:v=>failure=v,setNext:v=>next=v,holdNext(){hold=true;},release(){release();},get calls(){return calls;}};
}

test('same-revision recovery clears offline status without overwriting a draft or touching UNKNOWN',async()=>{
 const f=await launch();try{
  const p=await recoveryPage(f);p.setFailure(true);await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.match(p.ids.get('auto-sync-state').textContent,/暂未更新/);
  vm.runInContext("pageDraftDirty=true;document.querySelector('#am-start').value='07:45'",p.context);
  p.setFailure(false);await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.match(p.ids.get('auto-sync-state').textContent,/已核对/);
  assert.equal(p.ids.get('am-start').value,'07:45');assert.equal(vm.runInContext('pageDraftDirty',p.context),true);
  vm.runInContext("savePending({id:'ORIGINAL-UNKNOWN',path:'/existing-write',body:{operationId:'ORIGINAL-UNKNOWN'}})",p.context);
  const before=p.storage.get('jso.pending.operation'),calls=p.calls;
  await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.equal(p.calls,calls);assert.equal(p.storage.get('jso.pending.operation'),before);
  assert.equal(p.ids.get('unknown').hidden,false);
 }finally{f.close();}
});

test('same displayed revision recovery retains the warning when the editable draft base is older',async()=>{
 const f=await launch();try{
  const p=await recoveryPage(f),initial=await f.state();
  vm.runInContext("pageDraftDirty=true;document.querySelector('#am-start').value='07:45'",p.context);
  p.setNext({...initial,revisions:{scheduleRevision:initial.revisions.scheduleRevision+1,projectionRevision:initial.revisions.projectionRevision+1}});
  await vm.runInContext('refreshScheduleAutomatically()',p.context);
  p.setFailure(true);await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.match(p.ids.get('auto-sync-state').textContent,/暂未更新/);
  p.setFailure(false);await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.match(p.ids.get('auto-sync-state').textContent,/未保存的编辑已保留/);
  assert.equal(p.ids.get('am-start').value,'07:45');assert.equal(vm.runInContext('state.revisions.scheduleRevision',p.context),initial.revisions.scheduleRevision);
 }finally{f.close();}
});

test('manual refresh clears offline status and a late automatic failure cannot restore it',async()=>{
 const f=await launch();try{
  const p=await recoveryPage(f);p.setFailure(true);await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.match(p.ids.get('auto-sync-state').textContent,/暂未更新/);
  p.setFailure(false);p.holdNext();const held=vm.runInContext('refreshScheduleAutomatically()',p.context);
  await new Promise(r=>setImmediate(r));await vm.runInContext('refresh()',p.context);
  assert.match(p.ids.get('auto-sync-state').textContent,/已更新/);
  p.release();await held;
  assert.match(p.ids.get('auto-sync-state').textContent,/已更新/);
 }finally{f.close();}
});
