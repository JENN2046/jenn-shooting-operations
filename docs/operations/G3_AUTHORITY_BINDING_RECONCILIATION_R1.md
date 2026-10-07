# G3 Authority Binding Reconciliation R1

Status: **RECONCILIATION_REQUIRED / WRITERS REMAIN BLOCKED**

Canonical authority after the merged terminal evidence:

```text
codex/v2-1-architecture-freeze
@
1655d3646799d8a5923648bfbd033a690d8b03d0
```

## Why G3 is being reopened for governance reconciliation

The physical Schema10→11 exchange is independently verified and remains unambiguous:

```text
active Schema = 11
active DB sha256 =
sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9

migration11 =
business_calendar_and_reschedule
sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8

integrity_check = ok
foreign_key_check = 0
WAL / SHM / journal = absent
```

The exact pre-cutover Schema10 bytes are also preserved after the atomic exchange:

```text
/mnt/datadisk0/g3-schema11-cutover/G3-SCHEMA11-OP-20261006-R1/candidate.sqlite

sha256 =
sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7

Schema = 10
migration11 = 0
integrity = ok
FK = 0
```

However, a later independent review identified a governance mismatch:

```text
approved authorityTarget.authorityHead =
a4199fdb14808ebb866943148a222b0d4300d66e

canonical authority at execution =
b9dd595eb52bd09f7a8e2115a48ac401389f5b73
```

These heads are not equal. G2 requires the future G3 packet to bind the exact authority head. The execution-time canonical head also included executor/containment hardening introduced after the approved authority head.

The R2 approval correctly bound the exact executor, target, prestate, recovery, migration identity and one-shot operation digest, but it cannot be rewritten after execution to claim a different pre-execution authority head.

Therefore:

```text
physical terminal state = COMMITTED
G3 governance closure = RECONCILIATION_REQUIRED
G4 entry = BLOCKED
normal writer readmission = NOT AUTHORIZED
production service start = NOT AUTHORIZED
```

This is not a statement that the Schema11 bytes are corrupt or ambiguous. It is a statement that the exact pre-execution governance admission is not clean enough to close G3 under the frozen contract.

## Why no retroactive approval

A new approval issued now cannot make the earlier attempt satisfy a requirement that approval be bound before execution.

The reconciliation must not rewrite history:

- do not change the old approval target to the newer authority head;
- do not issue a backdated approval;
- do not reuse the old one-shot replay identity;
- do not classify this defect away by treating current Schema11 as if it were admitted under a target that did not exist at approval time.

## Evidence provenance boundary

The checked-in terminal JSON, attempt record and their repository-pinned hashes prove internal consistency and byte integrity. They do **not**, by themselves, prove that the artifacts originated from production: a repository author can create a file and then record its hash in the same change.

This reconciliation therefore does not allow repository evidence alone to authorize any production mutation.

A fresh live read-only production observation has independently confirmed the current active Schema11 hash, preserved Schema10 hash and durable attempt-record hash, with zero open DB users. That live observation is operational evidence, not a cryptographic production attestation, and it must be repeated immediately before any reconciliation rollback.

Therefore:

```text
repository evidence alone = insufficient for production mutation authority
fresh live read-only verification = mandatory before rollback
cryptographic production attestation = not claimed
```

This explicitly absorbs the terminal-provenance finding surfaced on the superseded #50 verification line.

## Current recovery resolution

The first exact reconciliation rollback authority was frozen and explicitly approved, but its one-shot attempt entered `UNKNOWN` before `RENAME_EXCHANGE`.

Read-only forensics established:

```text
old rollback attempt = DURABLY CLAIMED
old terminal outcome = UNKNOWN
failure = post-claim canonical GitHub lookup timeout
RENAME_EXCHANGE = NOT EXECUTED
active Schema11 bytes = unchanged
preserved Schema10 bytes = unchanged
```

The old rollback replay identity is permanently consumed and must never be retried or reused.

The current repair is therefore a **new human reconciliation operation**, defined by:

`G3_ROLLBACK_UNKNOWN_RECONCILIATION_RECOVERY_R1`

Its authority surface uses a new action, operation, packet and target digest. It must bind the exact prior UNKNOWN attempt as evidence and requires a fresh explicit human approval after the post-merge exact recovery target is frozen.

The executor boundary is also corrected. All external and fallible authority checks, including the final canonical GitHub lookup, occur **before** the durable one-shot claim. The claim is the authority-admission boundary. After a durable claim, the executor performs no network or remote authority lookup and may only execute the local atomic exchange, durability fsyncs and unclassified output.

This is not an automatic retry. It is a new, separately authorized reconciliation operation.

See:

`docs/operations/G3_ROLLBACK_UNKNOWN_RECONCILIATION_RECOVERY_R1.md`

and:

`docs/operations/g3-rollback-unknown-reconciliation-recovery.r1.json`.

## Current hard stop

Until the recovery authority surface is reviewed and merged, then an exact post-merge recovery target is frozen and separately approved:

```text
NO G4
NO writer readmission
NO production service start
NO automatic retry
NO reuse of the prior rollback replay identity
NO mutation of the prior attempt ledger
NO recovery approval before exact target freeze
NO recovery
```

Next action is:

```text
REVIEW_AND_MERGE_RECOVERY_AUTHORITY_SURFACE
```

Only after merge may a new exact recovery target bind the post-merge canonical head, new executor digest, prior UNKNOWN attempt, current Schema11/Schema10 identities, the exact read-only recovery terminal verifier, and containment evidence.

The machine-readable authority for this record is:
`docs/operations/g3-authority-binding-reconciliation.r1.json`.
