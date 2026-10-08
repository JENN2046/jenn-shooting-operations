# G3 Forward Adoption Evidence and Contract R1

**Status: FROZEN NON-EXECUTABLE REVIEW CANDIDATE / ADMISSION BLOCKED**

This is a *G3 reconciliation sub-action proposal*, not another top-level gate, G3 cutover, rollback, writer startup, service start, or G4 entry. It addresses only the P1 + two P2 findings on Draft PR #56 (Issue #55). Review base is canonical `371bf8982b0cd0df579b0e981964b27f9d0319fc`; the exact final authority head must be captured **after any future reviewed merge**. No executable target, signer trust root, signed production witness, human approval or new one-shot claim is being created.

## 1. The only three proof corrections

### P1. Durable containment of *both* original physical database files

Before any forward-adoption claim, an **independently trusted, durable containment attestation** must prove that every authorized production writer, rollback helper and other pre-existing capability able to modify **either** active Schema11 or preserved Schema10, including bind mounts, aliases and container mount namespaces, has been effectively revoked or is otherwise physically fenced. Ordinary process/service absence, `lsof`/`fuser`, read-only SQLite connections, `immutable=1`, or an unlocked helper PID is **not** that proof. A writable alias or idle volume-capable process is a hard block. State the privileged administrator/root-custody threat model explicitly; a root-controlled script cannot claim that it neutralizes an untrusted hostile root.

The witness opens both paths with `O_RDONLY | O_NOFOLLOW`, pins regular-file descriptors with `fstat`, bounds file sizes, checks sidecars, reads only via `pread`, rejects changed identity or bytes and verifies the same opened descriptors and path identities after SQLite comparison. Its SQLite execution is on **in-memory deserialized snapshots** of those bytes, never on writable production SQLite handles. These checks improve snapshot coherence but do **not** establish durable capability revocation by themselves. No such attestation exists in this PR; consequently all captured observations remain **non-admissible** for production approval.

The eventual trusted containment witness must bind two exact dev/inode/size/hash/mode/owner identities, all reachable filesystem aliases and mount namespaces, the previously consumed rollback attempt, pre/post stability, the independently approved signer, and a durable revocation proof immediately before a future one-shot claim. If a capability cannot be fenced or its status is uncertain, do not claim and do not approve. No production containment settings are modified in this review.

### P2. Reproducible verifier and independently origin-signed transcript

Added only two offline-compatible, non-admission scripts:

- `scripts/g3-forward-adoption-readonly-witness.py`: a bounded and fail-closed read-only observation program. Its output captures verified open-file identities, verifier and runtime identities, precise table list/counts/order-independent typed row-set hashes (including NULL, BLOB, float, duplicates and rowid), complete observed DDL/column digests, index_xinfo/foreign key/index-list/table-list summaries and header policy. **No raw production rows are exported.** All errors are `WITNESS_FAIL_CLOSED`.
- `scripts/verify-g3-forward-adoption-witness-signature.mjs`: validates an external Ed25519 signature on a canonical transcript, explicit signer SPKI fingerprint, capture digest and verifier digest. Even a valid signature **only means the bytes were signed by the matching key**. A caller-supplied key is not a trusted production-origin attestation; the key must be pinned by independently authorized governance evidence, currently **NOT_BOUND**. Verification only emits `SIGNED_READONLY_OBSERVATION_NOT_ADMISSION` and never opens any write gate.

Both exact SHA256 code digests are pinned in `g3-forward-adoption-evidence-and-contract.r1.json`. No production private signing key exists or is requested here. The reviewed verifier and signed capture must be executed by an independently authorized origin witness in a later, separate task. The previous repository-authored 38/38 summary and existing clean GitHub CI are valuable evidence but **not** that independently signed witness.

### P2. Explicit SQLite semantic equivalence domain

The observation includes **all** user and SQLite internal tables (including `sqlite_sequence` and `sqlite_stat*` if present), row multiplicity and rowid where supported, exact migration-record prefix and bounded version11 timestamp checks, `sqlite_schema`, `table_xinfo`, `index_xinfo`, `index_list`, `foreign_key_list`, `table_list`, `application_id`, `user_version`, `encoding`, `page_size`, `auto_vacuum`, file-header format read/write bytes, integrity and FK checks. Exact schema/column manifest hashes for both versions are already pinned from the original immutable image comparison. If the pinned schema object inventory or required field drifts, the project G3 profile reports failure.

