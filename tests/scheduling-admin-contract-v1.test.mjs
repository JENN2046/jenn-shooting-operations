import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
  SCHEDULING_TIME_ZONE_DATA_VERSION,
  compileSchedulingCalendarDateV1,
  digestSchedulingConfigV1,
  normalizeActivateSchedulingConfigV1,
  normalizePublishSchedulingConfigV1,
  normalizeRegisterSchedulingResourceV1,
  normalizeReplaceSchedulingResourceV1,
  normalizeSchedulingConfigV1,
} from '../src/scheduling-admin-contract-v1.mjs';
import {
  digestCanonicalJsonSchedulingV1,
  digestResourceCapabilitiesV1,
} from '../src/scheduling-contract-v1.mjs';

function capabilities(ids = ['VIDEO', 'FLAT']) {
  const capabilityJson = { schemaVersion: 1, capabilityIds: ids };
  return {
    capabilityJson,
    capabilityDigest: digestResourceCapabilitiesV1(capabilityJson),
  };
}

function resource(overrides = {}) {
  return {
    resourceId: 'STUDIO-A',
    v1DisplayPlace: 'Studio A',
    status: 'active',
    ...capabilities(),
    ...overrides,
  };
}

function resourceCommand(overrides = {}) {
  return {
    operationId: 'op-resource-001',
    expectedScheduleRevision: 7,
    expectedProjectionRevision: 11,
    resource: resource(),
    ...overrides,
  };
}

function weights(overrides = {}) {
  return {
    LIGHTING_SWITCH: 10,
    REFLECTIVITY_SEQUENCE: 20,
    IDLE_GAP: 30,
    EXPECTED_OVERRUN: 40,
    DESIRED_DATE_MISS: 50,
    ...overrides,
  };
}

function config(overrides = {}) {
  const studioACapabilities = capabilities(['VIDEO', 'FLAT']);
  const studioBCapabilities = capabilities(['VIDEO']);
  return {
    schemaVersion: 1,
    businessTimeZone: 'America/New_York',
    resourceCalendars: [
      {
        resourceId: 'STUDIO-B',
        capabilityDigest: studioBCapabilities.capabilityDigest,
        weeklyWindows: [],
        dateOverrides: [],
      },
      {
        resourceId: 'STUDIO-A',
        capabilityDigest: studioACapabilities.capabilityDigest,
        weeklyWindows: [
          { weekday: 2, start: '13:00', end: '17:00' },
          { weekday: 1, start: '13:00', end: '17:00' },
          { weekday: 1, start: '09:00', end: '12:00' },
        ],
        dateOverrides: [
          { date: '2026-09-23', status: 'closed', windows: [] },
          {
            date: '2026-09-22',
            status: 'custom',
            windows: [
              { start: '14:00', end: '16:00' },
              { start: '10:00', end: '12:00' },
            ],
          },
        ],
      },
    ],
    durationFallbackRules: [
      { ruleId: 'duration-global', productionType: null, shootingSubtype: null, durationMs: 2_700_000 },
      { ruleId: 'duration-video', productionType: '视频', shootingSubtype: null, durationMs: 3_600_000 },
      { ruleId: 'duration-video-scene', productionType: '视频', shootingSubtype: '场景视频', durationMs: 4_500_000 },
    ],
    bufferRules: [
      { ruleId: 'buffer-global', productionType: null, shootingSubtype: null, bufferAfterMinutes: 10 },
      { ruleId: 'buffer-flat', productionType: '平面', shootingSubtype: null, bufferAfterMinutes: 15 },
      { ruleId: 'buffer-flat-detail', productionType: '平面', shootingSubtype: '细节', bufferAfterMinutes: 20 },
    ],
    softScoringWeights: weights(),
    compatibleAlgorithmVersions: ['scheduler-v2', 'scheduler-v1'],
    ...overrides,
  };
}

function publishCommand(overrides = {}) {
  const configJson = config();
  return {
    operationId: 'op-config-001',
    configVersion: 'fixture-config-v1',
    algorithmVersion: 'scheduler-v1',
    calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
    estimatePolicyVersion: 'estimate-policy-v1',
    configJson,
    configDigest: digestSchedulingConfigV1(configJson),
    ...overrides,
  };
}

function calendarCompileInput(overrides = {}) {
  return {
    configJson: config(),
    resourceId: 'STUDIO-A',
    date: '2026-09-22',
    calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
    timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION,
    ...overrides,
  };
}

