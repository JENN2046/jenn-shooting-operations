# Production preflight and rollback closure R1

**Verdict: BLOCKED FOR DEPLOYMENT.** This closes the bounded recovery design for
review; it does not close production readiness or authorize any execution.
The read-only inspection took place on 2026-09-30, 17:51–17:56 UTC. Receipts and
explicit limits are in
[`production-readonly-preflight.r1.json`](../acceptance/production-readonly-preflight.r1.json).
The current authority branch was freshly verified at
`259506955b6fe41bb008de65a305691f9e2810ee` (PR39 merge). The frozen candidate remains
source `37ee97d5726d990e8f7178938eeb9b6c5f8b5424`, image
`sha256:fd8a2fb03c86901e26c64389138bbc494491e8bf6025af1e22eec9e1f11113e7`.
PR39 evidence head `093bb5dcadb017319da578f72148bdf8270cabad` and the authority
merge are not candidate image source revisions. No new image was built.

## Fresh production observations

Existing target-specific SSH with the previously recorded `ubuntu` login, strict
existing host-key trust and no trust/config writes returned `VM-0-12-ubuntu` at
`159.75.139.246`. The recorded instance is `ins-mi85f3my`; this task did not query
cloud instance metadata, so hostname/IP agreement does not freshly verify that ID.
All remote probes used metadata reads or unauthenticated GETs, with secret values
excluded remotely. No customer records, archive payloads or credentials were
transmitted; no archive was extracted. The inspection did not start an app/store,
open SQLite, migrate, checkpoint, create a backup, restore, signal or restart a
production process. Ordinary remote reads/GETs can produce access logs; this is
not a claim that every host byte remained unchanged.

| Binding | Fresh result | Limit |
| --- | --- | --- |
| Exact container | `b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be`, running/healthy, started `2026-09-28T05:15:44.792470451Z` | Point-in-time Docker state; restart count was not collected correctly and remains unknown |
| Current image | `sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545`, linux/amd64 | Source label is not a runtime-byte comparison |
| OCI revision | `92b7137211bf807f178901e878a8c3d6e335cec4` | This source recognizes schema through v6; actual live DB version remains unverified |
| Volume | `jenn-shooting-operations_shooting_data` → `/app/data`, RW; Docker source `/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data` | Source is inspect metadata, not a successful filesystem identity check |
| Known volume owners | Only the exact application container among all Docker container mounts | Does not exclude host/direct writers or other forms of bind access |
| Runtime topology | `127.0.0.1:3800:3800`, read-only rootfs, `/tmp` tmpfs, `no-new-privileges:true`, `unless-stopped` | Config inventory is not a lifecycle/drain receipt |
| Startup controls | `WRITE_ADMISSION_MODE=enabled`, `ORPHAN_CLEANUP_MODE=enabled`; Kiosk context/auth/smoke configuration absent | General write admission is independent of Kiosk; enabled admission is expected production state, not Kiosk enablement |
| Local health | `GET http://127.0.0.1:3800/healthz` → 200, `ok=true` | No business-record or schema assertion |
| Kiosk read | Unauthenticated GET with recorded `resourceId=STUDIO-PROD-01` → 401 `AUTH_NOT_CONFIGURED` | No credential, write or real-device acceptance; an earlier missing-resource probe returned 400 and is not auth evidence |
| Public health | `https://jso.skmt617.top/healthz` → 403, server `cloudflare`, text/plain, no authentication challenge | External proxy/access-path response; no proof of an app failure or exact Cloudflare rule; no bypass/repair attempted |
| Route file | `/etc/nginx/conf.d/jso-shooting-operations.conf`, SHA256 `35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33` | Digest/stat only; no route behavior change |
| Database/uploads | Host volume, main DB, WAL, SHM and uploads metadata/list denied `PermissionError` | No fresh inode/device/schema/checksum/integrity/fact-count/attachment parity proof |

