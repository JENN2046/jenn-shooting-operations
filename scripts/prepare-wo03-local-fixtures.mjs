// Disposable local preparation only. No listener, credential, provider or device setup.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { V1_SCHEMA_SQL, initializeWritableSchema, assertKnownSchema } from '../src/sqlite-schema-v2.mjs';
import { buildMigrationPlan, parseResourceMap, canonicalJson } from '../src/migration-v2.mjs';
import { readV1Source, resolveExistingPath } from '../src/migration-sqlite-v2.mjs';
import { materializeMigrationPlan } from '../src/migration-materialize-sqlite-v2.mjs';
import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createReadKioskCurrent } from '../src/kiosk-current-use-case-v2.mjs';
import { createSqliteKioskCurrentStore } from '../src/sqlite-kiosk-current-store-v2.mjs';

const [outputArg, fixtureArg] = process.argv.slice(2);
assert(outputArg && fixtureArg && process.argv.length === 4,
  'Usage: prepare-wo03-local-fixtures.mjs <new-output-directory> <synthetic-fixture-directory>');
const output = resolve(outputArg);
assert(!existsSync(output), 'Existing output is never modified');
const importedAt = '2026-10-15T00:00:00.000Z';
const readAt = '2026-10-15T01:30:00.000Z';
const resourceId = 'STUDIO-WO03-LOCAL-01';
const subjectId = 'KIOSK-WO03-LOCAL-01';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const result = { status: 'LOCAL_SYNTHETIC_FIXTURES_PREPARED_NOT_WO03_ACCEPTANCE',
  serviceContextProposal: 'WO03_ISOLATED_ACCEPTANCE', resourceId, subjectId,
  credentialCreated: false, listenerCreated: false, deviceAcceptance: 'NOT_RUN', fixtures: {} };
// Validate all inputs before creating output. These are synthetic data, never DB copies.
const inputs = Object.fromEntries(['single', 'grouped'].map(mode => {
  const bytes = readFileSync(join(resolve(fixtureArg), `${mode}.v1.json`));
  const snapshot = JSON.parse(bytes);
  assert(snapshot.tasks.length === (mode === 'single' ? 1 : 2));
  assert(snapshot.tasks.every(t => t.id.startsWith(`REQ-WO03-${mode.toUpperCase()}-`)
    && t.client === 'WO03 synthetic acceptance'));
  assert(snapshot.sessions.length === 1);
  assert(snapshot.sessions[0].id === `ITEM-WO03-${mode.toUpperCase()}-01`);
  assert(snapshot.sessions[0].place === 'WO03 TEST ONLY');
  return [mode, { bytes, snapshot }];
}));
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const [mode, { bytes, snapshot }] of Object.entries(inputs)) {
  const sourcePath = join(output, `${mode}-synthetic-source.sqlite`);
  const databasePath = join(output, `${mode}.sqlite`);
  const source = new DatabaseSync(sourcePath);
  source.exec(V1_SCHEMA_SQL);
  source.prepare('INSERT INTO schedule_state VALUES (1, ?, ?, ?)')
    .run(snapshot.revision, snapshot.updatedAt, JSON.stringify(snapshot));
  source.close();
  const map = parseResourceMap(JSON.stringify({ schemaVersion: 1,
    mapVersion: 'wo03-local-fixture-map-r1', businessTimeZone: 'Asia/Shanghai',
    places: { 'WO03 TEST ONLY': resourceId } }), 'Asia/Shanghai');
  const plan = buildMigrationPlan({ source: readV1Source(resolveExistingPath(sourcePath)),
    businessTimeZone: 'Asia/Shanghai', resourceMap: map, importedAt });
  copyFileSync(sourcePath, databasePath);
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
  initializeWritableSchema(db, { now: () => new Date(importedAt) });
  const materialization = materializeMigrationPlan({ db, plan, startedAt: importedAt,
    completedAt: '2026-10-15T00:00:01.000Z' });
  assert.equal(materialization.status, 'APPLIED');
  const schema = assertKnownSchema(db);
  const rows = Object.fromEntries(['requests_v2', 'schedule_items', 'schedule_item_tasks'].map(table =>
    [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()]));
  assert.equal(rows.schedule_items.length, 1);
  assert.equal(rows.schedule_items[0].allocation_mode, mode === 'single' ? 'single' : 'grouped_unallocated');
  assert.equal(rows.schedule_item_tasks.length, mode === 'single' ? 1 : 2);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const principal = createTrustedPrincipal({ subjectId, role: 'operator', resourceIds: [resourceId] }).principal;
  const current = createReadKioskCurrent({ store: createSqliteKioskCurrentStore({ db }),
    clock: () => new Date(readAt) })({ principal, resourceId });
  assert.equal(current.ok, true, current.code);
  assert.equal(current.dto.current.scheduleItemId, snapshot.sessions[0].id);
  assert.equal(current.dto.current.tasks.length, rows.schedule_item_tasks.length);
  db.close();
  const stat = statSync(databasePath, { bigint: true });
  result.fixtures[mode] = { inputByteDigest: digest(bytes), normalizedRowDigest: digest(canonicalJson(rows)),
    databaseFileDigest: digest(readFileSync(databasePath)), databasePath,
    databaseDevice: String(stat.dev), databaseInode: String(stat.ino), schema,
    scheduleItemId: snapshot.sessions[0].id, requestIds: snapshot.tasks.map(t => t.id),
    allocationMode: rows.schedule_items[0].allocation_mode,
    currentReadAtSyntheticClock: readAt, currentReadDigest: digest(canonicalJson(current.dto)),
    plannedStart: rows.schedule_items[0].planned_start, plannedEnd: rows.schedule_items[0].planned_end };
}
writeFileSync(join(output, 'fixture-evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
