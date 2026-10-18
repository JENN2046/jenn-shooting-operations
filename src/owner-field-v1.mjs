import {encodeOwnerFieldBindingV1} from '../public/kiosk-queue-protocol-v3.js';
import {createOwnerDeviceRunV1} from './business-run-v3.mjs';
import {readFieldDay} from './field-day-v3.mjs';
import {requireBrowserSessionRuntime} from './browser-session-v1.mjs';
export function createOwnerFieldV1({store,runtime,clock=()=>new Date()}){
 requireBrowserSessionRuntime(runtime);
 const {db,writeAdmissionControl}=store,record=createOwnerDeviceRunV1({db,now:clock,writeAdmission:()=>!writeAdmissionControl.isDisabled()});
 return {
  authenticate:req=>runtime.fieldIdentity(req),
  binding(identity,req){return req.headers['x-jso-field-binding']===encodeOwnerFieldBindingV1({subjectId:identity.principal.subjectId,deviceId:identity.deviceId,resourceId:identity.resourceId});},
  identity(identity){return {ok:true,protocolVersion:4,subjectId:identity.principal.subjectId,role:'administrator',deviceId:identity.deviceId,resourceId:identity.resourceId};},
  day(identity){return readFieldDay({db,identity,clock,writeAdmissionControl,protocolVersion:4});},
  record(identity,command){return record({command,...identity});},
  receipt(identity,eventId){const row=db.prepare('SELECT kind,response_json FROM operations WHERE operation_id=?').get('owner-device:'+eventId);if(!row)return {ok:false,code:'EVENT_NOT_FOUND'};if(row.kind!=='business.owner-device.run.v1')return {ok:false,code:'FORBIDDEN'};const r=JSON.parse(row.response_json);if(r.actor!==identity.principal.subjectId||r.deviceId!==identity.deviceId||r.resourceId!==identity.resourceId)return {ok:false,code:'FORBIDDEN'};return {...r,replayed:true};},
 };
}
