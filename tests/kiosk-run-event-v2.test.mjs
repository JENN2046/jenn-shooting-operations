import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import {
  createApplyKioskRunEvent,
  digestKioskRunEventCommand,
} from '../src/kiosk-run-event-use-case-v2.mjs';
import { digestRunEventResponse } from '../src/run-event-use-case-v2.mjs';
import { createSqliteKioskRunEventStore } from '../src/sqlite-kiosk-run-event-store-v2.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { normalizeSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';
import { canonicalJsonSchedulingV1, digestResourceCapabilitiesV1 } from '../src/scheduling-contract-v1.mjs';

const T0 = '2026-09-22T09:00:00.000Z';
const RECEIVED_AT = '2026-09-22T12:00:00.000Z';

function openDatabase(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

function seedBase(db, { projectionRevision = 10, scheduleRevision = 3 } = {}) {
  initializeWritableSchema(db, { now: () => new Date(T0) });
  db.prepare(`
    INSERT INTO migration_batches (
      id, identity_digest, migration_version, mapping_version, source_schema_version,
      source_revision, source_schema_digest, source_structural_digest, configuration_digest,
      resource_map_version, resource_map_digest, business_time_zone, status, started_at, completed_at
    ) VALUES ('BATCH-KIOSK', ?, 'v2-test', 'map-test', 1, 10, ?, ?, ?,
      'resource-test', ?, 'UTC', 'completed', ?, ?)
  `).run(
    `sha256:${'1'.repeat(64)}`,
    `sha256:${'2'.repeat(64)}`,
    `sha256:${'3'.repeat(64)}`,
    `sha256:${'4'.repeat(64)}`,
    `sha256:${'5'.repeat(64)}`,
    T0,
    T0,
  );
  db.prepare(`
    INSERT INTO revision_counters (id, projection_revision, schedule_revision, updated_at)
    VALUES (1, ?, ?, ?)
  `).run(projectionRevision, scheduleRevision, T0);
}

function seedRequest(db, id, sourceOrdinal) {
  db.prepare(`
    INSERT INTO requests_v2 (
      id, source_ordinal, sku, name, client, legacy_deliver_text, kind,
      legacy_v1_status, v1_status_mode, request_lifecycle, lifecycle_provenance,
      source, imported_at, v1_assets_present, v1_request_present,
      lighting_preset, reflectivity, migration_batch_id
    ) VALUES (?, ?, ?, ?, 'Client', 'Deliverable', '待定', 'scheduled',
      'legacy_exact', 'open', 'legacy_snapshot', 'import', ?, 0, 0,
      'unknown', 'unknown', 'BATCH-KIOSK')
  `).run(id, sourceOrdinal, `SKU-${sourceOrdinal}`, `Request ${sourceOrdinal}`, T0);
}

function seedSchedule(db, {
  suffix,
  sourceOrdinal,
  requestCount = 1,
  allocationMode = requestCount === 1 ? 'single' : 'grouped_unallocated',
  scheduleStatus = 'confirmed',
  resolutionStatus = 'resolved',
  scheduleId = `SCHEDULE-${suffix}`,
  resourceId = 'RESOURCE-A',
} = {}) {
  const requestIds = Array.from({ length: requestCount }, (_, index) => `REQUEST-${suffix}-${index + 1}`);
  requestIds.forEach((id, index) => seedRequest(db, id, sourceOrdinal + index));
  db.prepare(`
    INSERT INTO schedule_items (
      id, source_ordinal, resource_id, resource_resolution_status, resource_mapping_version,
      legacy_place_text, planned_start, planned_end, buffer_after_minutes, buffer_source,
      schedule_status, schedule_status_provenance, lock_status, lock_status_provenance,
      note, allocation_mode, source, source_ref, imported_at, migration_batch_id
    ) VALUES (?, ?, ?, ?, 'resource-test', 'Studio A', ?, ?, NULL,
      'legacy_unknown', ?, 'legacy_snapshot', NULL, 'legacy_unknown', '', ?,
      'migration', ?, ?, 'BATCH-KIOSK')
  `).run(
    scheduleId,
    sourceOrdinal,
    resourceId,
    resolutionStatus,
    '2026-09-22T09:00:00.000Z',
    '2026-09-22T14:00:00.000Z',
    scheduleStatus,
    allocationMode,
    `SOURCE-${suffix}`,
    T0,
  );
  const insertBinding = db.prepare(`
    INSERT INTO schedule_item_tasks (schedule_item_id, task_id, display_order, created_at, imported_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  requestIds.forEach((id, index) => insertBinding.run(scheduleId, id, index, T0, T0));
  return { scheduleId, requestIds };
}

function seedCompleteRunContextFacts(db, { requestId, scheduleId, resourceId = 'RESOURCE-A' }) {
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
  const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
  const config = {
    schemaVersion: 1,
    businessTimeZone: 'UTC',
    resourceCalendars: [{
      resourceId,
      capabilityDigest,
      weeklyWindows: [{ weekday: 2, start: '00:00', end: '23:59' }],
      dateOverrides: [],
    }],
    durationFallbackRules: [{
      ruleId: 'duration-flat',
      productionType: '平面',
      shootingSubtype: '细节',
      durationMs: 3_600_000,
    }],
    bufferRules: [{
      ruleId: 'buffer-flat',
      productionType: '平面',
      shootingSubtype: '细节',
      bufferAfterMinutes: 15,
    }],
    softScoringWeights: {
      LIGHTING_SWITCH: 1,
      REFLECTIVITY_SEQUENCE: 1,
      IDLE_GAP: 1,
      EXPECTED_OVERRUN: 1,
      DESIRED_DATE_MISS: 1,
    },
    compatibleAlgorithmVersions: ['deterministic-scheduler-v1'],
  };
  const admitted = normalizeSchedulingConfigV1(config);
  assert.equal(admitted.ok, true, JSON.stringify(admitted));

  db.prepare(`UPDATE requests_v2 SET production_type = '平面', shooting_subtype = '细节',
    aspect_ratio = '1:1', deliverable_count = 1, lighting_preset = 'LIGHT-SOFT',
    reflectivity = 'low' WHERE id = ?`).run(requestId);
  db.prepare(`UPDATE schedule_items SET buffer_after_minutes = 15, buffer_source = 'config-v1'
    WHERE id = ?`).run(scheduleId);
  db.prepare(`INSERT INTO scheduling_resources
    (resource_id, v1_display_place, status, capability_json, capability_digest,
     created_at, updated_at, source_operation_id)
    VALUES (?, 'Studio A', 'active', ?, ?, ?, ?, 'RESOURCE-CAPTURE-1')`).run(
    resourceId,
    canonicalJsonSchedulingV1(capabilityJson),
    capabilityDigest,
    T0,
    T0,
  );
  db.prepare(`INSERT INTO scheduling_request_requirements
    (request_id, required_capability_ids_json, duration_estimate_json, updated_at, source_operation_id)
    VALUES (?, ?, ?, ?, 'REQ-CAPTURE-1')`).run(
    requestId,
    canonicalJsonSchedulingV1(['FLAT']),
    canonicalJsonSchedulingV1({
      durationMs: 1_800_000,
      source: 'explicit',
      sourceVersion: 'fixture-v1',
    }),
    T0,
  );
  db.prepare(`INSERT INTO scheduling_config_versions
    (config_version, schema_version, algorithm_version, calendar_compiler_version,
     estimate_policy_version, config_json, config_digest, published_by, published_at,
     publish_operation_id)
    VALUES ('config-v1', 1, 'deterministic-scheduler-v1', 'calendar-compiler-v1',
      'estimate-policy-v1', ?, ?, 'admin:fixture', ?, 'CONFIG-PUBLISH-1')`).run(
    admitted.configJson,
    admitted.configDigest,
    T0,
  );
  db.prepare(`INSERT INTO scheduling_active_config
    (id, config_version, activated_at, activation_operation_id, projection_revision)
    VALUES (1, 'config-v1', ?, 'CONFIG-ACTIVATE-1', 10)`).run(T0);
  return { capabilityDigest, configDigest: admitted.configDigest };
}

function seedRun(db, {
  runId,
  scheduleId,
  taskId,
  scope = 'task',
  status = 'scheduled',
  runRevision = 0,
} = {}) {
  db.prepare(`
    INSERT INTO production_runs (
      id, schedule_item_id, scope, task_id, status, run_revision,
      blocked_duration_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(runId, scheduleId, scope, taskId ?? null, status, runRevision, T0, T0);
}

function principal(role = 'operator', resourceIds = ['RESOURCE-A']) {
  const created = createTrustedPrincipal({ subjectId: 'ACTOR-KIOSK', role, resourceIds });
  assert.equal(created.ok, true);
  return created.principal;
}

function makeApply(db, {
  receivedAt = RECEIVED_AT,
  projectV2,
} = {}) {
  const store = createSqliteKioskRunEventStore({
    db,
    businessTimeZone: 'UTC',
    allowedBriefHosts: [],
    ...(projectV2 ? { projectV2 } : {}),
  });
  return createApplyKioskRunEvent({ store, clock: () => new Date(receivedAt) });
}

function command({
  eventId,
  runId,
  scheduleId,
  eventType = 'start',
  expectedRunRevision = 0,
  occurredAt = RECEIVED_AT,
  localSequence = 1,
  ...rest
}) {
  return {
    schemaVersion: 2,
    eventId,
    runId,
    scheduleItemId: scheduleId,
    eventType,
    expectedRunRevision,
    occurredAt,
    deviceId: 'DEVICE-KIOSK',
    localSequence,
    ...(eventType === 'block' ? { reasonCode: 'sampleWaiting' } : {}),
    ...rest,
  };
}

function state(db) {
  return {
    runs: db.prepare('SELECT COUNT(*) AS count FROM production_runs').get().count,
    events: db.prepare('SELECT COUNT(*) AS count FROM production_events').get().count,
    reviews: db.prepare('SELECT COUNT(*) AS count FROM run_event_reviews').get().count,
    receipts: db.prepare(`
      SELECT COUNT(*) AS count FROM operations
      WHERE kind IN ('production.run-event', 'production.run-event-review')
    `).get().count,
    audits: db.prepare(`
      SELECT COUNT(*) AS count FROM audit_log
      WHERE action IN ('production.run-event', 'production.run-event-review')
    `).get().count,
    projections: db.prepare('SELECT COUNT(*) AS count FROM snapshot_projections').get().count,
    notifications: db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count,
    runContextSnapshots: db.prepare('SELECT COUNT(*) AS count FROM scheduling_run_context_snapshots').get().count,
    counters: { ...db.prepare('SELECT * FROM revision_counters WHERE id = 1').get() },
  };
}

async function withTemporaryDatabase(action) {
  const root = mkdtempSync(join(tmpdir(), 'jso-kiosk-run-event-'));
  const filename = join(root, 'kiosk.sqlite');
  const db = openDatabase(filename);
  try {
    return await action({ db, filename });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function runWorker({ filename, payload, startSignal }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { mode: 'apply-kiosk-run-event', filename, payload, startSignal },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`kiosk worker exited with ${code}`));
    });
  });
}

