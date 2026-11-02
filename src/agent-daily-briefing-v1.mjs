import {readSchedulingBoardFacts} from './scheduling-board-read-model.mjs';
import {projectDailyOperations} from './daily-operations-v1.mjs';
import {projectDailyBriefing} from './daily-briefing-v1.mjs';

// The trusted caller has already checked schedule/request scope and owns the
// consistent read transaction. This helper does not begin a transaction, confer
// authority, impersonate a management user or acquire private order details.
export function readAgentDailyBriefingV1({db,state,resourceScope,configRow,config,observedAt}) {
  const {sessions:scopedSessions}=readSchedulingBoardFacts({
    db,resourceIds:resourceScope,orderRows:[],includeSessionDetails:false,
  });
  const orderFacts=(state.orders || []).map(order=>({
    id:order.id,name:order.name,kind:order.kind,shootingSubtype:order.shootingSubtype,
    lifecycle:order.lifecycle,sampleStatus:order.sampleStatus,priority:order.priority,
    desiredDate:order.desiredDate,references:[],
    submission:{productionType:null,name:order.name,kind:order.kind,
      shootingSubtype:order.shootingSubtype,sampleStatus:order.sampleStatus,
      priority:order.priority,desiredDate:order.desiredDate},
  }));
  // Do not propagate note, joined requestNames, clients, attachments or any
  // incidental fields returned by a richer future shared read model.
  const sessions=scopedSessions.map(session=>({
    id:session.id,resourceId:session.resourceId,plannedStart:session.plannedStart,
    plannedEnd:session.plannedEnd,bufferAfterMinutes:session.bufferAfterMinutes,
    status:session.status,resourceResolutionStatus:session.resourceResolutionStatus,
    requestIds:session.requestIds,
    runs:session.runs.map(run=>({id:run.id,status:run.status,runRevision:run.runRevision,
      startedAt:run.startedAt,completedAt:run.completedAt})),
    confirmedForecast:session.confirmedForecast ? {
      estimatedEnd:session.confirmedForecast.estimatedEnd,
      bufferAfterMinutes:session.confirmedForecast.bufferAfterMinutes,
      operationId:session.confirmedForecast.operationId,
    } : null,
  }));
  const facts={sessions,orderFacts,requests:[],revisions:state.revisions,
    writeAdmission:state.writeAdmission,
    configs:configRow && config ? [{active:true,configJson:config,
      configDigest:configRow.config_digest,
      calendarCompilerVersion:configRow.calendar_compiler_version}] : [],
  };
  const daily=projectDailyOperations(facts,{now:observedAt});
  // Estimates and potentially catalogue-wide orders are intentionally outside
  // this projection. Withheld evidence is not proof of missing duration, a ready
  // order, an empty queue or a complete absence of blockers.
  delete daily.readyUnscheduledOrders;
  daily.attentionQueue=daily.attentionQueue.filter(item=>
    !['DURATION_MISSING','UNSCHEDULED_READY'].includes(item.code));
  const briefing=projectDailyBriefing(daily);
  if(!briefing.ok)return briefing;
  briefing.sections.readyOrders={state:'unknown',items:[],
    message:'当前 Agent 只读范围未提供订单时长估算，且不保证包含完整订单目录，不能判断可排未排订单。'};
  briefing.sections.attention={...briefing.sections.attention,state:'unknown',
    message:'仅展示当前授权范围内可核实的待处理事项；订单估算与目录覆盖不完整，不能据此判断没有其他阻塞。'};
  briefing.issues=briefing.issues.filter(issue=>
    !(issue.section==='readyOrders' && issue.code==='READY_ORDERS_MISSING'));
  briefing.issues.push({code:'ORDER_ESTIMATES_NOT_EXPOSED',section:'metadata',
    message:'订单时长估算未向此 Agent 简报暴露，订单目录也可能仅覆盖已授权部分；可排未排与待处理均为部分视图。'});
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  briefing.issues.sort((a,b)=>cmp(a.section,b.section)||cmp(a.code,b.code)||cmp(a.entityId || '',b.entityId || ''));
  briefing.dataQuality='needs_review';
  return briefing;
}
