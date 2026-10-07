import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { digestCanonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';
import {
  createG3Schema11CutoverContractV1,
  digestG3AuthorityTargetV1,
} from '../src/g3-schema11-cutover-contract-v1.mjs';

const paths = {
  prep: new URL('../docs/operations/g3-schema11-cutover-exact-target.r1.json', import.meta.url),
  packet: new URL('../docs/operations/g3-schema11-cutover-approved-packet.r2.json', import.meta.url),
  approval: new URL('../docs/operations/g3-schema11-cutover-approval.r2.json', import.meta.url),
  terminal: new URL('../docs/operations/g3-schema11-terminal-verification.r1.json', import.meta.url),
  receipt: new URL('../docs/operations/g3-schema11-cutover-terminal-receipt.r1.json', import.meta.url),
  packetSchema: new URL('../contracts/g3-schema11-cutover-packet.v1.schema.json', import.meta.url),
  receiptSchema: new URL('../contracts/g3-schema11-cutover-receipt.v1.schema.json', import.meta.url),
};

const [prep, packet, approval, terminal, receipt, packetSchema, receiptSchema] =
  await Promise.all(Object.values(paths).map(async url => JSON.parse(await readFile(url, 'utf8'))));

const fail = code => {
  console.error(JSON.stringify({ status: 'G3_SCHEMA11_TERMINAL_VERIFICATION_INVALID', code }));
  process.exit(1);
};

const canonical = value => {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  throw new TypeError('unsupported canonical JSON value');
};

const approvalCore = {
  schemaVersion: approval.schemaVersion,
  approvalId: approval.approvalId,
  approvalSource: approval.approvalSource,
  approvalRef: approval.approvalRef,
  approvedActionId: approval.approvedActionId,
  approvedAuthorityTargetDigest: approval.approvedAuthorityTargetDigest,
  authorizationReceivedBeforeExecution: approval.authorizationReceivedBeforeExecution,
  schema11CutoverAuthorized: approval.schema11CutoverAuthorized,
  normalWriterReadmissionAuthorized: approval.normalWriterReadmissionAuthorized,
  signatureAlgorithm: approval.signatureAlgorithm,
  signingKeyId: approval.signingKeyId,
};
const approvalPayload = Buffer.from(canonical({
  domain: 'g3-schema11-human-approval-v1',
  approval: approvalCore,
}), 'utf8');
const approvalEvidenceDigest = 'sha256:' + createHash('sha256').update(approvalPayload).digest('hex');

const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAO6+9DSKWYrwyEC20zFe1GPdeTEYggybpXBrxDib5Koo=
-----END PUBLIC KEY-----
`);
const signatureTrusted = (() => {
  try {
    return verifySignature(null, approvalPayload, publicKey,
      Buffer.from(approval.signatureBase64, 'base64'));
  } catch {
    return false;
  }
})();

const schemaVerificationDigest = digestCanonicalJsonSchedulingV1({
  domain: 'g3-schema11-terminal-schema-verification-v1',
  schemaVerificationEvidence: terminal.schemaVerificationEvidence,
});
const postStateDigest = digestCanonicalJsonSchedulingV1({
  domain: 'g3-schema11-terminal-post-state-v1',
  postStateEvidence: terminal.postStateEvidence,
});

if (prep.authorityTargetDigest !== 'sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5'
  || digestG3AuthorityTargetV1(prep.authorityTarget) !== prep.authorityTargetDigest
  || packet.authorityTargetDigest !== prep.authorityTargetDigest
  || JSON.stringify(packet.authorityTarget) !== JSON.stringify(prep.authorityTarget)
  || approvalEvidenceDigest !== 'sha256:21c4a02bf69fbe2ab8cd6e1cc178b87e74900f9bb547cf1dd69809433332aa4b'
  || approval.approvalEvidenceDigest !== approvalEvidenceDigest
  || packet.authorization.approvalEvidenceDigest !== approvalEvidenceDigest
  || approval.approvedAuthorityTargetDigest !== prep.authorityTargetDigest
  || approval.schema11CutoverAuthorized !== true
  || approval.normalWriterReadmissionAuthorized !== false
  || !signatureTrusted
  || schemaVerificationDigest !== terminal.schemaVerificationDigest
  || postStateDigest !== terminal.postStateDigest
  || receipt.evidence.schemaVerificationDigest !== schemaVerificationDigest
  || receipt.evidence.postStateDigest !== postStateDigest) {
  fail('BINDING_OR_SIGNATURE_MISMATCH');
}

const schema = terminal.schemaVerificationEvidence;
const post = terminal.postStateEvidence;
const old = terminal.preservedSchema10Evidence;
const writers = terminal.writerAbsenceEvidence;
const attempt = terminal.attemptEvidence;

if (terminal.classification.outcome !== 'COMMITTED'
  || receipt.outcome !== 'COMMITTED'
  || schema.schemaVersion !== 11
  || schema.migrationCount !== 11
  || schema.migration11?.version !== 11
  || schema.migration11?.name !== 'business_calendar_and_reschedule'
  || schema.migration11?.checksum !== 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8'
  || schema.integrityCheck !== 'ok'
  || schema.foreignKeyViolationCount !== 0
  || schema.journalMode !== 'delete'
  || schema.walPresent !== false
  || schema.shmPresent !== false
  || post.main?.sha256 !== 'sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9'
  || post.sample1MainSha256 !== post.main.sha256
  || post.sample2MainSha256 !== post.main.sha256
  || post.stableMainSha256AcrossSamples !== true
  || post.wal !== null
  || post.shm !== null
  || terminal.executorResult.candidateSchema11Sha256 !== post.main.sha256
  || old.sha256 !== 'sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7'
  || old.schemaVersion !== 10
  || old.migration11Count !== 0
  || old.integrityCheck !== 'ok'
  || old.foreignKeyViolationCount !== 0
  || attempt.packetId !== packet.packetId
  || attempt.operationId !== packet.authorityTarget.execution.operationId
  || attempt.authorityTargetDigest !== packet.authorityTargetDigest
  || writers.productionServiceContainerPresent !== false
  || writers.managedSystemdServicePresent !== false
  || writers.openDatabaseFileUsers !== 0
  || writers.fuserDatabasePids !== 0
  || writers.runningContainersWithProductionDbAccess !== 0
  || writers.executorProcesses !== 0
  || writers.migrationImageContainers !== 0
  || writers.attemptRecordCount !== 1
  || writers.authoritativeWriteCapabilityAbsent !== true
  || writers.normalWritesDisabledAtClassification !== true) {
  fail('TERMINAL_FACTS_NOT_COMMITTED');
}

const contract = createG3Schema11CutoverContractV1({
  packetSchema,
  receiptSchema,
  verifyApproval: value =>
    value.approvalRef === approval.approvalRef
    && value.approvedAuthorityTargetDigest === prep.authorityTargetDigest
    && value.approvalEvidenceDigest === approvalEvidenceDigest
    && signatureTrusted,
  verifyAuthorityTargetEvidence: value =>
    value.authorityTargetDigest === prep.authorityTargetDigest
    && JSON.stringify(value.authorityTarget) === JSON.stringify(prep.authorityTarget),
  verifyTerminalEvidence: value =>
    value.packetId === receipt.packetId
    && value.operationId === receipt.operationId
    && value.authorityTargetDigest === receipt.authorityTargetDigest
    && value.outcome === 'COMMITTED'
    && JSON.stringify(value.evidence) === JSON.stringify(receipt.evidence)
    && schemaVerificationDigest === receipt.evidence.schemaVerificationDigest
    && postStateDigest === receipt.evidence.postStateDigest
    && writers.authoritativeWriteCapabilityAbsent === true
    && writers.normalWritesDisabledAtClassification === true,
  claimExecutionAttempt: () => ({ ok: false, code: 'RECONCILIATION_REQUIRED' }),
  verifyExecutionAttemptStarted: value =>
    value.packetId === attempt.packetId
    && value.operationId === attempt.operationId
    && value.authorityTargetDigest === attempt.authorityTargetDigest,
});

const result = contract.validateTerminalReceipt(packet, receipt);
if (!result.ok || result.outcome !== 'COMMITTED') fail(result.code ?? 'TERMINAL_VALIDATOR_REJECTED');

console.log(JSON.stringify({
  status: 'G3_SCHEMA11_TERMINAL_VERIFICATION_VALID',
  outcome: result.outcome,
  authorityTargetDigest: prep.authorityTargetDigest,
  approvalEvidenceDigest,
  schemaVerificationDigest,
  postStateDigest,
  activeSchema11Sha256: post.main.sha256,
  preservedSchema10Sha256: old.sha256,
  normalWritesDisabled: writers.normalWritesDisabledAtClassification,
  authoritativeWriteCapabilityAbsent: writers.authoritativeWriteCapabilityAbsent,
}, null, 2));
