import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {coreFixture} from './support/greenfield-core-fixture.mjs';
import {maintenanceFixture} from './support/empty-db-maintenance-fixture.mjs';
import {EMPTY_DB_MAINTENANCE_SCHEMA11_DIGEST_V1} from '../src/empty-db-maintenance-v1.mjs';
test('Schema11 initializer packet cannot initialize Schema12; new explicit digest succeeds',()=>{
 const f=maintenanceFixture(undefined,{schemaVersion:12,greenfield:true});try{
 const p=f.packet();const old={...p,schemaDigest:EMPTY_DB_MAINTENANCE_SCHEMA11_DIGEST_V1};assert.throws(()=>f.execute(old),{code:'SCHEMA_VERSION_TOO_NEW'});assert.equal(f.execute(p).ok,true);
 }finally{f.close();}
});
test('R3 Schema11 acceptance cannot admit Schema12; R4 binds both purpose and exact schema',async()=>{
 const f=await coreFixture({initialized:false,schemaVersion:12});try{
 assert.equal(f.initialize().ok,true);f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();
 assert.equal(f.m.validateCoreRecord(f.record).version,4);
 const old={...f.record,version:3,purpose:'CORE_SCHEMA11_PROSPECTIVE_ACCEPTANCE',baseline:{...f.record.baseline,schemaVersion:11}};
 assert.equal(f.m.validateCoreRecord(old).version,3);assert.throws(()=>f.m.validateCoreDatabase(old,f.filename),/SCHEMA_BINDING/);
 assert.throws(()=>f.m.validateCoreRecord({...f.record,purpose:old.purpose}),/RECORD_INVALID/);
 f.m.validateCoreDatabase(f.record,f.filename);
 }finally{f.close();}
});


test('Schema12 startup validates its actual V3 projection content without rebuilding it', async () => {
 for(const change of [
  p=>{delete p.requests;},
  p=>{p.requests={};},
  p=>{delete p.scheduleItems;},
  p=>{p.productionRuns=[{}];},
 ]) {
  const f=await coreFixture({schemaVersion:12});try {
   const db=new DatabaseSync(f.filename),row=db.prepare("SELECT payload_json FROM snapshot_projections WHERE projection_name='schedule-v3'").get();
   const payload=JSON.parse(row.payload_json);change(payload);
   db.prepare("UPDATE snapshot_projections SET payload_json=? WHERE projection_name='schedule-v3'").run(JSON.stringify(payload));db.close();
   f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();const before=readFileSync(f.filename);
   assert.throws(()=>f.server(),/INITIALIZATION_PROJECTIONS/);
   f.activate();assert.throws(()=>f.server('enabled'),/INITIALIZATION_PROJECTIONS/);
   assert.deepEqual(readFileSync(f.filename),before);
  }finally{f.close();}
 }
});

test('a populated V3 projection passes startup while V3 category mismatch is rejected',async()=>{
 const {launch,scheduleOrders}=await import('./support/first-launch-v3-fixture.mjs');
 const f=await launch();try {
  await scheduleOrders(f,5);f.server.store.close();
  const before=readFileSync(f.filename);assert.equal(f.m.loadCoreAcceptance(f.filename).prepared,false);
  assert.deepEqual(readFileSync(f.filename),before);
  const db=new DatabaseSync(f.filename),row=db.prepare("SELECT payload_json FROM snapshot_projections WHERE projection_name='schedule-v3'").get();
  const payload=JSON.parse(row.payload_json),request=payload.requests.find(r=>r.shootingSubtype==='产品3D主图');
  assert.ok(request);request.kind='模特';
  db.prepare("UPDATE snapshot_projections SET payload_json=? WHERE projection_name='schedule-v3'").run(JSON.stringify(payload));db.close();
  const damaged=readFileSync(f.filename);assert.throws(()=>f.m.loadCoreAcceptance(f.filename),/INITIALIZATION_PROJECTIONS/);
  assert.deepEqual(readFileSync(f.filename),damaged);
 }finally{f.close();}
});
