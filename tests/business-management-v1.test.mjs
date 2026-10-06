import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ScheduleStore } from '../src/store.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { createSchedulingV2Application } from '../src/server.mjs';
import { createHttpApp } from '../src/http-app.mjs';
import { createBusinessRuntimeAuthV1,createBusinessRuntimeOptionsFromEnv } from '../src/business-runtime-auth-v1.mjs';
import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { normalizeSchedulingConfig } from '../src/scheduling-admin-contract-v2.mjs';
const tokens={admin:'a'.repeat(40),scheduler:'s'.repeat(40),other:'o'.repeat(40)};
const resourceId='JSO-BIZ-RESOURCE-001';
function fixture({disabled=false}={}){
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
 return {store,scheduling,call,state,setup,publish,setTime:t=>time=t,close:()=>{store.close();rmSync(root,{recursive:true,force:true});}};
}
test('business auth is explicit, server trusted, unique-token and resource scoped',()=>{
 assert.deepEqual(createBusinessRuntimeOptionsFromEnv({}),{});
 assert.throws(()=>createBusinessRuntimeOptionsFromEnv({JSO_BUSINESS_RUNTIME:'enabled'}));
 assert.throws(()=>createBusinessRuntimeAuthV1({identities:[{token:'short',subjectId:'Jenn',role:'administrator',resourceIds:[resourceId]}]}));
 const a=createBusinessRuntimeAuthV1({identities:[{token:tokens.admin,subjectId:'Jenn',role:'administrator',resourceIds:[resourceId]}]});
 assert.equal(a({headers:{authorization:`Bearer ${tokens.admin}`},role:'viewer'}).role,'administrator');assert.equal(a({headers:{authorization:'Bearer invalid'},role:'administrator'}),null);
});
test('business HTTP fails closed on pre-cutover schema10 without migrating it',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jso-business-precutover-')),filename=join(root,'db.sqlite');
 const store=new ScheduleStore({filename,writeAdmissionMode:'disabled',orphanCleanupMode:'disabled'});
 try{
  const authenticate=createBusinessRuntimeAuthV1({identities:[{token:tokens.admin,subjectId:'Jenn',role:'administrator',resourceIds:[resourceId]}]});
  const scheduling=createSchedulingV2Application({store,authenticate,clock:()=>new Date('2026-10-01T00:00:00.000Z')});
  const app=createHttpApp({store,scheduling});
  const request=Readable.from([]);request.method='GET';request.url='/api/v2/business/state';request.headers={authorization:`Bearer ${tokens.admin}`};let status,text;
  await app(request,{setHeader(){},writeHead(s){status=s;},end(t){text=t;}});
  assert.equal(status,503);assert.equal(JSON.parse(text).code,'BUSINESS_SCHEMA11_REQUIRED');
 }finally{store.close();}
 const db=new DatabaseSync(filename,{readOnly:true});
 try{assert.equal(db.prepare('SELECT max(version) version FROM schema_migrations').get().version,10);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='schedule_reschedule_operations'").get().n,0);}finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('HTTP registers, publishes, activates recurrence and reconciles operations without duplicate revisions',async()=>{
 const f=fixture();try{await f.setup();const s=(await f.state()).body;assert.deepEqual(s.revisions,{scheduleRevision:1,projectionRevision:2});assert.equal(s.configs[0].configJson.schemaVersion,2);assert.equal(s.configs[0].active,true);assert.equal(s.configs[0].everActive,true);
 const read=await f.call('/api/v2/business/operations/ACT1');assert.equal(read.status,200);assert.equal(read.body.receipt.configVersion,'C1');
 const replay=await f.call('/api/v2/business/config/activate',{operationId:'ACT1',configVersion:'C1',expectedProjectionRevision:1});assert.equal(replay.body.exactReplay,true);assert.deepEqual((await f.state()).body.revisions,s.revisions);
 }finally{f.close();}
});
test('anonymous, self-reported role, scheduler admin attempts and cross-resource operations are rejected',async()=>{
 const f=fixture();try{const first=(await f.state()).body;const cmd={operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:first.initialResource};
 assert.equal((await f.call('/api/v2/business/state',undefined,'wrong')).status,401);
 assert.equal((await f.call('/api/v2/business/resources',{...cmd,role:'administrator'},tokens.scheduler)).status,403);
 assert.equal((await f.call('/api/v2/business/resources',cmd,tokens.other)).status,403);
 assert.equal((await f.call('/api/v2/business/state?role=administrator')).status,400);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM scheduling_resources').get().n,0);
 }finally{f.close();}
});
test('disabled admission prevents direct management and HTTP mutations, reads still authenticate',async()=>{
 const f=fixture({disabled:true});try{assert.equal((await f.state()).status,200);const result=await f.call('/api/v2/business/resources',{role:'administrator'});assert.equal(result.status,503);
 assert.equal(f.scheduling.manage({kind:'publishConfig',command:{},principal:createTrustedPrincipal({subjectId:'Jenn',role:'administrator',resourceIds:[resourceId]}).principal}).code,'WRITE_ADMISSION_DISABLED');
 }finally{f.close();}
});
function insertSession(db){db.prepare(`INSERT INTO schedule_items(id,source_ordinal,resource_id,resource_resolution_status,resource_mapping_version,planned_start,planned_end,buffer_after_minutes,buffer_source,schedule_status,schedule_status_provenance,lock_status,lock_status_provenance,note,allocation_mode,source,business_created_at,business_updated_at,imported_at)
 VALUES('ITEM',0,?,'resolved','resource-catalog-v1','2026-10-02T01:00:00.000Z','2026-10-02T02:00:00.000Z',10,'C1','confirmed','domain_command','unlocked','domain_command','','single','human','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`).run(resourceId);}
