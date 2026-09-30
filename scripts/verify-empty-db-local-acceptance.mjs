// Local synthetic acceptance ONLY inside the exact frozen no-network candidate image.
// /data must be a newly created isolated bind path; never mount production storage.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync, createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertKnownSchema } from '/app/src/sqlite-schema-v2.mjs';
import { createKioskRuntimeOptionsFromEnv } from '/app/src/server.mjs';
import { normalizeSchedulingConfigV1 } from '/app/src/scheduling-admin-contract-v1.mjs';
import { digestResourceCapabilitiesV1, canonicalJsonSchedulingV1 } from '/app/src/scheduling-contract-v1.mjs';
const [phase, reopenRoot] = process.argv.slice(2);
assert(['create', 'reopen', 'backup'].includes(phase));
assert.equal(process.argv.length, phase === 'create' ? 3 : 4);
const root = phase === 'create' ? mkdtempSync('/data/jso-empty-db-local-') : reopenRoot;
assert(/^\/data\/jso-empty-db-local-[A-Za-z0-9]+$/.test(root));
const RESOURCE = 'STUDIO-EMPTY-LOCAL-01', DEVICE = 'KIOSK-EMPTY-LOCAL-01';
const base = 'http://127.0.0.1:3800';
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// node:sqlite returns null-prototype rows; normalize only synthetic probe values.
const canonical = value => canonicalJsonSchedulingV1(JSON.parse(JSON.stringify(value)));
const result = { status: 'LOCAL_EMPTY_DB_ACCEPTANCE_PASS_NOT_WO03_DEVICE_ACCEPTANCE', phase,
  recordedAt: new Date().toISOString(), root, sourceRevision: '37ee97d5726d990e8f7178938eeb9b6c5f8b5424',
  immutableImageId: 'sha256:fd8a2fb03c86901e26c64389138bbc494491e8bf6025af1e22eec9e1f11113e7',
  network: 'none; private container loopback only; no published ports', productionDataAccessed: false,
  oldRecordsImported: false, productionCredentialsUsed: false, providerDeliveryAttempted: false,
  testCredentialPersisted: false, browserOfflineAcceptance: 'NOT_RUN', physicalDeviceAcceptance: 'NOT_RUN', cases: {} };
