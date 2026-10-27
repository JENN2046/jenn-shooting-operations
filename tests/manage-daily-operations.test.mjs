import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dom,managementScript} from './support/manage-synthetic-dom.mjs';
import {studioDayFixture,databaseFacts} from './support/studio-day-fixture.mjs';

async function page(f){
 const {ids,document}=dom(),storage=new Map(),posts=[];let loseComplete=false;
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,AbortController,
  crypto:{randomUUID},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  fetch:async(path,opt)=>{
   const body=opt.body?JSON.parse(opt.body):undefined;if(body)posts.push({path,body});
   const r=await f.call(path,body,opt.headers.Authorization.slice(7));
   if(loseComplete&&path==='/api/v3/business/run-events'){loseComplete=false;throw Error('Response lost');}
   return {ok:r.status<400,status:r.status,json:async()=>r.body};
  }});
 vm.runInContext(managementScript(),context);
 async function fire(id,event='click'){
  await (typeof id==='string'?ids.get(id):id).fire(event);
  for(let i=0;i<300;i++){await new Promise(resolve=>setImmediate(resolve));if(ids.get('message').textContent!=='正在处理…')return;}
  throw Error('UI did not settle');
 }
 ids.get('token').value='a'.repeat(40);await fire('login','submit');
 return {ids,context,posts,storage,fire,loseNextComplete(){loseComplete=true;}};
}
const text = element => (element.textContent+' '+element.children.map(text).join(' ')).replace(/\s+/g,' ').trim();
const button = (element,label) => element.children.find(child=>child.tagName==='button'&&child.textContent===label);

test('shipped /manage first screen shows real daily facts and read-only navigation to original forms',async()=>{
 const f=await studioDayFixture();try{
  const before=databaseFacts(f.server.store.db),p=await page(f),{ids,fire}=p;
  const html=readFileSync(new URL('../public/manage.html',import.meta.url),'utf8');
  assert.ok(html.indexOf('id="daily-panel"')<html.indexOf('id="calendar-panel"'));
  const js=new URL(html.match(/src="([^\"]*manage\.js[^\"]*)"/)[1],'http://localhost');
  const css=new URL(html.match(/href="([^\"]*manage\.css[^\"]*)"/)[1],'http://localhost');
  assert.ok(js.searchParams.get('v'));assert.equal(js.searchParams.get('v'),css.searchParams.get('v'));assert.notEqual(js.searchParams.get('v'),'public-board-20261018-r1');
  assert.equal(ids.get('daily-panel').hidden,false);
  assert.match(text(ids.get('daily-summary')),/4 今日场次/);assert.match(text(ids.get('daily-summary')),/1 已完成/);
  assert.match(text(ids.get('daily-current')),/拍摄中.*已确认预计结束.*不是实际完成/);
  assert.match(text(ids.get('daily-next')),/待开始.*功能图/);
  assert.equal(ids.get('daily-ready').children.length,2);
  assert.match(text(ids.get('daily-attention')),/计划已结束，但没有实际开拍或完成事实/);
  assert.match(text(ids.get('daily-attention')),/sample ·.*样品尚未核实/);
  await fire(button(ids.get('daily-next'),'查看并开拍'));assert.equal(ids.get('actual-item').value,f.next.id);
  await fire(button(ids.get('daily-current'),'当天动态调整'));assert.equal(ids.get('dynamic-item').value,f.current.id);
  const ready=ids.get('daily-ready').children[0];
  await fire(button(ready,'时长维护'));await fire(button(ready,'Proposal'));await fire(button(ready,'订单维护'));
  assert.match(ids.get('order-edit-state').textContent,/维护：ready/);
  assert.equal(p.posts.length,0,'shortcuts must not dispatch, preview/adopt, or generate proposals');
  assert.equal(databaseFacts(f.server.store.db),before);
 }finally{f.close();}
});

test('daily entry preserves the original completion operation and reconciliation after a lost response',async()=>{
 const f=await studioDayFixture();try{
  const p=await page(f),{ids,fire,posts,storage}=p;
  await fire(button(ids.get('daily-current'),'查看实际执行'));assert.equal(ids.get('actual-item').value,f.current.id);
  p.loseNextComplete();await fire('actual-complete');assert.equal(posts.length,1);
  assert.equal(posts[0].path,'/api/v3/business/run-events');assert.equal(posts[0].body.eventType,'complete');assert.equal(posts[0].body.expectedRunRevision,1);
  const pending=JSON.parse(storage.get('jso.pending.operation'));assert.equal(pending.body.eventId,posts[0].body.eventId);
  const events=f.server.store.db.prepare('SELECT COUNT(*) AS n FROM production_events').get().n;
  await fire(button(ids.get('daily-current'),'查看实际执行'));assert.equal(posts.length,1);
  await fire('reconcile');assert.match(ids.get('message').textContent,/已找到原操作回执/);
  assert.equal(storage.has('jso.pending.operation'),false);assert.equal(posts.length,1);
  assert.equal(f.server.store.db.prepare('SELECT COUNT(*) AS n FROM production_events').get().n,events);
  assert.match(text(ids.get('daily-summary')),/2 已完成/);
 }finally{f.close();}
});

test('daily clock refreshes without a revision change and stale daily shortcuts never rebase a draft',async()=>{
 const f=await studioDayFixture();try{
  const p=await page(f);p.context.window={setTimeout:()=>1,clearTimeout(){}};
  const revision=vm.runInContext('state.revisions.scheduleRevision',p.context);
  f.setTime('2026-10-12T02:20:00.000Z');
  await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.match(text(p.ids.get('daily-current')),/已过 30 分钟/);
  vm.runInContext("pageDraftDirty=true;document.querySelector('#am-start').value='07:45'",p.context);
  const r=(await f.state()).revisions;
  await f.ok(`/api/v3/business/requests/${f.extras.readyOne}/duration`,{operationId:'EXTERNAL-DURATION',requestId:f.extras.readyOne,expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision,durationMinutes:35});
  await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.equal(p.ids.get('am-start').value,'07:45');assert.equal(vm.runInContext('state.revisions.scheduleRevision',p.context),revision);
  await p.fire(button(p.ids.get('daily-next'),'查看并开拍'));
  assert.match(p.ids.get('message').textContent,/原版本/);assert.equal(p.posts.length,0);
 }finally{f.close();}
});
