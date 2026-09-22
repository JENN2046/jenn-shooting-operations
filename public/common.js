export function showMessage(element, message, type = 'info') {
  element.textContent = message;
  element.dataset.type = type;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
}

export function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function mondayOf(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}

export function minutes(value) {
  const [hours, minute] = value.split(':').map(Number);
  return hours * 60 + minute;
}

// Display only: the persisted task status is never changed by the clock.
export function sessionState(session, tasks, now = new Date()) {
  if (tasks.length && tasks.every(task => task.status === 'cancelled')) return 'cancelled';
  const active = tasks.filter(task => task.status !== 'cancelled');
  if (active.length && active.every(task => task.status === 'completed')) return 'completed';
  const time = now.getHours() * 60 + now.getMinutes();
  if (session.date === dateKey(now) && time >= minutes(session.start) && time < minutes(session.end)) return 'live';
  return 'scheduled';
}

// Partition overlapping events without changing their scheduled times.
export function layoutSessions(sessions) {
  const sorted = [...sessions].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
  const result = [];
  let group = [];
  let ends = [];
  let groupEnd = -1;
  const flush = () => {
    group.forEach(item => result.push({ ...item, columns: ends.length }));
    group = [];
    ends = [];
  };
  for (const session of sorted) {
    const start = minutes(session.start);
    const end = Math.max(minutes(session.end), start + 60);
    if (start >= groupEnd) flush();
    let column = ends.findIndex(value => value <= start);
    if (column < 0) column = ends.length;
    ends[column] = end;
    group.push({ session, column });
    groupEnd = Math.max(...ends);
  }
  flush();
  return result;
}

export function mergeFiles(existing, incoming) {
  const key = file => JSON.stringify([file.name, file.size, file.type, file.lastModified]);
  const seen = new Set(existing.map(key));
  return [...existing, ...incoming.filter(file => {
    if (seen.has(key(file))) return false;
    seen.add(key(file));
    return true;
  })];
}

export function fileSelectionError(files) {
  if (files.length > 10) return '最多选择 10 个文件，请移除部分文件后再添加。';
  for (const { file, kind } of files) {
    const limit = kind === 'image' ? 12 : 20;
    if (!file.size || file.size > limit * 1024 * 1024) return '“' + file.name + '”' + (file.size ? '超过 ' + limit + ' MB' : '是空文件') + '，请重新选择。';
  }
  if (files.reduce((total, { file }) => total + file.size, 0) > 40 * 1024 * 1024) return '文件总容量超过 40 MB，请移除部分文件后再添加。';
  return '';
}
