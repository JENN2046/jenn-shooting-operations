import {validateTrustedPrincipal,authorizeCapability} from './authorization-v2.mjs';
import {normalizeScheduleRescheduleCommandV1} from './sqlite-schedule-reschedule-store-v1.mjs';
import {agentCommandDigest} from './jso-agent-api-v1.mjs';

// Trusted Owner-side composition helper, never a model tool or public route.
// The host must authenticate the human independently; confirmation binds the reviewed digest.
export function confirmAgentReschedule({principal,ownerSubjectId,assistantSubjectId,proposal,
  confirmedDigest,approvalRef,notBefore,expiresAt}) {
  if (!validateTrustedPrincipal(principal).ok || principal.role !== 'administrator'
    || principal.subjectId !== ownerSubjectId || principal.subjectId === assistantSubjectId
    || !authorizeCapability({principal,resourceId:proposal?.command?.resourceId,capability:'administer'}).allowed) {
    return {ok:false,code:'OWNER_CONFIRMATION_REQUIRED'};
  }
  if (!normalizeScheduleRescheduleCommandV1(proposal?.command).ok
    || !proposal?.ok || proposal.requiresOwnerConfirmation !== true
    || confirmedDigest !== proposal.commandDigest
    || confirmedDigest !== agentCommandDigest('reschedule',proposal.command)) return {ok:false,code:'REVIEWED_COMMAND_CHANGED'};
  if (typeof assistantSubjectId !== 'string' || !assistantSubjectId.trim()
    || typeof approvalRef !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(approvalRef)
    || typeof notBefore !== 'string' || typeof expiresAt !== 'string'
    || !/(?:Z|[+-]\d\d:\d\d)$/.test(notBefore) || !/(?:Z|[+-]\d\d:\d\d)$/.test(expiresAt)
    || !Number.isFinite(Date.parse(notBefore)) || !Number.isFinite(Date.parse(expiresAt))
    || Date.parse(expiresAt) <= Date.parse(notBefore) || Date.parse(expiresAt)-Date.parse(notBefore)>300000) return {ok:false,code:'INVALID_CONFIRMATION'};
  return {ok:true,grant:{approvalRef,subjectId:assistantSubjectId,action:'reschedule',commandDigest:confirmedDigest,notBefore,expiresAt}};
}
