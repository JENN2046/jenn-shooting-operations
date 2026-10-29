import {createHash} from 'node:crypto';
import {createSchedulingV2Application} from './server.mjs';
import {createJsoAgentApplication,createJsoAgentHttpHandler,agentCommandDigest} from './jso-agent-api-v1.mjs';
import {createSqliteAgentGrantAttemptStoreV1} from './sqlite-agent-grant-attempt-store-v1.mjs';
import {validateTrustedPrincipal,authorizeCapability} from './authorization-v2.mjs';
import {normalizeScheduleRescheduleCommandV1} from './sqlite-schedule-reschedule-store-v1.mjs';
import {validateConversationAdoption} from './conversation-adoption-v1.mjs';

// Opt-in trusted composition. No credentials, listener or authority are discovered here.
// Owner capability stays in the authenticated client; the assistant only gets its own token.
export function createConversationBoundary({store,identities,ownerAuthenticate,clock=()=>new Date()}) {
  const service=createSchedulingV2Application({store,authenticate:()=>null,clock}).agentService;
  const records=new Map();
  const cancellationKey=sourceRef=>'conversation-cancel:'+createHash('sha256').update(sourceRef).digest('hex');
  const cancelled=sourceRef=>store.getOperation(cancellationKey(sourceRef),'conversation.cancel');
  const attempts=createSqliteAgentGrantAttemptStoreV1({db:store.db,now:clock});
  const application=createJsoAgentApplication({service,identities,clock,claimGrantAttempt:attempts.claim,
    resolveGrant:({subjectId,action,commandDigest})=>[...records.values()].find(r=>!r.cancelled&&r.grant.subjectId===subjectId&&r.grant.action===action&&r.grant.commandDigest===commandDigest)?.grant,
    isGrantActive:g=>!cancelled(g.approvalRef)&&records.get(g.approvalRef)?.cancelled!==true});
  const agentHandler=createJsoAgentHttpHandler(application);
  async function ownerCall(authorization,body) {
    const principal=await ownerAuthenticate({headers:{authorization}});
    if(!validateTrustedPrincipal(principal).ok||principal.role!=='administrator')return {ok:false,code:'OWNER_REQUIRED'};
    const {sourceRef,assistantSubjectId,command,cancel=false}=body??{};
    const action=Object.hasOwn(body??{},'action')?body.action:'reschedule';
    if(!['reschedule','adopt_proposal'].includes(action))return {ok:false,code:'INVALID_DELEGATION'};
    if(typeof sourceRef!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(sourceRef)
      || !identities.some(i=>i.subjectId===assistantSubjectId&&i.mode==='executor'))return {ok:false,code:'INVALID_DELEGATION'};
    const normalized=action==='reschedule'?normalizeScheduleRescheduleCommandV1(command):validateConversationAdoption(command);
    if(!normalized.ok)return normalized;
    const resources=action==='reschedule'?[command.resourceId]:normalized.resourceIds;
    if(!resources.every(resourceId=>authorizeCapability({principal,capability:'modifySchedule',resourceId}).allowed))return {ok:false,code:'FORBIDDEN'};
    const identity=identities.find(i=>i.subjectId===assistantSubjectId);
    if(!resources.every(id=>identity.resourceIds.includes(id)))return {ok:false,code:'FORBIDDEN'};
    const digest=agentCommandDigest(action,command),prior=records.get(sourceRef);
    if(prior&&(prior.grant.commandDigest!==digest||prior.owner!==principal.subjectId||prior.grant.subjectId!==assistantSubjectId))return {ok:false,code:'SOURCE_REBOUND'};
    // The durable dispatch record is authoritative across boundary reconstruction.
    const attempted=store.db.prepare('SELECT command_digest,subject_id,action FROM agent_grant_attempts WHERE approval_ref=?').all(sourceRef);
    if(attempted.some(a=>a.command_digest!==digest||a.subject_id!==assistantSubjectId||a.action!==action))return {ok:false,code:'SOURCE_REBOUND'};
    const binding=createHash('sha256').update(JSON.stringify([principal.subjectId,sourceRef,assistantSubjectId,digest])).digest('hex');
    const tombstone=cancelled(sourceRef);
    if(tombstone){if(tombstone.binding!==binding)return {ok:false,code:'SOURCE_REBOUND'};return cancel?{ok:true,cancelled:true}:{ok:false,code:'CANCELLED'};}
    if(cancel){
      if(attempted.length)return {ok:false,code:'RECONCILIATION_REQUIRED'};
      // Existing operation receipts retain only the cancellation binding, for the lifetime of this DB.
      // Serialize against dispatch claims before acknowledging a durable cancellation.
      store.db.exec('BEGIN IMMEDIATE');
      try{
        const concurrent=cancelled(sourceRef);
        if(concurrent){store.db.exec('ROLLBACK');return concurrent.binding===binding?{ok:true,cancelled:true}:{ok:false,code:'SOURCE_REBOUND'};}
        if(store.db.prepare('SELECT 1 FROM agent_grant_attempts WHERE approval_ref=? AND subject_id=?').get(sourceRef,assistantSubjectId)){store.db.exec('ROLLBACK');return {ok:false,code:'RECONCILIATION_REQUIRED'};}
        const saved=store.recordOperation(cancellationKey(sourceRef),'conversation.cancel',{binding},clock().toISOString());
        if(!saved?.ok){store.db.exec('ROLLBACK');return saved;}
        store.db.exec('COMMIT');
      }catch(error){store.db.exec('ROLLBACK');throw error;}
      if(prior)prior.cancelled=true;
      else records.set(sourceRef,{owner:principal.subjectId,cancelled:true,grant:{approvalRef:sourceRef,subjectId:assistantSubjectId,commandDigest:digest}});
      return {ok:true,cancelled:true};
    }
    if(prior?.cancelled)return {ok:false,code:'CANCELLED'};
    if(attempted.length)return {ok:false,code:'RECONCILIATION_REQUIRED'};
    const grant=prior?.grant??{approvalRef:sourceRef,subjectId:assistantSubjectId,action,commandDigest:digest,
      notBefore:clock().toISOString(),expiresAt:new Date(clock().getTime()+300000).toISOString()};
    records.set(sourceRef,{owner:principal.subjectId,grant,cancelled:false});
    return {ok:true,operationId:action==='reschedule'?command.operationId:normalized.operationId,commandDigest:digest};
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
