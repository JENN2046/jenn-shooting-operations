// Never connects to an existing DB. Probe only a newly created local scratch DB.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, initializeWritableSchema, assertKnownSchema } from '../src/sqlite-schema-v2.mjs';
const [outputArg, oldRootArg] = process.argv.slice(2);
assert(outputArg && oldRootArg && process.argv.length === 4,
  'Usage: verify-release-schema-compatibility.mjs <new-output-directory> <read-only-old-source-root>');
const output = resolve(outputArg);
assert(!existsSync(output), 'Existing output is never modified');
const old = await import(pathToFileURL(join(resolve(oldRootArg), 'src/sqlite-schema-v2.mjs')));
assert.equal(old.LATEST_SCHEMA_VERSION, 6);
assert.deepEqual(MIGRATIONS.slice(0, 6), old.MIGRATIONS, 'Old migration checksums/SQL must match exactly');
mkdirSync(output, { recursive: true, mode: 0o700 });
const databasePath = join(output, 'synthetic-prefix.sqlite');
let db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys=ON;');
initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 6) });
assert.equal(old.assertKnownSchema(db).version, 6);
const stages = [];
for (const version of [7, 8, 9]) {
  initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, version) });
  assert.equal(assertKnownSchema(db, { migrations: MIGRATIONS.slice(0, version) }).version, version);
  let oldError;
  try { old.assertKnownSchema(db); } catch (error) { oldError = error.code; }
  assert.equal(oldError, 'SCHEMA_VERSION_TOO_NEW');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  stages.push({ version, candidateCompatible: true, oldRuntimeResult: oldError });
}
// Control evidence persists; a same-image disabled restart does not erase ownership.
db.prepare('INSERT INTO kiosk_smoke_runtime_session VALUES (1, ?)').run('LOCAL-SYNTHETIC-OWNER');
db.close();
db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys=ON;');
initializeWritableSchema(db);
assert.equal(db.prepare('SELECT session_id FROM kiosk_smoke_runtime_session').get().session_id,
  'LOCAL-SYNTHETIC-OWNER');
assert.throws(() => db.exec('DELETE FROM kiosk_smoke_runtime_session'), /permanent/);
db.close();
const result = { status: 'LOCAL_SCHEMA_COMPATIBILITY_PROBE_PASS', productionDatabaseAccessed: false,
  oldSourceRevision: '92b7137211bf807f178901e878a8c3d6e335cec4', oldLatestVersion: 6,
  unchangedMigrationPrefix: [1, 2, 3, 4, 5, 6], stages,
  currentImageReopenPreservesRuntimeOwner: true, oldImageOnlyRollbackAfterMigration: 'INCOMPATIBLE',
  migrations: MIGRATIONS.map(({ version, name, checksum }) => ({ version, name, checksum })) };
writeFileSync(join(output, 'schema-evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
