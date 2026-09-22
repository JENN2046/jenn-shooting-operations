import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateKey, mondayOf, sessionState, layoutSessions, mergeFiles, fileSelectionError } from '../public/common.js';

test('calendar dates preserve local dates across year boundaries', () => {
  assert.equal(dateKey(mondayOf(new Date(2027, 0, 1))), '2026-12-28');
  assert.equal(dateKey(mondayOf(new Date(2026, 8, 27))), '2026-09-21');
});
test('live indication is bounded by schedule time and never overrides terminal states', () => {
  const session = { date: '2026-09-22', start: '09:30', end: '11:00' };
  const tasks = [{ status: 'scheduled' }];
  assert.equal(sessionState(session, tasks, new Date(2026, 8, 22, 9, 29)), 'scheduled');
  assert.equal(sessionState(session, tasks, new Date(2026, 8, 22, 9, 30)), 'live');
  assert.equal(sessionState(session, tasks, new Date(2026, 8, 22, 11, 0)), 'scheduled');
  assert.equal(sessionState(session, [{ status: 'completed' }], new Date(2026, 8, 22, 10)), 'completed');
  assert.equal(sessionState(session, [{ status: 'cancelled' }], new Date(2026, 8, 22, 10)), 'cancelled');
  assert.equal(sessionState(session, tasks, new Date(2026, 8, 23, 10)), 'scheduled');
  assert.deepEqual(tasks, [{ status: 'scheduled' }]);
});
test('simultaneous and chained sessions receive separate columns without mutating source', () => {
  const sessions = [
    { id: 'c', start: '10:30', end: '12:00' },
    { id: 'a', start: '09:00', end: '10:00' },
    { id: 'b', start: '09:30', end: '11:00' },
    { id: 'd', start: '12:00', end: '13:00' },
  ];
  const layout = layoutSessions(sessions);
  assert.deepEqual(layout.map(item => [item.session.id, item.column, item.columns]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1]]);
  assert.equal(sessions[0].id, 'c');
  assert.deepEqual(layoutSessions([]), []);
});
test('adding files retains prior selection, deduplicates identical files, keeps different versions', () => {
  const a = { name: 'photo.png', size: 10, type: 'image/png', lastModified: 1 };
  const b = { name: 'photo.png', size: 10, type: 'image/png', lastModified: 2 };
  const existing = [a];
  assert.deepEqual(mergeFiles(existing, [a, b, b]), [a, b]);
  assert.deepEqual(existing, [a]);
  assert.deepEqual(mergeFiles(existing, []), [a]);
});
test('upload feedback preserves existing count, byte and per-file boundaries', () => {
  const mb = 1024 * 1024;
  const image = size => ({ kind: 'image', file: { name: 'image.png', size } });
  const attachment = size => ({ kind: 'attachment', file: { name: 'file.pdf', size } });
  assert.equal(fileSelectionError([image(12 * mb)]), '');
  assert.notEqual(fileSelectionError([image(12 * mb + 1)]), '');
  assert.equal(fileSelectionError([attachment(20 * mb)]), '');
  assert.notEqual(fileSelectionError([attachment(20 * mb + 1)]), '');
  assert.equal(fileSelectionError([attachment(20 * mb), attachment(20 * mb)]), '');
  assert.notEqual(fileSelectionError([attachment(20 * mb), attachment(20 * mb), image(1)]), '');
  assert.equal(fileSelectionError(Array.from({ length: 10 }, () => image(1))), '');
  assert.notEqual(fileSelectionError(Array.from({ length: 11 }, () => image(1))), '');
  assert.notEqual(fileSelectionError([image(0)]), '');
});
