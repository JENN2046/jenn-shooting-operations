import baseTest from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {createServer} from 'node:http';import {once} from 'node:events';
import {join,resolve} from 'node:path';import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
import {createConversationBoundary} from '../src/jso-conversation-boundary-v1.mjs';
import {createBusinessRuntimeAuthV1} from '../src/business-runtime-auth-v1.mjs';
const require=createRequire(import.meta.url),root=resolve(new URL('../..',import.meta.url).pathname);
const chatRoot=process.env.JSO_VCPCHAT_ROOT||join(root,'vcpchat-jso-r1'),extensionRoot=process.env.JSO_EXTENSIONS_ROOT||join(root,'extensions-jso-r1');
const available=existsSync(join(chatRoot,'modules/services/jsoConversation/service.js'))&&existsSync(join(extensionRoot,'ShootingOperationsPackages/JsoAgentAdapter/index.cjs'));
const test=(name,fn)=>baseTest(name,{skip:available?false:'Cross-repository local integration: set JSO_VCPCHAT_ROOT and JSO_EXTENSIONS_ROOT'},fn);
const {ConversationService,parseShift}=available?require(join(chatRoot,'modules/services/jsoConversation/service.js')):{};
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
  ownerAuthorize:r=>boundary.ownerCall('Bearer '+'synthetic-owner'.padEnd(40,'x'),{sourceRef:r.sourceId,assistantSubjectId:'assistant',command:r.proposal.command}),
  ownerCancel:r=>boundary.ownerCall('Bearer '+'synthetic-owner'.padEnd(40,'x'),{sourceRef:r.sourceId,assistantSubjectId:'assistant',command:r.proposal.command,cancel:true}),
  refreshChart:async state=>({ok:true,revisions:state.revisions})};
 return {f,boundary,ownerUrl:`http://127.0.0.1:${server.address().port}`,revokeOwner:()=>ownerEnabled=false,service:new ConversationService(options),options,drop:()=>drop=true,calls:()=>calls};}
const source=(s,id,text)=>s.captureNative({messageId:id,conversationId:'C1',text});
test('direct variable-minute shift, repeated delivery and new same-text message',async t=>{const {f,service,calls}=await fixture(t);
 source(service,'human-1','把产品3D主图延后12分钟');const a=await service.submit('human-1',f.resourceId);assert.equal(a.ok,true,JSON.stringify(a));assert.equal(calls(),1);
 const again=await service.submit('human-1',f.resourceId);assert.equal(again.operationId,a.operationId);assert.equal(calls(),1);
 source(service,'human-2','把产品3D主图延后12分钟');const b=await service.submit('human-2',f.resourceId);assert.equal(b.ok,true);assert.notEqual(b.operationId,a.operationId);assert.equal(calls(),2);
 assert.throws(()=>source(service,'human-1','把产品3D主图延后60分钟'),/SOURCE_REPLACED/);
 assert.equal((await service.submit('forged',f.resourceId)).code,'TRUSTED_SOURCE_REQUIRED');});
test('presented proposal confirms once; quotes, conditional and multiple plans do not approve',async t=>{const {f,service,calls}=await fixture(t),state=await service.read(f.resourceId);
 const args={conversationId:'C1',resourceId:f.resourceId,scheduleItemId:state.sessions[0].scheduleItemId};
 const p=await service.propose({...args,minutes:7});assert.equal(p.ok,true);source(service,'reply-1','可以');assert.equal((await service.submit('reply-1',f.resourceId)).code,'PROPOSAL_NOT_PRESENTED');service.markPresented(p.plan.id,'C1',p.plan.proposal.commandDigest);
 for(const [id,text] of [['quote','他说“可以”']]){source(service,id,text);assert.equal((await service.submit(id,f.resourceId)).code,'NEEDS_CLARIFICATION');}assert.equal(calls(),0);
 assert.equal((await service.submit('reply-1',f.resourceId)).code,'CONFIRMATION_PREDATES_PRESENTATION');source(service,'reply-2','可以');assert.equal((await service.submit('reply-2',f.resourceId)).ok,true);assert.equal(calls(),1);
 for(const minutes of [3,4]){const p=await service.propose({...args,minutes});service.markPresented(p.plan.id,'C1',p.plan.proposal.commandDigest);}
 source(service,'multi','可以');assert.equal((await service.submit('multi',f.resourceId)).code,'AMBIGUOUS_CONFIRMATION');source(service,'cancel','取消');assert.equal((await service.submit('cancel',f.resourceId)).cancelled,2);});
