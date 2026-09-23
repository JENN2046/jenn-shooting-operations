import assert from 'node:assert/strict';
import test from 'node:test';

import { digestSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';
import {
  SCHEDULING_TIME_ZONE_DATA_VERSION,
  digestResourceCapabilitiesV1,
} from '../src/scheduling-contract-v1.mjs';
import { generateDeterministicScheduleV1 } from '../src/deterministic-scheduler-v1.mjs';

const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
const provenance = Object.fromEntries([
  'productionType', 'shootingSubtype', 'desiredDate', 'sampleStatus', 'lightingPreset',
  'reflectivity', 'priority', 'requiredCapabilityIds', 'durationEstimate',
].map(key => [key, 'domain-command-v1']));

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    businessTimeZone: 'Asia/Shanghai',
    resourceCalendars: [{
      resourceId: 'STUDIO-A', capabilityDigest,
      weeklyWindows: [{ weekday: 5, start: '09:00', end: '18:00' }],
      dateOverrides: [],
    }],
    durationFallbackRules: [{
      ruleId: 'duration-flat', productionType: '平面', shootingSubtype: null,
      durationMs: 3_600_000,
    }],
    bufferRules: [{
      ruleId: 'buffer-flat', productionType: '平面', shootingSubtype: null,
      bufferAfterMinutes: 15,
    }],
    softScoringWeights: {
      LIGHTING_SWITCH: 1, REFLECTIVITY_SEQUENCE: 1, IDLE_GAP: 1,
      EXPECTED_OVERRUN: 1, DESIRED_DATE_MISS: 1,
    },
    compatibleAlgorithmVersions: ['deterministic-scheduler-v1'],
    ...overrides,
  };
}

function candidate(requestId, overrides = {}) {
  return {
    requestId, sourceOrdinal: requestId === 'REQ-P0' ? 2 : 1,
    requestLifecycle: 'open', lifecycleProvenance: 'domainCommand',
    nonCancelledScheduleItemIds: [], productionType: '平面', shootingSubtype: '细节',
    desiredDate: '2026-09-25', sampleStatus: 'arrivedVerified',
    lightingPreset: 'LIGHT-SOFT', reflectivity: 'low', priority: 'p1',
    requiredCapabilityIds: ['FLAT'], durationEstimate: null, factProvenance: provenance,
    ...overrides,
  };
}

