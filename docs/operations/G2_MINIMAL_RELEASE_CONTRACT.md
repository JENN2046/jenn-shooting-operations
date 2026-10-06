# G2 Minimal Release Contract Freeze

Status: **G2 FREEZE CANDIDATE / NOT EXECUTABLE / NO PRODUCTION AUTHORITY**

Authority base:

`codex/v2-1-architecture-freeze @ 175586e2c67c94ad61fae6c5964c106f0966dda8`

G2 exists only to constrain the future G3 Schema 11 cutover. It does not execute a migration,
create an authorization request, mutate production, select a permanent supervisor, or revive any
historical PROD/GF/C01/custody gate family.

## Frozen six invariants

| ID | Frozen rule |
| --- | --- |
| `G2_I1_DURABLE_WRITER_CONTAINMENT` | Normal writers must be durably disabled and all in-flight writers drained before cutover. Process lifetime is not authority. If containment cannot be proven, outcome is `UNKNOWN`. |
| `G2_I2_EXACT_ARTIFACT_BINDING` | G3 must bind one exact source commit, image digest, Schema 11 migration checksum and one authority-target object. Human approval is structurally bound inside that exact target object. Drift is forbidden. |
| `G2_I3_VERIFIED_PRESTATE_RECOVERY` | G3 requires an exact active-database-family digest, recovery artifact, an independent readback proof that verifies that artifact, SQLite integrity check and zero FK violations. |
| `G2_I4_EXPLICIT_CUTOVER_ENTRY` | Ordinary runtime cannot perform 10→11. Only `G3_SCHEMA11_CUTOVER` may enter the transition. The execution capability must be bounded so an UNKNOWN executor cannot retain authoritative write capability; non-database production mutation is forbidden. |
| `G2_I5_TERMINAL_OUTCOME_MODEL` | The only outcomes are `COMMITTED`, `ROLLED_BACK`, or `UNKNOWN`. COMMITTED requires verified Schema 11; ROLLED_BACK requires verified restoration of the pre-state; anything unclassifiable is UNKNOWN. Automatic retry is forbidden. |
| `G2_I6_UNKNOWN_BLOCKS_READMISSION` | `UNKNOWN` keeps normal writes disabled. Human reconciliation plus fresh readmission evidence is required before re-enable. |

## Exact Schema 11 binding

G2 freezes the current migration identity:

```text
version  = 11
name     = business_calendar_and_reschedule
checksum = sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8
```

The G3 packet must additionally bind the future exact authority head and image digest. G2 does not
pretend those future artifacts already exist.

## G3 packet boundary

The future execution packet is defined by:

`contracts/g3-schema11-cutover-packet.v1.schema.json`

A packet is invalid unless it includes all of these classes of proof:

1. exact artifact identity;
2. exact production target binding;
3. verified pre-state and recovery readback;
4. durable writer-disable receipt and zero in-flight writer proof;
5. the single explicit G3 entrypoint and no automatic retry;
6. explicit human authorization nested inside the exact authority-target object before execution.

The schema deliberately does **not** choose systemd, flock, process custody, clone/swap, or another
physical implementation. G3 may choose a bounded mechanism only after fresh production facts are observed.
That mechanism must prove that controller loss / UNKNOWN cannot leave an executor with authoritative write
capability. A process merely staying alive, holding a lock, or being paused is not such proof.

## Explicit non-goals

G2 must not:

- perform or authorize Schema 11 cutover;
- write to production;
- create a permanent owner/helper/supervisor;
- use process survival as durable authority;
- invent another gate family;
- infer a production target from historical repository evidence;
- turn `UNKNOWN` into retry, success, rollback, or re-enable without reconciliation.

## Validation

```bash
npm run validate:g2-release-contract
node --test tests/g2-minimal-release-contract.test.mjs
```

The validator also checks that the frozen migration name/checksum still match the live Schema 11
definition in source. A later source change therefore cannot silently leave the release contract stale.

## G2 exit

G2 may become `CLOSED` only after:

1. the six-invariant contract is reviewed with no unresolved P0/P1;
2. exact-head CI passes;
3. the contract is merged into the canonical authority branch;
4. no production action occurred as part of G2.

Only then may G3 prepare a concrete, exact cutover packet.
