# WO-06E：Greenfield Production Authority

- Parent authority: `docs/operations/production-change-manifest.v1.json`
- Parent manifest digest: `sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b`
- Supplement: `docs/operations/production-greenfield-authority.v1.json`
- Deployment mode: `GREENFIELD_NO_EXISTING_SOURCE`
- Status: `AUTHORITY_DEFINITION_PENDING_EXACT_HEAD_VALIDATION / PRODUCTION_AUTHORIZATION_NOT_REQUESTED`

## Why this supplement exists

Real production binding established that this is the first Jenn Shooting Operations production deployment. The bound production host contains no prior Jenn Shooting Operations V1 production database, upload root, running V1 API, production route, or prior production authority that must be migrated or demoted.

The frozen WO-06D base manifest models an existing-source migration/cutover path. It therefore requires PROD-09, source quiescence, attachment-copy LIVE_PROVIDER authority, final source parity, source writer barriers, old-source demotion, and switch recovery. Those requirements remain valid for an existing-source migration, but they are not truthful prerequisites for this greenfield deployment.

This supplement is digest-bound to the unchanged migration manifest. It does not rewrite or weaken Stage 2, Stage 3, PROD-09, the attachment-copy engine, source-barrier controls, or the existing-source cutover contract.

## Bound production target

```text
provider             = Tencent Cloud CVM
instanceId           = ins-mi85f3my
instanceName         = AGENTS-OS
publicIPv4           = 159.75.139.246
privateIPv4          = 172.16.0.12
region               = ap-guangzhou
zone                 = ap-guangzhou-7
OS                   = Ubuntu 24.04.4 LTS
architecture         = amd64
applicationBind      = 127.0.0.1:3800
applicationDirectory = /mnt/datadisk0/apps/jenn-shooting-operations
dataVolume           = jenn-shooting-operations_shooting_data
volumeMountpoint     = /mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data
backingDevice        = /dev/vdb
filesystem           = ext4
```

Public hostname, reverse-proxy route, container name, and cloud security-group control-plane facts remain unresolved and are not invented by this supplement.

## Completed production acceptance

The following bounded work has completed:

1. PROD-01 target read-only binding:
   - Tencent metadata matched `159.75.139.246` to `ins-mi85f3my`;
   - Docker, disk, port, Nginx/TLS and host firewall facts were read without mutation.
2. PROD-02 isolated storage:
   - application directory created on `/dev/vdb`;
   - dedicated empty Docker volume created on `/dev/vdb`;
   - no container, route or token was created as part of PROD-02.
3. Phase-B target-volume acceptance:
   - Node `v24.21.0` in an isolated one-shot container;
   - case-sensitive filename semantics;
   - NFC/NFD names remain distinct;
   - Linux `/proc/self/fd` exclusive target creation works;
   - SQLite WAL/SHM and rollback-journal families behave on the target ext4 volume;
   - no active bind-mount alias references the target volume after acceptance;
   - disposable probe files, container and pulled Node image were removed;
   - target volume returned to empty state.

## No-existing-source evidence

Jenn confirmed this is the first formal production deployment and there is no old Jenn Shooting Operations production data to preserve or migrate.

Read-only discovery on the bound host found no V1 source containing the required `schedule_state`, `operations`, `audit_log`, and `uploads` tables, no corresponding upload tree, and no running Jenn Shooting Operations V1 API. Other databases belonging to New API, VCP, Photo Studio OS, Docker and unrelated tooling are not treated as source candidates.

Therefore the following base-manifest gates remain blocked in the migration contract but are not applicable to this greenfield deployment:

- `PRODUCTION_DATA_MIGRATION`
- `PRODUCTION_IMPORT_SOURCE_CONSISTENCY`
- `PRODUCTION_ATTACHMENT_COPY_CAPABILITY`
- `CUTOVER_SOURCE_CONSISTENCY`
- `CUTOVER_SWITCH_RECOVERY`
- `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY`

No `*_VERIFIED` attachment-copy receipt or LIVE_PROVIDER mint is fabricated.

## Greenfield replacements

The supplement replaces only the current deployment-path assumptions that unconditionally require an existing source:

- container start requires verified PROD-02 / PROD-03 / PROD-04, fresh target-SQLite absence, no-existing-source proof, cleanup disabled, and the production deployment gate;
- the greenfield forward chain omits PROD-09;
- greenfield activation uses a new exact action contract `PROD-GF-13-ACTIVATE` rather than the source-migration `PROD-13-CUTOVER-SWITCH`;
- greenfield cleanup restoration uses `PROD-GF-14-RESTORE-ORPHAN-CLEANUP` rather than pretending post-migration attachment parity exists.

The original PROD-09 / PROD-13 / PROD-14 contracts remain unchanged for an existing-source deployment.

## Authorization boundary

```text
authorization.status          = FROZEN_NOT_REQUESTED
requestedActionIds             = []
approvedActionIds              = []
requestableActionIds           = []
blanketApprovalAllowed         = false
nextActionId                   = PROD-03-GENERATE-INSTALL-TOKENS
nextActionRequiresAuthorization = true
```

This authority definition does not grant PROD-03 or any later production mutation. Every external or production mutation still requires Trusted Client + Explicit Human Intent + Exact Pending Authority Target.

## Remaining facts before later gates

- exact container name;
- exact public hostname / DNS binding;
- exact reverse-proxy route;
- TLS binding for that route;
- Tencent Cloud security-group control-plane fact if a change is actually required;
- built image digest;
- deployed VCP/Kiosk wiring and their separately authorized real acceptance;
- greenfield activation and cleanup restoration evidence.

No source migration, production data copy, public route change, token generation, container start, integration enablement, or production activation is authorized by this document.
