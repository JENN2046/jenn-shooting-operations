# WO-06E：Greenfield Production Authority

- Parent authority: `docs/operations/production-change-manifest.v1.json`
- Parent manifest digest: `sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b`
- Supplement: `docs/operations/production-greenfield-authority.v1.json`
- Deployment mode: `GREENFIELD_NO_EXISTING_SOURCE`
- Status: `GREENFIELD_WRITE_FENCE_IMPLEMENTATION_PASS / FINAL_DOCS_HEAD_VALIDATION_PENDING / PRODUCTION_AUTHORIZATION_NOT_REQUESTED`

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
- the required greenfield pre-activation forward chain omits PROD-09 and all write-capable integration enablement;
- conditional firewall/security-group work references the real `PROD-08-FIREWALL-SECURITY-GROUP` action ID and is tracked separately from the required chain;
- `PROD-10-ENABLE-VCP-REMOTE-SYNC` and `PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE` are post-activation integrations: they remain disabled before activation and require `GREENFIELD_ACTIVATION_COMPLETION` plus their unchanged base wiring/authorization gates before they can be separately authorized;
- greenfield activation uses a new exact action contract `PROD-GF-13-ACTIVATE` rather than the source-migration `PROD-13-CUTOVER-SWITCH`; its rollback cannot derive VCP/Kiosk disable authority because those actions have not yet run;
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
- greenfield activation evidence;
- post-activation VCP/Kiosk wiring and their separately authorized real acceptance;
- greenfield cleanup restoration evidence.

No source migration, production data copy, public route change, token generation, container start, integration enablement, or production activation is authorized by this document.

## Codex review correction

Independent review of exact head `de487b8c5cc65635a2142ffd0b52fac61b8191e4` found four valid authority defects. The implementation correction preserves the unchanged base migration manifest and fixes all four:

1. Parent-manifest binding is now derived inside the greenfield validator from the supplied `baseManifest`; callers can no longer pair a modified manifest with a trusted digest argument.
2. PROD-10 and PROD-11 are removed from the pre-activation forward chain. Greenfield activation requires proof that those write-capable integrations remain disabled; they become separately authorizable only after `GREENFIELD_ACTIVATION_COMPLETION`.
3. Conditional firewall work now references the actual base action ID `PROD-08-FIREWALL-SECURITY-GROUP` in a separate conditional-action set.
4. The authority format rejects every undeclared top-level field, preventing alternate action/authorization surfaces from being embedded in an otherwise valid supplement.

The correction also removes VCP/Kiosk rollback IDs and enablement proof from `PROD-GF-13-ACTIVATE`, because those integrations no longer run before activation.

### Fresh implementation-bearing evidence

```text
implementationHead = 8bd73a419b24ae7fc0a3b340806edcac3cab956c
workflowRun        = 36318045627 (#130)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 736
pass               = 735
fail               = 0
skip               = 1 (expected external VCP adapter absence)
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:faaf177bfe562b9306fb6f1728d957f2c731ebdd88d7c4e5a44583dd6999b1fc
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-03-GENERATE-INSTALL-TOKENS
```

The failed runs immediately before #130 belong to intentionally incomplete intermediate commits while validator, authority JSON, CLI and regressions were being aligned. They are superseded by exact-head run #130 and are not acceptance evidence.

No production mutation was performed by this review correction.

## Second Codex review correction

Independent review of exact head `ddc54cb23d4b0c100278bb4df1281d5eb9acbaca` found two additional valid findings:

1. **P1 / staging-principal writes** — the unchanged PROD-07 contract permits bounded staging principals to write before cutover. Moving PROD-10/11 post-activation was therefore insufficient by itself.
2. **P2 / malformed nested authority values** — JSON-valid malformed fields such as a null forward chain or null activation action could reach unconditional property access and throw instead of returning a fail-closed validation result.

Both are corrected without changing the frozen existing-source migration manifest.

### Greenfield pre-activation write fence

The runtime now has an explicit write-admission mode. Greenfield pre-activation deployment requires the disabled mode from PROD-05 through PROD-GF-13 read-only verification.

When disabled:

- every mutating HTTP method is rejected with a stable low-disclosure `WRITE_ADMISSION_DISABLED` response before business/store dispatch;
- V1 direct store mutation entrypoints `replaceSnapshot`, `submitRequest`, and `saveUpload` reject before mutation;
- PROD-07 bounded staging-principal writes are forbidden on the greenfield path even though the unchanged migration-path PROD-07 contract permits them;
- PROD-10 / PROD-11 remain disabled until after greenfield activation;
- orphan cleanup must already be disabled and drained; the server refuses to start in pre-activation write-disabled mode if orphan cleanup is enabled or inherited;
- background writer inventory must be zero;
- uncontrolled direct-storage bypass writer inventory must be zero;
- no other container may mount the target volume;
- only the initial empty-target schema and revision-zero bootstrap before the service begins listening is admitted as a pre-activation storage mutation.

