import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixture,resourceId} from './support/business-http-fixture.mjs';
import {createBrowserSessionOptionsFromEnv} from '../src/browser-session-v1.mjs';
import {createHttpApp} from '../src/http-app.mjs';
import {createSchedulingV2Application} from '../src/server.mjs';
import {createBusinessRuntimeOptionsFromEnv} from '../src/business-runtime-auth-v1.mjs';
test('legacy Cookie writes use the same Origin/CSRF and post-body guard; Bearer remains usable',async()=>{
 const f=fixture();try{
 const origin='https://app.synthetic.example',env={JSO_BROWSER_SESSION_RUNTIME:'enabled',JSO_BROWSER_ORIGIN:origin,JSO_BUSINESS_RUNTIME:'enabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'a'.repeat(40),subjectId:'Jenn',role:'administrator',resourceIds:[resourceId]}])};
 const runtime=createBrowserSessionOptionsFromEnv(env).browserSessionRuntime,bearer=createBusinessRuntimeOptionsFromEnv(env).schedulingAuthenticate;
 const scheduling=createSchedulingV2Application({store:f.store,authenticate:q=>runtime.hasCookie(q)?runtime.authenticate(q):bearer(q),clock:()=>new Date('2026-10-01T00:00:00.000Z')}),app=createHttpApp({store:f.store,scheduling,browserSessionRuntime:runtime});
 const call=async(path,body,headers)=>{const q=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);q.url=path;q.method=body?'POST':'GET';q.headers=headers;let status,out,cookie;await app(q,{setHeader(){},writeHead(s,h){status=s;cookie=h?.['set-cookie'];},end(b){out=JSON.parse(b);}});return {status,body:out,cookie};};
 const login=await call('/api/v3/session/login',{token:'a'.repeat(40),deviceId:'BROWSER-SYNTHETIC-CSRF'},{origin,'content-type':'application/json'});assert.equal(login.status,200);const cookie=login.cookie.split(';')[0],csrf=login.body.csrfToken;
 const command={operationId:'SYNTHETIC-ORIGIN-REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:(await f.state()).body.initialResource};
 for(const path of ['/api/v2/business/resources','/api/v2/proposals/SYNTHETIC-PROPOSAL/decisions']){
  assert.equal((await call(path,command,{cookie,origin:'https://evil.synthetic.example','content-type':'text/plain','sec-fetch-site':'same-site'})).status,403);
  assert.equal((await call(path,command,{cookie,origin,'content-type':'application/json'})).status,403);
 }
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM scheduling_resources').get().n,0);
 assert.equal((await call('/api/v2/business/state',undefined,{authorization:'Bearer '+'a'.repeat(40)})).status,200);
 assert.equal((await call('/api/v2/business/resources',command,{cookie,origin,'content-type':'application/json','x-jso-csrf':csrf})).status,200);
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r),q=Readable.from((async function*(){yield Buffer.from(JSON.stringify(command));entered();await gate;})());q.method='POST';q.url='/api/v2/business/resources';q.headers={cookie,origin,'content-type':'application/json','x-jso-csrf':csrf};let status;
 const pending=app(q,{setHeader(){},writeHead(s){status=s;},end(){}});await ready;runtime.revokeSubject('Jenn');release();await pending;assert.equal(status,401);assert.equal(f.store.db.prepare('SELECT count(*) n FROM scheduling_resources').get().n,1);
 }finally{f.close();}
});
