import { showMessage, dateKey, mondayOf, minutes, sessionState, layoutSessions } from './common.js?v=ui-20260922';

import {boardView,beijingParts} from './board-model.js';
import {referenceGallery,clearReferenceImages} from './references.js';
let protocolVersion=1,token='',authEpoch=0;
const displayState=(session,tasks)=>protocolVersion===3?session.actualState:sessionState(session,tasks);
const today=()=>protocolVersion===3?new Date(beijingParts(new Date()).date+'T12:00:00'):new Date();
const $ = selector => document.querySelector(selector);
const calendar = $('#calendar');
const message = $('#message');
const board = $('#board');
const agenda = $('#day-agenda');
const mobile = matchMedia('(max-width: 760px)');
const labels = { live: '拍摄中', scheduled: '已排期', blocked:'受阻', completed: '已完成', cancelled: '已取消' };
let currentSnapshot;
let viewMode = 'week';
let anchorDate = new Date();
let openCard;
let pinnedCard;
let clockTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function maps(snapshot) {
  const taskById = new Map(snapshot.tasks.map(task => [task.id, task]));
  const sessionsByDate = new Map();
  snapshot.sessions.forEach(session => {
    const items = sessionsByDate.get(session.date) || [];
    items.push(session);
    sessionsByDate.set(session.date, items);
  });
  sessionsByDate.forEach(items => items.sort((a, b) => a.start.localeCompare(b.start)));
  return { taskById, sessionsByDate };
}

function taskType(task) {
  if(protocolVersion===3)return task.kind==='静物'?'静物 / '+task.shootingSubtype:task.shootingSubtype==='细节'?'历史细节（未细分）':task.shootingSubtype;
  return [task.request?.productionType || '未分类', task.request?.shootingSubtype || task.kind].filter(Boolean).join(' · ');
}

function closeCard() {
  if (openCard) {
    openCard.classList.remove('is-open');
    openCard.querySelector('.session-summary').setAttribute('aria-expanded', 'false');
    openCard.querySelector('.session-peek').hidden = true;
  }
  openCard = null;
  pinnedCard = null;
}

function expandCard(item) {
  if (openCard && openCard !== item) closeCard();
  const bounds = item.getBoundingClientRect();
  const width = Math.min(248, innerWidth - 32 - bounds.width);
  item.style.setProperty('--peek-width', width + 'px');
  item.classList.toggle('expand-left', !mobile.matches && bounds.right + width > innerWidth - 24);
  item.classList.add('is-open');
  item.querySelector('.session-summary').setAttribute('aria-expanded', 'true');
  item.querySelector('.session-peek').hidden = false;
  openCard = item;
}

function showDetails(session, tasks) {
  $('#session-dialog').dataset.sessionId=session.id;
  closeCard();
  const content = $('#session-dialog-content');
  const head = element('div', 'session-detail-meta');
  head.append(element('span', 'status-badge ' + displayState(session, tasks), labels[displayState(session, tasks)]),
    element('p', '', '计划 '+session.date + ' · ' + session.start + '–' + session.end),
    element('p', '', session.place || '地点待确认'));
  if(protocolVersion===3){
    head.append(element('p','','已确认预计结束：'+(session.confirmedForecast?beijingParts(session.confirmedForecast.estimatedEnd).time:'尚未确认')));
    for(const run of session.runs||[])head.append(element('p','','实际开拍：'+(run.startedAt?beijingParts(run.startedAt).time:'未发生')+'；实际完成：'+(run.completedAt?beijingParts(run.completedAt).time:'未发生')));
  }
  const sections = tasks.map(task => {
    const section = element('section', 'detail-task');
    section.append(element('h3', '', task.name), element('p', 'muted', taskType(task) + ' · ' + task.sku));
    const description = element('dl', 'detail-list');
    const request = task.request;
    const pairs = [['拍摄要求', task.deliver], ['客户', task.client], ['任务状态', { live:'拍摄中', blocked:'受阻', pending: '待排期', scheduled: '已排期', blocked:'受阻', completed: '已完成', cancelled: '已取消' }[task.status] || '未标记']];
    if (request) pairs.push(['提报人', request.requestedBy], ['期望日期', request.desiredDate], ['交付', [request.deliverableCount ? request.deliverableCount + ' 份' : '', request.aspectRatio, request.durationSeconds ? request.durationSeconds + ' 秒' : '', request.audioRequirement].filter(Boolean).join(' · ')], ['补充说明', request.note]);
    for (const [label, value] of pairs) {
      if (value) description.append(element('dt', '', label), element('dd', '', value));
    }
    section.append(description,referenceGallery(task.references,()=>token));
    return section;
  });
  content.replaceChildren(head, ...sections);
  if (session.note) content.append(element('h3', '', '场次备注'), element('p', 'preserve-lines', session.note));
  $('#session-dialog').showModal();
}

