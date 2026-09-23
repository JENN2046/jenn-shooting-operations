import { normalizeSchedulingConfigV1 } from './scheduling-admin-contract-v1.mjs';
import {
  buildSchedulingRunContextSnapshotV1,
  RUN_CONTEXT_SNAPSHOT_SCHEMA_V1,
} from './scheduling-evaluation-contract-v1.mjs';

const EVALUATION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function matchingRule(rules, request) {
  return rules.find(rule => (
    (rule.productionType === null || rule.productionType === request.production_type)
    && (rule.shootingSubtype === null || rule.shootingSubtype === request.shooting_subtype)
  )) ?? null;
}

function resolveDurationEstimate(requirements, request, config) {
  if (requirements?.duration_estimate_json) {
    try {
      const value = JSON.parse(requirements.duration_estimate_json);
      if (value && Number.isSafeInteger(value.durationMs) && value.durationMs > 0
        && value.source === 'explicit'
        && typeof value.sourceVersion === 'string'
        && EVALUATION_TOKEN.test(value.sourceVersion)) {
        return {
          durationMs: value.durationMs,
          provenance: value.source,
          version: value.sourceVersion,
        };
      }
    } catch {}
    return null;
  }
  const fallback = matchingRule(config.durationFallbackRules, request);
  return fallback && EVALUATION_TOKEN.test(fallback.ruleId) ? {
    durationMs: fallback.durationMs,
    provenance: 'fallback',
    version: fallback.ruleId,
  } : null;
}

function ineligibleBase({ runId, scope, scheduleItem, request, capturedAt, reason }) {
  return {
    schemaVersion: RUN_CONTEXT_SNAPSHOT_SCHEMA_V1,
    runId,
    scope,
    scheduleItemId: scheduleItem.id,
    requestId: scope === 'task' ? request?.id ?? null : null,
    resourceId: scheduleItem.resource_id ?? null,
    productionType: request?.production_type ?? null,
    shootingSubtype: request?.shooting_subtype ?? null,
    lightingPreset: request?.lighting_preset ?? null,
    reflectivity: request?.reflectivity ?? null,
    durationEstimate: null,
    bufferAfterMinutes: scheduleItem.buffer_after_minutes ?? null,
    bufferSource: scheduleItem.buffer_source ?? null,
    resourceCapabilityDigest: null,
    configVersion: null,
    configDigest: null,
    contextStatus: 'ineligible',
    ineligibleReason: reason,
    capturedAt,
  };
}

export function buildFirstStartRunContextSnapshotV1({
  runId,
  scope,
  scheduleItem,
  requests,
  resource,
  requestRequirements,
  activeConfig,
  capturedAt,
} = {}) {
  if (!scheduleItem || !Array.isArray(requests) || typeof capturedAt !== 'string') {
    return Object.freeze({ ok: false, code: 'RUN_CONTEXT_CAPTURE_INPUT_INVALID' });
  }
  if (scope === 'block') {
    return buildSchedulingRunContextSnapshotV1(ineligibleBase({
      runId, scope, scheduleItem, request: null, capturedAt, reason: 'GROUPED_UNALLOCATED',
    }));
  }
  const request = requests.length === 1 ? requests[0] : null;
  if (!activeConfig) {
    return buildSchedulingRunContextSnapshotV1(ineligibleBase({
      runId, scope, scheduleItem, request, capturedAt, reason: 'CONFIG_MISSING',
    }));
  }
  let config;
  try {
    const admitted = normalizeSchedulingConfigV1(JSON.parse(activeConfig.config_json));
    if (!admitted.ok
      || admitted.configJson !== activeConfig.config_json
      || admitted.configDigest !== activeConfig.config_digest) {
      throw new Error('invalid config');
    }
    config = admitted.config;
  } catch {
    return buildSchedulingRunContextSnapshotV1(ineligibleBase({
      runId, scope, scheduleItem, request, capturedAt, reason: 'CONFIG_MISSING',
    }));
  }

  const durationEstimate = request
    ? resolveDurationEstimate(requestRequirements, request, config)
    : null;
  const completeFacts = [
    request?.id,
    scheduleItem.resource_id,
    request?.production_type,
    request?.shooting_subtype,
    request?.lighting_preset,
    request?.reflectivity,
    durationEstimate,
    scheduleItem.buffer_after_minutes,
    scheduleItem.buffer_source,
    resource?.capability_digest,
    activeConfig.config_version,
    activeConfig.config_digest,
  ];
  if (completeFacts.some(value => value === null || value === undefined)) {
    return buildSchedulingRunContextSnapshotV1({
      ...ineligibleBase({
        runId, scope, scheduleItem, request, capturedAt, reason: 'RULE_FACT_MISSING',
      }),
      durationEstimate,
      resourceCapabilityDigest: resource?.capability_digest ?? null,
      configVersion: activeConfig.config_version ?? null,
      configDigest: activeConfig.config_digest ?? null,
    });
  }

  return buildSchedulingRunContextSnapshotV1({
    schemaVersion: RUN_CONTEXT_SNAPSHOT_SCHEMA_V1,
    runId,
    scope,
    scheduleItemId: scheduleItem.id,
    requestId: request.id,
    resourceId: scheduleItem.resource_id,
    productionType: request.production_type,
    shootingSubtype: request.shooting_subtype,
    lightingPreset: request.lighting_preset,
    reflectivity: request.reflectivity,
    durationEstimate,
    bufferAfterMinutes: scheduleItem.buffer_after_minutes,
    bufferSource: scheduleItem.buffer_source,
    resourceCapabilityDigest: resource.capability_digest,
    configVersion: activeConfig.config_version,
    configDigest: activeConfig.config_digest,
    contextStatus: 'complete',
    ineligibleReason: null,
    capturedAt,
  });
}
