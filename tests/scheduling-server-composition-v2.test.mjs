import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createOperationsServer, createSchedulingV2Application } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';
import { createWriteAdmissionControl } from '../src/write-admission-v1.mjs';

test('Scheduling V2 runtime composition is explicit and connects the canonical proposal store', () => {
  const store = new ScheduleStore({ filename: ':memory:' });
  try {
    const created = createTrustedPrincipal({
      subjectId: 'SCHEDULER-LOCAL',
      role: 'scheduler',
      resourceIds: ['STUDIO-A'],
    });
    assert.equal(created.ok, true);
    const scheduling = createSchedulingV2Application({
      store,
      authenticate: () => created.principal,
      clock: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    assert.equal(scheduling.writeAdmissionControl, store.writeAdmissionControl);
    assert.equal(scheduling.authenticate(), created.principal);
    const result = scheduling.decideProposal({
      command: {
        decisionId: 'DEC-COMPOSE-0001',
        proposalId: 'sp_missing',
        decisionType: 'accept',
        selectedProposalItemIds: ['spi_missing'],
        decisionNote: null,
        reasonCode: null,
      },
      principal: created.principal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROPOSAL_NOT_FOUND');
    const reject = scheduling.decideProposal({
      command: {
        decisionId: 'DEC-COMPOSE-REJECT-0001',
        proposalId: 'sp_missing',
        decisionType: 'reject',
        selectedProposalItemIds: null,
        decisionNote: null,
        reasonCode: 'HUMAN_REJECTED',
      },
      principal: created.principal,
    });
    assert.equal(reject.ok, false);
    assert.equal(reject.code, 'PROPOSAL_NOT_FOUND');
  } finally {
    store.close();
  }
});

test('Scheduling V2 direct mutation is fenced by the bound ScheduleStore admission control', () => {
  const store = new ScheduleStore({
    filename: ':memory:',
    writeAdmissionMode: 'disabled',
    orphanCleanupMode: 'disabled',
  });
  try {
    const created = createTrustedPrincipal({
      subjectId: 'SCHEDULER-DISABLED',
      role: 'scheduler',
      resourceIds: ['STUDIO-A'],
    });
    assert.equal(created.ok, true);
    const scheduling = createSchedulingV2Application({
      store,
      authenticate: () => created.principal,
      clock: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
    const result = scheduling.decideProposal({
      command: {
        decisionId: 'DEC-DISABLED-0001',
        proposalId: 'sp_missing',
        decisionType: 'accept',
        selectedProposalItemIds: ['spi_missing'],
        decisionNote: null,
        reasonCode: null,
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

test('Scheduling V2 wrapper keeps the admission control captured at construction', () => {
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
      subjectId: 'SCHEDULER-CAPTURED',
      role: 'scheduler',
      resourceIds: ['STUDIO-A'],
    });
    assert.equal(created.ok, true);
    const scheduling = createSchedulingV2Application({
      store: mutableStore,
      authenticate: () => created.principal,
      clock: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    assert.equal(scheduling.writeAdmissionControl, captured);

    mutableStore.writeAdmissionControl =
      createWriteAdmissionControl({ initialMode: 'enabled' });

    const before = backingStore.db.prepare('SELECT total_changes() AS changes').get().changes;
    const result = scheduling.decideProposal({
      command: {
        decisionId: 'DEC-CAPTURED-0001',
        proposalId: 'sp_missing',
        decisionType: 'accept',
        selectedProposalItemIds: ['spi_missing'],
        decisionNote: null,
        reasonCode: null,
      },
      principal: created.principal,
    });
    const after = backingStore.db.prepare('SELECT total_changes() AS changes').get().changes;

    assert.deepEqual(result, { ok: false, code: 'WRITE_ADMISSION_DISABLED' });
    assert.equal(scheduling.writeAdmissionControl, captured);
    assert.equal(after, before);
  } finally {
    backingStore.close();
  }
});

test('Scheduling V2 runtime composition refuses implicit authentication', () => {
  const store = new ScheduleStore({ filename: ':memory:' });
  try {
    assert.throws(
      () => createSchedulingV2Application({ store }),
      /authenticate port/u,
    );
  } finally {
    store.close();
  }
});

test('Operations server accepts explicit scheduling composition inputs without enabling env auth', () => {
  const created = createTrustedPrincipal({
    subjectId: 'SCHEDULER-SERVER-LOCAL',
    role: 'scheduler',
    resourceIds: ['STUDIO-A'],
  });
  assert.equal(created.ok, true);
  const { server, store } = createOperationsServer({
    databasePath: ':memory:',
    cleanupIntervalMs: 0,
    schedulingAuthenticate: () => created.principal,
  });
  try {
    assert.equal(typeof server.listen, 'function');
    assert.ok(store.db);
  } finally {
    store.close();
  }
});