test('preview and activation both block conflicting calendar; published version remains immutable and inactive',async()=>{
 const f=fixture();try{const c=await f.setup();insertSession(f.store.db);c.resourceCalendars[0].dateOverrides=[{date:'2026-10-02',status:'closed',windows:[]}];
 const preview=await f.call('/api/v2/business/config/preview',{configJson:c});assert.equal(preview.body.impact.code,'CALENDAR_HAS_CONFLICTS');assert.equal(preview.body.impact.conflicts[0].scheduleItemId,'ITEM');
 await f.publish(c,'C2');const result=await f.call('/api/v2/business/config/activate',{operationId:'ACT2',configVersion:'C2',expectedProjectionRevision:2});assert.equal(result.status,409);assert.equal(result.body.code,'CALENDAR_HAS_CONFLICTS');
 const s=(await f.state()).body;assert.equal(s.configs.find(c=>c.active).configVersion,'C1');assert.equal(s.configs.find(c=>c.configVersion==='C2').everActive,false);assert.equal(s.revisions.projectionRevision,2);
 }finally{f.close();}
});
test('activation checks freshly inserted occupancy after a clear preview',async()=>{
 const f=fixture();try{const c=await f.setup();c.resourceCalendars[0].dateOverrides=[{date:'2026-10-02',status:'closed',windows:[]}];assert.equal((await f.call('/api/v2/business/config/preview',{configJson:c})).body.impact.ok,true);await f.publish(c,'C2');insertSession(f.store.db);assert.equal((await f.call('/api/v2/business/config/activate',{operationId:'ACT2',configVersion:'C2',expectedProjectionRevision:2})).body.code,'CALENDAR_HAS_CONFLICTS');}finally{f.close();}
});
test('history rules cannot be replaced; future effective rule is allowed',async()=>{
 const f=fixture();try{const c=await f.setup();f.setTime('2026-10-02T00:00:00.000Z');const wrong=structuredClone(c);wrong.resourceCalendars[0].rules[0].weeklyWindows[0].start='10:00';assert.equal((await f.call('/api/v2/business/config/preview',{configJson:wrong})).body.impact.code,'PAST_CALENDAR_CHANGE_FORBIDDEN');
 c.resourceCalendars[0].rules.push({...structuredClone(c.resourceCalendars[0].rules[0]),effectiveFrom:'2026-10-10'});assert.equal((await f.call('/api/v2/business/config/preview',{configJson:c})).body.impact.ok,true);
 }finally{f.close();}
});
test('proposal generation and read are connected, scoped, and recoverable by original operation ID',async()=>{
 const f=fixture();try{await f.setup();const p=await f.call('/api/v2/business/proposals',{operationId:'GEN1',planningWindowStart:'2026-10-10T00:00:00.000Z',planningWindowEnd:'2026-10-11T00:00:00.000Z',resourceScope:[resourceId]},tokens.scheduler);assert.equal(p.status,200,JSON.stringify(p));
 assert.equal((await f.call(`/api/v2/business/proposals/${p.body.proposal.proposalId}`,undefined,tokens.other)).status,403);
 assert.equal((await f.call('/api/v2/business/operations/GEN1')).body.proposal.proposalId,p.body.proposal.proposalId);
 }finally{f.close();}
});

test('stale editor cannot silently rebase onto another calendar activation',async()=>{
 const f=fixture();try{const c=await f.setup();const initial=(await f.state()).body;const binding={expectedProjectionRevision:2,baseConfigDigest:initial.configs[0].configDigest};
 const a=structuredClone(c);a.resourceCalendars[0].rules.push({...structuredClone(a.resourceCalendars[0].rules[0]),effectiveFrom:'2026-10-10'});await f.publish(a,'A');assert.equal((await f.call('/api/v2/business/config/activate',{operationId:'ACT-A',configVersion:'A',expectedProjectionRevision:2})).status,200);
 const b=structuredClone(c);b.resourceCalendars[0].rules.push({...structuredClone(b.resourceCalendars[0].rules[0]),effectiveFrom:'2026-11-01'});
 const preview=await f.call('/api/v2/business/config/preview',{configJson:b,...binding});assert.equal(preview.status,409);assert.equal(preview.body.code,'SCHEDULING_REVISION_CONFLICT');
 await f.publish(b,'B');const apply=await f.call('/api/v2/business/config/activate',{operationId:'ACT-B',configVersion:'B',expectedProjectionRevision:binding.expectedProjectionRevision});assert.equal(apply.status,409);assert.equal((await f.state()).body.configs.find(c=>c.active).configVersion,'A');
 }finally{f.close();}
});