The volume denial is a boundary. No `sudo`, permission adjustment, Docker exec,
new container mount or alternate privileged path was used to inspect those files.
Even with permitted file reads, opening a live WAL SQLite DB in read-only mode may
modify shared-memory state; `immutable=1` may ignore WAL. Neither is an acceptable
shortcut to fresh consistent schema evidence here. Existing live-query controls or
a separately approved stopped/consistent inspection method must be bound first.

## Existing backup evidence and its limits

The accessible `/mnt/datadisk0/backups/cutover-r1` inventory contains two logs and
these two archives. Logs were not read. SHA256 was computed on the production host;
file descriptor and final path device/inode/size/mtime/ctime stayed equal across
hashing and archive-header enumeration. No extraction, customer row read or
production data copy occurred.

| Existing artifact | Fresh checksum / result | Recovery relevance |
| --- | --- | --- |
| `state-at-cutover-20260919215939.tar.gz` (20,851,070 bytes) | `bd2f18706ca5cca79199caf35cb8181ed1c69dcf2f85fabbab423f2490bcc308`; 56 headers, 52 regular files, 5 SQLite-named files | Zero JSO-named members, zero `shooting-operations.sqlite` names, zero uploads names and zero manifest/checksum-named files. No SHA256 sidecar. Header names do not prove semantic DB identity; not accepted as a JSO backup |
| `vcptoolbox-release-2f8fd1ff.tar.gz` (289,752,909 bytes) | `3fd78ac05427242ff1aa26eebfd151306e578936081c4a62d0a6b8ba74e12be4`; matches existing `.sha256` sidecar | VCP release packaging evidence, no JSO DB-named members; not a JSO DB/attachment recovery proof |
| `/mnt/datadisk0/backups/docker-volumes` | Listing denied `PermissionError` | Contents, freshness, consistency and restore evidence unknown; no privileged retry |

There is **no verified eligible JSO recovery backup in the accessible evidence**.
This does not assert that no backup exists elsewhere. No production recovery
manifest or recovery drill could be verified. Historical WO06B recovery PASS and
PR39's isolated probes cover synthetic fixtures; they do not prove restorability
of this live volume or these existing archives.

Before execution approval, a JSO backup packet must bind: held writer/cleanup fence
and its lifecycle; exact main/WAL/SHM and attachment identities; snapshot method
(SQLite-consistent online backup under an approved method, or verified clean stopped
DB with explicit sidecar handling); complete database plus uploads/control-marker
coverage; schema prefix/checksums; canonical logical table/fact/revision inventory;
provider/outbox/control baseline; checksums; manifest version/time/owner; file
ownership/modes; allowed production-local storage/retention; and a separately
approved recovery drill with integrity/foreign-key/schema/attachment checks.
Never use a live main-file copy or unrelated VCP archive as this packet. Do not
transmit the packet's data payload to this computer. Creating this backup/drill is
future work requiring explicit authorization; none was performed here.

## Selected bounded recovery design

The initial R1 preferred an alternate compatible fallback image. No such image
exists in this preparation. The exact current old image is available, but its v6
source rejects v7, v8 and v9 with `SCHEMA_VERSION_TOO_NEW`. Directly restarting
`c305de26…` on a migrated volume remains prohibited. Kiosk-disable containment on
the candidate is not a successful image rollback if that candidate cannot serve.

For this replacement's **migration-only, held-fence phase**, select the following
review proposal: verified pre-upgrade v6 snapshot restored under a retained fence,
then the exact old image restarted with Kiosk absent, write admission disabled and
cleanup disabled. This is a DB restore plus image recovery, not schema downgrade
or a compatible image-only fallback. It requires its own explicit bounded recovery
approval as part of the replacement packet. Until its eligibility proof and real
backup/drill are available, readiness remains blocked.

Eligibility requires all of the following, freshly proved before any restore:

- Verified backup and restored target recognize exact old v1–v6 schema/checksums;
  no assumptions based solely on image labels.
- HTTP/background/provider/outbox/direct-storage writers and cleanup have been
  held and drained continuously from snapshot through candidate validation; no
  fence release or accepted business operation has occurred.
