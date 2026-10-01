# Empty DB initialization, storage and cutover review packet R1

**Plan ready for review; production execution BLOCKED.** Empty-production storage
remains the chosen route. This packet closes proposed names, ordering, initialization
capability classification and decision ownership; it does not provision anything,
implement a new bootstrap feature or close an authority gate. Read with
[the rollout proposal](JSO_EMPTY_PRODUCTION_DATABASE_ROLLOUT_PROPOSAL_R1.md).
Evidence is in [the CI/bootstrap receipt](../acceptance/pr40-ci-bootstrap-plan.r1.json).

Authority merge259506955b6fe41bb008de65a305691f9e2810ee and candidate
source37ee97d5726d990e8f7178938eeb9b6c5f8b5424/image
`sha256:fd8a2fb03c86901e26c64389138bbc494491e8bf6025af1e22eec9e1f11113e7`
remain unchanged. All requested/approved/requestable arrays remain empty.

## Supported initialization versus missing implementation

| Capability on frozen source | Evidence / supported path | Production status |
| --- | --- | --- |
| Create schema1–9 and empty legacy snapshot | `ScheduleStore` constructor in `src/store.mjs`, actual frozen server startup | Supported initialization only, with admission/cleanup/Kiosk disabled; no normalized counter created |
| Initialize normalized counter/projections from a migration plan | `materializeMigrationPlan` in `src/migration-materialize-sqlite-v2.mjs` | Internal migration function requires a V1 source/plan, emptiness/identity checks and persists migration-batch provenance; not a native empty-domain command |
| Apply/restore migration CLI | `scripts/migrate-v1-to-v2.mjs`, fixture-root restrictions in `src/migration-apply-sqlite-v2.mjs` | Isolated migration executor; never relabel it as a production bootstrap or bypass its fixture/path restrictions. Old-record migration is not the chosen route |
| Register resource / publish and activate config / requirements | `createSqliteSchedulingAdminStoreV1` in `src/sqlite-scheduling-admin-store-v1.mjs` | Supported domain library after proper counter/config/principal/lease setup. Caller trust and transaction/projection effects require a bounded production executor |
| GF15 schedule preparation | `createSqliteGf15CapabilitiesV1`, durable quiescence and packets | Internal isolated composition, explicitly no production CLI/HTTP/authorization transition; missing counter fails `SCHEDULING_REVISION_NOT_READY` |
| Production environment entrypoint | `src/server.mjs` sets Kiosk options, creates store/server; Scheduling requires programmatic injected authenticate | Does not wire an empty-domain initializer or config/admin/GF15 execution surface |
| New-data backup | `scripts/backup.mjs` uses SQLite `VACUUM INTO` | DB snapshot primitive, not a complete stopped/coherent DB/uploads/control manifest, verification, retention or recovery executor |

A new disposable DB probe used the actual frozen modules and **no synthetic seed
SQL**. All normalized/control counts began0. Valid local resource registration
returned `SCHEDULING_REVISION_CONFLICT` without facts. Publishing an empty test
config persisted one version plus one admin receipt while counter count stayed0;
activation then returned `SCHEDULING_REVISION_CONFLICT` and persisted no activation.
Therefore publishing config is neither bootstrap nor evidence of a usable domain.
It is already a durable control-fact boundary for fallback. No production operation
was performed by this probe.

**Required implementation gap:** a reviewed empty-domain initializer plus bounded
maintenance/admin execution adapter is absent. An implementation task needs separate
approval before implementing bootstrap/runtime or production-executor changes. A one-off SQL insert, test harness, caller-supplied actor
string, public V1 submission or isolated migration CLI is not an approved substitute.
The minimum proposed implementation must:

- bind exact immutable candidate/runtime and new volume/DB identity; hold exclusive
  writer/cleanup fence and enforce permitted offline maintenance scope;
