import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';

import {
  RUN_METRICS_ALGORITHM_VERSION,
  foldProductionRunEvent,
} from '../src/domain-rules-v2.mjs';
import {
  createApplyRunEvent,
  digestRunEventCommand,
  digestRunEventResponse,
} from '../src/run-event-use-case-v2.mjs';
import { createSqliteRunEventStore } from '../src/sqlite-run-event-store-v2.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { projectV2Snapshot } from '../src/projections-v2.mjs';

const T0 = '2026-09-22T09:00:00.000Z';
const ALLOW_EVENT_TIME = () => ({ ok: true });

function openDatabase(filename) {
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
    ) VALUES (
      'BATCH-RUN-EVENTS', ?, 'v2-test', 'map-test', 1, 10, ?, ?, ?,
      'resource-test', ?, 'UTC', 'completed', ?, ?
    )
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
      'unknown', 'unknown', 'BATCH-RUN-EVENTS')
  `).run(id, sourceOrdinal, `SKU-${sourceOrdinal}`, `Request ${sourceOrdinal}`, T0);
}

function seedSchedule(db, {
  scheduleId,
  sourceOrdinal,
  allocationMode,
  requestIds,
}) {
  db.prepare(`
    INSERT INTO schedule_items (
      id, source_ordinal, resource_id, resource_resolution_status, resource_mapping_version,
      legacy_place_text, planned_start, planned_end, buffer_after_minutes, buffer_source,
      schedule_status, schedule_status_provenance, lock_status, lock_status_provenance,
      note, allocation_mode, source, source_ref, business_created_at, business_updated_at,
      imported_at, migration_batch_id
    ) VALUES (?, ?, ?, 'resolved', 'resource-test', 'Studio A', ?, ?, NULL,
      'legacy_unknown', 'confirmed', 'legacy_snapshot', NULL, 'legacy_unknown', '', ?,
      'migration', ?, NULL, NULL, ?, 'BATCH-RUN-EVENTS')
  `).run(
    scheduleId,
    sourceOrdinal,
    `RESOURCE-${sourceOrdinal}`,
    '2026-09-22T09:00:00.000Z',
    '2026-09-22T11:00:00.000Z',
    allocationMode,
    `LEGACY-${scheduleId}`,
    T0,
  );
  const insertBinding = db.prepare(`
    INSERT INTO schedule_item_tasks (
      schedule_item_id, task_id, display_order, created_at, imported_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  requestIds.forEach((requestId, index) => insertBinding.run(scheduleId, requestId, index, T0, T0));
}

