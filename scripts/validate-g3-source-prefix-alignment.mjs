import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';

const evidence = JSON.parse(await readFile(
  new URL('../docs/operations/g3-prep-source-prefix-alignment-6-to-10.r1.json', import.meta.url), 'utf8'));
const approval = JSON.parse(await readFile(
  new URL('../docs/operations/g3-prep-source-prefix-alignment-approval.r1.json', import.meta.url), 'utf8'));

const fail = code => {
  console.error(JSON.stringify({ status: 'G3_SOURCE_PREFIX_ALIGNMENT_INVALID', code }));
  process.exit(1);
};
const sha = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
};
const digest = value => 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex');

const exactPrefix = MIGRATIONS.filter(item => item.version >= 7 && item.version <= 10)
  .map(({ version, name, checksum }) => ({ version, name, checksum }));
const expectedArtifact = {
  sourceCommit: '6334e2ae851247cb1558074fbd80cfee06b28c11',
  candidateImageDigest: 'sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144',
  architecture: 'amd64',
  executionScriptDigest: 'sha256:ce48facc88364b5028297d20c2e1f4d85d593c29a8d226caa943bbca5875c9df',
};
const expectedTarget = {
  provider: 'TENCENT_CLOUD_CVM',
  instanceId: 'ins-mi85f3my',
  hostname: 'VM-0-12-ubuntu',
  containerName: 'jenn-shooting-operations-prod',
  containerId: 'b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be',
  priorImageDigest: 'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
  dataVolumeName: 'jenn-shooting-operations_shooting_data',
  databasePath: '/app/data/shooting-operations.sqlite',
};
const expectedScope = {
  sourceSchemaVersion: 6,
  targetSchemaVersion: 10,
  migration11Allowed: false,
  normalWriterReadmissionAllowed: false,
};
const authorityTarget = {
  actionId: evidence.actionId,
  authorityHead: evidence.authority.authorityHead,
  scope: evidence.scope,
  artifact: {
    sourceCommit: evidence.artifact.sourceCommit,
    candidateImageDigest: evidence.artifact.candidateImageDigest,
    architecture: evidence.artifact.architecture,
    executionScriptDigest: evidence.artifact.executionScriptDigest,
  },
  target: evidence.target,
  allowedMigrationPrefix: evidence.appliedPrefix,
};
const authorityTargetDigest = digest(authorityTarget);

const pre = evidence.preExecution;
const containment = evidence.containment;
const recovery6 = evidence.schema6Recovery;
const result = evidence.result;
const recovery10 = evidence.schema10PrestateRecovery;
const next = evidence.nextState;

if (evidence.actionId !== 'G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10'
  || evidence.status !== 'ALIGNED_TO_10_CONTAINED'
  || evidence.authority.authorityHead !== '26a3390035fa209bbd1a926a3ebb1bb0df486935'
  || evidence.authority.schema11CutoverAuthorized !== false
  || JSON.stringify(evidence.scope) !== JSON.stringify(expectedScope)
  || JSON.stringify(authorityTarget.artifact) !== JSON.stringify(expectedArtifact)
  || JSON.stringify(evidence.target) !== JSON.stringify(expectedTarget)
  || JSON.stringify(evidence.appliedPrefix) !== JSON.stringify(exactPrefix)
  || evidence.authorization.approvalRecord !== 'docs/operations/g3-prep-source-prefix-alignment-approval.r1.json'
  || evidence.authorization.approvalRef !== approval.approvalRef
  || evidence.authorization.approvedAuthorityTargetDigest !== authorityTargetDigest
  || approval.approvalSource !== 'EXPLICIT_HUMAN_CHAT_AUTHORIZATION'
  || approval.authorizationText !== '做吧'
  || approval.approvedActionId !== evidence.actionId
  || approval.approvedAuthorityTargetDigest !== authorityTargetDigest
  || approval.authorizationReceivedBeforeExecution !== true
  || approval.schema11CutoverAuthorized !== false
  || approval.normalWriterReadmissionAuthorized !== false
  || pre.schemaVersion !== 6 || pre.migrationCount !== 6
  || pre.integrityCheck !== 'ok' || pre.foreignKeyViolationCount !== 0
  || pre.writeAdmissionMode !== 'enabled' || pre.orphanCleanupMode !== 'enabled'
  || containment.priorRestartPolicy !== 'unless-stopped'
  || containment.currentRestartPolicy !== 'no'
  || containment.oldContainerRunning !== false
  || containment.runningVolumeUsers !== 0
  || containment.normalWritersBlocked !== true
  || containment.stoppedBeforeMutation !== true
  || recovery6.verified !== true || recovery6.byteReadbackVerified !== true
  || recovery6.restoredSchemaVersion !== 6
  || recovery6.integrityCheck !== 'ok' || recovery6.foreignKeyViolationCount !== 0
  || result.schemaVersion !== 10 || result.migrationCount !== 10 || result.migration11Count !== 0
  || result.integrityCheck !== 'ok' || result.foreignKeyViolationCount !== 0
  || result.productionServiceRunning !== false || result.normalWritersBlocked !== true
  || recovery10.authoritative !== true || recovery10.verified !== true
  || recovery10.byteReadbackVerified !== true || recovery10.restoredSchemaVersion !== 10
  || recovery10.migration11Count !== 0
  || recovery10.integrityCheck !== 'ok' || recovery10.foreignKeyViolationCount !== 0
  || next.sourceSchemaMismatchCleared !== true
  || next.g3ExecutablePacketStatus !== 'NOT_CREATED'
  || next.humanApprovalStatus !== 'NOT_REQUESTED'
  || next.schema11CutoverStatus !== 'NOT_AUTHORIZED_NOT_STARTED'
  || next.nextAction !== 'CONTINUE_G3_SCHEMA11_CUTOVER_PREPARATION'
  || ![
    evidence.artifact.candidateImageDigest,
    evidence.artifact.executionScriptDigest,
    recovery6.familyObservationDigest,
    recovery6.sourceManifestDigest,
    recovery6.recoveryArtifactDigest,
    recovery10.familyObservationDigest,
    recovery10.sourceManifestDigest,
    recovery10.recoveryArtifactDigest,
    authorityTargetDigest,
  ].every(sha)) {
  fail('SEMANTIC_INVARIANT_FAILED');
}

console.log(JSON.stringify({
  status: 'G3_SOURCE_PREFIX_ALIGNMENT_VALID',
  approvalRef: approval.approvalRef,
  authorityTargetDigest,
  source: pre.schemaVersion,
  target: result.schemaVersion,
  migration11Count: result.migration11Count,
  writersBlocked: containment.normalWritersBlocked,
  schema11CutoverAuthorized: false,
  nextAction: next.nextAction,
}));
