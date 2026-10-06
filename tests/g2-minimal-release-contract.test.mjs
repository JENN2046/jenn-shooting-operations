import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';
import {
  createG3Schema11CutoverContractV1,
  digestG3AuthorityTargetV1,
} from '../src/g3-schema11-cutover-contract-v1.mjs';

const contract = JSON.parse(await readFile(new URL(
  '../docs/operations/g2-minimal-release-contract.v1.json', import.meta.url), 'utf8'));
const contractSchema = JSON.parse(await readFile(new URL(
  '../contracts/g2-minimal-release-contract.v1.schema.json', import.meta.url), 'utf8'));
const packetSchema = JSON.parse(await readFile(new URL(
  '../contracts/g3-schema11-cutover-packet.v1.schema.json', import.meta.url), 'utf8'));
const receiptSchema = JSON.parse(await readFile(new URL(
  '../contracts/g3-schema11-cutover-receipt.v1.schema.json', import.meta.url), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateContract = ajv.compile(contractSchema);
const validatePacketSchema = ajv.compile(packetSchema);
const validateReceiptSchema = ajv.compile(receiptSchema);

function changed(mutator) {
  const value = structuredClone(contract);
  mutator(value);
  return value;
}

test('G2 contract freezes exactly six invariants and no G2 production authority', () => {
  assert.equal(validateContract(contract), true, JSON.stringify(validateContract.errors));
  assert.deepEqual(contract.invariants.map(item => item.id), [
    'G2_I1_DURABLE_WRITER_CONTAINMENT',
    'G2_I2_EXACT_ARTIFACT_BINDING',
    'G2_I3_VERIFIED_PRESTATE_RECOVERY',
    'G2_I4_EXPLICIT_CUTOVER_ENTRY',
    'G2_I5_TERMINAL_OUTCOME_MODEL',
    'G2_I6_UNKNOWN_BLOCKS_READMISSION',
  ]);
  assert.equal(contract.authority.productionMutationAuthorized, false);
  assert.equal(contract.authority.schema11CutoverAuthorized, false);
  assert.equal(contract.currentPacketStatus, 'NOT_CREATED');
  assert.equal(contract.nextGate, 'G3_SCHEMA11_CUTOVER');
  assert.equal(contract.g3PacketSchema, 'contracts/g3-schema11-cutover-packet.v1.schema.json');
  assert.equal(contract.g3ReceiptSchema, 'contracts/g3-schema11-cutover-receipt.v1.schema.json');
  assert.equal(contract.g3SemanticValidatorModule, 'src/g3-schema11-cutover-contract-v1.mjs');
});

test('G2 artifact binding matches the exact Schema 11 migration in canonical source', () => {
  const migration = MIGRATIONS.find(item => item.version === 11);
  assert.ok(migration);
  assert.equal(migration.name, contract.transition.migrationName);
  assert.equal(migration.checksum, contract.transition.migrationChecksum);
  assert.equal(contract.transition.ordinaryRuntimeMayPerformTransition, false);
});

test('G2 rejects relaxation of containment, approval binding, recovery, outcomes or readmission', () => {
  for (const value of [
    changed(v => { v.invariants[0].inFlightWriterDrainRequired = false; }),
    changed(v => { v.invariants[0].processLifetimeMayCarryAuthority = true; }),
    changed(v => { v.invariants[0].unprovenContainmentDisposition = 'UNKNOWN'; }),
    changed(v => { v.invariants[1].exactAuthorityTargetDigestRequired = false; }),
    changed(v => { v.invariants[1].humanApprovalBoundToAuthorityTargetRequired = false; }),
    changed(v => { v.invariants[1].semanticApprovalBindingValidationRequired = false; }),
    changed(v => { v.invariants[1].trustedApprovalVerificationRequired = false; }),
    changed(v => { v.invariants[1].trustedArtifactBindingVerificationRequired = false; }),
    changed(v => { v.invariants[2].recoveryReadbackProofRequired = false; }),
    changed(v => { v.invariants[2].recoveryReadbackMustVerifyArtifact = false; }),
    changed(v => { v.invariants[2].trustedPrestateRecoveryEvidenceVerificationRequired = false; }),
    changed(v => { v.invariants[3].ordinaryRuntimeCutoverAllowed = true; }),
    changed(v => { v.invariants[3].executionCapabilityMustBeBounded = false; }),
    changed(v => { v.invariants[3].unknownExecutorMayRetainAuthoritativeWriteCapability = true; }),
    changed(v => { v.invariants[3].nonDatabaseProductionMutationAllowed = true; }),
    changed(v => { v.invariants[3].trustedExecutionBoundaryEvidenceVerificationRequired = false; }),
    changed(v => { v.invariants[3].unprovenBoundaryDisposition = 'UNKNOWN'; }),
    changed(v => { v.invariants[4].committedRequiresSchema11Verification = false; }),
    changed(v => { v.invariants[4].rolledBackRequiresPrestateRestorationVerification = false; }),
    changed(v => { v.invariants[4].terminalReceiptRequired = false; }),
    changed(v => { v.invariants[4].terminalSemanticValidationRequired = false; }),
    changed(v => { v.invariants[4].trustedTerminalEvidenceVerificationRequired = false; }),
    changed(v => { v.invariants[4].automaticRetryAllowed = true; }),
    changed(v => { v.invariants[4].allowedOutcomes = ['COMMITTED', 'ROLLED_BACK']; }),
    changed(v => { v.invariants[5].unknownKeepsNormalWritesDisabled = false; }),
    changed(v => { v.invariants[5].automaticReenableAllowed = true; }),
    changed(v => { v.authority.schema11CutoverAuthorized = true; }),
  ]) {
    assert.equal(validateContract(value), false);
  }
});

const digest = value => `sha256:${String(value).repeat(64)}`;

function makeAuthorityTarget() {
  return {
    authorityHead: 'a'.repeat(40),
    artifact: {
      sourceCommit: 'a'.repeat(40),
      imageDigest: digest('1'),
      migrationVersion: 11,
      migrationName: 'business_calendar_and_reschedule',
      migrationChecksum: contract.transition.migrationChecksum,
    },
    target: {
      targetBindingDigest: digest('2'),
      activeDatabaseFamilyDigest: digest('3'),
    },
    prestate: {
      capturedAt: '2026-10-06T00:00:00.000Z',
      recoveryArtifactDigest: digest('4'),
      recoveryReadbackProofDigest: digest('5'),
      recoveryReadbackVerified: true,
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
    },
    writerContainment: {
      durableDisableReceiptDigest: digest('6'),
      inFlightWriterCount: 0,
      drainProofDigest: digest('7'),
      processLifetimeIsAuthority: false,
      executionBoundaryProofDigest: digest('8'),
      unknownExecutorHasAuthoritativeWriteCapability: false,
      nonDatabaseProductionMutationAllowed: false,
    },
    execution: {
      entrypointId: 'G3_SCHEMA11_CUTOVER',
      operationId: 'G3-SCHEMA11-OP-001',
      automaticRetryAllowed: false,
    },
  };
}

const trustedAuthorityTarget = makeAuthorityTarget();
const trustedAuthorityTargetDigest = digestG3AuthorityTargetV1(trustedAuthorityTarget);
const trustedApproval = Object.freeze({
  approvalRef: 'G3_SCHEMA11_EXACT_APPROVAL',
  approvedAuthorityTargetDigest: trustedAuthorityTargetDigest,
  approvalEvidenceDigest: digest('9'),
});
const verifyApproval = value => value.approvalRef === trustedApproval.approvalRef
  && value.approvedAuthorityTargetDigest === trustedApproval.approvedAuthorityTargetDigest
  && value.approvalEvidenceDigest === trustedApproval.approvalEvidenceDigest;
const verifyAuthorityTargetEvidence = () => true;
const verifyTerminalEvidence = () => true;
const g3 = createG3Schema11CutoverContractV1({
  packetSchema,
  receiptSchema,
  verifyApproval,
  verifyAuthorityTargetEvidence,
  verifyTerminalEvidence,
});

function makePacket() {
  const authorityTarget = structuredClone(trustedAuthorityTarget);
  const authorityTargetDigest = digestG3AuthorityTargetV1(authorityTarget);
  return {
    schemaVersion: 1,
    packetId: 'G3-SCHEMA11-CUTOVER-001',
    contractId: 'G2_MINIMAL_RELEASE_CONTRACT_V1',
    authorityTarget,
    authorityTargetDigest,
    authorization: {
      status: 'APPROVED',
      humanApprovalRequired: true,
      approvalRef: trustedApproval.approvalRef,
      approvedAuthorityTargetDigest: authorityTargetDigest,
      approvalEvidenceDigest: trustedApproval.approvalEvidenceDigest,
    },
  };
}

test('G3 executable packet schema cannot represent an unapproved execution', () => {
  const packet = makePacket();
  assert.equal(validatePacketSchema(packet), true, JSON.stringify(validatePacketSchema.errors));
  for (const mutate of [
    value => { value.authorization.status = 'NOT_REQUESTED'; },
    value => { value.authorization.approvalRef = null; },
    value => { delete value.authorization.approvedAuthorityTargetDigest; },
    value => { delete value.authorization.approvalEvidenceDigest; },
    value => { value.authorityTarget.writerContainment.inFlightWriterCount = 1; },
    value => { value.authorityTarget.writerContainment.unknownExecutorHasAuthoritativeWriteCapability = true; },
    value => { value.authorityTarget.execution.automaticRetryAllowed = true; },
  ]) {
    const value = structuredClone(packet);
    mutate(value);
    assert.equal(validatePacketSchema(value), false);
  }
});

test('G3 semantic validator requires trusted evidence verifiers and binds approval to the complete authority target', () => {
  assert.throws(() => createG3Schema11CutoverContractV1({ packetSchema, receiptSchema }));
  assert.throws(() => createG3Schema11CutoverContractV1({
    packetSchema, receiptSchema, verifyApproval, verifyAuthorityTargetEvidence,
  }));
  const packet = makePacket();
  const unverifiedEvidence = createG3Schema11CutoverContractV1({
    packetSchema,
    receiptSchema,
    verifyApproval,
    verifyAuthorityTargetEvidence: () => false,
    verifyTerminalEvidence,
  });
  assert.equal(
    unverifiedEvidence.validateExecutablePacket(packet).code,
    'G3_AUTHORITY_TARGET_EVIDENCE_NOT_VERIFIED',
  );
  assert.deepEqual(g3.validateExecutablePacket(packet), {
    ok: true,
    authorityTargetDigest: packet.authorityTargetDigest,
  });

  const changedTarget = structuredClone(packet);
  changedTarget.authorityTarget.artifact.imageDigest = digest('a');
  assert.equal(g3.validateExecutablePacket(changedTarget).code, 'G3_AUTHORITY_TARGET_DIGEST_MISMATCH');

  const reboundWithoutApproval = structuredClone(packet);
  reboundWithoutApproval.authorityTarget.target.targetBindingDigest = digest('b');
  reboundWithoutApproval.authorityTargetDigest = digestG3AuthorityTargetV1(reboundWithoutApproval.authorityTarget);
  assert.equal(g3.validateExecutablePacket(reboundWithoutApproval).code, 'G3_APPROVAL_TARGET_MISMATCH');

  const forgedReapproval = structuredClone(reboundWithoutApproval);
  forgedReapproval.authorization.approvedAuthorityTargetDigest = forgedReapproval.authorityTargetDigest;
  assert.equal(g3.validateExecutablePacket(forgedReapproval).code, 'G3_APPROVAL_EVIDENCE_NOT_VERIFIED');
});

function makeReceipt(outcome) {
  const packet = makePacket();
  const base = {
    schemaVersion: 1,
    receiptId: `G3R-SCHEMA11-${outcome}`,
    contractId: 'G2_MINIMAL_RELEASE_CONTRACT_V1',
    packetId: packet.packetId,
    operationId: packet.authorityTarget.execution.operationId,
    authorityTargetDigest: packet.authorityTargetDigest,
    classifiedAt: '2026-10-06T00:01:00.000Z',
    outcome,
  };
  if (outcome === 'COMMITTED') {
    return { packet, receipt: { ...base, evidence: {
      schemaVersionObserved: 11,
      schemaVerificationDigest: digest('c'),
      postStateDigest: digest('d'),
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      authoritativeWriteCapabilityAbsent: true,
      normalWritesDisabledAtClassification: true,
    } } };
  }
  if (outcome === 'ROLLED_BACK') {
    return { packet, receipt: { ...base, evidence: {
      restoredPrestateDigest: packet.authorityTarget.target.activeDatabaseFamilyDigest,
      restorationVerificationDigest: digest('e'),
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      authoritativeWriteCapabilityAbsent: true,
      normalWritesDisabledAtClassification: true,
    } } };
  }
  return { packet, receipt: { ...base, evidence: {
    ambiguityEvidenceDigest: digest('f'),
    authoritativeWriteCapabilityAbsent: true,
    normalWritesDisabledAtClassification: true,
    reconciliationRequired: true,
    freshReadmissionEvidenceRequired: true,
    automaticRetryAllowed: false,
  } } };
}

test('terminal receipt schema enforces COMMITTED, ROLLED_BACK and UNKNOWN evidence separately', () => {
  for (const outcome of ['COMMITTED', 'ROLLED_BACK', 'UNKNOWN']) {
    const { receipt } = makeReceipt(outcome);
    assert.equal(validateReceiptSchema(receipt), true, `${outcome}: ${JSON.stringify(validateReceiptSchema.errors)}`);
  }

  const { receipt: committed } = makeReceipt('COMMITTED');
  delete committed.evidence.schemaVerificationDigest;
  assert.equal(validateReceiptSchema(committed), false);

  const { receipt: unknown } = makeReceipt('UNKNOWN');
  unknown.evidence.normalWritesDisabledAtClassification = false;
  assert.equal(validateReceiptSchema(unknown), false);

  const invalid = makeReceipt('UNKNOWN').receipt;
  invalid.outcome = 'PARTIAL';
  assert.equal(validateReceiptSchema(invalid), false);
});

test('terminal semantic validator binds receipt to packet, exact prestate and trusted terminal evidence', () => {
  for (const outcome of ['COMMITTED', 'ROLLED_BACK', 'UNKNOWN']) {
    const { packet, receipt } = makeReceipt(outcome);
    assert.deepEqual(g3.validateTerminalReceipt(packet, receipt), { ok: true, outcome });
  }

  const terminalUnverified = createG3Schema11CutoverContractV1({
    packetSchema,
    receiptSchema,
    verifyApproval,
    verifyAuthorityTargetEvidence,
    verifyTerminalEvidence: () => false,
  });
  const unverified = makeReceipt('COMMITTED');
  assert.equal(
    terminalUnverified.validateTerminalReceipt(unverified.packet, unverified.receipt).code,
    'G3_TERMINAL_EVIDENCE_NOT_VERIFIED',
  );

  const { packet, receipt } = makeReceipt('ROLLED_BACK');
  receipt.evidence.restoredPrestateDigest = digest('0');
  assert.equal(g3.validateTerminalReceipt(packet, receipt).code, 'G3_ROLLBACK_PRESTATE_MISMATCH');

  const bound = makeReceipt('UNKNOWN');
  bound.receipt.authorityTargetDigest = digest('0');
  assert.equal(g3.validateTerminalReceipt(bound.packet, bound.receipt).code, 'G3_RECEIPT_BINDING_MISMATCH');
});
