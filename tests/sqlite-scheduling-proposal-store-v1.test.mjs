import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { initializeWritableSchema } from '../src/sqlite-schema-v2.mjs';
import { createSqliteSchedulingProposalStoreV1 } from '../src/sqlite-scheduling-proposal-store-v1.mjs';
import { assembleSchedulingInputFromSqliteV1 } from '../src/sqlite-scheduling-input-assembler-v1.mjs';
import { createSqliteSchedulingAdminStoreV1 } from '../src/sqlite-scheduling-admin-store-v1.mjs';
import { refreshSqliteSnapshotProjectionsV2 } from '../src/sqlite-run-event-store-v2.mjs';
import { canonicalJsonSchedulingV1, digestResourceCapabilitiesV1,
  SCHEDULING_TIME_ZONE_DATA_VERSION } from '../src/scheduling-contract-v1.mjs';
import { normalizeSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';
import { createTrustedPrincipal } from '../src/authorization-v2.mjs';

const schedulerPrincipal = createTrustedPrincipal({ subjectId: 'scheduler:fixture',
  role: 'scheduler', resourceIds: ['STUDIO-A'] }).principal;
const viewerPrincipal = createTrustedPrincipal({ subjectId: 'operator',
  role: 'viewer', resourceIds: ['STUDIO-A'] }).principal;
const otherStudioPrincipal = createTrustedPrincipal({ subjectId: 'scheduler:elsewhere',
  role: 'scheduler', resourceIds: ['STUDIO-B'] }).principal;

const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
const provenance = Object.fromEntries([
  'productionType', 'shootingSubtype', 'desiredDate', 'sampleStatus', 'lightingPreset',
  'reflectivity', 'priority', 'requiredCapabilityIds', 'durationEstimate',
].map(key => [key, 'domain-command-v1']));

function config() {
  return {
    schemaVersion: 1, businessTimeZone: 'Asia/Shanghai',
    resourceCalendars: [{ resourceId: 'STUDIO-A', capabilityDigest,
      weeklyWindows: [{ weekday: 5, start: '09:00', end: '18:00' }], dateOverrides: [],
    }],
    durationFallbackRules: [{ ruleId: 'duration-flat', productionType: '平面',
      shootingSubtype: null, durationMs: 3_600_000,
    }],
    bufferRules: [{ ruleId: 'buffer-flat', productionType: '平面',
      shootingSubtype: null, bufferAfterMinutes: 15,
    }],
    softScoringWeights: { LIGHTING_SWITCH: 1, REFLECTIVITY_SEQUENCE: 1,
      IDLE_GAP: 1, EXPECTED_OVERRUN: 1, DESIRED_DATE_MISS: 1,
    },
    compatibleAlgorithmVersions: ['deterministic-scheduler-v1'],
  };
}

function fixture({ mutateAfterFirst = false, requestIds = ['REQ-1'] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initializeWritableSchema(db);
  const admitted = normalizeSchedulingConfigV1(config());
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  db.prepare(`INSERT INTO revision_counters
    (id, projection_revision, schedule_revision, updated_at) VALUES (1, 0, 7, ?)`)
    .run('2026-09-22T08:00:00.000Z');
  db.prepare(`INSERT INTO scheduling_config_versions
    (config_version, schema_version, algorithm_version, calendar_compiler_version,
     estimate_policy_version, config_json, config_digest, published_by, published_at,
     publish_operation_id) VALUES ('config-v1', 1, ?, ?, ?, ?, ?, 'admin', ?, 'PUB-1')`).run(
      'deterministic-scheduler-v1', 'calendar-compiler-v1', 'estimate-policy-v1',
      admitted.configJson, admitted.configDigest, '2026-09-22T08:00:00.000Z',
    );
  db.prepare(`INSERT INTO scheduling_active_config
    (id, config_version, activated_at, activation_operation_id, projection_revision)
    VALUES (1, 'config-v1', ?, 'ACT-1', 0)`).run('2026-09-22T08:00:00.000Z');
  const command = {
    operationId: 'GEN-1', planningWindowStart: '2026-09-25T00:00:00.000Z',
    planningWindowEnd: '2026-09-26T00:00:00.000Z', resourceScope: ['STUDIO-A'],
  };
  let candidatePriority = 'p1';
  let calls = 0;
  const input = () => ({
    schemaVersion: 1, planningWindowStart: command.planningWindowStart,
    planningWindowEnd: command.planningWindowEnd, businessTimeZone: 'Asia/Shanghai',
    baseScheduleRevision: db.prepare(`SELECT schedule_revision FROM revision_counters
      WHERE id = 1`).get().schedule_revision,
    algorithmVersion: 'deterministic-scheduler-v1',
    calendarCompilerVersion: 'calendar-compiler-v1',
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: 'estimate-policy-v1', configVersion: 'config-v1',
    configDigest: admitted.configDigest,
    resources: [{ resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
      capabilityJson, capabilityDigest,
      businessWindows: [{ start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T10:00:00.000Z' }],
    }],
    candidates: requestIds.map((requestId, index) => ({ requestId, sourceOrdinal: index + 1, requestLifecycle: 'open',
      lifecycleProvenance: 'domainCommand', nonCancelledScheduleItemIds: [],
      productionType: '平面', shootingSubtype: '细节', desiredDate: '2026-09-25',
      sampleStatus: 'arrivedVerified', lightingPreset: 'LIGHT-SOFT', reflectivity: 'low',
      priority: candidatePriority, requiredCapabilityIds: ['FLAT'],
      durationEstimate: null, factProvenance: provenance,
    })),
    occupied: [], activeRuns: [], durationStats: [],
  });
  const store = createSqliteSchedulingProposalStoreV1({ db,
    assembleInput: () => {
      calls += 1;
      if (calls === 2 && mutateAfterFirst) candidatePriority = 'p0';
      return input();
    },
    now: () => new Date('2026-09-23T08:00:00.000Z'),
  });
  return { db, store, command, get calls() { return calls; },
    setPriority(value) { candidatePriority = value; },
  };
}

function acceptanceFixture(requestIds = ['REQ-1']) {
  const f = fixture({ requestIds });
  const at = '2026-09-23T08:00:00.000Z';
  f.db.prepare(`INSERT INTO scheduling_resources
    (resource_id, v1_display_place, status, capability_json, capability_digest,
     created_at, updated_at, source_operation_id)
    VALUES ('STUDIO-A', 'Studio A', 'active', ?, ?, ?, ?, 'RESOURCE-1')`).run(
    canonicalJsonSchedulingV1(capabilityJson), capabilityDigest, at, at,
  );
  for (const [index, id] of requestIds.entries()) {
    f.db.prepare(`INSERT INTO requests_v2
      (id, source_ordinal, sku, name, client, legacy_deliver_text, kind,
       v1_status_mode, request_lifecycle, lifecycle_provenance, source, imported_at,
       v1_assets_present, v1_request_present, production_type, shooting_subtype,
       deliverable_count, aspect_ratio, requested_by, desired_date, note,
       sample_status, lighting_preset, reflectivity, priority)
      VALUES (?, ?, ?, ?, 'Client', 'Deliverable', '细节', 'canonical', 'open', 'domain_command',
       'submission', ?, 1, 1, '平面', '细节', 1, '1:1', 'Planner', '2026-09-25', '',
       'arrivedVerified', 'LIGHT-SOFT', 'low', 'p1')`).run(
      id, index + 1, `SKU-${index + 1}`, `Product ${index + 1}`, at,
    );
  }
  const store = createSqliteSchedulingProposalStoreV1({ db: f.db,
    assembleInput: () => {
      return {
        schemaVersion: 1, planningWindowStart: f.command.planningWindowStart,
        planningWindowEnd: f.command.planningWindowEnd, businessTimeZone: 'Asia/Shanghai',
        baseScheduleRevision: f.db.prepare(`SELECT schedule_revision FROM revision_counters
          WHERE id = 1`).get().schedule_revision,
        algorithmVersion: 'deterministic-scheduler-v1',
        calendarCompilerVersion: 'calendar-compiler-v1',
        timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
        estimatePolicyVersion: 'estimate-policy-v1', configVersion: 'config-v1',
        configDigest: f.db.prepare(`SELECT config_digest FROM scheduling_config_versions
          WHERE config_version = 'config-v1'`).get().config_digest,
        resources: [{ resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
          capabilityJson, capabilityDigest,
          businessWindows: [{ start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T10:00:00.000Z' }],
        }],
        candidates: requestIds.map((requestId, index) => ({ requestId,
          sourceOrdinal: index + 1, requestLifecycle: 'open', lifecycleProvenance: 'domainCommand',
          nonCancelledScheduleItemIds: [], productionType: '平面', shootingSubtype: '细节',
          desiredDate: '2026-09-25', sampleStatus: 'arrivedVerified',
          lightingPreset: 'LIGHT-SOFT', reflectivity: 'low', priority: 'p1',
          requiredCapabilityIds: ['FLAT'], durationEstimate: null, factProvenance: provenance,
        })),
        occupied: [], activeRuns: [], durationStats: [],
      };
    },
    now: () => new Date(at),
    authorizeAcceptance: principal => principal?.role === 'scheduler',
    refreshProjections: context => refreshSqliteSnapshotProjectionsV2({
      ...context, businessTimeZone: 'Asia/Shanghai',
    }),
  });
  return { ...f, store };
}

test('acceptance creates canonical schedule, projections and one Outbox intent per item', () => {
  const f = acceptanceFixture(['REQ-1', 'REQ-2']);
  try {
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const ids = JSON.parse(generated.proposal.proposedItemsJson).map(item => item.proposalItemId);
    assert.equal(ids.length, 2);
    const command = { decisionId: 'DEC-ACCEPT-1', proposalId: generated.proposal.proposalId,
      decisionType: 'accept', selectedProposalItemIds: ids,
      decisionNote: null, reasonCode: null };
    assert.equal(f.store.accept(command, viewerPrincipal).code,
      'TRUSTED_SCHEDULER_REQUIRED');
    assert.equal(f.store.accept(command, otherStudioPrincipal).code,
      'TRUSTED_SCHEDULER_REQUIRED');
    const result = f.store.accept(command, schedulerPrincipal);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.resultingScheduleRevision, 8);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_item_tasks').get().count, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 2);
    assert.equal(f.db.prepare(`SELECT projection_revision, schedule_revision FROM revision_counters
      WHERE id = 1`).get().projection_revision, 1);
    assert.equal(f.store.read(command.proposalId).lifecycle.status, 'accepted');
    const replay = f.store.accept(command, schedulerPrincipal);
    assert.equal(replay.ok, true);
    assert.equal(replay.exactReplay, true);
    assert.equal(f.store.accept({ ...command, proposalId: 'MISSING-PROPOSAL' },
      schedulerPrincipal).code, 'IDEMPOTENCY_KEY_REUSE');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 2);
  } finally { f.db.close(); }
});

test('partial acceptance is one-shot and stales competing drafts in the same transaction', () => {
  const f = acceptanceFixture(['REQ-1', 'REQ-2']);
  try {
    const first = f.store.generate(f.command, 'scheduler:fixture');
    const second = f.store.generate({ ...f.command, operationId: 'GEN-2' }, 'scheduler:fixture');
    assert.equal(first.ok && second.ok, true);
    const selectedProposalItemIds = [JSON.parse(first.proposal.proposedItemsJson)[0].proposalItemId];
    const adopted = f.store.accept({ decisionId: 'DEC-PARTIAL-1',
      proposalId: first.proposal.proposalId, decisionType: 'partiallyAccept',
      selectedProposalItemIds, decisionNote: 'Only first request', reasonCode: null,
    }, schedulerPrincipal);
    assert.equal(adopted.ok, true, JSON.stringify(adopted));
    assert.equal(f.store.read(first.proposal.proposalId).lifecycle.status, 'partiallyAccepted');
    assert.equal(f.store.read(second.proposal.proposalId).lifecycle.status, 'stale');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_proposal_decisions').get().count, 2);
    assert.equal(f.db.prepare('SELECT schedule_revision FROM revision_counters WHERE id = 1')
      .get().schedule_revision, 8);
  } finally { f.db.close(); }
});

test('revision drift seals only the proposal and emits no schedule or Outbox facts', () => {
  const f = acceptanceFixture();
  try {
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    f.db.prepare('UPDATE revision_counters SET schedule_revision = 8 WHERE id = 1').run();
    const command = { decisionId: 'DEC-STALE-1',
      proposalId: generated.proposal.proposalId, decisionType: 'accept',
      selectedProposalItemIds: JSON.parse(generated.proposal.proposedItemsJson)
        .map(item => item.proposalItemId), decisionNote: null, reasonCode: null,
    };
    const result = f.store.accept(command, schedulerPrincipal);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.decisionType, 'stale');
    assert.equal(result.receipt.reasonCode, 'SCHEDULE_REVISION_CHANGED');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0);
    assert.deepEqual(f.store.accept(command, schedulerPrincipal), { ...result, exactReplay: true });
    assert.equal(f.store.accept({ ...command, proposalId: 'MISSING-PROPOSAL' },
      schedulerPrincipal).code, 'IDEMPOTENCY_KEY_REUSE');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM operations WHERE operation_id = ?')
      .get(command.decisionId).count, 1);
  } finally { f.db.close(); }
});

test('global operation ID collision returns a stable denial before acceptance writes', () => {
  const f = acceptanceFixture();
  try {
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    f.db.prepare(`INSERT INTO operations (operation_id, kind, response_json, created_at)
      VALUES ('DEC-TAKEN', 'replaceSnapshot', '{}', ?)`)
      .run('2026-09-23T08:00:00.000Z');
    const result = f.store.accept({ decisionId: 'DEC-TAKEN',
      proposalId: generated.proposal.proposalId, decisionType: 'accept',
      selectedProposalItemIds: JSON.parse(generated.proposal.proposedItemsJson)
        .map(item => item.proposalItemId), decisionNote: null, reasonCode: null,
    }, schedulerPrincipal);
    assert.equal(result.code, 'IDEMPOTENCY_KEY_REUSE');
    assert.equal(f.store.read(generated.proposal.proposalId).lifecycle.status, 'draft');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0);
  } finally { f.db.close(); }
});