test('commit response loss and restart reconcile original ID without new dispatch',async t=>{const {f,service,options,drop,calls}=await fixture(t);source(service,'loss','把产品3D主图延后9分钟');drop();const r=await service.submit('loss',f.resourceId);assert.equal(r.committed,true,JSON.stringify(r));assert.equal(calls(),1);
 const restarted=new ConversationService(options);const again=await restarted.submit('loss',f.resourceId);assert.equal(again.operationId,r.operationId);assert.equal(again.committed,true);assert.equal(calls(),1);
 options.refreshChart=async()=>{throw Error('chart unavailable');};assert.equal((await new ConversationService(options).submit('loss',f.resourceId)).committed,true);});
test('stale plan fails canonical CAS',async t=>{const {f,service}=await fixture(t),state=await service.read(f.resourceId);const p=await service.propose({conversationId:'C1',resourceId:f.resourceId,scheduleItemId:state.sessions[0].scheduleItemId,minutes:4});service.markPresented(p.plan.id,'C1',p.plan.proposal.commandDigest);
 source(service,'first','把产品3D主图延后8分钟');assert.equal((await service.submit('first',f.resourceId)).ok,true);source(service,'stale','可以');assert.equal((await service.submit('stale',f.resourceId)).code,'SCHEDULING_REVISION_CONFLICT');});
test('new follow-up message shifts original target with new operation',async t=>{const {f,service}=await fixture(t);source(service,'a','把产品3D主图延后7分钟');const a=await service.submit('a',f.resourceId);source(service,'b','再延后10分钟');const b=await service.submit('b',f.resourceId);assert.equal(b.ok,true);assert.notEqual(a.operationId,b.operationId);});
test('bounded parser excludes negation, quote and composite side effect',()=>{for(const s of ['不要把A延后10分钟','把“A”延后10分钟','把A延后10分钟并通知客户','可以，但延后5分钟'])assert.equal(parseShift(s),null);assert.deepEqual(parseShift('把A提前17分钟'),{name:'A',minutes:-17});assert.deepEqual(parseShift('把提前准备延后8分钟'),{name:'提前准备',minutes:8});});

test('cancel during owner admission prevents dispatch and restart remains cancelled',async t=>{const {f,service,options,calls}=await fixture(t);let release,entered;const started=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);const authorize=service.ownerAuthorize;service.ownerAuthorize=async r=>{entered(r);await gate;return authorize(r);};source(service,'cancellable','把产品3D主图延后6分钟');const pending=service.submit('cancellable',f.resourceId);const op=await started;assert.equal((await service.cancel(op.id)).cancelled,true);release();assert.equal((await pending).code,'CANCELLED');assert.equal(calls(),0);assert.equal((await new ConversationService(options).submit('cancellable',f.resourceId)).code,'CANCELLED');});
test('expired, modified and revoked owner session cannot approve proposal',async t=>{const {f,service,calls}=await fixture(t);const state=await service.read(f.resourceId);const args={conversationId:'C1',messageId:'agent-reply',resourceId:f.resourceId,scheduleItemId:state.sessions[0].scheduleItemId};const p=await service.propose({...args,minutes:3});service.markPresented(p.plan.id,'C1',p.plan.proposal.commandDigest);const edited=await service.propose({...args,minutes:4});assert.equal(service.journal.data.plans[p.plan.id].closed,true);source(service,'before-edit-display','可以');assert.equal((await service.submit('before-edit-display',f.resourceId)).code,'PROPOSAL_NOT_PRESENTED');service.markPresented(edited.plan.id,'C1',edited.plan.proposal.commandDigest);source(service,'after-edit','可以');service.clock=()=>new Date('2026-10-12T00:10:00Z');assert.equal((await service.submit('after-edit',f.resourceId)).code,'PROPOSAL_EXPIRED');service.verifyOwner=async()=>false;assert.equal((await service.submit('after-edit',f.resourceId)).code,'OWNER_SESSION_REQUIRED');assert.equal(calls(),0);});

