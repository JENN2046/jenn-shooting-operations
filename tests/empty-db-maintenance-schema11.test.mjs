import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { maintenanceFixture, authorizationFor, registerCommand } from './support/empty-db-maintenance-fixture.mjs';
import { EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1 } from '../src/empty-db-maintenance-v1.mjs';

function fixture(t) { const f=maintenanceFixture(undefined,{schemaVersion:11});t.after(f.close);return f; }
function unchanged(f, packet, code, overrides={}) {
 const before=f.state();assert.throws(()=>f.execute(packet,overrides),{code});assert.equal(f.state(),before);
}
test('Schema11 supported initializer persists counters, both projections, audit and exact receipt without resource defaults',t=>{
 const f=fixture(t), markers=f.read(db=>db.prepare('SELECT * FROM schema_migrations ORDER BY version').all());
 const result=f.execute();assert.equal(result.ok,true);assert.equal(result.exactReplay,false);
 f.read(db=>{
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),markers);
  assert.deepEqual({...db.prepare('SELECT schedule_revision,projection_revision FROM revision_counters WHERE id=1').get()},{schedule_revision:0,projection_revision:0});
  for(const [table,count]of [['snapshot_projections',2],['empty_db_initialization',1],['audit_log',1],['scheduling_resources',0],['scheduling_active_config',0]])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,count);
 });
 const after=f.state();assert.equal(f.execute().exactReplay,true);assert.equal(f.state(),after);
});
test('normal synthetic CLI supports explicit Schema11 packets, never infers authorization',t=>{
 const f=fixture(t), packet=f.packet();
 const dir=join(f.root,'..'); // Packet files must not alter the bound data-root allowlist.
 const paths=['packet','authorization','runtime'].map(name=>join(dir,`${f.root.split('/').at(-1)}-${name}.json`));
 t.after(async()=>{const {rmSync}=await import('node:fs');for(const p of paths)rmSync(p,{force:true});});
 [packet,authorizationFor(packet),f.runtime].forEach((value,i)=>writeFileSync(paths[i],JSON.stringify(value)));
 const child=spawnSync(process.execPath,['scripts/local-empty-db-maintenance.mjs','--local-synthetic',...paths],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).ok,true);
 assert.equal(f.execute().exactReplay,true);
});
for(const [label,sql,code] of [
 ['legacy business snapshot',"UPDATE schedule_state SET snapshot_json=json_set(snapshot_json,'$.tasks',json('[{\"id\":\"existing\"}]'))",'MAINTENANCE_LEGACY_NOT_EMPTY'],
 ['existing legacy revision',"UPDATE schedule_state SET revision=3",'MAINTENANCE_LEGACY_NOT_EMPTY'],
 ['existing counters',"INSERT INTO revision_counters VALUES(1,7,8,'now')",'MAINTENANCE_DATABASE_NOT_EMPTY'],
 ['existing audit',"INSERT INTO audit_log(action,role,revision,result,created_at) VALUES('prior','prior',0,'prior','now')",'MAINTENANCE_DATABASE_NOT_EMPTY'],
 ['existing business receipt',"INSERT INTO operations VALUES('prior','prior','{}','now',NULL)",'MAINTENANCE_DATABASE_NOT_EMPTY'],
 ['unknown schema',"CREATE TABLE unclassified_state(value TEXT)",'SCHEMA_STRUCTURE_MISMATCH'],
]) test(`Schema11 refuses ${label} without changing existing data`,t=>{
 const f=fixture(t);f.write(db=>db.exec(sql));const before=f.state();
 if(label==='unknown schema')assert.throws(()=>f.execute());else assert.throws(()=>f.execute(),{code});
 assert.equal(f.state(),before);
});
test('Schema11 refuses nonempty attachments before creating initialization',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'uploads','existing.txt'),'synthetic existing attachment');
 unchanged(f,f.packet(),'MAINTENANCE_UPLOADS_NOT_EMPTY');assert.equal(readFileSync(join(f.root,'uploads','existing.txt'),'utf8'),'synthetic existing attachment');
});
test('Schema11 exact schema, runtime, target and approval bindings remain mandatory',t=>{
 const f=fixture(t), p=f.packet();
 unchanged(f,{...p,schemaDigest:EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1},'SCHEMA_VERSION_TOO_NEW');
 unchanged(f,{...p,target:{...p.target,database:{...p.target.database,inode:'1'}}},'MAINTENANCE_TARGET_MISMATCH');
 unchanged(f,p,'MAINTENANCE_PACKET_INVALID',{authorization:{}});
 unchanged(f,p,'MAINTENANCE_AUTHORIZATION_DENIED',{authorization:{...authorizationFor(p),packetDigest:'sha256:'+'0'.repeat(64)}});
 unchanged(f,p,'MAINTENANCE_RUNTIME_MISMATCH',{runtime:{...f.runtime,sourceRevision:'3'.repeat(40)}});
 unchanged(f,f.packet('registerResource',registerCommand()),'MAINTENANCE_SCHEMA11_INITIALIZE_ONLY');
});
test('Schema11 initialization rolls back atomically on final authorization refusal',t=>{
 const f=fixture(t), before=f.state();
 assert.throws(()=>f.execute(f.packet(),{beforeCommitDecision(){throw Object.assign(new Error(),{code:'MAINTENANCE_ADAPTER_APPROVAL_DENIED'});}}),{code:'MAINTENANCE_ADAPTER_APPROVAL_DENIED'});
 assert.equal(f.state(),before);assert.equal(f.execute().exactReplay,false);
});
test('Schema11 initialization exact replay never resets later counters or reprojects business state',t=>{
 const f=fixture(t);f.execute();f.write(db=>db.exec('UPDATE revision_counters SET schedule_revision=9,projection_revision=10 WHERE id=1'));
 const after=f.state();assert.equal(f.execute().exactReplay,true);assert.equal(f.state(),after);
});


test('Schema11 rollback-journal initialization rolls back all effects when final approval is refused',t=>{
 const f=fixture(t);f.write(db=>db.exec('PRAGMA journal_mode=DELETE'));
 const before=f.state();let sawJournal=false;
 assert.throws(()=>f.execute(f.packet(),{beforeCommit(){sawJournal=existsSync(join(f.root,'synthetic.sqlite-journal'));},beforeCommitDecision(){throw Object.assign(new Error(),{code:'MAINTENANCE_ADAPTER_APPROVAL_DENIED'});}}),{code:'MAINTENANCE_ADAPTER_APPROVAL_DENIED'});
 assert.equal(sawJournal,true);assert.equal(f.state(),before);assert.equal(existsSync(join(f.root,'synthetic.sqlite-journal')),false);
});
test('a pre-existing rollback journal is uncertain state and is rejected before opening the database',t=>{
 const f=fixture(t);f.write(db=>db.exec('PRAGMA journal_mode=DELETE'));
 const filename=join(f.root,'synthetic.sqlite'), before=readFileSync(filename);
 writeFileSync(filename+'-journal','synthetic unclassified journal');
 assert.throws(()=>f.execute(),{code:'MAINTENANCE_STORAGE_NOT_EMPTY'});
 assert.deepEqual(readFileSync(filename),before);assert.equal(readFileSync(filename+'-journal','utf8'),'synthetic unclassified journal');
});
