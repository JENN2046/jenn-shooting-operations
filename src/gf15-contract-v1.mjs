import authority from '../docs/operations/production-greenfield-authority.v1.json' with { type: 'json' };
import { validateV2Submission } from './contract-validator.mjs';
import { normalizeSchedulingConfigV1, compileSchedulingCalendarDateV1 } from './scheduling-admin-contract-v1.mjs';
import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1,
  SCHEDULING_TIME_ZONE_DATA_VERSION } from './scheduling-contract-v1.mjs';
import { generateDeterministicScheduleV1 } from './deterministic-scheduler-v1.mjs';
import { gf15Fail } from './sqlite-scheduling-quiescence-v1.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const GF15_REQUEST = freeze(authority.greenfieldKioskAcceptancePreparationAction.requestContract);
export const GF15_CONFIG = freeze(authority.greenfieldKioskAcceptancePreparationConfigContract);
export const GF15_ROLLBACK = freeze(authority.greenfieldKioskAcceptancePreparationRollbackAction);
export const GF15_IDS = Object.freeze({ resource: 'STUDIO-PROD-01', request: GF15_REQUEST.requestId,
  config: GF15_CONFIG.configVersion, requestOperation: GF15_REQUEST.requestOperationId,
  resourceOperation: 'PRODGF15-RESOURCE-R1', publish: 'PRODGF15-CONFIG-PUBLISH-R1',
  activate: 'PRODGF15-CONFIG-ACTIVATE-R1', requirements: 'PRODGF15-REQS-R1',
  proposal: 'PRODGF15-PROPOSAL-R1', decision: 'PRODGF15-DECISION-R1',
  rollbackResource: 'PRODGF15-ROLLBACK-RESOURCE-R1', rollbackConfig: 'PRODGF15-ROLLBACK-CONFIG-ACTIVATE-R1' });
export const GF15_RESOURCE = freeze({ resourceId: GF15_IDS.resource,
  v1DisplayPlace: 'Studio PROD 01 Kiosk Acceptance', status: 'active',
  capabilityJson: { schemaVersion: 1, capabilityIds: ['FLAT'] },
  capabilityDigest: GF15_CONFIG.resourceCalendarStatic.capabilityDigest });

export function gf15Equal(a, b) { return canonicalJsonSchedulingV1(a) === canonicalJsonSchedulingV1(b); }

export function gf15LocalDate(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function gf15TrustedNow(now) {
  if (typeof now !== 'function') gf15Fail('GF15_TRUSTED_TIME_INVALID');
  const instant = now();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) gf15Fail('GF15_TRUSTED_TIME_INVALID');
  return instant;
}

