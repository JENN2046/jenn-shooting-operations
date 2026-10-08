# G3 In-Place Authority Contract Review R1

**Status:** DESIGN_REVIEW_ONLY / NOT_EXECUTABLE / NO_PRODUCTION_AUTHORITY

**Question:** Can the existing physically COMMITTED Schema11 be accepted as a new prospective authority baseline, without editing the DB and without pretending the historical Schema10->11 cutover satisfied its pre-execution authorization requirement?

**Architectural finding:** A narrowly scoped, separately signed *future-only* G3 reconciliation action is structurally possible. The current frozen G2/G3 contracts **do not already admit it**. This is a proposed versioned exception/amendment, NOT a current permission or a retroactive approval.

## A. Precise incompatibilities in current authority

1. G2_I2_EXACT_ARTIFACT_BINDING: historical approval bound authority head a4199fdb14808ebb866943148a222b0d4300d66e, while execution canonical was b9dd595eb52bd09f7a8e2115a48ac401389f5b73. The old approval cannot be edited or reinterpreted.
2. G2_I3_VERIFIED_PRESTATE_RECOVERY: original 10->11 execution required trusted exact prestate, recovery proof and integrity checks. Present-day Schema11 cannot serve retroactively as that execution's prestate.
3. G2_I4_EXPLICIT_CUTOVER_ENTRY: the only originally admitted 10->11 transition is G3_SCHEMA11_CUTOVER under a pre-execution durable one-shot ledger. A new approval cannot create a missing historical admission. No second run of the old G3 operation is legal.
4. G2_I5_TERMINAL_OUTCOME_MODEL: the old physical COMMITTED receipt is an immutable physical classification; it is not automatically a governance-success receipt.
5. G2_I6_UNKNOWN_BLOCKS_READMISSION: the later rollback's UNKNOWN remains permanently terminal and cannot turn into success by observing an intact Schema11.
6. The current reconciliation validator explicitly binds historical RECONCILIATION_REQUIRED and blocked G4, writer, service flags. The runtime startup gate reads this blocked record and fails closed for production DB paths. Simply changing booleans or old receipt JSON is not a lawful resolution.

Existing G2's NO_NEW_GATE_FAMILY prohibits inventing a new gate lineage. Any prospective remedy must be a strictly scoped **G3 reconciliation sub-action** supported by an explicit versioned governance decision, not an implicit new top-level Gate or an override of G2's historical invariants.

## B. Proposed forward-only action (PROPOSAL, not authority)

Working action ID: G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1.

Its meaning is **not** "the October 6 historical cutover was authorized." Its meaning would be: "as of a new exact admission event, this current physical Schema11 database has been independently observed and is accepted as a prospective baseline under a newly approved versioned exception."

Candidate minimal target fields:

~~~json
{
  "contractId": "G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1",
  "canonicalHead": "<exact post-merge SHA at future target freeze>",
  "newOperationId": "<unique new forward-adoption operation>",
  "action": "G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1",
  "historicalG3": {
    "physicalOutcome": "COMMITTED",
    "governanceCompliant": false,
    "approvedHead": "a4199fdb14808ebb866943148a222b0d4300d66e",
    "executionHead": "b9dd595eb52bd09f7a8e2115a48ac401389f5b73",
    "originalAttemptReplayAllowed": false
  },
  "oldRollback": {
    "terminalOutcome": "UNKNOWN",
    "replayIdentityReusable": false,
    "attemptDigest": "sha256:bfd40da521d2a3871ffcf4b4913de260d51c368eeca0ca775c4bda6b25b5645a"
  },
  "observedSchema11": {
    "sha256": "<fresh observed digest>",
    "device": "<fresh observed device>",
    "inode": "<fresh observed inode>",
    "schema": 11,
    "migration11Checksum": "sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8"
  },
  "preservedSchema10": {
    "sha256": "<fresh observed digest>",
    "replayAllowed": false
  },
  "independentProof": {
    "method": "<approved exact method>",
    "trustedEvidenceDigest": "<independent signed witness digest>"
  },
  "effect": {
    "effectiveOnlyAfterNewAdmission": true,
    "retroactiveHistoricalApproval": false,
    "databaseMutationAuthorized": false,
    "writerReadmissionAuthorized": false,
    "serviceStartAuthorized": false,
    "g4EntryAuthorized": false
  }
}
~~~

The placeholders are deliberate. No exact target digest exists, and none may be frozen before this proposal and its verifier contract are independently reviewed and merged.

## C. Required authority and state transitions

