import { createHash, verify as verifySignature } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1 } from '../src/scheduling-contract-v1.mjs';
import { createG3Schema11CutoverContractV1, digestG3AuthorityTargetV1 } from '../src/g3-schema11-cutover-contract-v1.mjs';

const ROOT = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const fail = code => {
  console.error(JSON.stringify({ status: 'G3_SCHEMA11_TERMINAL_RECEIPT_INVALID', code }));
  process.exit(1);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const EXPECTED = Object.freeze({
  target: 'sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5',
  productionDbPath:
    '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data/shooting-operations.sqlite',
  executor: 'sha256:a87eca97276b9f38a2d5cee6d5e8bb1ad17ba9f883d6224d2145fcc0c2ffc2a4',
  approvalEvidence: 'sha256:21c4a02bf69fbe2ab8cd6e1cc178b87e74900f9bb547cf1dd69809433332aa4b',
  activeDb: 'sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9',
  prestateDb: 'sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7',
  attemptRecord: 'sha256:b398b83229bdece61032e7fa64f03d01594a3aa59abcc96954036871a8c4ed37',
  migration11: 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8',
  signingKeyId: 'sha256:0d9c964a35c05842b5aafbe261fb5e020427ad5c635357e6955201da56100bae',
});

const APPROVAL_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAO6+9DSKWYrwyEC20zFe1GPdeTEYggybpXBrxDib5Koo=
-----END PUBLIC KEY-----
`;

try {
  const [packetSchema, receiptSchema, prep, approval, packet, terminal, receipt,
    executorBytes, attemptRecordBytes] = await Promise.all([
    readJson('contracts/g3-schema11-cutover-packet.v1.schema.json'),
    readJson('contracts/g3-schema11-cutover-receipt.v1.schema.json'),
    readJson('docs/operations/g3-schema11-cutover-exact-target.r1.json'),
    readJson('docs/operations/g3-schema11-cutover-approval.r2.json'),
    readJson('docs/operations/g3-schema11-cutover-approved-packet.r2.json'),
    readJson('docs/operations/g3-schema11-terminal-evidence.r1.json'),
    readJson('docs/operations/g3-schema11-terminal-receipt.r1.json'),
    readFile(new URL('scripts/g3-schema11-cutover-executor.py', ROOT)),
    readFile(new URL('docs/operations/g3-schema11-attempt-record.r1.json', ROOT)),
  ]);
  const attemptRecord = JSON.parse(attemptRecordBytes.toString('utf8'));
  const attemptRecordDigest = sha256(attemptRecordBytes);
  const targetBindingDigest = digestCanonicalJsonSchedulingV1({
    domain: 'g3-schema11-target-binding-v1',
    targetBindingEvidence: prep.targetBindingEvidence,
  });

  if (prep.targetBindingEvidence.databasePath !== EXPECTED.productionDbPath
    || prep.targetBindingDigest !== targetBindingDigest
    || prep.authorityTarget.target.targetBindingDigest !== targetBindingDigest
    || prep.authorityTargetDigest !== EXPECTED.target
    || digestG3AuthorityTargetV1(prep.authorityTarget) !== EXPECTED.target
    || packet.authorityTargetDigest !== EXPECTED.target
    || !same(packet.authorityTarget, prep.authorityTarget)
    || sha256(executorBytes) !== EXPECTED.executor
    || prep.executionBoundaryEvidence.executorSha256 !== EXPECTED.executor) {
    fail('FROZEN_TARGET_OR_EXECUTOR_MISMATCH');
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
  const approvalPayload = Buffer.from(canonicalJsonSchedulingV1({
    domain: 'g3-schema11-human-approval-v1',
    approval: approvalCore,
  }), 'utf8');
  const approvalEvidenceDigest = sha256(approvalPayload);
  let approvalSignature;
  try { approvalSignature = Buffer.from(approval.signatureBase64, 'base64'); }
  catch { fail('APPROVAL_SIGNATURE_ENCODING_INVALID'); }

  const approvalSignatureValid = verifySignature(
    null,
    approvalPayload,
    APPROVAL_PUBLIC_KEY_PEM,
    approvalSignature,
  );
  if (approvalEvidenceDigest !== EXPECTED.approvalEvidence
    || approval.approvalEvidenceDigest !== approvalEvidenceDigest
    || packet.authorization.approvalEvidenceDigest !== approvalEvidenceDigest
    || approval.approvedAuthorityTargetDigest !== EXPECTED.target
    || packet.authorization.approvedAuthorityTargetDigest !== EXPECTED.target
    || approval.signingKeyId !== EXPECTED.signingKeyId
    || approval.schema11CutoverAuthorized !== true
    || approval.normalWriterReadmissionAuthorized !== false
    || approvalSignatureValid !== true) {
    fail('APPROVAL_EVIDENCE_INVALID');
  }

  const schemaVerificationDigest = digestCanonicalJsonSchedulingV1({
    domain: 'g3-schema11-terminal-schema-verification-v1',
    schemaVerificationEvidence: terminal.schemaVerificationEvidence,
  });
  const postStateDigest = digestCanonicalJsonSchedulingV1({
    domain: 'g3-schema11-terminal-post-state-v1',
    postStateEvidence: terminal.postStateEvidence,
  });
  const contractReplayKey = digestCanonicalJsonSchedulingV1({
    domain: 'g3-schema11-execution-attempt-v1',
    operationId: packet.authorityTarget.execution.operationId,
    authorityTargetDigest: packet.authorityTargetDigest,
  });

  const sv = terminal.schemaVerificationEvidence;
  const ps = terminal.postStateEvidence;
  const at = ps.attempt;
  const parseInstant = value => {
    if (typeof value !== 'string') return Number.NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const attemptClaimedAtMs = parseInstant(attemptRecord.claimedAt);
  const schemaObservedAtMs = parseInstant(sv.observedAt);
  const postStateClassifiedAtMs = parseInstant(ps.classifiedAt);
  const receiptClassifiedAtMs = parseInstant(receipt.classifiedAt);
  const productionDbPath = EXPECTED.productionDbPath;
  const expectedPrestatePath =
    `/mnt/datadisk0/g3-schema11-cutover/${packet.authorityTarget.execution.operationId}/candidate.sqlite`;
  const frozenPrestateIdentity = prep.targetBindingEvidence.activeFileIdentity;
  const expectedAttemptPath =
    '/mnt/datadisk0/g3-schema11-cutover/attempts/aa9c7a4c2ad48ed6e808a48c6e24790ff0c5d25883536ab2bfd27e0f6447b6c6.json';
  const attemptKeys = Object.keys(attemptRecord).sort();
  if (terminal.packetId !== packet.packetId
    || terminal.operationId !== packet.authorityTarget.execution.operationId
    || terminal.authorityTargetDigest !== EXPECTED.target
    || terminal.schemaVerificationDigest !== schemaVerificationDigest
    || terminal.postStateDigest !== postStateDigest
    || terminal.contractReplayKey !== contractReplayKey
    || !Number.isFinite(attemptClaimedAtMs)
    || !Number.isFinite(schemaObservedAtMs)
    || !Number.isFinite(postStateClassifiedAtMs)
    || !Number.isFinite(receiptClassifiedAtMs)
    || receipt.classifiedAt !== ps.classifiedAt
    || ps.classifiedAt !== sv.observedAt
    || receiptClassifiedAtMs !== postStateClassifiedAtMs
    || postStateClassifiedAtMs !== schemaObservedAtMs
    || attemptClaimedAtMs >= schemaObservedAtMs
    || sv.schemaVersionObserved !== 11
    || sv.migrationCount !== 11
    || sv.migration11Count !== 1
    || sv.migration11Name !== 'business_calendar_and_reschedule'
    || sv.migration11Checksum !== EXPECTED.migration11
    || sv.databasePath !== productionDbPath
    || ps.activeDatabase.path !== productionDbPath
    || sv.databasePath !== ps.activeDatabase.path
    || sv.activeDatabaseSha256 !== EXPECTED.activeDb
    || sv.integrityCheck !== 'ok'
    || sv.foreignKeyViolationCount !== 0
    || sv.journalMode !== 'delete'
    || sv.walPresent !== false || sv.shmPresent !== false || sv.journalPresent !== false
    || sv.stableAcrossIndependentSamples !== true
    || ps.hostname !== 'VM-0-12-ubuntu'
    || ps.instanceId !== 'ins-mi85f3my'
    || ps.activeDatabase.sha256 !== EXPECTED.activeDb
    || ps.preservedPrestate.path !== expectedPrestatePath
    || ps.preservedPrestate.device !== frozenPrestateIdentity.device
    || ps.preservedPrestate.inode !== frozenPrestateIdentity.inode
    || ps.preservedPrestate.sha256 !== EXPECTED.prestateDb
    || ps.preservedPrestate.schemaVersion !== 10
    || ps.preservedPrestate.migration11Count !== 0
    || ps.preservedPrestate.integrityCheck !== 'ok'
    || ps.preservedPrestate.foreignKeyViolationCount !== 0
    || ps.containment.walPresent !== false
    || ps.containment.shmPresent !== false
    || ps.containment.journalPresent !== false
    || ps.containment.productionServiceContainerPresent !== false
    || ps.containment.runningContainersWithDatabaseAccess !== 0
    || ps.containment.openDatabaseFileUsers !== 0
    || ps.containment.fuserDatabasePids !== 0
    || ps.containment.normalWritesDisabled !== true
    || ps.containment.authoritativeWriteCapabilityAbsent !== true
    || attemptRecordDigest !== EXPECTED.attemptRecord
    || attemptRecordBytes.length !== 230
    || attemptKeys.join(',') !== 'authorityTargetDigest,claimedAt,operationId,packetId'
    || at.path !== expectedAttemptPath
    || at.sha256 !== attemptRecordDigest
    || at.size !== attemptRecordBytes.length
    || attemptRecord.packetId !== packet.packetId
    || attemptRecord.operationId !== packet.authorityTarget.execution.operationId
    || attemptRecord.authorityTargetDigest !== EXPECTED.target
    || attemptRecord.claimedAt !== at.claimedAt
    || at.packetId !== attemptRecord.packetId
    || at.operationId !== attemptRecord.operationId
    || at.authorityTargetDigest !== attemptRecord.authorityTargetDigest
    || terminal.classification.outcome !== 'COMMITTED'
    || terminal.classification.authoritativeWriteCapabilityAbsent !== true
    || terminal.classification.normalWritesDisabledAtClassification !== true
    || terminal.classification.writerReadmissionAuthorized !== false) {
    fail('TERMINAL_EVIDENCE_FACT_MISMATCH');
  }

  const verifyApproval = value =>
    value.approvalRef === approval.approvalRef
    && value.approvedAuthorityTargetDigest === EXPECTED.target
    && value.approvalEvidenceDigest === EXPECTED.approvalEvidence
    && approvalSignatureValid;

  const verifyAuthorityTargetEvidence = value =>
    value.authorityTargetDigest === EXPECTED.target
    && same(value.authorityTarget, prep.authorityTarget);

  const verifyExecutionAttemptStarted = value =>
    attemptRecordDigest === EXPECTED.attemptRecord
    && value.replayKey === contractReplayKey
    && value.packetId === attemptRecord.packetId
    && value.operationId === attemptRecord.operationId
    && value.authorityTargetDigest === attemptRecord.authorityTargetDigest;

  const verifyTerminalEvidence = value =>
    value.packetId === receipt.packetId
    && value.operationId === receipt.operationId
    && value.authorityTargetDigest === receipt.authorityTargetDigest
    && value.outcome === 'COMMITTED'
    && value.evidence.schemaVerificationDigest === schemaVerificationDigest
    && value.evidence.postStateDigest === postStateDigest
    && value.evidence.schemaVersionObserved === 11
    && value.evidence.integrityCheck === 'ok'
    && value.evidence.foreignKeyViolationCount === 0
    && value.evidence.authoritativeWriteCapabilityAbsent === true
    && value.evidence.normalWritesDisabledAtClassification === true;

  const g3 = createG3Schema11CutoverContractV1({
    packetSchema,
    receiptSchema,
    verifyApproval,
    verifyAuthorityTargetEvidence,
    verifyTerminalEvidence,
    claimExecutionAttempt: () => { throw new Error('terminal validation must not claim'); },
    verifyExecutionAttemptStarted,
  });
  const result = g3.validateTerminalReceipt(packet, receipt);
  if (!result.ok || result.outcome !== 'COMMITTED') fail(result.code ?? 'TERMINAL_CONTRACT_REJECTED');

  console.log(JSON.stringify({
    status: 'G3_SCHEMA11_TERMINAL_RECEIPT_VALID',
    outcome: 'COMMITTED',
    receiptId: receipt.receiptId,
    authorityTargetDigest: receipt.authorityTargetDigest,
    approvalEvidenceDigest,
    schemaVerificationDigest,
    postStateDigest,
    contractReplayKey,
    writerReadmissionAuthorized: false,
  }));
} catch (error) {
  if (!process.exitCode) {
    console.error(JSON.stringify({
      status: 'G3_SCHEMA11_TERMINAL_RECEIPT_INVALID',
      code: 'VALIDATOR_ERROR',
      errorClass: error?.constructor?.name ?? 'Error',
      message: String(error?.message ?? ''),
    }));
    process.exit(1);
  }
}
