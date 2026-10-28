import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dom,managementScript} from './support/manage-synthetic-dom.mjs';
import {studioDayFixture,databaseFacts,studioNow} from './support/studio-day-fixture.mjs';
import {createOrder} from './support/first-launch-v3-fixture.mjs';
import {createApplyRunEvent} from '../src/run-event-use-case-v2.mjs';
import {createSqliteRunEventStore} from '../src/sqlite-run-event-store-v2.mjs';

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
  assert.notEqual(js.searchParams.get('v'),'studio-day-20261027-r1-1','refresh recovery fix must bypass the previous script cache key');
  assert.equal(ids.get('management-shell').dataset.authenticated,'true');
  assert.match(ids.get('identity').textContent,/Jenn.*可编辑.*北京时间/);
  assert.match(html,/<small id="auto-sync-state" role="status">排班会自动更新。/);
  assert.ok(ids.get('refresh').handlers.click.length);assert.ok(ids.get('logout').handlers.click.length);
  assert.match(html,/<p id="message" role="status" aria-live="polite">/);
  assert.equal(ids.get('daily-panel').hidden,false);
  assert.match(text(ids.get('daily-summary')),/4 今日场次/);assert.match(text(ids.get('daily-summary')),/1 已完成/);
  assert.match(text(ids.get('daily-current')),/拍摄中.*已确认预计结束.*不是实际完成/);
  assert.match(text(ids.get('daily-next')),/待开始.*功能图/);
  assert.equal(ids.get('daily-ready').children.length,2);
  assert.match(text(ids.get('daily-attention')),/计划已结束，但没有实际开拍或完成事实/);
  assert.equal(ids.get('daily-attention').children.length,5);
  assert.equal(ids.get('daily-attention-title').textContent,'待处理 · 5');
  await fire('daily-attention-toggle');
  assert.match(text(ids.get('daily-attention')),/sample ·.*样品尚未核实/);
  for(const [card,label]of [['daily-current','本人现场'],['daily-next','查看并开拍']]){
   const primary=ids.get(card).children.filter(child=>child.className?.includes('daily-primary'));
   assert.equal(primary.length,1);assert.equal(primary[0].textContent,label);
  }
  await fire(button(ids.get('daily-current'),'本人现场'));
  await fire(button(ids.get('daily-next'),'本人现场'));
  await fire(button(ids.get('daily-next'),'查看并开拍'));assert.equal(ids.get('actual-item').value,f.next.id);
  await fire(button(ids.get('daily-current'),'当天动态调整'));assert.equal(ids.get('dynamic-item').value,f.current.id);
  const ready=ids.get('daily-ready').children[0];
  await fire(button(ready,'时长维护'));await fire(button(ready,'Proposal'));await fire(button(ready,'订单维护'));
  assert.match(ids.get('order-edit-state').textContent,/维护：ready/);
  assert.equal(p.posts.length,0,'shortcuts must not dispatch, preview/adopt, or generate proposals');
  assert.equal(databaseFacts(f.server.store.db),before);
  await fire('logout');assert.equal(ids.get('management-shell').dataset.authenticated,'false');assert.equal(ids.get('workspace').hidden,true);
 }finally{f.close();}
});

test('attention badges reuse API severity, retain backend ordering, and count only displayed nonduplicate rows',async()=>{
 const f=await studioDayFixture();try{
  const db=f.server.store.db;
  const apply=createApplyRunEvent({store:createSqliteRunEventStore({db,businessTimeZone:'Asia/Shanghai'}),clock:()=>new Date(studioNow),eventTimePolicy:()=>({ok:true}),auditRole:'administrator',notifications:'disabled'});
  assert.equal(apply({eventId:'POLISH-BLOCK',runId:'STUDIO-RUN-2',scheduleItemId:f.current.id,eventType:'block',expectedRunRevision:1,occurredAt:studioNow,deviceId:'SYNTHETIC-STUDIO',actorId:'Jenn',reasonCode:'sampleWaiting',note:null}).ok,true);
  const original=(await f.state()).dailyOperations,before=databaseFacts(db),p=await page(f);
  const expected=original.attentionQueue.filter(item=>item.code!=='UNSCHEDULED_READY');
  const check=rows=>{
   assert.deepEqual(p.ids.get('daily-attention').children.map(line=>line.dataset.attentionCode),rows.map(item=>item.code));
   assert.equal(p.ids.get('daily-attention-title').textContent,`待处理 · ${rows.length}`);
   for(const [line,item]of p.ids.get('daily-attention').children.map((line,i)=>[line,rows[i]])){
    assert.equal(line.children[0].textContent,({critical:'阻塞',warning:'需核对',info:'提醒'})[item.severity]);
   }
  };
  check(expected.slice(0,5));await p.fire('daily-attention-toggle');check(expected);
  assert.match(text(p.ids.get('daily-attention')),/阻塞/);assert.match(text(p.ids.get('daily-attention')),/需核对/);assert.match(text(p.ids.get('daily-attention')),/提醒/);
  assert.equal(p.ids.get('daily-ready').children.length,original.readyUnscheduledOrders.length);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(state.dailyOperations)',p.context)),original);
  await p.fire('daily-attention-toggle');check(expected.slice(0,5));
  vm.runInContext('renderDaily({...state,dailyOperations:{...state.dailyOperations,attentionQueue:[]}})',p.context);
  assert.equal(p.ids.get('daily-attention-title').textContent,'待处理 · 0');assert.equal(p.ids.get('daily-attention').children.length,0);assert.equal(p.ids.get('daily-attention-empty').hidden,false);
  assert.equal(p.posts.length,0);assert.equal(databaseFacts(db),before);
 }finally{f.close();}
});

