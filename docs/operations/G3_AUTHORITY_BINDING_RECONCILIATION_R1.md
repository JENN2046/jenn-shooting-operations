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

## Preferred resolution

Because normal writers and the production service have remained disabled, the active Schema11 database is still byte-identical to the atomic-exchange candidate. No post-cutover production writes need to be preserved.

The preferred clean repair is therefore:

`G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_TO_10`

The rollback itself is **not yet requestable**. The authority surface must be frozen before any human approval:

1. merge this reconciliation authority-surface PR first, including the startup gate, exact rollback executor, executor digest, rollback action/operation/packet identities, and independent one-shot replay contract;
2. from that merged canonical head, create the exact rollback target **without changing the authority surface**, binding that post-merge canonical `authorityHead`, the exact executor digest, active Schema11 identity, preserved Schema10 identity, containment requirements and replay identity;
3. prohibit any rollback approval request until the exact rollback target digest exists; no action-ID-only or free-form approval is valid;
4. after target freeze, require the canonical authority head to remain unchanged through approval and execution; any head drift invalidates the target and requires a fresh freeze and fresh approval;
5. obtain a separate explicit human approval bound to that exact rollback-target digest;
6. immediately before execution, perform fresh live read-only verification of both authority and production state: canonical head, active Schema11 hash, preserved Schema10 hash, zero active DB users, absent SQLite sidecars and stopped production service;
7. durably claim the new rollback one-shot replay identity before the atomic exchange; packet IDs cannot partition replay identity and automatic retry is forbidden;
8. perform one bounded same-filesystem `renameat2(RENAME_EXCHANGE)` to restore the exact Schema10 prestate;
9. independently verify exact Schema10 restoration, integrity/FK, preserved exchanged-out Schema11 and continued writer containment;
10. keep writers disabled and production service stopped;
11. only after rollback terminal classification, freeze/merge a **new** G3 re-execution authority surface, generate a new operation/target, obtain a fresh exact pre-execution approval, and execute 10→11 once under that new authority.

The prior G3 replay identity and approval are never reused. The rollback replay identity is also single-use and cannot be reused to toggle the files a second time.

## Current hard stop

Until reconciliation is explicitly authorized and completed:

```text
NO G4
NO writer readmission
NO production service start
NO automatic retry
NO rollback approval before exact target freeze
NO rollback
```

Next action is **not** a production authorization request. It is:

```text
MERGE_RECONCILIATION_AUTHORITY_SURFACE_THEN_FREEZE_EXACT_ROLLBACK_TARGET
```

Only after that exact target exists, binds the post-merge canonical head, and passes fresh authority/production verification may an exact rollback approval be requested.

The machine-readable authority for this record is:
`docs/operations/g3-authority-binding-reconciliation.r1.json`.
