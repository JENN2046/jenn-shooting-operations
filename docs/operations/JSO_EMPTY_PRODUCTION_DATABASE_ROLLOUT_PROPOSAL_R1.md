# Empty production database rollout proposal R1

**Current user-selected route: new empty production storage, no old-record import.**
**Local synthetic acceptance: PASS WITH LIMITS. Production execution: NOT AUTHORIZED,
NOT PERFORMED, BLOCKED ON NEW BINDINGS AND RELEASE/RECOVERY PACKET.**

The user chose “先建新库做隔离验收，正式生产也从空库重新开始.” This proposal
supersedes the in-place v6→v9 upgrade and pre-upgrade-v6 restore strategy in
[the initial replacement proposal](JSO_CANDIDATE_REPLACEMENT_DEPLOYMENT_PROPOSAL_R1.md)
and [PR40's historical preflight](JSO_PRODUCTION_PREFLIGHT_AND_ROLLBACK_CLOSURE_R1.md).
Their timestamped observations, denials, backup classification and synthetic results
remain historical facts. They are not silently rewritten as new-DB evidence.
PR40 is reused because it remains an unmerged preparation draft against the same
current authority; retaining the history and adding this explicit route avoids a
duplicate/stacked PR or accidental migration instructions.

The authority remains `codex/v2-1-architecture-freeze` at
`259506955b6fe41bb008de65a305691f9e2810ee`. The exact frozen candidate is source
`37ee97d5726d990e8f7178938eeb9b6c5f8b5424`, image
`sha256:fd8a2fb03c86901e26c64389138bbc494491e8bf6025af1e22eec9e1f11113e7`.
Neither the authority merge, PR40 documentation head nor the new local harness is
its image source. OCI revision/platform were freshly checked locally. No new image
was built or published. Its supported production Kiosk modes remain disabled or
bounded smoke; a blank database does not add normal operation.

## Actual local isolated acceptance

Machine-readable bindings/receipts are in
[`jso-empty-db-local-acceptance.r1.json`](../acceptance/jso-empty-db-local-acceptance.r1.json).
The final harness ran on the unchanged image, in disposable containers with
`--network none`, read-only rootfs and `/tmp` tmpfs; listeners used only private
container `127.0.0.1:3800`, with no host port or public route. A brand-new local data root in a dedicated bind
path contained three independent DBs. No production mount, old DB/record copy,
production credential, provider worker/send, SSH probe or device enrollment occurred.

| Case | Actual evidence | Limit |
| --- | --- | --- |
| Fresh disabled production context | Actual server entrypoint creates schema prefix1–9; integrity/FK checks pass; zero requests/items/events/import batches/GF15/smoke owners; health200 with `X-Write-Admission: disabled`, Kiosk401 `AUTH_NOT_CONFIGURED`, writes503 `WRITE_ADMISSION_DISABLED` | Schema/bootstrap metadata exists; “empty” means no accepted business facts, not a file with zero rows |
| Disabled restart/recreation | Two server starts plus another container reopening the same file preserve device/inode and full logical digest | Local synthetic identity, not production volume identity |
| New single fixture | One canonical-form synthetic request and confirmed single item; test-only operator/resource/config in Asia/Shanghai; actual authenticated HTTP start→block→resume→complete yields4events/1run | Direct synthetic fixture seeding/config normalization, not proof of production setup API/lifecycle |
| New grouped fixture | Two canonical-form synthetic requests, `grouped_unallocated`, current-read returns both tasks; same four-event flow | No invented per-task labor allocation; no browser rendering/device proof |
| Admission/context/scope | Authenticated writes denied while admission disabled; missing auth denied; production resource denied to test principal; missing/mixed/production context rejects test startup inputs | No production credential or smoke activation |
| Container recreation/replay | Eight accepted commands replay200 with exact original receipts and no changed logical facts/events/revisions/outbox; same DB device/inode | Node HTTP client, not real-browser offline/cache/lease acceptance |
| New-data recovery prototype | Completed single/grouped synthetic v9 DBs backed up by SQLite `VACUUM INTO`, restored to new local paths, same facts/receipts/pending outbox, changed inode, integrity/FK pass, restored replay fact-free; originals retain identity/facts | No attachments in these fixtures; no production backup or recovery drill |
| Frozen safeguard suites | 298/298 pass,0fail/0skip; Kiosk/GF15/Outbox/write-admission tests in candidate Node24.21.0 Alpine; all272 exported source files byte-match source37ee97d | Smoke/GF15 are isolated simulations. Actual server harness imports `/app`; suite uses separately mounted identical frozen source |

Fresh startup leaves `revision_counters` with zero rows. Test setup explicitly
inserted the initial counter and synthetic native-form request/resource/config/
schedule rows, without a V1 source or migration batch. Those SQL fixture writes
must not be copied into a production procedure. Freeze a reviewed, supported
minimal domain-bootstrap method and exact permitted effects before approving any
production initialization. Config/resource/request/confirm preparation belongs to
its own admitted action; a synthetic test does not grant that authority.

The harness initially exposed two probe errors (SQLite null-prototype serialization
and zero-based synthetic weekdays), and a syntax error while adding its local
backup phase. Failed scratch/log evidence is retained; final corrected create,
reopen and backup phases passed on new scratch. Candidate code did not change.
The prior full Alpine suite remains894pass/2inherited timestamp failures/1skip out
of897; no full-suite PASS is inferred from298 safeguards.

All real-browser/device/accessibility and browser offline acceptance remain NOT RUN;
exact targets remain deferred. This local packet is useful preparation, not ratified
external WO03 setup, `REAL_DEVICE_ACCEPTANCE`, `OFFLINE_REPLAY_RESULT` or PROD11 PASS.

### Reproduce only in a new local synthetic path

Use a new empty local data directory; mount only that directory at `/data` and this
repository's `scripts/verify-empty-db-local-acceptance.mjs` read-only at `/probe.mjs`.
Run the exact frozen image with `--rm --network none --read-only`, `/tmp` tmpfs,
no published ports and `--entrypoint node`. Run `/probe.mjs create` first. Its receipt
reports `/data/jso-empty-db-local-<suffix>`. In a **separate** identical disposable
container run `/probe.mjs reopen <that-root>`, then another container runs
`/probe.mjs backup <that-root>`. Reopen/backup only accept this local probe namespace;
never supply or mount production storage. Each phase writes its receipt within
that new root. Temporary test auth is regenerated in tmpfs and removed.

Fresh run timestamps, UUIDs, inode/file/fixture digests differ; freeze the new receipts
as a distinct packet rather than relabeling them with this run's identifiers.
This is a review tool mounted into the image, not a rebuilt/embedded runtime feature.

## Proposed empty-production bindings — none observed or created

Proposed planning identifier: `PROD-EMPTY-DB-ROLLOUT-R1`; it is not an admitted action.
Actual production new DB creation and ingress cutover must be separately confirmed
and authorized after this acceptance review. No authority/action array is amended.

| Binding | Proposal / required closure |
| --- | --- |
| Host | Previously recorded VM-0-12-ubuntu/159.75.139.246/ins-mi85f3my; fresh exact target/platform/disk/conflict proof required before execution |
| New storage | A **new distinct** volume, proposed name `jenn-shooting-operations_empty_data_r1`; collision/absence and exclusive ownership must be verified, not assumed |
| New app/container | Proposed sibling app directory `/mnt/datadisk0/apps/jenn-shooting-operations-empty-r1` and container `jenn-shooting-operations-empty-candidate-r1`; exact new loopback port unresolved |
| New DB/uploads | New volume mounted only into new candidate `/app/data`, DB `/app/data/shooting-operations.sqlite`, new uploads root; freeze actual volume source/device/inode, DB family identities/modes/ownership and writer inventory |
| Old system | Retain exact old container/image/app configuration/volume/DB/uploads. Never mount old storage into new service, modify it to v9, delete it or copy its records/assets into new DB |
| Candidate | Exact digest/revision above, linux/amd64; separately approved offline archive transport/checksum/destination required; registry publication not permitted here |
| Startup | `KIOSK_SERVICE_CONTEXT=PROD11_PRODUCTION`, no Kiosk auth/smoke config, `WRITE_ADMISSION_MODE=disabled`, `ORPHAN_CLEANUP_MODE=disabled`; bind absence of provider delivery/background writers and cleanup-control lifecycle |
| Domain bootstrap | Review canonical minimal empty-domain initialization/counter method. Resource calendars/capabilities, config versions, new requests/requirements and schedules need individually bounded setup authority and receipts; no local fixture or historical record import |
| Credentials/identities | Freeze approved role-secret references and auth scopes without exposing values; no credential generation/reuse/rotation authority inferred. Kiosk identity/profile later belongs to PROD11. Test credentials remain ephemeral local-only |
| Ingress/ownership | Exact public route and every API/VCP/provider/callback/direct-volume writer cutover, old fence/drain and new operation release; one writable authority at a time |
| Recovery | New-data backup location/retention/consistent family+attachments/control coverage, real recovery proof, compatible image, RTO/RPO/owner and fact-aware route rollback approval |

The existing frozen action/target definitions bind the old live topology. A new
volume/container/route is drift, not automatic permission. The reviewed deployment
packet must explicitly admit/rebind the new target while retaining the frozen
Kiosk/image/identity ordering; do not execute the old replacement action against
this different storage as if it were equivalent.

## Separate future rollout and cutover sequence

1. Review this local packet and freeze exact new storage/topology/domain bootstrap,
   transport/credential references, ownership, external acceptance, maintenance,
   fencing, route-switch/recovery and release actions. Obtain explicit approval
   for new-production creation; obtain separate ingress cutover approval. Revalidate
   authority/source/image and every relevant contract immediately before execution.
2. Under approved creation scope, create only verified-absent new storage/container/
   private loopback endpoint. Keep old system untouched and ingress on old service.
   Start exact candidate with admission/cleanup/Kiosk disabled and provider delivery
   unwired. Record new schema prefix/checksums, DB family identity, empty-domain and
   zero GF15/smoke/receipt/outbox inventories, integrity/FK and auth/write denials.
   Do not bring test requests, runs, profiles, identities or outbox into production.
3. Execute only separately approved domain bootstrap/configuration effects on new
   storage. Preserve exact control receipts and classify them as new facts where
   applicable. Review previous identity/control history before GF15/PROD11 authority:
   empty control tables do not prove an existing identity's budget can restart.
   Do not reset/delete/copy historical permanent controls or claim fresh authority
   merely by selecting the new DB. Unresolved identity-history continuity stops
   activation; it is a gate even though old business records will not be imported.
4. Before accepting any new business/provider/attachment writes, freeze the new
   data backup/recovery method and consistent DB/WAL/SHM/uploads/control manifest.
   Verify its integrity/schema/attachment parity and separately approved production-
   local recovery drill; no data download to this workspace. Establish retention
   and ongoing backups at the admitted cadence. Old MySQL/VCP archives cannot serve
   this purpose. Every new durable fact must remain recoverable after release.
5. In the separately approved cutover window, fence all old ingress, API/VCP/provider/
   callback/background/cleanup/direct-storage writers; drain and record old final
   revisions/ownership plus new state. The current runtime has no proven live
   disable-and-drain path: a separately approved stop of the exact old application
   may be needed, preserving its container/image/volume/config and data unchanged.
   A route switch alone is not a writer fence; stop-condition and restart policy
   handling must be bound. Do not run two enabled authorities or redirect old clients
   into new storage without an approved identity/data-reset handoff.
6. With old writers held and new admission still disabled, switch only the approved
   route/writer target. Verify new endpoint/image/DB identity, health, read scope,
   disabled Kiosk/write denials, old fence and VCP/provider handoff. Mismatch or loss
   of fence stops the cutover; do not enable writes for diagnosis.
7. Only a separately bound operation-release receipt may enable permitted existing
   non-Kiosk use or workers/cleanup under their reviewed lifecycle. Account for new
   DB semantics in clients/VCP caches/revisions and archive references: old identifiers
   and pending commands cannot be silently replayed as new work. Kiosk stays disabled.
   GF15 needs fresh Asia/Shanghai schedule/window, exact new DB/identity bindings and
   explicit authority. External WO03 setup/targets and post-authorization matrix,
   PROD11 smoke and eventual separately implemented normal mode keep their ordering.

The new DB is not a reason to delete the old deployment. Keep old storage and final
historical state under retention/access ownership chosen in the approved action.
Any later decommission/delete is separate work; none is proposed as a cutover effect.

## Recovery before versus after new facts

**Before new accepted business/control/provider/attachment facts:** keep new ingress/
writers fenced; stop only the new candidate if the approved recovery requires it;
preserve new storage and diagnostics; verify the explicit zero-fact inventory,
old final state/fence/health and exact old route/image target. Only the admitted
rollback may restore ingress to the retained old system, then separately release
old writers after proving the new side cannot write. This is a route/runtime return
to retained old storage, not a v9→v6 restore or old-image startup on the new volume.
Schema/runtime initialization metadata must be inventoried explicitly; never hide
accepted setup/control facts under an “empty” label.

**After any new business/control/provider/attachment fact:** returning traffic to
old storage is not lossless, because those facts do not exist there. This includes
accepted configuration/setup/control receipts where applicable, not just shooting
or Kiosk events. Preserve new DB/WAL/SHM, uploads, outbox/receipts and controls; fence
both sides as needed. Prefer compatible forward repair or verified new-data restore
on a compatible v9 runtime under a separately approved recovery packet. Restore
changes DB inode and must preserve coherent attachments/control evidence. Prevent
provider duplicate delivery and retained client-queue replay conflicts. Never attach
the old v6 image to new v9 storage or erase markers/owners to make it start.

An emergency temporary route to old service after new facts requires an explicitly
reviewed reconciliation/continuity decision, retained new history and operator
handoff; no automatic destructive reverse import or lossless rollback is claimed.
No alternate compatible fallback image or production reconciliation tool is built
here. The synthetic v9 recovery prototype preserves new facts but does not close
production backup/drill/readiness gates.

Stop on identity/image/storage/config drift; failed initialization/backup/recovery;
unbound setup/writers/provider/cleanup/identity history; split-brain or lost fence;
missing/failed external acceptance; unresolved client handoff; health/auth mismatch;
expired maintenance budget or missing approval. Preserve both systems and all data.

## Which earlier blockers change

Old-volume v6→v9 migration, old-prefix compatibility/fact comparison for upgrade,
and eligible pre-upgrade-v6 restore backup are no longer technical prerequisites
for **creating this separate empty DB**. The earlier denied old DB/volume and unrelated
backup findings remain accurate historical observations, not invented new-DB gates.
They may still limit an approved old-final-state/fence/identity-continuity or retained-
old recovery attestation; don't declare those facts freshly verified.

Still open: new volume/DB/port/container/route bindings and explicit target admission;
reviewed domain/config bootstrap and secret references; old/new ownership fence and
client/VCP/provider handoff; backup/recovery of new data and attachment/control parity;
real device/browser/assistive and external acceptance; full Alpine failure disposition;
maintenance/release/recovery approvals; GF15/PROD11 gates and normal-operation contract.
Authority remains GF15-next, `FROZEN_NOT_REQUESTED`, all requested/approved/requestable
arrays empty. No production creation, route switch, restart, grant or acceptance occurred.
