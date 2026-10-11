import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, symlinkSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { ScheduleStore } from '../src/store.mjs';
import { maintenanceFixture } from './support/empty-db-maintenance-fixture.mjs';

// Local fixture-only application copy. Production has no custody/uid override.
async function fixture({ initialized = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jso-core-synthetic-'));
  const maintenance = maintenanceFixture(undefined, { schemaVersion: 11 });
  const app = join(root,'app'), custody = join(root,'custody');
  const filename = join(maintenance.root,'synthetic.sqlite'), uploads=join(maintenance.root,'uploads');
  mkdirSync(app); mkdirSync(custody,{mode:0o700});
  cpSync(new URL('../src',import.meta.url),join(app,'src'),{recursive:true});
  cpSync(new URL('../contracts',import.meta.url),join(app,'contracts'),{recursive:true});
  cpSync(new URL('../public',import.meta.url),join(app,'public'),{recursive:true});
  cpSync(new URL('../docs',import.meta.url),join(app,'docs'),{recursive:true});
  symlinkSync(new URL('../node_modules',import.meta.url).pathname,join(app,'node_modules'));
  const modulePath=join(app,'src/g3-core-startup-acceptance.mjs');
  writeFileSync(modulePath,readFileSync(modulePath,'utf8')
    .replace("const CUSTODY = '/etc/jso/core-acceptance';",`const CUSTODY = ${JSON.stringify(custody)};`)
    .replace('const TRUSTED_UID = 0;',`const TRUSTED_UID = ${process.getuid()};`)
    .replace('if (p === dirname(p)) break;',`if (p === ${JSON.stringify(root)}) break;`));
  if (initialized) maintenance.execute();
  const quiescent=new DatabaseSync(filename);quiescent.exec('PRAGMA journal_mode=DELETE');quiescent.close();
  const env={KIOSK_SERVICE_CONTEXT:'PROD11_PRODUCTION',JSO_BUSINESS_RUNTIME:'enabled',ORPHAN_CLEANUP_MODE:'disabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'a'.repeat(40),subjectId:'test-admin',role:'administrator',resourceIds:['JSO-BIZ-RESOURCE-001']}]),UPLOAD_ROOT:uploads};
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  const m=await import(pathToFileURL(modulePath)); const st=statSync(filename), now=Date.now(), h='a'.repeat(64);
  const record={version:3,purpose:'CORE_SCHEMA11_PROSPECTIVE_ACCEPTANCE',acceptanceId:'SYNTHETIC-ONLY',state:'PREPARED',ownerSource:'SYNTHETIC TEST FIXTURE - NOT OWNER APPROVAL',ownerApprovedAt:new Date(now-1000).toISOString(),ownerTextSha256:m.digest('SYNTHETIC ONLY\n'),planSha256:h,release:{head:'a'.repeat(40),tree:'b'.repeat(40),imageDigest:'sha256:'+h,sourceSha256:m.sourceDigest()},target:{hostId:'synthetic-host',service:'synthetic-core',volumeName:'synthetic-volume',volumeSource:root,mountPoint:root,databasePath:filename,databaseIdentity:{device:st.dev,inode:st.ino},uploadRoot:uploads,uploadIdentity:{device:statSync(uploads).dev,inode:statSync(uploads).ino}},baseline:{schemaVersion:11,sha256:m.digest(readFileSync(filename)),sideFiles:'ABSENT_UNDER_EXCLUSIVE_MAINTENANCE',historicalEvidenceSha256:h,backupManifestSha256:h,restoreVerificationSha256:h},policy:{adminTrustAccepted:true,historicalCoverageRiskAccepted:true,sameTargetRestartAllowed:true,cleanup:'disabled',integrations:'disabled',runtimeConfigSha256:m.runtimeConfigDigest()},window:{start:new Date(now-10000).toISOString(),end:new Date(now+600000).toISOString()},activation:null};
  function install(){const {state,activation,...scope}=record; const json=(n,v)=>writeFileSync(join(custody,n),m.canonical(v)+'\n',{mode:0o644});json('acceptance.json',record);json('owner-approval.json',{acceptanceScopeSha256:m.digest(m.canonical(scope)),ownerSource:record.ownerSource,ownerApprovedAt:record.ownerApprovedAt,ownerTextSha256:record.ownerTextSha256});writeFileSync(join(custody,'owner-approval.txt'),'SYNTHETIC ONLY\n',{mode:0o644});json('installation.json',{acceptanceSha256:m.digest(m.canonical(record)+'\n'),release:record.release,target:record.target,runtimeConfigSha256:record.policy.runtimeConfigSha256,installedBy:'synthetic-fixture'});}
  function activate(){record.state='ACTIVE';const {state,activation,...scope}=record;const checkedAt=new Date().toISOString();const initial={acceptanceScopeSha256:m.digest(m.canonical(scope)),baselineSha256:record.baseline.sha256,checkedAt,schemaVersion:11,integrityOk:true,foreignKeyViolations:0,backupRestoreVerified:true,exclusiveMaintenance:true,initialized:true};const raw=m.canonical(initial)+'\n';writeFileSync(join(custody,'initial-verification.json'),raw,{mode:0o644});record.activation={acceptedAt:checkedAt,installedBy:'synthetic-fixture',initialVerificationSha256:m.digest(raw)};install();}
  const evidence='SYNTHETIC EVIDENCE ONLY\n';
  record.planSha256=record.baseline.historicalEvidenceSha256=record.baseline.backupManifestSha256=record.baseline.restoreVerificationSha256=m.digest(evidence);
  for(const name of ['plan.txt','historical-evidence.json','backup-manifest.json','restore-verification.json'])writeFileSync(join(custody,name),evidence,{mode:0o644});
  install();
  const api=await import(pathToFileURL(join(app,'src/server.mjs')));
  function server(mode='disabled'){return api.createOperationsServer({databasePath:filename,uploadRoot:uploads,orphanCleanupMode:'disabled',writeAdmissionMode:mode,cleanupIntervalMs:0,...api.createKioskRuntimeOptionsFromEnv(process.env),...businessOptions});}
  const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(app,'src/business-runtime-auth-v1.mjs')));const businessOptions=createBusinessRuntimeOptionsFromEnv(process.env);
  return {root,app,custody,filename,uploads,m,record,install,activate,server,initialize:()=>maintenance.execute(),dataRoot:maintenance.root,close(){for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}maintenance.close();rmSync(root,{recursive:true,force:true});}};
}
test('PREPARED uses a truly read-only store, cannot enable writes, and leaves bytes/schema/directories unchanged',async()=>{
 const f=await fixture();try{const before=readFileSync(f.filename),names=readdirSync(f.root),dataNames=readdirSync(f.dataRoot);const s=f.server();try{assert.equal(s.store.readOnly,true);assert.throws(()=>s.orphanCleanupControl.enable({}),/CLEANUP_DISABLED/);assert.deepEqual(s.writeAdmissionControl.enable(),{ok:false,code:'G3_CORE_ACCEPTANCE_PREPARED_READ_ONLY_REQUIRED',mode:'disabled',enabled:false,transitionCount:0});assert.equal(s.writeAdmissionControl.isDisabled(),true);assert.throws(()=>s.store.db.exec('CREATE TABLE forbidden(x)'));}finally{s.store.close();}assert.deepEqual(readFileSync(f.filename),before);assert.deepEqual(readdirSync(f.root),names);assert.deepEqual(readdirSync(f.dataRoot),dataNames);assert.throws(()=>f.server('enabled'),/SERVER_CONFIG/);}finally{f.close();}
});
test('ACTIVE persists business calendar through changed digest and independent-process reopen plus save',async()=>{
 const f=await fixture();try{f.activate();const s=f.server('enabled');assert.throws(()=>s.orphanCleanupControl.enable({}),/CLEANUP_DISABLED/);
 const {Readable}=await import('node:stream');const {createHttpApp}=await import(pathToFileURL(join(f.app,'src/http-app.mjs')));const {createSchedulingV2Application}=await import(pathToFileURL(join(f.app,'src/server.mjs')));const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')));
 const scheduling=createSchedulingV2Application({store:s.store,...createBusinessRuntimeOptionsFromEnv(process.env),authenticate:createBusinessRuntimeOptionsFromEnv(process.env).schedulingAuthenticate,clock:()=>new Date('2026-10-01T00:00:00.000Z')});const app=createHttpApp({store:s.store,scheduling});
 async function call(path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=body?'POST':'GET';req.url=path;req.headers={authorization:'Bearer '+'a'.repeat(40)};let status,result;await app(req,{setHeader(){},writeHead(v){status=v;},end(v){result=JSON.parse(v);}});assert.equal(status,200,JSON.stringify(result));return result;}
 try{const state=await call('/api/v2/business/state');await call('/api/v2/business/resources',{operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:state.initialResource});const {normalizeSchedulingConfig}=await import(pathToFileURL(join(f.app,'src/scheduling-admin-contract-v2.mjs')));const n=normalizeSchedulingConfig(state.initialConfig);await call('/api/v2/business/config/publish',{operationId:'PUB',configVersion:'C1',algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v2',estimatePolicyVersion:'estimate-policy-v1',configJson:n.config,configDigest:n.configDigest});await call('/api/v2/business/config/activate',{operationId:'ACT',configVersion:'C1',expectedProjectionRevision:1});}finally{s.store.close();}
 assert.notEqual(f.m.digest(readFileSync(f.filename)),f.record.baseline.sha256);
 const code=`import {ScheduleStore} from ${JSON.stringify(pathToFileURL(join(f.app,'src/store.mjs')).href)};const s=new ScheduleStore({filename:${JSON.stringify(f.filename)},uploadRoot:${JSON.stringify(f.uploads)},orphanCleanupMode:'disabled'});if(s.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version!=='C1')process.exitCode=1;const saved=s.submitRequest({role:'submitter',submission:{schemaVersion:1,operationId:'core-restart-request-001',productionType:'平面',sku:'RESTART-SYNTHETIC',name:'Restart synthetic request',kind:'细节',shootingSubtype:'细节',aspectRatio:'1:1',deliver:'Synthetic deliverable',requestedBy:'Synthetic user'}});if(saved.status!==201||s.getSnapshot().tasks.length!==1)process.exitCode=1;s.close();`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const reopened=new DatabaseSync(f.filename,{readOnly:true});try{assert.equal(JSON.parse(reopened.prepare('SELECT snapshot_json FROM schedule_state WHERE id=1').get().snapshot_json).tasks.filter(t=>t.sku==='RESTART-SYNTHETIC').length,1);assert.equal(reopened.prepare("SELECT count(*) n FROM operations WHERE operation_id='core-restart-request-001'").get().n,1);assert.ok(reopened.prepare('SELECT projection_revision FROM revision_counters WHERE id=1').get().projection_revision>0);}finally{reopened.close();}
 const again=f.server('enabled');again.store.close();
 }finally{f.close();}
});
test('missing approval, wrong object/version, incomplete activation, damaged records and drift fail closed',async()=>{
 const f=await fixture();try{
 assert.equal(f.m.loadCoreAcceptance(f.filename).prepared,true);
 for(const mutate of [r=>r.version=4,r=>r.state='COMMITTING',r=>r.state='ACTIVE',r=>r.target.databaseIdentity.inode++,r=>r.target.uploadIdentity.inode++,r=>r.target.uploadIdentity.device++,r=>r.target.uploadRoot+='/.' ,r=>delete r.target.uploadIdentity,r=>r.target.databasePath+='.wrong',r=>r.release.sourceSha256='b'.repeat(64),r=>r.policy.runtimeConfigSha256='b'.repeat(64),r=>r.window.end=r.window.start]){const original=structuredClone(f.record);mutate(f.record);f.install();assert.throws(()=>f.m.loadCoreAcceptance(f.filename));Object.keys(f.record).forEach(k=>delete f.record[k]);Object.assign(f.record,original);}
 f.install();rmSync(join(f.custody,'owner-approval.json'));assert.throws(()=>f.m.loadCoreAcceptance(f.filename));f.install();writeFileSync(join(f.custody,'acceptance.json'),'{');assert.throws(()=>f.m.loadCoreAcceptance(f.filename));
 }finally{f.close();}
});

test('an incomplete ACTIVE installation cannot authorize a writable store', async () => {
 const f=await fixture();
 try {
  f.activate();assert.equal(f.m.loadCoreAcceptance(f.filename).prepared,false);
  rmSync(join(f.custody,'initial-verification.json'));
  assert.throws(()=>f.server('enabled'));
  f.activate();
  const installed=readFileSync(join(f.custody,'installation.json'));
  f.record.activation.installedBy='different-installer';
  writeFileSync(join(f.custody,'acceptance.json'),f.m.canonical(f.record)+'\n');
  assert.throws(()=>f.server('enabled'),/INSTALLATION_BINDING/);
  assert.deepEqual(readFileSync(join(f.custody,'installation.json')),installed);
 } finally { f.close(); }
});

test('schema10 and missing initialization reject without automatic schema repair', async () => {
 const f=await fixture();
 try {
  const db=new DatabaseSync(f.filename);db.exec('DELETE FROM revision_counters');db.close();
  f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();
  const before=readFileSync(f.filename);
  assert.throws(()=>f.server(),/INITIALIZATION_REQUIRED/);
  assert.deepEqual(readFileSync(f.filename),before);
  const old=join(f.root,'schema10.sqlite');
  const store=new ScheduleStore({filename:old,orphanCleanupMode:'disabled'});store.close();
  const oldDb=new DatabaseSync(old);oldDb.exec('PRAGMA journal_mode=DELETE');oldDb.close();
  const st=statSync(old);f.record.target.databasePath=old;f.record.target.databaseIdentity={device:st.dev,inode:st.ino};
  f.record.baseline.sha256=f.m.digest(readFileSync(old));f.install();
  const oldBytes=readFileSync(old);
  assert.throws(()=>f.m.loadCoreAcceptance(old),/SCHEMA11/);
  assert.deepEqual(readFileSync(old),oldBytes);
 } finally { f.close(); }
});

test('expired first window denies PREPARED but a completed ACTIVE permits later same-target restart', async () => {
 const f=await fixture();
 try {
  const future=Date.parse(f.record.window.end)+1000;
  assert.throws(()=>f.m.validateCoreRecord(f.record,{now:future}),/PREPARED_WINDOW/);
  f.activate();assert.equal(f.m.validateCoreRecord(f.record,{now:future}).state,'ACTIVE');
 } finally { f.close(); }
});


test('ACTIVE ordinary submission and explicit recovery never inspect the cleanup staging area', async () => {
 const f=await fixture();
 try {
  f.activate();const s=f.server('enabled');
  try {
   Object.defineProperty(s.store,'cleanupRoot',{get(){throw new Error('cleanup staging must remain untouched');}});
   for (const allowDelete of [false,true]) {
    const result=s.store.recoverStagedUploadCleanup({allowDelete});
    assert.equal(result.skipped,true);assert.equal(result.code,'G3_CORE_ACCEPTANCE_CLEANUP_DISABLED');
    assert.equal(result.restored,0);assert.equal(result.removed,0);
   }
   const result=s.store.submitRequest({role:'submitter',submission:{schemaVersion:1,
    operationId:'core-normal-request-001',productionType:'平面',sku:'SYNTHETIC-SKU',name:'Synthetic request',
    kind:'细节',shootingSubtype:'细节',aspectRatio:'1:1',deliver:'Synthetic deliverable',requestedBy:'Synthetic user'}});
   assert.equal(result.status,201,JSON.stringify(result));
  } finally { s.store.close(); }
 } finally { f.close(); }
});


test('supported Schema11 initialization breaks the bootstrap cycle only after a newly bound acceptance', async () => {
 const f=await fixture({initialized:false});
 try {
  const before=readFileSync(f.filename);
  assert.throws(()=>f.server(),/INITIALIZATION_REQUIRED/);
  assert.deepEqual(readFileSync(f.filename),before);
  const initialized=f.initialize();assert.equal(initialized.ok,true);assert.equal(initialized.exactReplay,false);
  assert.throws(()=>f.server(),/BASELINE_DIGEST/);
  f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();
  const prepared=f.server();assert.equal(prepared.store.readOnly,true);prepared.store.close();
  f.activate();const active=f.server('enabled');
  try {assert.equal(active.store.readOnly,false);assert.equal(active.store.db.prepare('SELECT count(*) n FROM empty_db_initialization').get().n,1);}finally{active.store.close();}
 }finally{f.close();}
});


test('incomplete initialization evidence refuses startup without changing database bytes', async () => {
 for (const sql of [
  "DELETE FROM audit_log WHERE action='emptyDbMaintenanceV1'",
  "UPDATE audit_log SET result='incomplete synthetic receipt' WHERE action='emptyDbMaintenanceV1'",
  "DELETE FROM snapshot_projections WHERE projection_name='schedule-v2'",
  "UPDATE snapshot_projections SET revision=revision+1 WHERE projection_name='schedule-v2'",
  "UPDATE snapshot_projections SET payload_json=json_set(payload_json,'$.projectionRevision',9) WHERE projection_name='schedule-v2'",
 ]) {
  const f=await fixture();try {
   const db=new DatabaseSync(f.filename);db.exec(sql);db.close();
   f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();
   const before=readFileSync(f.filename);
   assert.throws(()=>f.server(),/INITIALIZATION_(AUDIT|PROJECTIONS)/);
   f.activate();assert.throws(()=>f.server('enabled'),/INITIALIZATION_(AUDIT|PROJECTIONS)/);
   assert.deepEqual(readFileSync(f.filename),before);
  }finally{f.close();}
 }
});

test('PREPARED direct entrypoint refuses an operational enable signal and remains responsive and read-only', {timeout:15000}, async () => {
 const f=await fixture();let child;
 try {
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:f.filename,WRITE_ADMISSION_MODE:'disabled'};
  f.record.policy.runtimeConfigSha256=f.m.runtimeConfigDigest(env);f.install();
  const before=readFileSync(f.filename), names=readdirSync(f.dataRoot);
  child=spawn(process.execPath,[join(f.app,'src/server.mjs')],{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  async function until(text){
   const end=Date.now()+5000;
   while(!stdout.includes(text)){
    assert.equal(child.exitCode,null,stderr);assert.equal(child.signalCode,null,stderr);
    assert.ok(Date.now()<end,stdout+'\n'+stderr);await new Promise(r=>setTimeout(r,20));
   }
  }
  await until('listening on');
  const response=await fetch(`http://127.0.0.1:${port}/api/v2/business/state`,{headers:{authorization:'Bearer '+'a'.repeat(40)}});
  assert.equal(response.status,200);await response.text();
  child.kill('SIGUSR2');await until('G3_CORE_ACCEPTANCE_PREPARED_READ_ONLY_REQUIRED');
  const event=stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x)).find(x=>x.event==='G3_CORE_ACCEPTANCE_PREPARED_READ_ONLY_REQUIRED');
  assert.equal(event.writeAdmission,'disabled');assert.equal(event.transitionCount,0);
  const after=await fetch(`http://127.0.0.1:${port}/api/v2/business/state`,{headers:{authorization:'Bearer '+'a'.repeat(40)}});
  assert.equal(after.status,200);await after.text();assert.equal(child.exitCode,null);
  assert.deepEqual(readFileSync(f.filename),before);assert.deepEqual(readdirSync(f.dataRoot),names);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}f.close();}
});

test('read-only initialization snapshot validates immutable receipt semantics and its audit binding', async () => {
 const f=await fixture();try {
  const db=new DatabaseSync(f.filename,{readOnly:true});let state;
  try {state={initial:db.prepare('SELECT * FROM empty_db_initialization WHERE id=1').get(),
   counter:db.prepare('SELECT * FROM revision_counters WHERE id=1').get(),
   audits:db.prepare("SELECT * FROM audit_log WHERE action='emptyDbMaintenanceV1'").all(),
   projections:db.prepare('SELECT * FROM snapshot_projections ORDER BY projection_name').all()};}finally{db.close();}
  assert.doesNotThrow(()=>f.m.validateCoreInitializationSnapshot(state));
  const before=readFileSync(f.filename);
  // Data-only damaged/incomplete read results; never alter immutable database records.
  for (const change of [
   x=>x.initial=undefined,
   x=>x.initial.response_json='{',
   x=>x.initial.response_digest='sha256:'+'0'.repeat(64),
   x=>x.initial.operation_id='different-receipt',
   x=>x.initial.binding_json=JSON.stringify({...JSON.parse(x.initial.binding_json),schemaDigest:'unknown'}),
   x=>x.initial.created_at='2000-01-01T00:00:00.000Z',
   x=>x.audits[0].role='different-actor',
   x=>x.audits.push({...x.audits[0]}),
   x=>x.projections[0].updated_at='2000-01-01T00:00:00.000Z',
  ]) {const damaged=structuredClone(state);change(damaged);assert.throws(()=>f.m.validateCoreInitializationSnapshot(damaged),/INITIALIZATION_/);}
  assert.deepEqual(readFileSync(f.filename),before);
 }finally{f.close();}
});


test('release digest deterministically binds runtime contracts and served public assets', async () => {
 const f=await fixture();try {
  const original=f.m.sourceDigest();assert.equal(original,f.m.sourceDigest());
  for(const file of ['contracts/g3-forward-reconciliation-exception.r3.schema.json','contracts/request-submission.schema.json','public/manage.js','public/manage.css','public/manage.html']) {
   const path=join(f.app,file);const before=readFileSync(path);
   try {writeFileSync(path,Buffer.concat([before,Buffer.from('\n')]));
    assert.notEqual(f.m.sourceDigest(),original);
    assert.throws(()=>f.m.loadCoreAcceptance(f.filename),/CODE_CHANGED/);
    f.activate();assert.throws(()=>f.m.loadCoreAcceptance(f.filename),/CODE_CHANGED/);
   }finally{writeFileSync(path,before);}
   assert.equal(f.m.sourceDigest(),original);
  }
  const added=join(f.app,'public','new-release-file.txt');writeFileSync(added,'ordinary release change');
  assert.notEqual(f.m.sourceDigest(),original);rmSync(added);assert.equal(f.m.sourceDigest(),original);
  const removed=join(f.app,'public','manage.css'), saved=readFileSync(removed);rmSync(removed);
  assert.notEqual(f.m.sourceDigest(),original);writeFileSync(removed,saved);assert.equal(f.m.sourceDigest(),original);
  assert.equal(f.m.loadCoreAcceptance(f.filename).prepared,false);
 }finally{f.close();}
});

test('release digest rejects links and over-limit local release files', async () => {
 const f=await fixture();try {
  const link=join(f.app,'public','linked-file');symlinkSync(join(f.app,'public','manage.js'),link);
  assert.throws(()=>f.m.sourceDigest(),/SOURCE_LINK/);rmSync(link);
  const large=join(f.app,'contracts','oversized-local-fixture');writeFileSync(large,Buffer.alloc(8*1024*1024+1));
  assert.throws(()=>f.m.sourceDigest(),/SOURCE_LIMIT/);rmSync(large);
  let nested=join(f.app,'public');for(let i=0;i<17;i++){nested=join(nested,'nested');mkdirSync(nested);}
  assert.throws(()=>f.m.sourceDigest(),/SOURCE_LIMIT/);rmSync(join(f.app,'public','nested'),{recursive:true});
  assert.equal(f.m.sourceDigest(),f.record.release.sourceSha256);
 }finally{f.close();}
});


test('accepted attachment roots must exist with the approved canonical directory identity before startup writes', async () => {
 for(const state of ['PREPARED','ACTIVE']) for(const replacement of ['missing','directory','symlink','file']) {
  const f=await fixture();try {
   if(state==='ACTIVE')f.activate();
   const before=readFileSync(f.filename), moved=join(f.root,'original-uploads');
   renameSync(f.uploads,moved);
   if(replacement==='directory'){mkdirSync(f.uploads);writeFileSync(join(f.uploads,'sentinel'),'unchanged');}
   if(replacement==='symlink')symlinkSync(moved,f.uploads);
   if(replacement==='file')writeFileSync(f.uploads,'ordinary non-directory fixture');
   assert.throws(()=>f.server(state==='ACTIVE'?'enabled':'disabled'),/UPLOAD_IDENTITY/);
   assert.deepEqual(readFileSync(f.filename),before);
   assert.deepEqual(readdirSync(moved),['.cleanup']);
   if(replacement==='missing')assert.equal(existsSync(f.uploads),false);
   if(replacement==='directory')assert.deepEqual(readdirSync(f.uploads),['sentinel']);
   if(replacement==='file')assert.equal(readFileSync(f.uploads,'utf8'),'ordinary non-directory fixture');
  }finally{f.close();}
 }
});

test('normal attachment creation preserves root identity and survives an independent accepted restart', async () => {
 const f=await fixture();try {
  f.activate();const before=statSync(f.uploads);const s=f.server('enabled');let saved;
  try {saved=s.store.saveUpload({operationId:'core-attachment-001',originalName:'synthetic.txt',contentType:'text/plain',kind:'attachment',buffer:Buffer.from('Synthetic attachment only')});assert.equal(saved.status,201,JSON.stringify(saved));}
  finally{s.store.close();}
  const after=statSync(f.uploads);assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);
  const code=`import {ScheduleStore} from ${JSON.stringify(pathToFileURL(join(f.app,'src/store.mjs')).href)};import {readFileSync} from 'node:fs';import {join} from 'node:path';const s=new ScheduleStore({filename:${JSON.stringify(f.filename)},uploadRoot:${JSON.stringify(f.uploads)},orphanCleanupMode:'disabled'});try{const row=s.db.prepare('SELECT stored_name FROM uploads WHERE id=?').get(${JSON.stringify(saved.upload.id)});if(!row||readFileSync(join(s.uploadRoot,row.stored_name),'utf8')!=='Synthetic attachment only')process.exitCode=1;}finally{s.close();}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  assert.equal(statSync(f.uploads).ino,before.ino);
 }finally{f.close();}
});