Activation keeps this fence held while routed TLS, storage identity and read-only service checks run. Production write admission is enabled only after those checks, using the exact same image and target volume, followed by another loopback health and storage-identity check. PROD-10 / PROD-11 remain separately authorized post-activation actions.

The existing `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY` remains unchanged and blocked in the base existing-source contract. The greenfield fence is a separate first-deployment admission boundary and does not claim to implement the source/target cross-process cutover fence.

### Validator shape hardening

The greenfield validator now validates all nested array/object shapes before any `.includes`, mapping, or nested property access. Malformed but JSON-valid direct inputs return:

```text
ok = false
code = GREENFIELD_SCHEMA_INVALID
digest = absent
```

They do not throw to direct consumers.

### Fresh implementation-bearing evidence

```text
implementationHead = 25f9ac5f615ee00e8a8c366613cf068c0ee4aa83
workflowRun        = 36319432367 (#156)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 741
pass               = 740
fail               = 0
skip               = 1 (expected external VCP adapter absence)
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:4dae92d329628c7b4736bfdfafe7c8f432810e6c9f00059bbd201f47787ad24a
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-03-GENERATE-INSTALL-TOKENS
```

Intermediate failed workflow runs during the multi-file correction are not acceptance evidence. Exact-head run #156 supersedes them.

No production token, container, route, DNS, TLS, firewall/security-group, database import, attachment copy, or production activation was performed by these corrections.


## Third Codex review correction

Independent review of exact head `0bde15c9db67061842c3f601e480941bc120de83` found three further valid findings:

1. **P1 / admission transition ordering** — restarting a container with write admission already enabled before health/storage re-verification created a write window.
2. **P2 / cleanup lifetime interlock** — cleanup could be re-enabled in-process while write admission remained disabled.
3. **P2 / malformed base-manifest entries** — direct callers could pass arrays containing null or malformed entries and trigger exceptions during map construction.

All three are corrected without changing the frozen existing-source manifest.

### Atomic in-process admission transition

Greenfield activation no longer restarts an enabled container.

The verified service process starts and remains with write admission disabled through:

- loopback health verification;
- target storage identity verification;
- routed TLS verification;
- route promotion;
- read-only post-activation verification.

Only after every required read-only verification succeeds while the same process, route, image, target volume and disabled fence remain unchanged does activation perform one explicit in-process admission transition.

For the direct production process, the transition is triggered by `SIGUSR2`. The process owns one shared `writeAdmissionControl` used by both HTTP and V1 store mutation boundaries. The transition is one-way and does not restart the container or change the route.

`/healthz` keeps its existing JSON body contract unchanged and exposes current admission state only through the read-only `X-Write-Admission` response header.

### Cleanup lifetime interlock

While write admission is disabled:

- `orphanCleanupControl.enable` returns `WRITE_ADMISSION_DISABLED`;
- periodic/manual non-dry-run cleanup returns `WRITE_ADMISSION_DISABLED` before mutation;
- startup requires orphan cleanup to be disabled;
- enabling write admission does **not** automatically restore cleanup.

Cleanup remains disabled until the separately authorized Greenfield cleanup-restoration action.

### Base-manifest nested shape admission

The exported Greenfield validator now structurally validates every base-manifest gate/action entry and authorization array before mapping or dereferencing them.

Malformed direct inputs such as:

```text
gates = [null]
actions = [null]
authorizationPacket.requestedActionIds = null
```

return:

```text
ok = false
code = BASE_MANIFEST_SCHEMA_INVALID
digest = absent
```

and do not throw.

### Fresh implementation-bearing evidence

```text
implementationHead = 95b36e97fad50563a63b81a21fbc98d43827f176
workflowRun        = 36320452632 (#167)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 744
pass               = 743
fail               = 0
skip               = 1 (expected external VCP adapter absence)
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:51341436645ad9dad96aa54b6bd1710392cbd28ec08795bddee0d4366d3820a9
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-03-GENERATE-INSTALL-TOKENS
```

Intermediate failed workflow runs while the multi-file correction was incomplete are not acceptance evidence. Exact-head run #167 supersedes them.

No production token, container, route, DNS, TLS, firewall/security-group, database import, attachment copy, admission transition, or production activation was performed by these corrections.
