import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {publicFixture,png} from './support/public-board-fixture.mjs';
import {launch} from './support/first-launch-v3-fixture.mjs';
import {boardView} from '../public/board-model.js';
async function wire(f){await new Promise(r=>f.server.server.listen(0,'127.0.0.1',r));return (path,options={})=>fetch(`http://127.0.0.1:${f.server.server.address().port}`+path,options);}
async function close(f){await new Promise(r=>f.server.server.close(r));f.close();}
const tables=db=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
test('public mode serves only scheduled Jenn facts, retains customer/images/five categories, and never grants management authority',async()=>{
 const f=await publicFixture(),call=await wire(f);try{
  const before=tables(f.server.store.db),response=await call('/api/v3/public/board');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();assert.deepEqual(Object.keys(data).sort(),['ok','protocolVersion','revisions','orderFacts','sessions'].sort());
  assert.equal(data.orderFacts.length,5);assert.equal(data.sessions.length,5);assert.equal(new Set(data.orderFacts.map(x=>x.shootingSubtype)).size,5);
  assert.ok(data.orderFacts.every(x=>x.client==='Distinct synthetic customer'&&x.submission.requestedBy==='Synthetic customer visible'&&x.submission.note==='Synthetic customer instructions visible'&&x.references.length===1&&!('editable'in x)));
  assert.ok(!JSON.stringify(data).includes('HIDDEN-PENDING'));assert.ok(!JSON.stringify(data).includes('administrator'));assert.ok(!JSON.stringify(data).includes('configJson'));
  const view=boardView(data);assert.ok(view.tasks.every(t=>t.status==='scheduled'));assert.ok(view.sessions.every(s=>s.actualState==='scheduled'));assert.ok(view.sessions.every(s=>s.start>='09:00'));
  const ref=await call('/api/v3/public/board/references/'+f.ids[0]);assert.equal(ref.status,200);assert.deepEqual(Buffer.from(await ref.arrayBuffer()),png);assert.equal(ref.headers.get('cache-control'),'no-store');
  for(const path of ['/api/v3/business/state','/api/v3/business/board','/api/v3/business/operations/REG','/api/v3/business/proposals/UNKNOWN','/api/v3/business/references/'+f.ids[0]])assert.equal((await call(path)).status,401,path);
  for(const path of ['/api/v3/business/resources','/api/v3/business/config/preview','/api/v3/business/config/publish','/api/v3/business/config/activate','/api/v3/business/requests','/api/v3/business/requests/edit','/api/v3/business/run-events','/api/v3/business/day-adjustment/apply','/api/v3/business/proposals','/api/v3/business/references?operationId=NO-WRITE','/api/v3/proposals/UNKNOWN/decisions'])assert.equal((await call(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401,path);
  for(const method of ['POST','PUT','DELETE','PATCH','HEAD'])assert.equal((await call('/api/v3/public/board',{method})).status,404,method);
  assert.equal((await call('/api/v3/public/board?resourceId=OTHER')).status,400);
  assert.equal((await call('/api/v3/public/board',{headers:{Authorization:'Bearer not-a-real-token'}})).status,200);
  const auth=await call('/api/v3/business/state',{headers:{Authorization:'Bearer '+'a'.repeat(40)}});assert.equal(auth.status,200);assert.ok((await auth.json()).configs.length);
  assert.equal(tables(f.server.store.db),before);
 }finally{await close(f);}
});
test('anonymous images reject pending, unclaimed, orphan, cross-purpose, cross-resource, cancelled and unsafe files',async()=>{
 const f=await publicFixture(),call=await wire(f),db=f.server.store.db;try{
  const url=id=>'/api/v3/public/board/references/'+id;
  for(const id of [f.pendingImage,f.orphan,f.unclaimed,'not-found'])assert.equal((await call(url(id))).status,404,id);
  assert.equal((await call(url(f.ids[0])+'?download=1')).status,400);
  for(const path of ['/api/v3/public/board/references','/api/v3/public/board/references/%2e%2e%2fsecret','/api/v3/public/board/references/%2Fetc%2Fpasswd','/uploads','/backups','/logs'])assert.ok((await call(path)).status>=400,path);
  db.prepare("UPDATE uploads SET kind='video' WHERE id=?").run(f.ids[1]);assert.equal((await call(url(f.ids[1]))).status,404);
  const sessions=(await f.state()).sessions;const sessionFor=id=>sessions.find(s=>s.requestIds.includes(db.prepare('SELECT claimed_task_id FROM uploads WHERE id=?').get(id).claimed_task_id));
  db.prepare("UPDATE schedule_items SET resource_id='OTHER' WHERE id=?").run(sessionFor(f.ids[2]).id);assert.equal((await call(url(f.ids[2]))).status,404);
  db.prepare("UPDATE schedule_items SET schedule_status='cancelled' WHERE id=?").run(sessionFor(f.ids[3]).id);assert.equal((await call(url(f.ids[3]))).status,404);
  db.prepare("UPDATE schedule_items SET resource_resolution_status='unresolved',resource_id=NULL WHERE id=?").run(sessionFor(f.ids[4]).id);assert.equal((await call(url(f.ids[4]))).status,404);
  const first=sessionFor(f.ids[0]);db.prepare("UPDATE schedule_items SET schedule_status='draft' WHERE id=?").run(first.id);assert.equal((await call(url(f.ids[0]))).status,404);db.prepare("UPDATE schedule_items SET schedule_status='confirmed' WHERE id=?").run(first.id);
  const orderId=db.prepare('SELECT claimed_task_id FROM uploads WHERE id=?').get(f.ids[0]).claimed_task_id;
  db.prepare("UPDATE requests_v2 SET request_lifecycle='cancelled' WHERE id=?").run(orderId);assert.equal((await call(url(f.ids[0]))).status,404);assert.ok(!(await call('/api/v3/public/board').then(r=>r.json())).orderFacts.some(r=>r.id===orderId));
  db.prepare("UPDATE requests_v2 SET request_lifecycle='open' WHERE id=?").run(orderId);
  const asset=db.prepare('SELECT * FROM uploads WHERE id=?').get(f.ids[0]);const file=join(f.uploads,asset.stored_name),original=readFileSync(file);
  writeFileSync(file,Buffer.alloc(original.length));assert.equal((await call(url(f.ids[0]))).status,404);writeFileSync(file,original);
  const target=join(f.uploads,'synthetic-target');writeFileSync(target,original);unlinkSync(file);symlinkSync(target,file);assert.equal((await call(url(f.ids[0]))).status,404);
 }finally{await close(f);}
});
test('public mode defaults off, cannot be toggled outside the existing runtime binding, and does not change disabled digest semantics',async()=>{
 const f=await launch(),call=await wire(f);try{
  assert.equal((await call('/api/v3/public/board')).status,404);assert.equal((await call('/api/v3/public/board/references/any')).status,404);assert.equal((await call('/api/client-profile').then(r=>r.json())).publicBoard,undefined);
  const current=f.m.runtimeConfigDigest();assert.equal(f.m.runtimeConfigDigest({...process.env,JSO_PUBLIC_BOARD:'disabled'}),current);assert.notEqual(f.m.runtimeConfigDigest({...process.env,JSO_PUBLIC_BOARD:'enabled'}),current);
  assert.throws(()=>f.createServer('enabled',{publicBoardEnabled:true}),/PUBLIC_BOARD_CONFIG/);
  process.env.JSO_PUBLIC_BOARD='enabled';assert.throws(()=>f.createServer('enabled',{publicBoardEnabled:true}),/CONFIG_CHANGED/);process.env.JSO_PUBLIC_BOARD='disabled';
 }finally{await close(f);}
});

test('public schedule keeps plan, confirmed forecast and actual events distinct',async()=>{
 const f=await publicFixture(),call=await wire(f);try{
  const first=(await f.state()).sessions[0];f.setTime(first.plannedStart);
  await f.ok('/api/v3/business/run-events',{eventId:'PUBLIC-START',runId:'PUBLIC-RUN',scheduleItemId:first.id,eventType:'start',expectedRunRevision:0});
  const input={scheduleItemId:first.id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,endAt:'2026-10-12T03:30:00.000Z',bufferAfterMinutes:20};
  const preview=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(preview.preview.canApply,true);
  await f.ok('/api/v3/business/day-adjustment/apply',{operationId:'PUBLIC-FORECAST',input,previewDigest:preview.previewDigest});
  const view=boardView(await call('/api/v3/public/board').then(r=>r.json()));const current=view.sessions.find(s=>s.id===first.id);
  assert.equal(current.end,'09:30');assert.equal(current.confirmedForecast.estimatedEnd,input.endAt);assert.equal(current.actualState,'live');assert.equal(current.runs[0].completedAt,null);
  assert.equal(current.runs[0].runRevision,undefined);assert.equal(current.confirmedForecast.operationId,undefined);
  f.setTime('2026-10-12T02:00:00.000Z');await f.ok('/api/v3/business/run-events',{eventId:'PUBLIC-COMPLETE',runId:'PUBLIC-RUN',scheduleItemId:first.id,eventType:'complete',expectedRunRevision:1});
  const done=boardView(await call('/api/v3/public/board').then(r=>r.json())).sessions.find(s=>s.id===first.id);assert.equal(done.actualState,'completed');assert.equal(done.confirmedForecast.estimatedEnd,input.endAt);
 }finally{await close(f);}
});

// Exercise the actual page controller; DOM rendering has a separate real-browser check.
import vm from 'node:vm';
import {beijingParts} from '../public/board-model.js';
function pageHarness(){
 const nodes=new Map(),calls=[];let publicMode=false,clearCount=0,privateResolve,publicResolve;
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,value:'',dataset:{},children:['stale'],open:true,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(...children){this.children=children;},close(){this.open=false;}});return nodes.get(selector);};
 const payload=revision=>({ok:true,revisions:{projectionRevision:revision},orderFacts:[],sessions:[]});
 const sandbox={Map,Set,Date,Intl,document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},matchMedia:()=>({addEventListener(){}}),setInterval:()=>1,clearInterval(){},boardView,beijingParts,showMessage:(el,text)=>el.textContent=text,clearReferenceImages:()=>clearCount++,retainReferenceImages(){},fetch:async(path,options)=>{
  calls.push({path,options});if(path==='/api/client-profile')return{ok:true,json:async()=>({protocolVersion:3,publicBoard:publicMode})};
  return new Promise(resolve=>{const done=revision=>resolve({ok:true,json:async()=>payload(revision)});if(path==='/api/v3/public/board')publicResolve=done;else privateResolve=done;});
 }};
 let source=readFileSync(new URL('../public/board.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/\nloadBoard\(\);\s*$/,'');
 source+=`\nrenderCalendar=()=>{};renderPending=()=>{};globalThis.pageApi={load:loadBoard,seed(){token='synthetic-private-only';publicBoard=false;currentSnapshot={revision:'private'};board.hidden=false;},state:()=>({token,publicBoard,currentSnapshot,authEpoch})};`;
 vm.runInNewContext(source,sandbox);
 return{nodes,node,calls,api:sandbox.pageApi,setPublic:value=>publicMode=value,clearCount:()=>clearCount,resolvePrivate:revision=>privateResolve(revision),resolvePublic:revision=>publicResolve(revision)};
}
const pageTick=()=>new Promise(r=>setImmediate(r));
test('switching private/public clears old details and images, drops credentials and rejects stale private responses',async()=>{
 const h=pageHarness();h.api.seed();const oldRead=h.api.load();await pageTick();
 assert.equal(h.calls.at(-1).options.headers.Authorization,'Bearer synthetic-private-only');
 h.setPublic(true);const publicRead=h.api.load();await pageTick();
 assert.equal(h.api.state().token,'');assert.equal(h.api.state().currentSnapshot,null);assert.ok(h.clearCount()>0);
 assert.equal(h.node('#session-dialog').open,false);assert.equal(h.node('#session-dialog-content').children.length,0);assert.equal(h.node('#pending').children.length,0);assert.equal(h.node('#day-agenda').children.length,0);
 assert.equal(h.calls.at(-1).path,'/api/v3/public/board');assert.equal(h.calls.at(-1).options.headers.Authorization,undefined);assert.equal(h.calls.at(-1).options.credentials,'omit');
 h.resolvePublic(7);await publicRead;h.resolvePrivate(99);await oldRead;assert.equal(h.api.state().currentSnapshot.revision,7);
 h.node('#session-dialog').open=true;h.node('#session-dialog-content').children=['public image'];
 h.setPublic(false);await h.api.load();assert.equal(h.api.state().currentSnapshot,null);assert.equal(h.node('#session-dialog').open,false);assert.equal(h.node('#session-dialog-content').children.length,0);assert.equal(h.node('#board-login').hidden,false);
});
test('logout clears all page data and images and prevents an in-flight authenticated response repaint',async()=>{
 const h=pageHarness();h.api.seed();const oldRead=h.api.load();await pageTick();
 h.node('#board-logout').handlers.click();assert.equal(h.api.state().token,'');assert.equal(h.api.state().currentSnapshot,null);assert.ok(h.clearCount()>0);
 assert.equal(h.node('#session-dialog-content').children.length,0);assert.equal(h.node('#day-agenda').children.length,0);assert.equal(h.node('#board-login').hidden,false);
 h.resolvePrivate(99);await oldRead;assert.equal(h.api.state().currentSnapshot,null);assert.equal(h.node('#board').hidden,true);
});

 test('empty public schedule is a successful read and R5 binds public and browser modes independently',async()=>{
 const f=await launch({publicBoard:true}),call=await wire(f);try{
  const data=await (await call('/api/v3/public/board')).json();assert.deepEqual(data.orderFacts,[]);assert.deepEqual(data.sessions,[]);assert.equal(data.ok,true);
  const env={...process.env,JSO_BROWSER_SESSION_RUNTIME:'enabled',JSO_BROWSER_ORIGIN:'https://public.synthetic.example'};
  const both=f.m.runtimeConfigDigest(env,5);assert.notEqual(both,f.m.runtimeConfigDigest({...env,JSO_PUBLIC_BOARD:'disabled'},5));assert.notEqual(both,f.m.runtimeConfigDigest({...env,JSO_BROWSER_SESSION_RUNTIME:'disabled'},5));
  assert.equal(f.m.runtimeConfigDigest({...env,JSO_PUBLIC_BOARD:'disabled'},5),f.m.runtimeConfigDigest({...env,JSO_PUBLIC_BOARD:undefined},5));
 }finally{await close(f);}
});

import {createBrowserSessionOptionsFromEnv} from '../src/browser-session-v1.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';
import {createSchedulingV2Application} from '../src/server.mjs';
import {createHttpApp} from '../src/http-app.mjs';
test('public board and images coexist with private administrator Cookie without granting anonymous writes',async()=>{
 const f=await publicFixture();
 const origin='https://public.synthetic.example';
 const runtime=createBrowserSessionOptionsFromEnv({...process.env,JSO_BROWSER_SESSION_RUNTIME:'enabled',JSO_BROWSER_ORIGIN:origin}).browserSessionRuntime;
 const bearer=createBusinessRuntimeOptionsFromEnv(process.env).schedulingAuthenticate;
 const scheduling=createSchedulingV2Application({store:f.server.store,authenticate:r=>runtime.hasCookie(r)?runtime.authenticate(r):bearer(r),clock:()=>new Date('2026-10-12T03:00:00.000Z')});
 f.server.server.removeAllListeners('request');f.server.server.on('request',createHttpApp({store:f.server.store,scheduling,browserSessionRuntime:runtime,publicBoardEnabled:true}));
 const call=await wire(f);try{
  const login=await call('/api/v3/session/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:'a'.repeat(40),deviceId:'BROWSER-PUBLIC-SYNTHETIC'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/v3/business/state',{headers:{cookie}})).status,200);
  for(const headers of [{},{cookie},{cookie:'jso_session=invalid'}]){
   const board=await call('/api/v3/public/board',{headers});assert.equal(board.status,200);assert.equal(board.headers.get('set-cookie'),null);assert.ok(!(await board.text()).includes('principal'));
   assert.equal((await call('/api/v3/public/board/references/'+f.ids[0],{headers})).status,200);
  }
  assert.equal((await call('/api/v3/business/state')).status,401);
  assert.equal((await call('/api/v3/business/requests',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  assert.equal((await call('/api/v3/business/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await call('/api/v3/session',{headers:{cookie}}).then(r=>r.json())).authenticated,true);
 }finally{await close(f);}
});
