// Display view only: retain the native V3 order/session facts; no legacy protocol conversion.
export function beijingParts(instant){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function actualSessionState(session){
 if(session.status==='cancelled')return 'cancelled';
 const runs=session.runs||[];if(runs.some(r=>r.status==='shooting'))return 'live';if(runs.some(r=>r.status==='blocked'))return 'blocked';
 if(runs.length&&runs.every(r=>r.status==='completed'))return 'completed';return 'scheduled';
}
export function boardView(state){
 return {protocolVersion:3,revision:state.revisions.projectionRevision,
  tasks:state.orderFacts.map(r=>{const sessions=state.sessions.filter(s=>s.requestIds.includes(r.id));const states=sessions.map(actualSessionState);const status=r.lifecycle==='cancelled'?'cancelled':states.includes('live')?'live':states.includes('blocked')?'blocked':states.length&&states.every(s=>s==='completed')?'completed':states.length?'scheduled':'pending';return {...r,sku:r.submission.sku,deliver:r.submission.coreBriefSummary,status,request:{...r.submission,deliverableCount:r.submission.deliverables.count}};}),
  sessions:state.sessions.map(s=>({...s,date:beijingParts(s.plannedStart).date,start:beijingParts(s.plannedStart).time,end:beijingParts(s.plannedEnd).time,ids:s.requestIds,place:'Jenn',actualState:actualSessionState(s)}))};
}
