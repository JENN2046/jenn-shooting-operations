# G3 Forward Adoption Evidence and Contract R1

**Status: NON-EXECUTABLE REVIEW CANDIDATE / ADMISSION BLOCKED**

This proposed sub-action would accept an existing, physically committed Schema11 as a **prospective** baseline. It does **not** replay Schema10→11, backdate approval, amend the historical G3 receipt, invoke #54, or authorize production startup or writes.

**Scope authority for this proposal:** `G3_MINIMUM_CLOSURE_SCOPE_R1.md`. The three original P1/P2 findings remain open until their **proof obligations** are met. Prior ext4-immutable and off-host-signing implementations were examples, not mandatory choices from frozen G2. The six G2 invariants and existing production runtime gate remain unchanged.

## 1. Minimum evidence obligations

### E1. Durable normal-writer exclusion plus coherent two-file observations

The future claim needs independently checkable evidence that normal JSO writers are durably disabled, in-flight writes have drained, old rollback helpers cannot resume an unauthorized mutation, and untrusted writer/alias/namespace paths capable of changing either original evidence DB are fenced **through the observation and claim**. A missing process, `flock`, `lsof` or an `immutable=1` SQLite URI does not satisfy this requirement by itself.

Bind fresh Schema11/Schema10 path and opened-file identity, content hash, migration prestate and poststate; reject drift, sidecars and ambiguous writers. Preserve the Schema10 recovery reference. The implementation need **not** require both file inodes to remain ext4 immutable after the event. No permanent file-attribute changes are approved here. Admin/root trust model remains unchosen; under adversarial-root assumptions, these local-only protections are insufficient and this route remains BLOCKED.

### E2. Independently trusted, reproducible production evidence

The provided read-only observation script `scripts/g3-forward-adoption-readonly-witness.py` pins exact source code/runtime and both opened original database identities, uses bounded `pread` and in-memory SQLite only, and emits canonical digests/counts, not raw business rows. Existing synthetic tests challenge type changes, multiplicity, rowid, metadata, sidecars and path ambiguity.

The provided `scripts/verify-g3-forward-adoption-witness-signature.mjs` is an **available** Ed25519 integrity-verification option and checks the pinned verifier digest, production target hashes, true 40/42-table roster, cross-side rowset equality, exact first-ten-migration digest and the version11 checksum/timestamp. A signed JSON document or author-supplied public key **alone** is not verified production provenance or a human authorization.

G2 calls for **trusted verification**, not a particular off-host signing infrastructure. The implementation route must be explicitly reviewed under a chosen trust model, with an independently verified witness source and capture provenance. If an external signing route is chosen, its public-key/trust-anchor/anti-replay protocol must be separately approved and actually proven. No trusted live-origin capture exists yet; repository summaries and local synthetic test successes cannot substitute.

### E3. Application-semantic Schema11 equivalence

The minimum proof fixes the original pinned migration identity and checks all application-relevant schema, typed business records, duplicates, migration markers (complete Schema10 prefix and exact version11), necessary indexes/constraints, integrity and foreign keys. Preserved Schema10 and active Schema11 are compared without exporting raw business rows.

Byte-for-byte equality of distinct Schema versions is **not** expected. Physical page allocation, free-list layout, planner statistics and connection-local values need explicit relevance/exclusion treatment, not automatic universal equivalence obligations. The existing stricter metadata-checking tool may be reused without making every optional SQLite internal field a new G3 release gate. Unknown material differences or unreviewed exclusions ⇒ FAIL_CLOSED.

The previous live observations supported 38/38 unchanged business row sets, verified original migration identity and sound SQLite integrity. They remain **supporting evidence**, not independent production-origin authorization.

## 2. Minimum future-only G3 reconciliation authority

**Proposed action:** `G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1`, currently NOT admitted by the frozen G2/G3 execution contract. A separately reviewed and explicitly approved **versioned G3 reconciliation exception** is required. No new top-level gate family or rewrite of the original `G3_SCHEMA11_CUTOVER` operation is permitted.

After that authority surface is reviewed and merged, an executable target, if ever proposed, must bind a fresh canonical head; approved evidence method and trust boundary; pinned source/image/migration; live active and preserved DB identities; verified provenance/containment/equivalence; historical G3 `COMMITTED / RECONCILIATION_REQUIRED` and the consumed rollback `UNKNOWN`; new operation/replay identity and exact target digest. Only then may a **new, prior-to-action, explicit human approval** be requested.

A new distinct durable, append-only *governance reconciliation* record would become effective only from its independently verified new admission time; it must **not write the production SQLite database** or label the original cutover authorized. Old attempt ledgers and receipts remain immutable. Any UNCERTAIN/UNKNOWN state blocks automatic retry and readmission.

A future accepted baseline is **not** writer admission, service startup, file-custody release or G4. Those are separately reviewed and separately authorized production actions.

## 3. Current gated status

| Obligation | Code/design surface | Production admission evidence |
| --- | --- | --- |
| E1 durable writer containment and both file identities | Required predicate defined; specific ext4 mechanism optional | **NOT PROVEN** |
| E2 trusted capture/provenance | Reviewed witness and optional signing verifier; no independently accepted live origin/trust path | **NOT PROVEN** |
| E3 semantic parity | Frozen reproducible comparator + prior read-only support | **METHOD CANDIDATE**, fresh approved evidence still missing |
| Prospective G3 exception/approval | Minimal non-executable contract | **NOT APPROVED** |

```text
HISTORICAL_G3_GOVERNANCE      = RECONCILIATION_REQUIRED
HISTORICAL_ROLLBACK           = UNKNOWN; REPLAY CONSUMED
TRUST_MODEL                   = UNSELECTED
E1_WRITER_CONTAINMENT         = NOT_PROVEN
E2_TRUSTED_ORIGIN             = NOT_PROVEN
E3_ADMISSIBLE_LIVE_PROOF      = NOT_OBTAINED
VERSIONED_G3_EXCEPTION        = NOT_APPROVED
HUMAN_FORWARD_ADOPTION_TARGET = NOT_CREATED
WRITER / SERVICE / G4         = BLOCKED
PRODUCTION_DB_MUTATION        = NONE
```

**Do not mistake a narrower implementation contract for permission to release any G2/G3 hard stop.** The non-executable code/tests remain usable, but neither an off-host signer nor a two-inode ext4 immutable feature is prescribed unconditionally.
