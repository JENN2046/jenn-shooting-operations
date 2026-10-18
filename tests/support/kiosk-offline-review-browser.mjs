import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const {launch,scheduleOrders}=await import(root+'/tests/support/first-launch-v3-fixture.mjs');
const {createHttpApp}=await import(root+'/src/http-app.mjs');
const {createKioskOnlineV3}=await import(root+'/src/kiosk-online-v3.mjs');
const {createKioskOnlineRuntimeV3}=await import(root+'/src/kiosk-online-runtime-v3.mjs');
const {token,identities}=await import(root+'/tests/support/kiosk-offline-fixture.mjs');
const {chromium}=await import('/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=process.env.KIOSK_REVIEW_EVIDENCE||root+'/../evidence/kiosk-offline/review-fixed';mkdirSync(out,{recursive:true});
const results={};let browser,server;const f=await launch({kioskIdentities:identities});
let at='2026-10-12T01:00:00.000Z',mode='new';const accesses=[];
try{
 await scheduleOrders(f,3);
 const online=createKioskOnlineV3({store:f.server.store,runtime:createKioskOnlineRuntimeV3({identities}),clock:()=>new Date(at)});
 const app=createHttpApp({store:f.server.store,kioskOnline:online});
 const old={};for(const file of ['kiosk-online-v3.js','kiosk-online-v3.html','kiosk-offline-queue-v2.js'])old[file]=execFileSync('git',['-C',root,'show','fd7da0b9873fad047836e4fd6154ed7cbcce2046:public/'+file],{encoding:'utf8'});
 server=createServer((req,res)=>{
  accesses.push({mode,url:req.url,method:req.method});const path=new URL(req.url,'http://localhost').pathname;
  const file=path.slice(1);
  if(mode==='oldOnline'&&path==='/kiosk'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(old['kiosk-online-v3.html']);return;}
  if((mode==='oldOnline'&&file==='kiosk-online-v3.js')||(mode==='oldQueue'&&file==='kiosk-offline-queue-v2.js')){
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=300'});res.end(old[file]);return;
  }
  if(path==='/warm-queue'){
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<script type="module">import {createBrowserQueueStorage} from "/kiosk-offline-queue-v2.js";window.warmed=true;</script>');return;
  }
  app(req,res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',chromiumSandbox:true});
 const context=await browser.newContext({timezoneId:'Asia/Shanghai'});context.setDefaultTimeout(10000);
 await context.addInitScript(()=>{const NativeDate=Date;window.__clock='2026-10-12T01:00:00.000Z';window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__clock]));}static now(){return NativeDate.parse(window.__clock);}};});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=async p=>{await p.locator('#online-token').fill(token);await p.locator('#online-login button').click();await p.waitForFunction(()=>!document.getElementById('action-start').disabled);};
 const queue=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('jenn.kiosk.queue.v3:')&&k.includes('.item.')).map(k=>JSON.parse(localStorage.getItem(k))).sort((a,b)=>a.localSequence-b.localSequence));
 const facts=()=>({events:f.server.store.db.prepare('SELECT event_id,run_id,event_type,occurred_at,received_at FROM production_events ORDER BY rowid').all(),runs:f.server.store.db.prepare('SELECT id,status,run_revision,started_at,completed_at FROM production_runs').all()});
 await page.goto(base+'/kiosk');await login(page);await page.locator('#online-day button').nth(0).click();
 const before=await page.evaluate(()=>({online:navigator.onLine,status:document.getElementById('server-status').textContent}));
 let aborted=0;await page.route('**/api/v3/kiosk/events',async route=>{aborted++;await context.setOffline(true);await route.abort('failed');},{times:1});
 await page.locator('#action-start').click();await page.waitForFunction(()=>!document.getElementById('action-complete').disabled);
 const afterLost={queue:await queue(),db:facts()};assert.equal(afterLost.queue[0].recordingMode,'device-declared');assert.equal(afterLost.db.events.length,0);
 await page.evaluate(()=>window.__clock='2026-10-12T01:30:00.000Z');await page.locator('#action-complete').click();await page.locator('#complete-confirm').click();
 await page.waitForFunction(()=>document.getElementById('pending-count').textContent==='2');
 const beforeRecovery=await queue();assert.equal(beforeRecovery[1].recordingMode,'device-declared');
 at='2026-10-12T03:00:00.000Z';await context.setOffline(false);
 await page.waitForFunction(()=>document.getElementById('pending-count').textContent==='0');
 const afterRecovery={queue:await queue(),db:facts(),ui:await page.evaluate(()=>Object.fromEntries(['sync-status','pending-count','pending-state','confirmed-state','live-message'].map(id=>[id,document.getElementById(id).textContent])))};
 assert.equal(afterRecovery.db.events.length,2);assert.equal(afterRecovery.queue.length,0);assert.equal(afterRecovery.db.runs[0].started_at,'2026-10-12T01:00:00.000Z');assert.equal(afterRecovery.db.runs[0].completed_at,'2026-10-12T01:30:00.000Z');assert.ok(afterRecovery.db.events.every(e=>e.received_at===at));assert.ok(beforeRecovery.every(e=>e.recordingMode==='device-declared'));assert.deepEqual(afterRecovery.db.events.map(e=>e.event_id),beforeRecovery.map(e=>e.eventId));
 await page.screenshot({path:out+'/mixed-time-recovered.png',fullPage:true});
 results.mixedTime={before,abortedBeforeHandler:aborted,afterLost,beforeRecovery,afterRecovery,errors};await context.close();
 // Native HTTP cache, no Playwright routing. Old sources come from immutable HEAD.
 const cache=await browser.newContext();cache.setDefaultTimeout(10000);const p=await cache.newPage(),cacheErrors=[];p.on('pageerror',e=>cacheErrors.push(e.message));
 mode='oldOnline';await p.goto(base+'/kiosk');await p.waitForFunction(()=>document.getElementById('legacy-warning')!==null);await p.waitForTimeout(300);
 const n1=accesses.length;mode='new';await p.goto('about:blank');await p.goto(base+'/kiosk');await p.waitForTimeout(400);
 await p.locator('#online-token').fill(token);await p.locator('#online-login button').click();await p.locator('#server-status').filter({hasText:'已同步'}).waitFor();await cache.setOffline(true);await p.waitForTimeout(300);await p.locator('#online-day button').nth(1).click();
 assert.equal(await p.locator('#action-start').isDisabled(),false);assert.ok(accesses.slice(n1).some(x=>x.url.startsWith('/kiosk-online-v3.js?v=kiosk-v3-resource-id-')));
 results.cachedOldEntry={networkAfterSwitch:accesses.slice(n1),ui:await p.evaluate(()=>({htmlText:document.getElementById('complete-description').textContent,liveMessage:document.getElementById('live-message').textContent,startDisabled:document.getElementById('action-start').disabled})),errors:cacheErrors};await cache.close();
 const cache2=await browser.newContext();cache2.setDefaultTimeout(10000);const q=await cache2.newPage(),err2=[];q.on('pageerror',e=>err2.push(e.message));
 mode='oldQueue';await q.goto(base+'/warm-queue');await q.waitForFunction(()=>window.warmed===true);const n2=accesses.length;
 mode='new';await q.goto(base+'/kiosk');await q.locator('#online-token').fill(token);await q.locator('#online-login button').click();await q.locator('#server-status').filter({hasText:'已同步'}).waitFor();await cache2.setOffline(true);await q.waitForTimeout(200);await q.locator('#online-day button').nth(0).click();
 await q.locator('#online-day button').nth(1).click();await q.waitForFunction(()=>!document.getElementById('action-start').disabled);await q.locator('#action-start').click();await q.waitForFunction(()=>document.getElementById('pending-count').textContent==='1');
 assert.ok(accesses.slice(n2).some(x=>x.url.startsWith('/kiosk-offline-queue-v2.js?v=kiosk-v3-resource-id-')));assert.equal(facts().events.length,2);
 const saved=await q.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('.item.')).map(k=>JSON.parse(localStorage.getItem(k))));assert.equal(saved[0].recordingMode,'device-declared');
 results.cachedOldQueue={networkAfterSwitch:accesses.slice(n2),ui:await q.evaluate(()=>({message:document.getElementById('live-message').textContent,status:document.getElementById('sync-status').textContent,pending:document.getElementById('pending-count').textContent})),errors:err2,db:facts()};await cache2.close();
 const legacy=await browser.newContext();legacy.setDefaultTimeout(10000);
 await legacy.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-12T02:00:00.000Z']));}static now(){return D.parse('2026-10-12T02:00:00.000Z');}};});
 const lp=await legacy.newPage();await lp.goto(base+'/kiosk');
 const legacyItem={schemaVersion:3,eventId:'LEGACY-UNKNOWN-START-001',runId:'LEGACY-UNKNOWN-RUN-001',scheduleItemId:(await f.state()).sessions[1].id,eventType:'start',expectedRunRevision:0,expectedScheduleRevision:(await f.state()).revisions.scheduleRevision,occurredAt:'2026-10-12T01:45:00.000Z',recordingMode:'server-received',subjectId:identities[0].subjectId,deviceId:identities[0].deviceId,resourceId:identities[0].resourceId,localSequence:0};
 await lp.evaluate(async item=>{const m=await import('/kiosk-offline-queue-v2.js?v=kiosk-v3-resource-id-20261018-r4');const key='jenn.kiosk.queue.v3:'+JSON.stringify([item.subjectId,item.deviceId,item.resourceId]);const storage=m.createBrowserQueueStorage({storage:localStorage,key,protocolVersion:3});const q=m.createKioskOfflineQueue({storage,transport:{refreshCurrent(){},submitEvent(){}},clock:()=>new Date()});if(!q.enqueue(item).ok)throw Error('SEED_FAILED');},legacyItem);
 const legacyBefore=accesses.length;await lp.locator('#online-token').fill(token);await lp.locator('#online-login button').click();await lp.locator('#server-status').filter({hasText:'已同步'}).waitFor();await lp.locator('#lock-status').filter({hasText:'当前页面'}).waitFor();if(!(await lp.locator('#live-message').textContent()).includes('无法自动改成设备时间'))await lp.locator('#online-reconcile').click();await lp.locator('#live-message').filter({hasText:'无法自动改成设备时间'}).waitFor();
 assert.equal(await lp.locator('#action-start').isDisabled(),true);assert.equal(await lp.locator('#action-complete').isDisabled(),true);assert.equal(facts().events.length,2);
 assert.equal(accesses.slice(legacyBefore).filter(x=>x.method==='POST'&&x.url==='/api/v3/kiosk/events').length,0);
 const untouched=await lp.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('.item.')).map(k=>JSON.parse(localStorage.getItem(k))));assert.deepEqual(untouched,[legacyItem]);
 results.legacyUnknown={retained:untouched,message:await lp.locator('#live-message').textContent(),newActionsDisabled:true,automaticEventPosts:0};
 const {schemaVersion,occurredAt,recordingMode,subjectId,deviceId,resourceId,localSequence,...originalCommand}=legacyItem;
 at='2026-10-12T01:45:00.000Z';const delivered=await fetch(base+'/api/v3/kiosk/events',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(originalCommand)});assert.equal(delivered.status,200);
 await lp.locator('#online-reconcile').click();await lp.waitForFunction(()=>document.getElementById('pending-count').textContent==='0');await lp.locator('#online-day button').nth(1).click();
 at='2026-10-12T03:00:00.000Z';await lp.waitForFunction(()=>!document.getElementById('action-complete').disabled);await lp.locator('#action-complete').click();await lp.locator('#complete-confirm').click();await lp.waitForFunction(()=>document.getElementById('pending-count').textContent==='0');
 const legacyRun=facts().runs.find(x=>x.id===legacyItem.runId);assert.equal(legacyRun.completed_at,'2026-10-12T02:00:00.000Z');assert.equal(legacyRun.started_at,'2026-10-12T01:45:00.000Z');assert.equal(facts().events.length,4);results.legacyLateReceiptAndNewOnline={run:legacyRun,events:4};await legacy.close();
 const oldPending=await browser.newContext();oldPending.setDefaultTimeout(10000);await oldPending.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-12T03:01:00.000Z']));}static now(){return D.parse('2026-10-12T03:01:00.000Z');}};});const op=await oldPending.newPage();await op.goto(base+'/kiosk');
 const oldCommand={eventId:'LEGACY-SINGLE-PENDING-001',runId:'LEGACY-SINGLE-RUN-001',scheduleItemId:(await f.state()).sessions[2].id,eventType:'start',expectedRunRevision:0,expectedScheduleRevision:legacyItem.expectedScheduleRevision};
 await op.evaluate(({identity,command})=>localStorage.setItem('jenn.kiosk.online-v3.pending:'+JSON.stringify([identity.subjectId,identity.deviceId,identity.resourceId]),JSON.stringify({subjectId:identity.subjectId,deviceId:identity.deviceId,resourceId:identity.resourceId,command})),{identity:identities[0],command:oldCommand});
 await op.locator('#online-token').fill(token);await op.locator('#online-login button').click();await op.locator('#server-status').filter({hasText:'已同步'}).waitFor();assert.equal(facts().events.length,4);
 await op.locator('#online-reconcile').click();await op.locator('#live-message').filter({hasText:'暂未找到回执'}).waitFor();assert.equal(facts().events.length,4);
 await op.locator('#online-retry').click();await op.waitForFunction(()=>document.getElementById('pending-count').textContent==='0');const single=facts().runs.find(x=>x.id===oldCommand.runId);assert.equal(single.started_at,at);assert.equal(facts().events.length,5);results.legacySinglePending={originalCommand:oldCommand,run:single,manualRetryOnly:true};
 // A real day403 from a temporarily suspended resource must retain the queue,
 // then authenticated day200 + control reacquisition must permit reconciliation.
 await op.locator('#online-day button').nth(2).click();await oldPending.setOffline(true);await op.waitForFunction(()=>!document.getElementById('action-complete').disabled);await op.locator('#action-complete').click();await op.locator('#complete-confirm').click();await op.waitForFunction(()=>document.getElementById('pending-count').textContent==='1');
 f.server.store.db.prepare("UPDATE scheduling_resources SET status='inactive' WHERE resource_id=?").run(identities[0].resourceId);
 await oldPending.setOffline(false);await op.locator('#live-message').filter({hasText:'无权操作'}).waitFor();assert.equal(facts().events.length,5);assert.equal(await op.locator('#action-complete').isDisabled(),true);
 const kept=await op.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('.item.')).map(k=>JSON.parse(localStorage.getItem(k))));assert.equal(kept.length,1);
 f.server.store.db.prepare("UPDATE scheduling_resources SET status='active' WHERE resource_id=?").run(identities[0].resourceId);
 await op.locator('#online-refresh').click();await op.locator('#server-status').filter({hasText:'已同步'}).waitFor();await op.locator('#lock-status').filter({hasText:'当前页面'}).waitFor();await op.locator('#online-reconcile').click();await op.waitForFunction(()=>document.getElementById('pending-count').textContent==='0');
 assert.equal(facts().events.length,6);assert.equal(facts().runs.find(x=>x.id===oldCommand.runId).completed_at,kept[0].occurredAt);results.resource403Recovery={withoutRelogin:true,retainedItem:kept[0],completedAt:kept[0].occurredAt,events:6};await oldPending.close();
 assert.deepEqual(errors,[]);assert.deepEqual(cacheErrors,[]);assert.deepEqual(err2,[]);results.status='PASS';results.browser=browser.version();writeFileSync(out+'/result.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}catch(e){const pages=await Promise.all((browser?.contexts()??[]).flatMap(c=>c.pages()).map(async p=>{try{return await p.evaluate(()=>document.body.innerText);}catch{return null;}}));writeFileSync(out+'/failure.json',JSON.stringify({error:e.stack,results,pages},null,2));throw e;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));f.close();}
