import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
import {createJsoAgentBoundary} from '../src/jso-agent-host-v1.mjs';
import {createTrustedPrincipal} from '../src/authorization-v2.mjs';
import {confirmAgentReschedule} from '../src/agent-owner-confirmation-v1.mjs';
import {createNativeJsoTool} from '../examples/vcp-vchart/native-tool.mjs';
import {chartData,createChartCommand,refreshChartCommand} from '../examples/vcp-vchart/chart.mjs';
const token='SYNTHETIC-ASSISTANT-'.padEnd(40,'x'), at='2026-10-12T00:00:00.000Z';
const envelope=(command,payload)=>({command,payload_json:JSON.stringify(payload)});

async function scenario(t, chartPort) {
 const f=await launch();t.after(()=>f.close());await scheduleOrders(f,5);
 const identity={token,subjectId:'synthetic-assistant',mode:'planner',resourceIds:[f.resourceId]};
 const boundary=(identity)=>createJsoAgentBoundary({store:f.server.store,identities:[identity],clock:()=>new Date(at)}).application;
 const planner=boundary(identity);
 const tool=createNativeJsoTool({call:arguments_=>planner.call({authorization:'Bearer '+token,arguments:arguments_})});
 const read=async app=>(await app.call({authorization:'Bearer '+token,arguments:envelope('read_state',{resourceScope:[f.resourceId]})}));
 const before=await read(planner);assert.equal(before.ok,true);assert.equal(before.orders.length,5);
 assert.equal(new Set(before.orders.map(o=>o.shootingSubtype)).size,5);
 assert.equal(before.activeConfig.businessTimeZone,'Asia/Shanghai');
 assert.equal((await planner.call({authorization:'Bearer '+token,arguments:envelope('read_state',{resourceScope:['OTHER']})})).code,'FORBIDDEN');
 const session=before.sessions[0];
 const move={operationId:'AGENT-MOVE',scheduleItemId:session.scheduleItemId,resourceId:f.resourceId,
  plannedStart:'2026-10-13T01:00:00.000Z',plannedEnd:'2026-10-13T01:30:00.000Z',
  expectedScheduleRevision:before.revisions.scheduleRevision,expectedProjectionRevision:before.revisions.projectionRevision,configDigest:before.activeConfig.configDigest};
 const snapshots=()=>JSON.stringify(f.server.store.db.prepare('SELECT * FROM revision_counters').all());
 const unchanged=snapshots();
 f.server.store.db.exec('PRAGMA query_only=ON');
 const proposed=await tool.processToolCall(envelope('propose_reschedule',move));
 f.server.store.db.exec('PRAGMA query_only=OFF');
 assert.equal(proposed.status,'success',JSON.stringify(proposed));assert.equal(snapshots(),unchanged);
 const proposal=proposed.result;
 const confirmation={ownerSubjectId:'Jenn',assistantSubjectId:identity.subjectId,proposal,confirmedDigest:proposal.commandDigest,approvalRef:'SYNTHETIC-HUMAN-CONFIRM',notBefore:at,expiresAt:'2026-10-12T00:05:00.000Z'};
 const human=createTrustedPrincipal({subjectId:'Jenn',role:'administrator',resourceIds:[f.resourceId]}).principal;
 const assistant=createTrustedPrincipal({subjectId:identity.subjectId,role:'viewer',resourceIds:[f.resourceId]}).principal;
 assert.equal(confirmAgentReschedule({...confirmation,principal:assistant}).code,'OWNER_CONFIRMATION_REQUIRED');
 assert.equal(confirmAgentReschedule({...confirmation,principal:human,confirmedDigest:'changed'}).code,'REVIEWED_COMMAND_CHANGED');
 assert.equal((await planner.call({authorization:'Bearer '+token,arguments:envelope('reschedule',move)})).code,'AGENT_SUGGEST_ONLY');
 const confirmed=confirmAgentReschedule({...confirmation,principal:human});assert.equal(confirmed.ok,true);
 const executor=boundary({...identity,mode:'executor',grants:[confirmed.grant]});
 assert.equal((await executor.call({authorization:'Bearer '+token,arguments:envelope('reschedule',{...move,plannedEnd:'2026-10-13T02:00:00.000Z'})})).code,'EXACT_APPROVAL_REQUIRED');
 let chartRevision;
 if(chartPort){const created=await chartPort(createChartCommand(chartData(before,at)));assert.equal(created.details.command,'CreateChart');chartRevision=created.details.manifest.dataRevision;}
 const execute=()=>executor.call({authorization:'Bearer '+token,arguments:envelope('reschedule',move)});
 const done=await execute();assert.equal(done.ok,true,JSON.stringify(done));
 assert.equal((await execute()).code,'RECONCILIATION_REQUIRED');
 const receipt=await executor.call({authorization:'Bearer '+token,arguments:envelope('read_receipt',{operationId:move.operationId})});
 assert.equal(receipt.ok,true,JSON.stringify(receipt));assert.equal(receipt.receipt.after.plannedStart,move.plannedStart);
 const after=await read(planner);assert.equal(after.sessions.find(s=>s.scheduleItemId===move.scheduleItemId).plannedStart,move.plannedStart);
 assert.equal(after.revisions.scheduleRevision,before.revisions.scheduleRevision+1);
 const staleCommand={...move,operationId:'STALE-EXECUTION'};
 const {agentCommandDigest}=await import('../src/jso-agent-api-v1.mjs');
 const staleExecutor=boundary({...identity,mode:'executor',grants:[{...confirmed.grant,approvalRef:'SYNTHETIC-STALE',commandDigest:agentCommandDigest('reschedule',staleCommand)}]});
 assert.equal((await staleExecutor.call({authorization:'Bearer '+token,arguments:envelope('reschedule',staleCommand)})).code,'SCHEDULING_REVISION_CONFLICT');
 assert.deepEqual((await read(planner)).revisions,after.revisions);
 const stale=await tool.processToolCall(envelope('propose_reschedule',{...move,operationId:'STALE'}));assert.equal(stale.result.code,'SCHEDULING_REVISION_CONFLICT');
 if(chartPort){
  const update=await chartPort(refreshChartCommand(chartData(after,at),chartRevision));assert.equal(update.details.command,'ReplaceData');
  const readback=await chartPort({command:'GetChartData',chartId:'jso-local-candidate'});assert.equal(readback.details.command,'GetChartData');
  assert.deepEqual(readback.details.data.revisions,{...after.revisions});
  assert.equal(readback.details.data.sessions.find(s=>s.scheduleItemId===move.scheduleItemId).plannedStart,move.plannedStart);
  await assert.rejects(()=>chartPort(refreshChartCommand(chartData(before,at),chartRevision)),/revision|版本/i);
  if(process.env.JSO_VCHART_SYNTHETIC_EVIDENCE)writeFileSync(process.env.JSO_VCHART_SYNTHETIC_EVIDENCE,JSON.stringify({before:chartData(before,at),after:chartData(after,at)},null,2));
 }
}
test('Schema12 native candidate read → pure proposal → synthetic Owner confirmation → guarded execution/reconciliation',async t=>scenario(t));
const authorRoot=process.env.JSO_VCHART_AUTHOR_SOURCE;
test('pinned actual ChartController + ChartService consume CreateChart/ReplaceData and read back JSO revisions', {skip:!authorRoot},async t=>{
 const require=createRequire(import.meta.url);
 const {ChartService}=require(join(authorRoot,'chartService.js'));
 const plugin=require(join(authorRoot,'ChartControllerService.js'));
 const root=mkdtempSync(join(tmpdir(),'jso-author-chart-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const service=await new ChartService({appDataRoot:root}).initialize();plugin.initialize({chartService:service});
 await scenario(t,args=>plugin.processToolCall(args));
});

test('native stdio process uses fixed local endpoint and synthetic assistant token',async t=>{
 const {createServer}=await import('node:http');
 const {once}=await import('node:events');
 const {spawn}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const {createJsoAgentHttpHandler}=await import('../src/jso-agent-api-v1.mjs');
 const f=await launch();t.after(()=>f.close());await scheduleOrders(f,1);
 const boundary=createJsoAgentBoundary({store:f.server.store,identities:[{token,subjectId:'synthetic-assistant',mode:'planner',resourceIds:[f.resourceId]}],clock:()=>new Date(at)});
 const server=createServer(createJsoAgentHttpHandler(boundary.application));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 async function invoke(args){
  const child=spawn(process.execPath,[fileURLToPath(new URL('../examples/vcp-vchart/native-tool.mjs',import.meta.url))],{env:{PATH:process.env.PATH,JSO_LOCAL_AGENT_ENDPOINT:`http://127.0.0.1:${server.address().port}/api/v2/agent/tools`,JSO_LOCAL_AGENT_TOKEN:token},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.stdin.end(JSON.stringify(args));
  const [code]=await once(child,'exit');assert.equal(code,0,err);return JSON.parse(out);
 }
 const read=await invoke(envelope('read_state',{resourceScope:[f.resourceId]}));assert.equal(read.result.orders.length,1);
 const forbidden=await invoke({...envelope('read_state',{resourceScope:[f.resourceId]}),token:'override'});assert.equal(forbidden.status,'error');
 assert.equal((await invoke(envelope('reschedule',{}))).result.code,'AGENT_SUGGEST_ONLY');
});

test('assistant reads actual progress from authoritative Schema12 runs',async t=>{
 const f=await launch();t.after(()=>f.close());const sessions=await scheduleOrders(f,1);
 f.setTime(sessions[0].plannedStart);
 await f.ok('/api/v3/business/run-events',{eventId:'AGENT-READ-START',runId:'AGENT-READ-RUN',scheduleItemId:sessions[0].id,eventType:'start',expectedRunRevision:0});
 const boundary=createJsoAgentBoundary({store:f.server.store,identities:[{token,subjectId:'synthetic-assistant',mode:'planner',resourceIds:[f.resourceId]}],clock:()=>new Date(at)});
 const result=await boundary.application.call({authorization:'Bearer '+token,arguments:envelope('read_state',{resourceScope:[f.resourceId]})});
 assert.equal(result.ok,true);assert.equal(result.progress[0].runs[0].status,'shooting');
 assert.equal(result.progress[0].runs[0].startedAt,sessions[0].plannedStart);
});
