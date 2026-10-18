// Real local Chromium + HTTP + temporary Schema12 SQLite. Synthetic identities/data only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {launch,scheduleOrders} from './first-launch-v3-fixture.mjs';
import {createHttpApp} from '../../src/http-app.mjs';
import {createKioskOnlineV3} from '../../src/kiosk-online-v3.mjs';
import {createKioskOnlineRuntimeV3} from '../../src/kiosk-online-runtime-v3.mjs';
import {token,binding,identities} from './kiosk-offline-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=resolve(process.env.KIOSK_OFFLINE_EVIDENCE||'../evidence/kiosk-offline/browser');mkdirSync(out,{recursive:true});
const checks=[],errors=[];let server,browser,context,at='2026-10-12T03:00:00.000Z',revoked=new Set(),posts=0;
const f=await launch({kioskIdentities:identities});
try{
 await scheduleOrders(f,3);
 const runtime=createKioskOnlineRuntimeV3({identities}),online=createKioskOnlineV3({store:f.server.store,runtime,clock:()=>new Date(at)});
 const app=createHttpApp({store:f.server.store,kioskOnline:{...online,authenticate:r=>{const who=online.authenticate(r);return who&&!revoked.has(who.deviceId)?who:null;}}});
 server=createServer(app);await new Promise((r,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',r);});
 const base='http://127.0.0.1:'+server.address().port,count=()=>f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n;
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',chromiumSandbox:true});
 context=await browser.newContext({locale:'zh-CN',timezoneId:'Asia/Shanghai',viewport:{width:1100,height:1000}});
 context.setDefaultTimeout(15000);
 await context.addInitScript(()=>{
  const NativeDate=Date;window.__kioskTestTime='2026-10-12T01:00:00.000Z';
  class TestDate extends NativeDate{constructor(...args){super(...(args.length?args:[window.__kioskTestTime]));}static now(){return NativeDate.parse(window.__kioskTestTime);}}
  window.Date=TestDate;
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 context.on('request',r=>{if(r.method()==='POST'&&r.url()===base+'/api/v3/kiosk/events')posts++;});
 const login=async(auth=token,target=page)=>{
  await target.locator('#online-token').fill(auth);await target.locator('#online-login button').click();
  await target.locator('#online-identity').filter({hasText:'DEVICE'}).waitFor();
  await target.locator('#server-status').filter({hasText:'已同步'}).waitFor();
 };
 const pending=async n=>{await page.waitForFunction(n=>document.getElementById('pending-count').textContent===String(n),n);};
 const snap=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('jenn.kiosk.queue.v3:')&&k.includes('.item.')).map(k=>JSON.parse(localStorage.getItem(k))).sort((a,b)=>a.localSequence-b.localSequence));
 const complete=async()=>{await page.locator('#action-complete').click();await page.locator('#complete-confirm').click();};
 await page.goto(base+'/kiosk');await page.evaluate(()=>localStorage.setItem('jenn.kiosk.offline-queue.v2','PRESERVED-SYNTHETIC-V2'));await login();
 await page.waitForFunction(()=>!document.getElementById('action-start').disabled);
 const idle=await context.newPage();idle.on('pageerror',e=>errors.push(e.message));await idle.goto(base+'/kiosk');await login(token,idle);assert.equal(await idle.locator('#action-start').isDisabled(),true);
 checks.push('two authenticated real tabs remain single-controller; legacy V2 storage preserved and warned');
 await page.locator('#online-day button').nth(0).click();
 await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine&&!document.getElementById('action-start').disabled);
 assert.equal(await page.locator('#online-day li').count(),3);
 await page.locator('#action-start').click();await pending(1);await page.waitForFunction(()=>!document.getElementById('action-complete').disabled);
 await page.evaluate(()=>window.__kioskTestTime='2026-10-12T01:30:00.000Z');await complete();await pending(2);
 assert.equal(count(),0);assert.equal(posts,0);const original=await snap();assert.equal(original.length,2);
 assert.equal(original[0].runId,original[1].runId);assert.equal(original[0].expectedRunRevision,0);assert.equal(original[1].expectedRunRevision,1);
 assert.equal(original[0].expectedScheduleRevision,original[1].expectedScheduleRevision);assert.ok(original.every(x=>x.recordingMode==='device-declared'));
 assert.match(await page.locator('#pending-state').textContent(),/未获服务端确认/);
 await page.screenshot({path:join(out,'01-offline-start-complete.png'),fullPage:true});checks.push('real offline context retains loaded sessions; start then complete persist before send, same runId/revisions, zero HTTP writes or server facts');
 // Drop only the response after actual delivery. Recovery must GET the original receipt.
 await page.route('**/api/v3/kiosk/events',async route=>{await route.fetch();await route.abort('failed');},{times:1});
 await context.setOffline(false);await page.locator('#live-message').filter({hasText:'结果尚未确认'}).waitFor();assert.equal(count(),1);await pending(2);
 await page.screenshot({path:join(out,'02-lost-response.png'),fullPage:true});
 await page.reload();await page.locator('#online-login').waitFor();assert.equal(await page.locator('#action-start').isDisabled(),true);await login();
 await pending(0);await page.locator('#live-message').filter({hasText:'现场记录已保存'}).waitFor();
 assert.equal(count(),2);assert.equal(posts,2);
 const events=f.server.store.db.prepare('SELECT event_id,run_id,occurred_at,received_at,actor_id,device_id FROM production_events ORDER BY resulting_run_revision').all();
 assert.deepEqual(events.map(e=>e.event_id),original.map(e=>e.eventId));
 assert.deepEqual(events.map(e=>e.occurred_at),original.map(e=>e.occurredAt));assert.ok(events.every(e=>e.received_at===at&&e.device_id===binding.deviceId&&e.actor_id===binding.subjectId));
 await page.screenshot({path:join(out,'03-recovered-saved.png'),fullPage:true});checks.push('delivered/lost response retained both immutable items; reload requires authentication; receipt lookup prevents another start POST, then original complete records device times and server receipt times');
 // Offline record versus a real business reschedule.
 await page.locator('#online-day button').nth(1).click();await context.setOffline(true);await page.evaluate(()=>window.__kioskTestTime='2026-10-12T02:00:00.000Z');
 await page.locator('#action-start').click();await pending(1);const conflictItem=(await snap())[0];
 const state=await f.state(),item=state.sessions[1],config=state.configs.find(c=>c.active);
 await f.ok('/api/v3/business/schedule-items/'+item.id+'/reschedule',{operationId:'OFFLINE-BROWSER-MOVE',scheduleItemId:item.id,resourceId:item.resourceId,plannedStart:item.plannedStart,plannedEnd:new Date(Date.parse(item.plannedEnd)-60000).toISOString(),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,configDigest:config.configDigest});
 await context.setOffline(false);await page.locator('#sync-status').filter({hasText:'冲突'}).waitFor();await pending(1);assert.equal(count(),2);assert.deepEqual((await snap())[0],conflictItem);
 await page.screenshot({path:join(out,'04-schedule-conflict.png'),fullPage:true});checks.push('real management reschedule changes business revision; original offline item remains byte-equivalent, conflict shown, no silent rebase or new fact');
 // Same browser storage, different operator/device must see its own queue only.
 await page.locator('#online-logout').click();await login(identities[1].token);await pending(0);await page.locator('#online-day button').nth(1).click();
 await context.setOffline(true);await page.evaluate(()=>window.__kioskTestTime='2026-10-12T02:10:00.000Z');await page.locator('#action-start').click();await pending(1);
 const all=await snap();assert.equal(all.length,2);const other=all.find(i=>i.deviceId===identities[1].deviceId);assert.ok(other);
 revoked.add(identities[1].deviceId);await context.setOffline(false);await page.locator('#online-login').waitFor();assert.equal(count(),2);
 assert.equal((await snap()).length,2);await page.screenshot({path:join(out,'05-revoked-retained.png'),fullPage:true});
 await login(token);await page.locator('#sync-status').filter({hasText:'冲突'}).waitFor();await pending(1);assert.equal((await snap()).length,2);
 assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('KIOSK-OFFLINE-SYNTHETIC-NOT-PRODUCTION-001')||v.includes('OTHER-OFFLINE-SYNTHETIC-NOT-PRODUCTION-001'))),false);
 checks.push('identity switch isolates original queue; revoked identity logs out without deleting either queue; re-login original identity sees only original conflict; no tokens persisted');
 await page.locator('#online-logout').click();revoked.clear();await login(identities[1].token);await pending(0);assert.equal(count(),3);
 // New online page actions also keep their click time; old HTTP commands remain server-timed in unit coverage.
 await page.locator('#online-day button').nth(1).click();
 await page.evaluate(()=>window.__kioskTestTime='2026-10-12T02:30:00.000Z');await page.waitForFunction(()=>!document.getElementById('action-complete').disabled);await complete();await pending(0);assert.equal(count(),4);
 const last=f.server.store.db.prepare('SELECT completed_at FROM production_runs WHERE id=?').get(other.runId);assert.equal(last.completed_at,'2026-10-12T02:30:00.000Z');
 checks.push('new online page completion preserves the device click time separately from server receipt time');
 // A failed network read can leave navigator.onLine=true: keep recording locally.
 await page.locator('#online-day button').nth(2).click();await page.route('**/api/v3/kiosk/day',route=>route.abort('failed'));
 await page.locator('#online-refresh').click();await page.locator('#server-status').filter({hasText:'连接不可用'}).waitFor();
 assert.equal(await page.evaluate(()=>navigator.onLine),true);await page.evaluate(()=>window.__kioskTestTime='2026-10-12T03:01:00.000Z');
 const weakBefore=posts;await page.locator('#action-start').click();await pending(1);assert.equal(posts,weakBefore);
 const weak=(await snap()).find(i=>i.deviceId===identities[1].deviceId);assert.equal(weak.recordingMode,'device-declared');
 await page.unroute('**/api/v3/kiosk/day');at='2026-10-12T03:05:00.000Z';
 await page.locator('#online-reconcile').click();await pending(0);assert.equal(count(),5);
 checks.push('failed HTTP read with navigator still online enables device-declared local recording; no POST until reconnect/reconcile, original event saved');
 // Persist failure must prevent a completion from being dispatched.
 const before=posts;await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('jenn.kiosk.queue.v3:'))throw Error('synthetic storage unavailable');return set.call(this,k,v);};});
 await page.waitForFunction(()=>!document.getElementById('action-complete').disabled);await complete();await page.locator('#live-message').filter({hasText:'无法持久保存'}).waitFor();
 assert.equal(posts,before);assert.equal(count(),5);await page.screenshot({path:join(out,'06-storage-failure.png'),fullPage:true});
 checks.push('reauthenticated same identity recovers its original event; storage failure blocks new send and server completion');
 assert.equal(await page.evaluate(()=>localStorage.getItem('jenn.kiosk.offline-queue.v2')),'PRESERVED-SYNTHETIC-V2');assert.deepEqual(errors,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({status:'PASS',browser:browser.version(),checks,errors,events:count(),posts,eventsAfterFirstRecovery:events,scope:'Real Chromium setOffline; real loopback HTTP and temporary Schema12 SQLite; synthetic identities/clock, no production, no VCPChat/R16, no real device, no offline cold start.'},null,2));
}catch(error){
 const pages=await Promise.all((context?.pages()??[]).map(async p=>{try{await p.screenshot({path:join(out,'failure-page-'+(context.pages().indexOf(p))+'.png'),fullPage:true});return await p.evaluate(()=>({text:document.body.innerText,startDisabled:document.getElementById('action-start')?.disabled,completeDisabled:document.getElementById('action-complete')?.disabled,items:Object.keys(localStorage).filter(k=>k.startsWith('jenn.kiosk.queue.v3:')&&k.includes('.item.')).map(k=>JSON.parse(localStorage.getItem(k)))}));}catch{return null;}}));
 writeFileSync(join(out,'failure.json'),JSON.stringify({error:error.stack,checks,errors,pages},null,2));throw error;}
finally{await context?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));f.close();}