function seedRun(db, {
  runId,
  scheduleId,
  scope = 'task',
  taskId,
  status = 'scheduled',
  runRevision = 0,
  startedAt = null,
  activeBlockStartedAt = null,
  blockedDurationMs = 0,
}) {
  db.prepare(`
    INSERT INTO production_runs (
      id, schedule_item_id, scope, task_id, status, run_revision, started_at,
      active_block_started_at, blocked_duration_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    scheduleId,
    scope,
    taskId ?? null,
    status,
    runRevision,
    startedAt,
    activeBlockStartedAt,
    blockedDurationMs,
    T0,
    T0,
  );
}

function seedSingle(db, suffix, sourceOrdinal = 0) {
  const requestId = `REQUEST-${suffix}`;
  const scheduleId = `SCHEDULE-${suffix}`;
  const runId = `RUN-${suffix}`;
  seedRequest(db, requestId, sourceOrdinal);
  seedSchedule(db, {
    scheduleId,
    sourceOrdinal,
    allocationMode: 'single',
    requestIds: [requestId],
  });
  seedRun(db, { runId, scheduleId, taskId: requestId });
  return { requestId, scheduleId, runId };
}

function makeApply(db, {
  receivedAt = '2026-09-22T12:00:00.000Z',
  clock = () => new Date(receivedAt),
  projectV2,
  eventTimePolicy = ALLOW_EVENT_TIME,
} = {}) {
  const store = createSqliteRunEventStore({
    db,
    businessTimeZone: 'UTC',
    allowedBriefHosts: [],
    ...(projectV2 ? { projectV2 } : {}),
  });
  return createApplyRunEvent({
    store,
    clock,
    eventTimePolicy,
  });
}

function eventCommand({ eventId, runId, scheduleId, expectedRunRevision, eventType, occurredAt, ...rest }) {
  return {
    eventId,
    runId,
    scheduleItemId: scheduleId,
    expectedRunRevision,
    eventType,
    occurredAt,
    deviceId: 'DEVICE-01',
    actorId: 'ACTOR-01',
    ...(eventType === 'block' ? { reasonCode: 'sampleWaiting' } : {}),
    ...rest,
  };
}

function databaseState(db, runId) {
  return {
    run: db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId),
    counters: db.prepare('SELECT * FROM revision_counters WHERE id = 1').get(),
    events: db.prepare('SELECT COUNT(*) AS count FROM production_events').get().count,
    receipts: db.prepare(`
      SELECT COUNT(*) AS count FROM operations WHERE kind = 'production.run-event'
    `).get().count,
    audits: db.prepare(`
      SELECT COUNT(*) AS count FROM audit_log WHERE action = 'production.run-event'
    `).get().count,
  };
}

async function withTemporaryDatabase(action) {
  const root = mkdtempSync(join(tmpdir(), 'jso-run-events-'));
  const filename = join(root, 'events.sqlite');
  const db = openDatabase(filename);
  try {
    return await action({ db, filename });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function runWorker({ filename, command, startSignal }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { mode: 'apply-run-event', filename, command, startSignal },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`run event worker exited with ${code}`));
    });
  });
}

if (!isMainThread && workerData?.mode === 'apply-run-event') {
  const workerDb = openDatabase(workerData.filename);
  try {
    const signal = new Int32Array(workerData.startSignal);
    Atomics.wait(signal, 0, 0);
    const result = makeApply(workerDb)(workerData.command);
    parentPort.postMessage(result);
  } finally {
    workerDb.close();
  }
} else {
  test('pure fold computes multiple blocked intervals and final net time', () => {
    let run = {
      status: 'scheduled', started_at: null, completed_at: null, active_block_started_at: null,
      gross_duration_ms: null, blocked_duration_ms: 0, net_duration_ms: null,
      metrics_algorithm_version: null,
    };
    let last = null;
    for (const [eventType, occurredAt] of [
      ['start', '2026-09-22T09:00:00.000Z'],
      ['block', '2026-09-22T09:10:00.000Z'],
      ['resume', '2026-09-22T09:20:00.000Z'],
      ['block', '2026-09-22T09:30:00.000Z'],
      ['resume', '2026-09-22T09:35:00.000Z'],
      ['complete', '2026-09-22T10:00:00.000Z'],
    ]) {
      const folded = foldProductionRunEvent({ run, eventType, occurredAt, lastOccurredAt: last });
      assert.equal(folded.ok, true);
      run = { ...run, ...folded.run };
      last = occurredAt;
    }
    assert.equal(run.gross_duration_ms, 60 * 60 * 1000);
    assert.equal(run.blocked_duration_ms, 15 * 60 * 1000);
    assert.equal(run.net_duration_ms, 45 * 60 * 1000);
    assert.equal(run.metrics_algorithm_version, RUN_METRICS_ALGORITHM_VERSION);
  });

  test('pure fold handles cancellation and rejects invalid, out-of-order, and overflowing metrics', () => {
    const scheduledCancel = foldProductionRunEvent({
      run: { status: 'scheduled', blocked_duration_ms: 0 },
      eventType: 'cancel',
      occurredAt: '2026-09-22T09:00:00.000Z',
    });
    assert.equal(scheduledCancel.ok, true);
    assert.equal(scheduledCancel.run.net_duration_ms, null);

    const blockedRun = {
      status: 'blocked',
      started_at: '2026-09-22T09:00:00.000Z',
      active_block_started_at: '2026-09-22T09:10:00.000Z',
      blocked_duration_ms: 1000,
    };
    const blockedCancel = foldProductionRunEvent({
      run: blockedRun,
      eventType: 'cancel',
      occurredAt: '2026-09-22T09:20:00.000Z',
      lastOccurredAt: '2026-09-22T09:10:00.000Z',
    });
    assert.equal(blockedCancel.run.active_block_started_at, null);
    assert.equal(blockedCancel.run.net_duration_ms, null);
    assert.equal(foldProductionRunEvent({
      run: blockedRun,
      eventType: 'resume',
      occurredAt: '2026-09-22T09:05:00.000Z',
      lastOccurredAt: '2026-09-22T09:10:00.000Z',
    }).code, 'EVENT_TIME_OUT_OF_ORDER');
    assert.equal(foldProductionRunEvent({
      run: {
        status: 'shooting', started_at: '2026-09-22T09:10:00.000Z', blocked_duration_ms: 0,
      },
      eventType: 'block',
      occurredAt: '2026-09-22T09:05:00.000Z',
    }).code, 'EVENT_TIME_OUT_OF_ORDER');
    assert.equal(foldProductionRunEvent({
      run: {
        status: 'shooting', started_at: '2026-09-22T09:10:00.000Z', blocked_duration_ms: 0,
      },
      eventType: 'complete',
      occurredAt: '2026-09-22T09:05:00.000Z',
    }).code, 'EVENT_TIME_OUT_OF_ORDER');
    assert.equal(foldProductionRunEvent({
      run: blockedRun,
      eventType: 'resume',
      occurredAt: '2026-09-22T09:05:00.000Z',
    }).code, 'EVENT_TIME_OUT_OF_ORDER');
    assert.equal(foldProductionRunEvent({
      run: { ...blockedRun, blocked_duration_ms: Number.MAX_SAFE_INTEGER },
      eventType: 'resume',
      occurredAt: '2026-09-22T09:10:00.001Z',
      lastOccurredAt: '2026-09-22T09:10:00.000Z',
    }).code, 'RUN_METRICS_OVERFLOW');
    assert.equal(foldProductionRunEvent({
      run: blockedRun,
      eventType: 'complete',
      occurredAt: '2026-09-22T09:20:00.000Z',
    }).code, 'INVALID_RUN_TRANSITION');
    assert.equal(foldProductionRunEvent({
      run: { status: 'scheduled', blocked_duration_ms: 0 },
      eventType: 'start',
      occurredAt: 'not-a-time',
    }).code, 'INVALID_EVENT_TIME');
    assert.equal(foldProductionRunEvent({
      run: { status: 'scheduled', blocked_duration_ms: 0 },
      eventType: 'start',
      occurredAt: '2026-02-31T09:00:00.000Z',
    }).code, 'INVALID_EVENT_TIME');
  });

  test('full event flow persists metrics, scoped revisions, projections, receipt, and audit atomically', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'FLOW');
      const apply = makeApply(db);
      const events = [
        ['EVENT-FLOW-START', 'start', '2026-09-22T09:00:00.000Z'],
        ['EVENT-FLOW-BLOCK-1', 'block', '2026-09-22T09:10:00.000Z'],
        ['EVENT-FLOW-RESUME-1', 'resume', '2026-09-22T09:20:00.000Z'],
        ['EVENT-FLOW-BLOCK-2', 'block', '2026-09-22T09:30:00.000Z'],
        ['EVENT-FLOW-RESUME-2', 'resume', '2026-09-22T09:35:00.000Z'],
        ['EVENT-FLOW-COMPLETE', 'complete', '2026-09-22T10:00:00.000Z'],
      ];
      let result;
      events.forEach(([eventId, eventType, occurredAt], expectedRunRevision) => {
        result = apply(eventCommand({
          eventId,
          runId: ids.runId,
          scheduleId: ids.scheduleId,
          expectedRunRevision,
          eventType,
          occurredAt,
        }));
        assert.equal(result.ok, true);
        assert.equal(result.runRevision, expectedRunRevision + 1);
        assert.equal(result.projectionRevision, 11 + expectedRunRevision);
        assert.equal(result.scheduleRevision, 3);
      });

      assert.equal(result.grossDurationMs, 60 * 60 * 1000);
      assert.equal(result.blockedDurationMs, 15 * 60 * 1000);
      assert.equal(result.netDurationMs, 45 * 60 * 1000);
      const state = databaseState(db, ids.runId);
      assert.equal(state.run.status, 'completed');
      assert.equal(state.run.run_revision, 6);
      assert.equal(state.counters.projection_revision, 16);
      assert.equal(state.counters.schedule_revision, 3);
      assert.equal(state.events, 6);
      assert.equal(state.receipts, 6);
      assert.equal(state.audits, 6);
      const request = db.prepare(`
        SELECT legacy_v1_status, v1_status_mode, request_lifecycle, lifecycle_provenance
        FROM requests_v2 WHERE id = ?
      `).get(ids.requestId);
      assert.deepEqual({ ...request }, {
        legacy_v1_status: 'scheduled',
        v1_status_mode: 'canonical',
        request_lifecycle: 'fulfilled',
        lifecycle_provenance: 'domain_command',
      });
      const projections = db.prepare(`
        SELECT projection_name, revision, schedule_revision, payload_json
        FROM snapshot_projections ORDER BY projection_name
      `).all();
      assert.equal(projections.length, 2);
      assert.equal(projections[0].revision, 16);
      assert.equal(projections[1].revision, 16);
      assert.equal(JSON.parse(projections.find(row => row.projection_name === 'schedule-v1-compat').payload_json)
        .tasks[0].status, 'completed');
      assert.equal(JSON.parse(projections.find(row => row.projection_name === 'schedule-v2').payload_json)
        .productionRuns[0].status, 'completed');
    } finally {
      db.close();
    }
  });

  test('replaying an old event after later events returns the original stored revisions', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'REPLAY');
      const apply = makeApply(db);
      const start = eventCommand({
        eventId: 'EVENT-REPLAY-START', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      const first = apply(start);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REPLAY-BLOCK', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
      })).ok, true);
      const replay = apply(start);
      assert.equal(replay.replayed, true);
      assert.equal(replay.runRevision, first.runRevision);
      assert.equal(replay.projectionRevision, first.projectionRevision);
      assert.equal(replay.resultingState, 'shooting');
      const state = databaseState(db, ids.runId);
      assert.equal(state.run.run_revision, 2);
      assert.equal(state.counters.projection_revision, 12);
      assert.equal(state.events, 2);
      assert.equal(state.receipts, 2);
    } finally {
      db.close();
    }
  });

  test('receipt replay rejects every forged revision, timestamp, duration, and metrics field with zero writes', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'RECEIPT-FIELDS');
      const apply = makeApply(db);
      const commands = [
        eventCommand({
          eventId: 'EVENT-RECEIPT-FIELDS-START', runId: ids.runId, scheduleId: ids.scheduleId,
          expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
        }),
        eventCommand({
          eventId: 'EVENT-RECEIPT-FIELDS-BLOCK', runId: ids.runId, scheduleId: ids.scheduleId,
          expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
        }),
        eventCommand({
          eventId: 'EVENT-RECEIPT-FIELDS-RESUME', runId: ids.runId, scheduleId: ids.scheduleId,
          expectedRunRevision: 2, eventType: 'resume', occurredAt: '2026-09-22T09:20:00.000Z',
        }),
        eventCommand({
          eventId: 'EVENT-RECEIPT-FIELDS-COMPLETE', runId: ids.runId, scheduleId: ids.scheduleId,
          expectedRunRevision: 3, eventType: 'complete', occurredAt: '2026-09-22T10:00:00.000Z',
        }),
      ];
      for (const command of commands) assert.equal(apply(command).ok, true);

      const target = commands.at(-1);
      const original = JSON.parse(db.prepare(`
        SELECT response_json FROM operations WHERE operation_id = ?
      `).get(target.eventId).response_json);
      const forgeries = {
        runRevision: original.runRevision + 1,
        projectionRevision: original.projectionRevision + 100,
        scheduleRevision: original.scheduleRevision + 100,
        startedAt: '2026-09-22T09:00:01.000Z',
        completedAt: '2026-09-22T10:00:01.000Z',
        grossDurationMs: original.grossDurationMs + 1,
        blockedDurationMs: original.blockedDurationMs + 1,
        netDurationMs: original.netDurationMs + 1,
        metricsAlgorithmVersion: 'forged-algorithm',
      };

      // Simulate a legacy/corrupted store after explicitly removing the v3
      // receipt immutability guard; the application must still fail closed.
      db.exec('DROP TRIGGER operations_protect_run_event_owner_update');
      db.exec('DROP TRIGGER operations_validate_run_event_owner_update');

      for (const [field, forgedValue] of Object.entries(forgeries)) {
        const forged = { ...original, [field]: forgedValue };
        db.prepare('UPDATE operations SET response_json = ? WHERE operation_id = ?')
          .run(JSON.stringify(forged), target.eventId);
        const before = databaseState(db, ids.runId);
        const storedBefore = db.prepare(`
          SELECT response_json, created_at, request_digest FROM operations WHERE operation_id = ?
        `).get(target.eventId);

        const result = apply(target);

        assert.equal(result.code, 'EVENT_RECEIPT_INTEGRITY_ERROR', field);
        assert.deepEqual(databaseState(db, ids.runId), before, field);
        assert.deepEqual(db.prepare(`
          SELECT response_json, created_at, request_digest FROM operations WHERE operation_id = ?
        `).get(target.eventId), storedBefore, field);
      }
    } finally {
      db.close();
    }
  });

  test('forging both the operation response and mutable audit rows cannot replace the event integrity anchor', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'RECEIPT-ANCHOR');
      const apply = makeApply(db);
      const command = eventCommand({
        eventId: 'EVENT-RECEIPT-ANCHOR', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      const original = apply(command);
      assert.equal(original.ok, true);

      const forged = {
        ...original,
        projectionRevision: original.projectionRevision + 100,
        scheduleRevision: original.scheduleRevision + 100,
        startedAt: '2026-09-22T09:00:01.000Z',
      };
      const forgedDigest = digestRunEventResponse(forged);
      // Bypass the v3 database guard only inside this isolated corruption
      // fixture so the application integrity anchor remains defense in depth.
      db.exec('DROP TRIGGER operations_protect_run_event_owner_update');
      db.exec('DROP TRIGGER operations_validate_run_event_owner_update');
      db.prepare('UPDATE operations SET response_json = ? WHERE operation_id = ?')
        .run(JSON.stringify(forged), command.eventId);
      db.prepare(`
        UPDATE audit_log SET revision = ?, result = ?
        WHERE action = 'production.run-event' AND entity_id = ?
      `).run(forged.projectionRevision, `success:${forgedDigest}`, ids.runId);
      db.prepare(`
        INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
        VALUES ('production.run-event', 'system', ?, ?, ?, ?)
      `).run(ids.runId, forged.projectionRevision, `success:${forgedDigest}`, '2026-09-22T12:00:00.000Z');
      const before = databaseState(db, ids.runId);
      const operationBefore = db.prepare('SELECT * FROM operations WHERE operation_id = ?').get(command.eventId);

      const result = apply(command);

      assert.equal(result.code, 'EVENT_RECEIPT_INTEGRITY_ERROR');
      assert.deepEqual(databaseState(db, ids.runId), before);
      assert.deepEqual(
        db.prepare('SELECT * FROM operations WHERE operation_id = ?').get(command.eventId),
        operationBefore,
      );
    } finally {
      db.close();
    }
  });

  test('event-time policy is mandatory, but an exact replay is resolved before policy evaluation', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'TIME-POLICY');
      const command = eventCommand({
        eventId: 'EVENT-TIME-POLICY', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      assert.equal(makeApply(db)(command).ok, true);
      const rejectingApply = makeApply(db, {
        eventTimePolicy: () => ({ ok: false, code: 'EVENT_TIME_REVIEW_REQUIRED' }),
      });
      const replay = rejectingApply({ ...command, occurredAt: '2026-09-22T17:00:00+08:00' });
      assert.equal(replay.ok, true);
      assert.equal(replay.replayed, true);
      assert.throws(
        () => createApplyRunEvent({
          store: createSqliteRunEventStore({ db, businessTimeZone: 'UTC' }),
          clock: () => new Date(T0),
        }),
        /eventTimePolicy is required/,
      );
    } finally {
      db.close();
    }
  });

  test('invalid or throwing server clocks fail with a stable code and zero writes', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'SERVER-TIME');
      const command = eventCommand({
        eventId: 'EVENT-SERVER-TIME', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      const before = databaseState(db, ids.runId);
      const invalidClockApply = makeApply(db, { clock: () => new Date(Number.NaN) });
      const throwingClockApply = makeApply(db, { clock: () => { throw new Error('clock unavailable'); } });

      assert.equal(invalidClockApply(command).code, 'INVALID_SERVER_TIME');
      assert.equal(throwingClockApply(command).code, 'INVALID_SERVER_TIME');
      assert.deepEqual(databaseState(db, ids.runId), before);
    } finally {
      db.close();
    }
  });

  test('blocking reasons are frozen, other requires a note, and non-block events reject reasons', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const first = seedSingle(db, 'REASON-A', 0);
      const second = seedSingle(db, 'REASON-B', 1);
      const apply = makeApply(db);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-A-START', runId: first.runId, scheduleId: first.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
        note: 'setup note is retained',
      })).ok, true);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-A-BLOCK', runId: first.runId, scheduleId: first.scheduleId,
        expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
        reasonCode: 'other', note: 'custom blocking reason',
      })).ok, true);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-B-START', runId: second.runId, scheduleId: second.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      })).ok, true);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-B-BLOCK', runId: second.runId, scheduleId: second.scheduleId,
        expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
        reasonCode: 'deviceIssue',
      })).ok, true);

      const beforeInvalid = databaseState(db, second.runId);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-MISSING', runId: second.runId, scheduleId: second.scheduleId,
        expectedRunRevision: 2, eventType: 'block', occurredAt: '2026-09-22T09:20:00.000Z',
        reasonCode: null,
      })).code, 'INVALID_BLOCKING_REASON');
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-UNKNOWN', runId: second.runId, scheduleId: second.scheduleId,
        expectedRunRevision: 2, eventType: 'block', occurredAt: '2026-09-22T09:20:00.000Z',
        reasonCode: 'unknownReason',
      })).code, 'INVALID_BLOCKING_REASON');
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-OTHER', runId: second.runId, scheduleId: second.scheduleId,
        expectedRunRevision: 2, eventType: 'block', occurredAt: '2026-09-22T09:20:00.000Z',
        reasonCode: 'other', note: '   ',
      })).code, 'BLOCKING_REASON_NOTE_REQUIRED');
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-REASON-NONBLOCK', runId: second.runId, scheduleId: second.scheduleId,
        expectedRunRevision: 2, eventType: 'resume', occurredAt: '2026-09-22T09:20:00.000Z',
        reasonCode: 'deviceIssue',
      })).code, 'BLOCKING_REASON_NOT_ALLOWED');
      assert.deepEqual(databaseState(db, second.runId), beforeInvalid);
    } finally {
      db.close();
    }
  });

  test('persisted cancellation and invalid or out-of-order events preserve zero-write failure semantics', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const cancelIds = seedSingle(db, 'CANCEL', 0);
      const flowIds = seedSingle(db, 'ORDER', 1);
      const apply = makeApply(db);
      const cancelled = apply(eventCommand({
        eventId: 'EVENT-CANCEL-SCHEDULED', runId: cancelIds.runId, scheduleId: cancelIds.scheduleId,
        expectedRunRevision: 0, eventType: 'cancel', occurredAt: '2026-09-22T09:00:00.000Z',
      }));
      assert.equal(cancelled.ok, true);
      assert.equal(cancelled.resultingState, 'cancelled');
      assert.equal(cancelled.grossDurationMs, null);
      assert.equal(cancelled.netDurationMs, null);
      assert.equal(db.prepare('SELECT schedule_status FROM schedule_items WHERE id = ?')
        .get(cancelIds.scheduleId).schedule_status, 'confirmed');

      assert.equal(apply(eventCommand({
        eventId: 'EVENT-ORDER-START', runId: flowIds.runId, scheduleId: flowIds.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:10:00.000Z',
      })).ok, true);
      const beforeFailures = databaseState(db, flowIds.runId);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-ORDER-RESUME', runId: flowIds.runId, scheduleId: flowIds.scheduleId,
        expectedRunRevision: 1, eventType: 'resume', occurredAt: '2026-09-22T09:20:00.000Z',
      })).code, 'INVALID_RUN_TRANSITION');
      assert.deepEqual(databaseState(db, flowIds.runId), beforeFailures);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-ORDER-BLOCK', runId: flowIds.runId, scheduleId: flowIds.scheduleId,
        expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:05:00.000Z',
      })).code, 'EVENT_TIME_OUT_OF_ORDER');
      assert.deepEqual(databaseState(db, flowIds.runId), beforeFailures);
    } finally {
      db.close();
    }
  });

  test('event id reuse, receipt integrity failure, stale revision, and revision overflow are zero-write', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'FAILURES');
      const apply = makeApply(db);
      const start = eventCommand({
        eventId: 'EVENT-FAILURES-START', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      assert.equal(apply(start).ok, true);
      const beforeReuse = databaseState(db, ids.runId);
      assert.equal(apply({ ...start, note: 'changed' }).code, 'IDEMPOTENCY_KEY_REUSE');
      assert.deepEqual(databaseState(db, ids.runId), beforeReuse);

      const stale = eventCommand({
        eventId: 'EVENT-FAILURES-STALE', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
      });
      assert.equal(apply(stale).code, 'REVISION_CONFLICT');
      assert.deepEqual(databaseState(db, ids.runId), beforeReuse);

      // A valid v3 database rejects receipt-only state. Remove the insert
      // guard only to preserve the application-level legacy-corruption test.
      db.exec('DROP TRIGGER operations_validate_run_event_owner_insert');
      db.prepare(`
        INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
        VALUES ('EVENT-INTEGRITY-ONLY', 'production.run-event', '{}', ?, ?)
      `).run(T0, `sha256:${'9'.repeat(64)}`);
      const integrity = apply(eventCommand({
        eventId: 'EVENT-INTEGRITY-ONLY', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
      }));
      assert.equal(integrity.code, 'EVENT_RECEIPT_INTEGRITY_ERROR');
      assert.equal(databaseState(db, ids.runId).run.run_revision, 1);

      db.prepare(`
        UPDATE revision_counters SET projection_revision = ? WHERE id = 1
      `).run(Number.MAX_SAFE_INTEGER);
      const beforeOverflow = databaseState(db, ids.runId);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-OVERFLOW-01', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 1, eventType: 'block', occurredAt: '2026-09-22T09:10:00.000Z',
      })).code, 'REVISION_OVERFLOW');
      assert.deepEqual(databaseState(db, ids.runId), beforeOverflow);
    } finally {
      db.close();
    }
  });

  test('receipt replay fails closed when stored event facts disagree with the matching digest', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'RECEIPT-FACT');
      const command = eventCommand({
        eventId: 'EVENT-RECEIPT-FACT', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      const normalizedCommand = { ...command, reasonCode: null, note: null };
      const digest = digestRunEventCommand(normalizedCommand);
      const response = {
        ok: true,
        code: 'RUN_EVENT_APPLIED',
        eventId: command.eventId,
        runId: ids.runId,
        previousState: 'scheduled',
        resultingState: 'shooting',
        runRevision: 1,
        projectionRevision: 11,
        scheduleRevision: 3,
        startedAt: command.occurredAt,
        completedAt: null,
        grossDurationMs: null,
        blockedDurationMs: 0,
        netDurationMs: null,
        metricsAlgorithmVersion: null,
      };
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`
        INSERT INTO production_events (
          event_id, run_id, command_digest, response_digest, event_type, occurred_at,
          received_at, device_id, actor_id, reason_code, note, previous_state,
          resulting_state, resulting_run_revision, resulting_projection_revision,
          resulting_schedule_revision
        ) VALUES (?, ?, ?, ?, 'block', ?, ?, ?, ?, NULL, NULL, 'scheduled', 'shooting', 1, 11, 3)
      `).run(
        command.eventId,
        ids.runId,
        digest,
        digestRunEventResponse(response),
        command.occurredAt,
        '2026-09-22T12:00:00.000Z',
        command.deviceId,
        command.actorId,
      );
      db.prepare(`
        INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
        VALUES (?, 'production.run-event', ?, ?, ?)
      `).run(command.eventId, JSON.stringify(response), T0, digest);
      db.exec('COMMIT');
      const before = databaseState(db, ids.runId);
      const result = makeApply(db)(command);
      assert.equal(result.code, 'EVENT_RECEIPT_INTEGRITY_ERROR');
      assert.deepEqual(databaseState(db, ids.runId), before);
    } finally {
      db.close();
    }
  });

  test('receipt replay fails closed when operation and event receipt times disagree', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'RECEIPT-TIME');
      const command = eventCommand({
        eventId: 'EVENT-RECEIPT-TIME', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      });
      const normalizedCommand = { ...command, reasonCode: null, note: null };
      const digest = digestRunEventCommand(normalizedCommand);
      const response = {
        ok: true,
        code: 'RUN_EVENT_APPLIED',
        eventId: command.eventId,
        runId: ids.runId,
        previousState: 'scheduled',
        resultingState: 'shooting',
        runRevision: 1,
        projectionRevision: 11,
        scheduleRevision: 3,
        startedAt: command.occurredAt,
        completedAt: null,
        grossDurationMs: null,
        blockedDurationMs: 0,
        netDurationMs: null,
        metricsAlgorithmVersion: null,
      };
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`
        INSERT INTO production_events (
          event_id, run_id, command_digest, response_digest, event_type, occurred_at,
          received_at, device_id, actor_id, reason_code, note, previous_state,
          resulting_state, resulting_run_revision, resulting_projection_revision,
          resulting_schedule_revision
        ) VALUES (?, ?, ?, ?, 'start', ?, ?, ?, ?, NULL, NULL, 'scheduled', 'shooting', 1, 11, 3)
      `).run(
        command.eventId,
        ids.runId,
        digest,
        digestRunEventResponse(response),
        command.occurredAt,
        '2026-09-22T12:00:00.000Z',
        command.deviceId,
        command.actorId,
      );
      db.prepare(`
        INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
        VALUES (?, 'production.run-event', ?, ?, ?)
      `).run(command.eventId, JSON.stringify(response), '2026-09-22T12:00:01.000Z', digest);
      db.exec('COMMIT');
      const before = databaseState(db, ids.runId);
      const result = makeApply(db)(command);
      assert.equal(result.code, 'EVENT_RECEIPT_INTEGRITY_ERROR');
      assert.deepEqual(databaseState(db, ids.runId), before);
    } finally {
      db.close();
    }
  });

  test('contract-invalid projector output rolls back facts, counters, event, receipt, and audit', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'ROLLBACK');
      const apply = makeApply(db, {
        projectV2: (records, options) => {
          const snapshot = projectV2Snapshot(records, options);
          snapshot.requests[0].briefUrl = 'https://not-allowed.example/brief';
          return snapshot;
        },
      });
      const before = databaseState(db, ids.runId);
      const result = apply(eventCommand({
        eventId: 'EVENT-ROLLBACK-01', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      }));
      assert.equal(result.code, 'V2_PROJECTION_CONTRACT_INVALID');
      assert.deepEqual(databaseState(db, ids.runId), before);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM snapshot_projections').get().count, 0);
    } finally {
      db.close();
    }
  });

  test('grouped block completion keeps every request open and produces only block metrics', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const requestIds = ['REQUEST-GROUP-A', 'REQUEST-GROUP-B'];
      requestIds.forEach((id, index) => seedRequest(db, id, index));
      seedSchedule(db, {
        scheduleId: 'SCHEDULE-GROUP', sourceOrdinal: 0,
        allocationMode: 'grouped_unallocated', requestIds,
      });
      seedRun(db, {
        runId: 'RUN-GROUP', scheduleId: 'SCHEDULE-GROUP', scope: 'block', taskId: null,
      });
      const apply = makeApply(db);
      assert.equal(apply(eventCommand({
        eventId: 'EVENT-GROUP-START', runId: 'RUN-GROUP', scheduleId: 'SCHEDULE-GROUP',
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      })).ok, true);
      const completed = apply(eventCommand({
        eventId: 'EVENT-GROUP-COMPLETE', runId: 'RUN-GROUP', scheduleId: 'SCHEDULE-GROUP',
        expectedRunRevision: 1, eventType: 'complete', occurredAt: '2026-09-22T10:00:00.000Z',
      }));
      assert.equal(completed.ok, true);
      assert.equal(completed.netDurationMs, 60 * 60 * 1000);
      assert.deepEqual(
        db.prepare('SELECT id, request_lifecycle, v1_status_mode FROM requests_v2 ORDER BY id').all()
          .map(row => ({ ...row })),
        requestIds.map(id => ({ id, request_lifecycle: 'open', v1_status_mode: 'legacy_exact' })),
      );
      const v1 = JSON.parse(db.prepare(`
        SELECT payload_json FROM snapshot_projections WHERE projection_name = 'schedule-v1-compat'
      `).get().payload_json);
      assert.deepEqual(v1.tasks.map(task => task.status), ['scheduled', 'scheduled']);
    } finally {
      db.close();
    }
  });

  test('same-run multi-connection concurrency permits exactly one expected revision', () => (
    withTemporaryDatabase(async ({ db, filename }) => {
      seedBase(db);
      const ids = seedSingle(db, 'CONCURRENT');
      const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const signal = new Int32Array(signalBuffer);
      const commands = ['A', 'B'].map(label => eventCommand({
        eventId: `EVENT-CONCURRENT-${label}`,
        runId: ids.runId,
        scheduleId: ids.scheduleId,
        expectedRunRevision: 0,
        eventType: 'start',
        occurredAt: '2026-09-22T09:00:00.000Z',
      }));
      const workers = commands.map(command => runWorker({
        filename,
        command,
        startSignal: signalBuffer,
      }));
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0, 2);
      const results = await Promise.all(workers);
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal(results.filter(result => result.code === 'REVISION_CONFLICT').length, 1);
      const state = databaseState(db, ids.runId);
      assert.equal(state.run.run_revision, 1);
      assert.equal(state.counters.projection_revision, 11);
      assert.equal(state.counters.schedule_revision, 3);
      assert.equal(state.events, 1);
    })
  ));

  test('different runs advance independently while sharing one projection revision domain', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const first = seedSingle(db, 'INDEPENDENT-A', 0);
      const second = seedSingle(db, 'INDEPENDENT-B', 1);
      const apply = makeApply(db);
      for (const [label, ids] of [['A', first], ['B', second]]) {
        const result = apply(eventCommand({
          eventId: `EVENT-INDEPENDENT-${label}`,
          runId: ids.runId,
          scheduleId: ids.scheduleId,
          expectedRunRevision: 0,
          eventType: 'start',
          occurredAt: '2026-09-22T09:00:00.000Z',
        }));
        assert.equal(result.ok, true);
        assert.equal(result.runRevision, 1);
      }
      assert.deepEqual(
        db.prepare('SELECT id, run_revision FROM production_runs ORDER BY id').all().map(row => ({ ...row })),
        [{ id: first.runId, run_revision: 1 }, { id: second.runId, run_revision: 1 }],
      );
      const counters = db.prepare('SELECT * FROM revision_counters WHERE id = 1').get();
      assert.equal(counters.projection_revision, 12);
      assert.equal(counters.schedule_revision, 3);
    } finally {
      db.close();
    }
  });

  test('production event rows remain append-only after application', () => {
    const db = openDatabase(':memory:');
    try {
      seedBase(db);
      const ids = seedSingle(db, 'APPEND');
      const result = makeApply(db)(eventCommand({
        eventId: 'EVENT-APPEND-ONLY', runId: ids.runId, scheduleId: ids.scheduleId,
        expectedRunRevision: 0, eventType: 'start', occurredAt: '2026-09-22T09:00:00.000Z',
      }));
      assert.equal(result.ok, true);
      assert.throws(
        () => db.exec(`UPDATE production_events SET note = 'changed' WHERE event_id = 'EVENT-APPEND-ONLY'`),
        /append-only/,
      );
      assert.throws(
        () => db.exec(`DELETE FROM production_events WHERE event_id = 'EVENT-APPEND-ONLY'`),
        /append-only/,
      );
    } finally {
      db.close();
    }
  });
}