1. Freeze and review this **proposal only**, including G2 compatibility and whether a formally signed versioned G3 governance exception is allowed. A source-level evidence report cannot grant a governance exception.
2. Obtain an independent, trusted production proof with no raw data exfiltration. Either replay the true prestate in an appropriately authorized isolated environment, or explicitly approve an equivalent full-state comparison method. No proof-by-repository-hashes alone.
3. Independently review any minimal read-only verifier implementation, immutable approval payload, exact digest domain, versioned exception/admission contract, durable externally stored reconciliation event, and negative tests.
4. Merge the reviewed authority surface without touching the historical G2/G3 records, then freeze an exact target bound to the **then-current** canonical head, original source image/migration, live file identities, independently witnessed evidence, failure facts and trusted signing key.
5. Seek new explicit human approval **after** target freeze; verify its Ed25519 signature and exact target digest. Human consent now is not permission to backdate October 6.
6. Revalidate live file hash/inode, migration/schema/data evidence and containment *immediately before* the bounded forward-only governance claim. Refuse stale head, changed file, user/writer activity, uncertain provenance, or any historical tampering.
7. Create one durable new replay claim and one independent receipt with an explicit new admission time. This prospective governance event must not write to the SQLite DB, call the rollback executor, exchange files, or claim to be the original cutover attempt.
8. The immutable old physical receipt stays COMMITTED / historical governance non-compliant; the independent new record may report a prospective baseline status such as RECONCILED_FORWARD_ONLY. Do not rewrite RECONCILIATION_REQUIRED history.
9. **Distinct subsequent gate:** the reconciled baseline alone does NOT authorize writer readmission, service startup or G4. Those require their own separate approved target, fresh evidence and explicit gate transition.

## D. Runtime interpretation and safe minimal surface

- Do not change or weaken the present startup gate or existing validator as part of Issue #55.
- A future minimal versioned reconciliation reader could check a separately signed **adoption receipt** and trusted operational readmission receipt in addition to immutable historical evidence; mere repository JSON or caller-provided boolean must never release the gate.
- The old blocked reconciliation record remains permanently auditable; old receipts, old operation IDs, and old rollback UNKNOWN are never updated or deleted.
- Prefer no new daemon, new public API, or new DB columns. An independent read-only verifier plus an append-only root-controlled governance event/receipt may suffice, subject to threat-model audit.
- Authority and data proof must be separated: healthy DB state does not prove historical authorization, and valid new approval does not substitute for an independently verified healthy database.

## D1. Independent review remediation (strictly scoped)

The three production evidence **obligations** remain: durable normal-writer containment and two-file integrity, independently trusted/reproducible live evidence, and application-semantic SQLite equivalence. See `G3_MINIMUM_CLOSURE_SCOPE_R1.md` and the revised `G3_FORWARD_ADOPTION_EVIDENCE_AND_CONTRACT_R1.md`: they expressly separate those hard requirements from **optional implementation choices** such as two ext4 immutable flags, an off-host Ed25519 signer or defending against a malicious trusted root. No trust model is selected or independently approved here. A valid signed observation alone still never grants governance, writer or service authority. The existing reconciliation validator and startup gate are untouched; original G3 physical `COMMITTED`, governance `RECONCILIATION_REQUIRED` and prior rollback `UNKNOWN` remain unaltered.

## E. Attack/negative matrix

| Adversarial case | Required result |
| --- | --- |
| Backdated or edited October 6 approval | REJECT; historical non-compliance remains |
| Reuse of original G3 attempt or consumed rollback UNKNOWN | REJECT |
| Current canonical head changed after target freeze, before new admission | FAIL_CLOSED before claim |
| Current Schema11 bytes, inode, migration checksum or original preserved prestate changed | FAIL_CLOSED |
| Only repository-authored hashes, without a trusted independent live witness | BLOCKED |
| Signed target refers to old revision, mismatched verifier or wrong proof digest | REJECT |
| Live writer/container access or uncertain containment | BLOCKED |
| Attempt to start service or release writer on forward-adoption receipt alone | REJECT |
| New operation falsely reports old cutover governance-compliant | REJECT |
| Network-dependent verification after consuming new one-shot claim | DESIGN_REJECT |
| Unreviewed exception to G2 NO_NEW_GATE_FAMILY | BLOCKED |
| UNKNOWN / ambiguous forward-adoption event | STOP; no automatic replay or readmission |

## F. Outcome / fallback

~~~text
CURRENT G3       = historical physical COMMITTED / governance RECONCILIATION_REQUIRED
IN_PLACE DESIGN  = CONDITIONALLY_FEASIBLE
ISSUE #55 RESULT = BLOCKED_INSUFFICIENT_EVIDENCE

NEW GOVERNANCE EXCEPTION APPROVED = false
EXACT FORWARD ADOPTION TARGET      = NOT_CREATED
NEW HUMAN APPROVAL                = NOT_REQUESTED
PRODUCTION ACTION                 = NONE
PRODUCTION SERVICE                = OFF
NORMAL WRITERS                    = BLOCKED
G4                                = BLOCKED
~~~

If the required proof or authorized governance exception is independently rejected, the previously merged PR #54 rollback-recovery **capability** remains an alternative, requiring its own post-merge exact target and fresh human approval. No rollback is triggered by this finding.