test('both list expansions survive same-snapshot reads, remain local, and cannot bypass pending reconciliation',async()=>{
 const f=await studioDayFixture();try{
  for(let i=0;i<4;i++){
   const {result}=await createOrder(f,0,{operationId:'POLISH-READY-'+i,sku:'POLISH-'+i,name:'Extra ready '+i});
   const r=(await f.state()).revisions;await f.ok(`/api/v3/business/requests/${result.requestId}/duration`,{operationId:'POLISH-DURATION-'+i,requestId:result.requestId,expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision,durationMinutes:30});
  }
  const before=databaseFacts(f.server.store.db),p=await page(f),{ids,fire}=p;
  for(const kind of ['attention','ready']){assert.equal(ids.get('daily-'+kind).children.length,5);await fire('daily-'+kind+'-toggle');assert.equal(ids.get('daily-'+kind+'-toggle').ariaExpanded,'true');}
  const counts=['attention','ready'].map(kind=>ids.get('daily-'+kind).children.length);
  p.context.window={setTimeout:()=>1,clearTimeout(){}};
  for(let i=0;i<3;i++)await vm.runInContext('refreshScheduleAutomatically()',p.context);
  for(const [i,kind]of ['attention','ready'].entries()){
   assert.equal(ids.get('daily-'+kind).children.length,counts[i]);assert.equal(ids.get('daily-'+kind+'-toggle').textContent,'收起');assert.equal(ids.get('daily-'+kind+'-toggle').ariaExpanded,'true');
  }
  await fire('refresh');assert.equal(ids.get('daily-ready').children.length,counts[1]);
  vm.runInContext("savePending({id:'UNRESOLVED',path:'/api/v3/business/run-events',body:{}});say('响应无法确认，请核对原操作结果。')",p.context);
  assert.equal(ids.get('unknown').hidden,false);assert.match(ids.get('message').textContent,/无法确认/);
  assert.equal(ids.get('reconcile').disabled,false);
  const actual=ids.get('actual-item').value;
  const primary=button(ids.get('daily-next'),'查看并开拍');assert.equal(primary.disabled,true);
  await fire(primary);assert.equal(ids.get('actual-item').value,actual);assert.match(ids.get('message').textContent,/核对当前管理操作/);
  await fire('daily-ready-toggle');assert.equal(ids.get('daily-ready').children.length,counts[1]);
  assert.equal(ids.get('unknown').hidden,false);assert.equal(p.posts.length,0);assert.equal(databaseFacts(f.server.store.db),before);
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
  // Repeated identical newer replies must not acquire the old draft's identity.
  await vm.runInContext('refreshScheduleAutomatically()',p.context);
  await vm.runInContext('refreshScheduleAutomatically()',p.context);
  assert.equal(p.ids.get('am-start').value,'07:45');assert.equal(vm.runInContext('state.revisions.scheduleRevision',p.context),revision);
  await p.fire(button(p.ids.get('daily-next'),'查看并开拍'));
  assert.match(p.ids.get('message').textContent,/原版本/);assert.equal(p.posts.length,0);
 }finally{f.close();}
});

