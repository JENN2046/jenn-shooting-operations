// Fixed synthetic facts only. No database, clock, provider, credentials or network.
import {projectDailyOperations} from '../src/daily-operations-v1.mjs';
import {businessInitialResource, businessInitialConfigV3} from '../src/business-defaults-v1.mjs';

export function syntheticDailyOperations() {
  const resource = businessInitialResource('SYNTHETIC-STUDIO');
  const now = '2026-10-12T02:00:00.000Z'; // 10:00, Asia/Shanghai; deliberately not the machine's current day.
  const time = value => '2026-10-12T' + value + ':00.000Z';
  const entries = [
    ['DONE', '示例 · 主图', 30], ['CURRENT', '示例 · 细节图', 30],
    ['NEXT', '示例 · 功能图', 30], ['LATER', '示例 · 场景图', 40],
    ['PAST', '示例 · 待核对旧场次', 30],
    ['READY-1', '示例 · 已到样 A', 25], ['READY-2', '示例 · 已到样 B', 45],
    ['SAMPLE', '示例 · 样品在途', 30], ['DURATION', '示例 · 时长未提供', null],
  ];
  const orderFacts = entries.map(([key, name]) => ({id: 'SYNTHETIC-' + key, name, kind: '静物',
    shootingSubtype: '产品3D主图', lifecycle: key === 'DONE' ? 'fulfilled' : 'open', references: [],
    submission: {productionType: '平面', shootingSubtype: '产品3D主图',
      sampleStatus: key === 'SAMPLE' ? 'inTransit' : 'arrivedVerified',
      desiredDate: '2026-10-12', priority: 'p1', lightingPreset: null, reflectivity: 'unknown'}}));
  const requests = entries.map(([key, _name, minutes]) => ({id: 'SYNTHETIC-' + key,
    durationEstimateJson: JSON.stringify(minutes === null ? null
      : {durationMs: minutes * 60_000, source: 'explicit', sourceVersion: 'synthetic-demo'})}));
  const slot = (key, start, end, runs = []) => ({id: 'SYNTHETIC-SESSION-' + key,
    resourceId: resource.resourceId, resourceResolutionStatus: 'resolved', status: 'confirmed',
    requestIds: ['SYNTHETIC-' + key], plannedStart: time(start), plannedEnd: time(end),
    bufferAfterMinutes: 20, runs});
  const sessions = [
    slot('DONE', '01:00', '01:30', [{id: 'SYNTHETIC-RUN-DONE', status: 'completed',
      startedAt: time('01:00'), completedAt: time('01:28')}]),
    {...slot('CURRENT', '01:50', '02:20', [{id: 'SYNTHETIC-RUN-CURRENT', status: 'shooting',
      startedAt: time('01:50'), completedAt: null}]), confirmedForecast: {
      estimatedEnd: time('02:25'), bufferAfterMinutes: 20, operationId: 'SYNTHETIC-FORECAST'}},
    slot('NEXT', '03:00', '03:30'), slot('LATER', '06:00', '06:40'),
    {...slot('PAST', '01:00', '01:30'), plannedStart: '2026-10-11T01:00:00.000Z', plannedEnd: '2026-10-11T01:30:00.000Z'},
  ];
  return projectDailyOperations({orderFacts, requests, sessions, writeAdmission: 'disabled',
    revisions: {scheduleRevision: 7, projectionRevision: 12},
    configs: [{active: true, calendarCompilerVersion: 'calendar-compiler-v3',
      configDigest: 'synthetic-demo-config', configJson: businessInitialConfigV3(resource, '2026-10-12')}]}, {now});
}
