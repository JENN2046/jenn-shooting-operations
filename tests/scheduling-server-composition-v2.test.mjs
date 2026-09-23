import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import { createOperationsServer, createSchedulingV2Application } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';

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
      businessTimeZone: 'UTC',
      clock: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    assert.equal(scheduling.authenticate(), created.principal);
    const result = scheduling.acceptProposal({
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
  } finally {
    store.close();
  }
});

test('Scheduling V2 runtime composition refuses implicit authentication or time-zone defaults', () => {
  const store = new ScheduleStore({ filename: ':memory:' });
  try {
    assert.throws(
      () => createSchedulingV2Application({ store, businessTimeZone: 'UTC' }),
      /authenticate port/u,
    );
    assert.throws(
      () => createSchedulingV2Application({ store, authenticate: () => null }),
      /businessTimeZone/u,
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
    schedulingBusinessTimeZone: 'UTC',
  });
  try {
    assert.equal(typeof server.listen, 'function');
    assert.equal(store.db.isOpen, true);
  } finally {
    store.close();
  }
});
