import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { digestCanonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';
import {
  createG3Schema11CutoverContractV1,
  digestG3AuthorityTargetV1,
} from '../src/g3-schema11-cutover-contract-v1.mjs';

const urls = {
  prep: new URL('../docs/operations/g3-schema11-cutover-exact-target.r1.json', import.meta.url),
  packet: new URL('../docs/operations/g3-schema11-cutover-approved-packet.r2.json', import.meta.url),
  approval: new URL('../docs/operations/g3-schema11-cutover-approval.r2.json', import.meta.url),
  terminal: new URL('../docs/operations/g3-schema11-terminal-verification.r1.json', import.meta.url),
  receipt: new URL('../docs/operations/g3-schema11-cutover-terminal-receipt.r1.json', import.meta.url),
  attempt: new URL('../docs/operations/g3-schema11-cutover-attempt-started.r1.json', import.meta.url),
  observation: new URL('../docs/operations/g3-schema11-terminal-production-observation.r1.json', import.meta.url),
  packetSchema: new URL('../contracts/g3-schema11-cutover-packet.v1.schema.json', import.meta.url),
  receiptSchema: new URL('../contracts/g3-schema11-cutover-receipt.v1.schema.json', import.meta.url),
};

const [
  prepBytes, packetBytes, approvalBytes, terminalBytes, receiptBytes,
  attemptBytes, observationBytes, packetSchemaBytes, receiptSchemaBytes,
] = await Promise.all(Object.values(urls).map(url => readFile(url)));

const [prep, packet, approval, terminal, receipt, attempt, observation, packetSchema, receiptSchema] =
  [prepBytes, packetBytes, approvalBytes, terminalBytes, receiptBytes,
    attemptBytes, observationBytes, packetSchemaBytes, receiptSchemaBytes]
    .map(bytes => JSON.parse(bytes.toString('utf8')));

const EXPECTED = Object.freeze({
  targetDigest: 'sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5',
  approvalEvidenceDigest: 'sha256:21c4a02bf69fbe2ab8cd6e1cc178b87e74900f9bb547cf1dd69809433332aa4b',
  attemptFileSha256: 'sha256:b398b83229bdece61032e7fa64f03d01594a3aa59abcc96954036871a8c4ed37',
  attemptEvidenceDigest: 'sha256:8596a29034f0a73b6949e709edb108b29ae3027af6ba83fd1ed44972315e9158',
  observationFileSha256: 'sha256:2269ce7552057b89d72c81f204e39b0d0be584b840f90be2df1ccdb58cb65d25',
  productionObservationDigest: 'sha256:0ee2a96becab19de15c190d6d76465bc535d7c5c894b0d3de52cb71d9b2e6ef6',
  schemaVerificationDigest: 'sha256:4f9af7c05692edd370f7eb6e310c4dbd4416ec075de33e898e0475af32d4f340',
  postStateDigest: 'sha256:7ecb73f4b9432073f8f3d87afd3cf488ce10858e2494d0109b235ab9dcdaaf2e',
  activeSchema11Sha256: 'sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9',
  preservedSchema10Sha256: 'sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7',
});

const fail = code => {
  console.error(JSON.stringify({ status: 'G3_SCHEMA11_TERMINAL_VERIFICATION_INVALID', code }));
  process.exit(1);
};

const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

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
const same = (left, right) => canonical(left) === canonical(right);

const attemptFileSha256 = sha256(attemptBytes);
const observationFileSha256 = sha256(observationBytes);
const attemptEvidenceDigest = digestCanonicalJsonSchedulingV1({
  domain: 'g3-schema11-started-attempt-evidence-v1',
  attemptEvidence: attempt,
});
const productionObservationDigest = digestCanonicalJsonSchedulingV1({
  domain: 'g3-schema11-terminal-production-observation-v1',
  productionObservation: observation,
});

if (attemptFileSha256 !== EXPECTED.attemptFileSha256
  || observationFileSha256 !== EXPECTED.observationFileSha256
  || attemptEvidenceDigest !== EXPECTED.attemptEvidenceDigest
  || productionObservationDigest !== EXPECTED.productionObservationDigest) {
  fail('TRUSTED_EVIDENCE_ARTIFACT_MISMATCH');
}

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
const approvalEvidenceDigest = sha256(approvalPayload);

const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAO6+9DSKWYrwyEC20zFe1GPdeTEYggybpXBrxDib5Koo=
-----END PUBLIC KEY-----
`);
let signatureTrusted = false;
try {
  signatureTrusted = verifySignature(
    null,
    approvalPayload,
    publicKey,
    Buffer.from(approval.signatureBase64, 'base64'),
  );
} catch {
  signatureTrusted = false;
}

if (prep.authorityTargetDigest !== EXPECTED.targetDigest
  || digestG3AuthorityTargetV1(prep.authorityTarget) !== prep.authorityTargetDigest
  || packet.authorityTargetDigest !== prep.authorityTargetDigest
  || !same(packet.authorityTarget, prep.authorityTarget)
  || approvalEvidenceDigest !== EXPECTED.approvalEvidenceDigest
  || approval.approvalEvidenceDigest !== approvalEvidenceDigest
  || packet.authorization.approvalEvidenceDigest !== approvalEvidenceDigest
  || approval.approvedAuthorityTargetDigest !== prep.authorityTargetDigest
  || approval.schema11CutoverAuthorized !== true
  || approval.normalWriterReadmissionAuthorized !== false
  || signatureTrusted !== true) {
  fail('APPROVAL_OR_AUTHORITY_BINDING_MISMATCH');
}

if (attempt.packetId !== packet.packetId
  || attempt.operationId !== packet.authorityTarget.execution.operationId
  || attempt.authorityTargetDigest !== packet.authorityTargetDigest
  || attempt.claimedAt !== '2026-10-06T21:03:07.102087Z') {
  fail('STARTED_ATTEMPT_BINDING_MISMATCH');
}

const active = observation.activeDatabase;
const old = observation.preservedSchema10;
const writers = observation.writerAbsence;
const executorResult = observation.executorResult;

const schemaVerificationEvidence = {
  observedAt: active.firstObservedAt,
  schemaVersion: active.schemaVersion,
  migrationCount: active.migrationCount,
  migration11: active.migration11,
  integrityCheck: active.integrityCheck,
  foreignKeyViolationCount: active.foreignKeyViolationCount,
  journalMode: active.journalMode,
  walPresent: active.walPresent,
  shmPresent: active.shmPresent,
};
const postStateEvidence = {
  firstObservedAt: active.firstObservedAt,
  secondObservedAt: active.secondObservedAt,
  main: {
    size: active.size,
    device: active.device,
    inode: active.inode,
    mode: active.mode,
    uid: active.uid,
    gid: active.gid,
    linkCount: active.linkCount,
    sha256: active.sha256,
  },
  wal: active.walPresent ? 'present' : null,
  shm: active.shmPresent ? 'present' : null,
  stableMainSha256AcrossSamples: active.stableAcrossSamples,
  sample1MainSha256: active.sample1Sha256,
  sample2MainSha256: active.sample2Sha256,
};
const schemaVerificationDigest = digestCanonicalJsonSchedulingV1({
  domain: 'g3-schema11-terminal-schema-verification-v1',
  schemaVerificationEvidence,
});
const postStateDigest = digestCanonicalJsonSchedulingV1({
  domain: 'g3-schema11-terminal-post-state-v1',
  postStateEvidence,
});

if (schemaVerificationDigest !== EXPECTED.schemaVerificationDigest
  || postStateDigest !== EXPECTED.postStateDigest
  || receipt.evidence.schemaVerificationDigest !== schemaVerificationDigest
  || receipt.evidence.postStateDigest !== postStateDigest
  || !same(terminal.schemaVerificationEvidence, schemaVerificationEvidence)
  || !same(terminal.postStateEvidence, postStateEvidence)) {
  fail('TERMINAL_DIGEST_BINDING_MISMATCH');
}

if (observation.authorityTargetDigest !== EXPECTED.targetDigest
  || observation.packetId !== packet.packetId
  || observation.operationId !== packet.authorityTarget.execution.operationId
  || active.sha256 !== EXPECTED.activeSchema11Sha256
  || active.sample1Sha256 !== active.sha256
  || active.sample2Sha256 !== active.sha256
  || active.stableAcrossSamples !== true
  || active.schemaVersion !== 11
  || active.migrationCount !== 11
  || active.migration11?.version !== 11
  || active.migration11?.name !== 'business_calendar_and_reschedule'
  || active.migration11?.checksum !== 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8'
  || active.integrityCheck !== 'ok'
  || active.foreignKeyViolationCount !== 0
  || active.journalMode !== 'delete'
  || active.walPresent !== false
  || active.shmPresent !== false
  || old.sha256 !== EXPECTED.preservedSchema10Sha256
  || old.schemaVersion !== 10
  || old.migration11Count !== 0
  || old.integrityCheck !== 'ok'
  || old.foreignKeyViolationCount !== 0
  || executorResult.status !== 'G3_ATOMIC_EXCHANGE_COMPLETE_UNCLASSIFIED'
  || executorResult.candidateSchema11Sha256 !== active.sha256
  || executorResult.oldSchema10PathAfterExchange !== old.path
  || executorResult.automaticRetryAllowed !== false
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
  fail('TRUSTED_PRODUCTION_OBSERVATION_NOT_COMMITTED');
}

const bindings = terminal.trustedEvidenceBindings;
if (bindings?.attemptRecord?.fileSha256 !== EXPECTED.attemptFileSha256
  || bindings?.attemptRecord?.evidenceDigest !== EXPECTED.attemptEvidenceDigest
  || bindings?.productionObservation?.fileSha256 !== EXPECTED.observationFileSha256
  || bindings?.productionObservation?.evidenceDigest !== EXPECTED.productionObservationDigest
  || terminal.attemptEvidence?.fileSha256 !== EXPECTED.attemptFileSha256
  || terminal.attemptEvidence?.attemptEvidenceDigest !== EXPECTED.attemptEvidenceDigest
  || terminal.classification?.outcome !== 'COMMITTED'
  || receipt.outcome !== 'COMMITTED') {
  fail('CLASSIFICATION_BINDING_MISMATCH');
}

const contract = createG3Schema11CutoverContractV1({
  packetSchema,
  receiptSchema,
  verifyApproval: value =>
    value.approvalRef === approval.approvalRef
    && value.approvedAuthorityTargetDigest === EXPECTED.targetDigest
    && value.approvalEvidenceDigest === EXPECTED.approvalEvidenceDigest
    && signatureTrusted === true,
  verifyAuthorityTargetEvidence: value =>
    value.authorityTargetDigest === EXPECTED.targetDigest
    && same(value.authorityTarget, prep.authorityTarget),
  verifyTerminalEvidence: value =>
    value.packetId === observation.packetId
    && value.operationId === observation.operationId
    && value.authorityTargetDigest === observation.authorityTargetDigest
    && value.outcome === 'COMMITTED'
    && same(value.evidence, receipt.evidence)
    && productionObservationDigest === EXPECTED.productionObservationDigest
    && schemaVerificationDigest === EXPECTED.schemaVerificationDigest
    && postStateDigest === EXPECTED.postStateDigest
    && writers.authoritativeWriteCapabilityAbsent === true
    && writers.normalWritesDisabledAtClassification === true,
  claimExecutionAttempt: () => ({ ok: false, code: 'RECONCILIATION_REQUIRED' }),
  verifyExecutionAttemptStarted: value =>
    value.packetId === attempt.packetId
    && value.operationId === attempt.operationId
    && value.authorityTargetDigest === attempt.authorityTargetDigest
    && attemptFileSha256 === EXPECTED.attemptFileSha256
    && attemptEvidenceDigest === EXPECTED.attemptEvidenceDigest,
});

const result = contract.validateTerminalReceipt(packet, receipt);
if (!result.ok || result.outcome !== 'COMMITTED') {
  fail(result.code ?? 'TERMINAL_SEMANTIC_VALIDATOR_REJECTED');
}

console.log(JSON.stringify({
  status: 'G3_SCHEMA11_TERMINAL_VERIFICATION_VALID',
  outcome: result.outcome,
  authorityTargetDigest: EXPECTED.targetDigest,
  approvalEvidenceDigest,
  attemptFileSha256,
  attemptEvidenceDigest,
  productionObservationFileSha256: observationFileSha256,
  productionObservationDigest,
  schemaVerificationDigest,
  postStateDigest,
  activeSchema11Sha256: active.sha256,
  preservedSchema10Sha256: old.sha256,
  normalWritesDisabled: writers.normalWritesDisabledAtClassification,
  authoritativeWriteCapabilityAbsent: writers.authoritativeWriteCapabilityAbsent,
}, null, 2));