test('projection failure rolls back every accepted item, revision, receipt and Outbox row', () => {
  const f = acceptanceFixture(['REQ-1', 'REQ-2']);
  try {
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    const failing = createSqliteSchedulingProposalStoreV1({ db: f.db,
      assembleInput: () => JSON.parse(generated.proposal.inputSnapshotJson),
      now: () => new Date('2026-09-23T08:00:00.000Z'),
      authorizeAcceptance: () => true,
      refreshProjections: () => { throw new Error('PROJECTION_FAILED'); },
    });
    assert.throws(() => failing.accept({ decisionId: 'DEC-FAIL-1',
      proposalId: generated.proposal.proposalId, decisionType: 'accept',
      selectedProposalItemIds: JSON.parse(generated.proposal.proposedItemsJson)
        .map(item => item.proposalItemId), decisionNote: null, reasonCode: null,
    }, schedulerPrincipal), /PROJECTION_FAILED/);
    assert.equal(f.store.read(generated.proposal.proposalId).lifecycle.status, 'draft');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_proposal_decisions').get().count, 0);
    assert.equal(f.db.prepare('SELECT schedule_revision FROM revision_counters WHERE id = 1')
      .get().schedule_revision, 7);
  } finally { f.db.close(); }
});

test('generation persists an immutable draft without consuming schedule revision and replays exactly', () => {
  const f = fixture();
  try {
    const result = f.store.generate(f.command, 'scheduler:fixture');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.proposal.proposalId.startsWith('sp_'), true);
    assert.equal(result.proposal.inputSnapshotJson,
      canonicalJsonSchedulingV1(JSON.parse(result.proposal.inputSnapshotJson)));
    assert.equal(result.lifecycle.status, 'draft');
    assert.equal(f.calls, 2);
    assert.equal(f.db.prepare('SELECT schedule_revision FROM revision_counters WHERE id = 1').get()
      .schedule_revision, 7);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
    const { generate } = f.store;
    const replay = generate(f.command, 'scheduler:fixture');
    assert.equal(replay.ok, true);
    assert.equal(replay.proposal.proposalId, result.proposal.proposalId);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_proposals').get().count, 1);
    assert.equal(f.store.generate({ ...f.command, planningWindowEnd: '2026-09-27T00:00:00.000Z' },
      'scheduler:fixture').code, 'IDEMPOTENCY_KEY_REUSE');
  } finally { f.db.close(); }
});

