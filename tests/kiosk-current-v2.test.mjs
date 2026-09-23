import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createReadKioskCurrent } from '../src/kiosk-current-use-case-v2.mjs';
import { createSqliteKioskCurrentStore } from '../src/sqlite-kiosk-current-store-v2.mjs';
import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';

const NOW = '2026-09-22T09:30:00.000Z';
const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv, { mode: 'full' });
const schema = JSON.parse(await readFile(
  new URL('../contracts/kiosk-current.v2.schema.json', import.meta.url),
  'utf8',
));
const validateCurrent = ajv.compile(schema);

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  initializeWritableSchema(db, { now: () => new Date(NOW) });
  db.prepare(`
    INSERT INTO revision_counters (id, projection_revision, schedule_revision, updated_at)
    VALUES (1, 17, 4, ?)
  `).run(NOW);
  return db;
}

function principal(resourceIds = ['STUDIO-A'], role = 'viewer') {
  const result = createTrustedPrincipal({
    subjectId: `SUBJECT-${role.toUpperCase()}`,
    role,
    resourceIds,
  });
  assert.equal(result.ok, true);
  return result.principal;
}

function reader(db, at = NOW) {
  return createReadKioskCurrent({
    store: createSqliteKioskCurrentStore({ db }),
    clock: () => new Date(at),
  });
}

function insertUpload(db, id) {
  db.prepare(`
    INSERT INTO uploads (
      id, operation_id, original_name, content_type, kind, size, sha256,
      stored_name, claimed_task_id, created_at, claimed_order
    ) VALUES (?, ?, 'hero.jpg', 'image/jpeg', 'image', 1, ?, ?, NULL, ?, NULL)
  `).run(id, `OP-${id}`, 'a'.repeat(64), `${'a'.repeat(64)}.jpg`, NOW);
}

function insertRequest(db, {
  id,
  ordinal,
  sku = `SKU-${ordinal}`,
  name = `Task ${ordinal}`,
  summary = `Summary ${ordinal}`,
  legacyDeliver = `Deliver ${ordinal}`,
  heroAssetId = null,
} = {}) {
  if (heroAssetId) insertUpload(db, heroAssetId);
  db.prepare(`
    INSERT INTO requests_v2 (
      id, source_ordinal, sku, name, client, legacy_deliver_text, kind,
      legacy_v1_status, v1_status_mode, request_lifecycle, lifecycle_provenance,
      source, imported_at, v1_assets_present, v1_request_present,
      core_brief_summary, hero_asset_id, lighting_preset, reflectivity
    ) VALUES (?, ?, ?, ?, 'Client', ?, '待定', NULL, 'canonical', 'open',
      'domain_command', 'workbench', ?, 0, 0, ?, ?, '', 'unknown')
  `).run(id, ordinal, sku, name, legacyDeliver, NOW, summary, heroAssetId);
}

function insertSchedule(db, {
  id,
  ordinal,
  start,
  end,
  status = 'confirmed',
  allocationMode = 'single',
  resourceId = 'STUDIO-A',
  taskIds = [],
} = {}) {
  db.prepare(`
    INSERT INTO schedule_items (
      id, source_ordinal, resource_id, resource_resolution_status,
      planned_start, planned_end, buffer_source, schedule_status,
      schedule_status_provenance, lock_status_provenance, note, allocation_mode,
      source, imported_at
    ) VALUES (?, ?, ?, 'resolved', ?, ?, 'domain_default', ?,
      'domain_command', 'domain_command', '', ?, 'human', ?)
  `).run(id, ordinal, resourceId, start, end, status, allocationMode, NOW);
  const bind = db.prepare(`
    INSERT INTO schedule_item_tasks (
      schedule_item_id, task_id, display_order, created_at, imported_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  taskIds.forEach((taskId, displayOrder) => bind.run(id, taskId, displayOrder, NOW, NOW));
}

function insertRun(db, {
  id,
  scheduleItemId,
  status = 'shooting',
  runRevision = 1,
  scope = 'task',
  taskId,
} = {}) {
  db.prepare(`
    INSERT INTO production_runs (
      id, schedule_item_id, scope, task_id, status, run_revision,
      started_at, blocked_duration_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, scheduleItemId, scope, taskId ?? null, status, runRevision, NOW, NOW, NOW);
}

function expectValidSuccess(result) {
  assert.equal(result.ok, true, result.code);
  assert.equal(validateCurrent(result.dto), true, ajv.errorsText(validateCurrent.errors));
  return result.dto;
}

function totalChanges(db) {
  return db.prepare('SELECT total_changes() AS count').get().count;
}

test('returns an empty current view for a scoped resource with no schedule rows and performs zero writes', () => {
  const db = createDatabase();
  try {
    const before = totalChanges(db);
    const dto = expectValidSuccess(reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }));
    assert.equal(totalChanges(db), before);
    assert.deepEqual(dto, {
      schemaVersion: 2,
      serverTime: NOW,
      projectionRevision: 17,
      resourceId: 'STUDIO-A',
      current: null,
      next: null,
    });
  } finally {
    db.close();
  }
});