function sessionElement(session, taskById, mode = 'week') {
  const tasks = session.ids.map(id => taskById.get(id)).filter(Boolean);
  const names = session.ids.map(id => taskById.get(id)?.name || id).join(' / ');
  const state = displayState(session, tasks);
  const types = new Set(tasks.map(task => task.request?.productionType));
  const item = element('article', 'session-card ' + mode + '-session ' + (types.has('视频') ? 'video' : 'print') + ' state-' + state);
  item.dataset.sessionId = session.id;
  const summary = element('button', 'session-summary');
  summary.type = 'button';
  summary.setAttribute('aria-label', session.start + '至' + session.end + '，' + names + '，' + labels[state] + '，展开详情');
  summary.setAttribute('aria-expanded', 'false');
  const top = element('span', 'session-top');
  top.append(element('time', '', session.start + '–' + session.end));
  const badge = element('span', 'status-badge ' + state, labels[state]);
  if (protocolVersion!==3&&state === 'live') badge.title = '按排班时间显示，不代表实际开拍确认';
  summary.append(top, element('strong', 'session-name', names), badge);
  if(protocolVersion===3&&session.confirmedForecast)summary.append(element('small','','预计 '+beijingParts(session.confirmedForecast.estimatedEnd).time));
  const peek = element('div', 'session-peek');
  peek.hidden = true;
  const detail = element('div', 'peek-meta');
  detail.append(element('span', 'peek-label', '拍摄详情'), element('p', '', [...new Set(tasks.map(taskType))].join(' / ')), element('p', 'muted', session.place || '地点待确认'));
  const more = element('button', 'text-button', '查看完整详情 ↗');
  more.type = 'button';
  more.addEventListener('click', () => showDetails(session, tasks));
  peek.append(detail, more);
  item.append(summary, peek);
  item.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && !mobile.matches) expandCard(item);
  });
  item.addEventListener('pointerleave', () => {
    if (openCard === item && pinnedCard !== item && !item.contains(document.activeElement)) closeCard();
  });
  summary.addEventListener('focus', () => { if (!mobile.matches) expandCard(item); });
  item.addEventListener('focusout', event => {
    if (!item.contains(event.relatedTarget) && openCard === item) closeCard();
  });
  summary.addEventListener('click', () => {
    if (pinnedCard === item) closeCard();
    else { expandCard(item); pinnedCard = item; }
  });
  return item;
}

function selectDay(date) {
  anchorDate = date;
  renderCalendar();
  const selected = calendar.querySelector('[aria-pressed="true"]');
  selected?.focus({ preventScroll: true });
}

function dayButton(date, className, text) {
  const button = element('button', className, text);
  button.type = 'button';
  const key = dateKey(date);
  button.setAttribute('aria-label', key + '，查看当日场次');
  button.setAttribute('aria-pressed', String(key === dateKey(anchorDate)));
  if (key === dateKey(today())) {
    button.classList.add('today');
    button.setAttribute('aria-current', 'date');
  }
  button.addEventListener('click', () => selectDay(date));
  return button;
}