test('resource register/replace normalize full state and keep actor outside the body', () => {
  const register = normalizeRegisterSchedulingResourceV1(resourceCommand({
    expectedScheduleRevision: -0,
    expectedProjectionRevision: -0,
  }));
  assert.equal(register.ok, true, JSON.stringify(register));
  assert.equal(register.command.expectedScheduleRevision, 0);
  assert.equal(register.command.expectedProjectionRevision, 0);
  assert.deepEqual(register.command.resource.capabilityJson.capabilityIds, ['FLAT', 'VIDEO']);
  assert.equal(Object.isFrozen(register.command.resource.capabilityJson.capabilityIds), true);

  const replace = normalizeReplaceSchedulingResourceV1(resourceCommand());
  assert.equal(replace.ok, true, JSON.stringify(replace));
  assert.notEqual(register.commandType, replace.commandType);
  assert.notEqual(register.commandDigest, replace.commandDigest);

  const withActor = resourceCommand();
  withActor.actor = { subjectId: 'admin-1' };
  assert.deepEqual(normalizeRegisterSchedulingResourceV1(withActor), {
    ok: false,
    code: 'REGISTER_SCHEDULING_RESOURCE_INVALID',
    reason: 'EXACT_KEYS',
    path: '$',
  });
});

test('resource command digest excludes operationId but covers optimistic revisions and full resource state', () => {
  const first = normalizeRegisterSchedulingResourceV1(resourceCommand());
  const replayIdentity = normalizeRegisterSchedulingResourceV1(resourceCommand({ operationId: 'op-resource-999' }));
  assert.equal(first.ok, true);
  assert.equal(replayIdentity.ok, true);
  assert.equal(first.commandDigest, replayIdentity.commandDigest);

  for (const changed of [
    resourceCommand({ expectedScheduleRevision: 8 }),
    resourceCommand({ expectedProjectionRevision: 12 }),
    resourceCommand({ resource: resource({ v1DisplayPlace: 'Studio Alpha' }) }),
    resourceCommand({ resource: resource({ status: 'inactive' }) }),
  ]) {
    const normalized = normalizeRegisterSchedulingResourceV1(changed);
    assert.equal(normalized.ok, true, JSON.stringify(normalized));
    assert.notEqual(normalized.commandDigest, first.commandDigest);
  }
});

test('resource identity uses Unicode code-point limits and verifies capability digest', () => {
  const astral160 = '𐀀'.repeat(160);
  assert.equal(normalizeRegisterSchedulingResourceV1(resourceCommand({
    resource: resource({ resourceId: astral160 }),
  })).ok, true);
  assert.equal(normalizeRegisterSchedulingResourceV1(resourceCommand({
    resource: resource({ resourceId: `${astral160}a` }),
  })).reason, 'IDENTIFIER_INVALID');

  const mismatch = resource();
  mismatch.capabilityDigest = `sha256:${'0'.repeat(64)}`;
  const rejected = normalizeRegisterSchedulingResourceV1(resourceCommand({ resource: mismatch }));
  assert.equal(rejected.reason, 'CAPABILITY_DIGEST_MISMATCH');
  assert.equal(rejected.path, '$.resource.capabilityDigest');
});

test('config normalization fixes semantic order, precedence, -0 and canonical golden digest', () => {
  const source = config({ softScoringWeights: weights({ IDLE_GAP: -0 }) });
  const result = normalizeSchedulingConfigV1(source);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.config.resourceCalendars.map(item => item.resourceId), ['STUDIO-A', 'STUDIO-B']);
  assert.deepEqual(
    result.config.resourceCalendars[0].weeklyWindows.map(item => `${item.weekday}:${item.start}-${item.end}`),
    ['1:09:00-12:00', '1:13:00-17:00', '2:13:00-17:00'],
  );
  assert.deepEqual(
    result.config.durationFallbackRules.map(item => item.ruleId),
    ['duration-video-scene', 'duration-video', 'duration-global'],
  );
  assert.deepEqual(
    result.config.bufferRules.map(item => item.ruleId),
    ['buffer-flat-detail', 'buffer-flat', 'buffer-global'],
  );
  assert.deepEqual(result.config.compatibleAlgorithmVersions, ['scheduler-v1', 'scheduler-v2']);
  assert.equal(Object.is(result.config.softScoringWeights.IDLE_GAP, -0), false);
  assert.match(result.configDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    result.configDigest,
    'sha256:c0c0e53529eb9494717dfec330063ce2c096eb8fd4686077d4bb3f10743fb003',
  );
  assert.equal(result.configDigest, normalizeSchedulingConfigV1(config({
    softScoringWeights: weights({ IDLE_GAP: 0 }),
  })).configDigest);
});

