// V3 wire contract only. Persistence and replay remain in the existing Kiosk queue.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(v);
// Equivalent to scheduling-contract-v1.isSchedulingIdentifierV1 for resource references.
// Keep device, operator, event and run identifiers on their existing strict contract.
export const validKioskResourceIdV3=v=>typeof v==='string'&&v.length>0&&v===v.trim()
 &&[...v].length<=160&&/\S/u.test(v)&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(v)
 &&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>{try{return new Date(v).toISOString()===v;}catch{return false;}};
const fields=['schemaVersion','eventId','runId','scheduleItemId','eventType','expectedRunRevision','expectedScheduleRevision','occurredAt','recordingMode','subjectId','deviceId','resourceId','localSequence'];
const commandFields=['eventId','runId','scheduleItemId','eventType','expectedRunRevision','expectedScheduleRevision'];
export function kioskCommandV3(item){
 const command=Object.fromEntries(commandFields.map(k=>[k,item[k]]));
 if(item.recordingMode==='device-declared')Object.assign(command,{recordingMode:item.recordingMode,occurredAt:item.occurredAt});
 return command;
}
export function validateKioskQueueItemV3(v){
 const valid=v&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))
 &&v.schemaVersion===3&&['eventId','runId','scheduleItemId','subjectId','deviceId'].every(k=>id(v[k]))
 &&validKioskResourceIdV3(v.resourceId)
 &&['expectedRunRevision','expectedScheduleRevision','localSequence'].every(k=>revision(v[k]))
 &&['start','complete'].includes(v.eventType)&&['device-declared','server-received'].includes(v.recordingMode)&&time(v.occurredAt);
 return valid?{ok:true,item:structuredClone(v)}:{ok:false,code:'INVALID_QUEUE_ITEM'};
}
export function validKioskDayV3(v,resourceId){
 return v?.ok===true&&v.protocolVersion===3&&v.resourceId===resourceId&&validKioskResourceIdV3(v.resourceId)&&id(v.subjectId)&&id(v.deviceId)
 &&time(v.serverTime)&&revision(v.revisions?.scheduleRevision)&&revision(v.revisions?.projectionRevision)&&Array.isArray(v.sessions);
}
export function matchesKioskReceiptV3(r,item){
 if(r?.ok!==true||(r.replayed!==undefined&&typeof r.replayed!=='boolean')||r.code!=='RUN_EVENT_APPLIED'||r.eventId!==item.eventId||r.runId!==item.runId
 ||r.actor!==item.subjectId||r.deviceId!==item.deviceId||r.resourceId!==item.resourceId
 ||r.scheduleRevision!==item.expectedScheduleRevision||r.runRevision!==item.expectedRunRevision+1
 ||r.resultingState!==(item.eventType==='start'?'shooting':'completed'))return false;
 if(item.recordingMode==='server-received')return r.source==='kiosk-online-v3';
 const command=kioskCommandV3(item);
 return r.source==='kiosk-device-declared-v3'&&r.timeSource==='device-declared'&&time(r.recordedAt)
 &&r.command&&Object.keys(r.command).length===Object.keys(command).length&&Object.keys(command).every(k=>r.command[k]===command[k])
 &&(item.eventType==='start'?r.startedAt:r.completedAt)===item.occurredAt;
}
export function validKioskResultV3(v){
 return v?.ok===false&&typeof v.code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(v.code)
 ||v?.ok===true&&v.code==='RUN_EVENT_APPLIED';
}
export function createKioskTransportV3({fetchImpl,binding,getToken,isCurrent=()=>true,onReceipt=()=>{}}){
 const call=async(path,body)=>{
  if(!isCurrent())throw Error('KIOSK_CONTEXT_CHANGED');
  const response=await fetchImpl('/api/v3/kiosk/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+getToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(12000)});
  const bodyResult=await response.json();if(!isCurrent())throw Error('KIOSK_CONTEXT_CHANGED');
  return {status:response.status,body:bodyResult};
 };
 return {
  async refreshCurrent(){
   const r=await call('day');
   if(r.status===200&&(!validKioskDayV3(r.body,binding.resourceId)||r.body.subjectId!==binding.subjectId||r.body.deviceId!==binding.deviceId))throw Error('KIOSK_BINDING_CHANGED');
   if(r.status===200)r.body={...r.body,projectionRevision:r.body.revisions.projectionRevision};
   return r;
  },
  async submitEvent(item){
   if(!validateKioskQueueItemV3(item).ok||['subjectId','deviceId','resourceId'].some(k=>item[k]!==binding[k]))throw Error('KIOSK_BINDING_CHANGED');
   let r=await call('events/'+encodeURIComponent(item.eventId));
   if(r.status===404&&r.body?.code==='EVENT_NOT_FOUND'){
    // Older server-timed commands may still be in flight. Never convert or
    // automatically re-submit them at a later, different occurrence time.
    if(item.recordingMode==='server-received')return {status:409,body:{ok:false,code:'LEGACY_ONLINE_EVENT_REVIEW_REQUIRED'}};
    r=await call('events',kioskCommandV3(item));
   }
   if(r.body?.ok===true&&!matchesKioskReceiptV3(r.body,item))return {status:409,body:{ok:false,code:'IDEMPOTENCY_KEY_REUSE'}};
   if(r.body?.ok===true)onReceipt(r.body,item);
   return r;
  }
 };
}
