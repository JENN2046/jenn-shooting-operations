import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { initializeWritableSchema, V1_SCHEMA_SQL } from '../../src/sqlite-schema-v2.mjs';
import { buildMigrationPlan } from '../../src/migration-v2.mjs';
import { materializeMigrationPlan } from '../../src/migration-materialize-sqlite-v2.mjs';
import { readV1Source, resolveExistingPath } from '../../src/migration-sqlite-v2.mjs';
import { createTrustedPrincipal } from '../../src/authorization-v2.mjs';
import { bindGf15WindowV1, GF15_IDS } from '../../src/gf15-contract-v1.mjs';
import { createSqliteGf15CapabilitiesV1 } from '../../src/sqlite-gf15-capabilities-v1.mjs';
import { createSqliteSchedulingQuiescenceV1 } from '../../src/sqlite-scheduling-quiescence-v1.mjs';
import { createSqliteSchedulingAdminStoreV1 } from '../../src/sqlite-scheduling-admin-store-v1.mjs';
import { normalizeSchedulingConfigV1 } from '../../src/scheduling-admin-contract-v1.mjs';
import { refreshSqliteSnapshotProjectionsV2 } from '../../src/sqlite-run-event-store-v2.mjs';

export function gf15Fixture({ path = ':memory:', prior = false, checkpoint, refresh, legacySnapshot } = {}) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  initializeWritableSchema(db);
  let instant = '2026-09-30T15:30:00.000Z'; // Asia/Shanghai 23:30.
  const now = () => new Date(instant);
  // Isolated empty-domain bootstrap; no GF15 request/resource/config/proposal/decision facts.
  if (legacySnapshot) {
    const sourcePath = join(dirname(path), 'legacy-source.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec(V1_SCHEMA_SQL);
    source.prepare('INSERT INTO schedule_state VALUES (1, ?, ?, ?)').run(legacySnapshot.revision,
      legacySnapshot.updatedAt, JSON.stringify(legacySnapshot));
    source.close();
    // Materialize historical requests through the existing canonical migration path.
    const plan = buildMigrationPlan({ source: readV1Source(resolveExistingPath(sourcePath)),
      businessTimeZone: 'Asia/Shanghai', resourceMap: null, importedAt: instant });
    db.prepare('INSERT INTO schedule_state VALUES (1, ?, ?, ?)').run(legacySnapshot.revision,
      legacySnapshot.updatedAt, JSON.stringify(legacySnapshot));
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    materializeMigrationPlan({ db, plan, startedAt: instant, completedAt: instant });
    db.exec('PRAGMA journal_mode = WAL;');
  } else db.prepare('INSERT INTO revision_counters VALUES (1, 0, 0, ?)').run(instant);
  const refreshProjections = refresh ?? (context => refreshSqliteSnapshotProjectionsV2({
    ...context, businessTimeZone: 'Asia/Shanghai', allowedBriefHosts: ['brief.example'] }));
  const principal = createTrustedPrincipal({ subjectId: 'scheduler:gf15-fixture', role: 'scheduler',
    resourceIds: [GF15_IDS.resource] }).principal;
  if (prior) {
    const config = normalizeSchedulingConfigV1({ schemaVersion: 1, businessTimeZone: 'Asia/Shanghai',
      resourceCalendars: [], durationFallbackRules: [], bufferRules: [],
      softScoringWeights: { LIGHTING_SWITCH: 0, REFLECTIVITY_SEQUENCE: 0, IDLE_GAP: 0,
        EXPECTED_OVERRUN: 0, DESIRED_DATE_MISS: 0 }, compatibleAlgorithmVersions: ['deterministic-scheduler-v1'] });
    const admin = createSqliteSchedulingAdminStoreV1({ db, now, refreshProjections });
    const published = admin.publishConfig({ operationId: 'prior-publish', configVersion: 'prior-config',
      algorithmVersion: 'deterministic-scheduler-v1', calendarCompilerVersion: 'calendar-compiler-v1',
      estimatePolicyVersion: 'estimate-policy-v1', configJson: config.config, configDigest: config.configDigest }, principal.subjectId);
    if (!published.ok) throw new Error(JSON.stringify(published));
    const activated = admin.activateConfig({ operationId: 'prior-activate', configVersion: 'prior-config',
      expectedProjectionRevision: 0 }, principal.subjectId);
    if (!activated.ok) throw new Error(JSON.stringify(activated));
  }
  const binding = bindGf15WindowV1({ desiredDate: '2026-10-01', start: '10:00', end: '10:20' });
  const quiescence = createSqliteSchedulingQuiescenceV1({ db, now });
  const lease = quiescence.acquire({ leaseId: 'fixture-forward', owner: principal.subjectId });
  const service = createSqliteGf15CapabilitiesV1({ db, now, refreshProjections,
    allowedBriefHosts: ['brief.example'], checkpoint });
  return { db, now, principal, binding, quiescence, lease, service, refreshProjections,
    setTime(value) { instant = value; },
    serviceWith(options) { return createSqliteGf15CapabilitiesV1({ db, now, refreshProjections,
      allowedBriefHosts: ['brief.example'], ...options }); } };
}
