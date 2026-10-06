// Proposed successor: v1 callers retain their exact normalizers and digest domains.
import { normalizeSchedulingConfigV1, normalizePublishSchedulingConfigV1, compileSchedulingCalendarDateV1 } from './scheduling-admin-contract-v1.mjs';
import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

export const SCHEDULING_CONFIG_SCHEMA_V2 = 2;
export const SCHEDULING_CALENDAR_COMPILER_VERSION_V2 = 'calendar-compiler-v2';
const DAY = 86400000;
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error('RECORD_KEYS_INVALID');
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value + 'T00:00:00.000Z'))
    || new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) !== value) throw new Error('CALENDAR_DATE_INVALID');
  return value;
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function data(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('CYCLIC_INPUT');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error('ARRAY_INVALID');
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new Error('ARRAY_INVALID');
  } else if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('RECORD_INVALID');
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(d, 'value')) throw new Error('UNSAFE_INPUT');
    data(d.value, seen);
  }
  seen.delete(value);
}
function attempt(code, work) { try { return freeze(work()); } catch (error) { return freeze({ ok: false, code, reason: error.message }); } }
function need(result) { if (!result.ok) throw new Error(result.reason ?? result.code); return result; }
function asV1(value, calendars) { return { ...value, schemaVersion: 1, resourceCalendars: calendars }; }
function shell(calendar, weeklyWindows = []) { return { resourceId: calendar.resourceId, capabilityDigest: calendar.capabilityDigest, weeklyWindows, dateOverrides: calendar.dateOverrides }; }

export function normalizeSchedulingConfigV2(input) {
  return attempt('SCHEDULING_CONFIG_INVALID', () => {
    data(input);
    if (input?.schemaVersion !== 2 || !Array.isArray(input.resourceCalendars)) throw new Error('SCHEMA_VERSION_INVALID');
    const base = need(normalizeSchedulingConfigV1(asV1(input, input.resourceCalendars.map(c => shell(c))))).config;
    const calendars = input.resourceCalendars.map(calendar => {
      exact(calendar, ['resourceId', 'capabilityDigest', 'rules', 'dateOverrides']);
      if (!Array.isArray(calendar.rules) || !calendar.rules.length || calendar.rules.length > 128) throw new Error('CALENDAR_RULES_INVALID');
      const rules = calendar.rules.map(rule => {
        exact(rule, ['effectiveFrom', 'weeklyWindows', 'alternatingSaturday']);
        const effectiveFrom = date(rule.effectiveFrom);
        const normal = need(normalizeSchedulingConfigV1(asV1(input, [shell({ ...calendar, dateOverrides: [] }, rule.weeklyWindows)]))).config.resourceCalendars[0];
        let alternatingSaturday = null;
        if (rule.alternatingSaturday !== null) {
          exact(rule.alternatingSaturday, ['workingAnchorDate', 'windows']);
          const workingAnchorDate = date(rule.alternatingSaturday.workingAnchorDate);
          if (new Date(workingAnchorDate + 'T00:00:00Z').getUTCDay() !== 6 || normal.weeklyWindows.some(w => w.weekday === 6)) throw new Error('ALTERNATING_SATURDAY_INVALID');
          if (!Array.isArray(rule.alternatingSaturday.windows) || !rule.alternatingSaturday.windows.length) throw new Error('ALTERNATING_SATURDAY_INVALID');
          for (const window of rule.alternatingSaturday.windows) exact(window, ['start', 'end']);
          const saturday = need(normalizeSchedulingConfigV1(asV1(input, [shell({ ...calendar, dateOverrides: [] }, rule.alternatingSaturday.windows.map(w => ({ weekday: 6, ...w })))]))).config.resourceCalendars[0];
          alternatingSaturday = { workingAnchorDate, windows: saturday.weeklyWindows.map(({ start, end }) => ({ start, end })) };
        }
        return { effectiveFrom, weeklyWindows: normal.weeklyWindows, alternatingSaturday };
      }).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      if (new Set(rules.map(r => r.effectiveFrom)).size !== rules.length) throw new Error('DUPLICATE_EFFECTIVE_DATE');
      const normalizedBase = base.resourceCalendars.find(c => c.resourceId === calendar.resourceId);
      return { resourceId: normalizedBase.resourceId, capabilityDigest: normalizedBase.capabilityDigest, rules, dateOverrides: normalizedBase.dateOverrides };
    });
    const ordered = base.resourceCalendars.map(c => calendars.find(n => n.resourceId === c.resourceId));
    const config = { ...base, schemaVersion: 2, resourceCalendars: ordered };
    return { ok: true, config, configJson: canonicalJsonSchedulingV1(config), configDigest: digestCanonicalJsonSchedulingV1({ domain: 'scheduling-config-v2', configJson: config }) };
  });
}
export function digestSchedulingConfigV2(input) { return need(normalizeSchedulingConfigV2(input)).configDigest; }
export function normalizeSchedulingConfig(input) { return Object.getOwnPropertyDescriptor(input ?? {}, 'schemaVersion')?.value === 2 ? normalizeSchedulingConfigV2(input) : normalizeSchedulingConfigV1(input); }

