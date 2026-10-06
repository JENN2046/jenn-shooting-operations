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

const expected = MIGRATIONS.filter(item => item.version >= 7 && item.version <= 10)
  .map(({ version, name, checksum }) => ({ version, name, checksum }));

if (evidence.actionId !== 'G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10'
  || evidence.status !== 'ALIGNED_TO_10_CONTAINED'
  || evidence.authority.authorityHead !== '26a3390035fa209bbd1a926a3ebb1bb0df486935'
  || evidence.authority.sourcePrefixAlignmentAuthorized !== true
  || evidence.authority.schema11CutoverAuthorized !== false
  || evidence.scope.sourceSchemaVersion !== 6
  || evidence.scope.targetSchemaVersion !== 10
  || evidence.scope.migration11Allowed !== false
  || evidence.scope.normalWriterReadmissionAllowed !== false
  || JSON.stringify(evidence.appliedPrefix) !== JSON.stringify(expected)
  || evidence.containment.currentRestartPolicy !== 'no'
  || evidence.containment.oldContainerRunning !== false
  || evidence.containment.runningVolumeUsers !== 0
  || evidence.containment.normalWritersBlocked !== true
  || evidence.schema6Recovery.verified !== true
  || evidence.schema10PrestateRecovery.authoritative !== true
  || evidence.schema10PrestateRecovery.verified !== true
  || evidence.result.schemaVersion !== 10
  || evidence.result.migrationCount !== 10
  || evidence.result.migration11Count !== 0
  || evidence.result.integrityCheck !== 'ok'
  || evidence.result.foreignKeyViolationCount !== 0
  || evidence.result.normalWritersBlocked !== true
  || evidence.nextState.sourceSchemaMismatchCleared !== true
  || evidence.nextState.g3ExecutablePacketStatus !== 'NOT_CREATED'
  || evidence.nextState.humanApprovalStatus !== 'NOT_REQUESTED'
  || evidence.nextState.schema11CutoverStatus !== 'NOT_AUTHORIZED_NOT_STARTED'
  || evidence.nextState.nextAction !== 'CONTINUE_G3_SCHEMA11_CUTOVER_PREPARATION'
  || ![
    evidence.artifact.candidateImageDigest,
    evidence.artifact.executionScriptDigest,
    evidence.schema6Recovery.familyObservationDigest,
    evidence.schema6Recovery.sourceManifestDigest,
    evidence.schema6Recovery.recoveryArtifactDigest,
    evidence.schema10PrestateRecovery.familyObservationDigest,
    evidence.schema10PrestateRecovery.sourceManifestDigest,
    evidence.schema10PrestateRecovery.recoveryArtifactDigest,
  ].every(sha)) {
  fail('SEMANTIC_INVARIANT_FAILED');
}

console.log(JSON.stringify({
  status: 'G3_SOURCE_PREFIX_ALIGNMENT_VALID',
  outcome: evidence.result.outcome,
  source: 6,
  target: 10,
  migration11Count: 0,
  writersBlocked: true,
  schema11CutoverAuthorized: false,
  nextAction: evidence.nextState.nextAction,
}));
