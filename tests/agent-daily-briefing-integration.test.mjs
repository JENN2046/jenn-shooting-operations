import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSchedulingV2Application} from '../src/server.mjs';
import {createJsoAgentBoundary} from '../src/jso-agent-host-v1.mjs';
import {createWriteAdmissionControl} from '../src/write-admission-v1.mjs';
import {createTrustedPrincipal} from '../src/authorization-v2.mjs';
import {initializeWritableSchema, MIGRATIONS} from '../src/sqlite-schema-v2.mjs';
import {JSO_AGENT_COMMANDS} from '../src/jso-agent-api-v1.mjs';
import {studioDayFixture, studioNow, databaseFacts} from './support/studio-day-fixture.mjs';

const TOKEN = 'SYNTHETIC_BRIEFING_PLANNER_TOKEN'.padEnd(48, 'p');
const principal = ids => createTrustedPrincipal({subjectId: 'synthetic-reader', role: 'viewer', resourceIds: ids}).principal;
const read = resourceScope => ({resourceScope});
const disabledStore = f => ({db: f.server.store.db, writeAdmissionControl: createWriteAdmissionControl({initialMode: 'disabled'})});
const application = (f, options = {}) => createSchedulingV2Application({store: disabledStore(f),
  authenticate: () => null, clock: () => new Date(studioNow), ...options});

test('Schema12 viewer read_state includes snapshot-bound briefing while disabled and query-only, without private catalogue data', async () => {
  const f = await studioDayFixture();
  try {
    const db = f.server.store.db, app = application(f), before = databaseFacts(db);
    const changes = db.prepare('SELECT total_changes() AS n').get().n;
    db.exec('PRAGMA query_only=ON');
    const state = app.agentService.readState({principal: principal([f.resourceId]), command: read([f.resourceId])});
    assert.equal(state.ok, true); assert.equal(state.writeAdmission, 'disabled');
    assert.ok(state.resources.length); assert.ok(state.sessions.length); assert.ok(state.orders.length); assert.ok(state.progress.length);
    const b = state.dailyBriefing;
    assert.equal(b.ok, true); assert.equal(b.readonly, true);
    assert.deepEqual(b.revisions, {...state.revisions}); assert.equal(b.observedAt, studioNow);
    assert.equal(b.sections.current.item.id, f.current.id);
    assert.equal(b.sections.current.item.forecast.operationId, 'STUDIO-FORECAST');
    assert.equal(b.sections.next.item.id, f.next.id);
    assert.equal(b.sections.readyOrders.state, 'unknown'); assert.deepEqual(b.sections.readyOrders.items, []);
    assert.equal(b.sections.attention.state, 'unknown');
    assert.ok(b.issues.some(row => row.code === 'ORDER_ESTIMATES_NOT_EXPOSED'));
    assert.ok(!b.sections.attention.items.some(row => ['DURATION_MISSING', 'UNSCHEDULED_READY'].includes(row.code)));
    assert.ok(!JSON.stringify(b).includes('durationEstimateJson'));
    assert.equal(databaseFacts(db), before);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  } finally { f.close(); }
});

test('exact requested subset is preserved even for a principal allowed both resources, including cross-bound private names', async () => {
  const f = await studioDayFixture();
  try {
    const db = f.server.store.db, other = 'SYNTHETIC-OTHER-RESOURCE';
    const resource = db.prepare('SELECT * FROM scheduling_resources WHERE resource_id=?').get(f.resourceId);
    resource.resource_id = other; resource.v1_display_place = 'SYNTHETIC-PRIVATE-RESOURCE';
    resource.source_operation_id = 'SYNTHETIC-REGISTER-OTHER';
    const insert = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    insert('scheduling_resources', resource);
    const row = db.prepare('SELECT * FROM schedule_items WHERE id=?').get(f.current.id);
    row.id = 'SYNTHETIC-PRIVATE-SESSION'; row.source_ordinal = 999; row.resource_id = other; row.note = 'SYNTHETIC-PRIVATE-NOTE';
    insert('schedule_items', row);
    db.prepare('INSERT INTO schedule_item_tasks VALUES (?,?,0,?,?)').run(row.id, f.current.requestIds[0], studioNow, studioNow);
    db.prepare('UPDATE requests_v2 SET name=? WHERE id=?').run('SYNTHETIC-PRIVATE-CROSS-BOUND-NAME', f.current.requestIds[0]);
    const app = application(f), before = databaseFacts(db);
    db.exec('PRAGMA query_only=ON');
    const state = app.agentService.readState({principal: principal([f.resourceId, other]), command: read([f.resourceId])});
    assert.equal(state.ok, true);
    assert.equal(state.unassignedOrdersIncluded, false);
    for (const marker of [other, 'SYNTHETIC-PRIVATE-SESSION', 'SYNTHETIC-PRIVATE-RESOURCE',
      'SYNTHETIC-PRIVATE-CROSS-BOUND-NAME', 'SYNTHETIC-PRIVATE-NOTE']) assert.ok(!JSON.stringify(state).includes(marker), marker);
    assert.equal(state.dailyBriefing.sections.current.item.id, f.current.id);
    assert.equal(state.dailyBriefing.sections.current.item.name, '订单名称未提供');
    assert.equal(databaseFacts(db), before);
    assert.equal(app.agentService.readState({principal: principal([other]), command: read([f.resourceId])}).code, 'FORBIDDEN');
  } finally { f.close(); }
});

