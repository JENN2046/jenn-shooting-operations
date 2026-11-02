import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDailyBriefing} from '../src/daily-briefing-v1.mjs';
import {syntheticDailyOperations} from '../examples/daily-briefing-synthetic-v1.mjs';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

test('existing Daily Operations projection becomes five deterministic read-only sections without mutation', () => {
  const input = freeze(syntheticDailyOperations()), before = JSON.stringify(input);
  const output = projectDailyBriefing(input);
  assert.equal(output.ok, true);
  assert.equal(output.readonly, true);
  assert.equal(output.dataQuality, 'complete');
  assert.equal(output.sections.today.items.length, 4);
  assert.equal(output.sections.current.item.id, 'SYNTHETIC-SESSION-CURRENT');
  assert.equal(output.sections.current.item.forecast.operationId, 'SYNTHETIC-FORECAST');
  assert.equal(output.sections.next.item.id, 'SYNTHETIC-SESSION-NEXT');
  assert.deepEqual(output.sections.readyOrders.items.map(row => row.durationMinutes), [25, 45]);
  assert.ok(output.sections.attention.items.some(row => row.code === 'DURATION_MISSING'));
  assert.ok(output.sections.attention.items.some(row => row.code === 'PAST_CONFIRMED_WITHOUT_RUN_FACT'));
  assert.equal(output.sections.today.items.filter(row => row.runStatus === 'completed').length, 1);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(projectDailyBriefing(input), output);
});

test('briefing does not copy raw source facts, credentials, attachments or arbitrary extra fields', () => {
  const input = syntheticDailyOperations();
  input.token = 'SYNTHETIC_DO_NOT_DISCLOSE';
  input.todaySessions[0].privateNote = 'SYNTHETIC_DO_NOT_DISCLOSE';
  input.attentionQueue[0].sourceFacts = {privateNote: 'SYNTHETIC_DO_NOT_DISCLOSE'};
  const output = JSON.stringify(projectDailyBriefing(input));
  assert.ok(!output.includes('SYNTHETIC_DO_NOT_DISCLOSE'));
  assert.ok(!output.includes('sourceFacts'));
});

test('missing collections are unknown, while explicit empty collections remain empty', () => {
  const input = syntheticDailyOperations();
  delete input.todaySessions; delete input.readyUnscheduledOrders; delete input.attentionQueue;
  const output = projectDailyBriefing(input);
  for (const key of ['today', 'current', 'next', 'readyOrders', 'attention']) assert.equal(output.sections[key].state, 'unknown');
  Object.assign(input, {todaySessions: [], currentSession: null, nextSession: null,
    readyUnscheduledOrders: [], attentionQueue: [], summary: {total: 0, completed: 0}});
  const empty = projectDailyBriefing(input);
  for (const key of ['today', 'current', 'next', 'readyOrders', 'attention']) assert.equal(empty.sections[key].state, 'empty');
});

test('invalid header fails without reflecting untrusted input', () => {
  for (const patch of [{version: 2}, {date: '2026-02-30'}, {timeZone: 'UTC'}, {observedAt: null},
    {observedAt: '2026-02-30T02:00:00Z'}]) {
    assert.deepEqual(projectDailyBriefing({...syntheticDailyOperations(), ...patch}), {ok: false, code: 'DAILY_BRIEFING_INPUT_INVALID'});
  }
  assert.equal(projectDailyBriefing(null).ok, false);
});

test('multiple active scenes and mismatched current pointer stay conflicted instead of choosing one', () => {
  const input = syntheticDailyOperations();
  Object.assign(input.todaySessions[2], {runStatus: 'shooting', startedAt: input.observedAt, completedAt: null});
  input.currentSession = null;
  const output = projectDailyBriefing(input);
  assert.equal(output.sections.current.state, 'conflict');
  assert.equal(output.sections.current.item, null);
  const other = syntheticDailyOperations();
  other.currentSession = {...other.currentSession, plannedEnd: '2026-10-12T05:00:00Z'};
  assert.equal(projectDailyBriefing(other).sections.current.state, 'conflict');
});