function assertGf15FutureDateAt(date, instant) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00+08:00`))
    || gf15LocalDate(new Date(`${date}T00:00:00+08:00`)) !== date
    || date <= gf15LocalDate(instant)) gf15Fail('GF15_DATE_NOT_FUTURE');
}

export function assertGf15FutureDate(date, now) {
  assertGf15FutureDateAt(date, gf15TrustedNow(now));
}

export function assertGf15FreshWindowV1(binding, now) {
  assertGf15Binding(binding);
  const instant = gf15TrustedNow(now);
  assertGf15FutureDateAt(binding.desiredDate, instant);
  const start = Date.parse(binding.planningWindowStart);
  const end = Date.parse(binding.planningWindowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= instant.getTime() || end <= start) {
    gf15Fail('GF15_WINDOW_NOT_FUTURE');
  }
  return instant;
}

/** Pure packet compiler; creates no authorization, execution route or persistent facts. */
export function bindGf15WindowV1({ desiredDate, start, end }) {
  const requestCommand = { schemaVersion: 2, ...GF15_REQUEST.commandContract.fixedFields, desiredDate };
  if (!validateV2Submission(requestCommand).ok) gf15Fail('GF15_REQUEST_INVALID');
  const normalized = normalizeSchedulingConfigV1({ schemaVersion: 1,
    businessTimeZone: GF15_CONFIG.businessTimeZone,
    resourceCalendars: [{ ...GF15_CONFIG.resourceCalendarStatic,
      dateOverrides: [{ date: desiredDate, status: 'custom', windows: [{ start, end }] }] }],
    durationFallbackRules: GF15_CONFIG.durationFallbackRules, bufferRules: GF15_CONFIG.bufferRules,
    softScoringWeights: GF15_CONFIG.softScoringWeights,
    compatibleAlgorithmVersions: GF15_CONFIG.compatibleAlgorithmVersions });
  if (!normalized.ok) gf15Fail('GF15_CONFIG_INVALID');
  const compiled = compileSchedulingCalendarDateV1({ configJson: normalized.config,
    resourceId: GF15_IDS.resource, date: desiredDate,
    calendarCompilerVersion: GF15_CONFIG.calendarCompilerVersion,
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION });
  if (!compiled.ok || compiled.windows.length !== 1) gf15Fail('GF15_WINDOW_INVALID');
  const window = compiled.windows[0];
  if (Date.parse(window.end) - Date.parse(window.start) < 1_200_000) gf15Fail('GF15_WINDOW_CAPACITY');
  return { desiredDate, start, end, requestCommand,
    requestDigest: digestCanonicalJsonSchedulingV1(requestCommand), config: normalized.config,
    configDigest: normalized.configDigest, planningWindowStart: window.start, planningWindowEnd: window.end };
}

export function assertGf15Binding(binding) {
  if (!binding || !gf15Equal(binding, bindGf15WindowV1(binding))) gf15Fail('GF15_BINDING_MISMATCH');
}

export function preflightGf15V1(binding, { scheduleRevision, sourceOrdinal }) {
  assertGf15Binding(binding);
  const input = { schemaVersion: 1, planningWindowStart: binding.planningWindowStart,
    planningWindowEnd: binding.planningWindowEnd, businessTimeZone: 'Asia/Shanghai',
    baseScheduleRevision: scheduleRevision, algorithmVersion: GF15_CONFIG.algorithmVersion,
    calendarCompilerVersion: GF15_CONFIG.calendarCompilerVersion,
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    estimatePolicyVersion: GF15_CONFIG.estimatePolicyVersion, configVersion: GF15_IDS.config,
    configDigest: binding.configDigest,
    resources: [{ ...GF15_RESOURCE, businessWindows: [{ start: binding.planningWindowStart, end: binding.planningWindowEnd }] }],
    candidates: [{ requestId: GF15_IDS.request, sourceOrdinal, requestLifecycle: 'open',
      lifecycleProvenance: 'domainCommand', nonCancelledScheduleItemIds: [],
      productionType: '平面', shootingSubtype: '细节', desiredDate: binding.desiredDate,
      sampleStatus: 'arrivedVerified', lightingPreset: 'GF15-ACCEPT-NEUTRAL', reflectivity: 'low', priority: 'p0',
      requiredCapabilityIds: ['FLAT'], durationEstimate: { durationMs: 900000, source: 'explicit', sourceVersion: 'prod-gf15-r1' },
      factProvenance: Object.fromEntries(['productionType', 'shootingSubtype', 'desiredDate', 'sampleStatus',
        'lightingPreset', 'reflectivity', 'priority', 'requiredCapabilityIds', 'durationEstimate']
        .map(key => [key, 'domain-command-v1'])) }], occupied: [], activeRuns: [], durationStats: [] };
  const result = generateDeterministicScheduleV1(input, binding.config);
  if (!result.ok) gf15Fail('GF15_PREFLIGHT_FAILED');
  assertGf15OneItem(binding, result.result.proposedItems);
  return result;
}

export function assertGf15OneItem(binding, items) {
  if (items.length !== 1 || items[0].requestId !== GF15_IDS.request || items[0].resourceId !== GF15_IDS.resource
    || items[0].configVersion !== GF15_IDS.config || items[0].bufferAfterMinutes !== 5
    || Date.parse(items[0].plannedStart) < Date.parse(binding.planningWindowStart)
    || Date.parse(items[0].plannedEnd) - Date.parse(items[0].plannedStart) !== 900000
    || Date.parse(items[0].plannedEnd) + 300000 > Date.parse(binding.planningWindowEnd)) gf15Fail('GF15_ITEM_ISOLATION_FAILED');
}
