// Manual local browser acceptance. Synthetic fixture only, never a production target.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hostname} from 'node:os';
import {execFileSync} from 'node:child_process';
import {launch,scheduleOrders} from './first-launch-v3-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=resolve(process.env.KIOSK_BROWSER_EVIDENCE||'../kiosk-online-evidence/browser');mkdirSync(out,{recursive:true});
const token='KIOSK-BROWSER-SYNTHETIC-ONLY-NOT-PRODUCTION',admin='a'.repeat(40);
const identities=[{token,subjectId:'OPERATOR-BROWSER-001',deviceId:'DEVICE-BROWSER-001',resourceId:'JSO-BIZ-RESOURCE-001'},{token:'OTHER-KIOSK-BROWSER-SYNTHETIC-ONLY-001',subjectId:'OTHER-OPERATOR-001',deviceId:'OTHER-DEVICE-001',resourceId:'OTHER-RESOURCE-001'}];
const f=await launch({kioskIdentities:identities});let running,browser,at='2026-10-12T01:00:00.000Z';
const checks=[],errors=[];let posts=0;
try{
 await scheduleOrders(f,5);f.server.store.close();
 const api=await import(pathToFileURL(join(f.app,'src/server.mjs')));
 const {createKioskOnlineOptionsFromEnv}=await import(pathToFileURL(join(f.app,'src/kiosk-online-runtime-v3.mjs')));
 const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')));
 running=api.createOperationsServer({databasePath:f.filename,uploadRoot:f.uploads,orphanCleanupMode:'disabled',cleanupIntervalMs:0,clock:()=>new Date(at),...api.createKioskRuntimeOptionsFromEnv(process.env),...createBusinessRuntimeOptionsFromEnv(process.env),...createKioskOnlineOptionsFromEnv(process.env)});
 await new Promise(r=>running.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${running.server.address().port}`;
 const adminCall=async(path,body)=>{const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;};
 const count=()=>running.store.db.prepare('SELECT count(*) n FROM production_events').get().n;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',chromiumSandbox:true});
 const context=await browser.newContext({locale:'zh-CN',timezoneId:'Asia/Shanghai',viewport:{width:1365,height:1100}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url()===base+'/api/v3/kiosk/events')posts++;});
 const login=async()=>{await page.locator('#online-token').fill(token);await page.locator('#online-login button').click();await page.locator('#online-identity').filter({hasText:'DEVICE-BROWSER-001'}).waitFor();await page.locator('#server-status').filter({hasText:'已同步'}).waitFor();};
 const message=text=>page.locator('#live-message').filter({hasText:text}).waitFor();
 await page.goto(base+'/kiosk');const legacy=JSON.stringify({schemaVersion:2,pending:[{synthetic:'preserved'}]});await page.evaluate(v=>localStorage.setItem('jenn.kiosk.offline-queue.v2',v),legacy);await page.reload();await login();
 assert.equal(await page.locator('#online-day li').count(),5);assert.equal(await page.locator('#legacy-warning').isVisible(),true);
 for(const name of ['产品3D主图','细节图','功能图','模特','场景'])assert.ok((await page.locator('#online-day').textContent()).includes(name));
 await page.waitForFunction(()=>!document.getElementById('action-start').disabled);checks.push('five categories and current/day list; scoped device login; old queue preserved and warned');
 await page.screenshot({path:join(out,'01-five-categories.png'),fullPage:true});
 // Deliver once, deliberately lose response. This is transport recovery, not an exploit.
 await page.route('**/api/v3/kiosk/events',async route=>{await route.fetch();await route.abort('failed');await page.unroute('**/api/v3/kiosk/events');},{times:1});
 await page.locator('#action-start').evaluate(b=>{b.click();b.click();});await message('结果尚未确认');assert.equal(count(),1);assert.equal(posts,1);
 await page.screenshot({path:join(out,'02-response-lost.png'),fullPage:true});
 await page.reload();await login();assert.equal(await page.locator('#pending-count').textContent(),'1');assert.equal(count(),1);await page.locator('#online-reconcile').click();await message('上次操作已保存');assert.equal(await page.locator('#pending-count').textContent(),'0');checks.push('double-click single event; delivered/lost response; reload and re-login; receipt reconciliation without replay');
 at='2026-10-12T01:30:00.000Z';await page.locator('#action-complete').click();await page.locator('#complete-confirm').evaluate(b=>{b.click();b.click();});await message('操作已确认');assert.equal(count(),2);
 assert.ok(running.store.db.prepare('SELECT actor_id,device_id FROM production_events').all().every(e=>e.actor_id===identities[0].subjectId&&e.device_id===identities[0].deviceId));checks.push('complete once; correct operator/device provenance');
 await page.locator('#online-day button').nth(1).click();await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);assert.equal(await page.locator('#action-start').isDisabled(),true);const beforeOffline=posts;await page.locator('#action-start').evaluate(b=>b.click());assert.equal(posts,beforeOffline);
 await context.setOffline(false);await page.locator('#server-status').filter({hasText:'已同步'}).waitFor();await page.waitForFunction(()=>!document.getElementById('action-start').disabled);checks.push('offline disables writes; reconnect refreshes without submitting');
 // No delivery: explicit lookup then identical-ID retry.
 await page.route('**/api/v3/kiosk/events',route=>route.abort('failed'),{times:1});await page.locator('#action-start').click();await message('结果尚未确认');assert.equal(count(),2);
 await page.locator('#online-reconcile').click();await message('暂未找到回执');await page.locator('#online-retry').click();await message('操作已确认');assert.equal(count(),3);checks.push('undelivered request: lookup404 and explicit original-ID retry');
 at='2026-10-12T02:00:00.000Z';await page.locator('#action-complete').click();await page.locator('#complete-confirm').click();await message('操作已确认');assert.equal(count(),4);
 await page.locator('#online-day button').nth(2).click();
 // A legitimate management reschedule occurs after the screen was read.
 await page.route('**/api/v3/kiosk/events',async route=>{
  const state=await adminCall('/api/v3/business/state'),item=state.sessions[2],config=state.configs.find(c=>c.active);
  await adminCall('/api/v3/business/schedule-items/'+item.id+'/reschedule',{operationId:'BROWSER-CONCURRENT-MOVE',scheduleItemId:item.id,resourceId:item.resourceId,plannedStart:item.plannedStart,plannedEnd:new Date(Date.parse(item.plannedEnd)-60000).toISOString(),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,configDigest:config.configDigest});
  await route.continue();
 },{times:1});
 await page.locator('#action-start').click();await message('排期已变化');assert.equal(count(),4);checks.push('stale schedule version refused after real management mutation');
 // HTTP authority probes from actual browser, with synthetic identities only.
 const denied=await page.evaluate(async token=>{
  const h={Authorization:'Bearer '+token};return Promise.all(['/api/v3/business/state','/api/v3/kiosk/day?resourceId=OTHER','/api/v2/updates'].map(async p=>(await fetch(p,{headers:h})).status));
 },token);assert.deepEqual(denied,[401,400,409]);
 const state=await adminCall('/api/v3/business/state');
 const forbidden=await page.evaluate(async ({command,otherToken,operatorToken})=>{
  const call=async(path,t)=> (await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(command)})).status;
  return [await call('/api/v3/kiosk/events',otherToken),await call('/api/v3/business/run-events',operatorToken)];
 },{command:{eventId:'CROSS-RESOURCE-BROWSER',runId:'CROSS-RESOURCE-RUN',scheduleItemId:state.sessions[2].id,eventType:'start',expectedRunRevision:0,expectedScheduleRevision:state.revisions.scheduleRevision},otherToken:identities[1].token,operatorToken:token});
 assert.deepEqual(forbidden,[403,401]);assert.equal(count(),4);checks.push('operator denied management; resource override rejected; old protocol gate retained');
 await page.locator('#online-logout').click();await login();assert.equal(await page.locator('#online-day li').count(),5);assert.equal(await page.evaluate(()=>localStorage.getItem('jenn.kiosk.offline-queue.v2')),legacy);
 // Management + upload + board regression on the same candidate source and DB.
 const manage=await context.newPage();manage.on('pageerror',e=>errors.push(e.message));await manage.goto(base+'/manage');await manage.locator('#token').fill(admin);await manage.locator('#login-button').click();await manage.locator('#workspace').waitFor();
 await manage.locator('#order-category').selectOption('模特');for(const [k,v] of Object.entries({sku:'KIOSK-REGRESSION',name:'现场版参考图回归',requested:'Synthetic',date:'2026-10-12',count:'1',light:'SOFT',brief:'Synthetic browser regression'}))await manage.locator('#order-'+k).fill(v);
 await manage.locator('#order-sample').selectOption('arrivedVerified');await manage.locator('#order-priority').selectOption('p1');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=','base64');
 await manage.locator('#reference-files').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:png});await manage.getByRole('button',{name:'保存订单',exact:true}).click();await manage.locator('#message').filter({hasText:'订单已保存'}).waitFor();
 await manage.goto(base+'/');await manage.locator('#board-token').fill(admin);await manage.locator('#board-login button').click();await manage.locator('#board').waitFor();await manage.locator('.pending-summary').first().click();await manage.getByRole('button',{name:'查看参考图：reference.png',exact:true}).click();await manage.locator('#pending img').waitFor();assert.ok(await manage.locator('#pending img').evaluate(i=>i.complete&&i.naturalWidth>0));
 const image=await manage.locator('#pending img').getAttribute('src');await manage.waitForResponse(r=>r.url()===base+'/api/v3/business/board'&&r.status()===200,{timeout:40000});assert.equal(await manage.locator('#pending img').getAttribute('src'),image);checks.push('management order creation/upload and authenticated board image read; real30s poll retains image');
 await manage.screenshot({path:join(out,'03-board-reference-regression.png'),fullPage:true});await page.screenshot({path:join(out,'04-online-final.png'),fullPage:true});assert.deepEqual(errors,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({status:'PASS',at:new Date().toISOString(),host:hostname(),platform:process.platform,browser:browser.version(),sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),gitStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),checks,errors,events:count(),scope:'Jenn local Ubuntu; isolated synthetic Schema12 fixture; real candidate source via existing coreFixture with fixture-only custody path/uid substitutions; no fixed image, production or real credentials. Business clock injected; system clock unchanged.'},null,2));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error;}
finally{await browser?.close();if(running){await new Promise(r=>running.server.close(r));if(running.store.db.isOpen)running.store.close();}f.close();}
