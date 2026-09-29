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
import { createKioskDeviceProvisioner } from '/kiosk-device-identity-v1.js';

const QUEUE_KEY = 'jenn.kiosk.offline-queue.v2';
const DEVICE_KEY = 'jenn.kiosk.device-id.v2';
function isAuthoritativeKioskRefreshRejection(status) {
  return status === 401 || status === 403;
}

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
  if (typeof existing !== 'string'
      || [...existing].length === 0
      || [...existing].length > 160
      || !/^\S(?:[\s\S]*\S)?$/u.test(existing)) {
    throw new Error('DEVICE_IDENTITY_UNAVAILABLE');
  }
  return existing;
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
  const deviceProvisioner = createKioskDeviceProvisioner({
    storage: localStorage,
    fetchImpl: fetch,
    storageKey: DEVICE_KEY,
  });
  const transport = createFetchKioskTransport({ fetchImpl: fetch, currentUrl: '/api/v2/updates' });
  const queue = createKioskOfflineQueue({ storage, transport, clock: () => new Date() });
  let serverModel = null;
  let busy = false;
  let controlling = false;
  let identityBound = false;
  let lastServerFresh = false;

  function refreshIdentityTrustFromStorage() {
    if (!identityBound) return;
    try {
      if (deviceProvisioner.current() === null) {
        identityBound = false;
        lastServerFresh = false;
      }
    } catch {
      identityBound = false;
      lastServerFresh = false;
    }
  }

  function render() {
    refreshIdentityTrustFromStorage();
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
      controlling: controlling && identityBound,
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
      const identity = await deviceProvisioner.provision();
      if (!identity.ok) {
        identityBound = false;
        lastServerFresh = false;
        setMessage('设备身份与服务端绑定不一致，现场控制保持关闭。', 'error');
        render();
        return false;
      }
      identityBound = true;
      if (!identity.verified) {
        lastServerFresh = false;
        setMessage('设备身份暂未重新校验；离线事件仅保存在本机。', 'info');
        render();
        return false;
      }

      ensureControlLockStarted();
      if (serverModel === null || !controlling) {
        const refreshed = await transport.refreshCurrent({
          resourceId,
          projectionRevision: serverModel?.projectionRevision,
        });
        if (isAuthoritativeKioskRefreshRejection(refreshed.status)) {
          deviceProvisioner.revoke();
          identityBound = false;
          lastServerFresh = false;
          setMessage('设备或场地授权已撤销，现场控制保持关闭。', 'error');
          render();
          return false;
        }
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
      identityBound = false;
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
  let controlLockStarted = false;
  function ensureControlLockStarted() {
    if (controlLockStarted) return;
    controlLockStarted = true;
    controlLock.start();
  }

  function identityStorageChanged() {
    const wasBound = identityBound;
    refreshIdentityTrustFromStorage();
    if (wasBound && !identityBound) {
      setMessage('设备身份授权已变更，当前标签已切换为只读。', 'error');
      render();
    }
  }
  window.addEventListener('storage', identityStorageChanged);

  const poller = createVisibilityPoller({ documentTarget: document, task: synchronize });
  async function start() {
    let identity;
    try {
      identity = await deviceProvisioner.provision();
    } catch {
      identityBound = false;
      setMessage('设备身份校验失败，现场控制保持关闭；正在等待自动恢复。', 'error');
      render();
      poller.start();
      return false;
    }
    if (!identity.ok) {
      identityBound = false;
      setMessage('设备身份未完成可信绑定，现场控制保持关闭；正在等待自动恢复。', 'error');
      render();
      poller.start();
      return false;
    }
    identityBound = true;
    if (!identity.verified) {
      setMessage('设备当前离线；沿用已绑定身份，联网后由服务端重新校验。', 'info');
    }
    ensureControlLockStarted();
    render();
    poller.start();
    return true;
  }
  window.addEventListener('pagehide', () => {
    poller.stop();
    controlLock.stop();
    window.removeEventListener('storage', identityStorageChanged);
  }, { once: true });
  return Object.freeze({ synchronize, render, start });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const kioskUi = createKioskUi();
  if (kioskUi) void kioskUi.start();
}
