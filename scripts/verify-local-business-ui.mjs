// Synthetic loopback browser acceptance only. No production paths, external requests or real credentials.
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createOperationsServer } from '../src/server.mjs';
import { createKioskServiceBindingV1 } from '../src/kiosk-service-context-v1.mjs';
import { createBusinessRuntimeAuthV1 } from '../src/business-runtime-auth-v1.mjs';
import { normalizeSchedulingConfig } from '../src/scheduling-admin-contract-v2.mjs';
const {chromium}=await import(process.env.JSO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.JSO_PLAYWRIGHT_MODULE).href:'playwright');
const evidence=mkdtempSync('/tmp/jso-business-ui-');
const token=randomBytes(32).toString('hex'),resource='JSO-BIZ-RESOURCE-001',at='2026-10-01T00:00:00.000Z';
const runtime=createOperationsServer({databasePath:join(evidence,'synthetic.sqlite'),uploadRoot:join(evidence,'uploads'),orphanCleanupMode:'disabled',cleanupIntervalMs:0,kioskServiceBinding:createKioskServiceBindingV1({context:'WO03_ISOLATED_ACCEPTANCE'}),clock:()=>new Date(at),schedulingAuthenticate:createBusinessRuntimeAuthV1({identities:[{token,subjectId:'Jenn-local-test',role:'administrator',resourceIds:[resource]}]})});
const db=runtime.store.db;
db.prepare('INSERT INTO revision_counters VALUES(1,0,0,?)').run(at);
await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${runtime.server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.JSO_CHROME_EXECUTABLE||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({locale:'zh-CN',viewport:{width:1280,height:1000}});
await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
const errors=[],checks=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
async function login(page){await page.locator('#token').fill(token);await page.locator('#login-button').click();await page.locator('#workspace').waitFor({state:'visible'});}
async function saved(page){await page.locator('#calendar-form').evaluate(f=>f.requestSubmit());await page.locator('#preview-summary').filter({hasText:'未发现'}).waitFor();await page.locator('#publish').click();await page.locator('#message').filter({hasText:'新工作规则已生效'}).waitFor();}
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;}
try{
 const page=await context.newPage();await page.goto(base+'/manage');await login(page);await page.locator('#register').click();await page.locator('#message').filter({hasText:'已登记'}).waitFor();await saved(page);checks.push('Resource registration and v2 calendar publish/activate from page');
 await page.locator('#add-exception').click();const exception=page.locator('.exception').last();await exception.locator('input[type=date]').fill('2026-10-17');await exception.locator('select').selectOption('custom');const times=exception.locator('input[type=time]');await times.nth(0).fill('09:00');await times.nth(1).fill('12:00');await saved(page);checks.push('Editable temporary working Saturday exception');
 db.prepare(`INSERT INTO requests_v2(id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,deliverable_count,aspect_ratio,requested_by,desired_date,note,sample_status,lighting_preset,reflectivity,priority)
 VALUES('REQ',0,'SKU','合成产品','合成客户','Photo','细节','canonical','open','domain_command','submission',?,1,1,'平面','细节',1,'1:1','Jenn','2026-10-02','','arrivedVerified','SOFT','low','p1')`).run(at);
 const active=db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version;
 db.prepare(`INSERT INTO schedule_items(id,source_ordinal,resource_id,resource_resolution_status,resource_mapping_version,planned_start,planned_end,buffer_after_minutes,buffer_source,schedule_status,schedule_status_provenance,lock_status,lock_status_provenance,note,allocation_mode,source,business_created_at,business_updated_at,imported_at)
 VALUES('ITEM',0,?,'resolved','resource-catalog-v1','2026-10-02T01:00:00.000Z','2026-10-02T02:00:00.000Z',10,?,'confirmed','domain_command','unlocked','domain_command','','single','human',?,?,?)`).run(resource,active,at,at,at);
 db.prepare('INSERT INTO schedule_item_tasks VALUES(?,?,0,?,?)').run('ITEM','REQ',at,at);
 await page.locator('#refresh').click();await page.locator('.session button').click();await page.locator('#shoot-date').fill('2026-10-10');await page.locator('#shoot-start').fill('13:30');await page.locator('#shoot-end').fill('14:30');await page.locator('#reschedule-form button[type=submit]').click();await page.locator('#message').filter({hasText:'改期已保存'}).waitFor();assert.equal(db.prepare("SELECT planned_start FROM schedule_items WHERE id='ITEM'").get().planned_start,'2026-10-10T05:30:00.000Z');checks.push('Real form reschedules one synthetic session and preserves ID');
 const raceState=await api('/api/v2/business/state');
 const raceBase={scheduleItemId:'ITEM',resourceId:resource,expectedScheduleRevision:raceState.revisions.scheduleRevision,expectedProjectionRevision:raceState.revisions.projectionRevision,configDigest:raceState.configs.find(c=>c.active).configDigest};
 const race=await Promise.all([['RACE-A','01:00','02:00'],['RACE-B','05:30','06:30']].map(async([operationId,start,end])=>{
   const r=await fetch(base+'/api/v2/business/schedule-items/ITEM/reschedule',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...raceBase,operationId,plannedStart:`2026-10-12T${start}:00.000Z`,plannedEnd:`2026-10-12T${end}:00.000Z`})});return r.status;
 }));assert.deepEqual(race.sort(),[200,409]);checks.push('Concurrent reschedule submissions with same revision allow one commit');
 const op=db.prepare("SELECT operation_id FROM scheduling_admin_operations WHERE kind='registerResource'").get().operation_id;
 await page.evaluate(id=>sessionStorage.setItem('jso.pending.operation',JSON.stringify({id,path:'/api/v2/business/resources',body:{operationId:id}})),op);
 await page.reload();assert.equal(await page.locator('#login-button').isEnabled(),true);await login(page);assert.equal(await page.locator('#preview-button').isDisabled(),true);await page.locator('#reconcile').click();await page.locator('#unknown').waitFor({state:'hidden'});checks.push('Unknown operation reload permits re-auth and exact receipt reconciliation');
 const other=await context.newPage();await other.goto(base+'/manage');await login(other);
 await page.locator('#effective').fill('2026-10-20');await saved(page);
 await other.locator('#effective').fill('2026-11-01');await other.locator('#calendar-form').evaluate(f=>f.requestSubmit());await other.locator('#message').filter({hasText:'已被其他操作更新'}).waitFor();assert.equal(await other.locator('#preview').isVisible(),false);checks.push('Two-page stale calendar editor fails instead of rebasing');
 const state=await api('/api/v2/business/state');const config=structuredClone(state.configs.find(c=>c.active).configJson);config.durationFallbackRules.find(r=>r.shootingSubtype==='细节').durationMs=80*60000;const n=normalizeSchedulingConfig(config);
 await api('/api/v2/business/config/publish',{operationId:'SAVED-DRAFT-PUBLISH',configVersion:'SAVED-DRAFT',algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v2',estimatePolicyVersion:'estimate-policy-v1',configJson:n.config,configDigest:n.configDigest});
 await page.locator('#refresh').click();await page.locator('#saved-version').selectOption('SAVED-DRAFT');assert.equal(await page.locator('#activate').isVisible(),false);await page.locator('#inspect-saved').click();await page.locator('#saved-details').filter({hasText:'80分钟'}).waitFor();await page.locator('#activate').click();await page.locator('#message').filter({hasText:'新工作规则已生效'}).waitFor();assert.equal(db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version,'SAVED-DRAFT');checks.push('Saved inactive candidate shows exact settings before explicit activation');
 db.prepare('INSERT INTO operations(operation_id,kind,response_json,created_at) VALUES(?,?,?,?)').run('REQ2-SUBMIT','submitRequest','{}',at);
 const req={...db.prepare("SELECT * FROM requests_v2 WHERE id='REQ'").get(),id:'REQ2',name:'第二个合成产品',source_ordinal:1,source_operation_id:'REQ2-SUBMIT',desired_date:'2026-10-24'};
 db.prepare(`INSERT INTO requests_v2(${Object.keys(req).map(k=>'"'+k+'"').join(',')}) VALUES(${Object.keys(req).map(()=>'?').join(',')})`).run(...Object.values(req));
 db.prepare('INSERT INTO scheduling_request_requirements VALUES(?,?,?,?,?)').run('REQ2','["FLAT"]',null,at,'REQ2-REQUIREMENTS');
 await page.locator('#plan-from').fill('2026-10-24');await page.locator('#plan-through').fill('2026-10-24');await page.locator('#proposal-form button').click();await page.locator('#proposal button').filter({hasText:'采用全部场次'}).waitFor();await page.locator('#proposal button').filter({hasText:'采用全部场次'}).click();await page.locator('#message').filter({hasText:'提案处理完成'}).waitFor();assert.equal(db.prepare('SELECT count(*) n FROM schedule_items').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM notification_outbox').get().n,1);checks.push('V2 recurring-calendar nonempty proposal generation and canonical adoption; isolated outbox only');
 await page.screenshot({path:join(evidence,'management-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(evidence,'management-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);checks.push('390px responsive layout has no horizontal overflow');
 await page.locator('#refresh').focus();await page.keyboard.press('Enter');await page.locator('#refresh').waitFor({state:'visible'});checks.push('Keyboard activation of refresh');
 assert.deepEqual(errors,[]);writeFileSync(join(evidence,'receipt.json'),JSON.stringify({status:'LOCAL_BROWSER_ACCEPTANCE_PASS',checks,browserErrors:errors,productionCalls:0,real115Calls:0,syntheticData:true},null,2));console.log(JSON.stringify({status:'PASS',evidence,checks:checks.length}));
}catch(error){console.error(JSON.stringify({status:'FAILED',checks,browserErrors:errors,evidence,message:error.message}));throw error;}finally{await browser.close();await new Promise(resolve=>runtime.server.close(resolve));}
