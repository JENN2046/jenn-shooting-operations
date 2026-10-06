import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';

const contract = JSON.parse(await readFile(new URL(
  '../docs/operations/g2-minimal-release-contract.v1.json', import.meta.url), 'utf8'));
const contractSchema = JSON.parse(await readFile(new URL(
  '../contracts/g2-minimal-release-contract.v1.schema.json', import.meta.url), 'utf8'));
const packetSchema = JSON.parse(await readFile(new URL(
  '../contracts/g3-schema11-cutover-packet.v1.schema.json', import.meta.url), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateContract = ajv.compile(contractSchema);
const validatePacket = ajv.compile(packetSchema);

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
});

test('G2 artifact binding matches the exact Schema 11 migration in canonical source', () => {
  const migration = MIGRATIONS.find(item => item.version === 11);
  assert.ok(migration);
  assert.equal(migration.name, contract.transition.migrationName);
  assert.equal(migration.checksum, contract.transition.migrationChecksum);
  assert.equal(contract.transition.ordinaryRuntimeMayPerformTransition, false);
});

test('G2 rejects relaxation of writer containment, explicit entry, UNKNOWN handling or retry rules', () => {
  for (const value of [
    changed(v => { v.invariants[0].inFlightWriterDrainRequired = false; }),
    changed(v => { v.invariants[0].processLifetimeMayCarryAuthority = true; }),
    changed(v => { v.invariants[1].exactAuthorityTargetDigestRequired = false; }),
    changed(v => { v.invariants[1].humanApprovalBoundToAuthorityTargetRequired = false; }),
    changed(v => { v.invariants[2].recoveryReadbackProofRequired = false; }),
    changed(v => { v.invariants[2].recoveryReadbackMustVerifyArtifact = false; }),
    changed(v => { v.invariants[3].ordinaryRuntimeCutoverAllowed = true; }),
    changed(v => { v.invariants[3].executionCapabilityMustBeBounded = false; }),
    changed(v => { v.invariants[3].unknownExecutorMayRetainAuthoritativeWriteCapability = true; }),
    changed(v => { v.invariants[3].nonDatabaseProductionMutationAllowed = true; }),
    changed(v => { v.invariants[4].committedRequiresSchema11Verification = false; }),
    changed(v => { v.invariants[4].rolledBackRequiresPrestateRestorationVerification = false; }),
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
const validPacket = {
  schemaVersion: 1,
  packetId: 'G3-SCHEMA11-CUTOVER-001',
  contractId: 'G2_MINIMAL_RELEASE_CONTRACT_V1',
  authorityHead: 'a'.repeat(40),
  authorityTarget: {
    digest: digest('0'),
    authorization: {
      status: 'NOT_REQUESTED',
      humanApprovalRequired: true,
      approvalRef: null,
    },
  },
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

test('G3 packet schema requires exact artifact, verified recovery and zero-writer containment evidence', () => {
  assert.equal(validatePacket(validPacket), true, JSON.stringify(validatePacket.errors));
  for (const mutate of [
    value => { delete value.authorityTarget; },
    value => { delete value.authorityTarget.digest; },
    value => { delete value.artifact.imageDigest; },
    value => { value.artifact.migrationChecksum = digest('f'); },
    value => { delete value.prestate.recoveryReadbackProofDigest; },
    value => { value.prestate.recoveryReadbackVerified = false; },
    value => { value.prestate.integrityCheck = 'unknown'; },
    value => { value.prestate.foreignKeyViolationCount = 1; },
    value => { value.writerContainment.inFlightWriterCount = 1; },
    value => { value.writerContainment.processLifetimeIsAuthority = true; },
    value => { delete value.writerContainment.executionBoundaryProofDigest; },
    value => { value.writerContainment.unknownExecutorHasAuthoritativeWriteCapability = true; },
    value => { value.writerContainment.nonDatabaseProductionMutationAllowed = true; },
    value => { value.execution.automaticRetryAllowed = true; },
    value => { value.authorityTarget.authorization.approvalRef = 'PRETEND_APPROVED'; },
  ]) {
    const packet = structuredClone(validPacket);
    mutate(packet);
    assert.equal(validatePacket(packet), false);
  }
});

test('G3 packet schema admits an explicit human-approved packet without changing the G2 contract', () => {
  const packet = structuredClone(validPacket);
  packet.authorityTarget.authorization.status = 'APPROVED';
  packet.authorityTarget.authorization.approvalRef = 'G3_SCHEMA11_EXACT_APPROVAL';
  assert.equal(validatePacket(packet), true, JSON.stringify(validatePacket.errors));
  assert.equal(contract.authority.schema11CutoverAuthorized, false);
});
