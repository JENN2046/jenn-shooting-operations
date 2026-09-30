# Candidate replacement deployment proposal R1

Status: **REVIEW PROPOSAL ONLY — NO PRODUCTION AUTHORIZATION OR EXECUTION**.
The candidate binding and local evidence are in
`docs/acceptance/jso-candidate-release-evidence.r1.json`. References to that binding
below mean its exact immutable image digest and OCI source revision, never its tag
alone. This proposal does not amend either existing authority JSON file.

## Scope and source

Authority base: `codex/v2-1-architecture-freeze`, freshly read at
`302c7224f92eab79989fe53d259056519ff1832d` (PR37 merge; PR37 source
`6f2274436f2bfefa43bcaa9a713b0e5cb55b84ce`). The old default branch is not a base.
The preparation PR adds a packaging fix: copy the exact Greenfield authority JSON
that `src/gf15-contract-v1.mjs` imports at startup. The original Dockerfile builds
but its unmounted server fails `ERR_MODULE_NOT_FOUND`. An image with test docs
mounted does not prove standalone startup. That original image is ineligible.

Proposed deployment identifier: `PROD-CANDIDATE-REPLACE-KIOSK-DISABLED-R1`.
This is a proposal identifier, not an admitted action ID. A separate reviewed,
explicitly approved action packet must bind it before any production activity.
It is distinct from GF15, WO03 setup, PROD11 and normal-operation transition.

Historical target (requires fresh verification during a separately authorized
deployment): instance `ins-mi85f3my`, application directory
`/mnt/datadisk0/apps/jenn-shooting-operations`, container
`jenn-shooting-operations-prod`, loopback `127.0.0.1:3800:3800`, volume
`jenn-shooting-operations_shooting_data:/app/data`, database
`/app/data/shooting-operations.sqlite`. No live fact was inspected in this task.

## Required action packet before approval

Bind fresh host/instance identity, current container ID, immutable old image ID,
OCI revision, exact topology/configuration inventory with secret values redacted,
volume source/destination/device/inode, database path/device/inode and schema
prefix/checksums, route file digest, health, write-admission/cleanup controls,
VCP continuity baseline, DingTalk/provider state and all mount owners. Historical
`92b7137...`/schema-v6 evidence is a comparison baseline, not a fresh rollback target.

Bind candidate source, manifest digest, config digest, diagnostic tag resolution,
platform, local archive transport checksum if selected, maintenance duration,
writer-drain receipt, backup checksum/restore drill, and selected compatible
rollback image plus exact rollback effects. Registry publication is not authorized;
offline `docker save/load` transport is a possible later action requiring its own
approved target and archive verification. A local RepoDigest does not imply upload.

The runtime's code, scripts, contracts, public assets, package lock and imported
authority JSON must match the frozen source. Evidence-only PR commits do not
replace that source binding. Rebuilds require a new digest, retest and rebind.

## Bounded forward proposal

1. Freshly pass host identity, disk/port/route conflicts, immutable image/OCI
   revision/tag, secret storage, startup configuration, external readiness and
   rollback-target checks. Reject any unbound topology or integration change.
2. Under the separately approved maintenance window, fence HTTP writers,
   background writers, cleanup, other volume owners and direct storage writers;
   drain in-flight transactions and record revisions/fact inventories. This
   proposal cannot improvise a live fence, signal or cleanup lifecycle.
3. Make a SQLite-consistent backup and verify it using a separately approved
   production-local backup location and restore drill. Preserve WAL/SHM handling,
   attachments and ownership; do not naively copy a live SQLite main file. Never
   mount or copy production storage into WO03 or a local test container.
4. Stop/replace only the exact approved application container. Start the candidate
   **by immutable digest**, preserving volume, port, read-only rootfs, `/tmp` tmpfs,
   no-new-privileges, restart policy, role-token inputs and all VCP/provider
   bindings. Add `KIOSK_SERVICE_CONTEXT=PROD11_PRODUCTION`. Keep
   `KIOSK_AUTH_CONFIG_PATH`, Kiosk auth bind and all smoke env variables absent.
   No production credential/profile or GF15/schedule/run operation is an effect.
5. The first writable store open automatically applies the continuous migrations
   through v9. Observe exact migration markers/checksums, integrity/foreign-key
   checks, database/attachment identities and business-fact inventories. Verify
   new smoke control tables are empty; no enabled smoke application was constructed.
