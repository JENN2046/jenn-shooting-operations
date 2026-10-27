import assert from 'node:assert/strict';
import {launch,createOrder,scheduleOrders} from './first-launch-v3-fixture.mjs';
export const studioNow='2026-10-12T02:00:00.000Z';
export const databaseFacts = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

export async function studioDayFixture(){
 const f=await launch();
 try {
  const sessions=await scheduleOrders(f,5),[completed,current,next,later,past]=sessions;
  f.setTime(completed.plannedStart);await f.ok('/api/v3/business/run-events',{eventId:'STUDIO-START-1',runId:'STUDIO-RUN-1',scheduleItemId:completed.id,eventType:'start',expectedRunRevision:0});
  f.setTime(completed.plannedEnd);await f.ok('/api/v3/business/run-events',{eventId:'STUDIO-COMPLETE-1',runId:'STUDIO-RUN-1',scheduleItemId:completed.id,eventType:'complete',expectedRunRevision:1});
  f.setTime(current.plannedStart);await f.ok('/api/v3/business/run-events',{eventId:'STUDIO-START-2',runId:'STUDIO-RUN-2',scheduleItemId:current.id,eventType:'start',expectedRunRevision:0});
  const input={scheduleItemId:current.id,resourceId:f.resourceId,mode:'forecast',plannedStart:null,
   endAt:new Date(Date.parse(current.plannedEnd)+5*60000).toISOString(),bufferAfterMinutes:20};
  const preview=await f.ok('/api/v3/business/day-adjustment/preview',input);assert.equal(preview.preview.canApply,true);
  await f.ok('/api/v3/business/day-adjustment/apply',{operationId:'STUDIO-FORECAST',input,previewDigest:preview.previewDigest});
  // Explicit synthetic legacy anomaly: an old confirmed plan with no run fact.
  // Four healthy reservations remain today; the one active run has a real confirmed forecast.
  f.server.store.db.prepare('UPDATE schedule_items SET planned_start=?,planned_end=? WHERE id=?')
   .run('2026-10-11T01:00:00.000Z','2026-10-11T01:30:00.000Z',past.id);
  const extras={};
  for(const [key,sample,duration]of [['readyOne','arrivedVerified',25],['readyTwo','arrivedVerified',45],['sample','inTransit',30],['missing','arrivedVerified',null]]){
   const {result}=await createOrder(f,0,{operationId:'STUDIO-'+key,sku:'STUDIO-'+key,name:key,sampleStatus:sample,desiredDate:'2026-10-12'});
   extras[key]=result.requestId;
   if(duration!==null){const r=(await f.state()).revisions;await f.ok(`/api/v3/business/requests/${result.requestId}/duration`,{operationId:'STUDIO-DURATION-'+key,requestId:result.requestId,expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision,durationMinutes:duration});}
  }
  f.setTime(studioNow);
  return {...f,completed,current,next,later,past,extras};
 }catch(error){f.close();throw error;}
}
