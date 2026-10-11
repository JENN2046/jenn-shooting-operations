import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ScheduleStore } from '../../src/store.mjs';
import { initializeWritableSchema } from '../../src/sqlite-schema-v2.mjs';
import { createSchedulingV2Application } from '../../src/server.mjs';
import { createHttpApp } from '../../src/http-app.mjs';
import { createBusinessRuntimeAuthV1,createBusinessRuntimeOptionsFromEnv } from '../../src/business-runtime-auth-v1.mjs';
import { createTrustedPrincipal } from '../../src/authorization-v2.mjs';
import { normalizeSchedulingConfig } from '../../src/scheduling-admin-contract-v2.mjs';
export const tokens={admin:'a'.repeat(40),scheduler:'s'.repeat(40),other:'o'.repeat(40)};
export const resourceId='JSO-BIZ-RESOURCE-001';
export function fixture({disabled=false}={}){
 const root=mkdtempSync(join(tmpdir(),'jso-business-management-')),filename=join(root,'db.sqlite'),uploadRoot=join(root,'uploads');
 mkdirSync(uploadRoot);
 const bootstrap=new DatabaseSync(filename);bootstrap.exec('PRAGMA foreign_keys=ON');initializeWritableSchema(bootstrap);bootstrap.close();
 const store=new ScheduleStore({filename,uploadRoot,writeAdmissionMode:disabled?'disabled':'enabled',orphanCleanupMode:'disabled'});
 if(!disabled)store.db.prepare('INSERT INTO revision_counters VALUES(1,0,0,?)').run('2026-10-01T00:00:00.000Z');
 const authenticate=createBusinessRuntimeAuthV1({identities:[{token:tokens.admin,subjectId:'Jenn',role:'administrator',resourceIds:[resourceId]},{token:tokens.scheduler,subjectId:'scheduler',role:'scheduler',resourceIds:[resourceId]},{token:tokens.other,subjectId:'other',role:'administrator',resourceIds:['OTHER']}]});
 let time='2026-10-01T00:00:00.000Z';
 const scheduling=createSchedulingV2Application({store,authenticate,clock:()=>new Date(time)});
 const app=createHttpApp({store,scheduling});
 async function call(path,body,token=tokens.admin){
 if(path==='/api/v2/business/config/preview' && body && !Object.hasOwn(body,'expectedProjectionRevision'))body={...body,expectedProjectionRevision:store.db.prepare('SELECT projection_revision FROM revision_counters WHERE id=1').get()?.projection_revision,baseConfigDigest:store.db.prepare('SELECT v.config_digest FROM scheduling_active_config a JOIN scheduling_config_versions v ON a.config_version=v.config_version').get()?.config_digest??null};
 const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);request.method=body?'POST':'GET';request.url=path;request.headers={authorization:`Bearer ${token}`};let status,text;await app(request,{setHeader(){},writeHead(s){status=s;},end(t){text=t;}});return {status,body:JSON.parse(text)};}
 const state=()=>call('/api/v2/business/state');
 async function setup(){const first=(await state()).body;const registered=await call('/api/v2/business/resources',{operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:first.initialResource});assert.equal(registered.status,200,JSON.stringify(registered));await publish(first.initialConfig,'C1');const a=await call('/api/v2/business/config/activate',{operationId:'ACT1',configVersion:'C1',expectedProjectionRevision:1});assert.equal(a.status,200,JSON.stringify(a));return first.initialConfig;}
 async function publish(config,version){const n=normalizeSchedulingConfig(config);assert.equal(n.ok,true,JSON.stringify(n));const p=await call('/api/v2/business/config/publish',{operationId:`PUB-${version}`,configVersion:version,algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:config.schemaVersion===2?'calendar-compiler-v2':'calendar-compiler-v1',estimatePolicyVersion:'estimate-policy-v1',configJson:n.config,configDigest:n.configDigest});assert.equal(p.status,200,JSON.stringify(p));return p;}
 let closed=false;const closeStore=()=>{if(!closed){store.close();closed=true;}};
 return {root,filename,uploadRoot,store,scheduling,closeStore,call,state,setup,publish,setTime:t=>time=t,close:()=>{closeStore();rmSync(root,{recursive:true,force:true});}};
}