function renderAgenda(taskById, sessionsByDate) {
  const sessions = sessionsByDate.get(dateKey(anchorDate)) || [];
  const title = element('div', 'section-title');
  title.append(element('h2', '', (anchorDate.getMonth() + 1) + '月' + anchorDate.getDate() + '日'), element('span', 'muted', sessions.length + ' 场拍摄'));
  agenda.replaceChildren(title, ...sessions.map(session => sessionElement(session, taskById, 'agenda')));
  if (!sessions.length) agenda.append(element('p', 'empty-state', '当天暂无拍摄安排'));
}

function renderWeek(taskById, sessionsByDate) {
  $('#calendar-weekdays').hidden = true;
  calendar.className = 'week-calendar';
  const start = mondayOf(anchorDate);
  const dates = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  $('#calendar-title').textContent = start.getFullYear() + '年' + (start.getMonth() + 1) + '月' + start.getDate() + '日 — ' + (dates[6].getMonth() + 1) + '月' + dates[6].getDate() + '日';
  const sessions = dates.flatMap(date => sessionsByDate.get(dateKey(date)) || []);
  const startHour = Math.min(9, ...sessions.map(session => Math.floor(minutes(session.start) / 60)));
  const endHour = Math.max(19, ...sessions.map(session => Math.ceil(Math.max(minutes(session.end), minutes(session.start) + 60) / 60)));
  const height = (endHour - startHour) * 64;
  calendar.style.setProperty('--timeline-height', height + 'px');
  const corner = element('div', 'week-corner', '时间');
  const heads = dates.map((date, index) => {
    const button = dayButton(date, 'week-dayhead');
    const inner = element('span', 'dayhead-inner');
    inner.append(element('span', '', '周' + '一二三四五六日'[index]), element('strong', '', date.getDate()));
    const count = (sessionsByDate.get(dateKey(date)) || []).length;
    if (count) inner.append(element('small', 'day-count', count + ' 场'));
    button.append(inner);
    return button;
  });
  const hours = element('div', 'week-hours');
  for (let hour = startHour; hour < endHour; hour += 1) {
    const label = element('span', '', String(hour).padStart(2, '0') + ':00');
    label.style.top = (hour - startHour) * 64 + 'px';
    hours.append(label);
  }
  const lanes = dates.map(date => {
    const lane = element('div', 'week-lane');
    layoutSessions(sessionsByDate.get(dateKey(date)) || []).forEach(({ session, column, columns }) => {
      const item = sessionElement(session, taskById);
      item.style.top = (minutes(session.start) - startHour * 60) * 64 / 60 + 5 + 'px';
      item.style.height = Math.max(54, (minutes(session.end) - minutes(session.start)) * 64 / 60 - 10) + 'px';
      item.style.left = 'calc(' + column * 100 / columns + '% + 5px)';
      item.style.width = 'calc(' + 100 / columns + '% - 10px)';
      if (minutes(session.end) - minutes(session.start) < 75) item.classList.add('short-session');
      if (columns > 1) item.classList.add('overlap-session');
      lane.append(item);
    });
    return lane;
  });
  calendar.replaceChildren(corner, ...heads, hours, ...lanes);
  $('#period-summary').textContent = sessions.length ? '本周 ' + sessions.length + ' 场拍摄' : '本周暂无拍摄安排';
}

function renderMonth(taskById, sessionsByDate) {
  $('#calendar-weekdays').hidden = false;
  calendar.className = 'calendar-grid';
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  $('#calendar-title').textContent = year + '年' + (month + 1) + '月';
  const start = mondayOf(new Date(year, month, 1));
  const cells = [];
  let total = 0;
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const sessions = sessionsByDate.get(dateKey(date)) || [];
    const cell = element('section', 'calendar-day' + (date.getMonth() !== month ? ' outside-month' : ''));
    const number = dayButton(date, 'calendar-date', date.getDate());
    number.setAttribute('aria-label', dateKey(date) + '，' + sessions.length + ' 场拍摄');
    cell.append(number);
    if (date.getMonth() === month) total += sessions.length;
    const list = element('div', 'month-sessions');
    list.append(...sessions.map(session => sessionElement(session, taskById, 'month')));
    cell.append(list);
    if (sessions.length) cell.append(element('span', 'month-count', sessions.length + ' 场'));
    cells.push(cell);
  }
  calendar.replaceChildren(...cells);
  $('#period-summary').textContent = total ? '本月 ' + total + ' 场拍摄' : '本月暂无拍摄安排';
}

