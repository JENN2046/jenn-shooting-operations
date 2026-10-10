#!/usr/bin/env python3
"""Validate R2 preparation bytes and references without creating live authority."""
import json
from pathlib import Path
import sys
from g3_r2_bootstrap import CODE_FILES
from g3_r2_common import DENY, exact, METHOD, need, REF_PINS, sha

ROOT = Path(__file__).resolve().parents[1]


def validate(root=ROOT):
    read = lambda path: (root / path).read_bytes()
    evidence = json.loads(read('docs/operations/g3-forward-adoption-evidence-and-contract.r2.json'))
    exception = json.loads(read('docs/operations/g3-forward-reconciliation-exception.r2.json'))
    exact(evidence, ('schemaVersion', 'contractId', 'status', 'methodSha256', 'ownerApprovalSha256', 'r1ContractSha256',
                     'r1ExceptionSha256', 'code', 'referencePins', 'requirements', 'limits', 'currentAuthority', 'compatibility'))
    need(evidence['schemaVersion'] == 2 and evidence['contractId'] == 'G3_FORWARD_ADOPTION_EVIDENCE_R2'
         and evidence['status'] == 'IMPLEMENTATION_PREPARATION_NOT_PRODUCTION_AUTHORITY', 'CONTRACT_ID')
    need(evidence['methodSha256'] == METHOD and sha(read('docs/operations/G3_05_RESTRICTED_RECOVERY_REFERENCE_METHOD_R2.md')) == METHOD, 'METHOD_PIN')
    need(evidence['ownerApprovalSha256'] == sha(read('docs/operations/g3-05-restricted-reference-method-owner-approval.r2.json')), 'OWNER_APPROVAL_PIN')
    need(evidence['r1ContractSha256'] == sha(read('docs/operations/g3-forward-adoption-evidence-and-contract.r1.json')) and
         evidence['r1ExceptionSha256'] == sha(read('docs/operations/g3-forward-reconciliation-exception.r1.json')), 'R1_HISTORY_PIN')
    need(set(evidence['code']) == CODE_FILES, 'REQUIRED_CODE_SET')
    for name, pin in evidence['code'].items():
        need(sha(read('scripts/' + name)) == pin, 'CODE_PIN:' + name)
    need(evidence['referencePins'] == REF_PINS, 'REFERENCE_PINS')
    required = ('originalR1RejectsAllWal2_2', 'fixedReferenceAndIndependentChainOnly', 'currentOriginalFdFullHashes',
                'twoImmutableInodesAndFullParents', 'allSidecarsRejectedBeforeAndAfter', 'actualWritersAndHelpersBound',
                'strictSchemaIndexesForeignKeysTypedMultisets', 'tenMigrationRecordsExactNoTimestampException',
                'oneUseChallengeConsumedBeforeTransport', 'ttlFromIssueWallAndMonotonic', 'completeFsyncedRawStreams',
                'strictIndependentLocalAcceptanceAndReadonlyReplay', 'expiredEvidenceAuditOnly', 'partialProtectionRetained',
                'noAutomaticRetry', 'separateExactMergeApproval', 'postMergeExactProductionApproval', 'fullExecutionProjectionAndCanonicalBound', 'independentCollectorRuntimeBound', 'approvalBoundRootCustodiedSshExecutable', 'explicitSshEnvironmentBound', 'typedApprovedWriterInventory', 'structuredStoppedWriterSemantics', 'independentWriterProbeReplay', 'unsupportedHelperControlBlocked')
    exact(evidence['requirements'], (*required, 'historicalWalCompleteness', 'historicalWriterCoverage'))
    need(all(evidence['requirements'][k] is True for k in required) and
         evidence['requirements']['historicalWalCompleteness'] == evidence['requirements']['historicalWriterCoverage'] == 'NOT_PROVEN', 'REQUIREMENTS_WEAKENED')
    need(evidence['limits'] == {'copyBytes': 8388608, 'addressSpaceBytes': 268435456, 'cpuSeconds': 60,
                              'wallSeconds': 120, 'stdoutBytes': 1048576, 'stderrBytes': 1048576, 'challengeSeconds': 300}, 'LIMITS')
    need(evidence['currentAuthority'] == {**DENY, 'mergeAuthorized': False, 'productionExecutionAuthorized': False,
                                        'productionEvidenceAdmitted': False, 'g3_06Allowed': False}, 'AUTHORITY_ESCALATION')
    need(evidence['compatibility'] == {'r1WitnessSha256': '95ca51db7174eaffc8ce9cee8f85f0440ec1253fb8a2e00dc89b42649775ccfc',
                                      'r1Ed25519VerifierSha256': '5ec8892c4f1b1c14a43ff204d483b3b8ccadfb74b737829ec88ed4097ebc91cb',
                                      'r2Ed25519Accepted': False}, 'R1_COMPATIBILITY')
    need(sha(read('scripts/verify-g3-forward-adoption-witness-signature.mjs')) == evidence['compatibility']['r1Ed25519VerifierSha256'], 'R1_SIGNATURE_BYTES')
    exact(exception, ('schemaVersion', 'contractId', 'status', 'methodSha256', 'evidenceContractSha256', 'historicalFacts',
                      'exception', 'currentAuthority'))
    need(exception['schemaVersion'] == 2 and exception['contractId'] == 'G3_FORWARD_RECONCILIATION_EXCEPTION_R2'
         and exception['status'] == evidence['status'] and exception['methodSha256'] == METHOD, 'EXCEPTION_VERSION')
    need(exception['evidenceContractSha256'] == sha(read('docs/operations/g3-forward-adoption-evidence-and-contract.r2.json')), 'R2_CONTRACT_PIN')
    r1 = json.loads(read('docs/operations/g3-forward-reconciliation-exception.r1.json'))
    need(exception['historicalFacts'] == r1['historicalFacts'] and exception['currentAuthority'] == evidence['currentAuthority'], 'HISTORICAL_OR_AUTHORITY_DRIFT')
    need(exception['exception'] == {'scope': 'FIXED_CAPTURE_STATE_RESTRICTED_RECOVERY_REFERENCE_ONLY',
                                    'historicalWriterCoverage': 'NOT_PROVEN', 'historicalWalCompleteness': 'NOT_PROVEN',
                                    'uncapturedCommittedDataMayBeMissing': True, 'historicalExecutionLegalized': False,
                                    'generalWal2_2Acceptance': False, 'governanceAdoptionApproved': False}, 'EXCEPTION_SCOPE')
    return {'status': 'R2_PREPARATION_CONTRACTS_VALID_NOT_EXECUTABLE_AUTHORITY', **DENY}


if __name__ == '__main__':
    try:
        print(json.dumps(validate(), sort_keys=True))
    except Exception as e:
        print(json.dumps({'status': 'R2_CONTRACT_REJECTED', 'code': str(e)}))
        sys.exit(2)
