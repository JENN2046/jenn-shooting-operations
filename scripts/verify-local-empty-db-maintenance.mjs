// Run only inside a newly built candidate with --network none and no published ports.
// Arguments are externally observed OCI revision and immutable local image ID.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ScheduleStore } from '../src/store.mjs';
import { bindLocalEmptyDbMaintenanceTargetV1, EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1,
  digestEmptyDbMaintenancePacketV1 } from '../src/empty-db-maintenance-v1.mjs';
import { digestResourceCapabilitiesV1 } from '../src/scheduling-contract-v1.mjs';
import { normalizeSchedulingConfigV1, SCHEDULING_CALENDAR_COMPILER_VERSION_V1 } from '../src/scheduling-admin-contract-v1.mjs';
const [sourceRevision, imageId] = process.argv.slice(2);
assert.equal(process.argv.length, 4); assert.match(sourceRevision, /^[a-f0-9]{40}$/u);
assert.match(imageId, /^sha256:[a-f0-9]{64}$/u);
const runtime = { sourceRevision, imageId };
const root = mkdtempSync(join(tmpdir(), 'jso-empty-maintenance-'));
const packetsRoot = mkdtempSync(join(tmpdir(), 'jso-maintenance-packets-'));
const filename = join(root, 'synthetic.sqlite'), uploadRoot = join(root, 'uploads');
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const result = { status: 'LOCAL_SYNTHETIC_MAINTENANCE_PASS', recordedAt: new Date().toISOString(),
  runtime, schemaVersion: 10, productionAccessed: false, network: 'none', hostPortsPublished: false,
  deviceAcceptance: 'NOT_RUN', externalAcceptance: 'NOT_RUN', productionAuthorization: 'NOT_GRANTED', packets: [] };
function inspect() {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const rows = Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const identity = statSync(filename, { bigint: true });
    return { logicalDigest: hash(JSON.stringify(rows)), counts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])),
      device: String(identity.dev), inode: String(identity.ino) };
  } finally { db.close(); }
}
try {
  mkdirSync(uploadRoot);
  let store = new ScheduleStore({ filename, uploadRoot, writeAdmissionMode: 'disabled', orphanCleanupMode: 'disabled' });
  store.close();
  const target = bindLocalEmptyDbMaintenanceTargetV1(root);
  const initial = inspect(); assert.equal(initial.counts.revision_counters, 0);
  result.before = initial;
  const packet = (kind, operationId, command = null, expected = { scheduleRevision: 0, projectionRevision: 0 }) =>
    ({ schemaVersion: 1, kind, operationId, command, expected, actor: 'local:maintenance-owner',
      approvalRef: 'local:synthetic-candidate-r1', target, runtime,
      schemaDigest: EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1, businessTimeZone: 'Asia/Shanghai' });
  function invoke(value) {
    const authorization = { scope: 'LOCAL_SYNTHETIC', actor: value.actor, approvalRef: value.approvalRef,
      packetDigest: digestEmptyDbMaintenancePacketV1(value), writeAdmission: 'disabled', cleanup: 'disabled', kiosk: 'disabled', writersStopped: true };
    const paths = ['packet', 'authorization', 'runtime'].map(name => join(packetsRoot, `${name}.json`));
    [value, authorization, runtime].forEach((object, index) => writeFileSync(paths[index], JSON.stringify(object), { mode: 0o600 }));
    const child = spawnSync(process.execPath, ['scripts/local-empty-db-maintenance.mjs', '--local-synthetic', ...paths], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  }
  const initialization = packet('initialize', 'LOCAL-INIT-01');
  result.packets.push(invoke(initialization));
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
  const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
  const register = packet('registerResource', 'LOCAL-RESOURCE-01', { operationId: 'LOCAL-RESOURCE-01',
    expectedScheduleRevision: 0, expectedProjectionRevision: 0, resource: { resourceId: 'LOCAL-STUDIO-01',
      v1DisplayPlace: 'Local synthetic studio', status: 'active', capabilityJson, capabilityDigest } });
  result.packets.push(invoke(register));
  const normalized = normalizeSchedulingConfigV1({ schemaVersion: 1, businessTimeZone: 'Asia/Shanghai',
    resourceCalendars: [{ resourceId: 'LOCAL-STUDIO-01', capabilityDigest,
      weeklyWindows: [{ weekday: 4, start: '09:00', end: '17:00' }], dateOverrides: [] }],
    durationFallbackRules: [{ ruleId: 'default', productionType: null, shootingSubtype: null, durationMs: 3600000 }],
    bufferRules: [], softScoringWeights: { LIGHTING_SWITCH: 0, REFLECTIVITY_SEQUENCE: 0, IDLE_GAP: 0,
      EXPECTED_OVERRUN: 0, DESIRED_DATE_MISS: 0 }, compatibleAlgorithmVersions: ['local-r1'] });
  assert(normalized.ok);
  const publish = packet('publishConfig', 'LOCAL-PUBLISH-01', { operationId: 'LOCAL-PUBLISH-01',
    configVersion: 'local-r1', algorithmVersion: 'local-r1', calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
    estimatePolicyVersion: 'local-r1', configJson: normalized.config, configDigest: normalized.configDigest },
  { scheduleRevision: 1, projectionRevision: 1 });
  result.packets.push(invoke(publish)); assert.equal(inspect().counts.scheduling_active_config, 0);
  result.publicationDidNotActivate = true;
  const activate = packet('activateConfig', 'LOCAL-ACTIVATE-01', { operationId: 'LOCAL-ACTIVATE-01', configVersion: 'local-r1', expectedProjectionRevision: 1 },
    { scheduleRevision: 1, projectionRevision: 1 });
  result.packets.push(invoke(activate));
  const committed = inspect();
  store = new ScheduleStore({ filename, uploadRoot, writeAdmissionMode: 'disabled', orphanCleanupMode: 'disabled' });
  assert(store.writeAdmissionControl.isDisabled()); assert.equal(store.getOrphanCleanupControlStatus().state, 'disabled'); store.close();
  for (const value of [initialization, register, publish, activate]) assert.equal(invoke(value).exactReplay, true);
  assert.deepEqual(inspect(), committed); result.after = committed;
  result.reopenAndReplayFactFree = true;
  assert.equal(committed.counts.empty_db_initialization, 1); assert.equal(committed.counts.empty_db_maintenance_operations, 3);
  assert.equal(committed.counts.audit_log, 4); assert.equal(committed.counts.production_events, 0);
  assert.equal(committed.counts.gf15_control_receipts, 0); assert.equal(committed.counts.kiosk_smoke_runtime_session, 0);
  assert.equal(initial.device, committed.device); assert.equal(initial.inode, committed.inode);
  console.log(JSON.stringify(result, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); rmSync(packetsRoot, { recursive: true, force: true }); }