test('unavailable enrichment preserves the old successful response and does not reflect an internal error', async () => {
  const f = await studioDayFixture();
  try {
    const app = application(f, {clock: () => {throw Error('SYNTHETIC_PRIVATE_READER_ERROR');}});
    const before = databaseFacts(f.server.store.db);
    const state = app.agentService.readState({principal: principal([f.resourceId]), command: read([f.resourceId])});
    assert.equal(state.ok, true); assert.ok(state.sessions.length);
    assert.deepEqual(state.dailyBriefing, {ok: false, code: 'DAILY_BRIEFING_UNAVAILABLE'});
    assert.ok(!JSON.stringify(state).includes('SYNTHETIC_PRIVATE_READER_ERROR'));
    assert.equal(databaseFacts(f.server.store.db), before);
  } finally { f.close(); }
});

test('Schema11 response shape is unchanged and never invokes the new observation clock', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeWritableSchema(db, {migrations: MIGRATIONS.slice(0, 11)});
    db.prepare('INSERT INTO revision_counters VALUES (1,0,0,?)').run(studioNow);
    const app = createSchedulingV2Application({store: {db, writeAdmissionControl: createWriteAdmissionControl({initialMode: 'disabled'})},
      authenticate: () => null, clock: () => assert.fail('Schema11 must not enrich')});
    db.exec('PRAGMA query_only=ON');
    const state = app.agentService.readState({principal: principal(['SYNTHETIC']), command: read(['SYNTHETIC'])});
    assert.equal(state.ok, true); assert.ok(!Object.hasOwn(state, 'dailyBriefing'));
    assert.deepEqual(Object.keys(state).sort(), ['ok','revisions','resources','sessions','activeConfig','writeAdmission'].sort());
  } finally { db.close(); }
});

test('a concurrent revision commit does not mix a newer briefing into the existing read snapshot', async () => {
  const f = await studioDayFixture(); let writer;
  try {
    const db = f.server.store.db;
    db.exec('PRAGMA journal_mode=WAL'); writer = new DatabaseSync(f.filename);
    const before = db.prepare('SELECT schedule_revision AS scheduleRevision,projection_revision AS projectionRevision FROM revision_counters').get();
    let called = false;
    const app = application(f, {clock: () => {
      assert.equal(called, false); called = true;
      writer.exec('UPDATE revision_counters SET schedule_revision=schedule_revision+1,projection_revision=projection_revision+1');
      return new Date(studioNow);
    }});
    const changes = db.prepare('SELECT total_changes() AS n').get().n;
    const state = app.agentService.readState({principal: principal([f.resourceId]), command: read([f.resourceId])});
    assert.equal(called, true); assert.equal(state.dailyBriefing.ok, true);
    assert.deepEqual({...state.revisions}, {...before});
    assert.deepEqual(state.dailyBriefing.revisions, {...before});
    assert.equal(db.prepare('SELECT schedule_revision AS n FROM revision_counters').get().n, before.scheduleRevision + 1);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  } finally { writer?.close(); f.close(); }
});