function renderCalendar() {
  if (!currentSnapshot) return;
  closeCard();
  const { taskById, sessionsByDate } = maps(currentSnapshot);
  $('#view-week').setAttribute('aria-pressed', String(viewMode === 'week'));
  $('#view-month').setAttribute('aria-pressed', String(viewMode === 'month'));
  $('#previous-period').setAttribute('aria-label', viewMode === 'week' ? '上一周' : '上一月');
  $('#next-period').setAttribute('aria-label', viewMode === 'week' ? '下一周' : '下一月');
  if (viewMode === 'week') renderWeek(taskById, sessionsByDate);
  else renderMonth(taskById, sessionsByDate);
  renderAgenda(taskById, sessionsByDate);
}

function renderPending(snapshot) {
  const scheduled = new Set(snapshot.sessions.flatMap(session => session.ids));
  const tasks = snapshot.tasks.filter(task => !scheduled.has(task.id) && task.status !== 'cancelled');
  $('#pending-count').textContent = tasks.length;
  const cards = tasks.map(task => {
    const item = element('article', 'pending-task');
    const button = element('button', 'pending-summary');
    button.type = 'button';
    button.append(element('strong', '', task.name), element('span', 'muted', taskType(task)));
    if (task.request?.desiredDate) button.append(element('small', '', '期望 ' + task.request.desiredDate.slice(5).replace('-', '月') + '日'));
    const detail = element('div', 'pending-detail');
    detail.hidden = true;
    detail.append(element('p', '', 'SKU · ' + task.sku), element('p', 'preserve-lines', task.deliver), element('p', 'muted', task.request?.requestedBy || task.client));
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      button.setAttribute('aria-expanded', String(!detail.hidden));
    });
    detail.append(referenceGallery(task.references,()=>token));
    item.append(button, detail);
    return item;
  });
  $('#pending').replaceChildren(...cards);
  if (!tasks.length) $('#pending').append(element('p', 'empty-state', '暂无待排任务'), element('a', 'text-link', '提交拍摄需求 →'));
  const link = $('#pending .text-link');
  if (link) link.href = protocolVersion===3?'/manage':'/submit';
}

