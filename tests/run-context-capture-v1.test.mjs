import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFirstStartRunContextSnapshotV1 } from '../src/run-context-capture-v1.mjs';
import { normalizeSchedulingConfigV1 } from '../src/scheduling-admin-contract-v1.mjs';
import { canonicalJsonSchedulingV1, digestResourceCapabilitiesV1 } from '../src/scheduling-contract-v1.mjs';

test('valid requirement versions outside evaluation token space become RULE_FACT_MISSING evidence', () => {
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
  const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
  const config = {
    schemaVersion: 1,
    businessTimeZone: 'UTC',
    resourceCalendars: [{
      resourceId: 'RESOURCE-A',
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

  const result = buildFirstStartRunContextSnapshotV1({
    runId: 'RUN-CAPTURE-1',
    scope: 'task',
    scheduleItem: {
      id: 'SCHEDULE-1',
      resource_id: 'RESOURCE-A',
      buffer_after_minutes: 15,
      buffer_source: 'config-v1',
    },
    requests: [{
      id: 'REQUEST-1',
      production_type: '平面',
      shooting_subtype: '细节',
      lighting_preset: 'LIGHT-SOFT',
      reflectivity: 'low',
    }],
    resource: {
      resource_id: 'RESOURCE-A',
      capability_digest: capabilityDigest,
    },
    requestRequirements: {
      required_capability_ids_json: canonicalJsonSchedulingV1(['FLAT']),
      duration_estimate_json: canonicalJsonSchedulingV1({
        durationMs: 1_800_000,
        source: 'explicit',
        sourceVersion: '版本 1',
      }),
    },
    activeConfig: {
      config_version: 'config-v1',
      config_json: admitted.configJson,
      config_digest: admitted.configDigest,
    },
    capturedAt: '2026-09-23T08:00:00.000Z',
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.snapshot.contextStatus, 'ineligible');
  assert.equal(result.snapshot.ineligibleReason, 'RULE_FACT_MISSING');
  assert.equal(result.snapshot.durationEstimate, null);
  assert.equal(result.snapshot.runId, 'RUN-CAPTURE-1');
});
