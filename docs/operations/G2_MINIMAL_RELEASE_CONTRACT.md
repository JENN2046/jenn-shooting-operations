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
| `G2_I1_DURABLE_WRITER_CONTAINMENT` | Normal writers must be durably disabled and all in-flight writers drained before cutover. Process lifetime is not authority. If containment cannot be proven, the cutover is **not executed**. |
| `G2_I2_EXACT_ARTIFACT_BINDING` | G3 must bind one exact source commit, image digest, Schema 11 migration checksum and one authority-target object. Human approval must bind the computed digest of that complete target, and trusted verification must confirm both artifact evidence and approval evidence. Drift is forbidden. |
| `G2_I3_VERIFIED_PRESTATE_RECOVERY` | G3 requires an exact active-database-family digest, a pre-state digest equal to that active family, a recovery artifact explicitly bound to the same pre-state, an independent readback proof that verifies that artifact, SQLite integrity check and zero FK violations. These are trusted evidence, not self-asserted digest-shaped strings. |
| `G2_I4_EXPLICIT_CUTOVER_ENTRY` | Ordinary runtime cannot perform 10→11. Only `G3_SCHEMA11_CUTOVER` may enter the transition. Before execution, a durable one-shot ledger atomically claims replay identity `operationId + authorityTargetDigest` and records the exact `packetId`; changing `packetId` cannot create a new attempt. If the bounded execution boundary is unproven, **do not execute**. |
| `G2_I5_TERMINAL_OUTCOME_MODEL` | After an admitted attempt, the only outcomes are `COMMITTED`, `ROLLED_BACK`, or `UNKNOWN`. A terminal receipt is valid only for a durably recorded started attempt. COMMITTED requires trusted Schema 11 verification; ROLLED_BACK requires trusted exact pre-state restoration; anything unclassifiable is UNKNOWN. Automatic retry is forbidden. |
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

The future executable packet, terminal receipt and semantic validator are defined by:

- `contracts/g3-schema11-cutover-packet.v1.schema.json`
- `contracts/g3-schema11-cutover-receipt.v1.schema.json`
- `src/g3-schema11-cutover-contract-v1.mjs`

The executable packet schema accepts **APPROVED only**. A packet is invalid unless it includes all of these classes of proof:

1. exact artifact identity;
2. exact production target binding;
3. verified pre-state and recovery readback;
4. durable writer-disable receipt and zero in-flight writer proof;
5. the single explicit G3 entrypoint and no automatic retry;
6. explicit human authorization whose approved target digest equals the computed digest of the complete authority target.

The semantic validator computes the authority-target digest from the exact authority head, artifact, production target,
pre-state/recovery evidence, writer containment and execution fields. It requires injected **trusted authority-evidence** and
**trusted approval** verifiers; schema-valid JSON and digest-shaped strings alone are never authority. Changing any target field
invalidates the approval unless the trusted approval source verifies a new approval record for that exact computed digest.
If the target/recovery/containment/boundary evidence cannot be independently verified at the execution boundary, the packet is
inadmissible and the cutover is not started.

Immediately before execution, the semantic boundary must atomically claim a replay key derived only from the approved
`{operationId, authorityTargetDigest}` in a **durable one-shot attempt ledger**, while recording the exact `packetId`
that obtained the claim. `packetId` is not allowed to partition replay identity. A second claim for that operation/target is normalized at the semantic boundary to
`RECONCILIATION_REQUIRED`; it is never another execution attempt. Terminal receipts must match the exact recorded packet.
This one-shot state must survive process restart and controller loss.

After an admitted attempt, a terminal receipt is mandatory, must correspond to a durably recorded started attempt, and must also
pass a **trusted terminal-evidence verifier**. It admits only:

- `COMMITTED` with verified Schema 11 / post-state evidence;
- `ROLLED_BACK` with verified restoration evidence matching the exact pre-state digest;
- `UNKNOWN` with writes still disabled, authoritative write capability absent, reconciliation required and retry forbidden.

Anything that cannot satisfy COMMITTED or ROLLED_BACK must be represented as UNKNOWN.

The schemas deliberately do **not** choose systemd, flock, process custody, clone/swap, or another
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

Current local validation on Node 24.21.0:

- G2 validator: **PASS**;
- G2 contract/packet/receipt tests: **9 / 9 PASS**;
- full repository suite: **1037 total, 1036 PASS, 0 FAIL, 1 existing conditional skip**.

## G2 exit

G2 may become `CLOSED` only after:

1. the six-invariant contract is reviewed with no unresolved P0/P1;
2. exact-head CI passes;
3. the contract is merged into the canonical authority branch;
4. no production action occurred as part of G2.

Only then may G3 prepare a concrete, exact cutover packet.