6. Verify health, unauthorized write denials, Kiosk `AUTH_NOT_CONFIGURED`, zero new
   Kiosk event facts, unchanged VCP state/continuity and unchanged DingTalk/provider
   state. Only after these and rollback readiness pass may the approved maintenance
   fence be released. Preserve exact lifecycle and release receipts.

Any mismatch stops progression. No automatic GF15, PROD11 or integration enablement
follows successful replacement. Local tests cannot satisfy production continuity.

## Schema and rollback compatibility

| Prefix | Meaning | Recorded old v6 source | Candidate |
| --- | --- | --- | --- |
| 1–6 | Existing normalized/run-context schema; identical SQL/checksums | recognizes | recognizes |
| 7 | GF15 controls, receipts and permanent notification isolation | rejects | recognizes |
| 8 | Immutable smoke binding/phases/stop and completion Outbox isolation | rejects | recognizes |
| 9 | Permanent smoke runtime ownership, no transfer on restart | rejects | recognizes |

Local `verify-release-schema-compatibility.mjs` creates its own synthetic prefix-v6
database. It proves unchanged v1–v6 definitions, advances one version at a time,
and exercises the actual recorded old source validator: v7, v8 and v9 return
`SCHEMA_VERSION_TOO_NEW`. A candidate reopen preserves the v9 owner and rejects
deletion. This is source compatibility evidence, not an old production image test.

**Direct old-image restart on an upgraded volume is prohibited.** The old
`92b7137211bf807f178901e878a8c3d6e335cec4` runtime cannot recognize v7–v9. Do not
delete migration markers/control tables, downgrade schema, reset owners, remove
accepted receipts, or drop isolation in order to make it start.

The preferred rollback design is a separately reviewed, immutable fallback that
recognizes the exact v9 structure, preserves all smoke/outbox/ownership seals and
starts Kiosk disabled. Its image ID/source, prefix checksums, tests and lifecycle
packet must be frozen before deployment approval. No such alternate image is
created or claimed by this preparation. Remaining on the candidate with Kiosk
disabled is containment, not proof that a broken service has been rolled back.

A pre-upgrade DB restore plus old-image restart is a different, explicitly
approved recovery path. It is eligible only under a held/drained writer fence,
with zero new business/control/provider facts since the verified backup and an
exact fact/revision comparison. Once v7/GF15 or v8/v9 smoke evidence or any later
fact exists, that restore cannot preserve history and must not be used as routine
rollback. Freeze backup/restore ownership, attachment coherence and DB inode-change
acknowledgment in that recovery action; never claim storage identity is unchanged
after replacing a database file. If eligibility is not proved, retain the upgraded
DB and require forward repair on a compatible image.

PROD11 `ROLLBACK-10-DISABLE-KIOSK-CONFIG` is only same-image configuration removal;
it cannot select the old image or restore a DB. Restarting a smoke owner is replay-only
by design; it does not restore an unfinished smoke budget. Preserve all control
facts and require a newly frozen recovery authority for any new smoke attempt.

## Explicit remaining gates

Deployment approval remains blocked on fresh production facts, maintenance/fence
and backup receipts, VCP continuity proof, compatible rollback target (or a fully
bounded zero-fact restore decision), transport selection and explicit action
authorization. The actual Alpine runtime full-suite timestamp failures must be
reviewed as documented limits; do not describe them as a full-suite PASS.
The Greenfield authority remains GF15-next, `FROZEN_NOT_REQUESTED`, with all three
action arrays empty. This proposal has no effects on that authority.

## Read-only preflight and bounded recovery addendum (2026-09-30)

The later [production preflight and rollback closure](JSO_PRODUCTION_PREFLIGHT_AND_ROLLBACK_CLOSURE_R1.md)
records fresh read-only production metadata, denied live DB/protected-backup access,
and a migration-only held-fence v6-restore recovery proposal. Its production-readiness
verdict is BLOCKED. Its proposed execution, stop and recovery sequence supersedes
steps 2–6 of the bounded forward proposal above: stop the exact application container
under a held/drained writer fence before the consistent backup; start the candidate
with write admission and cleanup disabled; require a separately bound operation-release
receipt before resuming ordinary writers or cleanup. It also supersedes the generic
preferred-fallback choice for that bounded pre-release phase; direct old-image restart
on v7–v9 remains prohibited.
The observations above describe the original preparation task; the addendum owns
new live observations. Neither document authorizes replacement or restore.
