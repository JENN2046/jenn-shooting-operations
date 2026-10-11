import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {coreFixture} from './greenfield-core-fixture.mjs';
const types=[['静物','产品3D主图'],['静物','细节图'],['静物','功能图'],['模特','模特'],['场景','场景']];
const time=t=>`2026-10-12T${t}:00.000Z`;
export async function launch(){
 const f=await coreFixture({initialized:false,schemaVersion:12,identities:[{token:'a'.repeat(40),subjectId:'Jenn',role:'administrator',resourceIds:['JSO-BIZ-RESOURCE-001']},{token:'b'.repeat(40),subjectId:'other',role:'administrator',resourceIds:['OTHER']},{token:'c'.repeat(40),subjectId:'scheduler',role:'scheduler',resourceIds:['JSO-BIZ-RESOURCE-001']}]});let server;
 try {
  assert.throws(()=>f.server(),/INITIALIZATION_REQUIRED/);assert.equal(f.initialize().ok,true);
  f.record.baseline.sha256=f.m.digest(readFileSync(f.filename));f.install();const prepared=f.server();assert.equal(prepared.store.readOnly,true);prepared.store.close();
  f.activate();server=f.server('enabled');
  const {createHttpApp}=await import(pathToFileURL(join(f.app,'src/http-app.mjs')));
  const {createSchedulingV2Application}=await import(pathToFileURL(join(f.app,'src/server.mjs')));
  const {createBusinessRuntimeOptionsFromEnv}=await import(pathToFileURL(join(f.app,'src/business-runtime-auth-v1.mjs')));
  let at=time('00:00');
  const scheduling=createSchedulingV2Application({store:server.store,authenticate:createBusinessRuntimeOptionsFromEnv(process.env).schedulingAuthenticate,clock:()=>new Date(at)});
  const app=createHttpApp({store:server.store,scheduling});
  async function call(path,body,token='a'.repeat(40)){
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=body?'POST':'GET';req.headers={authorization:'Bearer '+token};let status,result;
   await app(req,{setHeader(){},writeHead(s){status=s;},end(b){result=JSON.parse(b);}});return {status,body:result};
  }
  const ok=async(path,body)=>{const r=await call(path,body);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const state=()=>ok('/api/v3/business/state');
  const initial=await state();const resourceId=initial.initialResource.resourceId;
  await ok('/api/v3/business/resources',{operationId:'REG',expectedScheduleRevision:0,expectedProjectionRevision:0,resource:initial.initialResource});
  const config=initial.initialConfig;assert.equal(config.schemaVersion,3);config.resourceCalendars[0].rules[0].effectiveFrom='2026-10-12';
  const preview=await ok('/api/v3/business/config/preview',{configJson:config,expectedProjectionRevision:1,baseConfigDigest:null});
  await ok('/api/v3/business/config/publish',{operationId:'PUBLISH-V3',configVersion:'SYNTHETIC-V3',algorithmVersion:'deterministic-scheduler-v2',calendarCompilerVersion:'calendar-compiler-v3',estimatePolicyVersion:'estimate-policy-v1',configJson:preview.configJson,configDigest:preview.configDigest});
  await ok('/api/v3/business/config/activate',{operationId:'ACTIVATE-V3',configVersion:'SYNTHETIC-V3',expectedProjectionRevision:1});
  return {...f,server,call,ok,state,resourceId,setTime:v=>at=v,close(){if(server.store.db.isOpen)server.store.close();f.close();}};
 }catch(e){server?.store.close();f.close();throw e;}
}
const submission=(i)=>({schemaVersion:3,operationId:`SYNTHETIC-ORDER-${i}`,productionType:'平面',sku:`SYNTHETIC-${i}`,name:types[i][1],kind:types[i][0],shootingSubtype:types[i][1],aspectRatio:'待定',deliverables:{type:'flat',count:1},requestedBy:'Synthetic requester',desiredDate:'2026-10-12',note:'',coreBriefSummary:types[i][1],sampleStatus:'arrivedVerified',lightingPreset:'SYNTHETIC-SOFT',reflectivity:'unknown',priority:'p1',uploadIds:[]});
export {submission};

export async function createOrder(f,i=0,overrides={}) {
 const r=(await f.state()).revisions;
 const command={submission:{...submission(i),...overrides},expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision};
 return {command,result:await f.ok('/api/v3/business/requests',command)};
}
export async function scheduleOrders(f,count=2){
 for(let i=0;i<count;i++){const {result}=await createOrder(f,i);const r=(await f.state()).revisions;await f.ok(`/api/v3/business/requests/${result.requestId}/duration`,{operationId:`DURATION-${i}`,requestId:result.requestId,expectedScheduleRevision:r.scheduleRevision,expectedProjectionRevision:r.projectionRevision,durationMinutes:30});}
 const g=await f.ok('/api/v3/business/proposals',{operationId:'GENERATE-TEST',planningWindowStart:time('00:00'),planningWindowEnd:'2026-10-12T16:00:00.000Z',resourceScope:[f.resourceId]});
 const p=g.proposal,items=JSON.parse(p.proposedItemsJson);
 if(items.length)await f.ok(`/api/v3/proposals/${p.proposalId}/decisions`,{decisionId:'ACCEPT-TEST',proposalId:p.proposalId,decisionType:'accept',selectedProposalItemIds:items.map(i=>i.proposalItemId),decisionNote:null,reasonCode:null});
 return (await f.state()).sessions;
}
