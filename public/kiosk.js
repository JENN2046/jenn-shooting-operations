import {
  createBrowserQueueStorage,
  createFetchKioskTransport,
  createKioskOfflineQueue,
  validateKioskCurrentResponse,
} from '/kiosk-offline-queue-v2.js';
import {
  createKioskControlLock,
  createVisibilityPoller,
  deriveKioskActionState,
  validateBlockingInput,
} from '/kiosk-control-lock.js';

const QUEUE_KEY = 'jenn.kiosk.offline-queue.v2';
const DEVICE_KEY = 'jenn.kiosk.device-id.v2';
const labels = Object.freeze({
  scheduled: '待开始',
  shooting: '拍摄中',
  blocked: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
});

function byId(id) {
  return document.getElementById(id);
}

function secureId(prefix) {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('SECURE_RANDOM_UNAVAILABLE');
  }
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function deviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = secureId('DEVICE');
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

function formatTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed);
}

function renderTasks(target, tasks) {
  target.replaceChildren(...(tasks ?? []).map(task => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = `${task.sku} · ${task.name}`;
    const summary = document.createElement('span');
    summary.textContent = task.summary;
    item.append(name, summary);
    return item;
  }));
}

function setMessage(message, kind = 'info') {
  const target = byId('live-message');
  target.textContent = message;
  target.dataset.kind = kind;
}

function queueState(storage) {
  try {
    return storage.load() ?? { nextLocalSequence: 0 };
  } catch {
    return null;
  }
}

function renderSlot(prefix, item) {
  const title = byId(`${prefix}-title`);
  const time = byId(`${prefix}-time`);
  const tasks = byId(`${prefix}-tasks`);
  const notice = byId(prefix === 'current' ? 'grouped-notice' : 'next-grouped-notice');
  if (!item) {
    title.textContent = prefix === 'current' ? '暂无当前任务' : '暂无后续任务';
    time.textContent = '—';
    tasks.replaceChildren();
    notice.hidden = true;
    return;
  }
  title.textContent = item.tasks.map(task => task.name).join(' / ');
  time.textContent = `${formatTime(item.plannedStart)} — ${formatTime(item.plannedEnd)}`;
  renderTasks(tasks, item.tasks);
  notice.hidden = !item.isGrouped;
  notice.textContent = item.groupedNotice ?? '';
}