function input(configJson, overrides = {}) {
  return {
    schemaVersion: 1,
    planningWindowStart: '2026-09-25T00:00:00.000Z',
    planningWindowEnd: '2026-09-26T00:00:00.000Z',
    businessTimeZone: 'Asia/Shanghai', baseScheduleRevision: 0,
    algorithmVersion: 'deterministic-scheduler-v1',
    calendarCompilerVersion: 'calendar-compiler-v1',
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: 'estimate-policy-v1', configVersion: 'config-v1',
    configDigest: digestSchedulingConfigV1(configJson),
    resources: [{ resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
      capabilityJson, capabilityDigest,
      businessWindows: [{ start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T10:00:00.000Z' }],
    }],
    candidates: [candidate('REQ-P1')],
    occupied: [], activeRuns: [], durationStats: [],
    ...overrides,
  };
}

test('priority, Buffer and fallback produce a deterministic proposal across input permutation', () => {
  const settings = config();
  const p0 = candidate('REQ-P0', { priority: 'p0' });
  const p1 = candidate('REQ-P1');
  const first = generateDeterministicScheduleV1(input(settings, { candidates: [p1, p0] }), settings);
  const second = generateDeterministicScheduleV1(input(settings, { candidates: [p0, p1] }), settings);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(first.inputDigest, second.inputDigest);
  assert.equal(first.resultDigest, second.resultDigest);
  assert.deepEqual(first.result.proposedItems.map(item => [item.requestId, item.plannedStart]), [
    ['REQ-P0', '2026-09-25T01:00:00.000Z'],
    ['REQ-P1', '2026-09-25T02:15:00.000Z'],
  ]);
  assert.equal(first.result.proposedItems[0].durationSource, 'fallback');
  assert.equal(first.result.proposedItems[0].proposalItemId,
    'spi_cc9a01dbe4f4d73bbf9432fe5fffd6ed897650670b17922a30618e1b7c9347f3');
});

test('unknown legacy Buffer blocks its resource and P0 cannot override an unverified sample', () => {
  const settings = config();
  const blocked = generateDeterministicScheduleV1(input(settings, {
    occupied: [{
      scheduleItemId: 'OLD-1', sourceOrdinal: 1, resourceId: 'STUDIO-A',
      resourceResolutionStatus: 'resolved', allocationMode: 'single',
      taskBindings: [{ requestId: 'OLD-REQ', displayOrder: 0 }],
      plannedStart: '2026-09-25T02:00:00.000Z', plannedEnd: '2026-09-25T03:00:00.000Z',
      bufferAfterMinutes: null, bufferSource: 'legacy_unknown', scheduleStatus: 'confirmed',
      lockStatus: null, lockStatusProvenance: 'legacy_unknown', source: 'migration',
    }],
    candidates: [candidate('REQ-P0', { priority: 'p0' })],
  }), settings);
  assert.equal(blocked.ok, true, JSON.stringify(blocked));
  assert.equal(blocked.result.proposedItems.length, 0);
  assert.ok(blocked.result.diagnostics.some(item => item.code === 'LEGACY_BUFFER_UNKNOWN'));

  const sampleBlocked = generateDeterministicScheduleV1(input(settings, {
    candidates: [candidate('REQ-P0', { priority: 'p0', sampleStatus: 'inTransit' })],
  }), settings);
  assert.equal(sampleBlocked.result.proposedItems.length, 0);
  assert.ok(sampleBlocked.result.diagnostics.some(item => item.code === 'SAMPLE_NOT_VERIFIED'));
});

test('occupied intervals and Buffer move the next proposal without moving existing work', () => {
  const settings = config();
  const scheduled = generateDeterministicScheduleV1(input(settings, {
    occupied: [{
      scheduleItemId: 'OLD-1', sourceOrdinal: 1, resourceId: 'STUDIO-A',
      resourceResolutionStatus: 'resolved', allocationMode: 'single',
      taskBindings: [{ requestId: 'OLD-REQ', displayOrder: 0 }],
      plannedStart: '2026-09-25T01:00:00.000Z', plannedEnd: '2026-09-25T02:00:00.000Z',
      bufferAfterMinutes: 30, bufferSource: 'config-v1', scheduleStatus: 'confirmed',
      lockStatus: 'locked', lockStatusProvenance: 'domain_command', source: 'human',
    }],
  }), settings);
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));
  assert.equal(scheduled.result.proposedItems[0].plannedStart, '2026-09-25T02:30:00.000Z');
});

test('a locked grouped block remains indivisible and identifies its conflict', () => {
  const settings = config({ resourceCalendars: [{
    resourceId: 'STUDIO-A', capabilityDigest,
    weeklyWindows: [{ weekday: 5, start: '09:00', end: '10:30' }], dateOverrides: [],
  }] });
  const blocked = generateDeterministicScheduleV1(input(settings, {
    resources: [{ resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
      capabilityJson, capabilityDigest,
      businessWindows: [{ start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T02:30:00.000Z' }],
    }],
    occupied: [{
      scheduleItemId: 'GROUP-1', sourceOrdinal: 1, resourceId: 'STUDIO-A',
      resourceResolutionStatus: 'resolved', allocationMode: 'groupedUnallocated',
      taskBindings: [{ requestId: 'OLD-1', displayOrder: 0 },
        { requestId: 'OLD-2', displayOrder: 1 }],
      plannedStart: '2026-09-25T01:00:00.000Z', plannedEnd: '2026-09-25T02:00:00.000Z',
      bufferAfterMinutes: 15, bufferSource: 'config-v1', scheduleStatus: 'confirmed',
      lockStatus: 'locked', lockStatusProvenance: 'domain_command', source: 'human',
    }],
  }), settings);
  assert.equal(blocked.ok, true, JSON.stringify(blocked));
  assert.equal(blocked.result.proposedItems.length, 0);
  assert.ok(blocked.result.diagnostics.some(item => item.code === 'LOCKED_INTERVAL_CONFLICT'
    && item.scheduleItemId === 'GROUP-1'));
});

test('config mismatch and missing Buffer rule fail closed', () => {
  const settings = config();
  assert.equal(generateDeterministicScheduleV1(input(settings, {
    configDigest: `sha256:${'0'.repeat(64)}`,
  }), settings).reason, 'CONFIG_MISMATCH');
  const noBuffer = config({ bufferRules: [] });
  assert.equal(generateDeterministicScheduleV1(input(noBuffer), noBuffer).reason, 'BUFFER_RULE_MISSING');
});

test('the engine rejects a business window that was not compiled from active config', () => {
  const settings = config();
  const forged = input(settings);
  forged.resources[0].businessWindows[0].start = '2026-09-25T00:00:00.000Z';
  assert.equal(generateDeterministicScheduleV1(forged, settings).reason,
    'BUSINESS_WINDOW_CONFIG_MISMATCH');
});

test('partial-day planning uses exact clipped windows and rejects omitted capacity', () => {
  const settings = config();
  const scope = {
    planningWindowStart: '2026-09-25T02:30:00.000Z',
    planningWindowEnd: '2026-09-25T05:00:00.000Z',
  };
  const clipped = input(settings, scope);
  clipped.resources[0].businessWindows = [{
    start: scope.planningWindowStart, end: scope.planningWindowEnd,
  }];
  const result = generateDeterministicScheduleV1(clipped, settings);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.proposedItems[0].plannedStart, scope.planningWindowStart);

  const omitted = input(settings, scope);
  omitted.resources[0].businessWindows = [];
  assert.equal(generateDeterministicScheduleV1(omitted, settings).reason,
    'BUSINESS_WINDOW_CONFIG_MISMATCH');

  const shortened = input(settings, scope);
  shortened.resources[0].businessWindows = [{
    start: '2026-09-25T03:00:00.000Z', end: scope.planningWindowEnd,
  }];
  assert.equal(generateDeterministicScheduleV1(shortened, settings).reason,
    'BUSINESS_WINDOW_CONFIG_MISMATCH');
});

test('explicit duration remains authoritative while a longer matched statistic reports overrun risk', () => {
  const settings = config();
  const scheduled = generateDeterministicScheduleV1(input(settings, {
    candidates: [candidate('REQ-P1', {
      durationEstimate: { durationMs: 3_600_000, source: 'explicit', sourceVersion: 'manual-v1' },
    })],
    durationStats: [{
      statId: 'STAT-1', resourceId: 'STUDIO-A', productionType: '平面',
      shootingSubtype: '细节', lightingPreset: 'LIGHT-SOFT', reflectivity: 'low',
      sampleCount: 4, estimateDurationMs: 5_400_000, metricVersion: 'median-v1',
    }],
  }), settings);
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));
  assert.equal(scheduled.result.proposedItems[0].durationMs, 3_600_000);
  assert.ok(scheduled.result.diagnostics.some(item => item.code === 'EXPECTED_OVERRUN'));
});

