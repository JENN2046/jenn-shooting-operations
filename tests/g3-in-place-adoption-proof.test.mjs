import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(new URL('docs/operations/g3-in-place-adoption-readonly-evidence.r1.json', root), 'utf8'));
const historic = JSON.parse(await readFile(new URL('docs/operations/g3-authority-binding-reconciliation.r1.json', root), 'utf8'));
const report = await readFile(new URL('docs/operations/G3_IN_PLACE_ADOPTION_PROOF_R1.md', root), 'utf8');
const contract = await readFile(new URL('docs/operations/G3_IN_PLACE_AUTHORITY_CONTRACT_REVIEW_R1.md', root), 'utf8');

test('in-place proof preserves the historical G3 failure instead of laundering it', () => {
  assert.equal(data.decision, 'BLOCKED_INSUFFICIENT_EVIDENCE');
  assert.equal(data.authorityGranted, false);
  assert.equal(data.historical.approvalHeadsMatch, false);
  assert.equal(data.historical.originalApprovedHead, historic.trigger.approvedAuthorityHead);
  assert.equal(data.historical.executionHead, historic.trigger.executionCanonicalHead);
  assert.equal(data.historical.priorRollbackOutcome, 'UNKNOWN');
  assert.equal(data.historical.priorRollbackReplayAllowed, false);
  assert.equal(data.historical.priorRollbackClaimSha256, 'sha256:' + 'bfd40da521d2a3871ffcf4b4913de260d51c368eeca0ca775c4bda6b25b5645a');
  assert.equal(historic.status, 'RECONCILIATION_REQUIRED');
  assert.equal(historic.governance.g3GovernanceClosureAllowed, false);
  assert.equal(historic.governance.g4Allowed, false);
});

test('strong physical evidence is not promoted to full independent replay', () => {
  assert.equal(data.observed.activeSha256, 'sha256:' + '0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9');
  assert.equal(data.observed.preservedSha256, 'sha256:' + '5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7');
  assert.equal(data.observed.legacyCommonTablesWithEqualRowSets, 38);
  assert.equal(data.observed.legacyCommonTableRowSetMismatches, 0);
  assert.equal(data.independentReproduction.ddl.pinnedSyntheticManifestsMatchLiveForBothVersions, true);
  assert.equal(data.independentReproduction.realProductionPrestateReplayPerformed, false);
  assert.equal(data.independentReproduction.productionEvidenceCryptographicallyAttested, false);
  assert.match(report, /NOT_PERFORMED_SAFETY_BOUNDARY|was not performed/u);
});

test('forward adoption remains a proposal with separate owner admission and readmission', () => {
  assert.equal(data.futurePlan.proposedAction, 'G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1');
  assert.equal(data.futurePlan.actionIsRetroactiveApproval, false);
  assert.equal(data.futurePlan.legalUnderCurrentG2WithoutAmendment, false);
  assert.equal(data.futurePlan.signedExactTargetCreated, false);
  assert.equal(data.futurePlan.explicitHumanApprovalRequested, false);
  for (const allowed of Object.values(data.prohibitions)) assert.equal(allowed, false);
  assert.match(contract, /historical Schema10->11 cutover/u);
  assert.match(contract, /NO_NEW_GATE_FAMILY/u);
  assert.match(contract, /separate approved target/u);
});