test('an active shooting or blocked run wins even after its planned window and returns exact run facts', () => {
  const db = createDatabase();
  try {
    insertRequest(db, {
      id: 'TASK-ACTIVE', ordinal: 0, summary: 'Active production summary',
      heroAssetId: 'UPLOAD-HERO-ACTIVE',
    });
    insertRequest(db, { id: 'TASK-CURRENT', ordinal: 1 });
    insertRequest(db, { id: 'TASK-NEXT', ordinal: 2 });
    insertSchedule(db, {
      id: 'SCHEDULE-ACTIVE', ordinal: 0,
      start: '2026-09-22T07:00:00.000Z', end: '2026-09-22T08:00:00.000Z',
      taskIds: ['TASK-ACTIVE'],
    });
    insertSchedule(db, {
      id: 'SCHEDULE-CURRENT', ordinal: 1,
      start: '2026-09-22T09:00:00.000Z', end: '2026-09-22T10:00:00.000Z',
      taskIds: ['TASK-CURRENT'],
    });
    insertSchedule(db, {
      id: 'SCHEDULE-NEXT', ordinal: 2,
      start: '2026-09-22T10:00:00.000Z', end: '2026-09-22T11:00:00.000Z',
      taskIds: ['TASK-NEXT'],
    });
    insertRun(db, {
      id: 'RUN-ACTIVE', scheduleItemId: 'SCHEDULE-ACTIVE', status: 'blocked', runRevision: 4,
      taskId: 'TASK-ACTIVE',
    });

    const dto = expectValidSuccess(reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }));
    assert.equal(dto.current.scheduleItemId, 'SCHEDULE-ACTIVE');
    assert.equal(dto.current.runId, 'RUN-ACTIVE');
    assert.equal(dto.current.runRevision, 4);
    assert.equal(dto.current.runState, 'blocked');
    assert.equal(dto.current.tasks[0].heroAssetId, 'UPLOAD-HERO-ACTIVE');
    assert.equal(dto.next.scheduleItemId, 'SCHEDULE-NEXT');
  } finally {
    db.close();
  }
});

test('projects current and next candidates without provisioning a run', () => {
  const db = createDatabase();
  try {
    insertRequest(db, { id: 'TASK-CURRENT', ordinal: 0 });
    insertRequest(db, { id: 'TASK-NEXT', ordinal: 1 });
    insertSchedule(db, {
      id: 'SCHEDULE-CURRENT', ordinal: 0,
      start: '2026-09-22T09:00:00.000Z', end: '2026-09-22T10:00:00.000Z',
      taskIds: ['TASK-CURRENT'],
    });
    insertSchedule(db, {
      id: 'SCHEDULE-NEXT', ordinal: 1,
      start: '2026-09-22T10:00:00.000Z', end: '2026-09-22T11:00:00.000Z',
      taskIds: ['TASK-NEXT'],
    });
    const before = totalChanges(db);

    const dto = expectValidSuccess(reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }));
    assert.equal(dto.current.runId, null);
    assert.equal(dto.current.runRevision, 0);
    assert.equal(dto.current.runState, 'scheduled');
    assert.equal(dto.next.runId, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM production_runs').get().count, 0);
    assert.equal(totalChanges(db), before);
  } finally {
    db.close();
  }
});

test('grouped candidates preserve display order, controlled summaries, and omit absent hero assets', () => {
  const db = createDatabase();
  try {
    insertRequest(db, {
      id: 'TASK-GROUP-B', ordinal: 0, name: 'Grouped B',
      summary: null, legacyDeliver: `  ${'长'.repeat(120)}  `,
    });
    insertRequest(db, {
      id: 'TASK-GROUP-A', ordinal: 1, name: 'Grouped A', summary: 'First task summary',
    });
    insertSchedule(db, {
      id: 'SCHEDULE-GROUPED', ordinal: 0,
      start: '2026-09-22T09:00:00.000Z', end: '2026-09-22T10:00:00.000Z',
      allocationMode: 'grouped_unallocated', taskIds: ['TASK-GROUP-A', 'TASK-GROUP-B'],
    });

    const dto = expectValidSuccess(reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }));
    assert.equal(dto.current.isGrouped, true);
    assert.equal(dto.current.groupedNotice, '组合场次，未拆分单任务工时');
    assert.deepEqual(dto.current.tasks.map(task => task.id), ['TASK-GROUP-A', 'TASK-GROUP-B']);
    assert.equal([...dto.current.tasks[1].summary].length, 100);
    assert.equal(Object.hasOwn(dto.current.tasks[1], 'heroAssetId'), false);
  } finally {
    db.close();
  }
});

