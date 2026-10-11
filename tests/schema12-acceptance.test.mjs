import test from 'node:test';
import assert from 'node:assert/strict';
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
