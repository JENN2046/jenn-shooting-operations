import { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertKnownSchema, MIGRATIONS } from './sqlite-schema-v2.mjs';
import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1,
  isSchedulingIdentifierV1 } from './scheduling-contract-v1.mjs';
import { normalizeRegisterSchedulingResourceV1, normalizePublishSchedulingConfigV1,
  normalizeActivateSchedulingConfigV1 } from './scheduling-admin-contract-v1.mjs';
import { createSqliteSchedulingAdminStoreV1 } from './sqlite-scheduling-admin-store-v1.mjs';
import { refreshSqliteSnapshotProjectionsV2 } from './sqlite-run-event-store-v2.mjs';
import { assertSchedulingQuiescenceV1 } from './sqlite-scheduling-quiescence-v1.mjs';
import { resolveOrphanCleanupControlRoot } from './store.mjs';
import { createOrphanCleanupControl } from './orphan-cleanup-control.mjs';

const normalizers = Object.freeze({ registerResource: normalizeRegisterSchedulingResourceV1,
  publishConfig: normalizePublishSchedulingConfigV1, activateConfig: normalizeActivateSchedulingConfigV1 });
const digest = value => digestCanonicalJsonSchedulingV1(value);
const json = value => canonicalJsonSchedulingV1(value);
export const EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1 = digest(MIGRATIONS.slice(0, 10).map(({ version, name, checksum }) =>
  ({ version, name, checksum })));
