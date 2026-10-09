# G3 Minimal Governance Closure Scope R1

**Status: REVIEW CANDIDATE / NON-EXECUTABLE / NO ADOPTION AUTHORITY**

## Decision and precedence

This is a **scope reduction of Draft PR #56**, not an amendment to the frozen G2 invariants, historical G3 receipts, the existing production startup gate, or a new top-level gate family.

**One outcome only:** prospectively reconcile an already-committed Schema11 database into a *future* baseline **without changing its bytes or declaring the historical cutover lawful**.

The earlier `G3_TWO_FILE_CUSTODY_AND_ORIGIN_SIGNER_AUTHORITY_DESIGN_REVIEW_R1` ext4 immutable-flag and off-host signing proposal is withdrawn from the active PR surface. It remains available in Git history as a superseded *candidate design*, not an adopted prerequisite. This scope document and the revised forward-adoption contract replace that candidate's mandatory implementation choices **only for the new proposed forward-only action**. None of this authorizes an exception to G2/G3 until separately reviewed and explicitly approved.

## KEEP: minimum, non-negotiable proof and authority

| Requirement | Exact G3 closure obligation | Why it stays |
| --- | --- | --- |
| K1 Historical fidelity | Keep original G3 physically `COMMITTED` but governance `RECONCILIATION_REQUIRED` (approved head != execution head). Keep old rollback `UNKNOWN`, its replay key consumed; preserve all receipts/attempts. | G2_I2/I4/I5/I6, no retroactive legalization |
| K2 Trusted Schema11 state | Freshly bind the active Schema11 and preserved Schema10 identities/hashes, exact image/migration identity, migration history, application-relevant structure and complete typed business-row sets, SQLite integrity and FK=0, no sidecar ambiguity. Retain a verified recovery/prestate reference. | G2_I2/I3, *prospective* baseline trust, not original cutover approval |
| K3 Durable writer containment | Prove normal JSO writers disabled/drained and no **untrusted** holder can write either evidence file or replace its path during coherent observation and the prospective claim. Bind both exact opened-file identities and re-check hash/path before/after capture. A process list, `lsof=0` or self-declared boolean alone is insufficient. | G2_I1 and G2_I6; evidence must stay meaningful |
| K4 Trusted source/provenance | Use a reviewed, exact-code-and-runtime-bound verifier plus independently checked production origin, file identities, evidence transcript, outcome and observation/claim freshness. A repository-authored hash, self-signed payload or untrusted caller-selected public key is **not** authority. | G2_I2/I3 trusted evidence requirements |
| K5 Prospective legal authority | Separately review and explicitly authorize a *versioned G3 reconciliation exception*; **after** its authority surface merges, bind the then-current exact canonical head and a new target digest/operation; obtain a new exact human approval before a durable one-shot governance record and independent terminal receipt. **No database write.** | Current G2/G3 has no existing forward-adoption admission entry |
| K6 Subsequent permissions isolated | A successful future baseline adoption does **not** open writer, service, G4, release custody, or execute #54. Each needs a separate fresh gate and approval. | G2_I6 and current reconciliation startup gate |

**Trusted administrator boundary:** the minimum route may rely on `TRUSTED_HOST_ADMIN` **only after a distinct explicit Owner acceptance** of who is in the Linux/root/sudo/docker/lxd privileged trust set. This acceptance has **NOT** occurred. Under that accepted boundary, protecting against a malicious trusted root is **not** the G3 requirement; protecting against untrusted writers and capability retention **is**. If the Owner rejects that trust model, G3 remains BLOCKED until an independently enforced host/storage protection boundary is verified. The model is not chosen by this proposal.

## SIMPLIFY: preserve the proof, do not prescribe the machinery

| Prior over-specific requirement | Minimum scope decision |
| --- | --- |
| Two permanent `chattr +i` flags on active Schema11 and preserved Schema10 | **OPTIONAL IMPLEMENTATION**. Both files must be bound and protected against untrusted mutation through the coherent claim boundary. G2 does **not** select ext4 immutability, and any actual flag change requires a separate live-change approval. |
| Off-host Ed25519 Origin Signer, external nonce ledger, 32-byte challenge, 300-second TTL | **OPTIONAL PROVENANCE IMPLEMENTATION**. An independently trusted, reproducible production verification method remains **MANDATORY**. If the signing route is chosen, its approved external trust anchor, signatures and anti-replay requirements remain binding for that route; a signature alone proves no custody or legal approval. |
| Defending against hostile root/Docker administrator | **ALTERNATE THREAT PROFILE**, not automatically required under an explicitly accepted trusted-admin boundary. No claim of protection against hostile root is permitted with local-only controls. |
| Exhaustive SQLite physical-file similarity | **APPLICATION-SEMANTIC EQUIVALENCE**, not byte-for-byte matching. Keep exact schema/migrations/business row invariants, integrity, FK and material metadata. File layout, planner and connection-local values require explanation when omitted, not a new automatic blocking gate. |
| Running the real Schema10 prestate through another writable migration executor | **ALTERNATIVE PROOF METHOD**, not mandatory if an independently approved full-state, non-exfiltrating comparison reaches equivalent evidentiary trust. No real migration is executed in this scope. |

Existing read-only witness and optional Ed25519 verifier can remain **tools** in PR #56. Their presence does **not** mandate deployment of their entire proposed signing/custody architecture or grant production admission.

## DEFER / OUT OF G3 CLOSURE

- Root-adversarial provider-level storage fencing, fs-verity and long-term immutable archive implementation **unless the chosen trust model requires them**.
- Mandatory installation/removal of ext4 inode flags, shared-disk remounts, Docker-wide service stops and broad namespace hardening.
- External signing infrastructure operations, key rotation/revocation, perennial nonce service and long-term evidence-monitoring workflows, unless explicitly selected as the trusted witness method.
- Production writer readmission, Kiosk device acceptance, service startup, G4 testing, production cutover and releases of an implemented file fence.
- Disk-space cleanup and shared-workload maintenance except for a separately authorized live action with demonstrated capacity/safety needs.

**Deferred does not mean prohibited or permanently unnecessary.** It means these are not unconditional entrance conditions for **this** in-place G3 governance reconciliation.

## Stop conditions and next narrowly scoped decision

The three remaining Issue #55 review findings stay **open as production-evidence blockers**: durable writer containment, independent trusted capture/provenance, and approved semantic-equivalence scope. They are not dismissed by this document or by CI success.

```text
SCOPE_REVIEW_ONLY                      = true
TRUSTED_HOST_ADMIN_ACCEPTED           = false
AUTHORITATIVE_PRODUCTION_WITNESS      = NOT_OBTAINED
DURABLE_NORMAL_WRITER_CONTAINMENT     = NOT_PROVEN
SIGNED_EXACT_FORWARD_ADOPTION_TARGET  = NOT_CREATED
VERSIONED_G3_EXCEPTION_APPROVED       = false
HISTORICAL_G3_GOVERNANCE              = RECONCILIATION_REQUIRED
OLD_ROLLBACK_TERMINAL                 = UNKNOWN
WRITER / SERVICE / G4                 = BLOCKED
MERGE / PRODUCTION_MUTATION           = NOT_AUTHORIZED
```

Next decision **after** design-scope review: independently choose and approve the bounded **trust model and trusted evidence route**, then design the smallest concrete containment/witness acceptance. Do **not** implement or request an executable forward-adoption target from this paper alone. PR #54 remains an alternative recovery capability requiring its own authorization; it is never a default response to a failed scope review.
