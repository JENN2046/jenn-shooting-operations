import {
  buildSchedulingDiagnosticV1,
  canonicalizeSchedulingResultV1,
  normalizeSchedulingInputV1,
} from './scheduling-contract-v1.mjs';
import {
  compileSchedulingCalendarDateV1,
  normalizeSchedulingConfigV1,
} from './scheduling-admin-contract-v1.mjs';

export const DETERMINISTIC_SCHEDULER_VERSION_V1 = 'deterministic-scheduler-v1';

const PRIORITY = Object.freeze({ p0: 0, p1: 1, p2: 2 });
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_PLANNING_CALENDAR_DAYS = 366;

function codePointCompare(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function failure(reason) {
  return Object.freeze({ ok: false, code: 'SCHEDULING_ENGINE_INVALID', reason });
}

function diagnostic(code, candidate, resourceId = null, scheduleItemId = null, fieldPath = null) {
  const admitted = buildSchedulingDiagnosticV1({
    code, requestId: candidate?.requestId ?? null, resourceId, scheduleItemId, fieldPath,
  });
  if (!admitted.ok) throw new Error('SCHEDULING_DIAGNOSTIC_CONTRACT_MISMATCH');
  return admitted.diagnostic;
}

function matchingRule(rules, candidate) {
  return rules.find(rule => (rule.productionType === null || rule.productionType === candidate.productionType)
    && (rule.shootingSubtype === null || rule.shootingSubtype === candidate.shootingSubtype)) ?? null;
}

function resolveDuration(candidate, resource, config, stats) {
  if (candidate.durationEstimate) {
    return {
      durationMs: candidate.durationEstimate.durationMs,
      durationSource: candidate.durationEstimate.source,
      durationSourceVersion: candidate.durationEstimate.sourceVersion,
    };
  }
  if (candidate.productionType === null || candidate.shootingSubtype === null) return null;
  const matches = stats.filter(stat => (
    (stat.resourceId === null || stat.resourceId === resource.resourceId)
    && (stat.productionType === null || stat.productionType === candidate.productionType)
    && (stat.shootingSubtype === null || stat.shootingSubtype === candidate.shootingSubtype)
    && (stat.lightingPreset === null || stat.lightingPreset === candidate.lightingPreset)
    && (stat.reflectivity === null || stat.reflectivity === candidate.reflectivity)
  )).toSorted((left, right) => {
    const specificity = stat => [stat.resourceId, stat.productionType, stat.shootingSubtype,
      stat.lightingPreset, stat.reflectivity].filter(value => value !== null).length;
    return specificity(right) - specificity(left)
      || right.sampleCount - left.sampleCount
      || codePointCompare(left.statId, right.statId);
  });
  if (matches.length) {
    return {
      durationMs: matches[0].estimateDurationMs,
      durationSource: 'retrospective',
      durationSourceVersion: matches[0].metricVersion,
    };
  }
  const fallback = matchingRule(config.durationFallbackRules, candidate);
  return fallback ? {
    durationMs: fallback.durationMs,
    durationSource: 'fallback',
    durationSourceVersion: fallback.ruleId,
  } : null;
}

function expectedOverrun(candidate, resource, stats, durationMs) {
  return stats.some(stat => stat.estimateDurationMs > durationMs
    && (stat.resourceId === null || stat.resourceId === resource.resourceId)
    && (stat.productionType === null || stat.productionType === candidate.productionType)
    && (stat.shootingSubtype === null || stat.shootingSubtype === candidate.shootingSubtype)
    && (stat.lightingPreset === null || stat.lightingPreset === candidate.lightingPreset)
    && (stat.reflectivity === null || stat.reflectivity === candidate.reflectivity));
}

function firstSlot(window, busy, durationMs, bufferMs, planningStart, planningEnd) {
  let start = Math.max(Date.parse(window.start), planningStart);
  const limit = Math.min(Date.parse(window.end), planningEnd);
  for (const interval of busy) {
    if (interval.end <= start) continue;
    if (interval.start >= start + durationMs + bufferMs) break;
    start = Math.max(start, interval.end);
  }
  return Number.isSafeInteger(start + durationMs + bufferMs)
    && start + durationMs + bufferMs <= limit ? start : null;
}

function localDate(formatter, instant) {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sameV1Date(formatter, start, end) {
  return localDate(formatter, start) === localDate(formatter, end);
}

function planningCalendarDates(formatter, planningStart, planningEnd) {
  const first = Date.parse(`${localDate(formatter, planningStart)}T00:00:00.000Z`);
  const last = Date.parse(`${localDate(formatter, planningEnd - 1)}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first
    || Math.floor((last - first) / DAY_MS) + 1 > MAX_PLANNING_CALENDAR_DAYS) return null;
  const dates = [];
  for (let day = first; day <= last; day += DAY_MS) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

function sortCandidates(left, right) {
  const desiredDateOrder = left.desiredDate === null
    ? (right.desiredDate === null ? 0 : 1)
    : (right.desiredDate === null ? -1 : codePointCompare(left.desiredDate, right.desiredDate));
  return (PRIORITY[left.priority] ?? 3) - (PRIORITY[right.priority] ?? 3)
    || desiredDateOrder
    || left.sourceOrdinal - right.sourceOrdinal
    || codePointCompare(left.requestId, right.requestId);
}

function softPenalty(candidate, resource, slot, selected, config, formatter, durationMs, stats) {
  let penalty = 0;
  const reasons = [];
  const weights = config.softScoringWeights;
  if (candidate.desiredDate !== null && candidate.desiredDate !== localDate(formatter, slot)) {
    penalty += weights.DESIRED_DATE_MISS;
    reasons.push('DESIRED_DATE_MISS');
  }
  const prior = selected.filter(item => item.resourceId === resource.resourceId
    && item.end <= slot).toSorted((left, right) => right.end - left.end)[0];
  if (prior) {
    if (prior.lightingPreset !== null && candidate.lightingPreset !== null
      && prior.lightingPreset !== candidate.lightingPreset) {
      penalty += weights.LIGHTING_SWITCH;
      reasons.push('LIGHTING_SWITCH');
    }
    if (prior.reflectivity !== null && candidate.reflectivity !== null
      && prior.reflectivity !== candidate.reflectivity) {
      penalty += weights.REFLECTIVITY_SEQUENCE;
      reasons.push('REFLECTIVITY_SEQUENCE');
    }
    if (slot > prior.end) {
      penalty += weights.IDLE_GAP * Math.ceil((slot - prior.end) / MINUTE_MS);
      reasons.push('IDLE_GAP');
    }
  }
  if (expectedOverrun(candidate, resource, stats, durationMs)) {
    penalty += weights.EXPECTED_OVERRUN;
    reasons.push('EXPECTED_OVERRUN');
  }
  return { penalty, reasons };
}

/** Pure, proposal-only scheduler. Callers must provide the complete frozen input and active config. */
export function generateDeterministicScheduleV1(inputValue, configValue) {
  const admittedInput = normalizeSchedulingInputV1(inputValue);
  if (!admittedInput.ok) return failure(admittedInput.reason);
  const admittedConfig = normalizeSchedulingConfigV1(configValue);
  if (!admittedConfig.ok) return failure(admittedConfig.reason);
  const { input, inputDigest } = admittedInput;
  const { config, configDigest } = admittedConfig;
  if (input.algorithmVersion !== DETERMINISTIC_SCHEDULER_VERSION_V1
    || !config.compatibleAlgorithmVersions.includes(input.algorithmVersion)) {
    return failure('ALGORITHM_VERSION_MISMATCH');
  }
  if (input.configDigest !== configDigest || input.businessTimeZone !== config.businessTimeZone) {
    return failure('CONFIG_MISMATCH');
  }
  const calendars = new Map(config.resourceCalendars.map(calendar => [calendar.resourceId, calendar]));
  if (input.resources.some(resource => calendars.get(resource.resourceId)?.capabilityDigest
    !== resource.capabilityDigest)) return failure('RESOURCE_CONFIG_MISMATCH');

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: input.businessTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const planningStart = Date.parse(input.planningWindowStart);
  const planningEnd = Date.parse(input.planningWindowEnd);
  const dates = planningCalendarDates(formatter, planningStart, planningEnd);
  if (dates === null) return failure('PLANNING_CALENDAR_RANGE_UNSUPPORTED');
  for (const resource of input.resources) {
    const expectedWindows = [];
    for (const date of dates) {
      const compiled = compileSchedulingCalendarDateV1({
        configJson: config, resourceId: resource.resourceId, date,
        calendarCompilerVersion: input.calendarCompilerVersion,
        timeZoneDataVersion: input.timeZoneDataVersion,
      });
      if (!compiled.ok) return failure('BUSINESS_WINDOW_CONFIG_MISMATCH');
      for (const window of compiled.windows) {
        const start = Math.max(Date.parse(window.start), planningStart);
        const end = Math.min(Date.parse(window.end), planningEnd);
        if (start < end) expectedWindows.push({
          start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        });
      }
    }
    expectedWindows.sort((left, right) => codePointCompare(left.start, right.start)
      || codePointCompare(left.end, right.end));
    if (resource.businessWindows.length !== expectedWindows.length
      || resource.businessWindows.some((window, index) => window.start !== expectedWindows[index].start
        || window.end !== expectedWindows[index].end)) {
      return failure('BUSINESS_WINDOW_CONFIG_MISMATCH');
    }
  }
  const globalUnknown = input.occupied.some(item => item.resourceResolutionStatus === 'unresolved');
  const resourceUnknown = new Set(input.occupied.filter(item => item.bufferAfterMinutes === null)
    .map(item => item.resourceId).filter(Boolean));
  const busy = new Map(input.resources.map(resource => [resource.resourceId, []]));
  for (const item of input.occupied) {
    if (item.resourceId === null || item.bufferAfterMinutes === null) continue;
    const end = Date.parse(item.plannedEnd) + item.bufferAfterMinutes * MINUTE_MS;
    busy.get(item.resourceId)?.push({
      start: Date.parse(item.plannedStart), end,
      locked: item.lockStatus === 'locked', scheduleItemId: item.scheduleItemId,
    });
  }
  for (const intervals of busy.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const proposedItems = [];
  const diagnostics = [];
  const selected = [];
  for (const candidate of input.candidates.toSorted(sortCandidates)) {
    if (candidate.sampleStatus !== 'arrivedVerified') {
      diagnostics.push(diagnostic('SAMPLE_NOT_VERIFIED', candidate, null, null, '$.candidates[].sampleStatus'));
      continue;
    }
    if (candidate.priority === null) {
      diagnostics.push(diagnostic('PRIORITY_UNKNOWN', candidate, null, null, '$.candidates[].priority'));
      continue;
    }
    if (globalUnknown) {
      diagnostics.push(diagnostic('UNRESOLVED_LEGACY_BLOCK', candidate, null, null, '$.occupied[]'));
      continue;
    }
    const eligible = input.resources.filter(resource => resource.status === 'active'
      && candidate.requiredCapabilityIds !== null
      && candidate.requiredCapabilityIds.every(id => resource.capabilityJson.capabilityIds.includes(id)));
    if (eligible.length === 0) {
      const code = input.resources.length === 0 ? 'RESOURCE_UNKNOWN'
        : input.resources.every(resource => resource.status === 'inactive') ? 'RESOURCE_INACTIVE'
          : 'RESOURCE_CAPABILITY_MISMATCH';
      diagnostics.push(diagnostic(code, candidate, null, null, '$.resources[]'));
      continue;
    }
    const options = [];
    let noDuration = true;
    let noBufferRule = false;
    let crossedV1Date = false;
    let calendarHadCapacity = false;
    let unknownBufferResources = 0;
    let lockedConflict = null;
    for (const resource of eligible) {
      if (resourceUnknown.has(resource.resourceId)) {
        unknownBufferResources += 1;
        diagnostics.push(diagnostic('LEGACY_BUFFER_UNKNOWN', candidate, resource.resourceId, null,
          '$.occupied[].bufferAfterMinutes'));
        continue;
      }
      const duration = resolveDuration(candidate, resource, config, input.durationStats);
      if (!duration) continue;
      noDuration = false;
      const bufferRule = matchingRule(config.bufferRules, candidate);
      if (!bufferRule) { noBufferRule = true; continue; }
      const bufferMs = bufferRule.bufferAfterMinutes * MINUTE_MS;
      for (const window of resource.businessWindows) {
        if (Date.parse(window.end) - Date.parse(window.start) >= duration.durationMs + bufferMs) {
          calendarHadCapacity = true;
        }
        const slot = firstSlot(window, busy.get(resource.resourceId), duration.durationMs, bufferMs,
          planningStart, planningEnd);
        if (slot === null) {
          const unlockedSlot = firstSlot(window,
            busy.get(resource.resourceId).filter(interval => !interval.locked),
            duration.durationMs, bufferMs, planningStart, planningEnd);
          if (unlockedSlot !== null && lockedConflict === null) {
            const locked = busy.get(resource.resourceId).find(interval => interval.locked
              && interval.start < unlockedSlot + duration.durationMs + bufferMs
              && interval.end > unlockedSlot);
            if (locked) lockedConflict = { resource, interval: locked };
          }
          continue;
        }
        const end = slot + duration.durationMs;
        if (!sameV1Date(formatter, slot, end)) { crossedV1Date = true; continue; }
        const soft = softPenalty(candidate, resource, slot, selected, config, formatter,
          duration.durationMs, input.durationStats);
        options.push({ resource, slot, end, bufferMs, bufferRule, duration, ...soft });
      }
    }
    if (noBufferRule) return failure('BUFFER_RULE_MISSING');
    if (options.length === 0) {
      if (unknownBufferResources === eligible.length) continue;
      if (lockedConflict && calendarHadCapacity) {
        diagnostics.push(diagnostic('LOCKED_INTERVAL_CONFLICT', candidate,
          lockedConflict.resource.resourceId, lockedConflict.interval.scheduleItemId, '$.occupied[]'));
      }
      diagnostics.push(diagnostic(noDuration ? 'DURATION_UNKNOWN'
        : crossedV1Date ? 'V1_DATE_BOUNDARY'
          : calendarHadCapacity ? 'RESOURCE_OVERLAP' : 'OUTSIDE_BUSINESS_CALENDAR', candidate,
      null, null, noDuration ? '$.candidates[].durationEstimate' : '$.resources[].businessWindows'));
      continue;
    }
    options.sort((left, right) => left.slot - right.slot || left.penalty - right.penalty
      || codePointCompare(left.resource.resourceId, right.resource.resourceId));
    const choice = options[0];
    proposedItems.push({
      requestId: candidate.requestId,
      resourceId: choice.resource.resourceId,
      plannedStart: new Date(choice.slot).toISOString(),
      plannedEnd: new Date(choice.end).toISOString(),
      durationMs: choice.duration.durationMs,
      bufferAfterMinutes: choice.bufferRule.bufferAfterMinutes,
      durationSource: choice.duration.durationSource,
      durationSourceVersion: choice.duration.durationSourceVersion,
      bufferRuleId: choice.bufferRule.ruleId,
      configVersion: input.configVersion,
    });
    busy.get(choice.resource.resourceId).push({ start: choice.slot, end: choice.end + choice.bufferMs });
    busy.get(choice.resource.resourceId).sort((a, b) => a.start - b.start || a.end - b.end);
    selected.push({ resourceId: choice.resource.resourceId, end: choice.end + choice.bufferMs,
      lightingPreset: candidate.lightingPreset, reflectivity: candidate.reflectivity });
    for (const code of choice.reasons) diagnostics.push(diagnostic(code, candidate, choice.resource.resourceId,
      null, code === 'DESIRED_DATE_MISS' ? '$.candidates[].desiredDate' : '$.occupied[]'));
  }
  const result = canonicalizeSchedulingResultV1({
    algorithmVersion: input.algorithmVersion,
    configVersion: input.configVersion,
    configDigest: input.configDigest,
    calendarCompilerVersion: input.calendarCompilerVersion,
    timeZoneDataVersion: input.timeZoneDataVersion,
    estimatePolicyVersion: input.estimatePolicyVersion,
    proposedItems,
    diagnostics,
  });
  if (!result.ok) return failure(result.reason);
  return Object.freeze({ ...result, inputDigest });
}