test('the task and its Buffer must both fit inside the business window', () => {
  const settings = config({ resourceCalendars: [{
    resourceId: 'STUDIO-A', capabilityDigest,
    weeklyWindows: [{ weekday: 5, start: '09:00', end: '10:00' }], dateOverrides: [],
  }] });
  const result = generateDeterministicScheduleV1(input(settings, {
    resources: [{ resourceId: 'STUDIO-A', v1DisplayPlace: 'Studio A', status: 'active',
      capabilityJson, capabilityDigest,
      businessWindows: [{ start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T02:00:00.000Z' }],
    }],
  }), settings);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.proposedItems.length, 0);
  assert.ok(result.result.diagnostics.some(item => item.code === 'OUTSIDE_BUSINESS_CALENDAR'));
});

test('no retrospective estimate and no configured fallback gives a hard duration diagnostic', () => {
  const settings = config({ durationFallbackRules: [] });
  const result = generateDeterministicScheduleV1(input(settings), settings);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.proposedItems.length, 0);
  assert.ok(result.result.diagnostics.some(item => item.code === 'DURATION_UNKNOWN'));
});

test('equal earliest slots and soft scores choose the stable resource ID', () => {
  const calendar = resourceId => ({ resourceId, capabilityDigest,
    weeklyWindows: [{ weekday: 5, start: '09:00', end: '18:00' }], dateOverrides: [],
  });
  const resource = resourceId => ({ resourceId, v1DisplayPlace: resourceId,
    status: 'active', capabilityJson, capabilityDigest,
    businessWindows: [{ start: '2026-09-25T01:00:00.000Z', end: '2026-09-25T10:00:00.000Z' }],
  });
  const settings = config({ resourceCalendars: [calendar('STUDIO-Z'), calendar('STUDIO-A')] });
  const first = generateDeterministicScheduleV1(input(settings, {
    resources: [resource('STUDIO-Z'), resource('STUDIO-A')],
  }), settings);
  const second = generateDeterministicScheduleV1(input(settings, {
    resources: [resource('STUDIO-A'), resource('STUDIO-Z')],
  }), settings);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.result.proposedItems[0].resourceId, 'STUDIO-A');
  assert.equal(first.inputDigest, second.inputDigest);
  assert.equal(first.resultDigest, second.resultDigest);
});
