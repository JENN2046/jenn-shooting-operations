import {buildSchedulingProposalGenerationCommandV1} from './scheduling-proposal-contract-v1.mjs';
import {isSchedulingIdentifierV1} from './scheduling-contract-v1.mjs';

// Admission shape only. The canonical proposal store still verifies the preview,
// complete selection, current revisions and business constraints in its transaction.
export function validateConversationAdoption(command) {
  const invalid = () => ({ok:false,code:'INVALID_PREVIEW_ADOPTION'});
  const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === keys.sort().join(',');
  if (!exact(command,['generationCommand','expectedPreview','decision'])) return invalid();
  const generation = buildSchedulingProposalGenerationCommandV1(command.generationCommand);
  if (!generation.ok) return generation;
  const p = command.expectedPreview, d = command.decision;
  if (!exact(p,['baseScheduleRevision','configDigest','configVersion','inputDigest','resultDigest'])
    || !Number.isSafeInteger(p.baseScheduleRevision) || p.baseScheduleRevision < 0
    || !isSchedulingIdentifierV1(p.configVersion)
    || !['inputDigest','resultDigest','configDigest'].every(k => /^sha256:[a-f0-9]{64}$/.test(p[k]))) return invalid();
  if (!exact(d,['decisionId','proposalId','decisionType','selectedProposalItemIds','decisionNote','reasonCode'])
    || !isSchedulingIdentifierV1(d.decisionId) || !isSchedulingIdentifierV1(d.proposalId)
    || d.decisionType !== 'accept' || d.reasonCode !== null
    || !(d.decisionNote === null || typeof d.decisionNote === 'string' && [...d.decisionNote].length <= 1000
      && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(d.decisionNote))
    || !Array.isArray(d.selectedProposalItemIds) || !d.selectedProposalItemIds.length
    || new Set(d.selectedProposalItemIds).size !== d.selectedProposalItemIds.length
    || !d.selectedProposalItemIds.every(id => /^spi_[a-f0-9]{64}$/.test(id))) return invalid();
  return {ok:true,resourceIds:generation.command.resourceScope,operationId:d.decisionId};
}