if (!isMainThread && workerData?.mode === 'apply-kiosk-run-event') {
  const db = openDatabase(workerData.filename);
  try {
    const signal = new Int32Array(workerData.startSignal);
    Atomics.wait(signal, 0, 0);
    parentPort.postMessage(makeApply(db)(workerData.payload));
  } finally {
    db.close();
  }
} else {
  test('first start derives task scope, injects trusted actor, and replays by local-sequence digest', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const seeded = seedSchedule(db, { suffix: 'FIRST', sourceOrdinal: 0 });
      const captureFacts = seedCompleteRunContextFacts(db, {
        requestId: seeded.requestIds[0],
        scheduleId: seeded.scheduleId,
      });
      const apply = makeApply(db);
      const input = command({
        eventId: 'EVENT-KIOSK-FIRST',
        runId: 'RUN-KIOSK-FIRST',
        scheduleId: seeded.scheduleId,
      });
      const response = apply({ command: input, principal: principal() });
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(response.replayed, false);
      assert.equal(response.runRevision, 1);
      assert.equal(response.projectionRevision, 11);
      assert.equal(response.scheduleRevision, 3);
      assert.deepEqual(
        { ...db.prepare(`
          SELECT id, schedule_item_id, scope, task_id, status, run_revision
          FROM production_runs WHERE id = 'RUN-KIOSK-FIRST'
        `).get() },
        {
          id: 'RUN-KIOSK-FIRST',
          schedule_item_id: seeded.scheduleId,
          scope: 'task',
          task_id: seeded.requestIds[0],
          status: 'shooting',
          run_revision: 1,
        },
      );
      const event = db.prepare(`
        SELECT actor_id, device_id, command_digest FROM production_events
        WHERE event_id = 'EVENT-KIOSK-FIRST'
      `).get();
      assert.equal(event.actor_id, 'ACTOR-KIOSK');
      assert.equal(event.device_id, 'DEVICE-KIOSK');
      assert.equal(db.prepare(`
        SELECT role FROM audit_log WHERE action = 'production.run-event'
      `).get().role, 'operator');
      const snapshotRow = db.prepare(`
        SELECT schema_version, context_status, snapshot_json, snapshot_digest, captured_at
        FROM scheduling_run_context_snapshots WHERE run_id = 'RUN-KIOSK-FIRST'
      `).get();
      assert.equal(snapshotRow.schema_version, 1);
      assert.equal(snapshotRow.context_status, 'complete');
      assert.equal(snapshotRow.captured_at, RECEIVED_AT);
      assert.equal(snapshotRow.snapshot_digest.startsWith('sha256:'), true);
      const snapshot = JSON.parse(snapshotRow.snapshot_json);
      assert.equal(snapshot.runId, 'RUN-KIOSK-FIRST');
      assert.equal(snapshot.requestId, seeded.requestIds[0]);
      assert.equal(snapshot.resourceId, 'RESOURCE-A');
      assert.deepEqual(snapshot.durationEstimate, {
        durationMs: 1_800_000,
        provenance: 'explicit',
        version: 'fixture-v1',
      });
      assert.equal(snapshot.bufferAfterMinutes, 15);
      assert.equal(snapshot.bufferSource, 'config-v1');
      assert.equal(snapshot.resourceCapabilityDigest, captureFacts.capabilityDigest);
      assert.equal(snapshot.configDigest, captureFacts.configDigest);
      assert.equal(state(db).runContextSnapshots, 1);
      assert.equal(
        event.command_digest,
        digestKioskRunEventCommand({
          ...input,
          reasonCode: null,
          note: null,
          actorId: 'ACTOR-KIOSK',
          actorRole: 'operator',
        }),
      );

      const beforeReplay = state(db);
      assert.equal(
        apply({ command: input, principal: principal('operator', ['RESOURCE-B']) }).code,
        'FORBIDDEN',
      );
      assert.deepEqual(apply({ command: input, principal: principal() }), { ...response, replayed: true });
      assert.deepEqual(state(db), beforeReplay);
      assert.equal(
        apply({ command: { ...input, localSequence: 2 }, principal: principal() }).code,
        'IDEMPOTENCY_KEY_REUSE',
      );
      assert.deepEqual(state(db), beforeReplay);
    } finally {
      db.close();
    }
  });

  test('authorization, active run identity, terminal history, and grouped completion fail closed', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const grouped = seedSchedule(db, {
        suffix: 'GROUPED', sourceOrdinal: 0, requestCount: 2,
      });
      const apply = makeApply(db);
      const start = command({
        eventId: 'EVENT-GROUPED-START',
        runId: 'RUN-GROUPED',
        scheduleId: grouped.scheduleId,
      });
      assert.equal(apply({ command: start, principal: principal('viewer') }).code, 'FORBIDDEN');
      assert.equal(apply({ command: start, principal: principal('operator', ['RESOURCE-B']) }).code, 'FORBIDDEN');
      assert.equal(apply({ command: start }).code, 'UNAUTHENTICATED');
      assert.equal(
        apply({ command: { ...start, actorId: 'FORGED' }, principal: principal() }).code,
        'INVALID_RUN_EVENT_COMMAND',
      );
      assert.equal(state(db).runs, 0);
      const groupedStart = apply({ command: start, principal: principal() });
      assert.equal(groupedStart.ok, true, JSON.stringify(groupedStart));
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0);
      assert.deepEqual(
        { ...db.prepare("SELECT scope, task_id FROM production_runs WHERE id = 'RUN-GROUPED'").get() },
        { scope: 'block', task_id: null },
      );
      const groupedSnapshot = db.prepare(`
        SELECT context_status, snapshot_json FROM scheduling_run_context_snapshots
        WHERE run_id = 'RUN-GROUPED'
      `).get();
      assert.equal(groupedSnapshot.context_status, 'ineligible');
      assert.equal(JSON.parse(groupedSnapshot.snapshot_json).ineligibleReason, 'GROUPED_UNALLOCATED');
      const mismatch = apply({
        command: command({
          eventId: 'EVENT-GROUPED-WRONG', runId: 'RUN-WRONG', scheduleId: grouped.scheduleId,
          eventType: 'complete', expectedRunRevision: 1,
        }),
        principal: principal(),
      });
      assert.equal(mismatch.code, 'RUN_ID_MISMATCH');
      const completed = apply({
        command: command({
          eventId: 'EVENT-GROUPED-DONE', runId: 'RUN-GROUPED', scheduleId: grouped.scheduleId,
          eventType: 'complete', expectedRunRevision: 1, occurredAt: '2026-09-22T12:04:00.000Z',
          localSequence: 2,
        }),
        principal: principal(),
      });
      assert.equal(completed.ok, true, JSON.stringify(completed));
      assert.equal(completed.resultingState, 'completed');
      const notification = db.prepare(`
        SELECT outbox_id, aggregate_revision, route_key, status, payload_json
        FROM notification_outbox
      `).get();
      assert.equal(notification.outbox_id, 'EVENT-GROUPED-DONE');
      assert.equal(notification.aggregate_revision, 2);
      assert.equal(notification.route_key, 'operations.default');
      assert.equal(notification.status, 'pending');
      assert.deepEqual(JSON.parse(notification.payload_json), {
        completedAt: '2026-09-22T12:04:00.000Z',
        netDurationMs: 4 * 60 * 1000,
        resourceId: 'RESOURCE-A',
        runId: 'RUN-GROUPED',
        runRevision: 2,
        scheduleItemId: grouped.scheduleId,
        scope: 'block',
        taskCount: 2,
      });
      const beforeReplay = state(db);
      assert.deepEqual(
        apply({
          command: command({
            eventId: 'EVENT-GROUPED-DONE', runId: 'RUN-GROUPED', scheduleId: grouped.scheduleId,
            eventType: 'complete', expectedRunRevision: 1, occurredAt: '2026-09-22T12:04:00.000Z',
            localSequence: 2,
          }),
          principal: principal(),
        }),
        { ...completed, replayed: true },
      );
      assert.deepEqual(state(db), beforeReplay);
      assert.deepEqual(
        db.prepare('SELECT request_lifecycle FROM requests_v2 ORDER BY id').all().map(row => row.request_lifecycle),
        ['open', 'open'],
      );
      const retryAsNewRun = apply({
        command: command({
          eventId: 'EVENT-GROUPED-RETAKE', runId: 'RUN-GROUPED-RETAKE', scheduleId: grouped.scheduleId,
          localSequence: 3,
        }),
        principal: principal(),
      });
      assert.equal(retryAsNewRun.code, 'RUN_PREPARATION_REQUIRED');
      assert.equal(state(db).runs, 1);
      assert.equal(state(db).counters.schedule_revision, 3);
      assert.equal(state(db).counters.projection_revision, 12);
    } finally {
      db.close();
    }
  });

  test('completion enqueue failure rolls back kiosk run facts, projections, receipt and outbox', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const seeded = seedSchedule(db, { suffix: 'OUTBOX-ROLLBACK', sourceOrdinal: 0 });
      const start = command({
        eventId: 'EVENT-KIOSK-OUTBOX-START',
        runId: 'RUN-KIOSK-OUTBOX-ROLLBACK',
        scheduleId: seeded.scheduleId,
      });
      assert.equal(makeApply(db)({ command: start, principal: principal() }).ok, true);
      const before = state(db);
      const projectionsBefore = db.prepare(`
        SELECT projection_name, revision, payload_json FROM snapshot_projections ORDER BY projection_name
      `).all().map(row => ({ ...row }));
      const baseStore = createSqliteKioskRunEventStore({
        db,
        businessTimeZone: 'UTC',
        allowedBriefHosts: [],
      });
      const rejectingStore = {
        withImmediateTransaction(action) {
          return baseStore.withImmediateTransaction(transaction => action({
            ...transaction,
            enqueueNotification() {
              return { ok: false, code: 'OUTBOX_TEST_REJECTED' };
            },
          }));
        },
      };
      const failed = createApplyKioskRunEvent({
        store: rejectingStore,
        clock: () => new Date('2026-09-22T12:01:00.000Z'),
      })({
        command: command({
          eventId: 'EVENT-KIOSK-OUTBOX-DONE',
          runId: 'RUN-KIOSK-OUTBOX-ROLLBACK',
          scheduleId: seeded.scheduleId,
          eventType: 'complete',
          expectedRunRevision: 1,
          occurredAt: '2026-09-22T12:01:00.000Z',
          localSequence: 2,
        }),
        principal: principal(),
      });
      assert.equal(failed.code, 'INTERNAL_ERROR');
      assert.deepEqual(state(db), before);
      assert.deepEqual(
        db.prepare(`
          SELECT projection_name, revision, payload_json FROM snapshot_projections ORDER BY projection_name
        `).all().map(row => ({ ...row })),
        projectionsBefore,
      );
    } finally {
      db.close();
    }
  });

  test('kiosk completion producer preserves 160-code-point run, schedule and resource identifiers', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const runId = 'R'.repeat(160);
      const scheduleId = 'S'.repeat(160);
      const resourceId = 'U'.repeat(160);
      const seeded = seedSchedule(db, {
        suffix: 'LONG',
        sourceOrdinal: 0,
        scheduleId,
        resourceId,
      });
      const trusted = principal('operator', [resourceId]);
      const apply = makeApply(db);
      assert.equal(apply({
        command: command({
          eventId: 'EVENT-KIOSK-LONG-START', runId, scheduleId,
          occurredAt: '2026-09-22T11:00:00.000Z',
        }),
        principal: trusted,
      }).ok, true);
      assert.equal(apply({
        command: command({
          eventId: 'EVENT-KIOSK-LONG-DONE', runId, scheduleId,
          eventType: 'complete', expectedRunRevision: 1,
          occurredAt: '2026-09-22T12:00:00.000Z', localSequence: 2,
        }),
        principal: trusted,
      }).ok, true);
      const notification = db.prepare(`
        SELECT aggregate_id, payload_json FROM notification_outbox
        WHERE outbox_id = 'EVENT-KIOSK-LONG-DONE'
      `).get();
      assert.equal(notification.aggregate_id, runId);
      assert.deepEqual(JSON.parse(notification.payload_json), {
        completedAt: '2026-09-22T12:00:00.000Z',
        netDurationMs: 60 * 60 * 1000,
        resourceId,
        runId,
        runRevision: 2,
        scheduleItemId: seeded.scheduleId,
        scope: 'task',
        taskCount: 1,
      });
    } finally {
      db.close();
    }
  });

  test('receipt admission preserves unrelated key reuse and fails closed for unowned kiosk receipts', () => {
    const input = command({
      eventId: 'EVENT-ORPHAN-RECEIPT',
      runId: 'RUN-ORPHAN-RECEIPT',
      scheduleId: 'SCHEDULE-ORPHAN-RECEIPT',
    });
    function applyWithReceipt(receipt) {
      return createApplyKioskRunEvent({
        clock: () => new Date(RECEIVED_AT),
        store: {
          withImmediateTransaction(action) {
            return action({ getKioskReceipt: () => receipt });
          },
        },
      });
    }

    assert.equal(
      applyWithReceipt({
        operation: { operation_id: input.eventId, kind: 'snapshot.replace' },
        event: null,
        review: null,
        resourceId: null,
      })({ command: input, principal: principal() }).code,
      'IDEMPOTENCY_KEY_REUSE',
    );
    assert.equal(
      applyWithReceipt({
        operation: { operation_id: input.eventId, kind: 'production.run-event' },
        event: null,
        review: null,
        resourceId: null,
      })({ command: input, principal: principal() }).code,
      'EVENT_RECEIPT_INTEGRITY_ERROR',
    );
    for (const receipt of [
      {
        operation: null,
        event: { event_id: input.eventId },
        review: null,
        resourceId: 'RESOURCE-A',
      },
      {
        operation: null,
        event: null,
        review: { event_id: input.eventId },
        resourceId: 'RESOURCE-A',
      },
    ]) {
      assert.equal(
        applyWithReceipt(receipt)({ command: input, principal: principal() }).code,
        'EVENT_RECEIPT_INTEGRITY_ERROR',
      );
    }
  });

  test('complete accepted replay cannot bypass resource authorization when ownership is unavailable', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const seeded = seedSchedule(db, { suffix: 'REPLAY-OWNER', sourceOrdinal: 0 });
      const input = command({
        eventId: 'EVENT-REPLAY-OWNER',
        runId: 'RUN-REPLAY-OWNER',
        scheduleId: seeded.scheduleId,
      });
      assert.equal(makeApply(db)({ command: input, principal: principal() }).ok, true);
      const baseStore = createSqliteKioskRunEventStore({
        db,
        businessTimeZone: 'UTC',
        allowedBriefHosts: [],
      });
      const apply = createApplyKioskRunEvent({
        clock: () => new Date(RECEIVED_AT),
        store: {
          withImmediateTransaction(action) {
            return baseStore.withImmediateTransaction(transaction => action({
              ...transaction,
              getKioskReceipt(eventId) {
                return { ...transaction.getKioskReceipt(eventId), resourceId: null };
              },
            }));
          },
        },
      });
      assert.equal(
        apply({ command: input, principal: principal() }).code,
        'EVENT_RECEIPT_INTEGRITY_ERROR',
      );
    } finally {
      db.close();
    }
  });

  test('accepted replay rebuilds history and rejects a jointly forged response digest', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const seeded = seedSchedule(db, { suffix: 'REPLAY-HISTORY', sourceOrdinal: 0 });
      const input = command({
        eventId: 'EVENT-REPLAY-HISTORY',
        runId: 'RUN-REPLAY-HISTORY',
        scheduleId: seeded.scheduleId,
      });
      const apply = makeApply(db);
      const original = apply({ command: input, principal: principal() });
      assert.equal(original.ok, true);
      const forged = { ...original, blockedDurationMs: 1234 };
      db.exec('DROP TRIGGER operations_protect_run_event_owner_update');
      db.exec('DROP TRIGGER operations_validate_run_event_owner_update');
      db.exec('DROP TRIGGER production_events_no_update');
      db.prepare('UPDATE operations SET response_json = ? WHERE operation_id = ?')
        .run(JSON.stringify(forged), input.eventId);
      db.prepare('UPDATE production_events SET response_digest = ? WHERE event_id = ?')
        .run(digestRunEventResponse(forged), input.eventId);

      assert.equal(
        apply({ command: input, principal: principal() }).code,
        'EVENT_RECEIPT_INTEGRITY_ERROR',
      );
    } finally {
      db.close();
    }
  });

  test('time boundaries allow events while out-of-window first start persists only pending review', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const futureBoundary = seedSchedule(db, { suffix: 'FUTURE-BOUNDARY', sourceOrdinal: 0 });
      const oldBoundary = seedSchedule(db, { suffix: 'OLD-BOUNDARY', sourceOrdinal: 10 });
      const reviewSchedule = seedSchedule(db, { suffix: 'REVIEW', sourceOrdinal: 20 });
      const apply = makeApply(db);
      for (const [label, schedule, occurredAt] of [
        ['FUTURE', futureBoundary, '2026-09-22T12:05:00.000Z'],
        ['OLD', oldBoundary, '2026-09-21T12:00:00.000Z'],
      ]) {
        const boundaryResult = apply({
          command: command({
            eventId: `EVENT-BOUNDARY-${label}`, runId: `RUN-BOUNDARY-${label}`,
            scheduleId: schedule.scheduleId, occurredAt,
          }),
          principal: principal(),
        });
        assert.equal(boundaryResult.ok, true, JSON.stringify(boundaryResult));
      }
      const beforeReview = state(db);
      const reviewCommand = command({
        eventId: 'EVENT-TIME-REVIEW',
        runId: 'RUN-TIME-REVIEW',
        scheduleId: reviewSchedule.scheduleId,
        occurredAt: '2026-09-22T12:05:00.001Z',
      });
      const review = apply({ command: reviewCommand, principal: principal() });
      assert.deepEqual(review, {
        schemaVersion: 2,
        ok: false,
        code: 'EVENT_TIME_REVIEW_REQUIRED',
        replayed: false,
        eventId: 'EVENT-TIME-REVIEW',
        runId: 'RUN-TIME-REVIEW',
        scheduleItemId: reviewSchedule.scheduleId,
        reviewStatus: 'pending',
        reviewReason: 'tooFarFuture',
        policyVersion: 'kiosk-event-time-local-v1',
        receivedAt: RECEIVED_AT,
      });
      const afterReview = state(db);
      assert.equal(afterReview.runs, beforeReview.runs);
      assert.equal(afterReview.events, beforeReview.events);
      assert.equal(afterReview.reviews, beforeReview.reviews + 1);
      assert.equal(afterReview.receipts, beforeReview.receipts + 1);
      assert.equal(afterReview.audits, beforeReview.audits + 1);
      assert.deepEqual(afterReview.counters, beforeReview.counters);
      assert.equal(
        db.prepare("SELECT actor_role FROM run_event_reviews WHERE event_id = 'EVENT-TIME-REVIEW'").get().actor_role,
        'operator',
      );

      db.prepare("UPDATE schedule_items SET schedule_status = 'cancelled' WHERE id = ?")
        .run(reviewSchedule.scheduleId);
      const beforeReplay = state(db);
      assert.deepEqual(apply({ command: reviewCommand, principal: principal() }), { ...review, replayed: true });
      assert.deepEqual(state(db), beforeReplay);
      assert.equal(
        apply({ command: { ...reviewCommand, localSequence: 2 }, principal: principal() }).code,
        'IDEMPOTENCY_KEY_REUSE',
      );
    } finally {
      db.close();
    }
  });

  test('stale revision precedes time review and projection failure rolls back first-start provisioning', () => {
    const db = openDatabase();
    try {
      seedBase(db);
      const staleSchedule = seedSchedule(db, { suffix: 'STALE', sourceOrdinal: 0 });
      seedRun(db, {
        runId: 'RUN-STALE', scheduleId: staleSchedule.scheduleId,
        taskId: staleSchedule.requestIds[0], status: 'shooting', runRevision: 1,
      });
      const apply = makeApply(db);
      const stale = apply({
        command: command({
          eventId: 'EVENT-STALE-REVIEW', runId: 'RUN-STALE', scheduleId: staleSchedule.scheduleId,
          eventType: 'block', expectedRunRevision: 0,
          occurredAt: '2026-09-20T00:00:00.000Z',
        }),
        principal: principal(),
      });
      assert.equal(stale.code, 'REVISION_CONFLICT');
      assert.equal(stale.currentRevision, 1);
      assert.equal(state(db).reviews, 0);

      const rollbackSchedule = seedSchedule(db, { suffix: 'ROLLBACK', sourceOrdinal: 10 });
      const before = state(db);
      const failingApply = makeApply(db, {
        projectV2() { throw new Error('projection fault'); },
      });
      const failed = failingApply({
        command: command({
          eventId: 'EVENT-FIRST-ROLLBACK', runId: 'RUN-FIRST-ROLLBACK',
          scheduleId: rollbackSchedule.scheduleId,
        }),
        principal: principal(),
      });
      assert.equal(failed.code, 'INTERNAL_ERROR');
      assert.deepEqual(state(db), before);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM production_runs WHERE id = 'RUN-FIRST-ROLLBACK'").get().count,
        0,
      );
    } finally {
      db.close();
    }
  });

  test('two connections serialize first start so only one expected revision succeeds', () => (
    withTemporaryDatabase(async ({ db, filename }) => {
      seedBase(db);
      const seeded = seedSchedule(db, { suffix: 'CONCURRENT-FIRST', sourceOrdinal: 0 });
      const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const signal = new Int32Array(signalBuffer);
      const payloads = ['A', 'B'].map(label => ({
        command: command({
          eventId: `EVENT-FIRST-CONCURRENT-${label}`,
          runId: 'RUN-FIRST-CONCURRENT',
          scheduleId: seeded.scheduleId,
        }),
        principal: principal(),
      }));
      const workers = payloads.map(payload => runWorker({
        filename,
        payload,
        startSignal: signalBuffer,
      }));
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0, 2);
      const results = await Promise.all(workers);
      assert.equal(results.filter(entry => entry.ok).length, 1);
      assert.equal(results.filter(entry => entry.code === 'REVISION_CONFLICT').length, 1);
      assert.deepEqual(
        { ...db.prepare(`
          SELECT status, run_revision FROM production_runs WHERE id = 'RUN-FIRST-CONCURRENT'
        `).get() },
        { status: 'shooting', run_revision: 1 },
      );
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM production_events').get().count, 1);
      assert.equal(db.prepare('SELECT projection_revision FROM revision_counters WHERE id = 1').get().projection_revision, 11);
    })
  ));

  test('node:sqlite lock timeout maps to STORE_BUSY without parsing exception text', () => (
    withTemporaryDatabase(({ db, filename }) => {
      seedBase(db);
      const seeded = seedSchedule(db, { suffix: 'BUSY', sourceOrdinal: 0 });
      const contender = openDatabase(filename);
      contender.exec('PRAGMA busy_timeout = 0');
      db.exec('BEGIN IMMEDIATE');
      try {
        const response = makeApply(contender)({
          command: command({
            eventId: 'EVENT-KIOSK-BUSY',
            runId: 'RUN-KIOSK-BUSY',
            scheduleId: seeded.scheduleId,
          }),
          principal: principal(),
        });
        assert.equal(response.code, 'STORE_BUSY');
      } finally {
        db.exec('ROLLBACK');
        contender.close();
      }
    })
  ));
}
