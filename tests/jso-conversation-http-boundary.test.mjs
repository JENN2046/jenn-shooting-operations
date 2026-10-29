import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {ScheduleStore} from '../src/store.mjs';
import {createConversationBoundary} from '../src/jso-conversation-boundary-v1.mjs';
import {createTrustedPrincipal} from '../src/authorization-v2.mjs';
function setup(t,ownerAuthenticate){
 const store=new ScheduleStore({filename:':memory:'});t.after(()=>store.close());
 store.db.exec('CREATE TABLE IF NOT EXISTS agent_grant_attempts (command_digest TEXT, approval_ref TEXT, subject_id TEXT, action TEXT)');
 const principal=createTrustedPrincipal({subjectId:'owner',role:'administrator',resourceIds:['摄影棚']}).principal;
 return createConversationBoundary({store,identities:[{token:'synthetic-token-'.padEnd(40,'x'),subjectId:'assistant',mode:'executor',resourceIds:['摄影棚']}],ownerAuthenticate:ownerAuthenticate||async function(){return principal;}}).handler;
}
const body={sourceRef:'source1',assistantSubjectId:'assistant',command:{operationId:'op1',scheduleItemId:'item1',resourceId:'摄影棚',plannedStart:'2026-10-12T01:00:00.000Z',plannedEnd:'2026-10-12T02:00:00.000Z',expectedScheduleRevision:0,expectedProjectionRevision:0,configDigest:'sha256:'+'a'.repeat(64)}};
async function invoke(handler,chunks,method='POST'){
 const req=Readable.from(chunks);req.url=method==='GET'?'/api/v2/agent/owner-session':'/api/v2/agent/owner-delegation';req.method=method;req.headers={authorization:'Bearer synthetic'};
 let status,result;await handler(req,{writeHead(s){status=s;},end(s){result=JSON.parse(s);}});return {status,result};
}
test('owner delegation decodes UTF-8 only after collecting arbitrary byte boundaries',async t=>{
 const handler=setup(t),bytes=Buffer.from(JSON.stringify(body));
 for(let split=1;split<bytes.length;split++){const r=await invoke(handler,[bytes.subarray(0,split),bytes.subarray(split)]);assert.equal(r.status,200);assert.equal(r.result.ok,true,`split ${split}`);}
});
test('body limit counts raw bytes, not decoded characters',async t=>{
 const handler=setup(t);const raw=Buffer.from(JSON.stringify(body)),accepted=Buffer.concat([raw,Buffer.alloc(32768-raw.length,32)]);assert.equal((await invoke(handler,[accepted])).result.ok,true);
 assert.equal((await invoke(handler,[accepted,Buffer.from(' ')])).status,413);
 assert.equal((await invoke(handler,[Buffer.from('中'.repeat(11000))])).status,413);
});
test('GET async authentication failure returns 503 through actual Server event dispatch',async t=>{
 const handler=setup(t,async()=>{throw Error('synthetic-private-secret');});const server=createServer(handler);
 const result=await new Promise(resolve=>{const req=Readable.from([]);req.url='/api/v2/agent/owner-session';req.method='GET';req.headers={};let status;server.emit('request',req,{writeHead(s){status=s;},end(s){resolve({status,body:JSON.parse(s)});}});});
 assert.deepEqual(result,{status:503,body:{ok:false,code:'SERVICE_UNAVAILABLE'}});await new Promise(r=>setImmediate(r));
});
test('live isolated HTTP listener survives authentication rejection',async t=>{
 const server=createServer(setup(t,async()=>{throw Error('synthetic-private-secret');}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(let i=0;i<2;i++){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2/agent/owner-session`);assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,code:'SERVICE_UNAVAILABLE'});}
});
