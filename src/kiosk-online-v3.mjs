import {readFieldDay} from './field-day-v3.mjs';
import {requireKioskOnlineRuntimeV3} from './kiosk-online-runtime-v3.mjs';
import {createKioskRunV3} from './business-run-v3.mjs';
export function createKioskOnlineV3({store,runtime,clock=()=>new Date()}){
 requireKioskOnlineRuntimeV3(runtime);
 const db=store.db,writeAdmissionControl=store.writeAdmissionControl;
 const record=createKioskRunV3({db,now:clock,writeAdmission:()=>!writeAdmissionControl.isDisabled()});
 return Object.freeze({version:3,writeAdmissionControl,authenticate:runtime.authenticate,
  identity(identity){return {ok:true,protocolVersion:3,subjectId:identity.principal.subjectId,role:'operator',deviceId:identity.deviceId,resourceId:identity.resourceId};},
  day(identity){
   return readFieldDay({db,identity,clock,writeAdmissionControl});
  },
  record(identity,command){return record({command,...identity});},
  receipt(identity,eventId){
   const row=db.prepare('SELECT kind,response_json FROM operations WHERE operation_id=?').get(`kiosk-online:${eventId}`);
   if(!row)return {ok:false,code:'EVENT_NOT_FOUND'};
   if(row.kind!=='kiosk.online.run.v3')return {ok:false,code:'FORBIDDEN'};
   const receipt=JSON.parse(row.response_json);
   if(receipt.actor!==identity.principal.subjectId||receipt.deviceId!==identity.deviceId||receipt.resourceId!==identity.resourceId)return {ok:false,code:'FORBIDDEN'};
   return {...receipt,replayed:true};
  }
 });
}
