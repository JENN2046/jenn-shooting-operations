# G3-04 — versioned forward reconciliation exception R1

Status: **NON-EXECUTABLE DESIGN; SEPARATE EXCEPTION AND EXACT-TARGET APPROVAL REQUIRED**.
Task: `G3_04_FORWARD_EXCEPTION_AUTHORITY_R1`. Owner authorized G3-04 after G3-03 acceptance. This document defines a reviewable exception proposal; it is not that future exception approval, an execution target, or a production operation.

The machine policy is `g3-forward-reconciliation-exception.r1.json`, checked by `contracts/g3-forward-reconciliation-exception.r1.schema.json`. The schema validates only this closed policy document. It intentionally cannot represent approvals, actual operation IDs, live targets, claims or receipts. Schema validation proves policy shape, not live provenance, trusted signer identity, freshness, replay exclusion or execution safety. No new command/endpoint, runtime gate or executable reconciler is added.

## Existing authority and exact scope

- G2 I1–I6 and `NO_NEW_GATE_FAMILY` remain byte-identical. Existing cutover and rollback entrypoints do not acquire this action.
- Reuse `G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1` from the existing prospective evidence contract. This is a proposed G3 sub-action, not a top-level gate and not a physical Schema10→11 migration.
- Method: [G3-02 freeze](https://github.com/JENN2046/jenn-shooting-operations/issues/59#issuecomment-6074360103), under [Owner TRUSTED_HOST_ADMIN decision](https://github.com/JENN2046/jenn-shooting-operations/issues/58#issuecomment-6062729313).
- Implementation/method acceptance: [G3-03 receipt](https://github.com/JENN2046/jenn-shooting-operations/issues/57#issuecomment-6074619277), Draft #61 `b26b72e181a1b52ea00130df7e6cd9b4c3674bb1`. It is nonproduction evidence, not live production proof. Optional signature compatibility remains DEFER; the selected origin route is prebound SSH plus external custody.
- Fresh review snapshot: canonical `371bf8982b0cd0df579b0e981964b27f9d0319fc`; Draft #56 `620136f322fddd194144ae90a44d833a40e15fff`; Draft #61 as above. These are review inputs, not the future post-merge approval head.
- Earlier proposal text describing trust model as unselected is historical. This design uses the approved #58/#59 profile without changing old approvals, receipts or historical governance status.

The only prospective effect is a **new governance admission of the already existing Schema11 baseline**, effective no earlier than its independent terminal verification. Original G3 remains physically COMMITTED / governance RECONCILIATION_REQUIRED. Original rollback remains UNKNOWN and its replay identity consumed. Neither record is reset, replaced, backdated or legalized.

## Minimal future target and approval contract

No actual target is constructed in G3-04. A future target may be proposed only after the authority surface is independently reviewed and explicitly merged, and separately authorized G3-05 live proof is accepted. Canonical head must then be refreshed; none of this task's snapshots is an executable head pin.

The canonical target must bind all fields listed in `targetRequirements.requiredBindings`: exact exception version and contract digest; post-merge canonical head; reviewed executor/verifier source, image and runtime digests; approved trust method and independently prebound source/custodian anchors; both original FD/path/parent/alias/namespace identities and raw hashes; durable containment through capture and claim; origin transcript and evidence digest; full application semantics, original migration identity, active-family prestate and preserved recovery readback; immutable historical G3 and consumed UNKNOWN rollback facts/digests; a new operation ID, exact packet ID and explicit validity window.

Reuse the existing sorted-key UTF-8 canonical JSON / SHA256 convention with the distinct domain `G3_FORWARD_RECONCILIATION_TARGET_R1`. Full encoding, bounds and semantic binding must be reviewed when an executable target surface is separately authorized; do not use policy-schema acceptance as such validation. The target digest excludes its later approval and receipts to avoid a self-reference. The new trusted human approval must bind that target digest plus exception version/contract digest, identity, scope and validity. Exception approval and exact-target approval are explicit separate bindings; they may be reviewed together in the separately authorized G3-07 package, but cannot be inferred from design approval, merge, G3-01 TCB acceptance or an old cutover approval.

Fresh canonical verification occurs before the one-shot claim, followed by local revalidation of the pinned source/runtime, exact files, containment, proof and approval. Any changed head, target, file, trust anchor, evidence, clock window or unknown capability stops before claim. No first-time network/metadata/canonical lookup after claim. G3-03 lab UUIDs, nonces, host keys and file identities must never be promoted to a production target.

## Claim and terminal meaning

Reuse G2's durable one-shot rule and replay identity `operationId+authorityTargetDigest`; bind exact packet ID but never partition replay by packet ID. Reject any old G3/rollback operation identity, even when a different packet is presented. New claim records use separately approved custody and append-only storage; historical ledgers are not extended or edited by this proposal. No real identity is allocated or consumed here.

| Boundary / observation | Required interpretation |
| --- | --- |
| Preconditions fail before any claim | No operation begins and no terminal receipt is fabricated. Stop and report. |
| Claim storage unavailable / durability uncertain | Do not proceed; if consumption may have occurred, classify UNKNOWN and never retry automatically. |
| Durable claim acknowledged | Identity stays consumed. Only the exactly approved bounded governance append could follow. |
| Missing append acknowledgement, process crash, invalid proof or unknown terminal | UNKNOWN; consumed identity stays unavailable; writers stay disabled; separate human reconciliation required. |
| Independent verification confirms the new exact append, unchanged DB identities/hashes, continued containment and complete approval/evidence chain | COMMITTED for this **new governance event only**, with future effective time equal to independent verification time. |

No physical database write/exchange/rollback occurs in this sub-action. Thus only the existing outcome names COMMITTED and UNKNOWN apply here; G2's ROLLED_BACK remains available for its physical recovery operations, but is not invented as a “nothing happened” terminal for this governance append. G2's allowed-outcome model is not edited. Rejection before claim is not a fourth terminal outcome.

The new receipt chain binds operation/target/packet/instance, claim, exception and human approvals, evidence, old-history digests, prior append digest, terminal and independent verification timestamps/digests. The first append must explicitly reference the new claim rather than an unbound chain root. Time order is approvals → durable claim → new append → independent verification; missing, ambiguous or backwards time is UNKNOWN, never backdated COMMITTED. An initial append is not itself independent verification; the verification receipt is separate and append-only. No approval or receipt is included in its own digest.

Successful governance admission does **not** release either immutable file, clear the existing startup record, reopen normal writers, start services or authorize G4. Any future readmission/runtime adapter requires a separately reviewed and authorized scope; do not add one opportunistically to G3-04. Current startup gate remains blocked even when handed a schema-valid design record.

## Evidence and invariant preservation

| G2 obligation | This exception's preservation |
| --- | --- |
| I1 durable writer containment | Frozen E1 applies to both originals and all untrusted write capabilities through capture/claim/terminal verification; partial protection, drift or UNKNOWN stops admission. |
| I2 exact artifact and human binding | Fresh merged head and exact target/source/image/runtime/contract digests; trusted new human approval before claim. |
| I3 prestate/recovery verification | No physical transition is repeated: actual existing active family and independently verified preserved Schema10 recovery are bound together, with original migration/prestate relationship and unchanged raw digests; no unverified recovery reference is substituted. |
| I4 explicit bounded entry / replay | Existing G3 sub-action proposal only, separate versioned approval, durable claim before any new governance append; no arbitrary new production capability. |
| I5 trusted terminal semantics | Existing outcome vocabulary; complete independent evidence required for this new COMMITTED; unknown stays UNKNOWN. |
| I6 unknown blocks readmission | No retry or writer enablement, including after a successful governance event; separate human reconciliation/readmission gate. |

The G3-02 E3 semantic contract remains required: exact 40/42 roster, 38 business tables with type/multiplicity/rowid semantics, complete ten-migration prefix and Migration11 identity, two new empty tables, schema/index/constraint material metadata, integrity/FK and original recovery binding. All sidecars rejected under the selected profile. No application-semantic obligation is replaced by “hashes match” or a repository literal.

## Merge/readiness plan without an evidence loop

#56, #61 and this design's independent Draft remain unmerged until Owner explicitly authorizes merge. The stack is #56 → #61 → this proposal; any rebase/base update/merge changes the head and requires fresh applicable checks and review. No automatic merging or source-head promotion is part of G3-04.

Keep the three existing #56 production evidence threads open and linked:
- [P1 two-file containment](https://github.com/JENN2046/jenn-shooting-operations/pull/56#discussion_r4214054636)
- [P2 trusted source/verifier](https://github.com/JENN2046/jenn-shooting-operations/pull/56#discussion_r4214054643)
- [P2 SQLite semantic coverage](https://github.com/JENN2046/jenn-shooting-operations/pull/56#discussion_r4214054647)

Code/design merge readiness and production admission are separate decisions. Non-executable design may be reviewed before live proof; authorized read-only live proof does not depend on an already-executed adoption. No executable target may freeze until **both** approved merged authority and accepted live proof exist. This breaks the circular demand for production adoption as proof needed to authorize adoption.

A clean diff or green tests cannot resolve those threads. Before any merge, explicit independent reviewer dispositions and Owner merge intent must identify the retained live-proof obligations and where they block admission. If branch protection/reviewer policy treats an unresolved thread as a merge blocker, it remains a merge blocker until the responsible reviewer and Owner make an explicit disposition; never click resolve merely to unblock. This document neither waives the findings nor changes repository settings. G3-04 design PASS alone is not MERGE_READY or LIVE_READY.

## Review and stop

Local negative tests verify the closed policy schema rejects retrospective legalization, UNKNOWN reset/retry, old approval reuse, packet-based replay partition, late canonical binding, missing exact approval, lab self-attestation, target/drift bypass, premature permission, backdating and receipt fabrication. They also compare the G2 byte pin/history to existing artifacts and prove the schema-valid design cannot pass the existing cutover packet schema or startup gate. These are nonproduction design tests, not implementation of future replay storage or a future executor.

The contract requires independent review and separate Owner approval before future target freeze/execution; no such approval is represented here. G3-04 deliverables may be accepted as a non-executable design without activating the exception. After the design/review report and GitHub synchronization, stop. The only next candidate is separately authorized **G3-05 LIVE_TRUSTED_SCHEMA11_PROOF_R1**, with exact live read-only/custody scope; this task does not request or exercise that scope.
