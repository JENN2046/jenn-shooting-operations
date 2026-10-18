import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizeCapability} from '../src/authorization-v2.mjs';
import {isSchedulingIdentifierV1} from '../src/scheduling-contract-v1.mjs';
import {createKioskOnlineRuntimeV3} from '../src/kiosk-online-runtime-v3.mjs';
import {createKioskOnlineV3} from '../src/kiosk-online-v3.mjs';
import {createHttpApp} from '../src/http-app.mjs';
import {Readable} from 'node:stream';
import {launch,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
import {browserStorage} from './support/kiosk-offline-fixture.mjs';
import {validKioskResourceIdV3,validateKioskQueueItemV3,createKioskTransportV3,kioskCommandV3} from '../public/kiosk-queue-protocol-v3.js';
import {createBrowserQueueStorage,createKioskOfflineQueue} from '../public/kiosk-offline-queue-v2.js';
const identity={token:'SYNTHETIC-JENN-ONLY'.padEnd(40,'x'),subjectId:'OPERATOR-JENN-001',deviceId:'DEVICE-JENN-001',resourceId:'Jenn'};
const item={schemaVersion:3,eventId:'JENN-START-001',runId:'JENN-RUN-001',scheduleItemId:'JENN-SCHEDULE-001',eventType:'start',expectedRunRevision:0,expectedScheduleRevision:1,occurredAt:'2026-10-12T01:00:00.000Z',recordingMode:'device-declared',subjectId:identity.subjectId,deviceId:identity.deviceId,resourceId:'Jenn',localSequence:0};
test('Kiosk resource references exactly follow business identifiers without widening other fields',()=>{
 const values=['Jenn','R','摄影棚','A B','A/B?#%','é','e\u0301','😀'.repeat(160),'x'.repeat(160),'x'.repeat(161),'😀'.repeat(161),'',' ',' Jenn','Jenn ',null,42,'a\nb','a\u0000b','a\u007fb','a\u0085b','a\u2028b','a\u2029b','a\ud800','a\udc00','a\ud800b','a\udc00b'];
 for(const resourceId of values){
 const expected=isSchedulingIdentifierV1(resourceId);assert.equal(validKioskResourceIdV3(resourceId),expected,JSON.stringify(resourceId));
 assert.equal(validateKioskQueueItemV3({...item,resourceId}).ok,expected);
 if(expected){const runtime=createKioskOnlineRuntimeV3({identities:[{...identity,resourceId}]});const principal=runtime.authenticate({headers:{authorization:'Bearer '+identity.token}}).principal;assert.deepEqual(principal.resourceIds,[resourceId]);assert.equal(authorizeCapability({principal,capability:'submitRunEvent',resourceId}).allowed,true);assert.equal(authorizeCapability({principal,capability:'submitRunEvent',resourceId:resourceId+'-other'}).allowed,false);}
 else assert.throws(()=>createKioskOnlineRuntimeV3({identities:[{...identity,resourceId}]}),/INVALID/);
 }
 for(const key of ['subjectId','deviceId'])assert.throws(()=>createKioskOnlineRuntimeV3({identities:[{...identity,[key]:'Jenn'}]}),/INVALID/);
 for(const key of ['eventId','runId','scheduleItemId','subjectId','deviceId'])assert.equal(validateKioskQueueItemV3({...item,[key]:'Jenn'}).ok,false,key);
 assert.throws(()=>createKioskOnlineRuntimeV3({identities:[{...identity,token:'Jenn'}]}),/INVALID/);
});
async function fixture(resourceId){
 const identities=[{...identity,resourceId},{...identity,token:'OTHER-SYNTHETIC'.padEnd(40,'x'),deviceId:'DEVICE-OTHER-001',resourceId:'Other'}];
 const f=await launch({kioskIdentities:identities,resourceId});await scheduleOrders(f,2);
 let at='2026-10-13T00:30:00.000Z';
 const online=createKioskOnlineV3({store:f.server.store,runtime:createKioskOnlineRuntimeV3({identities}),clock:()=>new Date(at)}),app=createHttpApp({store:f.server.store,kioskOnline:online});
 const call=async(path,body,token=identity.token)=>{const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url=path;req.method=body===undefined?'GET':'POST';req.headers={authorization:'Bearer '+token};let status,result;await app(req,{setHeader(){},writeHead(s){status=s;},end(b){result=JSON.parse(b);}});return {status,body:result};};
 // Queue commands refer to the original planned day; replay occurs the next day.
 at='2026-10-12T03:00:00.000Z';const day=(await call('/api/v3/kiosk/day')).body;at='2026-10-13T00:30:00.000Z';
 return {...f,call,day,identities};
}
test('Jenn and Unicode business resource offline queues reload, recover a lost receipt and deny another resource',async()=>{
 for(const resourceId of ['Jenn','摄影棚']){
 const f=await fixture(resourceId);try{
 const binding={subjectId:identity.subjectId,deviceId:identity.deviceId,resourceId},local=browserStorage(),key='jenn.kiosk.queue.v3:'+JSON.stringify([binding.subjectId,binding.deviceId,resourceId]);
 local.setItem('jenn.kiosk.offline-queue.v2','LEGACY-V2-PRESERVED');
 const start={...item,...binding,scheduleItemId:f.day.sessions[0].id,expectedScheduleRevision:f.day.revisions.scheduleRevision};
 const complete={...start,eventId:'JENN-COMPLETE-001',eventType:'complete',expectedRunRevision:1,occurredAt:'2026-10-12T01:30:00.000Z',localSequence:1};
 const sent=[];let lose=true;
 const make=()=>{const storage=createBrowserQueueStorage({storage:local,key,protocolVersion:3});const transport=createKioskTransportV3({binding,getToken:()=>identity.token,fetchImpl:async(path,init)=>{sent.push({path,method:init.method});const r=await f.call(path,init.body?JSON.parse(init.body):undefined);if(init.method==='POST'&&lose){lose=false;throw Error('synthetic lost response');}return {status:r.status,json:async()=>r.body};}});return createKioskOfflineQueue({storage,transport,clock:()=>new Date('2026-10-13T00:30:00.000Z')});};
 const q=make();assert.equal(q.enqueue(start).ok,true);assert.equal(q.enqueue(complete).ok,true);
 assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n,0);
 const restored=make();assert.deepEqual(restored.inspect().items,[start,complete]);assert.equal((await restored.replay({resourceId})).pendingCount,2);
 const recovered=make();assert.equal((await recovered.replay({resourceId})).pendingCount,0);
 assert.equal(sent.filter(x=>x.method==='POST').length,2); // one start, one complete; lost response is recovered by GET.
 const events=f.server.store.db.prepare('SELECT occurred_at FROM production_events ORDER BY rowid').all();assert.deepEqual(events.map(x=>x.occurred_at),[start.occurredAt,complete.occurredAt]);
 assert.equal(local.getItem('jenn.kiosk.offline-queue.v2'),'LEGACY-V2-PRESERVED');
 assert.equal((await f.call('/api/v3/kiosk/events',kioskCommandV3(start),f.identities[1].token)).status,403);
 assert.equal((await f.call('/api/v3/kiosk/events/'+start.eventId,undefined,f.identities[1].token)).status,403);
 assert.equal((await f.call('/api/v3/kiosk/day?resourceId=Other')).status,400);
 assert.equal(createBrowserQueueStorage({storage:local,key:key+'Other',protocolVersion:3}).load(),null);
 const old={...start,recordingMode:'server-received',eventId:'OLD-ONLINE-JENN-001',runId:'OLD-ONLINE-RUN-001',localSequence:2,scheduleItemId:f.day.sessions[1].id};const before=sent.filter(x=>x.method==='POST').length;
 const legacy=make();assert.equal(legacy.enqueue(old).ok,true);const result=await legacy.replay({resourceId});assert.equal(result.stopCode,'LEGACY_ONLINE_EVENT_REVIEW_REQUIRED');assert.deepEqual(legacy.inspect().items,[old]);assert.equal(sent.filter(x=>x.method==='POST').length,before);
 }finally{f.close();}
 }
});
test('new Kiosk HTML and every module dependency share one cache version; V2 remains available',()=>{
 const version='kiosk-v3-resource-id-20261018-r4';
 for(const file of ['kiosk-online-v3.html','kiosk-online-v3.js','kiosk-offline-queue-v2.js']){
 const source=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');const references=[...source.matchAll(/(?:src=\"|from ['\"])([^'\"]+\.js\?v=([^'\"]+))/g)];assert.ok(references.length);for(const ref of references)assert.equal(ref[2],version);
 assert.doesNotMatch(source,/kiosk-v3-offline-20261018-r3/);
 }
 assert.match(readFileSync(new URL('../public/kiosk.html',import.meta.url),'utf8'),/kiosk.js/);
});
