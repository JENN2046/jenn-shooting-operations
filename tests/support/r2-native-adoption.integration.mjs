import baseTest from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {createServer} from 'node:http';import {once} from 'node:events';
import {join,resolve} from 'node:path';import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {ScheduleStore} from '../../src/store.mjs';
import {launch,scheduleOrders,createOrder} from './first-launch-v3-fixture.mjs';
import {createConversationBoundary} from '../../src/jso-conversation-boundary-v1.mjs';
import {createBusinessRuntimeAuthV1} from '../../src/business-runtime-auth-v1.mjs';
const require=createRequire(import.meta.url),root=resolve(new URL('../..',import.meta.url).pathname);
const extensionRoot=process.env.JSO_EXTENSIONS_ROOT||join(root,'extensions');
const available=existsSync(join(extensionRoot,'ShootingOperationsPackages/JsoConversation/service.cjs'))&&existsSync(join(extensionRoot,'ShootingOperationsPackages/JsoAgentAdapter/index.cjs'));
if(!available||!process.env.JSO_TOOLBOX_ROOT)throw Error('R2 integration requires explicit JSO_EXTENSIONS_ROOT and JSO_TOOLBOX_ROOT');
const test=(name,fn)=>baseTest(name,fn);
const {ConversationService,parseShift}=available?require(join(extensionRoot,'ShootingOperationsPackages/JsoConversation/service.cjs')):{};
const token='SYNTHETIC-ASSISTANT-'.padEnd(40,'x');
async function fixture(t){const f=await launch();t.after(()=>f.close());await scheduleOrders(f,1);
 const ownerAuthenticate=createBusinessRuntimeAuthV1({identities:[{token:'synthetic-owner'.padEnd(40,'x'),subjectId:'Jenn',role:'administrator',resourceIds:[f.resourceId]}]});
 let ownerEnabled=true;
 const boundary=createConversationBoundary({store:f.server.store,identities:[{token,subjectId:'assistant',mode:'executor',resourceIds:[f.resourceId]}],ownerAuthenticate:req=>ownerEnabled?ownerAuthenticate(req):null,clock:()=>new Date('2026-10-12T00:00:00.000Z')});
 const server=createServer(boundary.handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const {createAgentAdapter}=require(join(extensionRoot,'ShootingOperationsPackages/JsoAgentAdapter/index.cjs'));
 const adapter=createAgentAdapter({endpoint:`http://127.0.0.1:${server.address().port}/api/v2/agent/tools`,token});
 const dir=mkdtempSync(join(tmpdir(),'jso-conversation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let drop=false,calls=0;const options={journalPath:join(dir,'journal.json'),clock:()=>new Date('2026-10-12T00:00:00.000Z'),verifyOwner:async()=>true,
  tool:async args=>{if(args.command==='reschedule')calls++;const r=await adapter.call(args);if(drop&&args.command==='reschedule'){drop=false;throw Error('synthetic response loss');}return r;},
  ownerAuthorize:r=>boundary.ownerCall('Bearer '+'synthetic-owner'.padEnd(40,'x'),{sourceRef:r.sourceId,assistantSubjectId:'assistant',action:r.proposal.action||'reschedule',command:r.proposal.command}),
  ownerCancel:r=>boundary.ownerCall('Bearer '+'synthetic-owner'.padEnd(40,'x'),{sourceRef:r.sourceId,assistantSubjectId:'assistant',action:r.proposal.action||'reschedule',command:r.proposal.command,cancel:true}),
  refreshChart:async state=>({ok:true,revisions:state.revisions})};
 return {f,boundary,ownerUrl:`http://127.0.0.1:${server.address().port}`,revokeOwner:()=>ownerEnabled=false,service:new ConversationService(options),options,drop:()=>drop=true,calls:()=>calls};}
const source=(s,id,text)=>s.captureNative({messageId:id,conversationId:'C1',text});
const toolboxRoot=process.env.JSO_TOOLBOX_ROOT;
test('native full adoption confirms once and recovers its original scoped decision receipt after response loss and restart',async t=>{
 const {f,service,options}=await fixture(t);
 const {result}=await createOrder(f,1,{note:'synthetic/non-customer'});const requestId=result.requestId;
 const r=(await f.state()).revisions;
 await f.ok(`/api/v3/business/requests/${requestId}/duration`,{operationId:'ADOPT-DURATION',requestId,expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision,durationMinutes:30});
 const planned=await service.proposeAdoption({conversationId:'C1',messageId:'native-adopt',resourceId:f.resourceId,planningWindowStart:'2026-10-12T00:00:00.000Z',planningWindowEnd:'2026-10-12T16:00:00.000Z',config:{resources:[f.resourceId],requestIds:[requestId]}});
 assert.equal(planned.ok,true,JSON.stringify(planned));assert.deepEqual(planned.plan.proposal.items.map(i=>i.requestId),[requestId]);
 source(service,'adopt-too-early','可以');assert.equal((await service.submit('adopt-too-early',f.resourceId)).code,'PROPOSAL_NOT_PRESENTED');
 service.markPresented(planned.plan.id,'C1',planned.plan.proposal.commandDigest);
 let writes=0;const tool=service.tool;service.tool=async args=>{const result=await tool(args);if(args.command==='adopt_proposal'){writes++;assert.equal(result.ok,true,JSON.stringify(result));throw Error('synthetic committed reply lost');}return result;};
 source(service,'adopt-confirm','可以');const done=await service.submit('adopt-confirm',f.resourceId);assert.equal(done.committed,true,JSON.stringify(done));assert.equal(writes,1);
 assert.equal(done.operationId,planned.plan.proposal.command.decision.decisionId);assert.equal(done.receipt.decisionType,'accept');
 const receipt=await service.call('read_receipt',{operationId:done.operationId});assert.equal(receipt.kind,'proposalDecision');assert.deepEqual(receipt.resourceScope,[f.resourceId]);
 const restarted=new ConversationService({...options,tool:service.tool});assert.equal((await restarted.submit('adopt-confirm',f.resourceId)).operationId,done.operationId);assert.equal(writes,1);assert.equal((await f.state()).sessions.length,2);
 // Two-component recovery uses detached copies of both latest business truth
 // and the VCP journal. No production snapshot, credential or operation is used.
 const snapshot=options.journalPath+'.sealed.sqlite',working=options.journalPath+'.restored.sqlite',journal=options.journalPath+'.restored.json';
 const backedUp=spawnSync('python3',['-c','import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',f.filename,snapshot],{encoding:'utf8'});
 assert.equal(backedUp.status,0,'synthetic SQLite backup failed');copyFileSync(snapshot,working);
 const saved=JSON.parse(readFileSync(options.journalPath,'utf8'));saved.operations[done.operationId].phase='unknown';delete saved.operations[done.operationId].receipt;writeFileSync(journal,JSON.stringify(saved));
 const sealedBytes=readFileSync(snapshot),restoredStore=new ScheduleStore({filename:working});t.after(()=>restoredStore.close());
 const recoveredBoundary=createConversationBoundary({store:restoredStore,identities:[{token,subjectId:'assistant',mode:'executor',resourceIds:[f.resourceId]}],ownerAuthenticate:async()=>null});
 let recoveryWrites=0;const recovered=new ConversationService({...options,journalPath:journal,ownerAuthorize:async()=>{recoveryWrites++;throw Error('recovery must not authorize');},tool:async args=>{assert.ok(['read_receipt','read_state'].includes(args.command));return recoveredBoundary.application.call({authorization:'Bearer '+token,arguments:args});}});
 const recoveredResults=await recovered.recover();assert.equal(recoveredResults[0].committed,true,JSON.stringify(recoveredResults));assert.equal(recoveredResults[0].operationId,done.operationId);assert.equal(recoveryWrites,0);
 assert.equal(restoredStore.db.prepare('SELECT count(*) AS n FROM schedule_items').get().n,2);
 assert.equal(restoredStore.db.prepare('SELECT count(*) AS n FROM agent_grant_attempts WHERE approval_ref=?').get('adopt-confirm').n,1);
 assert.deepEqual(readFileSync(snapshot),sealedBytes);assert.equal(existsSync(snapshot+'-wal'),false);assert.equal(existsSync(snapshot+'-shm'),false);
});
test('native adoption rejects any request outside the operator allowlist without a business write',async t=>{
 const {f,service}=await fixture(t);const {result}=await createOrder(f,1);const r=(await f.state()).revisions;
 await f.ok(`/api/v3/business/requests/${result.requestId}/duration`,{operationId:'OTHER-DURATION',requestId:result.requestId,expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision,durationMinutes:30});
 const before=(await f.state()).revisions;
 const planned=await service.proposeAdoption({conversationId:'C1',messageId:'outside',resourceId:f.resourceId,planningWindowStart:'2026-10-12T00:00:00.000Z',planningWindowEnd:'2026-10-12T16:00:00.000Z',config:{resources:[f.resourceId],requestIds:['different-synthetic-request']}});
 assert.equal(planned.code,'PROPOSAL_OUTSIDE_TEST_SCOPE');assert.deepEqual((await f.state()).revisions,before);assert.equal(Object.keys(service.journal.data.operations).length,0);
});
baseTest('configured plugin host consumes real generic authority, native confirmation and JSO receipt without UI', {skip:!toolboxRoot},async t=>{
 const {ApprovalReceiptAuthority}=require(join(toolboxRoot,'modules/approvalReceiptAuthority'));
 const {createConversationHost}=require(join(extensionRoot,'ShootingOperationsPackages/JsoConversation/host.cjs'));
 const {parseConfig}=require(join(extensionRoot,'ShootingOperationsPackages/JsoAgentAdapter/config.cjs'));
 const {f,boundary,ownerUrl,options}=await fixture(t);
 const {result:adoptionOrder}=await createOrder(f,1,{note:'synthetic/non-customer'}),ar=(await f.state()).revisions;
 await f.ok(`/api/v3/business/requests/${adoptionOrder.requestId}/duration`,{operationId:'NATIVE-ADOPT-DURATION',requestId:adoptionOrder.requestId,expectedScheduleRevision:ar.scheduleRevision,expectedProjectionRevision:ar.projectionRevision,durationMinutes:30});
 // Explicit synthetic admission; the real kernel is reused, production admission is NOT enabled.
 const authority=new ApprovalReceiptAuthority({testOnly:true});const lease={sessionId:'SYNTHETIC',expiresAt:Date.now()+60000};let active=true;
 authority.setHumanClientAdmission({validLease:value=>active&&value===lease,productionHuman:()=>false});
 const events=new WeakMap();let delegated=0;
 const host=createConversationHost({config:parseConfig({JSO_LOCAL_AGENT_ENDPOINT:ownerUrl+'/api/v2/agent/tools',JSO_LOCAL_AGENT_TOKEN:token,JSO_RESOURCE_IDS:f.resourceId,JSO_CALL_POLICY:'native-direct-and-confirm',JSO_NATIVE_REQUEST_IDS:adoptionOrder.requestId}),authority,
  readNativeEvent:context=>events.get(context),sessionCurrent:async()=>active,journalPath:options.journalPath+'.host',clock:options.clock,refreshChart:options.refreshChart,
  cancelDelegate:({source,command})=>boundary.ownerCall('Bearer '+'synthetic-owner'.padEnd(40,'x'),{sourceRef:source.id,assistantSubjectId:'assistant',command,cancel:true}),
  delegate:async({action,context,source,command,receipt})=>{assert.equal(authority.isHuman(context),true);assert.equal(receipt.humanApproved,true);delegated++;return boundary.ownerCall('Bearer '+'synthetic-owner'.padEnd(40,'x'),{sourceRef:source.id,assistantSubjectId:'assistant',action,command});}});
 const native=(id,text)=>{const context={};authority.bindHttpRequest(context,lease);events.set(context,{messageId:id,text,conversationId:'C1',observedSequence:host.sequence()});return context;};
 assert.equal((await host.submit({role:'user',human:true,text:'可以'},f.resourceId)).code,'TRUSTED_SESSION_REQUIRED');
 assert.equal((await host.call({command:'reschedule',payload_json:'{"approved":true}'})).code,'TRUSTED_CONVERSATION_INTERFACE_REQUIRED');
 const direct=native('native-direct','把产品3D主图延后7分钟');const first=await host.submit(direct,f.resourceId);assert.equal(first.committed,true);assert.equal(delegated,1);
 assert.equal((await host.submit(direct,f.resourceId)).operationId,first.operationId);assert.equal(delegated,1);
 const state=await host.call({command:'read_state',payload_json:'{}'}),args={conversationId:'C1',messageId:'model-1',resourceId:f.resourceId,scheduleItemId:state.sessions[0].scheduleItemId,minutes:12};
 const plan=await host.propose(args);const before=native('before-display','可以');assert.equal((await host.submit(before,f.resourceId)).code,'PROPOSAL_NOT_PRESENTED');
 assert.equal(host.presented(before,{planId:plan.plan.id,conversationId:'C1',text:'edited'}).code,'PRESENTATION_MISMATCH');
 assert.equal(host.presented(before,{planId:plan.plan.id,conversationId:'C1',text:plan.plan.presentation}).ok,true);
 assert.equal((await host.submit(native('quote','“可以”'),f.resourceId)).code,'NEEDS_CLARIFICATION');
 const confirm=native('native-confirm','可以'),done=await host.submit(confirm,f.resourceId);assert.equal(done.committed,true);assert.equal(delegated,2);
 assert.equal((await host.submit(confirm,f.resourceId)).operationId,done.operationId);assert.equal(delegated,2);
 const receipt=await host.call({command:'read_receipt',payload_json:JSON.stringify({operationId:done.operationId})});assert.equal(receipt.receipt.operationId,done.operationId);
 const adoptionPlan=await host.propose({action:'adopt_proposal',conversationId:'C1',messageId:'model-adopt',resourceId:f.resourceId,planningWindowStart:'2026-10-12T00:00:00.000Z',planningWindowEnd:'2026-10-12T16:00:00.000Z'});assert.equal(adoptionPlan.ok,true,JSON.stringify(adoptionPlan));
 assert.equal(host.presented(confirm,{planId:adoptionPlan.plan.id,conversationId:'C1',text:adoptionPlan.plan.presentation}).ok,true);
 const adopted=await host.submit(native('native-adopt-confirm','可以'),f.resourceId);assert.equal(adopted.committed,true,JSON.stringify(adopted));assert.equal(delegated,3);
 const decisionReceipt=await host.call({command:'read_receipt',payload_json:JSON.stringify({operationId:adopted.operationId})});assert.equal(decisionReceipt.kind,'proposalDecision');assert.deepEqual(decisionReceipt.resourceScope,[f.resourceId]);
 active=false;assert.equal((await host.submit(confirm,f.resourceId)).code,'TRUSTED_SESSION_REQUIRED');
 const production=new ApprovalReceiptAuthority();production.setHumanClientAdmission({validLease:value=>value===lease,productionHuman:()=>false});const ctx={};production.bindHttpRequest(ctx,lease);assert.equal(production.isHuman(ctx),false);
});
