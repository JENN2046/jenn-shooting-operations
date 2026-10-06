import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { normalizeSchedulingConfig, normalizeSchedulingConfigV2, compileSchedulingCalendarDate, normalizePublishSchedulingConfig } from '../src/scheduling-admin-contract-v2.mjs';
import { normalizeSchedulingConfigV1, compileSchedulingCalendarDateV1 } from '../src/scheduling-admin-contract-v1.mjs';
import { digestResourceCapabilitiesV1 } from '../src/scheduling-contract-v1.mjs';
import { initializeWritableSchema, applySchemaMigrations, MIGRATIONS, assertKnownSchema } from '../src/sqlite-schema-v2.mjs';
import { createSqliteSchedulingAdminStoreV1 } from '../src/sqlite-scheduling-admin-store-v1.mjs';
import { assembleSchedulingInputFromSqliteV1 } from '../src/sqlite-scheduling-input-assembler-v1.mjs';
import { generateDeterministicScheduleV1 } from '../src/deterministic-scheduler-v1.mjs';
const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
const windows = [{start:'09:00',end:'12:00'},{start:'13:30',end:'18:00'}];
function config() { return { schemaVersion:2,businessTimeZone:'Asia/Shanghai',resourceCalendars:[{resourceId:'JENN',capabilityDigest,rules:[{effectiveFrom:'2026-01-01',weeklyWindows:[1,2,3,4,5].flatMap(weekday=>windows.map(w=>({weekday,...w}))),alternatingSaturday:{workingAnchorDate:'2026-10-10',windows}}],dateOverrides:[]}],durationFallbackRules:[{ruleId:'duration',productionType:null,shootingSubtype:null,durationMs:3600000}],bufferRules:[{ruleId:'buffer',productionType:null,shootingSubtype:null,bufferAfterMinutes:10}],softScoringWeights:{LIGHTING_SWITCH:1,REFLECTIVITY_SEQUENCE:1,IDLE_GAP:1,EXPECTED_OVERRUN:1,DESIRED_DATE_MISS:1},compatibleAlgorithmVersions:['deterministic-scheduler-v1'] }; }
function compile(c,date) { return compileSchedulingCalendarDate({configJson:c,resourceId:'JENN',date,calendarCompilerVersion:'calendar-compiler-v2',timeZoneDataVersion:process.versions.tz}); }
function publish(c,id='PUB') { return {operationId:id,configVersion:id,algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v2',estimatePolicyVersion:'estimate-policy-v1',configJson:c,configDigest:normalizeSchedulingConfig(c).configDigest}; }

test('alternating Saturday uses civil-day anchor, no six-month expiry, lunch and Sunday stay closed',()=>{
  const c=config();
  for(const d of ['2026-10-10','2026-10-24','2026-09-26','2030-01-12']) { const r=compile(c,d); assert.equal(r.ok,true); assert.equal(r.windows.length,2,d); }
  for(const d of ['2026-10-17','2026-10-11','2025-12-31']) assert.deepEqual(compile(c,d).windows,[],d);
  assert.deepEqual(compile(c,'2026-10-12').windows,[{start:'2026-10-12T01:00:00.000Z',end:'2026-10-12T04:00:00.000Z'},{start:'2026-10-12T05:30:00.000Z',end:'2026-10-12T10:00:00.000Z'}]);
});
test('future rule replaces prior recurrence, date override wins and removing override restores rule',()=>{
  const c=config();c.resourceCalendars[0].rules.push({effectiveFrom:'2026-10-20',weeklyWindows:[{weekday:1,start:'10:00',end:'11:00'}],alternatingSaturday:null});
  assert.equal(compile(c,'2026-10-19').windows.length,2);assert.equal(compile(c,'2026-10-26').windows[0].start,'2026-10-26T02:00:00.000Z');
  c.resourceCalendars[0].dateOverrides=[{date:'2026-10-17',status:'custom',windows:[{start:'15:00',end:'16:00'}]}];assert.equal(compile(c,'2026-10-17').windows.length,1);
  c.resourceCalendars[0].dateOverrides=[];assert.deepEqual(compile(c,'2026-10-17').windows,[]);
});
test('normalization and digests are order independent, reject conflicting/unsafe rules',()=>{
  const c=config(),reordered=structuredClone(c);reordered.resourceCalendars[0].rules[0].weeklyWindows.reverse();
  assert.equal(normalizeSchedulingConfig(c).configDigest,normalizeSchedulingConfig(reordered).configDigest);
  for(const mutate of [x=>x.resourceCalendars[0].rules.push(x.resourceCalendars[0].rules[0]),x=>x.resourceCalendars[0].rules[0].alternatingSaturday.workingAnchorDate='2026-10-11',x=>x.resourceCalendars[0].rules[0].weeklyWindows.push({weekday:6,start:'09:00',end:'10:00'}),x=>x.resourceCalendars[0].rules[0].weeklyWindows.push({weekday:1,start:'11:00',end:'14:00'}),x=>x.resourceCalendars[0].rules[0].effectiveFrom='2026-02-30',x=>Object.defineProperty(x.resourceCalendars[0].rules[0],'effectiveFrom',{get(){throw Error('getter called');}})]) {const bad=structuredClone(c);mutate(bad);assert.equal(normalizeSchedulingConfigV2(bad).ok,false);}
  const p=publish(c);assert.equal(normalizePublishSchedulingConfig(p).ok,true);assert.equal(normalizePublishSchedulingConfig({...p,configDigest:'sha256:'+'0'.repeat(64)}).ok,false);
});
test('v1 dispatcher preserves exact config and compiler results',()=>{
 const c=config(); c.schemaVersion=1;c.resourceCalendars=c.resourceCalendars.map(({rules,...rest})=>({...rest,weeklyWindows:rules[0].weeklyWindows}));
 assert.deepEqual(normalizeSchedulingConfig(c),normalizeSchedulingConfigV1(c));
 const args={configJson:c,resourceId:'JENN',date:'2026-10-12',calendarCompilerVersion:'calendar-compiler-v1',timeZoneDataVersion:process.versions.tz};assert.deepEqual(compileSchedulingCalendarDate(args),compileSchedulingCalendarDateV1(args));
});
function dbFixture(migrations=MIGRATIONS) {const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');initializeWritableSchema(db,{migrations});return db;}
test('schema11 preserves nonempty v1 config/activation bytes and historical markers with FK enforcement restored',()=>{
 const db=dbFixture(MIGRATIONS.slice(0,10));try {
 db.exec(`INSERT INTO scheduling_config_versions VALUES ('old',1,'a','c','e','{}','digest','admin','at','pub'); INSERT INTO scheduling_active_config VALUES (1,'old','at','act',0); INSERT INTO scheduling_config_activations VALUES ('act','d',NULL,'old',0,'at','admin');`);
 const rows=db.prepare('SELECT * FROM scheduling_config_versions').all(), markers=db.prepare('SELECT * FROM schema_migrations').all();
 applySchemaMigrations(db);assert.deepEqual(db.prepare('SELECT * FROM scheduling_config_versions').all(),rows);assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=10').all(),markers);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(assertKnownSchema(db).version,11);
 assert.throws(()=>db.exec("UPDATE scheduling_config_versions SET config_json='changed'"),/immutable/);assert.throws(()=>db.exec('DELETE FROM scheduling_config_versions'),/cannot be deleted/);
 }finally{db.close();}
});
test('schema11 late SQL failure rolls back a nonempty rebuild and restores FK ON', () => {
  const db = dbFixture(MIGRATIONS.slice(0, 10));
  try {
    db.exec(`
      INSERT INTO scheduling_config_versions VALUES ('old',1,'a','c','e','{}','digest','admin','at','pub');
      INSERT INTO scheduling_active_config VALUES (1,'old','at','act',0);
      INSERT INTO scheduling_config_activations VALUES ('act','d',NULL,'old',0,'at','admin');
    `);
    const before = {
      config: db.prepare('SELECT * FROM scheduling_config_versions').all(),
      active: db.prepare('SELECT * FROM scheduling_active_config').all(),
      activations: db.prepare('SELECT * FROM scheduling_config_activations').all(),
      markers: db.prepare('SELECT * FROM schema_migrations').all(),
      schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),
    };
    // A matching checksum admits the altered SQL so failure happens after the complete
    // rebuild and receipt DDL, rather than at migration-definition validation.
    const sql = MIGRATIONS[10].sql + '\n SELECT fail_missing_function();';
    const broken = [...MIGRATIONS.slice(0, 10), {
      ...MIGRATIONS[10], sql, checksum: 'sha256:' + createHash('sha256').update(sql).digest('hex'),
    }];
    assert.throws(() => applySchemaMigrations(db, { migrations: broken }), error => {
      assert.equal(error.code, 'SCHEMA_MIGRATION_FAILED');
      assert.match(error.cause?.message ?? '', /fail_missing_function/);
      return true;
    });
    assert.deepEqual(db.prepare('SELECT * FROM scheduling_config_versions').all(), before.config);
    assert.deepEqual(db.prepare('SELECT * FROM scheduling_active_config').all(), before.active);
    assert.deepEqual(db.prepare('SELECT * FROM scheduling_config_activations').all(), before.activations);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), before.markers);
    assert.deepEqual(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(), before.schema);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(assertKnownSchema(db, { migrations: MIGRATIONS.slice(0, 10) }).version, 10);
  } finally { db.close(); }
});
test('v2 publish/activate persists once; transaction guard rejects without mutation; assembler keeps 366-day bound',()=>{
 const db=dbFixture();try {
 db.exec("INSERT INTO revision_counters VALUES(1,0,0,'2026-10-01T00:00:00Z')");
 let allowed=false;const store=createSqliteSchedulingAdminStoreV1({db,now:()=>new Date('2026-10-01T00:00:00Z'),refreshProjections:()=>{},validateActivation:()=>allowed?{ok:true}:{ok:false,code:'CONFIG_OCCUPANCY_CONFLICT',conflicts:['existing']}});
 assert.equal(store.registerResource({operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:{resourceId:'JENN',v1DisplayPlace:'Jenn',status:'active',capabilityJson,capabilityDigest}},'Jenn').ok,true);
 const p=publish(config());assert.equal(store.publishConfig(p,'Jenn').ok,true);assert.equal(store.publishConfig(p,'Jenn').exactReplay,true);
 const a={operationId:'ACT',configVersion:'PUB',expectedProjectionRevision:1};assert.equal(store.activateConfig(a,'Jenn').code,'CONFIG_OCCUPANCY_CONFLICT');assert.equal(db.prepare('SELECT COUNT(*) n FROM scheduling_config_activations').get().n,0);allowed=true;assert.equal(store.activateConfig(a,'Jenn').ok,true);
 const row=db.prepare('SELECT * FROM scheduling_config_versions').get();const activeConfig={...row,config:normalizeSchedulingConfig(config()).config};const command={resourceScope:['JENN'],planningWindowStart:'2026-10-09T16:00:00Z',planningWindowEnd:'2026-10-10T16:00:00Z'};
 const input=assembleSchedulingInputFromSqliteV1({db,command,activeConfig});assert.equal(input.resources[0].businessWindows.length,2);const generated=generateDeterministicScheduleV1(input,activeConfig.config);assert.equal(generated.ok,true,JSON.stringify(generated));
 assert.throws(()=>assembleSchedulingInputFromSqliteV1({db,activeConfig,command:{...command,planningWindowEnd:'2028-01-01T00:00:00Z'}}),/PLANNING_RANGE/);
 }finally{db.close();}
});
