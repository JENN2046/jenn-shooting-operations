import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createGreenfieldDomain} from '../scripts/create-greenfield-domain.mjs';
import {coreFixture} from './support/greenfield-core-fixture.mjs';

test('schema-only creation is exclusive and leaves existing contents unchanged',()=>{
 const root=join(tmpdir(),'jso-empty-maintenance-'+randomUUID());
 try{const r=createGreenfieldDomain({root,synthetic:true});const bytes=readFileSync(r.filename);const db=new DatabaseSync(r.filename,{readOnly:true});assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get().v,11);assert.equal(db.prepare('SELECT count(*) n FROM revision_counters').get().n,0);assert.equal(db.prepare('SELECT revision FROM schedule_state').get().revision,0);db.close();writeFileSync(join(root,'keep.txt'),'synthetic existing material');assert.throws(()=>createGreenfieldDomain({root,synthetic:true}),/EEXIST/);assert.deepEqual(readFileSync(r.filename),bytes);assert.equal(readFileSync(join(root,'keep.txt'),'utf8'),'synthetic existing material');}finally{rmSync(root,{recursive:true,force:true});}
});

test('new domain → existing initializer → fresh synthetic binding → PREPARED → ACTIVE configuration → independent restart',async(t)=>{
 const f=await coreFixture({initialized:false});
 try{
 assert.throws(()=>f.server(),/INITIALIZATION_REQUIRED/);
 const init=f.initialize();assert.equal(init.ok,true,JSON.stringify(init));
 f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();
 const prepared=f.server();assert.equal(prepared.store.readOnly,true);prepared.store.close();
 f.activate();const server=f.server('enabled');
 const {createHttpApp}=await import(pathToFileURL(join(f.app,'src/http-app.mjs')));
 const {createSchedulingV2Application}=await import(pathToFileURL(join(f.app,'src/server.mjs')));
 const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')));
 const {normalizeSchedulingConfig}=await import(pathToFileURL(join(f.app,'src/scheduling-admin-contract-v2.mjs')));
 const scheduling=createSchedulingV2Application({store:server.store,authenticate:createBusinessRuntimeOptionsFromEnv(process.env).schedulingAuthenticate,clock:()=>new Date('2026-10-11T00:00:00.000Z')});
 const app=createHttpApp({store:server.store,scheduling});
 async function call(path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=body?'POST':'GET';req.headers={authorization:'Bearer '+'a'.repeat(40)};let status,result;await app(req,{setHeader(){},writeHead(s){status=s;},end(b){result=JSON.parse(b);}});assert.equal(status,200,JSON.stringify(result));return result;}
 try{
 const state=await call('/api/v2/business/state');const config=state.initialConfig;config.resourceCalendars[0].rules[0].effectiveFrom='2026-10-12';
 assert.deepEqual(config.durationFallbackRules,[]);assert.equal(config.resourceCalendars[0].rules[0].alternatingSaturday,null);assert.equal(config.resourceCalendars[0].rules[0].weeklyWindows.length,12);assert.equal(config.bufferRules[0].bufferAfterMinutes,20);
 await call('/api/v2/business/resources',{operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:state.initialResource});
 const n=normalizeSchedulingConfig(config);assert.equal(n.ok,true);await call('/api/v2/business/config/preview',{configJson:n.config,expectedProjectionRevision:1,baseConfigDigest:null});
 await call('/api/v2/business/config/publish',{operationId:'PUB',configVersion:'FORMAL-TEST',algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v2',estimatePolicyVersion:'estimate-policy-v1',configJson:n.config,configDigest:n.configDigest});
 await call('/api/v2/business/config/activate',{operationId:'ACT',configVersion:'FORMAL-TEST',expectedProjectionRevision:1});
 assert.equal((await call('/api/v2/business/state')).configs[0].active,true);
 // Explicit regression evidence of the separate, pre-existing submission gap.
 const submitted=server.store.submitRequest({role:'submitter',submission:{schemaVersion:1,operationId:'SYNTHETIC-NEW-REQUEST',productionType:'平面',sku:'SYNTHETIC',name:'Synthetic product main image',kind:'细节',shootingSubtype:'细节',aspectRatio:'1:1',deliver:'Synthetic product 3D main image',requestedBy:'synthetic'}});
 assert.equal(submitted.status,201);t.diagnostic('Observed canonical request count after legacy submission: '+server.store.db.prepare('SELECT count(*) n FROM requests_v2').get().n+'; new-order end-to-end is NOT established by this test.');
 }finally{server.store.close();}
 const code=`import {ScheduleStore} from ${JSON.stringify(pathToFileURL(join(f.app,'src/store.mjs')).href)};const s=new ScheduleStore({filename:${JSON.stringify(f.filename)},uploadRoot:${JSON.stringify(f.uploads)},orphanCleanupMode:'disabled'});if(s.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version!=='FORMAL-TEST')throw new Error('CONFIG_LOST');s.close();`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 }finally{f.close();}
});
