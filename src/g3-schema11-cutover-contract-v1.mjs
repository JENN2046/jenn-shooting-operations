import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { digestCanonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

const fail = code => Object.freeze({ ok: false, code });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function trustedBooleanCall(verifier, value) {
  try { return verifier(value) === true; }
  catch { return false; }
}

export function digestG3AuthorityTargetV1(authorityTarget) {
  return digestCanonicalJsonSchedulingV1({
    domain: 'g3-schema11-authority-target-v1',
    authorityTarget,
  });
}

export function createG3Schema11CutoverContractV1({
  packetSchema,
  receiptSchema,
  verifyApproval,
  verifyAuthorityTargetEvidence,
  verifyTerminalEvidence,
  claimExecutionAttempt,
  verifyExecutionAttemptStarted,
} = {}) {
  if (!packetSchema || !receiptSchema
    || typeof verifyApproval !== 'function'
    || typeof verifyAuthorityTargetEvidence !== 'function'
    || typeof verifyTerminalEvidence !== 'function'
    || typeof claimExecutionAttempt !== 'function'
    || typeof verifyExecutionAttemptStarted !== 'function') {
    throw new TypeError('packet/receipt schemas and trusted G3 authority/attempt/evidence boundaries required');
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validatePacketSchema = ajv.compile(packetSchema);
  const validateReceiptSchema = ajv.compile(receiptSchema);

  function verifyApprovedPacket(packet) {
    if (!validatePacketSchema(packet)) return fail('G3_PACKET_SCHEMA_INVALID');

    let computed;
    try { computed = digestG3AuthorityTargetV1(packet.authorityTarget); }
    catch { return fail('G3_AUTHORITY_TARGET_INVALID'); }
    if (packet.authorityTargetDigest !== computed) return fail('G3_AUTHORITY_TARGET_DIGEST_MISMATCH');

    const authorityEvidence = frozenClone({
      authorityTargetDigest: computed,
      authorityTarget: packet.authorityTarget,
    });
    if (!trustedBooleanCall(verifyAuthorityTargetEvidence, authorityEvidence)) {
      return fail('G3_AUTHORITY_TARGET_EVIDENCE_NOT_VERIFIED');
    }

    if (packet.authorization.status !== 'APPROVED'
      || packet.authorization.approvedAuthorityTargetDigest !== computed) {
      return fail('G3_APPROVAL_TARGET_MISMATCH');
    }
    const approval = frozenClone({
      approvalRef: packet.authorization.approvalRef,
      approvedAuthorityTargetDigest: computed,
      approvalEvidenceDigest: packet.authorization.approvalEvidenceDigest,
    });
    if (!trustedBooleanCall(verifyApproval, approval)) {
      return fail('G3_APPROVAL_EVIDENCE_NOT_VERIFIED');
    }

    return Object.freeze({ ok: true, authorityTargetDigest: computed });
  }

  function attemptIdentity(packet, authorityTargetDigest) {
    const operationId = packet.authorityTarget.execution.operationId;
    const replayKey = digestCanonicalJsonSchedulingV1({
      domain: 'g3-schema11-execution-attempt-v1',
      operationId,
      authorityTargetDigest,
    });
    return frozenClone({
      replayKey,
      packetId: packet.packetId,
      operationId,
      authorityTargetDigest,
    });
  }

  function admitExecutablePacket(packet) {
    const admitted = verifyApprovedPacket(packet);
    if (!admitted.ok) return admitted;

    const attempt = attemptIdentity(packet, admitted.authorityTargetDigest);
    let claim;
    try { claim = claimExecutionAttempt(attempt); }
    catch { return fail('G3_EXECUTION_ATTEMPT_CLAIM_UNAVAILABLE'); }

    if (claim?.ok === true) {
      return Object.freeze({
        ok: true,
        authorityTargetDigest: admitted.authorityTargetDigest,
      });
    }
    if (claim?.ok === false && claim.code === 'ATTEMPT_ALREADY_STARTED') {
      return fail('G3_EXECUTION_ATTEMPT_ALREADY_STARTED');
    }
    return fail('G3_EXECUTION_ATTEMPT_CLAIM_UNAVAILABLE');
  }

  function validateTerminalReceipt(packet, receipt) {
    const admitted = verifyApprovedPacket(packet);
    if (!admitted.ok) return admitted;
    if (!validateReceiptSchema(receipt)) return fail('G3_RECEIPT_SCHEMA_INVALID');

    if (receipt.packetId !== packet.packetId
      || receipt.operationId !== packet.authorityTarget.execution.operationId
      || receipt.authorityTargetDigest !== admitted.authorityTargetDigest) {
      return fail('G3_RECEIPT_BINDING_MISMATCH');
    }

    const attempt = attemptIdentity(packet, admitted.authorityTargetDigest);
    let attemptStarted = false;
    try { attemptStarted = verifyExecutionAttemptStarted(attempt) === true; }
    catch { return fail('G3_EXECUTION_ATTEMPT_LEDGER_UNAVAILABLE'); }
    if (!attemptStarted) return fail('G3_EXECUTION_ATTEMPT_NOT_FOUND');

    if (receipt.outcome === 'ROLLED_BACK'
      && receipt.evidence.restoredPrestateDigest
        !== packet.authorityTarget.target.activeDatabaseFamilyDigest) {
      return fail('G3_ROLLBACK_PRESTATE_MISMATCH');
    }

    const terminalEvidence = frozenClone({
      packetId: receipt.packetId,
      operationId: receipt.operationId,
      authorityTargetDigest: receipt.authorityTargetDigest,
      outcome: receipt.outcome,
      evidence: receipt.evidence,
    });
    if (!trustedBooleanCall(verifyTerminalEvidence, terminalEvidence)) {
      return fail('G3_TERMINAL_EVIDENCE_NOT_VERIFIED');
    }

    return Object.freeze({ ok: true, outcome: receipt.outcome });
  }

  return Object.freeze({
    admitExecutablePacket,
    validateTerminalReceipt,
  });
}