function createKioskUi() {
  const pageUrl = new URL(location.href);
  const query = [...pageUrl.searchParams.entries()];
  const resourceId = query.length === 1 && query[0][0] === 'resourceId' ? query[0][1] : null;
  if (!resourceId || [...resourceId].length > 160 || !/^\S(?:[\s\S]*\S)?$/u.test(resourceId)) {
    setMessage('缺少有效的 resourceId，现场控制保持关闭。', 'error');
    return null;
  }

  let tabOwnerId;
  try {
    tabOwnerId = secureId('TAB');
  } catch {
    setMessage('浏览器缺少安全随机能力，现场控制保持关闭。', 'error');
    return null;
  }

  const storage = createBrowserQueueStorage({ storage: localStorage, key: QUEUE_KEY });
  const transport = createFetchKioskTransport({ fetchImpl: fetch, currentUrl: '/api/v2/updates' });
  const queue = createKioskOfflineQueue({ storage, transport, clock: () => new Date() });
  let serverModel = null;
  let busy = false;
  let controlling = false;
  let lastServerFresh = false;

  function render() {
    const inspected = queue.inspect();
    const stored = queueState(storage);
    const pendingItems = inspected.ok ? inspected.items : [];
    const syncStatus = inspected.ok ? inspected.syncStatus : 'reviewRequired';
    byId('pending-count').textContent = inspected.ok ? String(inspected.pendingCount) : '—';
    byId('sync-status').textContent = `队列：${syncStatus}`;
    byId('sync-status').dataset.state = syncStatus;
    byId('server-status').textContent = lastServerFresh ? '服务端：已刷新' : '服务端：缓存 / 等待';
    byId('server-status').dataset.state = lastServerFresh ? 'fresh' : 'stale';
    renderSlot('current', serverModel?.current ?? null);
    renderSlot('next', serverModel?.next ?? null);

    const action = deriveKioskActionState({
      serverItem: serverModel?.current ?? null,
      pendingItems,
      controlling,
      busy: busy || ['conflict', 'reviewRequired'].includes(syncStatus),
    });
    byId('confirmed-state').textContent = `服务端：${labels[serverModel?.current?.runState] ?? '—'}`;
    byId('pending-state').hidden = !action.unconfirmed;
    byId('pending-state').textContent = action.invalidPendingContext
      ? '本地队列与当前场次不一致（未确认）'
      : `本地预计：${labels[action.state] ?? action.state}（未确认）`;
    for (const button of document.querySelectorAll('[data-action]')) {
      button.disabled = !action.actions.includes(button.dataset.action);
    }
    if (!action.actions.includes('block')) byId('block-form').hidden = true;
    return { action, stored, syncStatus };
  }

  async function synchronize() {
    if (busy) return false;
    busy = true;
    render();
    try {
      if (serverModel === null || !controlling) {
        const refreshed = await transport.refreshCurrent({
          resourceId,
          projectionRevision: serverModel?.projectionRevision,
        });
        if (refreshed.status === 200
          && validateKioskCurrentResponse(refreshed.body).ok
          && refreshed.body.resourceId === resourceId) {
          serverModel = refreshed.body;
          lastServerFresh = true;
        } else if (refreshed.status === 304 && serverModel !== null) {
          lastServerFresh = true;
        } else {
          lastServerFresh = false;
        }
        if (!controlling || !lastServerFresh) {
          setMessage(lastServerFresh
            ? '只读标签已刷新服务端状态。'
            : '网络不可用；服务端状态未更新。', lastServerFresh ? 'info' : 'error');
          return lastServerFresh;
        }
      }
      let outcome = await queue.replay({ resourceId });
      if (outcome.ok && outcome.serverStatus.kind === 'fresh') serverModel = outcome.serverStatus.current;
      if (outcome.ok && outcome.processed > 0) {
        outcome = await queue.replay({ resourceId });
        if (outcome.ok && outcome.serverStatus.kind === 'fresh') serverModel = outcome.serverStatus.current;
      }
      lastServerFresh = outcome.ok && ['fresh', 'unchanged'].includes(outcome.serverStatus.kind);
      if (!outcome.ok) setMessage('本地队列状态异常，已停止现场写入。', 'error');
      else if (outcome.syncStatus === 'conflict') setMessage('发生冲突，队列已停止。请联系调度员处理。', 'error');
      else if (outcome.syncStatus === 'reviewRequired') setMessage('该事件需要人工复核，队列已停止。', 'error');
      else if (!lastServerFresh) setMessage('网络不可用；本地待发送事件仍保留，服务端状态未更新。', 'error');
      else setMessage(outcome.pendingCount > 0 ? '事件已保存在本机，等待服务端确认。' : '已与服务端同步。');
      return lastServerFresh;
    } catch {
      lastServerFresh = false;
      setMessage('同步失败；本地待发送事件仍保留。', 'error');
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  function enqueue(eventType, extra = {}) {
    const { action, stored } = render();
    if (!controlling || busy || !action.actions.includes(eventType) || !serverModel?.current || !stored) return;
    let result;
    try {
      const runId = action.runId ?? secureId('RUN');
      const command = {
        schemaVersion: 2,
        eventId: secureId('EVENT'),
        runId,
        scheduleItemId: serverModel.current.scheduleItemId,
        eventType,
        expectedRunRevision: action.expectedRunRevision,
        occurredAt: new Date().toISOString(),
        deviceId: deviceId(),
        localSequence: stored.nextLocalSequence,
        ...extra,
      };
      result = queue.enqueue(command);
    } catch {
      setMessage('无法安全创建或保存现场操作，未发送。', 'error');
      render();
      return;
    }
    if (!result.ok) {
      setMessage('无法安全保存现场操作，未发送。', 'error');
      render();
      return;
    }
    setMessage('操作已先保存在本机，尚未获得服务端确认。');
    render();
    void synchronize();
  }

  byId('action-start').addEventListener('click', () => enqueue('start'));
  byId('action-resume').addEventListener('click', () => enqueue('resume'));
  byId('action-block').addEventListener('click', () => {
    byId('block-form').hidden = false;
    byId('block-reason').focus();
  });
  function resetBlockForm() {
    byId('block-form').reset();
    byId('block-note').hidden = true;
    byId('block-note-label').hidden = true;
    byId('block-note').required = false;
    byId('block-form').hidden = true;
  }
  byId('block-cancel').addEventListener('click', () => {
    resetBlockForm();
    byId('action-block').focus();
  });
  byId('block-reason').addEventListener('change', event => {
    const other = event.target.value === 'other';
    byId('block-note').hidden = !other;
    byId('block-note-label').hidden = !other;
    byId('block-note').required = other;
    if (other) byId('block-note').focus();
  });
  byId('block-form').addEventListener('submit', event => {
    event.preventDefault();
    const reasonCode = byId('block-reason').value;
    const note = byId('block-note').value;
    const validation = validateBlockingInput(reasonCode, note);
    if (!validation.ok) {
      setMessage(validation.code === 'BLOCK_NOTE_REQUIRED' ? '请填写其他原因说明。' : '请选择暂停原因。', 'error');
      return;
    }
    enqueue('block', { reasonCode, ...(note.trim() ? { note: note.trim() } : {}) });
    resetBlockForm();
  });
  byId('action-complete').addEventListener('click', () => byId('complete-dialog').showModal());
  byId('complete-cancel').addEventListener('click', () => byId('complete-dialog').close());
  byId('complete-confirm').addEventListener('click', () => {
    byId('complete-dialog').close();
    enqueue('complete');
  });

  const controlLock = createKioskControlLock({
    locks: navigator.locks,
    storage: localStorage,
    eventTarget: window,
    ownerId: tabOwnerId,
    onChange(state) {
      controlling = state.controlling;
      byId('lock-status').textContent = state.controlling ? '控制权：本标签' : '控制权：只读';
      byId('lock-status').dataset.state = state.controlling ? 'controlling' : 'readonly';
      if (!state.controlling) setMessage('另一标签正在控制；本标签保持只读。');
      render();
    },
  });
  const poller = createVisibilityPoller({ documentTarget: document, task: synchronize });
  controlLock.start();
  render();
  poller.start();
  window.addEventListener('pagehide', () => {
    poller.stop();
    controlLock.stop();
  }, { once: true });
  return Object.freeze({ synchronize, render });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') createKioskUi();