async function httpFixture() {
  const f = await studioDayFixture();
  try {
    const boundary = createJsoAgentBoundary({store: disabledStore(f),
      identities: [{token: TOKEN, subjectId: 'synthetic-http-reader', mode: 'planner', resourceIds: [f.resourceId]}],
      clock: () => new Date(studioNow)});
    const server = createServer(boundary.handler);
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    return {...f, endpoint: `http://127.0.0.1:${server.address().port}/api/v2/agent/tools`,
      async shutdown() {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); f.close();}};
  } catch (error) {f.close(); throw error;}
}

test('actual Agent HTTP envelope carries the additive field without new commands or model authority', async () => {
  const f = await httpFixture();
  try {
    const before = databaseFacts(f.server.store.db);
    const call = (body, token = TOKEN) => fetch(f.endpoint, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify(body)});
    const args = {command: 'read_state', payload_json: JSON.stringify(read([f.resourceId]))};
    const response = await call(args), state = await response.json();
    assert.equal(response.status, 200); assert.equal(state.ok, true); assert.equal(state.dailyBriefing.ok, true);
    assert.ok(Array.isArray(state.sessions)); assert.ok(Array.isArray(state.orders)); assert.ok(Array.isArray(state.progress));
    assert.equal(state.agent.action, 'read_state'); assert.equal(state.agent.mode, 'planner'); assert.equal(state.agent.retry, 'NEVER_AUTOMATIC');
    const unauthorized = await call(args, 'wrong'); assert.equal(unauthorized.status, 401);
    assert.equal(Object.hasOwn(await unauthorized.json(), 'dailyBriefing'), false);
    assert.equal((await (await call({command: 'read_state', payload_json: JSON.stringify({resourceScope: [f.resourceId], role: 'administrator'})})).json()).ok, false);
    assert.equal((await (await call({command: 'reschedule', payload_json: '{}'})).json()).code, 'AGENT_SUGGEST_ONLY');
    assert.deepEqual(Object.keys(JSO_AGENT_COMMANDS).sort(), ['read_state','preview_calendar','preview_shift','propose_reschedule','generate_proposal','adopt_proposal','reschedule','read_receipt'].sort());
    assert.equal(databaseFacts(f.server.store.db), before);
  } finally {await f.shutdown();}
});

const PEER = process.env.JSO_BRIEFING_PEER_ROOT;
test('accepted Extensions stdio client preserves old read_state fields and the new scoped briefing', {skip: !PEER && 'optional fixed-source peer: set JSO_BRIEFING_PEER_ROOT'}, async () => {
  const f = await httpFixture();
  try {
    const manifest = JSON.parse(readFileSync(join(PEER, 'SOURCE.json'), 'utf8'));
    assert.equal(manifest.commit, '9f99d81de2ead9be75cda8447c3f9af095b50c6a');
    for (const [path, expected] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(join(PEER, path))).digest('hex'), expected);
    const before = databaseFacts(f.server.store.db);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(PEER, 'Plugin/JennShootingOperations/JsoAgentLocal.js')], {
        env: {PATH: '/tool:/usr/bin:/bin', JSO_LOCAL_AGENT_ENDPOINT: f.endpoint, JSO_LOCAL_AGENT_TOKEN: TOKEN,
          JSO_RESOURCE_IDS: f.resourceId, JSO_CALL_POLICY: 'read-only'}, stdio: ['pipe','pipe','pipe']});
      let stdout = '', stderr = '';
      const timer = setTimeout(() => {child.kill(); reject(Error('SYNTHETIC_PEER_TIMEOUT'));}, 20000);
      child.stdout.on('data', chunk => {stdout += chunk;}); child.stderr.on('data', chunk => {stderr += chunk;});
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('close', code => {clearTimeout(timer); code === 0 ? resolve(stdout) : reject(Error('SYNTHETIC_PEER_FAILED'));});
      child.stdin.end(JSON.stringify({command: 'read_state', payload_json: '{}', maid: 'synthetic-reader'}));
    });
    const response = JSON.parse(output);
    assert.equal(response.status, 'success'); assert.equal(response.result.ok, true);
    assert.ok(response.result.sessions.length); assert.ok(response.result.orders.length);
    assert.equal(response.result.dailyBriefing.ok, true);
    assert.deepEqual(response.result.dailyBriefing.revisions, response.result.revisions);
    assert.equal(response.result.dailyBriefing.sections.current.item.forecast.operationId, 'STUDIO-FORECAST');
    assert.equal(databaseFacts(f.server.store.db), before);
  } finally {await f.shutdown();}
});