test('compute-time input change saves no draft', () => {
  const f = fixture({ mutateAfterFirst: true });
  try {
    assert.equal(f.store.generate(f.command, 'scheduler:fixture').code,
      'SCHEDULING_INPUT_CHANGED_RETRY');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_proposals').get().count, 0);
  } finally { f.db.close(); }
});

test('missing active config and expected assembler failures return stable denials', () => {
  const empty = new DatabaseSync(':memory:');
  empty.exec('PRAGMA foreign_keys = ON;');
  initializeWritableSchema(empty);
  empty.prepare(`INSERT INTO revision_counters
    (id, projection_revision, schedule_revision, updated_at) VALUES (1, 0, 0, ?)`)
    .run('2026-09-22T08:00:00.000Z');
  try {
    const store = createSqliteSchedulingProposalStoreV1({ db: empty,
      assembleInput: assembleSchedulingInputFromSqliteV1,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    assert.equal(store.generate({ operationId: 'GEN-NO-CONFIG',
      planningWindowStart: '2026-09-25T00:00:00.000Z',
      planningWindowEnd: '2026-09-26T00:00:00.000Z',
      resourceScope: ['STUDIO-A'],
    }, 'scheduler:fixture').code, 'SCHEDULING_CONFIG_NOT_ACTIVE');
  } finally { empty.close(); }
  const f = fixture();
  try {
    const store = createSqliteSchedulingProposalStoreV1({ db: f.db,
      assembleInput: assembleSchedulingInputFromSqliteV1,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    assert.equal(store.generate(f.command, 'scheduler:fixture').code,
      'SCHEDULING_RESOURCE_NOT_REGISTERED');
    assert.equal(store.generate({ ...f.command, operationId: 'GEN-LONG',
      planningWindowEnd: '2027-10-01T00:00:00.000Z',
    }, 'scheduler:fixture').code, 'SCHEDULING_PLANNING_RANGE_UNSUPPORTED');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_proposals').get().count, 0);
  } finally { f.db.close(); }
});

test('reject is terminal, append-only, idempotent, and cannot write schedule facts', () => {
  const f = fixture();
  try {
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    assert.equal(generated.ok, true, JSON.stringify(generated));
    assert.equal(f.store.reject({ decisionId: 'DEC-ACCEPT-UNWIRED',
      proposalId: generated.proposal.proposalId, decisionType: 'accept',
      selectedProposalItemIds: JSON.parse(generated.proposal.proposedItemsJson)
        .map(item => item.proposalItemId), decisionNote: null, reasonCode: null,
    }, 'admin:fixture').code, 'PROPOSAL_ACCEPT_NOT_WIRED');
    const command = { decisionId: 'DEC-1', proposalId: generated.proposal.proposalId,
      decisionType: 'reject', selectedProposalItemIds: null, decisionNote: null,
      reasonCode: 'HUMAN_REJECTED',
    };
    const rejected = f.store.reject(command, 'admin:fixture');
    assert.equal(rejected.ok, true, JSON.stringify(rejected));
    assert.equal(rejected.receipt.decisionType, 'reject');
    assert.equal(f.store.read(generated.proposal.proposalId).lifecycle.status, 'rejected');
    assert.deepEqual(f.store.reject(command, 'admin:fixture'),
      { ...rejected, exactReplay: true });
    assert.equal(f.store.reject({ ...command, proposalId: 'MISSING-PROPOSAL' },
      'admin:fixture').code, 'IDEMPOTENCY_KEY_REUSE');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
    assert.equal(f.db.prepare('SELECT schedule_revision FROM revision_counters WHERE id = 1').get()
      .schedule_revision, 7);
  } finally { f.db.close(); }
});

test('system stale seals a draft with one deterministic receipt', () => {
  const f = fixture();
  try {
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const input = { proposalId: generated.proposal.proposalId,
      triggerOperationId: 'RESOURCE-CHANGE-1', reasonCode: 'RESOURCE_CHANGED',
    };
    const first = f.store.stale(input);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.receipt.decisionType, 'stale');
    assert.equal(first.receipt.decidedBy, 'system:scheduling-invalidation-v1');
    assert.equal(f.store.read(input.proposalId).lifecycle.status, 'stale');
    assert.deepEqual(f.store.stale(input), { ...first, exactReplay: true });
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_proposal_decisions').get().count, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
  } finally { f.db.close(); }
});

test('SQLite input assembler reads the explicit catalog and produces a safe empty draft', () => {
  const f = fixture();
  try {
    f.db.prepare(`INSERT INTO scheduling_resources
      (resource_id, v1_display_place, status, capability_json, capability_digest,
       created_at, updated_at, source_operation_id)
      VALUES ('STUDIO-A', 'Studio A', 'active', ?, ?, ?, ?, 'RESOURCE-1')`).run(
      canonicalJsonSchedulingV1(capabilityJson), capabilityDigest,
      '2026-09-22T08:00:00.000Z', '2026-09-22T08:00:00.000Z',
    );
    const store = createSqliteSchedulingProposalStoreV1({ db: f.db,
      assembleInput: assembleSchedulingInputFromSqliteV1,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    const generated = store.generate(f.command, 'scheduler:fixture');
    assert.equal(generated.ok, true, JSON.stringify(generated));
    assert.equal(JSON.parse(generated.proposal.proposedItemsJson).length, 0);
    assert.equal(JSON.parse(generated.proposal.inputSnapshotJson).resources[0].resourceId, 'STUDIO-A');
  } finally { f.db.close(); }
});

test('admin resource and config commands use revision guards and stale drafts on activation', () => {
  const f = fixture();
  try {
    const projections = [];
    const admin = createSqliteSchedulingAdminStoreV1({ db: f.db,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
      refreshProjections: value => projections.push(refreshSqliteSnapshotProjectionsV2({
        ...value, businessTimeZone: 'Asia/Shanghai',
      })),
    });
    const resourceCommand = { operationId: 'RESOURCE-1', expectedScheduleRevision: 7,
      expectedProjectionRevision: 0,
      resource: { resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
        capabilityJson, capabilityDigest,
      },
    };
    const registered = admin.registerResource(resourceCommand, 'admin:fixture');
    assert.equal(registered.ok, true, JSON.stringify(registered));
    assert.equal(registered.scheduleRevision, 8);
    assert.equal(registered.projectionRevision, 1);
    assert.equal(admin.registerResource(resourceCommand, 'admin:fixture').exactReplay, true);
    assert.equal(projections.length, 1);
    const normalized = normalizeSchedulingConfigV1(config());
    const published = admin.publishConfig({ operationId: 'PUBLISH-2', configVersion: 'config-v2',
      algorithmVersion: 'deterministic-scheduler-v1',
      calendarCompilerVersion: 'calendar-compiler-v1',
      estimatePolicyVersion: 'estimate-policy-v1',
      configJson: config(), configDigest: normalized.configDigest,
    }, 'admin:fixture');
    assert.equal(published.ok, true, JSON.stringify(published));
    const generated = f.store.generate(f.command, 'scheduler:fixture');
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const activated = admin.activateConfig({ operationId: 'ACTIVATE-2',
      configVersion: 'config-v2', expectedProjectionRevision: 1,
    }, 'admin:fixture');
    assert.equal(activated.ok, true, JSON.stringify(activated));
    assert.equal(activated.scheduleRevision, 8);
    assert.equal(activated.projectionRevision, 2);
    assert.equal(f.store.read(generated.proposal.proposalId).lifecycle.status, 'stale');
    assert.equal(projections.length, 2);
    assert.equal(f.db.prepare(`SELECT revision FROM snapshot_projections
      WHERE projection_name = 'schedule-v2'`).get().revision, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
  } finally { f.db.close(); }
});

test('explicit request requirements let the SQLite assembler produce one eligible item', () => {
  const f = fixture();
  try {
    f.db.prepare(`INSERT INTO scheduling_resources
      (resource_id, v1_display_place, status, capability_json, capability_digest,
       created_at, updated_at, source_operation_id)
      VALUES ('STUDIO-A', 'Studio A', 'active', ?, ?, ?, ?, 'RESOURCE-1')`).run(
      canonicalJsonSchedulingV1(capabilityJson), capabilityDigest,
      '2026-09-22T08:00:00.000Z', '2026-09-22T08:00:00.000Z',
    );
    f.db.prepare(`INSERT INTO requests_v2
      (id, source_ordinal, sku, name, client, legacy_deliver_text, kind,
       v1_status_mode, request_lifecycle, lifecycle_provenance, source, imported_at,
       v1_assets_present, v1_request_present, production_type, shooting_subtype,
       deliverable_count, aspect_ratio, sample_status, lighting_preset, reflectivity, priority)
      VALUES ('REQ-DB-1', 1, 'SKU-1', 'Product', 'Client', '', '细节',
        'canonical', 'open', 'domain_command', 'submission', ?,
        0, 0, '平面', '细节', 1, '1:1', 'arrivedVerified', 'LIGHT-SOFT', 'low', 'p1')`)
      .run('2026-09-22T08:00:00.000Z');
    const admin = createSqliteSchedulingAdminStoreV1({ db: f.db,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
      refreshProjections: () => {},
    });
    const set = admin.setRequestRequirements({ operationId: 'REQ-REQUIREMENTS-1',
      expectedScheduleRevision: 7, expectedProjectionRevision: 0,
      requestId: 'REQ-DB-1', requiredCapabilityIds: ['FLAT'], durationEstimate: null,
    }, 'admin:fixture');
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal(set.scheduleRevision, 7);
    assert.equal(set.projectionRevision, 1);
    const store = createSqliteSchedulingProposalStoreV1({ db: f.db,
      assembleInput: assembleSchedulingInputFromSqliteV1,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    const generated = store.generate(f.command, 'scheduler:fixture');
    assert.equal(generated.ok, true, JSON.stringify(generated));
    assert.deepEqual(JSON.parse(generated.proposal.proposedItemsJson).map(item => item.requestId),
      ['REQ-DB-1']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_items').get().count, 0);
  } finally { f.db.close(); }
});

test('missing projection port fails closed and refresh failure rolls back resource facts', () => {
  const f = fixture();
  try {
    const command = { operationId: 'RESOURCE-ROLLBACK-1', expectedScheduleRevision: 7,
      expectedProjectionRevision: 0,
      resource: { resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
        capabilityJson, capabilityDigest,
      },
    };
    const unwired = createSqliteSchedulingAdminStoreV1({ db: f.db,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
    });
    assert.equal(unwired.registerResource(command, 'admin:fixture').code,
      'SCHEDULING_PROJECTION_NOT_CONFIGURED');
    const failing = createSqliteSchedulingAdminStoreV1({ db: f.db,
      now: () => new Date('2026-09-23T08:00:00.000Z'),
      refreshProjections: () => { throw new Error('PROJECTION_REJECTED'); },
    });
    assert.throws(() => failing.registerResource(command, 'admin:fixture'), /PROJECTION_REJECTED/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_resources').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scheduling_admin_operations').get().count, 0);
    const revision = f.db.prepare(`SELECT schedule_revision, projection_revision
      FROM revision_counters WHERE id = 1`).get();
    assert.equal(revision.schedule_revision, 7);
    assert.equal(revision.projection_revision, 0);
  } finally { f.db.close(); }
});