export function digestEmptyDbMaintenancePacketV1(packet) { return digest(packet); }
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function requireValue(condition, code) { if (!condition) fail(code); }
function exact(value, keys) {
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)
      && Object.getOwnPropertyDescriptor(value, key)?.enumerable
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')), 'MAINTENANCE_PACKET_INVALID');
}
function metadata(path, directory) {
  const stat = lstatSync(path, { bigint: true });
  requireValue(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile())
    && (directory || stat.nlink === 1n), 'MAINTENANCE_TARGET_AMBIGUOUS');
  return { device: String(stat.dev), inode: String(stat.ino) };
}
/** Filesystem checks shared by the synthetic port and the privately admitted offline helper. */
function bindMaintenanceFiles(root, databaseName, offline = false) {
  requireValue(!offline || (root === '/maintenance-data' && databaseName === 'shooting-operations.sqlite'
    && realpathSync(root) === root), 'MAINTENANCE_OFFLINE_TARGET_REQUIRED');
  if (!offline) {
    requireValue(typeof root === 'string' && root === resolve(root)
    && dirname(root) === realpathSync(tmpdir()) && /^jso-empty-maintenance-[A-Za-z0-9_-]+$/u.test(basename(root))
    && realpathSync(root) === root, 'MAINTENANCE_LOCAL_TARGET_REQUIRED');
  }
  const rootStat = lstatSync(root);
  requireValue(rootStat.isDirectory() && (rootStat.mode & 0o077) === 0
    && rootStat.uid === process.getuid(), 'MAINTENANCE_LOCAL_TARGET_REQUIRED');
  const database = metadata(join(root, databaseName), false);
  const cleanupRoot = resolveOrphanCleanupControlRoot({ filename: join(root, databaseName) });
  const cleanupIdentity = metadata(cleanupRoot, true);
  const state = createOrphanCleanupControl({ controlRoot: cleanupRoot, writable: false }).status();
  requireValue(state.state === 'disabled' && state.markerValid && state.epoch
    && !state.transitionLocked && state.activeRuns === 0, 'MAINTENANCE_CLEANUP_NOT_FENCED');
  metadata(join(cleanupRoot, 'disabled.json'), false);
  requireValue(readdirSync(cleanupRoot).every(name => name === 'disabled.json' || name === 'runs'),
    'MAINTENANCE_CLEANUP_NOT_FENCED');
  if (readdirSync(cleanupRoot).includes('runs')) {
    metadata(join(cleanupRoot, 'runs'), true);
    requireValue(readdirSync(join(cleanupRoot, 'runs')).length === 0, 'MAINTENANCE_CLEANUP_NOT_FENCED');
  }
  const parent = dirname(cleanupRoot); metadata(parent, true);
  requireValue(readdirSync(parent).length === 1, 'MAINTENANCE_CLEANUP_NOT_FENCED');
  return { root, ...(offline ? { databaseName, storageRoot: metadata(root, true) } : {}), database,
    uploads: metadata(join(root, 'uploads'), true), cleanup: { ...cleanupIdentity,
      markerDigest: digest({ markerBytes: readFileSync(join(cleanupRoot, 'disabled.json'), 'utf8') }) } };
}
export function bindLocalEmptyDbMaintenanceTargetV1(root) {
  return bindMaintenanceFiles(root, 'synthetic.sqlite');
}
/** Trusted offline helper port; independent admission belongs to the host adapter. */
export function bindOfflineEmptyDbMaintenanceTargetV1() {
  return bindMaintenanceFiles('/maintenance-data', 'shooting-operations.sqlite', true);
}
function validate(packet, authorization, runtime, offline = false) {
  exact(packet, ['schemaVersion', 'operationId', 'kind', 'actor', 'approvalRef', 'target',
    'runtime', 'schemaDigest', 'businessTimeZone', 'expected', 'command', ...(offline ? ['adapterBinding'] : [])]);
  if (offline) exact(packet.adapterBinding, ['host', 'storage', 'fence']);
  exact(packet.runtime, ['sourceRevision', 'imageId']);
  exact(runtime, ['sourceRevision', 'imageId']);
  exact(packet.target, offline ? ['root', 'databaseName', 'storageRoot', 'database', 'uploads', 'cleanup']
    : ['root', 'database', 'uploads', 'cleanup']);
  if (offline) exact(packet.target.storageRoot, ['device', 'inode']);
  exact(packet.target.cleanup, ['device', 'inode', 'markerDigest']);
  requireValue(/^sha256:[a-f0-9]{64}$/u.test(packet.target.cleanup.markerDigest), 'MAINTENANCE_TARGET_INVALID');
  for (const binding of [packet.target.database, packet.target.uploads]) {
    exact(binding, ['device', 'inode']);
    requireValue(/^\d+$/u.test(binding.device) && /^\d+$/u.test(binding.inode), 'MAINTENANCE_TARGET_INVALID');
  }
  exact(packet.expected, ['scheduleRevision', 'projectionRevision']);
  exact(authorization, ['scope', 'actor', 'approvalRef', 'packetDigest', 'writeAdmission',
    'cleanup', 'kiosk', 'writersStopped']);
  requireValue(packet.schemaVersion === 1 && isSchedulingIdentifierV1(packet.operationId)
    && !packet.operationId.startsWith('PROD-GF-15-')
    && isSchedulingIdentifierV1(packet.actor) && packet.actor !== 'system:scheduling-invalidation-v1'
    && isSchedulingIdentifierV1(packet.approvalRef)
    && (packet.kind === 'initialize' || Object.hasOwn(normalizers, packet.kind))
    && Object.values(packet.expected).every(value => Number.isSafeInteger(value) && value >= 0)
    && packet.businessTimeZone === 'Asia/Shanghai'
    && packet.schemaDigest === EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1
    && /^[a-f0-9]{40}$/u.test(packet.runtime.sourceRevision)
    && /^sha256:[a-f0-9]{64}$/u.test(packet.runtime.imageId), 'MAINTENANCE_PACKET_INVALID');
  requireValue(json(packet.runtime) === json(runtime), 'MAINTENANCE_RUNTIME_MISMATCH');
  requireValue(authorization.scope === (offline ? 'OFFLINE_ADAPTER_TRUST_PORT' : 'LOCAL_SYNTHETIC')
    && authorization.actor === packet.actor && authorization.approvalRef === packet.approvalRef
    && authorization.packetDigest === digest(packet)
    && authorization.writeAdmission === 'disabled' && authorization.cleanup === 'disabled'
    && authorization.kiosk === 'disabled' && authorization.writersStopped === true,
  'MAINTENANCE_AUTHORIZATION_DENIED');
  if (packet.kind === 'initialize') {
    requireValue(packet.command === null && Object.values(packet.expected).every(value => value === 0),
      'MAINTENANCE_PACKET_INVALID');
  } else {
    const admitted = normalizers[packet.kind](packet.command);
    requireValue(admitted.ok && packet.command.operationId === packet.operationId,
      'MAINTENANCE_COMMAND_INVALID');
    if (packet.kind === 'registerResource') requireValue(
      admitted.command.expectedScheduleRevision === packet.expected.scheduleRevision
      && admitted.command.expectedProjectionRevision === packet.expected.projectionRevision,
    'MAINTENANCE_COMMAND_INVALID');
    if (packet.kind === 'activateConfig') requireValue(
      admitted.command.expectedProjectionRevision === packet.expected.projectionRevision,
    'MAINTENANCE_COMMAND_INVALID');
    if (packet.kind === 'publishConfig') requireValue(
      admitted.command.configJson.businessTimeZone === packet.businessTimeZone,
    'MAINTENANCE_TIMEZONE_MISMATCH');
  }
}
function binding(packet) {
  return { target: packet.target, runtime: packet.runtime, schemaDigest: packet.schemaDigest,
    businessTimeZone: packet.businessTimeZone, actor: packet.actor,
    ...(packet.adapterBinding ? { adapterBinding: packet.adapterBinding } : {}) };
}
function assertTarget(packet, offline = false) {
  requireValue(json(offline ? bindOfflineEmptyDbMaintenanceTargetV1() : bindLocalEmptyDbMaintenanceTargetV1(packet.target.root)) === json(packet.target),
    'MAINTENANCE_TARGET_MISMATCH');
  const uploads = join(packet.target.root, 'uploads');
  requireValue(readdirSync(uploads).length === 1 && readdirSync(uploads)[0] === '.cleanup', 'MAINTENANCE_UPLOADS_NOT_EMPTY');
  metadata(join(uploads, '.cleanup'), true);
  requireValue(readdirSync(join(uploads, '.cleanup')).length === 0, 'MAINTENANCE_UPLOADS_NOT_EMPTY');
  const name = offline ? 'shooting-operations.sqlite' : 'synthetic.sqlite';
  const allowed = new Set([name, `${name}-wal`, `${name}-shm`, 'uploads', '.orphan-cleanup-control']);
  requireValue(readdirSync(packet.target.root).every(name => allowed.has(name)), 'MAINTENANCE_STORAGE_NOT_EMPTY');
  for (const suffix of ['-wal', '-shm']) {
    const path = join(packet.target.root, `${name}${suffix}`);
    // SQLite may remove disposable sidecars when a concurrent last connection closes.
    // An absent sidecar is permitted; existing links or ambiguous files still fail.
    try { metadata(path, false); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function assertSchema(db) {
  const known = assertKnownSchema(db, { migrations: MIGRATIONS.slice(0, 10) });
  requireValue(known.version === 10,
    'MAINTENANCE_SCHEMA_UNSUPPORTED');
  requireValue(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok'
    && db.prepare('PRAGMA foreign_key_check').all().length === 0, 'MAINTENANCE_DATABASE_INVALID');
}
function tables(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    .map(row => row.name);
}
function count(db, table) { return db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n; }
function assertEmptyLegacy(db) {
  const rows = db.prepare('SELECT * FROM schedule_state').all();
  requireValue(rows.length === 1 && rows[0].id === 1 && rows[0].revision === 0, 'MAINTENANCE_LEGACY_NOT_EMPTY');
  const expected = { schemaVersion: 1, revision: 0, updatedAt: rows[0].updated_at,
    products: [], tasks: [], sessions: [] };
  requireValue(json(JSON.parse(rows[0].snapshot_json)) === json(expected), 'MAINTENANCE_LEGACY_NOT_EMPTY');
}
function assertFresh(db) {
  assertEmptyLegacy(db);
  requireValue(count(db, 'sqlite_sequence') === 0, 'MAINTENANCE_DATABASE_NOT_EMPTY');
  for (const table of tables(db)) {
    if (!['schema_migrations', 'schedule_state'].includes(table)) {
      requireValue(count(db, table) === 0, 'MAINTENANCE_DATABASE_NOT_EMPTY');
    }
  }
}
function assertConfigOnly(db) {
  assertEmptyLegacy(db);
  const allowed = new Set(['schema_migrations', 'schedule_state', 'revision_counters', 'snapshot_projections',
    'empty_db_initialization', 'empty_db_maintenance_operations', 'audit_log', 'scheduling_resources',
    'scheduling_admin_operations', 'scheduling_config_versions', 'scheduling_active_config', 'scheduling_config_activations']);
  for (const table of tables(db)) if (!allowed.has(table)) {
    requireValue(count(db, table) === 0, 'MAINTENANCE_NONCONFIG_FACTS_EXIST');
  }
  const packets = count(db, 'empty_db_maintenance_operations');
  requireValue(count(db, 'scheduling_admin_operations') === packets
    && count(db, 'audit_log') === packets + 1
    && db.prepare("SELECT 1 FROM audit_log WHERE action <> 'emptyDbMaintenanceV1' LIMIT 1").get() === undefined,
  'MAINTENANCE_UNBOUND_CONTROL_FACTS');
  requireValue(count(db, 'revision_counters') === 1 && count(db, 'snapshot_projections') === 2,
    'MAINTENANCE_BASELINE_INVALID');
  const rows = db.prepare('SELECT * FROM empty_db_maintenance_operations').all();
  const initial = db.prepare('SELECT * FROM empty_db_initialization WHERE id = 1').get();
  const actor = JSON.parse(initial.binding_json).actor;
  const audits = db.prepare('SELECT * FROM audit_log').all();
  for (const row of [initial, ...rows]) {
    const receipt = replay(row, row.packet_digest);
    requireValue(audits.filter(audit => audit.entity_id === row.operation_id && audit.role === actor
      && audit.result === row.packet_digest).length === 1, 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    if (row === initial) continue;
    const admitted = normalizers[row.kind]?.(receipt.command);
    const admin = db.prepare('SELECT * FROM scheduling_admin_operations WHERE operation_id = ?').get(row.operation_id);
    requireValue(admitted?.ok && receipt.operationId === row.operation_id && receipt.kind === row.kind
      && admin?.kind === row.kind && admin.command_digest === admitted.commandDigest
      && admin.created_at === receipt.adminCreatedAt,
    'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    const { ok, exactReplay, ...adminResult } = receipt.result;
    requireValue(ok === true && exactReplay === false && json(adminResult) === json(JSON.parse(admin.response_json)),
      'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    if (row.kind === 'registerResource') {
      const resource = db.prepare('SELECT * FROM scheduling_resources WHERE resource_id = ?').get(receipt.result.resourceId);
      const command = admitted.command.resource;
      requireValue(resource && resource.source_operation_id === row.operation_id
        && resource.v1_display_place === command.v1DisplayPlace && resource.status === command.status
        && resource.capability_digest === command.capabilityDigest
        && json(JSON.parse(resource.capability_json)) === json(command.capabilityJson),
      'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    } else if (row.kind === 'publishConfig') {
      const command = admitted.command;
      const published = db.prepare('SELECT * FROM scheduling_config_versions WHERE config_version = ?')
        .get(command.configVersion);
      requireValue(published && published.schema_version === 1
        && published.algorithm_version === command.algorithmVersion
        && published.calendar_compiler_version === command.calendarCompilerVersion
        && published.estimate_policy_version === command.estimatePolicyVersion
        && published.config_digest === command.configDigest
        && json(JSON.parse(published.config_json)) === json(command.configJson)
        && published.published_by === actor && published.published_at === receipt.adminCreatedAt
        && published.publish_operation_id === row.operation_id,
      'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    } else if (row.kind === 'activateConfig') {
      const activation = db.prepare('SELECT * FROM scheduling_config_activations WHERE operation_id = ?')
        .get(row.operation_id);
      requireValue(activation && activation.command_digest === admitted.commandDigest
        && activation.previous_config_version === receipt.previousConfigVersion
        && activation.config_version === admitted.command.configVersion
        && activation.projection_revision === receipt.result.projectionRevision
        && activation.activated_by === actor && activation.activated_at === receipt.adminCreatedAt,
      'MAINTENANCE_UNBOUND_CONTROL_FACTS');
    }
  }
  const registrations = rows.filter(row => row.kind === 'registerResource').length;
  const publications = rows.filter(row => row.kind === 'publishConfig').length;
  const activations = rows.filter(row => row.kind === 'activateConfig').length;
  const counter = db.prepare('SELECT * FROM revision_counters WHERE id = 1').get();
  requireValue(count(db, 'scheduling_resources') === registrations
    && count(db, 'scheduling_config_versions') === publications
    && count(db, 'scheduling_config_activations') === activations
    && count(db, 'scheduling_active_config') === (activations > 0 ? 1 : 0)
    && counter.schedule_revision === registrations && counter.projection_revision === registrations + activations,
  'MAINTENANCE_UNBOUND_CONTROL_FACTS');
  if (activations > 0) {
    const last = db.prepare('SELECT * FROM scheduling_config_activations ORDER BY projection_revision DESC LIMIT 1').get();
    const active = db.prepare('SELECT * FROM scheduling_active_config WHERE id = 1').get();
    requireValue(active?.activation_operation_id === last.operation_id
      && active.config_version === last.config_version && active.projection_revision === last.projection_revision
      && active.activated_at === last.activated_at, 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
  }
  for (const projection of db.prepare('SELECT * FROM snapshot_projections').all()) {
    requireValue(projection.revision === counter.projection_revision
      && (projection.projection_name === 'schedule-v1-compat' || projection.schedule_revision === counter.schedule_revision),
    'MAINTENANCE_BASELINE_INVALID');
  }
}
function replay(row, packetDigest) {
  requireValue(row.packet_digest === packetDigest, 'MAINTENANCE_IDEMPOTENCY_CONFLICT');
  const response = JSON.parse(row.response_json);
  requireValue(digest(response) === row.response_digest, 'MAINTENANCE_RECEIPT_INVALID');
  return { ...response, exactReplay: true };
}
function audit(db, packet, at, revision) {
  db.prepare(`INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
    VALUES ('emptyDbMaintenanceV1', ?, ?, ?, ?, ?)`).run(packet.actor, packet.operationId,
      revision, digest(packet), at);
}
/** Explicit local trust port. Caller must stop other writers/cleanup before invoking. */
function executeMaintenance({ packet, authorization, runtime,
  now = () => new Date(), beforeCommit = () => {}, beforeCommitDecision = () => {} } = {}, offline = false) {
  // Seal caller objects before entering filesystem/SQLite code; never rewrite or infer fields.
  validate(packet, authorization, runtime, offline);
  packet = JSON.parse(json(packet));
  const packetDigest = digest(packet);
  assertTarget(packet, offline);
  const databasePath = join(packet.target.root, offline ? 'shooting-operations.sqlite' : 'synthetic.sqlite');
  const readonly = new DatabaseSync(databasePath, { readOnly: true });
  try { readonly.exec('PRAGMA busy_timeout = 5000'); assertSchema(readonly); } finally { readonly.close(); }
  assertTarget(packet, offline);
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
    let commitAttempted = false;
    try {
      assertTarget(packet, offline); assertSchema(db);
      assertSchedulingQuiescenceV1({ db, now });
      const initial = db.prepare('SELECT * FROM empty_db_initialization WHERE id = 1').get();
      const at = now().toISOString();
      let response;
      if (packet.kind === 'initialize') {
        if (initial) {
          requireValue(initial.operation_id === packet.operationId, 'MAINTENANCE_ALREADY_INITIALIZED');
          response = replay(initial, packetDigest);
        } else {
          assertFresh(db);
          db.prepare(`INSERT INTO revision_counters (id, schedule_revision, projection_revision, updated_at)
            VALUES (1, 0, 0, ?)`).run(at);
          refreshSqliteSnapshotProjectionsV2({ db, businessTimeZone: packet.businessTimeZone,
            projectionRevision: 0, scheduleRevision: 0, updatedAt: at });
          response = { ok: true, kind: 'initialize', operationId: packet.operationId,
            packetDigest, scheduleRevision: 0, projectionRevision: 0, initializedAt: at };
          db.prepare(`INSERT INTO empty_db_initialization
            (id, operation_id, packet_digest, binding_json, response_json, response_digest, created_at)
            VALUES (1, ?, ?, ?, ?, ?, ?)`).run(packet.operationId, packetDigest,
              json(binding(packet)), json(response), digest(response), at);
          audit(db, packet, at, 0);
          response = { ...response, exactReplay: false };
        }
      } else {
        requireValue(initial && initial.binding_json === json(binding(packet)), 'MAINTENANCE_INITIALIZATION_REQUIRED');
        requireValue(packet.operationId !== initial.operation_id, 'MAINTENANCE_IDEMPOTENCY_CONFLICT');
        // Receipt digest remains independently checked on every configuration invocation.
        replay(initial, initial.packet_digest);
        const prior = db.prepare('SELECT * FROM empty_db_maintenance_operations WHERE operation_id = ?')
          .get(packet.operationId);
        if (prior) response = replay(prior, packetDigest);
        else {
          assertConfigOnly(db);
          const current = db.prepare('SELECT * FROM revision_counters WHERE id = 1').get();
          requireValue(current.schedule_revision === packet.expected.scheduleRevision
            && current.projection_revision === packet.expected.projectionRevision, 'MAINTENANCE_REVISION_CONFLICT');
          requireValue(!db.prepare('SELECT 1 FROM scheduling_admin_operations WHERE operation_id = ?')
            .get(packet.operationId), 'MAINTENANCE_UNBOUND_CONTROL_FACTS');
          const admin = createSqliteSchedulingAdminStoreV1({ db, now,
            transactionRunner: (connection, work) => {
              requireValue(connection.isTransaction, 'MAINTENANCE_TRANSACTION_REQUIRED'); return work();
            }, refreshProjections: args => refreshSqliteSnapshotProjectionsV2({ ...args,
              businessTimeZone: packet.businessTimeZone }) });
          const previousConfigVersion = packet.kind === 'activateConfig'
            ? db.prepare('SELECT config_version FROM scheduling_active_config WHERE id = 1').get()?.config_version ?? null
            : null;
          const result = admin[packet.kind](packet.command, packet.actor);
          requireValue(result.ok && result.exactReplay === false, result.code ?? 'MAINTENANCE_ADMIN_REJECTED');
          const adminCreatedAt = db.prepare('SELECT created_at FROM scheduling_admin_operations WHERE operation_id = ?')
            .get(packet.operationId).created_at;
          response = { ok: true, kind: packet.kind, operationId: packet.operationId, packetDigest,
            command: packet.command, result, completedAt: at, adminCreatedAt,
            ...(packet.kind === 'activateConfig' ? { previousConfigVersion } : {}) };
          db.prepare(`INSERT INTO empty_db_maintenance_operations
            (operation_id, initialization_id, packet_digest, kind, response_json, response_digest, created_at)
            VALUES (?, 1, ?, ?, ?, ?, ?)`).run(packet.operationId, packetDigest, packet.kind,
              json(response), digest(response), at);
          const revision = db.prepare('SELECT projection_revision FROM revision_counters WHERE id = 1').get().projection_revision;
          audit(db, packet, at, revision);
          response = { ...response, exactReplay: false };
        }
      }
      beforeCommit({ db, response });
      assertTarget(packet, offline);
      // The offline helper performs a final local deadline check after all slow observations.
      beforeCommitDecision();
      commitAttempted = true;
      db.exec('COMMIT');
      return response;
    } catch (error) {
      let rolledBack = false; try { db.exec('ROLLBACK'); rolledBack = true; } catch {}
      if (offline && rolledBack && !commitAttempted && Object.isExtensible(error)) {
        error.transactionOutcome = 'ROLLED_BACK_BEFORE_COMMIT';
      }
      throw error;
    }
  } finally { db.close(); }
}

export function executeLocalEmptyDbMaintenanceV1(options) { return executeMaintenance(options); }
/** Internal trusted helper port. Never wire directly to HTTP/startup or a caller assertion. */
export function executeOfflineEmptyDbMaintenanceTransactionV1(options) { return executeMaintenance(options, true); }
