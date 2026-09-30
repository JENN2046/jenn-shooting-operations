import { createKioskServiceBindingV1 } from '../src/kiosk-service-context-v1.mjs';
const isolatedBinding = createKioskServiceBindingV1({ context: 'WO03_ISOLATED_ACCEPTANCE' });
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createKioskV2Application } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';
import { createWriteAdmissionControl } from '../src/write-admission-v1.mjs';

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
    const authorizeDeviceId = ({ principal, deviceId }) => (
      principal === created.principal && deviceId === 'DEVICE-KIOSK-LOCAL'
    );
    const kiosk = createKioskV2Application({ serviceBinding: isolatedBinding,
      store,
      authenticate: () => created.principal,
      authenticationChallenge: 'Basic realm="Jenn Shooting Kiosk", charset="UTF-8"',
      authorizeDeviceId,
      deviceId: 'DEVICE-KIOSK-LOCAL',
      businessTimeZone: 'UTC',
      clock: () => new Date(NOW),
    });
    assert.equal(kiosk.writeAdmissionControl, store.writeAdmissionControl);
    assert.equal(kiosk.authenticate(), created.principal);
    assert.equal(
      kiosk.authenticationChallenge,
      'Basic realm="Jenn Shooting Kiosk", charset="UTF-8"',
    );
    assert.equal(kiosk.authorizeDeviceId, authorizeDeviceId);
    assert.equal(kiosk.deviceId, 'DEVICE-KIOSK-LOCAL');
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

test('Kiosk V2 direct mutation is fenced by the bound ScheduleStore admission control', () => {
  const store = new ScheduleStore({
    filename: ':memory:',
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
  });
  try {
    const created = createTrustedPrincipal({
      subjectId: 'ACTOR-KIOSK-DISABLED',
      role: 'operator',
      resourceIds: ['STUDIO-A'],
    });
    assert.equal(created.ok, true);
    const kiosk = createKioskV2Application({ serviceBinding: isolatedBinding,
      store,
      authenticate: () => created.principal,
      businessTimeZone: 'UTC',
      clock: () => new Date(NOW),
    });
    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    const result = kiosk.applyRunEvent({
      command: {
        schemaVersion: 2,
        eventId: 'EVENT-DISABLED-0001',
        runId: 'RUN-DISABLED-0001',
        scheduleItemId: 'SCHEDULE-DISABLED-0001',
        eventType: 'start',
        expectedRunRevision: 0,
        occurredAt: NOW,
        deviceId: 'KIOSK-DISABLED-0001',
        localSequence: 0,
      },
      principal: created.principal,
    });
    const after = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    assert.deepEqual(result, { ok: false, code: 'WRITE_ADMISSION_DISABLED' });
    assert.equal(after, before);
  } finally {
    store.close();
  }
});

test('Kiosk V2 wrapper keeps the admission control captured at construction', () => {
  const backingStore = new ScheduleStore({
    filename: ':memory:',
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
  });
  const captured = backingStore.writeAdmissionControl;
  const mutableStore = {
    db: backingStore.db,
    writeAdmissionControl: captured,
  };
  try {
    const created = createTrustedPrincipal({
      subjectId: 'ACTOR-KIOSK-CAPTURED',
      role: 'operator',
      resourceIds: ['STUDIO-A'],
    });
    assert.equal(created.ok, true);
    const kiosk = createKioskV2Application({ serviceBinding: isolatedBinding,
      store: mutableStore,
      authenticate: () => created.principal,
      businessTimeZone: 'UTC',
      clock: () => new Date(NOW),
    });
    assert.equal(kiosk.writeAdmissionControl, captured);

    mutableStore.writeAdmissionControl =
      createWriteAdmissionControl({ initialMode: 'enabled' });

    const before = backingStore.db.prepare('SELECT total_changes() AS changes').get().changes;
    const result = kiosk.applyRunEvent({
      command: {
        schemaVersion: 2,
        eventId: 'EVENT-CAPTURED-0001',
        runId: 'RUN-CAPTURED-0001',
        scheduleItemId: 'SCHEDULE-CAPTURED-0001',
        eventType: 'start',
        expectedRunRevision: 0,
        occurredAt: NOW,
        deviceId: 'KIOSK-CAPTURED-0001',
        localSequence: 0,
      },
      principal: created.principal,
    });
    const after = backingStore.db.prepare('SELECT total_changes() AS changes').get().changes;

    assert.deepEqual(result, { ok: false, code: 'WRITE_ADMISSION_DISABLED' });
    assert.equal(kiosk.writeAdmissionControl, captured);
    assert.equal(after, before);
  } finally {
    backingStore.close();
  }
});

test('Kiosk V2 runtime composition refuses implicit authentication or time-zone defaults', () => {
  const store = new ScheduleStore({ filename: ':memory:' });
  try {
    assert.throws(
      () => createKioskV2Application({ serviceBinding: isolatedBinding, store, businessTimeZone: 'UTC' }),
      /authenticate port/u,
    );
    assert.throws(
      () => createKioskV2Application({ serviceBinding: isolatedBinding, store, authenticate: () => null }),
      /businessTimeZone/u,
    );
    assert.throws(
      () => createKioskV2Application({ serviceBinding: isolatedBinding,
        store,
        authenticate: () => null,
        authenticationChallenge: '',
        businessTimeZone: 'UTC',
      }),
      /authentication challenge/u,
    );
    assert.throws(
      () => createKioskV2Application({ serviceBinding: isolatedBinding,
        store,
        authenticate: () => null,
        authorizeDeviceId: true,
        deviceId: 'DEVICE-KIOSK-LOCAL',
        businessTimeZone: 'UTC',
      }),
      /device authorization port/u,
    );
    assert.throws(
      () => createKioskV2Application({ serviceBinding: isolatedBinding,
        store,
        authenticate: () => null,
        authorizeDeviceId: () => true,
        businessTimeZone: 'UTC',
      }),
      /configured together/u,
    );
  } finally {
    store.close();
  }
});
