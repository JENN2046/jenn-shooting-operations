import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MIGRATIONS,initializeWritableSchema,applySchemaMigrations,assertKnownSchema,initializeRuntimeWritableSchema} from '../src/sqlite-schema-v2.mjs';
import {validateV2Submission,validateV3Submission} from '../src/contract-validator.mjs';
const request=(subtype='产品3D主图')=>({schemaVersion:3,operationId:'SYNTHETIC-CREATE',productionType:'平面',sku:'SYNTHETIC',name:'Synthetic',kind:'静物',shootingSubtype:subtype,aspectRatio:'待定',deliverables:{type:'flat',count:1},requestedBy:'Synthetic',desiredDate:'2026-10-12',note:'',coreBriefSummary:'Synthetic image',sampleStatus:'arrivedVerified',lightingPreset:'SOFT',reflectivity:'unknown',priority:'p1',uploadIds:[]});
export {request};
test('v3 preserves all still-life subtypes and v2 explicitly rejects them',()=>{
 for(const subtype of ['产品3D主图','细节图','功能图']){assert.equal(validateV3Submission(request(subtype)).ok,true);assert.equal(validateV2Submission({...request(subtype),schemaVersion:2}).ok,false);}
 assert.equal(validateV3Submission({...request(),kind:'模特'}).ok,false);
 assert.equal(validateV3Submission({...request(),shootingSubtype:'细节'}).ok,false);
});
test('Schema11 upgrades without reclassifying historical DETAIL, keeps FK and published markers; runtime never upgrades',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');initializeWritableSchema(db,{migrations:MIGRATIONS.slice(0,11)});
 const markers=db.prepare('SELECT * FROM schema_migrations').all();
 db.exec(`INSERT INTO requests_v2(id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,deliverable_count,aspect_ratio,lighting_preset,reflectivity) VALUES('old',0,'s','n','c','d','细节','canonical','open','domain_command','submission','2026-10-01T00:00:00Z',0,1,'平面','细节',1,'待定','SOFT','unknown')`);
 const old=db.prepare('SELECT * FROM requests_v2').get();
 assert.equal(initializeRuntimeWritableSchema(db).version,11);
 applySchemaMigrations(db);assert.equal(assertKnownSchema(db).version,12);
 assert.deepEqual(db.prepare('SELECT * FROM requests_v2').get(),old);
 assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=11').all(),markers);
 assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 db.prepare("UPDATE requests_v2 SET kind='静物',shooting_subtype='功能图' WHERE id='old'").run();
 assert.throws(()=>db.exec("UPDATE requests_v2 SET shooting_subtype='细节' WHERE id='old'"));db.close();
});
test('successor rebuild failure rolls back and restores FK; static category rejects null production type',async()=>{
 const {createHash}=await import('node:crypto');
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');initializeWritableSchema(db,{migrations:MIGRATIONS.slice(0,11)});
 const before=db.prepare("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all();
 const sql=MIGRATIONS[11].sql+'\nCREATE TABLE unexpected_schema_object(x TEXT);';
 const failed=[...MIGRATIONS.slice(0,11),{...MIGRATIONS[11],sql,checksum:'sha256:'+createHash('sha256').update(sql).digest('hex')}];
 assert.throws(()=>applySchemaMigrations(db,{migrations:failed}));
 assert.equal(assertKnownSchema(db).version,11);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all(),before);
 applySchemaMigrations(db);
 assert.throws(()=>db.exec(`INSERT INTO requests_v2(id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,lighting_preset,reflectivity) VALUES('invalid',0,'s','n','c','d','静物','canonical','open','domain_command','submission','2026-10-01T00:00:00Z',0,0,NULL,'产品3D主图','SOFT','unknown')`));db.close();
});