function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = assertKnownSchema(db);
    assert.equal(schema.version, 9);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r => r.name);
    const rows = Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
    const s = statSync(path, { bigint: true });
    return { schema, rows, counts: Object.fromEntries(names.map(name => [name, rows[name].length])),
      logicalDigest: hash(canonical(rows)), fileDigest: hash(readFileSync(path)),
      device: String(s.dev), inode: String(s.ino), path };
  } finally { db.close(); }
}
async function get(path, authorization) {
  const response = await fetch(base + path, { headers: authorization ? { Authorization: authorization } : {} });
  return { status: response.status, body: await response.json(), admission: response.headers.get('x-write-admission') };
}
async function event(command, authorization) {
  const response = await fetch(base + `/api/v2/schedule-items/${command.scheduleItemId}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: await response.json() };
}
async function server(path, { context = 'WO03_ISOLATED_ACCEPTANCE', configPath, enabled = false } = {}, action) {
  const env = { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '3800', DATABASE_PATH: path,
    UPLOAD_ROOT: join(path.slice(0, path.lastIndexOf('/')), 'uploads'), KIOSK_SERVICE_CONTEXT: context,
    WRITE_ADMISSION_MODE: enabled ? 'enabled' : 'disabled', ORPHAN_CLEANUP_MODE: 'disabled',
    ...(configPath ? { KIOSK_AUTH_CONFIG_PATH: configPath } : {}) };
  const child = spawn(process.execPath, ['/app/src/server.mjs'], { env, cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let diagnostic = '';
  child.stderr.on('data', bytes => { diagnostic += bytes; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error('Candidate exited before listen: ' + diagnostic);
      try { ready = (await get('/healthz')).status === 200; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready, diagnostic);
    const health = await get('/healthz'); assert.equal(health.admission, enabled ? 'enabled' : 'disabled');
    await action(health);
  } finally { child.kill('SIGTERM'); await exited; }
}
function auth() {
  const scratch = mkdtempSync('/tmp/jso-empty-auth-');
  const password = randomBytes(32).toString('base64url'), salt = randomBytes(16);
  const config = { schemaVersion: 1, authMode: 'basic-v1', realm: 'Local Empty DB Test', username: 'local-empty-test',
    deviceId: DEVICE, principal: { subjectId: DEVICE, role: 'operator', resourceIds: [RESOURCE] },
    businessTimeZone: 'Asia/Shanghai', allowedBriefHosts: [],
    credential: { algorithm: 'scrypt-v1', saltBase64: salt.toString('base64'), hashBase64: scryptSync(password, salt, 32).toString('base64') } };
  const configPath = join(scratch, 'auth.json'); writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  return { configPath, authorization: 'Basic ' + Buffer.from(config.username + ':' + password).toString('base64'),
    publicBinding: { deviceId: DEVICE, resourceIds: [RESOURCE], role: 'operator', businessTimeZone: 'Asia/Shanghai', productionIdentity: false },
    close() { rmSync(scratch, { recursive: true, force: true }); } };
}
function seed(path, mode) {
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  const now = new Date().toISOString(), start = new Date(Date.now() - 60000).toISOString(), end = new Date(Date.now() + 3600000).toISOString();
  const item = `ITEM-EMPTY-LOCAL-${mode.toUpperCase()}`, ids = Array.from({ length: mode === 'single' ? 1 : 2 }, (_, i) => `REQ-EMPTY-LOCAL-${mode.toUpperCase()}-${i + 1}`);
  try {
    assert.equal(db.prepare('SELECT count(*) n FROM migration_batches').get().n, 0);
    db.prepare('INSERT INTO revision_counters VALUES(1,0,0,?)').run(now);
    for (const [i, id] of ids.entries()) {
      db.prepare(`INSERT INTO requests_v2(id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,lighting_preset,reflectivity,production_type,shooting_subtype,aspect_ratio,deliverable_count)
        VALUES(?,?,?,?,?,'Synthetic only','细节','canonical','open','domain_command','workbench',?,0,0,'LIGHT-SOFT','low','平面','细节','1:1',1)`)
        .run(id, i, `SKU-EMPTY-${i}`, `Synthetic ${mode} request ${i + 1}`, 'LOCAL EMPTY DB TEST', now);
      db.prepare(`INSERT INTO scheduling_request_requirements VALUES(?,?,?,?,?)`).run(id, canonical(['FLAT']), canonical({ durationMs: 300000, source: 'explicit', sourceVersion: 'LOCAL-EMPTY-R1' }), now, `LOCAL-REQ-${i}`);
    }
    const capability = { schemaVersion: 1, capabilityIds: ['FLAT'] }, capabilityDigest = digestResourceCapabilitiesV1(capability);
    const config = normalizeSchedulingConfigV1({ schemaVersion: 1, businessTimeZone: 'Asia/Shanghai', resourceCalendars: [{ resourceId: RESOURCE, capabilityDigest,
      weeklyWindows: Array.from({ length: 7 }, (_, weekday) => ({ weekday: weekday + 1, start: '00:00', end: '23:59' })), dateOverrides: [] }],
      durationFallbackRules: [{ ruleId: 'local-duration', productionType: '平面', shootingSubtype: '细节', durationMs: 300000 }],
      bufferRules: [{ ruleId: 'local-buffer', productionType: '平面', shootingSubtype: '细节', bufferAfterMinutes: 0 }],
      softScoringWeights: { LIGHTING_SWITCH: 0, REFLECTIVITY_SEQUENCE: 0, IDLE_GAP: 0, EXPECTED_OVERRUN: 0, DESIRED_DATE_MISS: 0 }, compatibleAlgorithmVersions: ['deterministic-scheduler-v1'] });
    assert.equal(config.ok, true, JSON.stringify(config));
    db.prepare('INSERT INTO scheduling_resources VALUES(?,?,?,?,?,?,?,?)').run(RESOURCE, 'LOCAL TEST ONLY', 'active', canonical(capability), capabilityDigest, now, now, 'LOCAL-RESOURCE');
    db.prepare('INSERT INTO scheduling_config_versions VALUES(?,1,?,?,?,?,?,?,?,?)').run('LOCAL-CONFIG', 'deterministic-scheduler-v1', 'calendar-compiler-v1', 'estimate-policy-v1', config.configJson, config.configDigest, 'admin:local-test', now, 'LOCAL-PUBLISH');
    db.prepare('INSERT INTO scheduling_active_config VALUES(1,?,?,?,0)').run('LOCAL-CONFIG', now, 'LOCAL-ACTIVATE');
    db.prepare(`INSERT INTO schedule_items(id,source_ordinal,resource_id,resource_resolution_status,planned_start,planned_end,buffer_after_minutes,buffer_source,schedule_status,schedule_status_provenance,lock_status,lock_status_provenance,note,allocation_mode,source,imported_at)
      VALUES(?,0,?,'resolved',?,?,0,'LOCAL-CONFIG','confirmed','domain_command','unlocked','domain_command','LOCAL TEST ONLY',?,'human',?)`)
      .run(item, RESOURCE, start, end, mode === 'single' ? 'single' : 'grouped_unallocated', now);
    ids.forEach((id, i) => db.prepare('INSERT INTO schedule_item_tasks VALUES(?,?,?,?,?)').run(item, id, i, now, now));
    db.exec('COMMIT');
    const rows = Object.fromEntries(['requests_v2', 'schedule_items', 'schedule_item_tasks', 'scheduling_resources', 'scheduling_config_versions', 'scheduling_active_config', 'scheduling_request_requirements'].map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
    return { item, requestIds: ids, allocationMode: mode === 'single' ? 'single' : 'grouped_unallocated', setupMethod: 'Synthetic native-form SQL fixtures plus runtime config normalization; not production setup/API acceptance',
      fixtureDigest: hash(canonical(rows)), configDigest: config.configDigest, plannedStart: start, plannedEnd: end, migrationBatchCount: 0 };
  } finally { db.close(); }
}
function publicState(s) { const { rows, ...metadata } = s; return metadata; }
if (phase === 'create') {
  const dir = join(root, 'disabled'); mkdirSync(dir); const path = join(dir, 'fresh.sqlite'); assert(!existsSync(path));
  const starts = [];
  for (let i = 0; i < 2; i++) {
    await server(path, { context: 'PROD11_PRODUCTION' }, async health => {
      const read = await get('/api/v2/kiosk/current?resourceId=STUDIO-PROD-01'); assert.equal(read.status, 401); assert.equal(read.body.code, 'AUTH_NOT_CONFIGURED');
      const denied = await event({ scheduleItemId: 'LOCAL-DISABLED' }); assert.equal(denied.status, 503); assert.equal(denied.body.code, 'WRITE_ADMISSION_DISABLED');
      starts.push({ healthStatus: health.status, admission: health.admission, kioskReadStatus: read.status, kioskCode: read.body.code, writeStatus: denied.status, writeCode: denied.body.code });
    });
    const state = inspect(path); assert.equal(state.counts.requests_v2, 0); assert.equal(state.counts.schedule_items, 0); assert.equal(state.counts.production_events, 0); assert.equal(state.counts.migration_batches, 0);
    assert(Object.entries(state.counts).filter(([name]) => /^(gf15_|kiosk_smoke_)/.test(name)).every(([, n]) => n === 0)); starts[i].database = publicState(state);
  }
  assert.equal(starts[0].database.inode, starts[1].database.inode); assert.equal(starts[0].database.logicalDigest, starts[1].database.logicalDigest);
  result.cases.disabled = { starts, sameDatabaseIdentity: true, sameLogicalFacts: true };
  for (const mode of ['single', 'grouped']) {
    const dir = join(root, mode); mkdirSync(dir); const path = join(dir, 'fresh.sqlite'); assert(!existsSync(path));
    await server(path, {}, async () => {}); const before = inspect(path); assert.equal(before.counts.requests_v2, 0); assert.equal(before.counts.production_events, 0);
    const fixture = seed(path, mode), credential = auth(); const commands = [], responses = [];
    try {
      assert.throws(() => createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'PROD11_PRODUCTION', KIOSK_AUTH_CONFIG_PATH: credential.configPath }), /KIOSK_PRODUCTION_IDENTITY_MISMATCH/);
      assert.throws(() => createKioskRuntimeOptionsFromEnv({ KIOSK_SERVICE_CONTEXT: 'WO03_ISOLATED_ACCEPTANCE', KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID: fixture.item }), /KIOSK_CROSS_CONTEXT_BINDING/);
      assert.throws(() => createKioskRuntimeOptionsFromEnv({}), /KIOSK_SERVICE_CONTEXT_REQUIRED/);
      await server(path, { configPath: credential.configPath }, async () => {
        const denied = await event({ scheduleItemId: fixture.item }, credential.authorization); assert.equal(denied.status, 503); assert.equal(denied.body.code, 'WRITE_ADMISSION_DISABLED');
      });
      await server(path, { configPath: credential.configPath, enabled: true }, async health => {
        const unauth = await get('/api/v2/kiosk/current?resourceId=' + RESOURCE); assert.equal(unauth.status, 401);
        const wrongScope = await get('/api/v2/kiosk/current?resourceId=STUDIO-PROD-01', credential.authorization); assert.equal(wrongScope.status, 403);
        const current = await get('/api/v2/kiosk/current?resourceId=' + RESOURCE, credential.authorization); assert.equal(current.status, 200); assert.equal(current.body.current.scheduleItemId, fixture.item); assert.equal(current.body.current.tasks.length, fixture.requestIds.length);
        const runId = 'RUN-' + randomUUID();
        for (const [i, eventType] of ['start', 'block', 'resume', 'complete'].entries()) {
          const command = { schemaVersion: 2, eventId: 'EVENT-' + randomUUID(), runId, scheduleItemId: fixture.item, eventType,
            expectedRunRevision: i, localSequence: i, occurredAt: new Date().toISOString(), deviceId: DEVICE, ...(eventType === 'block' ? { reasonCode: 'sampleWaiting' } : {}) };
          const response = await event(command, credential.authorization); assert.equal(response.status, 201, JSON.stringify(response)); assert.equal(response.body.code, 'RUN_EVENT_APPLIED'); assert.equal(response.body.runRevision, i + 1); commands.push(command); responses.push(response.body);
        }
      });
      const after = inspect(path); assert.equal(after.counts.production_events, 4); assert.equal(after.counts.production_runs, 1); assert.equal(after.counts.notification_outbox, 1); assert.equal(after.counts.kiosk_smoke_runtime_session, 0); assert.equal(after.counts.migration_batches, 0);
      writeFileSync(join(dir, 'commands.json'), JSON.stringify(commands)); writeFileSync(join(dir, 'responses.json'), JSON.stringify(responses));
      result.cases[mode] = { fixture, identity: credential.publicBinding, firstEmptyDatabase: publicState(before), afterSequence: publicState(after), commandsDigest: hash(canonical(commands)), receiptDigest: hash(canonical(responses)),
        phases: ['start', 'block', 'resume', 'complete'], eventCount: 4, outboxCount: 1, providerDispatchWired: false, crossContextStartupRejected: true, noProductionResourceRead: true, authenticatedDisabledWriteRejected: true };
    } finally { credential.close(); }
  }
} else if (phase === 'reopen') {
  const created = JSON.parse(readFileSync(join(root, 'acceptance-create.json')));
  for (const mode of ['disabled', 'single', 'grouped']) {
    const path = join(root, mode, 'fresh.sqlite'), before = inspect(path), expected = mode === 'disabled' ? created.cases.disabled.starts[1].database : created.cases[mode].afterSequence;
    assert.equal(before.device, expected.device); assert.equal(before.inode, expected.inode); assert.equal(before.logicalDigest, expected.logicalDigest);
    if (mode === 'disabled') { await server(path, { context: 'PROD11_PRODUCTION' }, async health => { assert.equal(health.admission, 'disabled'); }); }
    else {
      const credential = auth(); try {
        await server(path, { configPath: credential.configPath, enabled: true }, async () => {
          const commands = JSON.parse(readFileSync(join(root, mode, 'commands.json'))), original = JSON.parse(readFileSync(join(root, mode, 'responses.json')));
          for (const [i, command] of commands.entries()) {
            const response = await event(command, credential.authorization); assert.equal(response.status, 200); assert.equal(response.body.replayed, true);
            const { replayed: ignored1, ...a } = response.body; const { replayed: ignored2, ...b } = original[i]; assert.deepEqual(a, b);
          }
        });
      } finally { credential.close(); }
    }
    const after = inspect(path); assert.equal(after.inode, before.inode); assert.equal(after.logicalDigest, before.logicalDigest);
    result.cases[mode] = { before: publicState(before), after: publicState(after), sameDatabaseIdentityAcrossContainerRecreation: true, exactReceiptReplayFactFree: mode !== 'disabled', cleanupRemainsDisabledByStartup: true };
  }
} else {
  for (const mode of ['single', 'grouped']) {
    const path = join(root, mode, 'fresh.sqlite'), before = inspect(path);
    const recovery = mkdtempSync(join(root, mode, 'synthetic-recovery-'));
    const backup = join(recovery, 'backup.sqlite'), restore = join(recovery, 'restored.sqlite');
    const db = new DatabaseSync(path);
    try { db.exec(`VACUUM INTO '${backup}'`); } finally { db.close(); }
    assert(!existsSync(restore)); copyFileSync(backup, restore);
    const restoredBefore = inspect(restore); assert.equal(restoredBefore.logicalDigest, before.logicalDigest);
    assert.notEqual(restoredBefore.inode, before.inode); assert.equal(hash(readFileSync(restore)), hash(readFileSync(backup)));
    const credential = auth();
    try {
      await server(restore, { configPath: credential.configPath, enabled: true }, async () => {
        const commands = JSON.parse(readFileSync(join(root, mode, 'commands.json')));
        for (const command of commands) { const response = await event(command, credential.authorization); assert.equal(response.status, 200); assert.equal(response.body.replayed, true); }
      });
    } finally { credential.close(); }
    const sourceAfter = inspect(path), restoredAfter = inspect(restore);
    assert.equal(sourceAfter.logicalDigest, before.logicalDigest); assert.equal(sourceAfter.inode, before.inode);
    assert.equal(restoredAfter.logicalDigest, before.logicalDigest);
    result.cases[mode] = { original: publicState(before), backupPath: backup, backupDigest: hash(readFileSync(backup)), restored: publicState(restoredAfter),
      sourceFactsAndIdentityUnchanged: true, restoredV9FactsReceiptsAndPendingOutboxPreserved: true, restoredExactReplayFactFree: true,
      restoredDatabaseIdentityDifferent: true, productionBackupOrRestore: false, attachmentRestoreCoverage: 'NO_ATTACHMENTS_IN_SYNTHETIC_FIXTURE' };
  }
}

writeFileSync(join(root, `acceptance-${phase}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