test('duplicate scenes and a wrong next pointer cannot be silently repaired', () => {
  const input = syntheticDailyOperations();
  input.todaySessions.push(input.todaySessions[0]);
  assert.equal(projectDailyBriefing(input).sections.today.state, 'conflict');
  const other = syntheticDailyOperations();
  other.nextSession = other.todaySessions.at(-1);
  const result = projectDailyBriefing(other);
  assert.equal(result.sections.next.state, 'conflict');
  assert.equal(result.sections.next.item, null);
});

test('ready order with missing duration or contradictory binding remains unresolved', () => {
  const input = syntheticDailyOperations();
  input.readyUnscheduledOrders[0].duration = null;
  const output = projectDailyBriefing(input);
  assert.equal(output.sections.readyOrders.state, 'unknown');
  assert.equal(output.sections.readyOrders.items[0].durationMinutes, null);
  input.todaySessions[0].requestIds.push(input.readyUnscheduledOrders[1].id);
  assert.equal(projectDailyBriefing(input).sections.readyOrders.state, 'conflict');
});

test('elapsed plan time or an inconsistent summary does not manufacture actual completion', () => {
  const input = syntheticDailyOperations();
  input.observedAt = '2026-10-12T12:00:00Z';
  input.summary.completed = 4;
  const output = projectDailyBriefing(input);
  assert.ok(output.issues.some(row => row.code === 'SUMMARY_CONFLICT'));
  assert.equal(output.sections.today.items.filter(row => row.runStatus === 'completed').length, 1);
  assert.equal(output.sections.current.item.runStatus, 'shooting');
});

test('invalid actual completion and incomplete confirmed forecast are explicitly flagged', () => {
  const input = syntheticDailyOperations();
  input.todaySessions[0].completedAt = null;
  input.currentSession.confirmedForecast.operationId = null;
  const result = projectDailyBriefing(input);
  assert.equal(result.sections.today.items[0].runStatus, 'unknown');
  assert.ok(result.issues.some(row => row.code === 'RUN_FACT_CONFLICT'));
  assert.ok(result.issues.some(row => row.code === 'FORECAST_INCOMPLETE'));
  assert.equal(result.sections.current.item.forecast, null);
});

test('selected-day and business-midnight inconsistencies are visible and the observation time is preserved', () => {
  const input = syntheticDailyOperations();
  input.date = '2026-10-10';
  assert.equal(projectDailyBriefing(input).sections.today.state, 'conflict');
  const other = syntheticDailyOperations();
  other.observedAt = '2026-10-12T16:01:00Z'; // Shanghai is already the 13th.
  const output = projectDailyBriefing(other);
  assert.ok(output.issues.some(row => row.code === 'BUSINESS_DATE_CONFLICT'));
  assert.equal(output.observedAt, other.observedAt);
});

test('a cancelled run remains visible without cancelling its confirmed schedule or counting as complete/pending', () => {
  const input = syntheticDailyOperations();
  const cancelled = input.todaySessions.at(-1);
  cancelled.runStatus = 'cancelled';
  cancelled.runs = [{id: 'SYNTHETIC-CANCELLED-RUN', status: 'cancelled', startedAt: null, completedAt: null}];
  const before = JSON.stringify(input);
  const output = projectDailyBriefing(input);
  assert.equal(output.dataQuality, 'complete');
  assert.equal(output.sections.today.items.length, input.todaySessions.length);
  assert.equal(output.sections.today.items.at(-1).runStatus, 'cancelled');
  assert.equal(output.sections.today.items.filter(row => row.runStatus === 'completed').length, 1);
  assert.equal(output.sections.next.item.id, 'SYNTHETIC-SESSION-NEXT');
  assert.equal(cancelled.status, 'confirmed');
  assert.equal(JSON.stringify(input), before);
});

test('existing domain Unicode/code-point identifier rules are reused rather than narrowed by the display', () => {
  const input = syntheticDailyOperations();
  const identifier = '订单 ' + '🟢'.repeat(100);
  input.readyUnscheduledOrders[0].id = identifier;
  input.todaySessions[0].resourceId = '摄影棚 A';
  const output = projectDailyBriefing(input);
  assert.equal(output.dataQuality, 'complete');
  assert.equal(output.sections.readyOrders.items[0].id, identifier);
  assert.equal(output.sections.today.items[0].resourceId, '摄影棚 A');
});
