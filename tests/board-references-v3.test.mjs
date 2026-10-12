import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {launch,submission,scheduleOrders} from './support/first-launch-v3-fixture.mjs';
import {coreFixture} from './support/greenfield-core-fixture.mjs';
import {boardView,actualSessionState,beijingParts} from '../public/board-model.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=','base64');
async function wire(f){await new Promise(r=>f.server.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${f.server.server.address().port}`;return async(path,{token='a'.repeat(40),body,type='image/png',name='参考.png',method}={})=>fetch(base+path,{method:method||(body?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':type,'X-File-Name':encodeURIComponent(name)},body});}
async function close(f){await new Promise(r=>f.server.server.close(r));f.close();}
test('Schema12 board and reference bytes require business identity; upload is replay-safe and claimed atomically by its order',async()=>{
 const f=await launch();const call=await wire(f);try{
  assert.equal((await call('/api/v3/business/board',{token:''})).status,401);
  assert.equal((await call('/api/v3/business/board',{token:'b'.repeat(40)})).status,403);
  const path='/api/v3/business/references?operationId=SYNTHETIC-ORDER-0';
  assert.equal((await call(path,{body:png,token:''})).status,401);
  assert.equal((await call(path,{body:png,token:'c'.repeat(40)})).status,403);
  assert.equal((await call(path,{body:Buffer.from('not an image')})).status,415);
  const uploaded=await call(path,{body:png});assert.equal(uploaded.status,201);const asset=(await uploaded.json()).upload;
  const replay=await call(path,{body:png});assert.equal(replay.status,200);assert.equal((await replay.json()).upload.id,asset.id);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM uploads').get().n,1);
  assert.equal((await call('/api/v3/business/references/'+asset.id)).status,403);
  const rev=(await f.state()).revisions,command={submission:{...submission(0),uploadIds:[asset.id]},expectedScheduleRevision:rev.scheduleRevision,expectedProjectionRevision:rev.projectionRevision};
  const created=await f.ok('/api/v3/business/requests',command);await f.ok('/api/v3/business/requests',command);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM requests_v2').get().n,1);
  assert.equal(f.server.store.db.prepare('SELECT claimed_task_id FROM uploads').get().claimed_task_id,created.requestId);
  const response=await call('/api/v3/business/references/'+asset.id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  for(const token of ['', 'b'.repeat(40),'c'.repeat(40)])assert.ok((await call('/api/v3/business/references/'+asset.id,{token})).status>=400);
  assert.equal((await call(path,{body:png})).status,409);
  const state=await (await call('/api/v3/business/board')).json();assert.equal(state.orderFacts[0].references[0].id,asset.id);
  assert.equal(state.orderFacts[0].shootingSubtype,'产品3D主图');
  assert.equal((await call('/api/v1/snapshot')).status,409);assert.equal((await call('/api/v1/uploads?operationId=OLD-OPERATION',{body:png})).status,409);
  for(const url of ['/submit','/submit/print','/submit/video','/kiosk'])assert.match(await (await call(url,{token:''})).text(),/此入口尚未启用/);
 }finally{await close(f);}
});
test('reference upload preserves per-file, count, batch, signature and order-ownership limits',async()=>{
 const f=await launch();const call=await wire(f);try{
  const path='/api/v3/business/references?operationId=SYNTHETIC-ORDER-0';
  assert.equal((await call(path,{body:png,type:'application/pdf'})).status,415);
  assert.equal((await call(path,{body:Buffer.alloc(0)})).status,413);
  assert.equal((await call(path,{body:Buffer.alloc(12*1024*1024+1)})).status,413);
  for(let i=0;i<10;i++)assert.equal((await call(path,{body:png,name:`${i}.png`})).status,201);
  assert.equal((await call(path,{body:png,name:'extra.png'})).status,413);
  const asset=f.server.store.db.prepare('SELECT id FROM uploads LIMIT 1').get().id;
  const r=(await f.state()).revisions;
  assert.equal((await f.call('/api/v3/business/requests',{submission:{...submission(1),uploadIds:[asset]},expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision})).status,422);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM requests_v2').get().n,0);
  const large=Buffer.alloc(11*1024*1024);png.copy(large);
  for(let i=0;i<3;i++)assert.equal((await call('/api/v3/business/references?operationId=BATCH-LIMIT-001',{body:large,name:`large${i}.png`})).status,201);
  assert.equal((await call('/api/v3/business/references?operationId=BATCH-LIMIT-001',{body:large,name:'large3.png'})).status,413);
 }finally{await close(f);}
});
test('V3 board retains five distinct categories, confirmed forecast and actual events without inferring shooting from clock',async()=>{
 const f=await launch();try{
  const sessions=await scheduleOrders(f,5);let view=boardView(await f.state());assert.equal(new Set(view.tasks.map(t=>t.shootingSubtype)).size,5);assert.ok(view.sessions.every(s=>s.actualState==='scheduled'));assert.ok(view.sessions.every(s=>s.ids.length===1));
  f.setTime(sessions[0].plannedStart);await f.ok('/api/v3/business/run-events',{eventId:'BOARD-START',runId:'BOARD-RUN',scheduleItemId:sessions[0].id,eventType:'start',expectedRunRevision:0});
  const input={scheduleItemId:sessions[0].id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,endAt:'2026-10-12T03:30:00.000Z',bufferAfterMinutes:20};
  const preview=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(preview.preview.canApply,true);await f.ok('/api/v3/business/day-adjustment/apply',{operationId:'BOARD-CONFIRM',input,previewDigest:preview.previewDigest});
  view=boardView(await f.state());const session=view.sessions.find(s=>s.id===sessions[0].id);assert.equal(session.end,'09:30');assert.equal(beijingParts(session.confirmedForecast.estimatedEnd).time,'11:30');assert.equal(session.actualState,'live');assert.equal(view.tasks.find(t=>session.ids.includes(t.id)).status,'live');assert.equal(session.runs[0].completedAt,null);
  f.setTime('2026-10-12T02:00:00.000Z');await f.ok('/api/v3/business/run-events',{eventId:'BOARD-COMPLETE',runId:'BOARD-RUN',scheduleItemId:session.id,eventType:'complete',expectedRunRevision:1});
  const done=boardView(await f.state()).sessions.find(s=>s.id===session.id);assert.equal(done.actualState,'completed');assert.equal(done.runs[0].startedAt,session.runs[0].startedAt);assert.equal(done.confirmedForecast.estimatedEnd,input.endAt);
  assert.equal(actualSessionState({status:'confirmed',runs:[]}), 'scheduled');
 }finally{f.close();}
});
test('Schema11 keeps its existing public snapshot and static submission page; V3 image route cannot write it',async()=>{
 const f=await coreFixture();f.activate();f.server=f.server('enabled');const call=await wire(f);try{
  const before=readFileSync(f.filename);assert.equal((await call('/api/v1/snapshot',{token:''})).status,200);
  assert.doesNotMatch(await (await call('/submit',{token:''})).text(),/此入口尚未启用/);
  assert.equal((await call('/api/v3/business/references?operationId=SCHEMA11-REF',{body:png})).status,409);
  assert.equal(f.server.store.db.prepare('SELECT count(*) n FROM uploads').get().n,0);assert.deepEqual(readFileSync(f.filename),before);
 }finally{await close(f);}
});

test('V3 upload persistence accepts only unsubmitted operations and leaves saved-order attachments unchanged',async()=>{
 const f=await launch();try{
  const input={operationId:'SYNTHETIC-ORDER-0',originalName:'reference.png',contentType:'image/png',kind:'image',buffer:png,role:'administrator',deduplicate:true,requireUnsubmittedOperation:true};
  const asset=f.server.store.saveUpload(input);assert.equal(asset.status,201);
  assert.equal(f.server.store.saveUpload(input).upload.id,asset.upload.id);
  const revisions=(await f.state()).revisions;
  const command={submission:{...submission(0),uploadIds:[asset.upload.id]},expectedScheduleRevision:revisions.scheduleRevision,expectedProjectionRevision:revisions.projectionRevision};
  await f.ok('/api/v3/business/requests',command);
  const {readdirSync}=await import('node:fs');
  const files=readdirSync(f.uploads).sort();
  const rows=f.server.store.db.prepare('SELECT * FROM uploads ORDER BY id').all();
  assert.deepEqual(f.server.store.saveUpload({...input,originalName:'later.png'}),{ok:false,status:409,code:'UPLOAD_ORDER_ALREADY_SAVED'});
  assert.deepEqual(f.server.store.db.prepare('SELECT * FROM uploads ORDER BY id').all(),rows);
  assert.deepEqual(readdirSync(f.uploads).sort(),files);
  await f.ok('/api/v3/business/requests',command);
 }finally{f.close();}
});
