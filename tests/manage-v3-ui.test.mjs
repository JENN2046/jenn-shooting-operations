// Real shipped handlers; synthetic DOM and in-process HTTP, not a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {launch} from './support/first-launch-v3-fixture.mjs';
import {dom,managementScript} from './support/manage-synthetic-dom.mjs';
test('management UI creates distinct still-life order, filters it, sets duration, adopts proposal, records actual start and complete',async()=>{
 const f=await launch();try{
 const {ids,document}=dom();
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,crypto:{randomUUID},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async(path,opt)=>{const r=await f.call(path,opt.body?JSON.parse(opt.body):undefined,opt.headers.Authorization.slice(7));return {ok:r.status<400,status:r.status,json:async()=>r.body};}});
 vm.runInContext(managementScript(),context);
 async function fire(id,event){const e=typeof id==='string'?ids.get(id):id;await e.fire(event);for(let i=0;i<150;i++){await new Promise(r=>setImmediate(r));if(ids.get('message').textContent!=='正在处理…')return;}throw Error('UI did not settle');}
 ids.get('token').value='a'.repeat(40);await fire('login','submit');assert.equal(ids.get('order-panel').hidden,false);
 const values={sku:'SYNTHETIC-UI',name:'功能图订单',category:'静物',subtype:'功能图',requested:'Synthetic requester',date:'2026-10-12',count:'1',ratio:'待定',sample:'arrivedVerified',priority:'p1',light:'SOFT',reflectivity:'unknown',brief:'功能图',note:''};
 for(const [k,v]of Object.entries(values))ids.get('order-'+k).value=v;
 await fire('order-form','submit');assert.match(ids.get('message').textContent,/订单已保存/);
 assert.match(ids.get('order-counts').textContent,/功能图 1/);
 ids.get('order-filter').value='产品3D主图';await fire('order-filter','change');assert.equal(ids.get('order-list').children.length,0);
 ids.get('order-filter').value='功能图';await fire('order-filter','change');assert.equal(ids.get('order-list').children.length,1);
 const duration=ids.get('requests').children[0];duration.children[1].children[0].value='30';await fire(duration,'submit');assert.match(ids.get('message').textContent,/时长已保存/);
 ids.get('plan-from').value='2026-10-12';ids.get('plan-through').value='2026-10-12';await fire('proposal-form','submit');
 const accept=ids.get('proposal').children.find(e=>e.tagName==='button'&&e.textContent==='采用全部场次');assert.ok(accept,ids.get('message').textContent);await fire(accept,'click');
 const session=(await f.state()).sessions[0];f.setTime(session.plannedStart);ids.get('actual-item').value=session.id;await fire('actual-start','click');assert.match(ids.get('message').textContent,/实际开拍/);
 f.setTime(new Date(Date.parse(session.plannedStart)+1800000).toISOString());ids.get('actual-item').value=session.id;await fire('actual-complete','click');assert.match(ids.get('message').textContent,/实际完成/);
 assert.equal(f.server.store.db.prepare('SELECT status FROM production_runs').get().status,'completed');
 }finally{f.close();}
});

