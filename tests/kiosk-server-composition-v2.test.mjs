import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createKioskV2Application } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';

const NOW = '2026-09-22T09:30:00.000Z';

test('Kiosk V2 runtime composition is explicit, injected, and empty-resource safe', () => {
  const store = new ScheduleStore({
    filename: ':memory:',
    clock: () => new Date(NOW),
  });
  try {
    store.db.prepare(`
      INSERT INTO revision_counters (id, projection_revision, schedule_revision, updated_at)
      VALUES (1, 0, 0, ?)
    `).run(NOW);
    const created = createTrustedPrincipal({
      subjectId: 'ACTOR-KIOSK-LOCAL',
      role: 'viewer',
      resourceIds: ['STUDIO-EMPTY'],
    });
    assert.equal(created.ok, true);
    const kiosk = createKioskV2Application({
      store,
      authenticate: () => created.principal,
      businessTimeZone: 'UTC',
      clock: () => new Date(NOW),
    });
    assert.equal(kiosk.authenticate(), created.principal);
    const current = kiosk.readCurrent({
      principal: created.principal,
      resourceId: 'STUDIO-EMPTY',
    });
    assert.equal(current.ok, true, current.code);
    assert.equal(current.dto.current, null);
    assert.equal(current.dto.next, null);
    assert.equal(current.dto.projectionRevision, 0);
  } finally {
    store.close();
  }
});

test('Kiosk V2 runtime composition refuses implicit authentication or time-zone defaults', () => {
  const store = new ScheduleStore({ filename: ':memory:' });
  try {
    assert.throws(
      () => createKioskV2Application({ store, businessTimeZone: 'UTC' }),
      /authenticate port/u,
    );
    assert.throws(
      () => createKioskV2Application({ store, authenticate: () => null }),
      /businessTimeZone/u,
    );
  } finally {
    store.close();
  }
});
