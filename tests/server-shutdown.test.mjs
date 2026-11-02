import test from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {request} from 'node:http';
import {createServer as reservePort} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDrainingHttpServer,installShutdownSignals} from '../src/server-shutdown.mjs';
import {launch} from './support/first-launch-v3-fixture.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function listen(l){l.server.listen(0,'127.0.0.1');await once(l.server,'listening');return `http://127.0.0.1:${l.server.address().port}`;}
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await sleep(5);}assert.fail('synthetic condition timed out');}

test('waits for admitted SQL work, closes once, and rejects new connections',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE facts (n INTEGER)');
 const entered=deferred(),release=deferred();let closes=0,rows;
 const l=createDrainingHttpServer({handler:async(req,res)=>{entered.resolve();await release.promise;db.exec('INSERT INTO facts VALUES(1)');res.end('committed');},closeResources:()=>{closes++;rows=db.prepare('SELECT count(*) n FROM facts').get().n;db.close();}});
 const base=await listen(l);const response=fetch(base);await entered.promise;
 const done=l.shutdown();assert.strictEqual(l.shutdown(),done);assert.equal(l.status().activeRequests,1);
 try{await assert.rejects(fetch(base));assert.equal(closes,0);}finally{release.resolve();}
 assert.equal(await (await response).text(),'committed');assert.equal((await done).ok,true);assert.equal(closes,1);assert.equal(rows,1);
});

test('aborted client does not close resources underneath a still-running async handler',async()=>{
 const entered=deferred(),release=deferred();let open=true,wrote=false;
 const l=createDrainingHttpServer({handler:async(req,res)=>{entered.resolve();await release.promise;assert.equal(open,true);wrote=true;res.end();},closeResources:()=>{open=false;}});
 const base=await listen(l);const r=request(base);r.on('error',()=>{});r.end();await entered.promise;r.destroy();
 const done=l.shutdown();await until(()=>l.status().transportClosed);assert.equal(open,true);assert.equal(l.status().activeRequests,1);
 release.resolve();assert.equal((await done).ok,true);assert.equal(wrote,true);assert.equal(open,false);
});

test('response stream remains active after the handler has returned',async()=>{
 const entered=deferred(),release=deferred();let closed=false;
 const l=createDrainingHttpServer({handler:async(req,res)=>{res.write('first');entered.resolve();release.promise.then(()=>res.end('last'));},closeResources:()=>{closed=true;}});
 const base=await listen(l);const response=fetch(base);await entered.promise;const done=l.shutdown();
 await sleep(10);assert.equal(closed,false);assert.equal(l.status().activeRequests,1);
 release.resolve();assert.equal(await (await response).text(),'firstlast');assert.equal((await done).ok,true);assert.equal(closed,true);
});

test('timeout keeps work/resources alive; repeated signals never force completion or erase failure',async()=>{
 const entered=deferred(),release=deferred(),events=[];let closed=false;
 const l=createDrainingHttpServer({timeoutMs:20,onEvent:e=>events.push(e),handler:async(req,res)=>{entered.resolve();await release.promise;res.end('finished');},closeResources:()=>{closed=true;}});
 const target=new EventEmitter();installShutdownSignals(l,target);
 const base=await listen(l);const response=fetch(base);await entered.promise;target.emit('SIGTERM');target.emit('SIGINT');target.emit('SIGTERM');
 await until(()=>l.status().failed);assert.equal(closed,false);assert.equal(l.status().finished,false);assert.equal(events.filter(e=>e.event==='SHUTDOWN_STARTED').length,1);
 release.resolve();assert.equal(await (await response).text(),'finished');assert.equal((await l.completion).ok,false);await sleep(0);assert.equal(target.exitCode,1);assert.equal(closed,true);
});

test('close failure is a fixed event; never exposes raw errors or overwrites an existing failure exit code',async()=>{
 const events=[];const l=createDrainingHttpServer({handler:(q,s)=>s.end(),closeResources:()=>{throw Error('SYNTHETIC_PRIVATE_ERROR');},onEvent:e=>events.push(e)});
 const target=new EventEmitter();target.exitCode=7;installShutdownSignals(l,target);await listen(l);target.emit('SIGTERM');
 assert.equal((await l.completion).ok,false);await sleep(0);assert.equal(target.exitCode,7);assert.ok(!JSON.stringify(events).includes('SYNTHETIC_PRIVATE_ERROR'));
});

test('slow real Schema12 reference upload finishes its bytes and metadata before store closure',async()=>{
 const f=await launch();let upload,response;
 try{
  const s=f.server;await new Promise(r=>s.server.listen(0,'127.0.0.1',r));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=','base64');
  response=new Promise((resolve,reject)=>{
   upload=request({host:'127.0.0.1',port:s.server.address().port,path:'/api/v3/business/references?operationId=SYNTHETIC-SHUTDOWN-UPLOAD',method:'POST',headers:{authorization:'Bearer '+'a'.repeat(40),'content-type':'image/png','content-length':png.length,'x-file-name':'synthetic.png'}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});upload.on('error',reject);upload.write(png.subarray(0,10));
  });
  await until(()=>s.shutdownStatus().activeRequests===1);const done=s.shutdown();assert.equal(s.store.db.prepare('SELECT 1 AS n').get().n,1);
  upload.end(png.subarray(10));const result=await response;assert.equal(result.status,201);assert.equal((await done).ok,true);assert.throws(()=>s.store.db.prepare('SELECT 1'));
  const db=new DatabaseSync(f.filename,{readOnly:true});try{const row=db.prepare('SELECT stored_name,size FROM uploads WHERE operation_id=?').get('SYNTHETIC-SHUTDOWN-UPLOAD');assert.equal(row.size,png.length);assert.deepEqual(readFileSync(join(f.uploads,row.stored_name)),png);}finally{db.close();}
 }finally{upload?.destroy();if(response)await response.catch(()=>{});if(!f.server.shutdownStatus().finished)await f.server.shutdown();f.close();}
});

for(const entry of ['src/server.mjs','src/server-conversation.mjs'])test(`${entry} handles real SIGTERM as a child and exits naturally 0`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'jso-signal-synthetic-'));const portServer=reservePort();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const env={PATH:process.env.PATH,HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:join(root,'synthetic.sqlite'),UPLOAD_ROOT:join(root,'uploads'),KIOSK_SERVICE_CONTEXT:'PROD11_PRODUCTION',ORPHAN_CLEANUP_MODE:'disabled'};
 if(entry.includes('conversation'))Object.assign(env,{JSO_BUSINESS_RUNTIME:'enabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'a'.repeat(40),subjectId:'synthetic-owner',role:'administrator',resourceIds:['SYNTHETIC']}]),JSO_AGENT_IDENTITIES_JSON:JSON.stringify([{token:'b'.repeat(40),subjectId:'synthetic-planner',mode:'planner',resourceIds:['SYNTHETIC']}])});
 const child=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']});let out='',error='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);const exited=once(child,'exit');
 try{
  for(let n=0;n<200&&!out.includes('listening on');n++){assert.equal(child.exitCode,null,error);await sleep(10);}assert.ok(out.includes('listening on'),error);
  child.kill('SIGTERM');const result=await Promise.race([exited,sleep(5000).then(()=>{throw Error('SIGTERM_DID_NOT_DRAIN');})]);assert.deepEqual(result,[0,null]);
  const events=out.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));assert.ok(events.some(e=>e.event==='SHUTDOWN_COMPLETE'&&e.ok));
 }finally{if(child.exitCode===null){child.kill('SIGKILL');await exited;}rmSync(root,{recursive:true,force:true});}
});