test('config digest is invariant to all documented input-array permutations', () => {
  const first = normalizeSchedulingConfigV1(config());
  const permuted = config();
  permuted.resourceCalendars.reverse();
  permuted.resourceCalendars.forEach(calendar => {
    calendar.weeklyWindows.reverse();
    calendar.dateOverrides.reverse();
    calendar.dateOverrides.forEach(override => override.windows.reverse());
  });
  permuted.durationFallbackRules.reverse();
  permuted.bufferRules.reverse();
  permuted.compatibleAlgorithmVersions.reverse();
  const second = normalizeSchedulingConfigV1(permuted);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.configJson, first.configJson);
  assert.equal(second.configDigest, first.configDigest);
});

test('calendar rules reject cross-day, overlap, duplicate dates and invalid override shapes', () => {
  const cases = [];
  const crossDay = config();
  crossDay.resourceCalendars[1].weeklyWindows = [{ weekday: 1, start: '18:00', end: '09:00' }];
  cases.push([crossDay, 'LOCAL_INTERVAL_INVALID']);
  const overlap = config();
  overlap.resourceCalendars[1].weeklyWindows = [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 1, start: '11:59', end: '13:00' },
  ];
  cases.push([overlap, 'LOCAL_WINDOW_OVERLAP']);
  const duplicateDate = config();
  duplicateDate.resourceCalendars[1].dateOverrides.push({
    date: '2026-09-22', status: 'closed', windows: [],
  });
  cases.push([duplicateDate, 'DUPLICATE_DATE_OVERRIDE']);
  const closedWithWindow = config();
  closedWithWindow.resourceCalendars[1].dateOverrides[0] = {
    date: '2026-09-23', status: 'closed', windows: [{ start: '09:00', end: '10:00' }],
  };
  cases.push([closedWithWindow, 'DATE_OVERRIDE_STATUS_INVALID']);
  const emptyCustom = config();
  emptyCustom.resourceCalendars[1].dateOverrides[1] = {
    date: '2026-09-22', status: 'custom', windows: [],
  };
  cases.push([emptyCustom, 'DATE_OVERRIDE_STATUS_INVALID']);

  for (const [input, reason] of cases) {
    const result = normalizeSchedulingConfigV1(input);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason, JSON.stringify(result));
  }
});

test('fallback and buffer selector matrices reject duplicates and cross-type subtypes', () => {
  const duplicate = config();
  duplicate.durationFallbackRules.push({
    ruleId: 'another-video', productionType: '视频', shootingSubtype: null, durationMs: 1,
  });
  assert.equal(normalizeSchedulingConfigV1(duplicate).reason, 'DUPLICATE_RULE_SELECTOR');

  const crossType = config();
  crossType.bufferRules[0] = {
    ruleId: 'bad-cross-type', productionType: '平面', shootingSubtype: '剧情短片', bufferAfterMinutes: 1,
  };
  assert.equal(normalizeSchedulingConfigV1(crossType).reason, 'SELECTOR_INVALID');

  const subtypeWithoutType = config();
  subtypeWithoutType.bufferRules[0] = {
    ruleId: 'bad-no-type', productionType: null, shootingSubtype: '细节', bufferAfterMinutes: 1,
  };
  assert.equal(normalizeSchedulingConfigV1(subtypeWithoutType).reason, 'SELECTOR_INVALID');
});

test('config exact keys, fixed soft weights and non-empty unique compatible versions fail closed', () => {
  const extra = config();
  extra.defaultBufferMinutes = 10;
  assert.equal(normalizeSchedulingConfigV1(extra).reason, 'EXACT_KEYS');
  const missingWeight = config();
  delete missingWeight.softScoringWeights.IDLE_GAP;
  assert.equal(normalizeSchedulingConfigV1(missingWeight).reason, 'EXACT_KEYS');
  const floatingWeight = config({ softScoringWeights: weights({ IDLE_GAP: 1.5 }) });
  assert.equal(normalizeSchedulingConfigV1(floatingWeight).reason, 'SAFE_INTEGER_INVALID');
  const emptyVersions = config({ compatibleAlgorithmVersions: [] });
  assert.equal(normalizeSchedulingConfigV1(emptyVersions).reason, 'ARRAY_TOO_SHORT');
  const duplicateVersions = config({ compatibleAlgorithmVersions: ['scheduler-v1', 'scheduler-v1'] });
  assert.equal(normalizeSchedulingConfigV1(duplicateVersions).reason, 'DUPLICATE_IDENTIFIER');
});

