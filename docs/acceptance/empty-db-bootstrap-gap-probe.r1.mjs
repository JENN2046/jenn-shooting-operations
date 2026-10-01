// Synthetic-only diagnosis against frozen /app runtime. No production paths or raw seed SQL.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { ScheduleStore } from '/app/src/store.mjs';
import { createSqliteSchedulingAdminStoreV1 } from '/app/src/sqlite-scheduling-admin-store-v1.mjs';
import { normalizeSchedulingConfigV1 } from '/app/src/scheduling-admin-contract-v1.mjs';
import { digestResourceCapabilitiesV1 } from '/app/src/scheduling-contract-v1.mjs';
const root=mkdtempSync('/tmp/empty-bootstrap-gap-'),now=()=>new Date('2026-10-01T02:00:00.000Z');
const store=new ScheduleStore({filename:root+'/new.sqlite',uploadRoot:root+'/uploads',orphanCleanupMode:'disabled',clock:now});
const db=store.db;
function counts(){return Object.fromEntries(['revision_counters','requests_v2','schedule_items','migration_batches','scheduling_resources','scheduling_config_versions','scheduling_active_config','scheduling_admin_operations'].map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));}
try {
 const initial=counts();assert(Object.values(initial).every(n=>n===0));
 const admin=createSqliteSchedulingAdminStoreV1({db,now,refreshProjections:()=>{throw Error('Unexpected projection mutation');}});
 const capabilityJson={schemaVersion:1,capabilityIds:['FLAT']};
 const register=admin.registerResource({operationId:'LOCAL-EMPTY-REGISTER',expectedProjectionRevision:0,expectedScheduleRevision:0,resource:{resourceId:'STUDIO-BOOTSTRAP-LOCAL-01',v1DisplayPlace:'LOCAL ONLY',status:'active',capabilityJson,capabilityDigest:digestResourceCapabilitiesV1(capabilityJson)}},'admin:local-probe');
 assert.equal(register.code,'SCHEDULING_REVISION_CONFLICT');assert.deepEqual(counts(),initial);
 const config=normalizeSchedulingConfigV1({schemaVersion:1,businessTimeZone:'Asia/Shanghai',resourceCalendars:[],durationFallbackRules:[],bufferRules:[],softScoringWeights:{LIGHTING_SWITCH:0,REFLECTIVITY_SEQUENCE:0,IDLE_GAP:0,EXPECTED_OVERRUN:0,DESIRED_DATE_MISS:0},compatibleAlgorithmVersions:['deterministic-scheduler-v1']});assert(config.ok);
 const published=admin.publishConfig({operationId:'LOCAL-EMPTY-PUBLISH',configVersion:'LOCAL-EMPTY-CONFIG',algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v1',estimatePolicyVersion:'estimate-policy-v1',configJson:config.config,configDigest:config.configDigest},'admin:local-probe');assert(published.ok);
 const beforeActivate=counts();assert.equal(beforeActivate.revision_counters,0);assert.equal(beforeActivate.scheduling_config_versions,1);
 const activated=admin.activateConfig({operationId:'LOCAL-EMPTY-ACTIVATE',configVersion:'LOCAL-EMPTY-CONFIG',expectedProjectionRevision:0},'admin:local-probe');assert.equal(activated.code,'SCHEDULING_REVISION_CONFLICT');assert.deepEqual(counts(),beforeActivate);
 console.log(JSON.stringify({status:'EMPTY_DOMAIN_BOOTSTRAP_GAP_CONFIRMED_SYNTHETIC_ONLY',productionAccess:false,rawSeedSqlExecuted:false,sourceRevision:'37ee97d5726d990e8f7178938eeb9b6c5f8b5424',initial,registerResource:register,publishConfig:{ok:published.ok,controlFactsCreated:true},activateConfig:activated,final:counts(),interpretation:'Supported admin library cannot create missing normalized counters. Publishing config can persist control facts without initializing or activating the domain. Production entrypoint exposes no bootstrap/admin executor.'},null,2));
}finally{store.close();}
