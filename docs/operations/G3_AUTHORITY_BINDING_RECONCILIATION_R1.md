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

1. obtain a separate explicit human authorization for the reconciliation rollback;
2. revalidate that the active Schema11 hash is still exactly `0eae48...`;
3. revalidate that the preserved Schema10 hash is still exactly `5d6528...`;
4. require zero active DB users and no SQLite sidecars;
5. perform one bounded same-filesystem atomic exchange to restore the exact Schema10 prestate;
6. independently verify Schema10 / integrity / FK / exact hash;
7. keep writers disabled;
8. merge/freeze the complete re-execution authority surface first;
9. generate a **new** G3 operation ID and authority target whose `authorityHead` is that post-merge frozen authority head;
10. obtain a fresh exact human approval before the new attempt;
11. re-execute 10→11 once and independently classify the terminal result.

The prior replay identity and approval are never reused.

## Current hard stop

Until reconciliation is explicitly authorized and completed:

```text
NO G4
NO writer readmission
NO production service start
NO automatic retry
NO rollback
```

The machine-readable authority for this record is:
`docs/operations/g3-authority-binding-reconciliation.r1.json`.