- verify schema checksums, entirely empty business/control/receipt/outbox/uploads
  state and empty legacy snapshot before the first write; reject any uncertain or
  existing state rather than resetting it;
- transactionally initialize the reviewed normalized counter/projection baseline,
  seal exact authority/command/result identity and budget, support receipt-exact
  reopen/replay, and reject mismatched/nonzero/existing initialization;
- validate trusted administrative authority/lease and invoke existing normalized
  config/resource functions in their own bounded packets, preserving revisions,
  projection refresh, quiescence, receipts, audit and failure rollback;
- test race/crash/transaction failure/replay/nonempty rejection and preserve all
  identity/GF15/smoke/outbox permanent controls; add no normal Kiosk authority.

Recommended implementation shape for review is a separately frozen offline
maintenance artifact, retaining the candidate if no application changes are needed.
This is a design proposal, not an implemented/supported runner. If review requires
runtime/schema changes, freeze a new source/image and retest before selecting it;
this task cannot silently repurpose37ee97d or add migration10/normal mode.

## Explicit proposed identity sheet — no resources created

Every name/port/path below is **PROPOSED, UNVERIFIED, NOT PROVISIONED**. Device/inode,
volume creation time, actual container ID, config digest, route outcome and new-data
backup receipts remain null until separately approved work observes them.

| Binding | Review proposal | Fresh execution check |
| --- | --- | --- |
| Host | Recorded VM-0-12-ubuntu /159.75.139.246 /ins-mi85f3my | Fresh host/platform/instance/disk/owner identity; no current production probe in this task |
| New app directory | `/mnt/datadisk0/apps/jenn-shooting-operations-empty-r1` | Verified absent/collision-free; new owner/modes frozen |
| New volume | `jenn-shooting-operations_empty_data_r1` | Absent before create; inspect actual mountpoint/driver/options/owners afterwards |
| Expected volume path | `/mnt/datadisk0/docker/volumes/jenn-shooting-operations_empty_data_r1/_data` | Prediction only; mismatch requires stop/review, no fabricated binding |
| New container | `jenn-shooting-operations-empty-candidate-r1` | No existing name; immutable image/OCI/platform and actual new ID receipt |
| New private port | `127.0.0.1:3801:3800` | Port3801 availability unverified; no automatic alternate port |
| DB / attachments | `/app/data/shooting-operations.sqlite` and `/app/data/uploads` on new volume | Bind main/WAL/SHM, uploads/control paths, device/inode/permissions and exclusive writers |
| Initial config | PROD11_PRODUCTION; write admission disabled; cleanup disabled; no Kiosk auth/smoke/provider delivery | Freeze nonsecret config digest and approved role-secret references; no values generated/read/rotated here |
| Public origin/route | Retain `https://jso.skmt617.top`, existing `/etc/nginx/conf.d/jso-shooting-operations.conf`; proposed backend3801 | Exact reviewed route diff from historical backend3800, digest/owner/health/access proof. No TLS/Cloudflare/security/access changes implied |
| New-data backup root | `/mnt/datadisk0/backups/jenn-shooting-operations-empty-r1` | New allowed location/owner/modes/capacity, manifest/checksum/retention/recovery proof; not created |
| Old retained system | `jenn-shooting-operations-prod`, old volume `jenn-shooting-operations_shooting_data`, backend3800 | Historical imagec305de26/revision92b7137; freshly bind exact ID/final facts/fence at approved cutover, not assumed current |
| RTO/RPO/window | UNRESOLVED — owner must select exact values | No invented duration/timezone window or implicit data-loss allowance |

## Separately approvable stages and receipts

These stage labels are proposals only, not admitted GF15/PROD11 action IDs.

1. **Implementation preparation:** approve/review/test the missing initializer and
   maintenance adapter; freeze its source/digest/effects and exact empty-domain
   invariants. No production execution belongs to that implementation approval.
