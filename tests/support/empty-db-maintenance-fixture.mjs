import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveOrphanCleanupControlRoot } from '../../src/store.mjs';
import { createOrphanCleanupControl } from '../../src/orphan-cleanup-control.mjs';
import { initializeWritableSchema, MIGRATIONS } from '../../src/sqlite-schema-v2.mjs';
import { bindLocalEmptyDbMaintenanceTargetV1, EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1,
  digestEmptyDbMaintenancePacketV1, executeLocalEmptyDbMaintenanceV1 } from '../../src/empty-db-maintenance-v1.mjs';
import { digestResourceCapabilitiesV1 } from '../../src/scheduling-contract-v1.mjs';
import { normalizeSchedulingConfigV1, SCHEDULING_CALENDAR_COMPILER_VERSION_V1 } from '../../src/scheduling-admin-contract-v1.mjs';

// Explicit synthetic test tokens; these are not observed candidate/image evidence.
export const syntheticRuntime = { sourceRevision: '1'.repeat(40), imageId: `sha256:${'2'.repeat(64)}` };
export function authorizationFor(packet) {
  return { scope: 'LOCAL_SYNTHETIC', actor: packet.actor, approvalRef: packet.approvalRef,
    packetDigest: digestEmptyDbMaintenancePacketV1(packet), writeAdmission: 'disabled',
    cleanup: 'disabled', kiosk: 'disabled', writersStopped: true };
}
export function maintenanceFixture(runtime = syntheticRuntime) {
  const root = mkdtempSync(join(tmpdir(), 'jso-empty-maintenance-'));
  mkdirSync(join(root, 'uploads'));
  // Legacy maintenance is deliberately pinned to schema10; normal runtime now migrates to11.
  const filename = join(root, 'synthetic.sqlite');
  mkdirSync(join(root, 'uploads', '.cleanup'));
  const control = createOrphanCleanupControl({ controlRoot: resolveOrphanCleanupControlRoot({filename}) });
  if (!control.disable({reason:'store-startup',waitForDrainMs:0}).ok) throw new Error('FIXTURE_CONTROL_FAILED');
  const bootstrap = new DatabaseSync(filename);
  try {
    bootstrap.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
    initializeWritableSchema(bootstrap, {migrations:MIGRATIONS.slice(0,10)});
    const at = new Date().toISOString();
    bootstrap.prepare('INSERT INTO schedule_state VALUES (1,0,?,?)').run(at,JSON.stringify({schemaVersion:1,revision:0,updatedAt:at,products:[],tasks:[],sessions:[]}));
  } finally {bootstrap.close();}
  const target = bindLocalEmptyDbMaintenanceTargetV1(root);
  const packet = (kind = 'initialize', command = null, expected = { scheduleRevision: 0, projectionRevision: 0 }) =>
    ({ schemaVersion: 1, operationId: command?.operationId ?? 'LOCAL-INIT-01', kind,
      actor: 'local:maintenance-owner', approvalRef: 'local:synthetic-review-r1',
      target, runtime, schemaDigest: EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1,
      businessTimeZone: 'Asia/Shanghai', expected, command });
  function execute(value = packet(), overrides = {}) {
    return executeLocalEmptyDbMaintenanceV1({ packet: value, authorization: authorizationFor(value),
      runtime, now: () => new Date('2026-10-01T02:30:00.000Z'), ...overrides });
  }
  function read(work) {
    const db = new DatabaseSync(join(root, 'synthetic.sqlite'), { readOnly: true });
    try { return work(db); } finally { db.close(); }
  }
  function write(work) {
    const db = new DatabaseSync(join(root, 'synthetic.sqlite'));
    try { db.exec('PRAGMA foreign_keys = ON'); return work(db); } finally { db.close(); }
  }
  const state = () => read(db => JSON.stringify(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])));
  return { root, target, runtime, packet, execute, read, write, state,
    close: () => rmSync(root, { recursive: true, force: true }) };
}
export function registerCommand(expected = { scheduleRevision: 0, projectionRevision: 0 }) {
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
  return { operationId: 'LOCAL-RESOURCE-01', expectedScheduleRevision: expected.scheduleRevision,
    expectedProjectionRevision: expected.projectionRevision,
    resource: { resourceId: 'LOCAL-STUDIO-01', v1DisplayPlace: 'Local synthetic studio', status: 'active',
      capabilityJson, capabilityDigest: digestResourceCapabilitiesV1(capabilityJson) } };
}
export function publishCommand() {
  const resource = registerCommand().resource;
  const normalized = normalizeSchedulingConfigV1({ schemaVersion: 1, businessTimeZone: 'Asia/Shanghai',
    resourceCalendars: [{ resourceId: resource.resourceId, capabilityDigest: resource.capabilityDigest,
      weeklyWindows: [{ weekday: 4, start: '09:00', end: '17:00' }], dateOverrides: [] }],
    durationFallbackRules: [{ ruleId: 'default', productionType: null, shootingSubtype: null, durationMs: 3600000 }],
    bufferRules: [], softScoringWeights: { LIGHTING_SWITCH: 0, REFLECTIVITY_SEQUENCE: 0, IDLE_GAP: 0,
      EXPECTED_OVERRUN: 0, DESIRED_DATE_MISS: 0 }, compatibleAlgorithmVersions: ['local-r1'] });
  if (!normalized.ok) throw new Error('synthetic config invalid');
  return { operationId: 'LOCAL-PUBLISH-01', configVersion: 'local-r1', algorithmVersion: 'local-r1',
    calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V1, estimatePolicyVersion: 'local-r1',
    configJson: normalized.config, configDigest: normalized.configDigest };
}
