import {Readable} from 'node:stream';
import {createHttpApp} from '../../src/http-app.mjs';
import {createKioskOnlineV3} from '../../src/kiosk-online-v3.mjs';
import {createKioskOnlineRuntimeV3} from '../../src/kiosk-online-runtime-v3.mjs';
import {launch,scheduleOrders} from './first-launch-v3-fixture.mjs';
export const token='KIOSK-OFFLINE-SYNTHETIC-NOT-PRODUCTION-001';
export const binding={subjectId:'OPERATOR-OFFLINE-001',deviceId:'DEVICE-OFFLINE-001',resourceId:'JSO-BIZ-RESOURCE-001'};
export const identities=[{token,...binding},{token:'OTHER-OFFLINE-SYNTHETIC-NOT-PRODUCTION-001',subjectId:'OTHER-OPERATOR-001',deviceId:'OTHER-DEVICE-001',resourceId:binding.resourceId}];
export async function offlineFixture(){
 const f=await launch({kioskIdentities:identities});await scheduleOrders(f,2);let at='2026-10-12T03:00:00.000Z',revoked=false;
 const runtime=createKioskOnlineRuntimeV3({identities}),online=createKioskOnlineV3({store:f.server.store,runtime,clock:()=>new Date(at)});
 const app=createHttpApp({store:f.server.store,kioskOnline:{...online,authenticate:r=>revoked?null:online.authenticate(r)}});
 const call=async(path,body,auth=token)=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=body===undefined?'GET':'POST';req.url=path;req.headers={authorization:'Bearer '+auth};let status,data;
  await app(req,{setHeader(){},writeHead:s=>status=s,end:b=>data=JSON.parse(b)});return {status,body:data};
 };
 const day=(await call('/api/v3/kiosk/day')).body,s=day.sessions[0];
 const item=(eventType='start',extra={})=>({schemaVersion:3,eventId:eventType==='start'?'OFFLINE-START-001':'OFFLINE-COMPLETE-001',runId:'OFFLINE-RUN-001',scheduleItemId:s.id,eventType,expectedRunRevision:eventType==='start'?0:1,expectedScheduleRevision:day.revisions.scheduleRevision,occurredAt:eventType==='start'?'2026-10-12T01:00:00.000Z':'2026-10-12T01:30:00.000Z',recordingMode:'device-declared',...binding,localSequence:eventType==='start'?0:1,...extra});
 return {...f,callKiosk:call,item,day,setReceivedAt:v=>at=v,revoke:()=>revoked=true,count:()=>f.server.store.db.prepare('SELECT count(*) n FROM production_events').get().n};
}
export function browserStorage(){
 const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),values};
}