test('confirmed forecast survives fresh page/reselection, and nonfirst selections survive mutations and invalidation',async()=>{
 const {scheduleOrders}=await import('./support/first-launch-v3-fixture.mjs');
 const f=await launch();try{
 const sessions=await scheduleOrders(f,3),first=sessions[0],second=sessions[1];
 // Finish the predecessor so the nonfirst selection can exercise actual execution and forecast.
 f.setTime(first.plannedStart);await f.ok('/api/v3/business/run-events',{eventId:'FIRST-START',runId:'FIRST-RUN',scheduleItemId:first.id,eventType:'start',expectedRunRevision:0});
 f.setTime(first.plannedEnd);await f.ok('/api/v3/business/run-events',{eventId:'FIRST-END',runId:'FIRST-RUN',scheduleItemId:first.id,eventType:'complete',expectedRunRevision:1});
 const storage=new Map();
 async function page(){
  const {ids,document}=dom();const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,crypto:{randomUUID},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(path,opt)=>{const r=await f.call(path,opt.body?JSON.parse(opt.body):undefined,opt.headers.Authorization.slice(7));return {ok:r.status<400,status:r.status,json:async()=>r.body};}});
  vm.runInContext(managementScript(),context);
  async function fire(id,event){await ids.get(id).fire(event);for(let i=0;i<150;i++){await new Promise(r=>setImmediate(r));if(ids.get('message').textContent!=='正在处理…')return;}throw Error('UI did not settle');}
  ids.get('token').value='a'.repeat(40);await fire('login','submit');return {ids,fire};
 }
 let {ids,fire}=await page();
 assert.equal(ids.get('actual-item').value,''); // no implicit first target
 ids.get('actual-item').value=second.id;await fire('actual-item','change');
 ids.get('dynamic-item').value=second.id;await fire('dynamic-item','change');
 f.setTime(second.plannedStart);await fire('actual-start','click');assert.match(ids.get('message').textContent,/实际开拍/);
 assert.equal(ids.get('actual-item').value,second.id);assert.equal(ids.get('dynamic-item').value,second.id);
 assert.equal(ids.get('dynamic-mode').value,'forecast');assert.equal(ids.get('dynamic-end').value,'');
 const events=JSON.stringify(f.server.store.db.prepare('SELECT * FROM production_events ORDER BY event_id').all());
 for(const end of ['11:20','11:30']){
  ids.get('dynamic-end').value=end;await fire('dynamic-form','submit');
  assert.equal(ids.get('dynamic-confirm').dataset.locked,'');
  assert.notEqual((await f.state()).sessions.find(s=>s.id===second.id).confirmedForecast?.estimatedEnd,`2026-10-12T03:${end.slice(3)}:00.000Z`);
  await fire('dynamic-confirm','click');assert.match(ids.get('message').textContent,/整批调整已保存/);
  assert.equal(ids.get('dynamic-item').value,second.id);assert.equal(ids.get('actual-item').value,second.id);assert.equal(ids.get('dynamic-end').value,end);
 }
 assert.equal(JSON.stringify(f.server.store.db.prepare('SELECT * FROM production_events ORDER BY event_id').all()),events);
 await fire('refresh','click');assert.equal(ids.get('dynamic-end').value,'11:30');
 ({ids,fire}=await page()); // new VM: no cached API data or handler state
 assert.equal(ids.get('dynamic-item').value,second.id);assert.equal(ids.get('actual-item').value,second.id);assert.equal(ids.get('dynamic-end').value,'11:30');
 assert.match(ids.get('dynamic-facts').textContent,/原计划：.*10:20.*已确认预计结束：.*11:30/);
 ids.get('dynamic-item').value=first.id;await fire('dynamic-item','change');ids.get('dynamic-item').value=second.id;await fire('dynamic-item','change');assert.equal(ids.get('dynamic-end').value,'11:30');
 f.setTime('2026-10-12T03:30:00.000Z');await fire('actual-complete','click');assert.equal(ids.get('actual-item').value,second.id);
 assert.equal((await f.state()).sessions.find(s=>s.id===second.id).runs[0].status,'completed');
 f.setTime('2026-10-13T00:00:00.000Z');await fire('refresh','click');
 assert.equal(ids.get('dynamic-item').value,'');assert.match(ids.get('dynamic-item-notice').textContent,/重新选择/);
 await fire('dynamic-form','submit');assert.match(ids.get('message').textContent,/没有可选择/);
 }finally{f.close();}
});

