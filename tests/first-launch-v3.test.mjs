import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {launch,submission} from './support/first-launch-v3-fixture.mjs';
const types=[['静物','产品3D主图'],['静物','细节图'],['静物','功能图'],['模特','模特'],['场景','场景']];
const time=t=>`2026-10-12T${t}:00.000Z`;
test('synthetic Schema12 creation/init/acceptance → five canonical orders → first scheduling → actual events and manual forecast → independent persisted read',async()=>{
 const f=await launch();try{
 const ids=[];
 for(let i=0;i<5;i++){
  const r=(await f.state()).revisions;
  const cmd={submission:submission(i),expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision};
  const created=await f.ok('/api/v3/business/requests',cmd);ids.push(created.requestId);
  assert.equal((await f.ok('/api/v3/business/requests',cmd)).replayed,true);
  const rev=(await f.state()).revisions;
  await f.ok(`/api/v3/business/requests/${created.requestId}/duration`,{operationId:`DURATION-${i}`,requestId:created.requestId,expectedScheduleRevision:rev.scheduleRevision,expectedProjectionRevision:rev.projectionRevision,durationMinutes:30});
 }
 assert.equal((await f.call('/api/v1/snapshot')).body.code,'CLIENT_PROTOCOL_UPGRADE_REQUIRED');
 const generated=await f.ok('/api/v3/business/proposals',{operationId:'GENERATE-V3',planningWindowStart:time('00:00'),planningWindowEnd:'2026-10-12T16:00:00.000Z',resourceScope:[f.resourceId]});
 const p=generated.proposal,items=JSON.parse(p.proposedItemsJson);assert.equal(items.length,5,p.diagnosticsJson);
 await f.ok(`/api/v3/proposals/${p.proposalId}/decisions`,{decisionId:'ACCEPT-V3',proposalId:p.proposalId,decisionType:'accept',selectedProposalItemIds:items.map(i=>i.proposalItemId),decisionNote:null,reasonCode:null});
 const sessions=(await f.state()).sessions;assert.equal(sessions.length,5);
 f.setTime(sessions[0].plannedStart);
 const start={eventId:'ACTUAL-START-001',runId:'ACTUAL-RUN-001',scheduleItemId:sessions[0].id,eventType:'start',expectedRunRevision:0};
 const started=await f.ok('/api/v3/business/run-events',start);assert.equal(started.startedAt,sessions[0].plannedStart);
 f.setTime(new Date(Date.parse(sessions[0].plannedStart)+600000).toISOString());
 assert.equal((await f.ok('/api/v3/business/run-events',start)).startedAt,started.startedAt);
 const input={scheduleItemId:sessions[0].id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,endAt:time('02:00'),bufferAfterMinutes:25};
 const preview=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(preview.preview.canApply,true,JSON.stringify(preview));
 await f.ok('/api/v3/business/day-adjustment/apply',{operationId:'FORECAST-V3',input,previewDigest:preview.previewDigest});
 f.setTime(time('02:00'));await f.ok('/api/v3/business/run-events',{...start,eventId:'ACTUAL-COMPLETE-001',eventType:'complete',expectedRunRevision:1});
 for(const [i,s]of (await f.state()).sessions.slice(1).entries()){
  f.setTime(s.plannedStart);const event={eventId:`ACTUAL-START-${i+2}`,runId:`ACTUAL-RUN-${i+2}`,scheduleItemId:s.id,eventType:'start',expectedRunRevision:0};
  await f.ok('/api/v3/business/run-events',event);f.setTime(s.plannedEnd);await f.ok('/api/v3/business/run-events',{...event,eventId:`ACTUAL-COMPLETE-${i+2}`,eventType:'complete',expectedRunRevision:1});
 }
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n,10);
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,0);
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM scheduling_run_context_snapshots WHERE schema_version=2').get().n,5);
 const evidence=f.server.store.db.prepare("SELECT response_json FROM operations WHERE operation_id='notification:ACCEPT-V3'").get();assert.match(evidence.response_json,/NOT_ENQUEUED_EXTERNAL_DELIVERY_DISABLED/);
 f.server.store.close();
 const code=`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(f.filename)},{readOnly:true});const p=JSON.parse(d.prepare("SELECT payload_json FROM snapshot_projections WHERE projection_name='schedule-v3'").get().payload_json);if(p.requests.length!==5||p.requests.filter(x=>x.kind==='静物').length!==3||new Set(p.requests.map(x=>x.shootingSubtype)).size!==5)throw Error('CLASSIFICATION_LOST');if(d.prepare("SELECT count(*) n FROM production_runs WHERE status='completed'").get().n!==5)throw Error('RUN_LOST');d.close();`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 }finally{f.close();}
});
