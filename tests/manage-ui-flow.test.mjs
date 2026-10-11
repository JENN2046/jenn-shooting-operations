import {dom,managementScript} from './support/manage-synthetic-dom.mjs';
// Executes shipped event handlers against an in-process HTTP app and a minimal
// synthetic DOM. This is not a browser/rendering or network-listener test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setup} from './support/dynamic-http-fixture.mjs';
import {tokens} from './support/business-http-fixture.mjs';
test('shipped UI handlers → authenticated HTTP → duration, weekly config preview, dynamic batch and receipts',async()=>{
 const f=await setup();try{
 const {ids,document}=dom();const calls=[];
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,crypto:{randomUUID},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async(path,options)=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});const r=await f.call(path,body,options.headers.Authorization.slice(7));return {ok:r.status<400,status:r.status,json:async()=>r.body};}});
 vm.runInContext(managementScript(),context);
 async function fire(element,event){await element.fire(event);for(let i=0;i<100;i++){await new Promise(resolve=>setImmediate(resolve));if(ids.get('message').textContent!=='正在处理…')return;}throw new Error('UI did not settle');}
 ids.get('token').value=tokens.admin;await fire(ids.get('login'),'submit');assert.equal(ids.get('workspace').hidden,false,ids.get('message').textContent);
 const form=ids.get('requests').children[0];form.children[1].children[0].value='75';await fire(form,'submit');assert.match(ids.get('message').textContent,/时长已保存/);assert.equal(JSON.parse(f.store.db.prepare("SELECT duration_estimate_json FROM scheduling_request_requirements WHERE request_id='REQ-A'").get().duration_estimate_json).durationMs,4500000);
 ids.get('saturday').value='weekly';ids.get('buffer-minutes').value='25';await fire(ids.get('calendar-form'),'submit');assert.match(ids.get('message').textContent,/预览完成/);
 let cfg=calls.findLast(c=>c.path.endsWith('/config/preview')).body.configJson;assert.equal(cfg.resourceCalendars[0].rules.at(-1).alternatingSaturday,null);assert.equal(cfg.resourceCalendars[0].rules.at(-1).weeklyWindows.length,12);assert.deepEqual(cfg.durationFallbackRules,[]);assert.equal(cfg.bufferRules[0].bufferAfterMinutes,25);
 ids.get('saturday').value='alternating';ids.get('anchor').value='2026-10-10';await fire(ids.get('calendar-form'),'submit');cfg=calls.findLast(c=>c.path.endsWith('/config/preview')).body.configJson;assert.equal(cfg.resourceCalendars[0].rules.at(-1).alternatingSaturday.workingAnchorDate,'2026-10-10');
 ids.get('dynamic-item').value='A';await fire(ids.get('dynamic-item'),'change');ids.get('dynamic-mode').value='plan';ids.get('dynamic-start').value='09:00';ids.get('dynamic-end').value='10:30';ids.get('dynamic-buffer').value='20';await fire(ids.get('dynamic-form'),'submit');assert.equal(ids.get('dynamic-confirm').dataset.locked,'',ids.get('message').textContent);assert.ok(ids.get('dynamic-changes').children.length>=2);
 await fire(ids.get('dynamic-confirm'),'click');assert.match(ids.get('message').textContent,/整批调整已保存/);assert.equal(f.store.db.prepare("SELECT planned_start FROM schedule_items WHERE id='B'").get().planned_start,'2026-10-12T05:30:00.000Z');
 assert.equal(calls.filter(c=>c.path.endsWith('/day-adjustment/apply')).length,1);
 }finally{f.close();}
});
