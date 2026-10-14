import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';
const tool=new URL('../examples/vcp-vchart/native-tool.mjs',import.meta.url);
test('native stdin preserves every Chinese byte split and enforces raw byte size',async t=>{
 let received,calls=0;const server=createServer(async(q,r)=>{const chunks=[];for await(const c of q)chunks.push(c);received=JSON.parse(Buffer.concat(chunks));calls++;r.end('{"ok":true}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const env={JSO_LOCAL_AGENT_ENDPOINT:`http://127.0.0.1:${server.address().port}/api/v2/agent/tools`,JSO_LOCAL_AGENT_TOKEN:'synthetic'.padEnd(40,'x')};
 const run=(raw,split)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[tool.pathname],{env,stdio:['pipe','pipe','pipe']});let out='';c.stdout.on('data',b=>out+=b);c.stdin.on('error',()=>{});c.on('error',reject);c.on('close',()=>resolve(JSON.parse(out)));if(split){c.stdin.write(raw.subarray(0,split));setTimeout(()=>c.stdin.end(raw.subarray(split)),50);}else c.stdin.end(raw);});
 const args={command:'read_state',payload_json:JSON.stringify({resourceScope:['摄影棚']})},raw=Buffer.from(JSON.stringify(args)),start=raw.indexOf(Buffer.from('摄'));
 for(let split=start+1;split<start+9;split++){assert.equal((await run(raw,split)).status,'success');assert.deepEqual(received,args);}
 const envelopeLimit=Buffer.concat([raw,Buffer.alloc(266240-raw.length,32)]);assert.equal((await run(envelopeLimit)).status,'success');const before=calls;
 const atLimit=Buffer.concat([raw,Buffer.alloc(270336-raw.length,32)]);assert.equal((await run(atLimit)).status,'error'); // Existing parser has a tighter envelope limit.
 assert.equal((await run(Buffer.concat([atLimit,Buffer.from(' ')]))).status,'error');assert.equal((await run(Buffer.from('中'.repeat(90113)))).status,'error');assert.equal(calls,before);
});