async function loadBoard() {
  const epoch=authEpoch;
  $('#retry').hidden=true;showMessage(message,'正在读取排班…');
  try{
    const profile=await fetch('/api/client-profile');if(!profile.ok)throw Error('服务暂时不可用，请稍后重试。');
    const profileResult=await profile.json();if(epoch!==authEpoch)return;protocolVersion=profileResult.protocolVersion;
    if(protocolVersion===3){
      $('#create-order-link').href='/manage';$('#create-order-link').textContent='＋ 新建订单';
      document.querySelector('.legend').textContent='北京时间 · 实际进度以开拍和完成记录为准';
      if(!token){board.hidden=true;$('#board-login').hidden=false;showMessage(message,'请使用 Jenn 业务身份登录。');return;}
    }
    const response=await fetch(protocolVersion===3?'/api/v3/business/board':'/api/v1/snapshot',{headers:token?{Authorization:'Bearer '+token}:{}});
    if(!response.ok)throw Error(response.status===401?'登录失效或令牌无效，请重新登录。':response.status===403?'没有此看板的访问权限。':'排班读取失败，请刷新重试。');
    const result=await response.json();if(epoch!==authEpoch)return;const detailId=$('#session-dialog').open?$('#session-dialog').dataset.sessionId:null;clearReferenceImages();
    currentSnapshot=protocolVersion===3?boardView(result):result.snapshot;
    if(protocolVersion===3&&!board.dataset.loaded)anchorDate=today();
    board.dataset.loaded='yes';renderCalendar();renderPending(currentSnapshot);if(detailId){const selected=currentSnapshot.sessions.find(s=>s.id===detailId);if(selected)showDetails(selected,currentSnapshot.tasks.filter(t=>selected.ids.includes(t.id)));else $('#session-dialog').close();}
    $('#revision').textContent='数据版本 '+currentSnapshot.revision+' · 看板只读';board.hidden=false;
    $('#board-login').hidden=true;$('#board-logout').hidden=protocolVersion!==3;showMessage(message,'');
    clearInterval(clockTimer);clockTimer=setInterval(protocolVersion===3?loadBoard:updateLiveStates,30000);
  }catch(e){if(epoch!==authEpoch)return;board.hidden=true;currentSnapshot=null;clearReferenceImages();clearInterval(clockTimer);$('#session-dialog').close();$('#session-dialog-content').replaceChildren();$('#pending').replaceChildren();calendar.replaceChildren();if(protocolVersion===3)$('#board-login').hidden=false;showMessage(message,e.message,'error');$('#retry').hidden=false;}
}
$('#board-login').addEventListener('submit',e=>{e.preventDefault();authEpoch++;token=$('#board-token').value;$('#board-token').value='';loadBoard();});
$('#board-logout').addEventListener('click',()=>{authEpoch++;token='';currentSnapshot=null;clearInterval(clockTimer);clearReferenceImages();board.hidden=true;$('#board-login').hidden=false;$('#board-logout').hidden=true;$('#session-dialog').close();$('#session-dialog-content').replaceChildren();$('#pending').replaceChildren();calendar.replaceChildren();agenda.replaceChildren();showMessage(message,'已退出。');});

function updateLiveStates() {
  if (!currentSnapshot) return;
  const { taskById } = maps(currentSnapshot);
  currentSnapshot.sessions.forEach(session => {
    const state = displayState(session, session.ids.map(id => taskById.get(id)).filter(Boolean));
    document.querySelectorAll('.session-card').forEach(item => {
      if (item.dataset.sessionId !== session.id) return;
      Object.keys(labels).forEach(key => item.classList.toggle('state-' + key, key === state));
      const badge = item.querySelector('.status-badge');
      badge.className = 'status-badge ' + state;
      badge.textContent = labels[state];
      badge.title = state === 'live' ? '按排班时间显示，不代表实际开拍确认' : '';
      const names = session.ids.map(id => taskById.get(id)?.name || id).join(' / ');
      item.querySelector('.session-summary').setAttribute('aria-label', session.start + '至' + session.end + '，' + names + '，' + labels[state] + '，展开详情');
    });
  });
}

$('#view-week').addEventListener('click', () => { viewMode = 'week'; renderCalendar(); });
$('#view-month').addEventListener('click', () => { viewMode = 'month'; renderCalendar(); });
function movePeriod(direction) {
  anchorDate = viewMode === 'month'
    ? new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction, Math.min(anchorDate.getDate(), new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction + 1, 0).getDate()))
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() + direction * 7);
  renderCalendar();
}
$('#previous-period').addEventListener('click', () => movePeriod(-1));
$('#next-period').addEventListener('click', () => movePeriod(1));
$('#current-period').addEventListener('click', () => { anchorDate = today(); renderCalendar(); });
$('#retry').addEventListener('click', loadBoard);
$('#close-session').addEventListener('click', () => $('#session-dialog').close());
$('#session-dialog').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) event.currentTarget.close();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && openCard) {
    openCard.querySelector('.session-summary').focus({ preventScroll: true });
    closeCard();
  }
});
document.addEventListener('click', event => { if (openCard && !openCard.contains(event.target)) closeCard(); });
mobile.addEventListener('change', closeCard);
window.addEventListener('resize', () => {
  if (openCard) expandCard(openCard);
});
loadBoard();