export function normalizePublishSchedulingConfigV2(input) {
  return attempt('PUBLISH_SCHEDULING_CONFIG_INVALID', () => {
    data(input);
    const admitted = need(normalizeSchedulingConfigV2(input?.configJson));
    if (input.configDigest !== admitted.configDigest) throw new Error('CONFIG_DIGEST_MISMATCH');
    if (input.calendarCompilerVersion !== SCHEDULING_CALENDAR_COMPILER_VERSION_V2) throw new Error('CALENDAR_COMPILER_VERSION_UNSUPPORTED');
    const surrogate = need(normalizeSchedulingConfigV1(asV1(admitted.config, admitted.config.resourceCalendars.map(c => shell(c)))));
    const checked = need(normalizePublishSchedulingConfigV1({ ...input, calendarCompilerVersion: 'calendar-compiler-v1', configJson: surrogate.config, configDigest: surrogate.configDigest }));
    const command = { ...checked.command, calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V2, configJson: admitted.config, configDigest: admitted.configDigest };
    const { operationId, ...content } = command;
    return { ok: true, commandType: 'PublishSchedulingConfigV2', command, commandJson: canonicalJsonSchedulingV1(command), commandDigest: digestCanonicalJsonSchedulingV1({ domain: 'scheduling-config-publish-command-v2', command: content }) };
  });
}
export function normalizePublishSchedulingConfig(input) { return Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(input ?? {}, 'configJson')?.value ?? {}, 'schemaVersion')?.value === 2 ? normalizePublishSchedulingConfigV2(input) : normalizePublishSchedulingConfigV1(input); }

export function compileSchedulingCalendarDateV2(input) {
  return attempt('SCHEDULING_CALENDAR_COMPILE_INVALID', () => {
    data(input);
    exact(input, ['configJson', 'resourceId', 'date', 'calendarCompilerVersion', 'timeZoneDataVersion']);
    if (input.calendarCompilerVersion !== SCHEDULING_CALENDAR_COMPILER_VERSION_V2) throw new Error('CALENDAR_COMPILER_VERSION_UNSUPPORTED');
    date(input.date);
    const { config } = need(normalizeSchedulingConfigV2(input.configJson));
    const calendar = config.resourceCalendars.find(c => c.resourceId === input.resourceId);
    if (!calendar) throw new Error('RESOURCE_CALENDAR_NOT_FOUND');
    const rule = calendar.rules.filter(r => r.effectiveFrom <= input.date).at(-1);
    let weeklyWindows = rule?.weeklyWindows ?? [];
    const alternate = rule?.alternatingSaturday;
    if (alternate && ((Date.parse(input.date) - Date.parse(alternate.workingAnchorDate)) / DAY) % 14 === 0) {
      weeklyWindows = [...weeklyWindows, ...alternate.windows.map(w => ({ weekday: 6, ...w }))];
    }
    const surrogate = asV1(config, [shell(calendar, weeklyWindows)]);
    const compiled = need(compileSchedulingCalendarDateV1({ ...input, configJson: surrogate, calendarCompilerVersion: 'calendar-compiler-v1' }));
    const source = compiled.source.startsWith('dateOverride:') ? compiled.source : rule ? `rule:${rule.effectiveFrom}` : 'beforeFirstRule:closed';
    const result = { resourceId: input.resourceId, date: input.date, source, calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V2, timeZoneDataVersion: compiled.timeZoneDataVersion, windows: compiled.windows };
    return { ok: true, ...result, resultDigest: digestCanonicalJsonSchedulingV1({ domain: 'scheduling-calendar-compile-result-v2', result }) };
  });
}
export function compileSchedulingCalendarDate(input) { return Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(input ?? {}, 'configJson')?.value ?? {}, 'schemaVersion')?.value === 2 ? compileSchedulingCalendarDateV2(input) : compileSchedulingCalendarDateV1(input); }