test('request-level risk opens its unique bound reschedule form and never guesses among multiple sessions',async()=>{
 const f=await studioDayFixture();try{
  f.setTime('2026-10-13T00:00:00.000Z');const before=databaseFacts(f.server.store.db);
  const p=await page(f),{ids,fire,posts}=p;
  // Binding checks apply to every backend item, including rows after the local
  // five-row slice; request IDs need not put this order on the first page.
  if(!ids.get('daily-attention-toggle').hidden)await fire('daily-attention-toggle');
  const risk=()=>ids.get('daily-attention').children.find(line=>text(line).includes('功能图')&&button(line,'改期'));
  assert.ok(risk());await fire(button(risk(),'改期'));
  assert.equal(ids.get('reschedule-form').hidden,false);assert.equal(vm.runInContext('editing.id',p.context),f.next.id);
  await fire('cancel-edit');
  vm.runInContext(`{const bound=state.sessions.find(s=>s.id===${JSON.stringify(f.next.id)});state.sessions.push({...bound,id:'SYNTHETIC-EXTRA-SESSION'});const issue=state.dailyOperations.attentionQueue.find(i=>i.code==='DESIRED_DATE_AT_RISK'&&i.entityId===bound.requestIds[0]);issue.sourceFacts.scheduleItemIds.push('SYNTHETIC-EXTRA-SESSION');renderDaily(state);}`,p.context);
  await fire(button(risk(),'改期'));assert.equal(ids.get('reschedule-form').hidden,true);
  assert.match(ids.get('message').textContent,/没有唯一可选场次/);assert.equal(posts.length,0);
  assert.equal(databaseFacts(f.server.store.db),before);
 }finally{f.close();}
});

test('Shanghai midnight adopts a clean snapshot but preserves an actual draft across repeated polls',async()=>{
 const f=await studioDayFixture();try{
  const before=databaseFacts(f.server.store.db);
  for(const draft of [false,true]){
   f.setTime('2026-10-12T15:59:00.000Z');const p=await page(f);p.context.window={setTimeout:()=>1,clearTimeout(){}};
   if(draft)vm.runInContext("pageDraftDirty=true;document.querySelector('#am-start').value='07:45'",p.context);
   f.setTime('2026-10-12T16:01:00.000Z');
   for(let i=0;i<3;i++)await vm.runInContext('refreshScheduleAutomatically()',p.context);
   assert.match(p.ids.get('daily-date').textContent,/2026-10-13/);
   assert.equal(vm.runInContext('state.businessToday',p.context),draft?'2026-10-12':'2026-10-13');
   assert.equal(p.ids.get('plan-from').value,draft?'2026-10-12':'2026-10-13');
   await p.fire(button(p.ids.get('daily-ready').children[0],'Proposal'));
   if(draft){assert.equal(p.ids.get('am-start').value,'07:45');assert.match(p.ids.get('message').textContent,/原版本/);}
   else assert.doesNotMatch(p.ids.get('message').textContent,/原版本/);
   assert.equal(p.posts.length,0);
  }
  assert.equal(databaseFacts(f.server.store.db),before);
 }finally{f.close();}
});

test('daily dynamic shortcuts preserve unsaved inputs and previews for the same or another session',async()=>{
 const f=await studioDayFixture();try{
  const before=databaseFacts(f.server.store.db);
  for(const previewOnly of [false,true]){
   const p=await page(f),{ids,fire}=p;
   await fire(button(ids.get('daily-current'),'当天动态调整'));
   const selected=ids.get('dynamic-item').value;
   ids.get('dynamic-end').value='12:45';ids.get('dynamic-buffer').value='37';
   vm.runInContext(previewOnly?"dayPreview={ok:true,previewId:'PRESERVE'};document.querySelector('#dynamic-preview').hidden=false":"pageDraftDirty=true",p.context);
   const draft=vm.runInContext('JSON.stringify(dayPreview)',p.context);
   for(const card of ['daily-current','daily-next']){
    await fire(button(ids.get(card),'当天动态调整'));
    assert.match(ids.get('message').textContent,/未保存的动态调整/);
    assert.equal(ids.get('dynamic-item').value,selected);
    assert.equal(ids.get('dynamic-end').value,'12:45');assert.equal(ids.get('dynamic-buffer').value,'37');
    assert.equal(vm.runInContext('JSON.stringify(dayPreview)',p.context),draft);
    if(previewOnly)assert.equal(ids.get('dynamic-preview').hidden,false);
   }
   assert.equal(p.posts.length,0);
  }
  assert.equal(databaseFacts(f.server.store.db),before);
 }finally{f.close();}
});