- Canonical per-table/fact/revision comparison proves zero new or changed business,
  audit, receipt, review, scheduling, GF15, smoke, ownership, notification/outbox or
  provider facts after backup, plus no attachment/control-marker changes that would
  be lost. Revision counters alone are insufficient. Candidate-startup effects must
  be inventoried, not presumed harmless.
- The only DB differences are the exact reviewed schema DDL and v7–v9 migration
  bookkeeping. Preserve that migration/diagnostic evidence outside the replaced DB
  in the approved local evidence location; do not erase it to manufacture eligibility.
- Exact restore target/topology, backup family consistency, attachment pairing,
  ownership and new-inode acknowledgment are frozen; quarantine upgraded DB/family
  intact for diagnosis and never mix its WAL/SHM with the restored v6 main file.

Once any new durable fact/owner exists, an uncertain comparison occurs, or the
fence is released, this recovery path expires. Do not infer zero facts from Kiosk
being disabled: other application writers remain capable of creating facts.
Preserve the upgraded database and use disabled containment or separately approved
forward repair/compatible fallback. No routine post-release old-image rollback is
claimed; a deployment requiring that capability remains blocked until it has its
own tested immutable fallback.

### Synthetic compatibility evidence

The actual frozen candidate image ran a new isolated probe with no network,
read-only rootfs, `/tmp` tmpfs, read-only old-source mount and only a local evidence
output mount. The probe created a new synthetic v6 DB, persisted synthetic revision
counters, produced a closed consistent synthetic backup, migrated the original to
v9, proved old-source rejection, then copied the v6 backup to a **new** restore path.
Restored bytes matched the backup; inode changed; old schema validation, revision
comparison, integrity and foreign-key checks passed. The later synthetic v9 runtime
owner was retained in the upgraded DB and classified as making restore ineligible.

`SYNTHETIC_V6_BACKUP_NEW_PATH_RESTORE_PASS` is source/schema compatibility evidence.
It is not an actual old production image startup, application recovery, attachment
restore, production backup verification or production restore drill. The probe
checks empty synthetic new control tables; production zero-fact eligibility still
needs the exhaustive comparison above. The existing PR39 permanent-owner and
v7/v8/v9 rejection probes remain applicable.

Reproduce locally using the exact frozen image, existing read-only old-source
export, a **new empty** output directory containing a copy of
[`production-preflight-synthetic-restore.r1.mjs`](../acceptance/production-preflight-synthetic-restore.r1.mjs),
mounted at `/out`, and the old export at `/old`. Run `node /out/probe.mjs` in a
`docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev` container;
never mount production storage. Paths `/tmp/synthetic-*.sqlite` exist only inside
the disposable container. The probe writes its receipt to `/out/restore-evidence.json`.

## Proposed execution, stop and recovery sequence

Every step below is a future reviewed action. No command here is execution approval.
A stopped maintenance model avoids inventing a live disable control: the old runtime
supports disabled admission at startup and an enable signal, but has no proven
running disable-and-drain path. Do not signal it to manufacture one.

1. Bind fresh exact host/container/image/route/storage facts, all writers and cleanup
   owners, maintenance owner/window/RTO/RPO, candidate transport/checksum/digest,
   secret references and VCP/provider baseline. Resolve external health access and
   DB read-consistency boundaries using already permitted or separately approved
   means. Approve replacement plus the bounded recovery effects and retain evidence.
2. In the approved window, establish ingress/provider/direct-writer fences, drain
   transactions and stop only the exact application container. Account for its
   restart policy and prevent any admitted alternate owner restart for the whole
   maintenance lifecycle. Verify no writer/cleanup owner remains; retain stopped
   storage and family identities. Stopping the app alone is not the entire fence.
3. Under separate approved backup/drill scope, create and verify the consistent
   v6 DB/attachment/control snapshot and restore proof. Record zero-fact baseline.
   If any backup, drain, consistency or identity proof fails, stop before migration;
   retain old image/storage and follow only the approved old-runtime resumption.
