import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { ScheduleStore } from '../src/store.mjs';

// Local fixture-only application copy. Production has no custody/uid override.
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jso-core-synthetic-'));
  const app = join(root,'app'), custody = join(root,'custody'), filename = join(root,'db.sqlite'), uploads=join(root,'uploads');
  mkdirSync(app); mkdirSync(custody,{mode:0o700}); mkdirSync(uploads);
  cpSync(new URL('../src',import.meta.url),join(app,'src'),{recursive:true});
  cpSync(new URL('../contracts',import.meta.url),join(app,'contracts'),{recursive:true});
  cpSync(new URL('../docs',import.meta.url),join(app,'docs'),{recursive:true});
  symlinkSync(new URL('../node_modules',import.meta.url).pathname,join(app,'node_modules'));
  const modulePath=join(app,'src/g3-core-startup-acceptance.mjs');
  writeFileSync(modulePath,readFileSync(modulePath,'utf8')
    .replace("const CUSTODY = '/etc/jso/core-acceptance';",`const CUSTODY = ${JSON.stringify(custody)};`)
    .replace('const TRUSTED_UID = 0;',`const TRUSTED_UID = ${process.getuid()};`)
    .replace('if (p === dirname(p)) break;',`if (p === ${JSON.stringify(root)}) break;`));
  const bootstrap=new DatabaseSync(filename);initializeWritableSchema(bootstrap);bootstrap.close();
  const initial=new ScheduleStore({filename,uploadRoot:uploads,orphanCleanupMode:'disabled'});
  initial.db.prepare('INSERT INTO revision_counters VALUES(1,0,0,?)').run('2026-10-01T00:00:00.000Z');initial.close();
  const quiescent=new DatabaseSync(filename);quiescent.exec('PRAGMA journal_mode=DELETE');quiescent.close();
  const env={KIOSK_SERVICE_CONTEXT:'PROD11_PRODUCTION',JSO_BUSINESS_RUNTIME:'enabled',ORPHAN_CLEANUP_MODE:'disabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify([{token:'a'.repeat(40),subjectId:'test-admin',role:'administrator',resourceIds:['JSO-BIZ-RESOURCE-001']}]),UPLOAD_ROOT:uploads};
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  const m=await import(pathToFileURL(modulePath)); const st=statSync(filename), now=Date.now(), h='a'.repeat(64);
  const record={version:3,purpose:'CORE_SCHEMA11_PROSPECTIVE_ACCEPTANCE',acceptanceId:'SYNTHETIC-ONLY',state:'PREPARED',ownerSource:'SYNTHETIC TEST FIXTURE - NOT OWNER APPROVAL',ownerApprovedAt:new Date(now-1000).toISOString(),ownerTextSha256:m.digest('SYNTHETIC ONLY\n'),planSha256:h,release:{head:'a'.repeat(40),tree:'b'.repeat(40),imageDigest:'sha256:'+h,sourceSha256:m.sourceDigest()},target:{hostId:'synthetic-host',service:'synthetic-core',volumeName:'synthetic-volume',volumeSource:root,mountPoint:root,databasePath:filename,databaseIdentity:{device:st.dev,inode:st.ino},uploadRoot:uploads},baseline:{schemaVersion:11,sha256:m.digest(readFileSync(filename)),sideFiles:'ABSENT_UNDER_EXCLUSIVE_MAINTENANCE',historicalEvidenceSha256:h,backupManifestSha256:h,restoreVerificationSha256:h},policy:{adminTrustAccepted:true,historicalCoverageRiskAccepted:true,sameTargetRestartAllowed:true,cleanup:'disabled',integrations:'disabled',runtimeConfigSha256:m.runtimeConfigDigest()},window:{start:new Date(now-10000).toISOString(),end:new Date(now+600000).toISOString()},activation:null};
  function install(){const {state,activation,...scope}=record; const json=(n,v)=>writeFileSync(join(custody,n),m.canonical(v)+'\n',{mode:0o644});json('acceptance.json',record);json('owner-approval.json',{acceptanceScopeSha256:m.digest(m.canonical(scope)),ownerSource:record.ownerSource,ownerApprovedAt:record.ownerApprovedAt,ownerTextSha256:record.ownerTextSha256});writeFileSync(join(custody,'owner-approval.txt'),'SYNTHETIC ONLY\n',{mode:0o644});json('installation.json',{acceptanceSha256:m.digest(m.canonical(record)+'\n'),release:record.release,target:record.target,runtimeConfigSha256:record.policy.runtimeConfigSha256,installedBy:'synthetic-fixture'});}
  function activate(){record.state='ACTIVE';const {state,activation,...scope}=record;const checkedAt=new Date().toISOString();const initial={acceptanceScopeSha256:m.digest(m.canonical(scope)),baselineSha256:record.baseline.sha256,checkedAt,schemaVersion:11,integrityOk:true,foreignKeyViolations:0,backupRestoreVerified:true,exclusiveMaintenance:true,initialized:true};const raw=m.canonical(initial)+'\n';writeFileSync(join(custody,'initial-verification.json'),raw,{mode:0o644});record.activation={acceptedAt:checkedAt,installedBy:'synthetic-fixture',initialVerificationSha256:m.digest(raw)};install();}
  const evidence='SYNTHETIC EVIDENCE ONLY\n';
  record.planSha256=record.baseline.historicalEvidenceSha256=record.baseline.backupManifestSha256=record.baseline.restoreVerificationSha256=m.digest(evidence);
  for(const name of ['plan.txt','historical-evidence.json','backup-manifest.json','restore-verification.json'])writeFileSync(join(custody,name),evidence,{mode:0o644});
  install();
  const api=await import(pathToFileURL(join(app,'src/server.mjs')));
  function server(mode='disabled'){return api.createOperationsServer({databasePath:filename,uploadRoot:uploads,orphanCleanupMode:'disabled',writeAdmissionMode:mode,cleanupIntervalMs:0,...api.createKioskRuntimeOptionsFromEnv(process.env),...businessOptions});}
  const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(app,'src/business-runtime-auth-v1.mjs')));const businessOptions=createBusinessRuntimeOptionsFromEnv(process.env);
  return {root,app,custody,filename,uploads,m,record,install,activate,server,close(){for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}rmSync(root,{recursive:true,force:true});}};
}
test('PREPARED uses a truly read-only store, cannot enable writes, and leaves bytes/schema/directories unchanged',async()=>{
 const f=await fixture();try{const before=readFileSync(f.filename),names=readdirSync(f.root);const s=f.server();try{assert.equal(s.store.readOnly,true);assert.throws(()=>s.orphanCleanupControl.enable({}),/CLEANUP_DISABLED/);assert.throws(()=>s.writeAdmissionControl.enable(),/PREPARED/);assert.throws(()=>s.store.db.exec('CREATE TABLE forbidden(x)'));}finally{s.store.close();}assert.deepEqual(readFileSync(f.filename),before);assert.deepEqual(readdirSync(f.root),names);assert.throws(()=>f.server('enabled'),/SERVER_CONFIG/);}finally{f.close();}
});
test('ACTIVE persists business calendar through changed database digest and independent process reopen',async()=>{
 const f=await fixture();try{f.activate();const s=f.server('enabled');assert.throws(()=>s.orphanCleanupControl.enable({}),/CLEANUP_DISABLED/);
 const {Readable}=await import('node:stream');const {createHttpApp}=await import(pathToFileURL(join(f.app,'src/http-app.mjs')));const {createSchedulingV2Application}=await import(pathToFileURL(join(f.app,'src/server.mjs')));const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')));
 const scheduling=createSchedulingV2Application({store:s.store,...createBusinessRuntimeOptionsFromEnv(process.env),authenticate:createBusinessRuntimeOptionsFromEnv(process.env).schedulingAuthenticate,clock:()=>new Date('2026-10-01T00:00:00.000Z')});const app=createHttpApp({store:s.store,scheduling});
 async function call(path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=body?'POST':'GET';req.url=path;req.headers={authorization:'Bearer '+'a'.repeat(40)};let status,result;await app(req,{setHeader(){},writeHead(v){status=v;},end(v){result=JSON.parse(v);}});assert.equal(status,200,JSON.stringify(result));return result;}
 try{const state=await call('/api/v2/business/state');await call('/api/v2/business/resources',{operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:state.initialResource});const {normalizeSchedulingConfig}=await import(pathToFileURL(join(f.app,'src/scheduling-admin-contract-v2.mjs')));const n=normalizeSchedulingConfig(state.initialConfig);await call('/api/v2/business/config/publish',{operationId:'PUB',configVersion:'C1',algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v2',estimatePolicyVersion:'estimate-policy-v1',configJson:n.config,configDigest:n.configDigest});await call('/api/v2/business/config/activate',{operationId:'ACT',configVersion:'C1',expectedProjectionRevision:1});}finally{s.store.close();}
 assert.notEqual(f.m.digest(readFileSync(f.filename)),f.record.baseline.sha256);
 const code=`import {ScheduleStore} from ${JSON.stringify(pathToFileURL(join(f.app,'src/store.mjs')).href)};const s=new ScheduleStore({filename:${JSON.stringify(f.filename)},uploadRoot:${JSON.stringify(f.uploads)},orphanCleanupMode:'disabled'});if(s.db.prepare('SELECT config_version FROM scheduling_active_config').get().config_version!=='C1')process.exitCode=1;s.close();`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 }finally{f.close();}
});
test('missing approval, wrong object/version, incomplete activation, damaged records and drift fail closed',async()=>{
 const f=await fixture();try{
 assert.equal(f.m.loadCoreAcceptance(f.filename).prepared,true);
 for(const mutate of [r=>r.version=4,r=>r.state='COMMITTING',r=>r.state='ACTIVE',r=>r.target.databaseIdentity.inode++,r=>r.target.databasePath+='.wrong',r=>r.release.sourceSha256='b'.repeat(64),r=>r.policy.runtimeConfigSha256='b'.repeat(64),r=>r.window.end=r.window.start]){const original=structuredClone(f.record);mutate(f.record);f.install();assert.throws(()=>f.m.loadCoreAcceptance(f.filename));Object.keys(f.record).forEach(k=>delete f.record[k]);Object.assign(f.record,original);}
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