**Deliberate exclusions:** `schema_version` is changed by the migration; `page_count` and `freelist_count` represent physical page allocation rather than logical database semantics. `cache_size`, `synchronous` and `data_version` are connection-local/runtime policy values; source `journal_mode` is not inferred from an in-memory SQLite handle and must instead be checked through the source file's header read/write versions and absence of sidecars. The newly created Migration11 `applied_at` is non-deterministic, but the first ten full migration rows (including timestamps) must match byte-for-byte. Any excluded field whose materiality becomes relevant must be explicitly reviewed, not silently ignored.

The witness does **not** claim byte-identical Schema10 and Schema11 files. It targets bounded *application-semantic* parity, with explicit physical non-equivalence where Migration11 changes schema/allocation.

## 2. Minimum future-only G3 reconciliation contract

Proposed action: `G3_FORWARD_SCHEMA11_BASELINE_ADOPTION_R1`.

Only after the review surface is merged and separately approved, a future exact target would bind:
- then-current canonical authority head, approved contract/version/digest, approved signer identity, exact observer and signature verifier code digests and runtime;
- fresh active Schema11 and preserved Schema10 file identities, trusted parity evidence and durable two-file containment attestation;
- historical original G3 physical `COMMITTED` but governance `RECONCILIATION_REQUIRED`, old approved/execution authority-head mismatch and the permanently consumed rollback `UNKNOWN`;
- a new unique operation/replay identity, a new pre-claim signed **explicit human approval** for the exact target digest, and a root-controlled append-only audit receipt effective *only from new admission time*.

There can be **no** reuse of original G3/rollback identities, re-dating of approval, mutation or relabeling of historical receipts, default release of normal writes, automatic service startup, or G4 entry. A new receipt may say `RECONCILED_FORWARD_ONLY` without changing the old `RECONCILIATION_REQUIRED` incident. The old G2/G3 contract does not itself authorize this new action: a separately signed, reviewed **versioned G3 governance exception/amendment** must explicitly permit this G3 sub-action while preserving G2's historical invariants and `NO_NEW_GATE_FAMILY`.

After any successful future-only baseline adoption, **writer readmission, service startup and G4 still require separate fresh evidence and human authorization**. The existing source startup gate and G3 validator remain unchanged and fail-closed in this PR.

## 3. Explicit audit outcomes

| Proof requirement | Code or evidence present here | Authority disposition |
| --- | --- | --- |
| P1 durable two-file capability revocation | Exact mandatory predicate and pinned read-only snapshot implementation; independent durable witness not yet available | **BLOCKED** |
| P2 exact comparator / signed transcript | Frozen scripts and adversarial synthetic tests; external origin signer not bound, no signed live capture | **BLOCKED** |
| P2 SQLite metadata coverage | Deterministic comparison domain + explicit exclusions and negative synthetic fixtures | **IMPLEMENTED AS REVIEW CANDIDATE** |
| G3 prospective governance exception | Minimal versioned non-executable contract; no authorized exception/target/approval | **BLOCKED** |

```text
TECHNICAL_METHOD_STATUS      = FROZEN_REVIEW_CANDIDATE
ORIGIN_TRUST_ANCHOR          = NOT_BOUND
DURABLE_TWO_FILE_CONTAINMENT = NOT_PROVEN
SIGNED_PRODUCTION_WITNESS    = NOT_CREATED
FORWARD_ADOPTION_TARGET      = NOT_CREATED
HUMAN_APPROVAL               = NOT_REQUESTED
HISTORICAL_G3_GOVERNANCE     = RECONCILIATION_REQUIRED
OLD_ROLLBACK                 = UNKNOWN
WRITER_READMISSION           = BLOCKED
PRODUCTION_SERVICE           = BLOCKED
G4                           = BLOCKED
PHYSICAL_ROLLBACK            = NOT_PERFORMED
```

**Review boundary:** Do not broaden this patch into a general G3 redesign or production activation. Reject future admission if any of the three proof requirements or explicit prospective human authority is missing. Evidence-only validation success never substitutes for a legally admitted production operation.