test('config admission rejects unsafe objects, accessors, symbols and sparse arrays', () => {
  const nullPrototype = Object.assign(Object.create(null), config());
  assert.equal(normalizeSchedulingConfigV1(nullPrototype).reason, 'EXACT_KEYS');

  const accessor = config();
  Object.defineProperty(accessor, 'businessTimeZone', { enumerable: true, get: () => 'UTC' });
  assert.equal(normalizeSchedulingConfigV1(accessor).reason, 'EXACT_KEYS');

  const symbol = config();
  symbol[Symbol('hidden')] = true;
  assert.equal(normalizeSchedulingConfigV1(symbol).reason, 'EXACT_KEYS');

  const sparse = config();
  sparse.bufferRules = [sparse.bufferRules[0], , sparse.bufferRules[2]];
  assert.equal(normalizeSchedulingConfigV1(sparse).reason, 'ARRAY_INVALID');

  const unsafeNested = config();
  Object.defineProperty(unsafeNested.softScoringWeights, '__proto__', { value: 1, enumerable: true });
  assert.equal(normalizeSchedulingConfigV1(unsafeNested).reason, 'EXACT_KEYS');

  const hostileProxy = new Proxy(config(), {
    ownKeys() {
      throw new Error('hostile proxy');
    },
  });
  const proxyResult = normalizeSchedulingConfigV1(hostileProxy);
  assert.equal(proxyResult.ok, false);
  assert.equal(proxyResult.code, 'SCHEDULING_CONFIG_INVALID');
});

test('publish and activate commands are exact, actor-free and domain-separated', () => {
  const publish = normalizePublishSchedulingConfigV1(publishCommand());
  assert.equal(publish.ok, true, JSON.stringify(publish));
  assert.match(publish.commandDigest, /^sha256:[a-f0-9]{64}$/u);
  const changedOperation = normalizePublishSchedulingConfigV1(publishCommand({ operationId: 'op-config-999' }));
  assert.equal(changedOperation.ok, true);
  assert.equal(changedOperation.commandDigest, publish.commandDigest);

  const incompatible = publishCommand({ algorithmVersion: 'scheduler-v3' });
  assert.equal(normalizePublishSchedulingConfigV1(incompatible).reason, 'ALGORITHM_NOT_COMPATIBLE');
  const unsupportedCompiler = publishCommand({ calendarCompilerVersion: 'calendar-compiler-v2' });
  assert.equal(
    normalizePublishSchedulingConfigV1(unsupportedCompiler).reason,
    'CALENDAR_COMPILER_VERSION_UNSUPPORTED',
  );
  const mismatch = publishCommand({ configDigest: `sha256:${'f'.repeat(64)}` });
  assert.equal(normalizePublishSchedulingConfigV1(mismatch).reason, 'CONFIG_DIGEST_MISMATCH');
  const withActor = publishCommand();
  withActor.publishedBy = 'admin-1';
  assert.equal(normalizePublishSchedulingConfigV1(withActor).reason, 'EXACT_KEYS');

  const activate = normalizeActivateSchedulingConfigV1({
    operationId: 'op-activate-001', configVersion: 'fixture-config-v1', expectedProjectionRevision: -0,
  });
  assert.equal(activate.ok, true, JSON.stringify(activate));
  assert.equal(activate.command.expectedProjectionRevision, 0);
  assert.match(activate.commandDigest, /^sha256:[a-f0-9]{64}$/u);
});