2. **New storage creation:** separately approve absent-path/volume/container creation
   and private disabled candidate startup. Record exact physical identities,
   prefix/checksums/integrity/FK/empty facts/auth denials. Old storage/config/service
   remain untouched; no public route or production seed write is part of this stage.
3. **Domain/config preparation:** separately approve the exact initializer packet
   and any resource/config/request/requirement effects. Start from verified empty
   new storage, retain receipts and classify every control fact. GF15 request/window/
   resource/config/proposal/decision remain exclusively its separately admitted
   fresh Asia/Shanghai action; no manual test-row seed becomes production authority.
4. **New-data recovery:** approve consistent offline/held-fence DB-family snapshot,
   attachment bytes+references+control-marker coverage, manifest/hashes, ownership,
   retention and production-local restore-to-new-path drill. Preserve permanent
   receipts/isolation/owners, prevent provider replay and acknowledge changed inode.
   DB-only `backup.mjs` is insufficient when attachments/control files exist.
5. **Cutover:** separately approve exact ingress/writer target switch. Fence/drain
   old HTTP/API/VCP/callback/provider/background/cleanup/direct-volume writers;
   if needed stop only the exact old container under the approved lifecycle and
   restart-policy handling. Keep old volume/config/image/data retained and unchanged.
   Hold new admission disabled. Record both identities/final facts/fences before
   switching only reviewed backend3800→3801. Health/scope/denial/identity mismatch,
   timeout or unfenced writer stops progression; no two writable authorities.
6. **Operation release:** require an independent receipt approving permitted new
   writers and client/VCP revision/queue/profile handoff. No stale old commands or
   identifiers may silently become new work. Provider/workers/cleanup need their
   own reviewed enable/drain/disable lifecycle. Production Kiosk remains disabled.
7. **Device and Kiosk later:** identity/control-history continuity review across
   retained/new contexts; WO03 setup/targets, full post-authorization device matrix,
   GF15/PROD11 ordering and separate future normal implementation/release. Empty DB
   cannot reset an existing smoke owner/budget or manufacture new requestability.

## Fact-aware fallback and remaining decisions

Before any new accepted business/control/provider/attachment fact, the admitted
fallback may keep new writers fenced, preserve new storage, return the exact route
to retained old backend3800, verify old identity/state, then separately release old
writers only after proving new writers stopped. Schema-only initialization must be
inventoried explicitly; never conceal accepted configuration/initialization receipts
as “still empty.”

After a new fact (including config publication in the synthetic probe), that return
is not lossless. Retain new DB/attachments/controls/outbox/receipts; fence both sides,
then use approved compatible forward repair or new-data restore/reconciliation.
Never attach v6 image to new v9 DB or remove owners/markers. No tested alternate
compatible image or production reconciliation runner is claimed. Temporary old-route
service after new facts requires an explicit continuity/reconciliation decision.

Needed decisions: approve a separate initializer/maintenance-adapter implementation
scope; ratify or amend the proposed names/port/route/backup location and exact action
effects; choose maintenance owner/window/RTO/RPO/retention; approve credentials only
by references; bind old/new no-split-brain and identity/client/provider continuity;
complete real device/external and new-data recovery evidence; then separately approve
creation, bootstrap, cutover and release. The old denied DB/schema/backup findings
are not a reason to migrate old records or a prerequisite for creating new empty
storage; they may limit later old-final-state/fence/identity-continuity attestation.

Initial hosted Ubuntu/Node24.21 exact-head055ef4d WO06C/D passed: full897/896pass/0fail/1existing external
adapter skip; Kiosk137/137, DingTalk/Outbox64/64, manifest112/112. External closure
remains PENDING and authority FROZEN_NOT_REQUESTED. This does not relabel the frozen
Alpine image's prior894pass/2timestamp failures/1skip as full-suite PASS; its failure
disposition remains a runtime-readiness decision. Any preparation head change
requires final-head CI before closure; final receipts are attached to PR40 and the
local handoff record, without recursively committing a new receipt-only head.