test('order reset restores native select defaults and dependent visibility across consecutive saves, receipt and logout',async()=>{
 const f=await launch();try{
 const {ids,document}=dom(),storage=new Map();let responseLost=false,rejected=false;const commands=[];
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,crypto:{randomUUID},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(path,opt)=>{
  const body=opt.body?JSON.parse(opt.body):undefined;
  if(path==='/api/v3/business/requests'){
   commands.push(body);
   if(rejected){rejected=false;return {ok:false,status:400,json:async()=>({ok:false,code:'TEST_REJECTED'})};}
  }
  const r=await f.call(path,body,opt.headers.Authorization.slice(7));
  if(path==='/api/v3/business/requests'&&responseLost){responseLost=false;throw Error('Response lost');}
  return {ok:r.status<400,status:r.status,json:async()=>r.body};
 }});
 vm.runInContext(managementScript(),context);
 async function fire(id,event){await ids.get(id).fire(event);for(let i=0;i<150;i++){await new Promise(r=>setImmediate(r));if(ids.get('message').textContent!=='正在处理…')return;}throw Error('UI did not settle');}
 async function login(){ids.get('token').value='a'.repeat(40);await fire('login','submit');}
 async function fill(kind,sub,name){for(const[k,v]of Object.entries({sku:name,name,category:kind,subtype:sub,requested:'Jenn synthetic',date:'2026-10-12',count:'1',ratio:'待定',sample:'arrivedVerified',priority:'p1',light:'SOFT',reflectivity:'unknown',brief:'reset regression'}))ids.get('order-'+k).value=v;await fire('order-category','change');}
 function defaults(){assert.equal(ids.get('order-category').value,'静物');assert.equal(ids.get('order-subtype').value,'产品3D主图');assert.equal(ids.get('order-subtype-label').hidden,false);assert.equal(ids.get('order-name').value,'');}
 // The fake must model the native reset, including no synthetic change event.
 ids.get('order-category').value='模特';let changes=0;ids.get('order-category').addEventListener('change',()=>changes++);ids.get('order-form').reset();assert.equal(ids.get('order-category').value,'静物');assert.equal(changes,0);
 await login();
 for(const[kind,sub,name]of [['模特','模特','model'],['静物','细节图','detail'],['场景','场景','scene'],['静物','功能图','function']]){
  await fill(kind,sub,name);await fire('order-form','submit');assert.match(ids.get('message').textContent,/订单已保存/);defaults();
 }
 await fill('场景','场景','receipt');responseLost=true;await fire('order-form','submit');assert.equal(ids.get('message').textContent,'Response lost');
 const pending=storage.get('jso.pending.operation');assert.ok(pending);assert.equal(ids.get('order-category').value,'场景');assert.equal(ids.get('order-name').value,'receipt');
 await fire('logout','click');assert.equal(storage.get('jso.pending.operation'),pending);assert.equal(ids.get('order-name').value,'receipt');await login();assert.equal(ids.get('order-category').value,'场景');
 await fire('reconcile','click');assert.match(ids.get('message').textContent,/已找到原操作回执/);assert.equal(storage.has('jso.pending.operation'),false);defaults();
 await fill('模特','模特','logout');await fire('logout','click');await login();defaults();
 await fill('场景','场景','retry');rejected=true;await fire('order-form','submit');assert.match(ids.get('message').textContent,/TEST_REJECTED/);assert.equal(ids.get('order-name').value,'retry');assert.equal(ids.get('order-category').value,'场景');assert.equal(storage.has('jso.pending.operation'),false);
 const failedId=commands.at(-1).submission.operationId;await fire('order-form','submit');assert.match(ids.get('message').textContent,/订单已保存/);assert.equal(commands.at(-1).submission.operationId,failedId);defaults();
 await fire('refresh','click');const facts=(await f.state()).orderFacts;assert.deepEqual(facts.map(r=>[r.name,r.shootingSubtype]).sort(),[['model','模特'],['detail','细节图'],['scene','场景'],['function','功能图'],['receipt','场景'],['retry','场景']].sort());
 }finally{f.close();}
});