test('date overrides replace weekly windows and compile local windows to explicit UTC intervals', () => {
  const custom = compileSchedulingCalendarDateV1(calendarCompileInput());
  assert.equal(custom.ok, true, JSON.stringify(custom));
  assert.equal(custom.source, 'dateOverride:custom');
  assert.equal(custom.calendarCompilerVersion, SCHEDULING_CALENDAR_COMPILER_VERSION_V1);
  assert.equal(custom.timeZoneDataVersion, SCHEDULING_TIME_ZONE_DATA_VERSION);
  assert.match(custom.resultDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(custom.windows, [
    { start: '2026-09-22T14:00:00.000Z', end: '2026-09-22T16:00:00.000Z' },
    { start: '2026-09-22T18:00:00.000Z', end: '2026-09-22T20:00:00.000Z' },
  ]);

  const closed = compileSchedulingCalendarDateV1(calendarCompileInput({ date: '2026-09-23' }));
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.source, 'dateOverride:closed');
  assert.deepEqual(closed.windows, []);

  const weekly = compileSchedulingCalendarDateV1(calendarCompileInput({ date: '2026-09-21' }));
  assert.equal(weekly.ok, true, JSON.stringify(weekly));
  assert.equal(weekly.source, 'weekly');
  assert.deepEqual(weekly.windows, [
    { start: '2026-09-21T13:00:00.000Z', end: '2026-09-21T16:00:00.000Z' },
    { start: '2026-09-21T17:00:00.000Z', end: '2026-09-21T21:00:00.000Z' },
  ]);

  assert.equal(custom.resultDigest, digestCanonicalJsonSchedulingV1({
    domain: 'scheduling-calendar-compile-result-v1',
    result: {
      resourceId: custom.resourceId,
      date: custom.date,
      source: custom.source,
      calendarCompilerVersion: custom.calendarCompilerVersion,
      timeZoneDataVersion: custom.timeZoneDataVersion,
      windows: custom.windows,
    },
  }));

  const changedCompiler = compileSchedulingCalendarDateV1(calendarCompileInput({
    calendarCompilerVersion: 'calendar-compiler-v2',
  }));
  const changedTzdata = compileSchedulingCalendarDateV1(calendarCompileInput({
    timeZoneDataVersion: 'unapproved-tzdata',
  }));
  assert.equal(changedCompiler.ok, false);
  assert.equal(changedCompiler.reason, 'CALENDAR_COMPILER_VERSION_UNSUPPORTED');
  assert.equal(changedTzdata.ok, false);
  assert.equal(changedTzdata.reason, 'TIME_ZONE_DATA_VERSION_MISMATCH');

  const missingVersion = calendarCompileInput();
  delete missingVersion.timeZoneDataVersion;
  assert.equal(compileSchedulingCalendarDateV1(missingVersion).reason, 'EXACT_KEYS');
});

test('DST-invalid and DST-ambiguous local calendar times fail closed', () => {
  const spring = config();
  spring.resourceCalendars[1].weeklyWindows = [
    { weekday: 7, start: '02:30', end: '03:30' },
  ];
  spring.resourceCalendars[1].dateOverrides = [];
  const invalid = compileSchedulingCalendarDateV1(calendarCompileInput({
    configJson: spring, date: '2026-03-08',
  }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'LOCAL_TIME_AMBIGUOUS_OR_INVALID');

  const fall = config();
  fall.resourceCalendars[1].weeklyWindows = [
    { weekday: 7, start: '01:30', end: '02:30' },
  ];
  fall.resourceCalendars[1].dateOverrides = [];
  const ambiguous = compileSchedulingCalendarDateV1(calendarCompileInput({
    configJson: fall, date: '2026-11-01',
  }));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'LOCAL_TIME_AMBIGUOUS_OR_INVALID');

  const override = config();
  override.resourceCalendars[1].dateOverrides = [{
    date: '2026-03-08',
    status: 'custom',
    windows: [{ start: '02:30', end: '03:30' }],
  }];
  const rejectedAtPublish = normalizeSchedulingConfigV1(override);
  assert.equal(rejectedAtPublish.ok, false);
  assert.equal(rejectedAtPublish.reason, 'LOCAL_TIME_AMBIGUOUS_OR_INVALID');
});

test('calendar windows containing an internal DST gap or fold fail closed', () => {
  const spring = config();
  spring.resourceCalendars[1].weeklyWindows = [
    { weekday: 7, start: '01:30', end: '03:30' },
  ];
  spring.resourceCalendars[1].dateOverrides = [];
  const gap = compileSchedulingCalendarDateV1(calendarCompileInput({
    configJson: spring,
    date: '2026-03-08',
  }));
  assert.equal(gap.ok, false);
  assert.equal(gap.reason, 'DST_TRANSITION_WITHIN_WINDOW');

  const fall = config();
  fall.resourceCalendars[1].weeklyWindows = [
    { weekday: 7, start: '00:30', end: '02:30' },
  ];
  fall.resourceCalendars[1].dateOverrides = [];
  const fold = compileSchedulingCalendarDateV1(calendarCompileInput({
    configJson: fall,
    date: '2026-11-01',
  }));
  assert.equal(fold.ok, false);
  assert.equal(fold.reason, 'DST_TRANSITION_WITHIN_WINDOW');
});
