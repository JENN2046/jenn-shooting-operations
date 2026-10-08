# G3 In-Place Adoption Proof R1

**Gate:** BLOCKED_INSUFFICIENT_EVIDENCE

**Purpose:** Determine whether the currently active physical Schema11 can be adopted prospectively without editing its database bytes or retroactively validating the original G3 authority mismatch. This report is an evidence artifact, NOT permission to mutate production, retry an operation, clear reconciliation, start services, release writers, or enter G4.

## Authority and immutable incident

- Repository: JENN2046/jenn-shooting-operations.
- Canonical branch: codex/v2-1-architecture-freeze.
- Frozen starting authority head: 371bf8982b0cd0df579b0e981964b27f9d0319fc (PR #54 merge); reconfirm before any later action.
- Historical approved G3 authority head: a4199fdb14808ebb866943148a222b0d4300d66e.
- Historical execution canonical head: b9dd595eb52bd09f7a8e2115a48ac401389f5b73.
- These heads differ. The G3 physical receipt stays COMMITTED; the G3 governance result stays RECONCILIATION_REQUIRED. Both are historical facts, not contradictory replacements.
- Old rollback claim SHA256 bfd40da521d2a3871ffcf4b4913de260d51c368eeca0ca775c4bda6b25b5645a remains UNKNOWN and its replay key remains irreversibly consumed.

## 1. Fresh production read-only identity

Observed via the authorized production SSH path on 2026-10-08T02:14:45Z. This is a live operational observation, **not cryptographic production-origin attestation**.

| Fact | Active Schema11 | Preserved Schema10 |
| --- | --- | --- |
| SHA256 | 0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9 | 5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7 |
| Size | 540672 | 512000 |
| Device / inode | 64784 / 2229903 | 64784 / 1835048 |
| SQLite schema | 11 | 10 |
| Integrity check | ok | ok |
| Foreign-key violations | 0 | 0 |
| WAL/SHM/journal sidecars | none | none |

- Production service container matching jenn-shooting-operations-prod: absent.
- At observation, lsof and fuser showed no users of these two DB paths.
- Old rollback attempt hash was reobserved unchanged. This does **not** authorize clearing its terminal UNKNOWN.
- The active and preserved hashes match the earlier independently recorded physical identities.
- These containment samples are snapshots; they cannot replace fresh verification immediately before a future permission boundary.

## 2. Row-set parity on actual production data (no raw row disclosure)

A read-only verifier opened both files via SQLite URI mode=ro&immutable=1 and PRAGMA query_only=ON, compared typed, length-delimited, order-independent row-set SHA256 digests, retaining multiplicity and including BLOB/NULL/INT/REAL/TEXT distinctions. No database rows, raw payloads or row-level digests were printed or checked into this repository.

- 39 user tables common to Schema10 and Schema11, including schema_migrations.
- 38/38 other common user tables: matching column sets, row counts and complete row-set digests. This includes the rebuilt scheduling_config_versions table.
- All ten pre-existing schema_migrations rows (including applied_at) match exactly; their complete normalized-row digest is sha256:20e76fece64d733d50e68f852c98a665d2dd77f0f258e9b05c0739f8003f1445.
- The new Schema11 marker has the expected version/name/checksum, and its applied_at has valid UTC millisecond ISO format. Its actual timestamp was **not** treated as a deterministic replay invariant.
- Internal SQLite table sqlite_sequence: 1 row on each side, exact row-set match.
- Newly introduced schedule_reschedule_operations and agent_grant_attempts: both present and empty.
- No old user tables removed.
- No mismatched legacy row-set digests observed.

This is strong semantic consistency evidence, **not** an unqualified proof that the original production migration was properly authorized.

## 3. Byte-exact DDL and column-shape parity with the pinned original image

Pinned image identity checked on the isolated workstation:

~~~text
image id = sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144
OCI source revision = 6334e2ae851247cb1558074fbd80cfee06b28c11
Migration11 = business_calendar_and_reschedule
Migration11 checksum = sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8
~~~

The exact original NODE_MIGRATE runner was extracted from the checked-in G3 executor. On a disposable local **synthetic** database containing one synthetic scheduling-config row, the pinned image ran Schema10 -> Schema11 using:

- network disabled, read-only container root, non-root UID/GID 1000;
- all Linux capabilities dropped, no-new-privileges, private RW synthetic fixture directory only;
- no production database or host production volume mounted.

Result: version 10->11, schema_migrations count 11, integrity ok, FK=0, preserved synthetic scheduling-config row unchanged, and both new tables empty. The fixture was automatically disposed.

Independent read-only production inspection used SELECT type,name,tbl_name,sql FROM sqlite_schema and PRAGMA table_xinfo. In each version, the **entire** normalized JSON manifest SHA256 matched the corresponding pinned-image synthetic schema, even though the databases had different business data.

| Schema | Both sides schema object digest | Both sides table-xinfo digest | Counts |
| --- | --- | --- | --- |
| 10 | sha256:c9dc6643560b4439f2a635bbc71107eca3b2130589f453dbeb472d2101117e39 | sha256:2af54e93c3ed07ca86aa43a2b1a4aad8a263fef2aaefc45c7867939d01b72bf2 | 40 tables, 68 indexes, 75 triggers |
| 11 | sha256:06a1e4b55b0f022bce9d8b2427bd844be6e8b7afe4afa0d6c49547c5ce0c753d | sha256:eb832e1a61e67fda4327ba31dd4a162e9b9e8a965e1318a28f2d5a2041f9d204 | 42 tables, 71 indexes, 81 triggers |

A Migration11 source audit confirms that it rebuilds scheduling_config_versions by copying the original rows through a temporary table. Thus a checksum-and-DDL-only check would have been insufficient; the full read-only row-set parity described above is an independent necessary check.

## 4. Method and trust limits

The following items are NOT claimed:

1. No production Schema10 raw bytes were moved to the workstation. That attempted transfer was disallowed by the execution safety boundary, and was **not** bypassed.
2. A full replay of the **actual** preserved production Schema10 inside the exact Node migration image, with an independent rebuilt candidate and side-by-side exhaustive physical comparison, was not performed. The successful image replay used a **synthetic** input.
3. The production observations are from authorized live read-only SSH queries, not a root-owned independently signed remote attestation. Self-consistent repository facts and hashes are not automatically trusted production provenance.
4. No new exact forward-adoption packet, owner-signed target, human approval, durable forward-adoption claim or independent admission receipt exists.
5. No production-image, readmission or G4 permission has been granted.

Therefore, although the presently observed full row-set and DDL comparisons strongly support **semantic parity**, they do not satisfy every method and provenance gate in Issue #55. A future independent reviewer must either (a) obtain the missing **authorized** exact real-prestate replay and trustworthy attestation, or (b) expressly approve this non-exfiltrating full-state comparison methodology as an equivalent proof standard through a separate versioned governance decision. An authorization request cannot be constructed from this report alone.

## 5. Decision

~~~text
IN_PLACE_ADOPTION_FEASIBILITY = CONDITIONALLY_FEASIBLE
ISSUE_55_FINAL_GATE         = BLOCKED_INSUFFICIENT_EVIDENCE

RECONCILIATION_REQUIRED = true
HISTORICAL_G3_COMPLIANT  = false
OLD_ROLLBACK_UNKNOWN     = preserved, never retried
FORWARD_ADOPTION_TARGET  = NOT_CREATED
HUMAN_APPROVAL           = NOT_REQUESTED
WRITER_READMISSION       = false
SERVICE_START            = false
G4                       = BLOCKED
PRODUCTION_MUTATION      = NONE
~~~

The physical rollback alternative established by PR #54 is **available but not authorized or triggered**. The next safe step is an independent review of the two proof-method/provenance limitations and of the proposed forward-only governance contract. Never interpret this feasibility report as a G3 pass or as permission to change the startup gate.
