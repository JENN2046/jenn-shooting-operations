# GF15 bounded capabilities implementation R1

Implementation base: `43f483217ea51ff6ff97ec4832ad6a2b4e4e2ae3`, branch
`codex/gf15-bounded-capabilities-r1`, PR base `codex/v2-1-architecture-freeze`.

This implements local domain capabilities and isolated acceptance harnesses. It does not
authorize or execute production GF15 or PROD11. The frozen Authority, its validator,
its tests and the production change manifest remain unchanged. There is no new HTTP
route, production runner, environment configuration, provider call or credential input.
Production requestability remains `FROZEN_NOT_REQUESTED` with empty action arrays.

## Domain composition

`bindGf15WindowV1` compiles the frozen request and normalized config for one supplied
Asia/Shanghai date/window. Compilation creates no authorization. `begin` requires an
already acquired durable Scheduling lease, checks zero drafts, revisions, reserved
identifiers, all nonempty database brief URLs against the supplied allowlist and the
unfiltered candidate set, then performs the pure deterministic scheduler preflight
before storing the baseline packet. The window must provide at least 1,200,000 ms.

The application-level sequence is acquire → begin → forward → postverification →
release. On failure it is rollback under the held forward lease, or reacquire a
bounded rollback lease → revalidate → rollback → release. The capability deliberately
leaves the lease held on return or failure; the caller must retain it until the
forward postcheck or containment finishes. Lease/control writes are control evidence,
not synthetic request/resource/config/schedule facts.

`createSqliteGf15RequestStoreV1` validates the exact V2 command and digest against
the baseline and writes all 36 request columns in one canonical transaction with
its operation receipt, projection revision, both snapshot projections and audit.
Source ordinal and timestamps are derived inside that transaction. Exact replay
returns the original row/time and consumes no revision, ordinal or audit entry.

Forward resource, requirements and configuration commands use the existing
Scheduling admin store. Generation uses the real SQLite input assembler without
candidate filtering; acceptance uses the existing proposal store and canonical
schedule mutation kernel. Every command packet is persisted before its first attempt.
The generated proposal must contain exactly the bound request/resource/item; the
draft set before acceptance must contain only that proposal. Later attempts cannot
choose new command fields or revisions for a persisted operation.

## Durable admission and isolation

Migration 7 adds leases, append-only control receipts, immutable command packets
and permanent Outbox exclusions. Migration 1–6 SQL and checksums are unchanged;
the existing exact-schema validator covers the new tables, index and triggers.

The lease has a unique acquisition ID, opaque token, owner, bounded lifetime and
purpose. All canonical Scheduling admin/proposal/decision/invalidation mutations,
schedule acceptance, run-fact transactions, V1 snapshot/submission writes and
canonical migration materialization check it inside their mutation transaction.
An owner cannot use the lease to submit unrelated commands. A computation started
before acquisition must pass admission again before persisting its proposal.

Expiry does **not** reopen ordinary admission. A crashed/expired lease blocks
writers until an explicit rollback acquisition recovers it. Acquisition/release
and expired recovery leave durable receipts. The stale holder cannot mutate or
release the successor. Recovery must keep the original baseline owner. If a crash
occurs before a baseline exists, no GF15 facts can have been materialized; recovery
can release the control-only lease rather than inventing a rollback baseline.

GF15 acceptance inserts its exact proposal/decision/payload exclusion inside the
same transaction, before enqueuing the real `schedule.confirmed.v1` intent. Both
commit together. No post-acceptance isolation step exists. `claimBatch` excludes
the immutable isolation row across all eligible states. The evidence intent stays
`pending` with zero attempts, while `getById` explicitly exposes its isolation
reason and binding; audit records the exclusion. Unrelated notifications remain
claimable and deliverable. Release and rollback never remove the exclusion.

## Containment and replay

Rollback first checks drafts, owner, all forward/rollback operation receipts,
current mutable values and provenance, immutable proposal/decision bindings and
the expected revision effects. It classifies the resource/config state through
the unchanged frozen ten-pair state machine before any rollback mutation.

Containment uses canonical resource replacement. Prior configuration restoration
uses canonical activation only when GF15 activation succeeded and a prior config
exists. With no prior config, the GF15 config remains while its resource becomes
inactive. Request, proposal history, decision, schedule/binding and notification
facts are preserved. Partial forward and partial rollback states remain valid.

Rollback resource/config packets persist the exact first-attempt JSON, digest and
revisions before invoking the canonical store. A transaction failure or crash can
replay that packet; it cannot recapture a newer revision. Resource containment and
config restoration retries return canonical exact-replay receipts. Any later
Scheduling ownership/revision drift or receipt inconsistency fails closed.

## Validation and independent review

Run with Node `24.21.0` and npm `11.4.2`:

```sh
node --test tests/gf15-*.test.mjs
npm run check
node scripts/verify-migration-recovery-acceptance.mjs
node scripts/verify-external-readiness-boundaries.mjs
```

Final local results: GF15 targeted tests **37 pass / 0 fail / 0 skip / 0 todo**;
`npm run check` **841 pass / 0 fail / 1 existing external VCP runtime skip / 0 todo**
(842 tests). All four check validators passed. Recovery acceptance reported
`WO_06B_FRESH_ACCEPTANCE_PASS`; external boundary verification reported
`WO_06C_LOCAL_EXTERNAL_BOUNDARY_PASS` with zero network delivery calls. These are
local implementation results; external device/provider readiness remains pending.

The GF15 suites use temporary/in-memory SQLite databases. They cover full-row
attestation, canonical migration ordinals, command/date collisions, enqueue and
projection faults, all staged forward failures, all ten rollback pairs, partial
rollback/config failure, durable exact retry, wrong/stale owners, SQL conflict
clause sealing, unrelated drafts and corrupt/later-owned poststates. Separate
worker connections race real `claimBatch` at the inserted-but-uncommitted enqueue
boundary and race a pre-acquisition computation against proposal persistence.
Delivery is tested with a local fake adapter only.

Independent review should focus on canonical writer coverage, transaction/lease
boundaries, first-attempt rollback revision binding, the ten state pairs, schema
upgrade/drift checks and atomic isolation/query visibility. Trusted clocks,
principals and baseline ownership are internal application inputs; they do not
substitute for a future exact production authorization/target attestation.

Deployment assumptions: all Scheduling writers and Outbox workers must run this
version before any future authorized GF15 operation; old workers do not understand
the exclusion table. SQLite owner/admin access remains outside domain admission
and must be controlled by the production writer inventory. No production host,
database, container, provider or network delivery was used to validate this PR.

Stop state: `GF15_CAPABILITIES_IMPLEMENTED / AWAITING_INDEPENDENT_REVIEW`.
