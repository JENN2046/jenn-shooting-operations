import {createSchedulingV2Application} from './server.mjs';
import {createJsoAgentApplication,createJsoAgentHttpHandler,agentCommandDigest} from './jso-agent-api-v1.mjs';
import {createSqliteAgentGrantAttemptStoreV1} from './sqlite-agent-grant-attempt-store-v1.mjs';
import {validateTrustedPrincipal,authorizeCapability} from './authorization-v2.mjs';
import {normalizeScheduleRescheduleCommandV1} from './sqlite-schedule-reschedule-store-v1.mjs';

// Opt-in trusted composition. No credentials, listener or authority are discovered here.
// Owner capability stays in the authenticated client; the assistant only gets its own token.
export function createConversationBoundary({store,identities,ownerAuthenticate,clock=()=>new Date()}) {
  const service=createSchedulingV2Application({store,authenticate:()=>null,clock}).agentService;
  const records=new Map();
  const attempts=createSqliteAgentGrantAttemptStoreV1({db:store.db,now:clock});
  const application=createJsoAgentApplication({service,identities,clock,claimGrantAttempt:attempts.claim,
    resolveGrant:({subjectId,action,commandDigest})=>[...records.values()].find(r=>!r.cancelled&&r.grant.subjectId===subjectId&&r.grant.action===action&&r.grant.commandDigest===commandDigest)?.grant,
    isGrantActive:g=>records.get(g.approvalRef)?.cancelled!==true});
  const agentHandler=createJsoAgentHttpHandler(application);
  async function ownerCall(authorization,body) {
    const principal=await ownerAuthenticate({headers:{authorization}});
    if(!validateTrustedPrincipal(principal).ok||principal.role!=='administrator')return {ok:false,code:'OWNER_REQUIRED'};
    const {sourceRef,assistantSubjectId,command,cancel=false}=body??{};
    if(typeof sourceRef!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(sourceRef)
      || !identities.some(i=>i.subjectId===assistantSubjectId&&i.mode==='executor'))return {ok:false,code:'INVALID_DELEGATION'};
    const normalized=normalizeScheduleRescheduleCommandV1(command);
    if(!normalized.ok)return normalized;
    if(!authorizeCapability({principal,capability:'modifySchedule',resourceId:command.resourceId}).allowed)return {ok:false,code:'FORBIDDEN'};
    const identity=identities.find(i=>i.subjectId===assistantSubjectId);
    if(!identity.resourceIds.includes(command.resourceId))return {ok:false,code:'FORBIDDEN'};
    const digest=agentCommandDigest('reschedule',command),prior=records.get(sourceRef);
    if(prior&&(prior.grant.commandDigest!==digest||prior.owner!==principal.subjectId||prior.grant.subjectId!==assistantSubjectId))return {ok:false,code:'SOURCE_REBOUND'};
    // The durable dispatch record is authoritative across boundary reconstruction.
    const attempted=store.db.prepare('SELECT command_digest FROM agent_grant_attempts WHERE approval_ref=? AND subject_id=?').all(sourceRef,assistantSubjectId);
    if(attempted.some(a=>a.command_digest!==digest))return {ok:false,code:'SOURCE_REBOUND'};
    if(cancel){
      if(attempted.length)return {ok:false,code:'RECONCILIATION_REQUIRED'};
      if(prior)prior.cancelled=true;
      else records.set(sourceRef,{owner:principal.subjectId,cancelled:true,grant:{approvalRef:sourceRef,subjectId:assistantSubjectId,commandDigest:digest}});
      return {ok:true,cancelled:true};
    }
    if(prior?.cancelled)return {ok:false,code:'CANCELLED'};
    if(attempted.length)return {ok:false,code:'RECONCILIATION_REQUIRED'};
    const grant=prior?.grant??{approvalRef:sourceRef,subjectId:assistantSubjectId,action:'reschedule',commandDigest:digest,
      notBefore:clock().toISOString(),expiresAt:new Date(clock().getTime()+300000).toISOString()};
    records.set(sourceRef,{owner:principal.subjectId,grant,cancelled:false});
    return {ok:true,operationId:command.operationId,commandDigest:digest};
  }
  async function handler(req,res){
    const send=(status,result)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));};
    try{
    if(req.url==='/api/v2/agent/owner-session'&&req.method==='GET'){
      const principal=await ownerAuthenticate(req);const ok=validateTrustedPrincipal(principal).ok&&principal.role==='administrator';
      res.writeHead(ok?200:403,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(ok?{ok:true,subjectId:principal.subjectId,role:principal.role,resourceIds:[...principal.resourceIds]}:{ok:false,code:'OWNER_REQUIRED'}));return;
    }
    if(req.url!=='/api/v2/agent/owner-delegation')return await agentHandler(req,res);
    if(req.method!=='POST')return send(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
      const chunks=[];let bytes=0;for await(const c of req){const chunk=Buffer.isBuffer(c)?c:Buffer.from(c);bytes+=chunk.length;if(bytes>32768)return send(413,{ok:false,code:'REQUEST_TOO_LARGE'});chunks.push(chunk);}
      const raw=Buffer.concat(chunks).toString('utf8');
      const result=await ownerCall(req.headers.authorization,JSON.parse(raw));send(result.code==='OWNER_REQUIRED'?403:200,result);
    }catch{send(503,{ok:false,code:'SERVICE_UNAVAILABLE'});}
  }
  return {application,handler,ownerCall};
}