test('conditional modification closes old proposal rather than approving its old minutes',async t=>{const {f,service,calls}=await fixture(t);const state=await service.read(f.resourceId);const p=await service.propose({conversationId:'C1',resourceId:f.resourceId,scheduleItemId:state.sessions[0].scheduleItemId,minutes:7});service.markPresented(p.plan.id,'C1',p.plan.proposal.commandDigest);source(service,'modified','可以，但只改五分钟');assert.equal((await service.submit('modified',f.resourceId)).code,'NEEDS_CLARIFICATION');source(service,'later-yes','可以');assert.equal((await service.submit('later-yes',f.resourceId)).code,'AMBIGUOUS_CONFIRMATION');assert.equal(calls(),0);});

test('malformed successful write response reconciles its original receipt, never redispatches',async t=>{const {f,service,calls}=await fixture(t);const tool=service.tool;service.tool=async args=>{const result=await tool(args);return args.command==='reschedule'?{ok:true}:result;};source(service,'malformed','把产品3D主图延后5分钟');const result=await service.submit('malformed',f.resourceId);assert.equal(result.committed,true);assert.equal(calls(),1);});


test('native JSO credential login binds server identity and resource; logout/revocation block execution',async t=>{
 const {f,service,calls,ownerUrl,revokeOwner}=await fixture(t);
 const {OwnerSession}=require(join(chatRoot,'modules/services/jsoConversation/ownerSession'));
 const owner=new OwnerSession({jsoUrl:ownerUrl,ownerSubjectId:'Jenn',resourceId:f.resourceId});
 service.verifyOwner=()=>owner.verify();service.ownerAuthorize=r=>owner.delegate({sourceRef:r.sourceId,assistantSubjectId:'assistant',command:r.proposal.command});
 source(service,'before-login','把产品3D主图延后7分钟');assert.equal((await service.submit('before-login',f.resourceId)).code,'OWNER_SESSION_REQUIRED');
 assert.equal((await owner.login('WRONG'.padEnd(40,'x'))).ok,false);
 const token='synthetic-owner'.padEnd(40,'x');
 const wrongScope=new OwnerSession({jsoUrl:ownerUrl,ownerSubjectId:'Jenn',resourceId:'OTHER'});assert.equal((await wrongScope.login(token)).ok,false);
 const wrongSubject=new OwnerSession({jsoUrl:ownerUrl,ownerSubjectId:'other',resourceId:f.resourceId});assert.equal((await wrongSubject.login(token)).ok,false);
 assert.equal((await owner.login(token)).ok,true);assert.equal(JSON.stringify(owner.status()).includes(token),false);
 source(service,'after-login','把产品3D主图延后7分钟');assert.equal((await service.submit('after-login',f.resourceId)).committed,true);assert.equal(calls(),1);
 owner.logout();source(service,'after-logout','再延后5分钟');assert.equal((await service.submit('after-logout',f.resourceId)).code,'OWNER_SESSION_REQUIRED');
 assert.equal((await owner.login(token)).ok,true);revokeOwner();assert.equal(await owner.verify(),false);assert.equal(owner.status().authenticated,false);assert.equal(calls(),1);
});
