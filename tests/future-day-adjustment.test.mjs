import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './support/dynamic-http-fixture.mjs';
import {tokens,resourceId} from './support/business-http-fixture.mjs';
const next=t=>`2026-10-13T${t}:00.000Z`;
const input=(overrides={})=>({scheduleItemId:'A',resourceId,mode:'plan',plannedStart:next('01:00'),endAt:next('02:30'),bufferAfterMinutes:20,...overrides});
const preview=(f,i)=>f.call('/api/v2/business/day-adjustment/preview',i);
const apply=(f,i,p,id='FUTURE-APPLY')=>f.call('/api/v2/business/day-adjustment/apply',{operationId:id,input:i,previewDigest:p.body.previewDigest});
const snapshot=f=>JSON.stringify({items:f.store.db.prepare('SELECT * FROM schedule_items ORDER BY id').all(),runs:f.store.db.prepare('SELECT * FROM production_runs').all(),rev:f.store.db.prepare('SELECT * FROM revision_counters').all(),operations:f.store.db.prepare('SELECT * FROM operations ORDER BY operation_id').all()});
async function futureSetup(configure){const f=await setup();
 if(configure){const state=(await f.state()).body,config=structuredClone(state.configs.find(c=>c.active).configJson);configure(config);await f.publish(config,'FUTURE-CALENDAR');const rev=(await f.state()).body.revisions;const activated=await f.call('/api/v2/business/config/activate',{operationId:'FUTURE-ACTIVATE',configVersion:'FUTURE-CALENDAR',expectedProjectionRevision:rev.projectionRevision});assert.equal(activated.status,200,JSON.stringify(activated));}
 f.store.db.exec("UPDATE schedule_items SET planned_start=strftime('%Y-%m-%dT%H:%M:%fZ',planned_start,'+1 day'),planned_end=strftime('%Y-%m-%dT%H:%M:%fZ',planned_end,'+1 day')");return f;}
test('future plan preview uses target date, shifts only its successors, applies once and recovers exact receipt',async()=>{const f=await futureSetup();try{
 f.store.db.prepare("UPDATE schedule_items SET planned_start=?,planned_end=? WHERE id='C'").run('2026-10-14T05:30:00.000Z','2026-10-14T06:30:00.000Z');
 const before=snapshot(f),i=input(),p=await preview(f,i);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.body.preview.canApply,true);assert.equal(p.body.preview.today,'2026-10-12');assert.equal(p.body.preview.adjustmentDate,'2026-10-13');assert.equal(snapshot(f),before);
 assert.deepEqual(p.body.preview.changes.map(c=>c.after.scheduleItemId),['A','B']);assert.equal(p.body.preview.changes[1].after.plannedStart,next('05:30'));
 const saved=await apply(f,i,p);assert.equal(saved.status,200,JSON.stringify(saved));const after=snapshot(f);assert.equal((await apply(f,i,p)).body.exactReplay,true);assert.equal(snapshot(f),after);
 const receipt=await f.call('/api/v2/business/operations/FUTURE-APPLY');assert.equal(receipt.body.receipt.preview.adjustmentDate,'2026-10-13');assert.equal(receipt.body.receipt.operationId,'FUTURE-APPLY');
 assert.equal(f.store.db.prepare("SELECT planned_start FROM schedule_items WHERE id='C'").get().planned_start,'2026-10-14T05:30:00.000Z');
}finally{f.close();}});
test('future target calendar closure and reduced windows prevent all writes',async()=>{
 for(const windows of [[],[{start:'09:00',end:'09:30'}]] ){
  const f=await futureSetup(c=>c.resourceCalendars[0].dateOverrides.push({date:'2026-10-13',status:windows.length?'custom':'closed',windows}));try{
   const before=snapshot(f),i=input(),p=await preview(f,i);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.body.preview.canApply,false);assert.equal((await apply(f,i,p)).body.code,'DYNAMIC_UNRESOLVED');assert.equal(snapshot(f),before);
  }finally{f.close();}
 }
});
test('future plans cannot cross midnight, move to another date, use the past or forecast future execution',async()=>{const f=await futureSetup();try{
 const before=snapshot(f);
 for(const i of [input({endAt:'2026-10-14T01:00:00.000Z'}),input({plannedStart:'2026-10-11T01:00:00.000Z',endAt:'2026-10-11T02:00:00.000Z'})])assert.equal((await preview(f,i)).body.code,'DYNAMIC_PLAN_SAME_DATE_ONLY');
 assert.equal((await preview(f,input({plannedStart:'2026-10-14T01:00:00.000Z',endAt:'2026-10-14T02:00:00.000Z'}))).body.code,'DYNAMIC_ANCHOR_NOT_FOUND');
 assert.equal((await preview(f,input({mode:'forecast',plannedStart:null}))).body.code,'DYNAMIC_TODAY_ONLY');assert.equal(snapshot(f),before);
}finally{f.close();}});
test('future locked anchors or execution history remain immutable',async()=>{for(const kind of ['lock','run']){const f=await futureSetup();try{
 if(kind==='lock')f.store.db.exec("UPDATE schedule_items SET lock_status='locked' WHERE id='A'");
 else f.store.db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,created_at,updated_at) VALUES('RUN','A','task','REQ-A','scheduled',0,?,?)").run(next('00:00'),next('00:00'));
 const before=snapshot(f);assert.equal((await preview(f,input())).body.code,'DYNAMIC_ANCHOR_IMMUTABLE');assert.equal(snapshot(f),before);
}finally{f.close();}}});
test('future scope denial, conflicting successor and stale preview never write',async()=>{const f=await futureSetup();try{
 const i=input(),before=snapshot(f);assert.equal((await f.call('/api/v2/business/day-adjustment/preview',i,tokens.other)).status,403);assert.equal((await f.call('/api/v2/business/day-adjustment/preview',i,tokens.scheduler)).status,403);assert.equal(snapshot(f),before);
 const p=await preview(f,i);f.store.db.exec("UPDATE schedule_items SET lock_status='locked' WHERE id='B'");const locked=snapshot(f);assert.equal((await apply(f,i,p)).body.code,'DYNAMIC_PREVIEW_CHANGED');assert.equal(snapshot(f),locked);
 const conflict=await preview(f,i);assert.equal(conflict.body.preview.canApply,false);assert.equal((await apply(f,i,conflict)).body.code,'DYNAMIC_UNRESOLVED');assert.equal(snapshot(f),locked);
}finally{f.close();}});
test('crossing business midnight invalidates a future preview and elapsed starts cannot be applied',async()=>{const f=await futureSetup();try{
 const i=input(),p=await preview(f,i);f.setTime('2026-10-12T16:00:00.000Z');const before=snapshot(f);assert.equal((await apply(f,i,p)).body.code,'DYNAMIC_PREVIEW_CHANGED');assert.equal(snapshot(f),before);
 const current=await preview(f,i);assert.equal(current.body.preview.canApply,true);f.setTime(next('01:01'));assert.equal((await apply(f,i,current)).body.code,'DYNAMIC_PREVIEW_CHANGED');assert.equal(snapshot(f),before);
}finally{f.close();}});
