import {resolveDuration} from './deterministic-scheduler-v1.mjs';
import {compileSchedulingCalendarDate} from './scheduling-admin-contract-v2.mjs';
import {SCHEDULING_TIME_ZONE_DATA_VERSION} from './scheduling-contract-v1.mjs';

const MINUTE = 60_000;
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const businessDate = value => new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(value));
export const validDailyDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
const ORDER = ['BLOCKED_RUN','UNKNOWN_OCCUPANCY','PAST_CONFIRMED_WITHOUT_RUN_FACT',
  'WRITE_ADMISSION_DISABLED','FORECAST_OUTSIDE_WINDOW','DESIRED_DATE_AT_RISK',
  'UNSCHEDULED_READY','SAMPLE_NOT_READY','DURATION_MISSING'];

// A pure projection of the existing authorized management snapshot. No clock,
// database, event creation, proposal generation or write capability is owned here.
export function projectDailyOperations(facts, {now, date = businessDate(now)} = {}) {
  if (!validDailyDate(date)) return {ok:false,code:'INVALID_DAILY_DATE'};
  if (!instant(now)) throw new TypeError('daily operations requires an explicit observation time');
  const at = Date.parse(now), today = businessDate(now);
  const active = facts.configs.find(config => config.active);
  const config = active?.configJson;
  const requests = new Map((facts.requests || []).map(request => [request.id,request]));
  const attentionQueue = [];
  const attention = (code,severity,entityType,entityId,summary,recommendedAction,sourceFacts) => {
    attentionQueue.push({code,severity,entityType,entityId,summary,recommendedAction,
      reason:summary,sourceFacts});
  };
  const orders = facts.orderFacts.map(order => {
    const submission = order.submission;
    let estimate = null;
    try { estimate = JSON.parse(requests.get(order.id)?.durationEstimateJson || 'null'); } catch { /* missing usable evidence */ }
    const duration = resolveDuration({...submission,durationEstimate:estimate}, {resourceId:null},
      config || {durationFallbackRules:[]}, []);
    return {...order,sampleStatus:submission.sampleStatus,desiredDate:submission.desiredDate,
      priority:submission.priority,duration:duration && Number.isSafeInteger(duration.durationMs) && duration.durationMs > 0 ? duration : null};
  });
  const byOrder = new Map(orders.map(order => [order.id,order]));
  const sessions = facts.sessions.filter(session => session.status !== 'cancelled').map(session => {
    const runs = session.runs || [], run = runs.length === 1 ? runs[0] : null;
    const executionUnknown = runs.length > 1 || run && ((['shooting','blocked','completed'].includes(run.status) && !instant(run.startedAt))
      || (run.status === 'completed' && (!instant(run.completedAt) || run.completedAt < run.startedAt))
      || (run.status === 'scheduled' && (run.startedAt || run.completedAt))
      || (['shooting','blocked'].includes(run.status) && run.completedAt));
    const occupancyUnknown = session.resourceResolutionStatus !== 'resolved' || session.bufferAfterMinutes === null
      || !instant(session.plannedStart) || !instant(session.plannedEnd) || session.plannedEnd <= session.plannedStart;
    const runStatus = executionUnknown ? 'unknown' : run?.status || 'notStarted';
    const boundOrders = session.requestIds.map(id => byOrder.get(id)).filter(Boolean);
    const current = ['shooting','blocked'].includes(runStatus);
    return {...session,scheduleItemId:session.id,runStatus,occupancyUnknown,startedAt:run?.startedAt ?? null,
      completedAt:run?.completedAt ?? null,elapsedMinutes:current ? Math.max(0,Math.floor((at-Date.parse(run.startedAt))/MINUTE)) : null,
      referenceImages:boundOrders.flatMap(order => order.references),
      referenceImagesAvailable:boundOrders.some(order => order.references.length > 0),
      orders:boundOrders.map(order => ({id:order.id,name:order.name,kind:order.kind,shootingSubtype:order.shootingSubtype,
        sampleStatus:order.sampleStatus,desiredDate:order.desiredDate})),
      nextAction:occupancyUnknown || executionUnknown ? 'reconcile' : current ? 'ownerField' : runStatus === 'completed' ? 'viewRun' : 'selectActual',
    };
  }).sort((a,b) => cmp(a.plannedStart,b.plannedStart) || cmp(a.id,b.id));
  const begin = Date.parse(date+'T00:00:00+08:00'), end = begin+86400000;
  const todaySessions = sessions.filter(session => Date.parse(session.plannedStart) < end && Date.parse(session.plannedEnd) > begin
    || date === today && ['shooting','blocked'].includes(session.runStatus));
  const activeSessions = todaySessions.filter(session => ['shooting','blocked'].includes(session.runStatus));
  const currentSession = activeSessions.length === 1 ? activeSessions[0] : null;
  // An overdue confirmed session stays pending; the clock does not complete it.
  const nextSession = todaySessions.find(session => session.status === 'confirmed'
    && ['notStarted','scheduled'].includes(session.runStatus)) || null;
  const bound = new Set(sessions.flatMap(session => session.requestIds));
  const bindingsByOrder = new Map();
  for(const session of sessions)for(const id of session.requestIds){const list=bindingsByOrder.get(id)||[];list.push(session);bindingsByOrder.set(id,list);}
  const readyUnscheduledOrders = orders.filter(order => order.lifecycle === 'open'
    && !bound.has(order.id) && order.sampleStatus === 'arrivedVerified' && order.duration)
    .sort((a,b) => cmp(a.desiredDate || '9999',b.desiredDate || '9999') || cmp(a.priority,b.priority) || cmp(a.id,b.id));
  const readyIds = new Set(readyUnscheduledOrders.map(order => order.id));

  for (const session of sessions) {
    const source = {scheduleItemId:session.id,scheduleStatus:session.status,plannedStart:session.plannedStart,
      plannedEnd:session.plannedEnd,bufferAfterMinutes:session.bufferAfterMinutes,runs:session.runs};
    if (session.runStatus === 'blocked') attention('BLOCKED_RUN','critical','scheduleItem',session.id,
      '执行记录为受阻，请核对现场原因。','ownerField',source);
    if (session.runStatus === 'unknown' || session.occupancyUnknown) attention('UNKNOWN_OCCUPANCY','critical','scheduleItem',session.id,
      '占用或执行事实不完整，不能推断资源已释放。','reconcile',source);
    if (session.status === 'confirmed' && Date.parse(session.plannedEnd) < at
      && ['notStarted','scheduled'].includes(session.runStatus)) attention('PAST_CONFIRMED_WITHOUT_RUN_FACT','warning','scheduleItem',session.id,
      '计划已结束，但没有实际开拍或完成事实。','selectActual',source);
    if (session.confirmedForecast && instant(session.plannedStart) && !['completed','cancelled'].includes(session.runStatus)) {
      const forecast = session.confirmedForecast;
      const compiled = active ? compileSchedulingCalendarDate({configJson:config,resourceId:session.resourceId,
        date:businessDate(session.plannedStart),calendarCompilerVersion:active.calendarCompilerVersion,
        timeZoneDataVersion:SCHEDULING_TIME_ZONE_DATA_VERSION}) : null;
      const forecastEnd = Date.parse(forecast.estimatedEnd)+forecast.bufferAfterMinutes*MINUTE;
      if (!compiled?.ok) attention('UNKNOWN_OCCUPANCY','warning','scheduleItem',session.id,
        '无法核对已确认预计结束所对应的工作窗口。','dayAdjustment',{...source,confirmedForecast:forecast});
      else if (!compiled.windows.some(window => Date.parse(session.startedAt || session.plannedStart) >= Date.parse(window.start)
        && forecastEnd <= Date.parse(window.end))) attention('FORECAST_OUTSIDE_WINDOW','warning','scheduleItem',session.id,
        '已确认预计结束（含缓冲）超出工作窗口；这不是加班授权。','dayAdjustment',
        {...source,confirmedForecast:forecast,configDigest:active.configDigest,windows:compiled.windows});
    }
  }
  if (activeSessions.length > 1) attention('UNKNOWN_OCCUPANCY','critical','day',date,
    '存在多场执行中记录，无法选出唯一当前拍摄。','ownerField',{activeScheduleItemIds:activeSessions.map(session => session.id)});
  for (const order of orders.filter(order => order.lifecycle === 'open')) {
    const bindings = bindingsByOrder.get(order.id) || [];
    const source = {requestId:order.id,lifecycle:order.lifecycle,sampleStatus:order.sampleStatus,
      desiredDate:order.desiredDate,duration:order.duration,scheduleItemIds:bindings.map(session => session.id)};
    if (!bound.has(order.id)) {
      if (order.sampleStatus !== 'arrivedVerified') attention('SAMPLE_NOT_READY','info','request',order.id,
        '样品尚未核实到货，不能进入可排订单。','editOrder',source);
      if (!order.duration) attention('DURATION_MISSING','info','request',order.id,
        '缺少明确时长或生效规则中的可用默认时长。','duration',source);
      if (readyIds.has(order.id)) attention('UNSCHEDULED_READY','info','request',order.id,
        '样品与时长已具备，尚无有效排期。','proposal',source);
    }
    const unfinished = !bindings.some(session => session.runStatus === 'completed');
    const afterDesired = bindings.some(session => {
      const end=session.confirmedForecast?.estimatedEnd || session.plannedEnd;
      return instant(end) && businessDate(end) > order.desiredDate;
    });
    if (validDailyDate(order.desiredDate) && unfinished && (order.desiredDate < today || !bindings.length && order.desiredDate <= date || afterDesired)) attention('DESIRED_DATE_AT_RISK','warning','request',order.id,
      '期望日期已到但尚无完成事实，或安排/已确认预计结束晚于期望日期。',bindings.length ? 'reschedule' : 'proposal',source);
  }
  if (facts.writeAdmission === 'disabled') attention('WRITE_ADMISSION_DISABLED','warning','system','writeAdmission',
    '当前禁写；可查看事实，处理动作仍由原写入门禁决定。','viewState',{writeAdmission:facts.writeAdmission});
  attentionQueue.sort((a,b) => ORDER.indexOf(a.code)-ORDER.indexOf(b.code)
    || cmp(a.entityType,b.entityType) || cmp(a.entityId,b.entityId) || cmp(a.summary,b.summary));
  const count = status => todaySessions.filter(session => session.runStatus === status).length;
  const ends = todaySessions.map(session => session.runStatus==='completed'?session.completedAt:session.confirmedForecast?.estimatedEnd || session.plannedEnd).filter(instant).sort(cmp);
  return {ok:true,version:1,date,businessToday:today,timeZone:'Asia/Shanghai',observedAt:now,revisions:facts.revisions,
    todaySessions,currentSession,nextSession,readyUnscheduledOrders,attentionQueue,
    summary:{total:todaySessions.length,completed:count('completed'),shooting:count('shooting'),blocked:count('blocked'),
      pending:todaySessions.filter(session => session.status === 'confirmed' && ['notStarted','scheduled'].includes(session.runStatus)).length,
      attention:attentionQueue.length,readyUnscheduled:readyUnscheduledOrders.length,latestExpectedEnd:ends.at(-1) || null,
      gapToNextMinutes:currentSession && nextSession ? Math.round((Date.parse(nextSession.plannedStart)
        - Date.parse(currentSession.confirmedForecast?.estimatedEnd || currentSession.plannedEnd))/MINUTE) : null}};
}
