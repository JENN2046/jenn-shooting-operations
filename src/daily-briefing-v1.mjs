// A read-only presentation of an already authorized Daily Operations v1 result.
// This module does not acquire data or confer authentication/resource authority.
import {isSchedulingIdentifierV1} from './scheduling-contract-v1.mjs';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const text = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').trim() : null;
const id = value => isSchedulingIdentifierV1(value) ? value : null;
const instant = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value)
  && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/u.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const ACTIVE = ['shooting', 'blocked'];
const PENDING = ['notStarted', 'scheduled'];
const RUN = [...ACTIVE, ...PENDING, 'completed', 'cancelled', 'unknown'];

export function projectDailyBriefing(daily) {
  if (!record(daily) || daily.ok !== true || daily.version !== 1 || !date(daily.date)
      || !date(daily.businessToday) || daily.timeZone !== 'Asia/Shanghai' || !instant(daily.observedAt)) {
    return {ok: false, code: 'DAILY_BRIEFING_INPUT_INVALID'};
  }
  const issues = [];
  const issue = (section, code, message, entityId) => {
    issues.push({code, section, message, ...(entityId ? {entityId} : {})});
  };
  const unknown = message => ({state: 'unknown', items: [], message});
  const observedBusinessDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(daily.observedAt));
  if (observedBusinessDate !== daily.businessToday) issue('metadata', 'BUSINESS_DATE_CONFLICT', '业务今日与明确观察时间的上海日期不一致。');

  function session(value, section) {
    if (!record(value) || !id(value.scheduleItemId) || !RUN.includes(value.runStatus)) {
      issue(section, 'SESSION_INCOMPLETE', '场次标识或执行状态缺失，未展示为有效场次。');
      return null;
    }
    const sessionId = value.scheduleItemId;
    let runStatus = value.runStatus;
    const planned = instant(value.plannedStart) && instant(value.plannedEnd)
      && Date.parse(value.plannedEnd) > Date.parse(value.plannedStart);
    if (!planned) issue(section, 'PLAN_TIME_MISSING', '计划时间缺失或矛盾。', sessionId);
    let startedAt = instant(value.startedAt) ? value.startedAt : null;
    let completedAt = instant(value.completedAt) ? value.completedAt : null;
    const executionConflict = ACTIVE.includes(runStatus) && (!startedAt || completedAt !== null)
      || runStatus === 'completed' && (!startedAt || !completedAt || Date.parse(completedAt) < Date.parse(startedAt))
      || PENDING.includes(runStatus) && (startedAt !== null || completedAt !== null);
    if (value.startedAt != null && !instant(value.startedAt) || value.completedAt != null && !instant(value.completedAt)) {
      issue(section, 'ACTUAL_TIME_INVALID', '实际时间格式无效，未将它作为执行证据。', sessionId);
    }
    if (executionConflict) {
      issue(section, 'RUN_FACT_CONFLICT', '执行状态与实际起止事实不一致，不能判断进度。', sessionId);
      runStatus = 'unknown';
    }
    if (runStatus === 'unknown') issue(section, 'RUN_STATUS_UNKNOWN', '执行事实需要核对。', sessionId);
    const orders = Array.isArray(value.orders) ? value.orders.filter(record) : [];
    const name = orders.map(order => text(order.name)).filter(Boolean).join('、');
    if (!name) issue(section, 'ORDER_NAME_MISSING', '场次未提供订单名称。', sessionId);
    let forecast = null;
    if (value.confirmedForecast != null) {
      const f = value.confirmedForecast;
      if (record(f) && instant(f.estimatedEnd) && nonnegative(f.bufferAfterMinutes) && id(f.operationId)) {
        forecast = {estimatedEnd: f.estimatedEnd, bufferAfterMinutes: f.bufferAfterMinutes, operationId: f.operationId};
      } else issue(section, 'FORECAST_INCOMPLETE', '预计结束或原操作引用不完整，不能展示为已确认预计结束。', sessionId);
    }
    return {id: sessionId, name: name || '订单名称未提供', resourceId: id(value.resourceId),
      plannedStart: planned ? value.plannedStart : null, plannedEnd: planned ? value.plannedEnd : null,
      plannedDurationMinutes: planned ? (Date.parse(value.plannedEnd) - Date.parse(value.plannedStart)) / 60_000 : null,
      runStatus, startedAt, completedAt, forecast};
  }

  let today;
  const rawToday = Array.isArray(daily.todaySessions) ? daily.todaySessions : null;
  if (!rawToday) {
    issue('today', 'TODAY_MISSING', '场次列表未提供，不能解读为空日程。');
    today = unknown('场次列表未提供。');
  } else {
    const items = rawToday.map(value => session(value, 'today')).filter(Boolean);
    const duplicate = new Set(items.map(item => item.id)).size !== items.length;
    if (duplicate) issue('today', 'DUPLICATE_SESSION', '场次标识重复，列表存在冲突。');
    const begin = Date.parse(daily.date + 'T00:00:00+08:00');
    const dateConflict = items.some(item => item.plannedStart !== null
      && !(Date.parse(item.plannedStart) < begin + 86_400_000 && Date.parse(item.plannedEnd) > begin)
      && !(daily.date === daily.businessToday && ACTIVE.includes(item.runStatus)));
    if (dateConflict) issue('today', 'DATE_SCOPE_CONFLICT', '场次时间与所选日期不一致。');
    today = {state: duplicate || dateConflict ? 'conflict' : items.length !== rawToday.length ? 'unknown' : items.length ? 'ready' : 'empty',
      items, message: duplicate ? '场次列表存在重复标识。' : dateConflict ? '场次时间与所选日期存在冲突。' : items.length !== rawToday.length ? '仅展示可识别场次，列表不完整。'
        : items.length ? '沿用现有场次投影；计划时间不代表实际执行。' : '所选日期没有场次。'};
    if (record(daily.summary)) {
      const supplied = daily.summary;
      const counts = {total: items.length, completed: items.filter(item => item.runStatus === 'completed').length};
      for (const key of Object.keys(counts)) {
        if (own(supplied, key) && supplied[key] !== counts[key]) {
          issue('today', 'SUMMARY_CONFLICT', '上游汇总与场次明细不一致，未采用该汇总。');
        }
      }
    }
  }

  function pointer(key, section, candidates, emptyMessage) {
    if (!own(daily, key)) {
      issue(section, 'POINTER_MISSING', '对应场次指针未提供。');
      return {state: 'unknown', item: null, message: '数据未提供。'};
    }
    if (!['ready', 'empty'].includes(today.state)) {
      issue(section, 'TODAY_UNRESOLVED', '场次列表不完整或有冲突，无法交叉核对。');
      return {state: 'unknown', item: null, message: '场次列表需要先核对。'};
    }
    const supplied = daily[key];
    if (supplied === null && candidates.length === 0) {
      if (today.items.some(item => item.runStatus === 'unknown')) {
        issue(section, 'RUN_FACT_UNRESOLVED', '存在未知执行事实，不能判断为空。');
        return {state: 'unknown', item: null, message: '执行事实需要核对。'};
      }
      return {state: 'empty', item: null, message: emptyMessage};
    }
    const selected = supplied === null ? null : session(supplied, section);
    const expected = candidates[0];
    // Validate the supplied selection; never replace it with a guessed selection.
    if (!selected || !expected || section === 'current' && candidates.length !== 1
        || JSON.stringify(selected) !== JSON.stringify(expected)) {
      issue(section, 'POINTER_CONFLICT', '场次指针与列表中的执行/计划事实不一致。');
      return {state: 'conflict', item: null, message: '场次信息存在冲突，无法确定。'};
    }
    return {state: 'ready', item: selected, message: section === 'current' ? '以已有实际执行事实为准。' : '待开始，不代表已经开拍。'};
  }
  const active = today.items.filter(item => ACTIVE.includes(item.runStatus));
  const pending = today.items.filter((item, index) => PENDING.includes(item.runStatus)
    && rawToday?.[index]?.status === 'confirmed');
  const current = pointer('currentSession', 'current', active, '没有已记录的当前拍摄。');
  const next = pointer('nextSession', 'next', pending, '没有待开始的已确认场次。');

  let readyOrders;
  if (!Array.isArray(daily.readyUnscheduledOrders)) {
    issue('readyOrders', 'READY_ORDERS_MISSING', '可排未排订单列表未提供。');
    readyOrders = unknown('可排未排订单数据未提供。');
  } else {
    const items = [];
    const bound = new Set((rawToday || []).flatMap(value => Array.isArray(value?.requestIds) ? value.requestIds : []));
    for (const value of daily.readyUnscheduledOrders) {
      if (!record(value) || !id(value.id)) {
        issue('readyOrders', 'ORDER_INCOMPLETE', '订单标识缺失。');
        continue;
      }
      if (bound.has(value.id)) issue('readyOrders', 'ORDER_BINDING_CONFLICT', '可排未排订单同时出现在所选日期的排期绑定中。', value.id);
      const duration = value.duration;
      const durationMinutes = record(duration) && Number.isSafeInteger(duration.durationMs) && duration.durationMs > 0
        ? duration.durationMs / 60_000 : null;
      if (durationMinutes === null) issue('readyOrders', 'DURATION_MISSING', '订单时长未提供，不能据简报确认具备可排条件。', value.id);
      items.push({id: value.id, name: text(value.name) || '订单名称未提供', durationMinutes,
        durationSource: record(duration) ? text(duration.durationSource) : null});
    }
    const duplicate = new Set(items.map(item => item.id)).size !== items.length;
    if (duplicate) issue('readyOrders', 'DUPLICATE_ORDER', '可排未排列表有重复订单。');
    const needsReview = issues.some(item => item.section === 'readyOrders');
    readyOrders = {state: duplicate || issues.some(item => item.code === 'ORDER_BINDING_CONFLICT') ? 'conflict'
      : needsReview ? 'unknown' : items.length ? 'ready' : 'empty', items,
      message: needsReview ? '订单资料需要核对，不能由简报授予排期资格。' : items.length ? '沿用上游可排未排投影；不保证资源可用。' : '没有上游标记的可排未排订单。'};
  }

  let attention;
  if (!Array.isArray(daily.attentionQueue)) {
    issue('attention', 'ATTENTION_MISSING', '待处理列表未提供，不能判断没有阻塞。');
    attention = unknown('阻塞与待处理数据未提供。');
  } else {
    const items = [];
    for (const value of daily.attentionQueue) {
      if (!record(value) || !text(value.code) || !['critical', 'warning', 'info'].includes(value.severity)
          || !text(value.summary) || !id(value.entityId)) {
        issue('attention', 'ATTENTION_INCOMPLETE', '待处理事项缺少代码、级别、实体或说明。');
        continue;
      }
      items.push({code: text(value.code), severity: value.severity, entityId: value.entityId,
        summary: text(value.summary), recommendedAction: text(value.recommendedAction)});
    }
    attention = {state: items.length !== daily.attentionQueue.length ? 'unknown' : items.length ? 'ready' : 'empty', items,
      message: items.length !== daily.attentionQueue.length ? '待处理列表不完整。' : items.length ? '沿用上游规则与顺序，不增加 AI 风险判断。' : '上游未列出待处理事项。'};
  }

  let revisions = null;
  if (record(daily.revisions) && nonnegative(daily.revisions.scheduleRevision) && nonnegative(daily.revisions.projectionRevision)) {
    revisions = {scheduleRevision: daily.revisions.scheduleRevision, projectionRevision: daily.revisions.projectionRevision};
  } else issue('metadata', 'REVISIONS_MISSING', '版本未提供，简报不能用于后续变更确认。');
  issues.sort((a, b) => cmp(a.section, b.section) || cmp(a.code, b.code) || cmp(a.entityId || '', b.entityId || ''));
  return {ok: true, version: 1, kind: 'jso-daily-briefing', readonly: true,
    date: daily.date, businessToday: daily.businessToday, timeZone: daily.timeZone, observedAt: daily.observedAt,
    revisions, dataQuality: issues.length ? 'needs_review' : 'complete', issues,
    sections: {today, current, next, readyOrders, attention}};
}