4. Verify approved offline transport destination and immutable candidate identity.
   Replace only the named app container, preserving approved volume/port/security/
   token/provider bindings. Use `KIOSK_SERVICE_CONTEXT=PROD11_PRODUCTION`, no Kiosk
   auth/smoke config, `WRITE_ADMISSION_MODE=disabled`, `ORPHAN_CLEANUP_MODE=disabled`.
   Resolve inherited cleanup domain/epoch/markers before approval; never silently
   reinterpret them. Keep the external/direct-writer fence. First writable store
   open migrates through v9; this is the intended irreversible boundary for direct
   old-image restart, even with Kiosk disabled.
5. Verify migration prefix/checksums, storage identities, integrity/foreign keys,
   full logical fact and attachment/control parity, health/Kiosk401 and denied
   unapproved writes. Verify VCP/provider/outbox continuity and no new controls.
   No VCP/provider/cleanup restoration is implied by disabled startup. Mismatch
   stops progression and enters the approved recovery decision below.
6. Only after independent acceptance and a separately bound operation-release
   receipt may ordinary existing writers be resumed under their approved lifecycle.
   Freeze exact general-write/cleanup resumption and ownership behavior first;
   releasing the fence terminates v6-restore eligibility. Do not restore cleanup
   casually: current cleanup schedule cancellation remains a separate known contract
   limit. Kiosk stays disabled. GF15, WO03 external setup, PROD11 and eventual normal
   mode require their own gates/authorization; no fresh Asia/Shanghai window is
   invented in this replacement.

Stop on: host/image/config/storage drift; denied or inconsistent DB read; unbound
writers/cleanup; failed backup/drill; migration-prefix/integrity/parity mismatch;
health/auth failure; VCP/provider drift; new control/business fact; lost fence;
missing recovery approval; or expired maintenance budget. Do not repeatedly restart
or attempt schema surgery. Before first migration, retain the original DB/image;
after it, old-image recovery must satisfy every eligibility rule.

If bounded recovery is approved and eligible: keep all fences; stop only the failed
candidate; retain its upgraded DB/WAL/SHM, attachments/control markers and diagnostics
in the approved production-local quarantine; restore the verified v6 DB/attachment/
control family with frozen ownership/path/new-inode handling; validate it before app
startup; start exact old `c305de26…` by immutable identity with Kiosk absent, admission
and cleanup disabled; verify health/schema/auth/VCP/provider/parity; require the
approved old-operation release before lifting fences. Failure keeps services stopped
or safely disabled and escalates under the retained data, never deletes facts or
relaxes admission to test. Restore/drill/config/restart effects remain unexecuted.

If recovery is ineligible: retain v9 storage and all facts/owners; keep Kiosk disabled
and the approved fence/containment; require a compatible reviewed image or forward
repair. This task does not implement that runtime or grant recovery authority.

## Remaining closure inputs

Production DB identity/version/checksums and consistent fact baseline; protected
backup evidence or an approved new consistent JSO backup/drill; exact fencing and
cleanup lifecycle; bounded restore target/ownership/approval; maintenance owner,
window, RTO/RPO; externally usable health verification; VCP/provider continuity;
candidate transport; disposition of the two inherited Alpine timestamp test failures;
and explicit replacement execution approval remain outstanding. The candidate's
Alpine full suite remains 894 pass / 2 fail / 1 skip out of 897; targeted safeguards
passed 284/284. Hosted PR39 WO06C/D passed exact evidence head; bot review hit quota,
so there is no Codex review clean signal. None of these alone authorizes deployment.

Device/browser/assistive bindings remain intentionally pending per user direction;
no physical acceptance was run. No authority JSON was changed: GF15 remains next,
`FROZEN_NOT_REQUESTED`, requested/approved/requestable arrays empty. Successful
replacement would leave **Kiosk disabled**; the merged post-smoke contract still
requires a separately reviewed normal implementation and operation-release receipt.
