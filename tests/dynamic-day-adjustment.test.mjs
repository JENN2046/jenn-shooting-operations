import {spawnSync} from 'node:child_process';
import {setup} from './support/dynamic-http-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,tokens,resourceId } from './support/business-http-fixture.mjs';
const time=t=>`2026-10-12T${t}:00.000Z`;
const input=(overrides={})=>({scheduleItemId:'A',resourceId,mode:'plan',plannedStart:time('01:00'),endAt:time('02:30'),bufferAfterMinutes:20,...overrides});
const preview=(f,i)=>f.call('/api/v2/business/day-adjustment/preview',i);
const apply=(f,i,p,id='APPLY')=>f.call('/api/v2/business/day-adjustment/apply',{operationId:id,input:i,previewDigest:p.body.previewDigest});
const snapshot=f=>JSON.stringify({items:f.store.db.prepare('SELECT * FROM schedule_items ORDER BY id').all(),rev:f.store.db.prepare('SELECT * FROM revision_counters').all(),receipts:f.store.db.prepare('SELECT * FROM schedule_reschedule_operations').all()});
test('HTTP day preview, atomic apply, stable order, lunch, persisted exact replay and scoped receipts',async()=>{const f=await setup();try{
 const i=input(),before=snapshot(f),p=await preview(f,i);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.body.preview.canApply,true);assert.equal(snapshot(f),before);
 assert.equal(p.body.preview.changes.find(c=>c.after.scheduleItemId==='B').after.plannedStart,time('05:30'));
 const result=await apply(f,i,p);assert.equal(result.status,200,JSON.stringify(result));const saved=snapshot(f);assert.equal((await apply(f,i,p)).body.exactReplay,true);assert.equal(snapshot(f),saved);
 assert.equal((await f.call('/api/v2/business/operations/APPLY')).body.receipt.kind,'dynamic-day-adjustment');assert.equal((await f.call('/api/v2/business/operations/APPLY',undefined,tokens.scheduler)).status,403);
 f.closeStore();
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
 import {DatabaseSync} from 'node:sqlite';import {validateDynamicReceiptRow} from ${JSON.stringify(new URL('../src/dynamic-day-adjustment-v1.mjs',import.meta.url).href)};
 const db=new DatabaseSync(${JSON.stringify(f.filename)},{readOnly:true});const r=validateDynamicReceiptRow(db.prepare("SELECT * FROM schedule_reschedule_operations WHERE operation_id='APPLY'").get());if(r.preview.changes.length!==3)throw new Error('RECEIPT_LOST');db.close();`],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const independent=new DatabaseSync(f.filename,{readOnly:true});assert.equal(independent.prepare("SELECT planned_start FROM schedule_items WHERE id='B'").get().planned_start,time('05:30'));independent.close();
 }finally{f.close();}});
test('buffer is per anchor and does not rewrite defaults or successors buffers',async()=>{const f=await setup();try{const i=input({endAt:time('02:00'),bufferAfterMinutes:45}),p=await preview(f,i);assert.equal((await apply(f,i,p)).status,200);assert.equal(f.store.db.prepare("SELECT buffer_after_minutes FROM schedule_items WHERE id='A'").get().buffer_after_minutes,45);assert.equal(f.store.db.prepare("SELECT buffer_after_minutes FROM schedule_items WHERE id='B'").get().buffer_after_minutes,20);assert.equal((await f.state()).body.configs[0].configJson.bufferRules[0].bufferAfterMinutes,20);}finally{f.close();}});
test('lunch overflow and end-of-day unresolved cannot partially save',async()=>{const f=await setup();try{for(const endAt of [time('04:10'),time('09:35')]){const i=input({endAt}),before=snapshot(f),p=await preview(f,i);assert.equal(p.body.preview.canApply,false);assert.equal((await apply(f,i,p)).body.code,'DYNAMIC_UNRESOLVED');assert.equal(snapshot(f),before);}}finally{f.close();}});
test('ongoing forecast preserves planned and run facts while moving successors after lunch',async()=>{const f=await setup();try{
 f.setTime(time('01:30'));let i=input({mode:'forecast',plannedStart:null,endAt:time('04:10')});assert.equal((await preview(f,i)).body.code,'DYNAMIC_FORECAST_NOT_CURRENT');
 f.store.db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,started_at,created_at,updated_at) VALUES('RUN','A','task','REQ-A','shooting',1,?,?,?)").run(time('01:00'),time('01:00'),time('01:00'));
 const facts=JSON.stringify(f.store.db.prepare('SELECT * FROM production_runs').all());const p=await preview(f,i);assert.equal(p.body.preview.canApply,true,JSON.stringify(p));assert.equal(p.body.preview.forecast.actualFactsChanged,false);assert.equal(p.body.preview.changes[0].after.plannedStart,time('05:30'));const applied=await apply(f,i,p);assert.equal(applied.status,200);assert.equal(f.store.db.prepare("SELECT planned_end FROM schedule_items WHERE id='A'").get().planned_end,time('02:00'));assert.equal(JSON.stringify(f.store.db.prepare('SELECT * FROM production_runs').all()),facts);
 }finally{f.close();}});
test('state/lock/config changes and elapsed time invalidate preview',async()=>{for(const mutate of [f=>f.store.db.exec("UPDATE schedule_items SET lock_status='locked' WHERE id='B'"),f=>f.store.db.exec('UPDATE revision_counters SET projection_revision=projection_revision+1'),f=>f.setTime(time('01:01'))]){const f=await setup();try{const i=input(),p=await preview(f,i);mutate(f);const before=snapshot(f);assert.equal((await apply(f,i,p)).body.code,'DYNAMIC_PREVIEW_CHANGED');assert.equal(snapshot(f),before);}finally{f.close();}}});
test('write failure rolls entire batch back; foreign scope and scheduler refused',async()=>{const f=await setup();try{const i=input(),p=await preview(f,i),before=snapshot(f);assert.equal((await f.call('/api/v2/business/day-adjustment/preview',i,tokens.other)).status,403);assert.equal((await f.call('/api/v2/business/day-adjustment/preview',i,tokens.scheduler)).status,403);f.store.db.exec("CREATE TEMP TRIGGER synthetic_write_failure BEFORE UPDATE ON schedule_items WHEN old.id='B' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.equal((await apply(f,i,p)).status,500);assert.equal(snapshot(f),before);}finally{f.close();}});
test('known actual completion extends fixed release; scheduled/unknown does not imply release',async()=>{
 for(const status of ['completed','scheduled']){const f=await setup();try{
 f.store.db.exec("UPDATE schedule_items SET schedule_status='cancelled' WHERE id='B'");
 f.setTime(time('03:10'));f.store.db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,started_at,completed_at,created_at,updated_at) VALUES('RUN','A','task','REQ-A',?,1,?,?,?,?)").run(status,time('01:00'),status==='completed'?time('03:00'):null,time('01:00'),time('03:00'));
 const p=await preview(f,input({scheduleItemId:'C',plannedStart:time('03:15'),endAt:time('03:30'),bufferAfterMinutes:0}));assert.equal(p.body.preview.canApply,false);assert.ok(p.body.preview.unresolved.some(x=>x.scheduleItemId==='A'&&x.code===(status==='completed'?'PREDECESSOR_ORDER_CONFLICT':'OTHER_RUN_END_UNKNOWN')));
 }finally{f.close();}}
});
test('cannot move anchor before original predecessor, change order or cross date',async()=>{const f=await setup();try{const p=await preview(f,input({scheduleItemId:'C',plannedStart:time('00:30'),endAt:time('00:50'),bufferAfterMinutes:0}));assert.equal(p.body.preview.canApply,false);assert.ok(p.body.preview.unresolved.some(x=>x.code==='PREDECESSOR_ORDER_CONFLICT'));assert.equal((await preview(f,input({endAt:'2026-10-13T01:00:00.000Z'}))).body.code,'DYNAMIC_TODAY_ONLY');}finally{f.close();}});
test('same ID different body rejected and completed run state changes invalidate forecast',async()=>{const f=await setup();try{const i=input(),p=await preview(f,i);assert.equal((await apply(f,i,p)).status,200);assert.equal((await apply(f,{...i,bufferAfterMinutes:25},p)).body.code,'IDEMPOTENCY_KEY_REUSE');}finally{f.close();}
 const g=await setup();try{g.setTime(time('01:30'));g.store.db.prepare("INSERT INTO production_runs(id,schedule_item_id,scope,task_id,status,run_revision,started_at,created_at,updated_at) VALUES('RUN','A','task','REQ-A','shooting',1,?,?,?)").run(time('01:00'),time('01:00'),time('01:00'));const i=input({mode:'forecast',plannedStart:null,endAt:time('04:10')}),p=await preview(g,i);g.store.db.prepare("UPDATE production_runs SET status='completed',completed_at=?,run_revision=2 WHERE id='RUN'").run(time('01:30'));const before=snapshot(g);assert.equal((await apply(g,i,p)).body.code,'DYNAMIC_PREVIEW_CHANGED');assert.equal(snapshot(g),before);}finally{g.close();}
});
test('canonical pending request → duration HTTP → proposal → explicit acceptance, without guessed defaults',async()=>{const f=await setup();try{
 f.store.db.exec(`INSERT INTO requests_v2 SELECT 'REQ-D',100,'D','D',client,legacy_deliver_text,kind,legacy_v1_status,v1_status_mode,request_lifecycle,lifecycle_provenance,source,business_created_at,business_updated_at,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,deliverable_count,aspect_ratio,duration_seconds,audio_requirement,requested_by,desired_date,note,NULL,core_brief_summary,brief_url,hero_asset_id,sample_status,sample_shelf_id,lighting_preset,reflectivity,priority,migration_batch_id FROM requests_v2 WHERE id='REQ-A'`);
 const revision=(await f.state()).body.revisions;const command={operationId:'DURATION-D',requestId:'REQ-D',expectedScheduleRevision:revision.scheduleRevision,expectedProjectionRevision:revision.projectionRevision,durationMinutes:30};
 assert.equal((await f.call('/api/v2/business/requests/REQ-D/duration',command,tokens.scheduler)).status,403);
 assert.equal((await f.call('/api/v2/business/requests/REQ-D/duration',command)).status,200);
 assert.equal((await f.call('/api/v2/business/requests/REQ-D/duration',command)).status,200);
 const generated=await f.call('/api/v2/business/proposals',{operationId:'GENERATE-D',planningWindowStart:time('00:00'),planningWindowEnd:'2026-10-12T16:00:00.000Z',resourceScope:[resourceId]});assert.equal(generated.status,200,JSON.stringify(generated));
 const proposal=generated.body.proposal,items=JSON.parse(proposal.proposedItemsJson);assert.equal(items.length,1,proposal.diagnosticsJson);assert.equal(items[0].durationMs,1800000);
 const accepted=await f.call(`/api/v2/proposals/${proposal.proposalId}/decisions`,{decisionId:'ACCEPT-D',proposalId:proposal.proposalId,decisionType:'accept',selectedProposalItemIds:items.map(i=>i.proposalItemId),decisionNote:null,reasonCode:null});assert.equal(accepted.status,200,JSON.stringify(accepted));
 assert.equal(f.store.db.prepare("SELECT count(*) n FROM schedule_item_tasks WHERE task_id='REQ-D'").get().n,1);
 }finally{f.close();}});
