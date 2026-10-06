import { readFile } from 'node:fs/promises';
import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';

const evidence = JSON.parse(await readFile(
  new URL('../docs/operations/g3-prep-source-prefix-alignment-6-to-10.r1.json', import.meta.url),
  'utf8',
));

const fail = code => {
  console.error(JSON.stringify({ status: 'G3_SOURCE_PREFIX_ALIGNMENT_INVALID', code }));
  process.exit(1);
};
const sha = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const exactPrefix = MIGRATIONS.filter(item => item.version >= 7 && item.version <= 10)
  .map(({ version, name, checksum }) => ({ version, name, checksum }));

const pre = evidence.preExecution;
const containment = evidence.containment;
const recovery6 = evidence.schema6Recovery;
const result = evidence.result;
const recovery10 = evidence.schema10PrestateRecovery;
const next = evidence.nextState;

if (evidence.actionId !== 'G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10'
  || evidence.status !== 'ALIGNED_TO_10_CONTAINED'
  || evidence.authority.authorityHead !== '26a3390035fa209bbd1a926a3ebb1bb0df486935'
  || evidence.authority.sourcePrefixAlignmentAuthorized !== true
  || evidence.authority.schema11CutoverAuthorized !== false
  || evidence.scope.sourceSchemaVersion !== 6
  || evidence.scope.targetSchemaVersion !== 10
  || evidence.scope.migration11Allowed !== false
  || evidence.scope.normalWriterReadmissionAllowed !== false
  || pre.schemaVersion !== evidence.scope.sourceSchemaVersion
  || pre.migrationCount !== 6
  || pre.integrityCheck !== 'ok'
  || pre.foreignKeyViolationCount !== 0
  || pre.writeAdmissionMode !== 'enabled'
  || pre.orphanCleanupMode !== 'enabled'
  || JSON.stringify(evidence.appliedPrefix) !== JSON.stringify(exactPrefix)
  || containment.priorRestartPolicy !== 'unless-stopped'
  || containment.currentRestartPolicy !== 'no'
  || containment.oldContainerRunning !== false
  || containment.runningVolumeUsers !== 0
  || containment.normalWritersBlocked !== true
  || containment.stoppedBeforeMutation !== true
  || recovery6.verified !== true
  || recovery6.byteReadbackVerified !== true
  || recovery6.restoredSchemaVersion !== evidence.scope.sourceSchemaVersion
  || recovery6.integrityCheck !== 'ok'
  || recovery6.foreignKeyViolationCount !== 0
  || result.schemaVersion !== evidence.scope.targetSchemaVersion
  || result.migrationCount !== 10
  || result.migration11Count !== 0
  || result.integrityCheck !== 'ok'
  || result.foreignKeyViolationCount !== 0
  || result.productionServiceRunning !== false
  || result.normalWritersBlocked !== true
  || recovery10.authoritative !== true
  || recovery10.verified !== true
  || recovery10.byteReadbackVerified !== true
  || recovery10.restoredSchemaVersion !== result.schemaVersion
  || recovery10.migration11Count !== 0
  || recovery10.integrityCheck !== 'ok'
  || recovery10.foreignKeyViolationCount !== 0
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
  ].every(sha)) {
  fail('SEMANTIC_INVARIANT_FAILED');
}

console.log(JSON.stringify({
  status: 'G3_SOURCE_PREFIX_ALIGNMENT_VALID',
  outcome: result.outcome,
  source: pre.schemaVersion,
  target: result.schemaVersion,
  migration11Count: result.migration11Count,
  stoppedBeforeMutation: containment.stoppedBeforeMutation,
  schema6RecoveryVerified: recovery6.byteReadbackVerified,
  schema10RecoveryVerified: recovery10.byteReadbackVerified,
  writersBlocked: containment.normalWritersBlocked,
  schema11CutoverAuthorized: false,
  nextAction: next.nextAction,
}));