test('fails closed for multiple active, current, or equally-earliest next choices', async t => {
  await t.test('multiple active runs', () => {
    const db = createDatabase();
    try {
      for (let index = 0; index < 2; index += 1) {
        insertRequest(db, { id: `TASK-ACTIVE-${index}`, ordinal: index });
        insertSchedule(db, {
          id: `SCHEDULE-ACTIVE-${index}`, ordinal: index,
          start: `2026-09-22T0${7 + index}:00:00.000Z`,
          end: `2026-09-22T0${8 + index}:00:00.000Z`,
          taskIds: [`TASK-ACTIVE-${index}`],
        });
        insertRun(db, {
          id: `RUN-ACTIVE-${index}`,
          scheduleItemId: `SCHEDULE-ACTIVE-${index}`,
          taskId: `TASK-ACTIVE-${index}`,
        });
      }
      assert.deepEqual(
        reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }),
        { ok: false, code: 'MULTIPLE_ACTIVE_RUNS' },
      );
    } finally { db.close(); }
  });

  await t.test('multiple current candidates', () => {
    const db = createDatabase();
    try {
      for (let index = 0; index < 2; index += 1) {
        insertRequest(db, { id: `TASK-CURRENT-${index}`, ordinal: index });
        insertSchedule(db, {
          id: `SCHEDULE-CURRENT-${index}`, ordinal: index,
          start: '2026-09-22T09:00:00.000Z', end: '2026-09-22T10:00:00.000Z',
          taskIds: [`TASK-CURRENT-${index}`],
        });
      }
      assert.deepEqual(
        reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }),
        { ok: false, code: 'MULTIPLE_CURRENT_CANDIDATES' },
      );
    } finally { db.close(); }
  });

  await t.test('multiple next candidates with one business time', () => {
    const db = createDatabase();
    try {
      for (let index = 0; index < 2; index += 1) {
        insertRequest(db, { id: `TASK-NEXT-${index}`, ordinal: index });
        insertSchedule(db, {
          id: `SCHEDULE-NEXT-${index}`, ordinal: index,
          start: '2026-09-22T10:00:00.000Z', end: '2026-09-22T11:00:00.000Z',
          taskIds: [`TASK-NEXT-${index}`],
        });
      }
      assert.deepEqual(
        reader(db)({ principal: principal(), resourceId: 'STUDIO-A' }),
        { ok: false, code: 'MULTIPLE_NEXT_CANDIDATES' },
      );
    } finally { db.close(); }
  });
});

test('normalizes principal/resource failures and treats trusted resource scope as resource authority', () => {
  const db = createDatabase();
  try {
    insertSchedule(db, {
      id: 'SCHEDULE-KNOWN', ordinal: 0,
      start: '2026-09-22T07:00:00.000Z', end: '2026-09-22T08:00:00.000Z',
      status: 'cancelled', taskIds: [],
    });
    const read = reader(db);
    const before = totalChanges(db);
    assert.deepEqual(
      read({ principal: principal(['STUDIO-B']), resourceId: 'STUDIO-A' }),
      { ok: false, code: 'FORBIDDEN' },
    );
    assert.deepEqual(read({ principal: principal(), resourceId: undefined }), { ok: false, code: 'INVALID_REQUEST' });
    assert.deepEqual(read({ principal: null, resourceId: 'STUDIO-A' }), { ok: false, code: 'UNAUTHENTICATED' });
    const empty = expectValidSuccess(
      read({ principal: principal(['STUDIO-A', 'STUDIO-EMPTY']), resourceId: 'STUDIO-EMPTY' }),
    );
    assert.equal(empty.current, null);
    assert.equal(empty.next, null);
    assert.equal(totalChanges(db), before);
  } finally {
    db.close();
  }
});

test('normalizes injected Auth Port unauthenticated states without exposing adapter codes', () => {
  const db = createDatabase();
  try {
    for (const code of ['UNAUTHENTICATED', 'AUTH_NOT_CONFIGURED']) {
      const read = createReadKioskCurrent({
        store: createSqliteKioskCurrentStore({ db }),
        clock: () => new Date(NOW),
        authorize: () => ({ allowed: false, code }),
      });
      assert.deepEqual(
        read({ principal: null, resourceId: 'STUDIO-A' }),
        { ok: false, code },
      );
    }
  } finally {
    db.close();
  }
});
