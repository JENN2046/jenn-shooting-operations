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
import { initializeWritableSchema } from '../../src/sqlite-schema-v2.mjs';
import { ScheduleStore } from '../../src/store.mjs';
import { maintenanceFixture } from './empty-db-maintenance-fixture.mjs';

// Local fixture-only application copy. Production has no custody/uid override.
export async function coreFixture({ initialized = true, schemaVersion = 11, identities = null, kioskIdentities = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jso-core-synthetic-'));
  const maintenance = maintenanceFixture(undefined, { schemaVersion, greenfield: true });
  const app = join(root,'app'), custody = join(root,'custody');
  const filename = join(maintenance.root,'synthetic.sqlite'), uploads=join(maintenance.root,'uploads');
  mkdirSync(app); mkdirSync(custody,{mode:0o700});
  cpSync(new URL('../../src',import.meta.url),join(app,'src'),{recursive:true});
  cpSync(new URL('../../contracts',import.meta.url),join(app,'contracts'),{recursive:true});
  cpSync(new URL('../../public',import.meta.url),join(app,'public'),{recursive:true});
  cpSync(new URL('../../docs',import.meta.url),join(app,'docs'),{recursive:true});
  symlinkSync(new URL('../../node_modules',import.meta.url).pathname,join(app,'node_modules'));
  const modulePath=join(app,'src/g3-core-startup-acceptance.mjs');
  writeFileSync(modulePath,readFileSync(modulePath,'utf8')
    .replace("const CUSTODY = '/etc/jso/core-acceptance';",`const CUSTODY = ${JSON.stringify(custody)};`)
    .replace('const TRUSTED_UID = 0;',`const TRUSTED_UID = ${process.getuid()};`)
    .replace('if (p === dirname(p)) break;',`if (p === ${JSON.stringify(root)}) break;`));
  if (initialized) maintenance.execute();
  const quiescent=new DatabaseSync(filename);quiescent.exec('PRAGMA journal_mode=DELETE');quiescent.close();
  const env={...(kioskIdentities?{JSO_KIOSK_ONLINE_RUNTIME:'enabled',JSO_KIOSK_ONLINE_IDENTITIES_JSON:JSON.stringify(kioskIdentities)}:{}),KIOSK_SERVICE_CONTEXT:'PROD11_PRODUCTION',JSO_BUSINESS_RUNTIME:'enabled',ORPHAN_CLEANUP_MODE:'disabled',JSO_BUSINESS_IDENTITIES_JSON:JSON.stringify(identities??[{token:'a'.repeat(40),subjectId:'test-admin',role:'administrator',resourceIds:['JSO-BIZ-RESOURCE-001']}]),UPLOAD_ROOT:uploads};
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  const m=await import(pathToFileURL(modulePath)); const st=statSync(filename), now=Date.now(), h='a'.repeat(64);
  const record={version:schemaVersion===12?4:3,purpose:schemaVersion===12?'CORE_SCHEMA12_PROSPECTIVE_ACCEPTANCE':'CORE_SCHEMA11_PROSPECTIVE_ACCEPTANCE',acceptanceId:'SYNTHETIC-ONLY',state:'PREPARED',ownerSource:'SYNTHETIC TEST FIXTURE - NOT OWNER APPROVAL',ownerApprovedAt:new Date(now-1000).toISOString(),ownerTextSha256:m.digest('SYNTHETIC ONLY\n'),planSha256:h,release:{head:'a'.repeat(40),tree:'b'.repeat(40),imageDigest:'sha256:'+h,sourceSha256:m.sourceDigest()},target:{hostId:'synthetic-host',service:'synthetic-core',volumeName:'synthetic-volume',volumeSource:root,mountPoint:root,databasePath:filename,databaseIdentity:{device:st.dev,inode:st.ino},uploadRoot:uploads,uploadIdentity:{device:statSync(uploads).dev,inode:statSync(uploads).ino}},baseline:{schemaVersion,sha256:m.digest(readFileSync(filename)),sideFiles:'ABSENT_UNDER_EXCLUSIVE_MAINTENANCE',historicalEvidenceSha256:h,backupManifestSha256:h,restoreVerificationSha256:h},policy:{adminTrustAccepted:true,historicalCoverageRiskAccepted:true,sameTargetRestartAllowed:true,cleanup:'disabled',integrations:'disabled',runtimeConfigSha256:m.runtimeConfigDigest()},window:{start:new Date(now-10000).toISOString(),end:new Date(now+600000).toISOString()},activation:null};
  function install(){const {state,activation,...scope}=record; const json=(n,v)=>writeFileSync(join(custody,n),m.canonical(v)+'\n',{mode:0o644});json('acceptance.json',record);json('owner-approval.json',{acceptanceScopeSha256:m.digest(m.canonical(scope)),ownerSource:record.ownerSource,ownerApprovedAt:record.ownerApprovedAt,ownerTextSha256:record.ownerTextSha256});writeFileSync(join(custody,'owner-approval.txt'),'SYNTHETIC ONLY\n',{mode:0o644});json('installation.json',{acceptanceSha256:m.digest(m.canonical(record)+'\n'),release:record.release,target:record.target,runtimeConfigSha256:record.policy.runtimeConfigSha256,installedBy:'synthetic-fixture'});}
  function activate(){record.state='ACTIVE';const {state,activation,...scope}=record;const checkedAt=new Date().toISOString();const initial={acceptanceScopeSha256:m.digest(m.canonical(scope)),baselineSha256:record.baseline.sha256,checkedAt,schemaVersion,integrityOk:true,foreignKeyViolations:0,backupRestoreVerified:true,exclusiveMaintenance:true,initialized:true};const raw=m.canonical(initial)+'\n';writeFileSync(join(custody,'initial-verification.json'),raw,{mode:0o644});record.activation={acceptedAt:checkedAt,installedBy:'synthetic-fixture',initialVerificationSha256:m.digest(raw)};install();}
  const evidence='SYNTHETIC EVIDENCE ONLY\n';
  record.planSha256=record.baseline.historicalEvidenceSha256=record.baseline.backupManifestSha256=record.baseline.restoreVerificationSha256=m.digest(evidence);
  for(const name of ['plan.txt','historical-evidence.json','backup-manifest.json','restore-verification.json'])writeFileSync(join(custody,name),evidence,{mode:0o644});
  install();
  const api=await import(pathToFileURL(join(app,'src/server.mjs')));
  function server(mode='disabled',extra={}){return api.createOperationsServer({databasePath:filename,uploadRoot:uploads,orphanCleanupMode:'disabled',writeAdmissionMode:mode,cleanupIntervalMs:0,...api.createKioskRuntimeOptionsFromEnv(process.env),...businessOptions,...onlineOptions,...extra});}
  const {createKioskOnlineOptionsFromEnv}=await import(pathToFileURL(join(app,'src/kiosk-online-runtime-v3.mjs')));const onlineOptions=createKioskOnlineOptionsFromEnv(process.env);
  const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(app,'src/business-runtime-auth-v1.mjs')));const businessOptions=createBusinessRuntimeOptionsFromEnv(process.env);
  return {root,app,custody,filename,uploads,m,record,install,activate,server,initialize:()=>maintenance.execute(),dataRoot:maintenance.root,close(){for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}maintenance.close();rmSync(root,{recursive:true,force:true});}};
}
