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
publicHostname       = jso.skmt617.top
reverseProxyRoute    = https://jso.skmt617.top
containerName        = jenn-shooting-operations-prod
dataVolume           = jenn-shooting-operations_shooting_data
volumeMountpoint     = /mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data
backingDevice        = /dev/vdb
filesystem           = ext4
```

Cloud security-group control-plane facts remain unresolved. PROD-07 live HTTPS reachability did not require a security-group mutation, so conditional PROD-08 was not triggered.

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
nextActionId                   = PROD-GF-14-RESTORE-ORPHAN-CLEANUP
nextActionRequiresAuthorization = true
```

This authority definition records PROD-03 through PROD-07, PROD-GF-13R reconciliation, and PROD-GF-13 activation as completed evidence. The owner separately authorized the exact read-only reconciliation action, and fresh runtime facts matched the approved durable container, image, loopback bind, target volume, database file identity, restart proof, health/admission state, cleanup-disabled state and integration-disabled state. The exact next action is PROD-GF-14-RESTORE-ORPHAN-CLEANUP; it still requires separate explicit authorization. Every external or production mutation still requires Trusted Client + Explicit Human Intent + Exact Pending Authority Target.

## Remaining facts before later gates

- Tencent Cloud security-group control-plane fact if a change is actually required;
- post-activation VCP/Kiosk wiring and their separately authorized real acceptance;
- greenfield cleanup restoration evidence.

No source migration, production data copy, additional public route change, additional container start, container restart, VCP/Kiosk integration enablement, or orphan-cleanup restoration is authorized by this document. PROD-03 through PROD-07, PROD-GF-13R and PROD-GF-13 are completed evidence. Their completion grants no PROD-GF-14 authority.

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


## Fourth Codex review correction

Independent review found one additional valid P2 on direct `ScheduleStore` construction: the server-level admission/cleanup interlock could be bypassed by consumers that instantiate the store directly.

The invariant is now owned by `ScheduleStore` itself.

Before any writable filesystem or database side effect, the constructor now:

1. normalizes/accepts the supplied or newly created write-admission control;
2. rejects invalid admission-control objects;
3. if admission is disabled and the store is writable, requires `orphanCleanupMode = disabled`;
4. only after those checks may it create the database parent, cleanup control, upload directories, SQLite connection, schema, or recovery state.

Direct consumers therefore cannot combine disabled write admission with inherited/enabled cleanup and cannot reach staged-cleanup recovery in that invalid state.

A regression constructs `ScheduleStore` directly with a shared disabled admission control and verifies both `inherit` and `enabled` cleanup modes throw before even creating the target database directory. A direct store with disabled admission plus disabled cleanup remains valid and initializes only the allowed revision-zero bootstrap.

### Fresh implementation-bearing evidence

```text
implementationHead = 5c46f7b0f0705ee636ee44e4335aa79269cd0f79
workflowRun        = 36320960503 (#170)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 745
pass               = 744
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

No production side effect was performed by this correction.


## Fifth Codex review correction

Independent review found one additional valid P1: direct HTTP composition could create a second enabled admission control even when a supplied `ScheduleStore` already owned a disabled control, allowing V2 handlers to bypass the pre-dispatch fence.

The HTTP composition boundary now treats the store-owned admission control as authoritative.

`createHttpApp` resolves admission in this order:

1. `store.writeAdmissionControl`;
2. an explicitly supplied HTTP control only when the store has no control;
3. a standalone fallback only for store-like test/composition objects that expose no control.

If a store-owned control exists and the caller supplies a different explicit control, composition fails closed with `write admission control must match store control`.

The HTTP boundary also validates that the selected control exposes the required admission interface before returning the app.

A regression directly constructs a real write-disabled `ScheduleStore`, passes it to `createHttpApp({ store, kiosk })` without supplying a separate admission control, and proves:

- `/healthz` reports the disabled admission state through `X-Write-Admission`;
- a V2 run-event POST is rejected with `WRITE_ADMISSION_DISABLED` before the injected V2 handler is called;
- attempting to override the store with a different enabled admission control throws before composition.

This closes the HTTP/store admission split-brain for direct consumers.

### Fresh implementation-bearing evidence

```text
implementationHead = 23ce6af2663ca90c6e0ddc82e48539242e536b2c
workflowRun        = 36322711683 (#173)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 746
pass               = 745
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

No production side effect was performed by this correction.


## Sixth Codex review correction

Independent review found one additional valid P1: an injected Kiosk or Scheduling V2 application could retain adapters over a different `ScheduleStore` while `createHttpApp` selected another admission control, creating a V2 admission split-brain.

The composition contract now binds every write-capable surface to one admission authority.

### V2 application authority

`createKioskV2Application` and `createSchedulingV2Application` now require their `ScheduleStore` to expose a valid write-admission control and return that exact control on the application object.

### HTTP composition authority

`createHttpApp` collects the controls exposed by:

- the supplied store;
- write-capable Kiosk application;
- write-capable Scheduling application;
- any explicit HTTP admission control.

Every supplied control must be the **same object**. If any differ, composition fails closed with `all write-capable surfaces must share admission control`.

A write-capable injected Kiosk or Scheduling application that exposes no admission control is rejected before the HTTP app is returned.

Only when no write-capable/store authority exists may the standalone composition fallback create a local control.

### Regression coverage

New regressions prove:

- Kiosk and Scheduling factories expose the exact `ScheduleStore.writeAdmissionControl` object;
- a disabled V2 application composed with a store-like HTTP object that has no control causes HTTP to select the application's disabled authority and reject POST before V2 dispatch;
- composing that same disabled V2 application with a different enabled `ScheduleStore` fails during composition;
- existing HTTP fixture applications explicitly bind their fake write handlers to one shared enabled test control.

This closes admission split-brain across Store / HTTP / Kiosk / Scheduling composition surfaces.

### Fresh implementation-bearing evidence

```text
implementationHead = 165056d67d97d06416328f5fceea9b885347ae77
workflowRun        = 36323202621 (#180)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 748
pass               = 747
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

No production side effect was performed by this correction.


## Seventh Codex review correction

Independent review found one additional valid P1: exposing V2 application admission authority at composition time was not sufficient for direct consumers that call `kiosk.applyRunEvent` or `scheduling.decideProposal` without HTTP.

The V2 application factories now enforce the bound admission control inside their mutation methods before dispatching to any SQLite-backed adapter.

### Direct Kiosk mutation fence

`createKioskV2Application` constructs the underlying run-event use case but wraps the exported `applyRunEvent` method.

When the bound `ScheduleStore.writeAdmissionControl` is disabled:

```text
applyRunEvent(...)
=> ok = false
=> code = WRITE_ADMISSION_DISABLED
=> underlying SQLite run-event adapter is not invoked
```

### Direct Scheduling mutation fence

`createSchedulingV2Application` checks the same bound control at the first line of `decideProposal`.

When disabled, neither accept nor reject logic reaches the proposal store or projection refresh path.

### Stable low-disclosure V2 failure surface

`WRITE_ADMISSION_DISABLED` is recognized as a 503 failure by both Kiosk and Scheduling HTTP result mappings. The Kiosk run-event result schema also admits the low-disclosure failure code.

### Regression coverage

Direct factory tests use real disabled `ScheduleStore` instances and call the mutation methods without HTTP. They capture SQLite `total_changes()` before and after the call and prove:

- result is exactly `{ ok:false, code:WRITE_ADMISSION_DISABLED }`;
- SQLite change count is unchanged;
- the bound application control remains identical to the store control.

This closes the direct V2 application mutation bypass in addition to the existing HTTP composition fence.

### Fresh implementation-bearing evidence

```text
implementationHead = af9e5682696dea7a78f8b085424bd01d0764cd93
workflowRun        = 36323703201 (#188)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 750
pass               = 749
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

No production side effect was performed by this correction.


## Eighth Codex review correction

Independent review found two additional valid findings on the in-process write boundary.

### P1: public ScheduleStore write helpers

`recordOperation` and `recordAudit` were still public unconditional SQLite write methods. A caller holding the store returned by `createOperationsServer` could invoke them directly while admission was disabled.

The store boundary now enforces admission on those helpers before any INSERT.

The same correction also hardens two adjacent public surfaces:

- `recoverStagedUploadCleanup` returns `WRITE_ADMISSION_DISABLED` before any restore/delete mutation while admission is disabled;
- `ScheduleStore.writeAdmissionControl` is installed as a non-writable, non-configurable authority property at construction, so callers cannot swap in an enabled control after startup.

Regression coverage directly calls `recordOperation`, `recordAudit`, and staged recovery on a disabled store, verifies stable admission failure, verifies SQLite `total_changes()` is unchanged, and proves both assignment and property redefinition of the admission control fail.

### P2: V2 wrappers must capture admission authority once

Kiosk and Scheduling wrappers previously exposed one control but consulted `store.writeAdmissionControl` again at mutation time. A mutable store-like object could therefore swap that property after factory construction and create a split between the application’s advertised authority and its mutation guard.

Both factories now:

1. read and validate the store admission control once at construction;
2. capture that exact object in a closure constant;
3. expose that same captured object on the returned application;
4. use only that captured object for every mutation admission check.

Hostile regressions construct each V2 application over a deliberately mutable store-like object, replace the object’s control with an enabled control after construction, and prove the application still uses the originally captured disabled control and performs zero SQLite changes.

### Fresh implementation-bearing evidence

```text
implementationHead = 40750cea50dcb8cb598f2ec31367cd2d00a2cff4
workflowRun        = 36324285941 (#194)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 753
pass               = 752
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

No production side effect was performed by this correction.


## Ninth Codex review correction

Independent review found one additional valid P1: even after store/helper/application fences, the public `store.db` property still exposed the raw writable `DatabaseSync` handle and therefore allowed direct SQLite writes that bypassed the admission authority.

The raw database handle is now private inside `ScheduleStore`.

### Admission-checked database facade

`ScheduleStore` owns the actual `DatabaseSync` connection in a private field. The public `store.db` value is now a frozen minimal facade used by existing adapters/tests.

The facade exposes only:

- `prepare`;
- `exec`;
- `serialize`;
- read-only connection-state getters.

It does **not** expose SQLite policy/escape surfaces such as:

- `setAuthorizer`;
- `deserialize`;
- `createSession`;
- `createTagStore`;
- `loadExtension`.

### SQLite-native admission enforcement

Node 24's SQLite authorizer is used as the statement classifier/execution guard rather than parsing SQL text in JavaScript.

For `prepare`:

1. a temporary authorizer observes the SQLite action codes while the statement is compiled;
2. the statement is classified as read-only or mutating;
3. compilation is allowed so V2 adapters can be constructed while pre-activation admission remains disabled;
4. the returned Statement wrapper checks the live admission control before every execution method (`run/get/all/iterate`) and rejects mutating statements while disabled.

For `exec`:

- the authorizer is installed for the actual execution;
- while admission is disabled, only the read-safe SQLite action set is admitted;
- INSERT/UPDATE/DELETE/DDL/PRAGMA/ATTACH and other non-read actions receive `SQLITE_DENY`;
- after the one-way admission enable transition, the same facade permits normal production writes.

This preserves pre-activation read transactions and V2 adapter construction without exposing a raw writable database handle.

### Regression coverage

The hostile raw-database regression proves that, while admission is disabled:

- SELECT remains available;
- `prepare(INSERT).run()` is rejected;
- direct `exec(UPDATE ...)` is rejected;
- direct mutating PRAGMA is rejected;
- SQLite `total_changes()` remains unchanged;
- the facade exposes no authorizer/deserialization/session/extension/tag-store escape method.

After the same admission control is explicitly enabled, the exact same facade can perform an admitted write, proving the boundary follows the live admission authority rather than permanently converting the database to read-only mode.

### Fresh implementation-bearing evidence

```text
implementationHead = 41decc2bd79b43bd4ade858c6dddcb12f203f8cd
workflowRun        = 36326012272 (#198)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 754
pass               = 753
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

The failed intermediate runs #196 and #197 used the earlier permanent-authorizer variant, which blocked V2 adapter statement preparation. They are superseded by exact-head run #198 and are not acceptance evidence.

No production side effect was performed by this correction.


## Tenth Codex review correction

Independent review found one additional valid P1: the admission-checked prepared statement was still implemented as a Proxy over the raw `StatementSync`. Because caller-defined properties were forwarded to the raw target, a consumer could install an `unwrap()` method and recover the unwrapped statement, then call `run()` without the admission guard.

The Proxy has been removed entirely.

### Frozen statement capability facade

`store.db.prepare()` now returns a dedicated null-prototype, frozen, non-extensible facade rather than a Proxy.

The facade exposes only an explicit allowlist of supported statement capabilities:

- `run`
- `get`
- `all`
- `iterate`
- `columns`
- named-parameter configuration methods
- read-only `sourceSQL` / `expandedSQL` getters

The raw `StatementSync` object remains closure-private.

Mutating execution methods continue to consult the same live admission control before touching SQLite.

Because the facade:

- has no prototype;
- is frozen;
- is non-extensible;
- never binds arbitrary caller-visible function properties to the raw statement;

`Object.defineProperty`, assignment, prototype replacement, or prototype injection cannot create an unwrap path.

### Exploit regression

The exact reported exploit is covered:

```text
Object.defineProperty(stmt, 'unwrap', {
  value() { return this; }
})
```

is rejected.

The regression also proves:

- `Object.getPrototypeOf(stmt) === null`;
- the facade is frozen and non-extensible;
- assignment of an `unwrap` property fails;
- `Object.setPrototypeOf` fails;
- the mutating statement still cannot run while admission is disabled;
- SQLite `total_changes()` remains unchanged.

### Fresh implementation-bearing evidence

```text
implementationHead = a7e695b05c71254edc82725268eed7fda3b8a1ce
workflowRun        = 36326762035 (#201)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 755
pass               = 754
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

No production side effect was performed by this correction.


## Eleventh Codex review correction

Independent review found two additional valid P1 prototype-capture paths:

1. `DatabaseSync.prototype` methods could be replaced after module import; dynamic database method lookup would then supply the closure-private raw database as `this`.
2. `StatementSync.prototype` methods could likewise be replaced; dynamic statement method lookup would supply the raw statement as `this`, allowing the caller to retain and reuse it outside the admission facade.

The SQLite boundary now captures its native capabilities exactly once when `store.mjs` is evaluated.

### Captured DatabaseSync capabilities

Module initialization captures the native function objects for:

- `prepare`
- `exec`
- `setAuthorizer`
- `serialize`
- `close`

All later database calls use these captured function objects through the captured `Reflect.apply`. Runtime reads from `DatabaseSync.prototype` are not used by the admission facade, store bootstrap, schema/revision-zero initialization, or close path.

The ScheduleStore bootstrap itself now runs through an internal bootstrap database facade that uses the same captured native capabilities. This means prototype replacement performed **after module import but before ScheduleStore construction** cannot capture the raw database during PRAGMA/schema/revision-zero initialization.

### Captured StatementSync capabilities

Module initialization also captures the native function objects for:

- `run`
- `get`
- `all`
- `iterate`
- `columns`
- named-parameter configuration methods

The frozen statement facade invokes only these captured function objects. It never performs a runtime method lookup on `StatementSync.prototype`.

Optional SQLite state/SQL-inspection properties that are not prototype methods in Node 24.21.0 and are unused by this repository were deliberately omitted from the facade rather than reintroducing dynamic prototype reads.

### Hostile prototype-capture regression

The regression patches `DatabaseSync.prototype.prepare/exec/setAuthorizer/close` and `StatementSync.prototype.setAllowBareNamedParameters/run` **before constructing ScheduleStore**.

Each hostile wrapper records its `this` target if invoked.

The test proves:

- ScheduleStore bootstrap succeeds without invoking any hostile DatabaseSync wrapper;
- public database reads/writes continue to use captured native functions;
- named-parameter statement configuration does not invoke the hostile StatementSync wrapper;
- disabled mutation remains blocked with zero SQLite changes;
- the admitted post-enable mutation succeeds without invoking the hostile StatementSync wrapper;
- store close uses the captured native close function;
- every hostile raw-database/raw-statement capture variable remains null.

### Fresh implementation-bearing evidence

```text
implementationHead = b03e2700293c3ee129438d2d143da324630d4ac1
workflowRun        = 36327922573 (#208)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 756
pass               = 755
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

Intermediate runs #203-#205 exercised incomplete native-capability snapshots and are superseded by exact-head run #208. They are not acceptance evidence.

No production side effect was performed by this correction.


## Twelfth Codex review correction

Independent review found one additional valid P1: the hardened database facade had removed the native transaction-state signal required by the Outbox repository. As a result, factory-built Kiosk completion could enter a real `BEGIN IMMEDIATE` transaction while `db.isTransaction` appeared absent/falsy, causing `OUTBOX_TRANSACTION_REQUIRED` and rolling the completion back as `INTERNAL_ERROR`.

The facade now preserves the trustworthy native transaction-state signal without reopening prototype dispatch.

### Native instance transaction-state getter

Node 24 exposes `DatabaseSync.isTransaction` as an own, read-only native getter on each database instance.

At ScheduleStore construction, the facade obtains that **instance-owned, non-configurable native getter** using the module-load-captured `Object.getOwnPropertyDescriptor`.

The public facade exposes only:

```text
get isTransaction() {
  return capturedNativeGetter.call(privateDatabase)
}
```

through the already captured `Reflect.apply`.

No runtime lookup through `DatabaseSync.prototype` is used.

### Outbox transaction regression

A real `createSqliteOutboxRepositoryV1` is constructed over `ScheduleStore.db`.

The regression proves:

- outside a transaction, `db.isTransaction === false` and enqueue returns `OUTBOX_TRANSACTION_REQUIRED`;
- after `BEGIN IMMEDIATE`, `db.isTransaction === true`;
- the same repository enqueues successfully with `OUTBOX_ENQUEUED`;
- after `COMMIT`, `db.isTransaction === false`;
- a subsequent `BEGIN IMMEDIATE / ROLLBACK` toggles true → false correctly.

### Factory-built Kiosk completion regression

The repository's existing grouped-run fixture is seeded into a file-backed database, reopened through `ScheduleStore`, and then exercised through `createKioskV2Application`.

The test performs:

```text
start
→ complete
→ notification_outbox enqueue
```

through the admission-checked database facade.

It proves:

- the start succeeds;
- the complete succeeds with `resultingState = completed`;
- the transaction is closed again after each application call;
- the completion notification is persisted in `notification_outbox` with the expected outbox id, aggregate revision, route key and pending status.

This directly covers the failure path reported by review rather than only testing the facade getter in isolation.

### Fresh implementation-bearing evidence

```text
implementationHead = dca148e74450c2829d81e4460ecf8a6aa003d7a9
workflowRun        = 36328772929 (#213)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 758
pass               = 757
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

No production side effect was performed by this correction.


## Thirteenth Codex review correction

Independent review found one additional valid P1: SQLite authorizer classification still called `SQLITE_ADMISSION_READ_ACTIONS.has(...)` dynamically. An in-process caller could replace `Set.prototype.has` after `store.mjs` loaded and force every SQLite authorizer action to appear read-only, allowing the public database facade to misclassify prepared writes and direct `exec` writes while admission was disabled.

The admission classifier now captures the native `Set.prototype.has` function exactly once when `store.mjs` is evaluated.

All SQLite read-action membership checks now use:

```text
captured Reflect.apply(
  captured Set.prototype.has,
  SQLITE_ADMISSION_READ_ACTIONS,
  [actionCode]
)
```

There is no runtime dispatch through mutable `Set.prototype.has` in either:

- prepared-statement write classification; or
- direct `exec` authorizer enforcement.

### Hostile regression

A disabled ScheduleStore is constructed normally. The test then replaces `Set.prototype.has` with a hostile implementation that returns `true` for every membership check and proves the replacement is active.

While that hostile replacement is installed:

- a prepared INSERT is still classified as mutating and cannot execute;
- direct `exec(INSERT ...)` is rejected;
- direct `exec(UPDATE ...)` is rejected;
- SQLite `total_changes()` remains unchanged;
- the canonical schedule snapshot revision remains unchanged.

This directly covers the reported live-facade bypass without widening the PR into unrelated same-process sandboxing.

### Fresh implementation-bearing evidence

```text
implementationHead = 0525ff978c737c1023dadd7646e498c9d75d79d9
workflowRun        = 36330358691 (#218)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 759
pass               = 758
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

Intermediate runs #216 and #217 exercised over-broad hostile test timing/assertions and are superseded by exact-head run #218. They are not acceptance evidence.

No production side effect was performed by this correction.


## Fourteenth Codex review correction

Independent review found two additional valid P1s in the admission authority itself.

### P1: mutable String normalization primitives

`normalizeWriteAdmissionMode` previously used runtime `String(...).trim().toLowerCase()` dispatch. Same-realm code could replace `globalThis.String` or the referenced string prototype methods after module evaluation but before server construction and force a configured `disabled` mode to normalize as `enabled`.

The admission module now captures at module evaluation:

- `String`;
- `String.prototype.trim`;
- `String.prototype.toLowerCase`;
- `Reflect.apply`.

Normalization uses only those captured primitives. The two-mode admission check no longer depends on `Set.prototype.has`; it compares directly against the frozen semantic values `enabled` and `disabled`.

A hostile regression replaces `globalThis.String`, `String.prototype.trim`, and `String.prototype.toLowerCase` with implementations that all try to return `enabled`, then constructs a control with `initialMode: disabled`. The resulting control remains disabled with transition count zero.

### P1: mutable Object.freeze

The control factory previously called runtime `Object.freeze`. Same-realm code could replace it after module evaluation and receive a mutable admission control, then overwrite `isDisabled` or `enable` without the audited transition.

The module now captures native `Object.freeze` once at module evaluation and uses that captured function for:

- the public control object;
- status snapshots;
- enable receipts;
- already-enabled receipts;
- `writeAdmissionFailure` responses.

The hostile regression replaces runtime `Object.freeze` with a no-op before constructing a disabled control and proves:

- the returned control remains frozen;
- status/failure responses remain frozen;
- attempts to replace `isDisabled` or `enable` throw;
- the control remains disabled with transition count zero;
- the only successful state change is the original captured `enable` function, which advances transition count exactly once.

### Fresh implementation-bearing evidence

```text
implementationHead = 737e2abe0166578cd5b3bd1004eb1aeadf34e98d
workflowRun        = 36331091273 (#222)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 761
pass               = 760
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

Intermediate run #221 failed only because the new freeze regression omitted the existing `writeAdmissionFailure` import; it is superseded by exact-head run #222 and is not acceptance evidence.

No production side effect was performed by this correction.


## Fifteenth Codex review correction

Independent review found one additional valid P1: `ScheduleStore` still exposed the raw filesystem rename function as public `store.renameFile`. A caller holding the returned store could therefore mutate database/upload/cleanup-control paths directly without consulting write admission.

The raw rename capability is now private to `ScheduleStore`.

### Private filesystem mutation capability

The store now declares a private `#renameFile` field.

Construction still accepts the existing test seam:

```text
fileOperations.rename
```

or defaults to native `renameSync`, but the selected function is stored only in `#renameFile`.

All cleanup/recovery internals use `this.#renameFile(...)`.

The returned store no longer exposes:

```text
store.renameFile
```

or any equivalent public rename method.

### Regression coverage

A disabled ScheduleStore is constructed with an injected rename function and proves:

- `'renameFile' in store === false`;
- `store.renameFile === undefined`;
- the store has no own `renameFile` property.

Existing cleanup/recovery tests continue to exercise the private injected rename seam. The one legacy test that previously used the public store method merely to manufacture a staged test file now uses the test-side `renameSync` directly, preserving its scenario without restoring the production capability.

### Fresh implementation-bearing evidence

```text
implementationHead = 2dcc824c0114aa1358002667569995e205742285
workflowRun        = 36331817252 (#226)
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 762
pass               = 761
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

Intermediate run #225 failed only because one legacy test still called the deliberately removed public rename helper; it was updated to use its own test-side filesystem rename and is superseded by exact-head run #226.

No production side effect was performed by this correction.


## Production evidence promotion: PROD-03 and PROD-04

The first greenfield production deployment has now completed the next two explicitly authorized bounded actions on the bound target host. This section promotes only low-disclosure execution facts into Git authority. It does not reproduce secret values and it does not authorize the next production mutation.

### PROD-03-GENERATE-INSTALL-TOKENS

Bound target:

```text
instanceId           = ins-mi85f3my
instanceName         = AGENTS-OS
privateIpv4          = 172.16.0.12
applicationDirectory = /mnt/datadisk0/apps/jenn-shooting-operations
```

Recorded production evidence:

```text
result                = PASS
recordedAtUtc         = 2026-09-27T16:34:04.678274744Z
secretStoragePath     = /mnt/datadisk0/apps/jenn-shooting-operations/.env.tokens
fileOwner             = ubuntu:ubuntu
fileMode              = 0600
fileSizeBytes         = 317
roleTokenCount        = 4
uniqueRoleTokenCount  = 4
tokenHexLength        = 64
secretValuesRecorded  = false
noSecretOutput        = true
rollbackActionId      = ROLLBACK-06-REVOKE-ROLE-TOKENS
```

The four role-token values were generated independently on the production host. Their values were not committed to Git, copied into this document, or emitted by the verification output.

### PROD-04-BUILD-IMAGE

The production image was built from exact authority commit:

```text
92b7137211bf807f178901e878a8c3d6e335cec4
```

Recorded production evidence:

```text
result                  = PASS
recordedAtUtc           = 2026-09-27T16:48:50.128965614Z
imageTag                = jenn-shooting-operations:prod-92b7137211bf807f178901e878a8c3d6e335cec4
imageId                 = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
nodeBaseIndexDigest     = sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
nodeBaseAmd64Digest     = sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a
imageUser               = node
targetContainers        = 0
port3800Listeners       = 0
tempBuildArtifacts      = 0
buildLogLowDisclosure   = true
secretValuesOutput      = false
evidencePath            = /mnt/datadisk0/apps/jenn-shooting-operations/prod04-build-evidence.txt
rollbackActionId        = ROLLBACK-08-REMOVE-BUILT-IMAGE
```

No application container was started by PROD-04.

### Authority promotion

The greenfield authority now records:

```text
completedAcceptanceIds =
  PROD-01-TARGET-READONLY-PREFLIGHT
  PROD-02-CREATE-ISOLATED-APP-STORAGE
  PHASE-B-TARGET-VOLUME-ACCEPTANCE
  PROD-03-GENERATE-INSTALL-TOKENS
  PROD-04-BUILD-IMAGE

authorization.status  = FROZEN_NOT_REQUESTED
requestedActionIds    = []
approvedActionIds     = []
requestableActionIds  = []
nextActionId          = PROD-05-START-ISOLATED-CONTAINER
```

This promotion records completed facts only. It does not authorize PROD-05.

### Exact-head independent validation

Implementation-bearing head:

```text
cf56a94207b56d1df2c7d37f9f3b9da082cabc3b
```

The repository's GitHub workflow currently auto-runs only on its two historical branch names, so PR #21 did not receive an automatic Actions run on this new branch. The exact head was independently checked using Node 24.21.0 with the same repository commands as the workflow, in a disposable validation container with no production data volume, no secret mount, no port binding and no application startup.

```text
runtime            = Node 24.21.0
fullTests          = 763
pass               = 762
fail               = 0
skip               = 1 expected external VCP adapter absence
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:45d50b79f4d6be8a3f8635ee48086ab1d6ef6c81adcc4d77c35b58b6b5f927ec
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-05-START-ISOLATED-CONTAINER
```

The first disposable validation attempt used Alpine and failed only two migration tests because BusyBox `touch` does not accept the GNU nanosecond epoch syntax used by those fixtures. The command-equivalent Node 24.21.0 GNU-userland rerun passed the complete suite. The disposable validation container and temporary checkout were removed, and the production application container count remained zero throughout.

## Production evidence promotion: PROD-05

The owner explicitly authorized only `PROD-05-START-ISOLATED-CONTAINER`. Before the start, the bound host was revalidated as `ins-mi85f3my / VM-0-12-ubuntu / 172.16.0.12`, with zero Jenn Shooting Operations containers, zero target-volume container mounts, zero port-3800 listeners and zero matching Nginx routes. The exact PROD-04 image remained present.

Recorded production evidence:

```text
result                          = PASS
recordedAtUtc                   = 2026-09-27T17:50:49Z
containerName                   = jenn-shooting-operations-prod
containerId                     = 45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99
imageId                         = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
loopbackBind                    = 127.0.0.1:3800
healthStatus                    = healthy
runtimeUid                      = 1000
runtimeGid                      = 1000
dataVolume                      = jenn-shooting-operations_shooting_data
dataVolumeBind                  = /app/data
targetVolumeContainerMountCount = 1
readOnlyRootfs                  = true
restartPolicy                   = unless-stopped
writeAdmissionMode              = disabled
orphanCleanupMode               = disabled
orphanCleanupState              = disabled
orphanCleanupMarkerValid        = true
orphanCleanupActiveRuns         = 0
bootstrapRevision               = 0
secretValuesRecorded            = false
evidencePath                    = /mnt/datadisk0/apps/jenn-shooting-operations/prod05-start-evidence.txt
evidenceSha256                  = sha256:f33a4175f10318fde375e85ca21a55fb7b1243717d039ffdaee96f3480e047a6
rollbackActionId                = ROLLBACK-02-STOP-NEW-CONTAINER
```

The container was started from the exact approved image using the existing restricted token file as an environment-file binding. No token value was copied into Git, chat, build context or evidence output.

The greenfield write fence is held from PROD-05: `WRITE_ADMISSION_MODE=disabled` and `ORPHAN_CLEANUP_MODE=disabled`. Runtime inspection showed the orphan-cleanup control marker in `disabled` state with a valid marker and zero active runs. The frozen source also denies `saveUpload`, `submitRequest`, manual/periodic non-dry-run cleanup and cleanup enablement while write admission is disabled. Only the allowed empty-target schema and revision-zero bootstrap occurred before listen.

Authority state after this evidence promotion:

```text
completedAcceptanceIds =
  PROD-01-TARGET-READONLY-PREFLIGHT
  PROD-02-CREATE-ISOLATED-APP-STORAGE
  PHASE-B-TARGET-VOLUME-ACCEPTANCE
  PROD-03-GENERATE-INSTALL-TOKENS
  PROD-04-BUILD-IMAGE
  PROD-05-START-ISOLATED-CONTAINER

authorization.status  = FROZEN_NOT_REQUESTED
requestedActionIds    = []
approvedActionIds     = []
requestableActionIds  = []
nextActionId          = PROD-06-LOOPBACK-HEALTH-SMOKE
```

This promotion records completed PROD-05 facts only. It does not authorize PROD-06.

### PROD-05 promotion exact-head validation

The implementation-bearing promotion head was independently validated by the repository's production-authorization workflow:

```text
implementationHead = 73578d55e7949213fd8e93b0a9a18f366e1ee044
workflowRun        = 36338748349
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 763
pass               = 762
fail               = 0
skip               = 1 expected external VCP adapter absence
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:47e931320eeceb0af7089497a3f8e09410019f7881d25045b826ac14636ed995
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-06-LOOPBACK-HEALTH-SMOKE
```

This validation performed no production mutation. Because this evidence paragraph changes only the acceptance document, the resulting final docs head is validated separately before merge eligibility.

## Production evidence promotion: PROD-06

After PR #22 merged, integration authority advanced to merge commit `68834a19e86c67a5281ffdee406ab56c1417725a`, which was identical to `codex/v2-1-architecture-freeze`. The owner then explicitly authorized only `PROD-06-LOOPBACK-HEALTH-SMOKE`.

PROD-06 performed read-only production-host probes only. It did not modify the container, route, DNS, TLS, firewall, write admission, cleanup state, database contents or integrations.

Recorded production evidence:

```text
result                        = PASS
recordedAtUtc                 = 2026-09-27T18:08:17Z
containerName                 = jenn-shooting-operations-prod
containerId                   = 45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99
imageId                       = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
containerState                = running
containerHealth               = healthy
healthzStatus                 = 200
healthzBody                   = {"ok":true,"service":"jenn-shooting-operations"}
healthzWriteAdmissionHeader   = disabled
containerUid                  = 1000
containerGid                  = 1000
databasePath                  = /app/data/shooting-operations.sqlite
volumeMount                   = volume|jenn-shooting-operations_shooting_data|/app/data|true
loopbackBind                  = 127.0.0.1:3800
writeAdmissionMode            = disabled
orphanCleanupMode             = disabled
bootstrapRevision             = 0
containerStartCompletionProof = PROD-05-START-ISOLATED-CONTAINER
readOnlySmoke                 = true
secretValuesRecorded          = false
```

The loopback health response matched the frozen service contract and the read-only `X-Write-Admission` header remained `disabled`. The same PROD-05 container ID and image were still running and healthy, the database path and named-volume mount remained exact, and revision remained zero.

Authority state after this evidence promotion:

```text
completedAcceptanceIds =
  PROD-01-TARGET-READONLY-PREFLIGHT
  PROD-02-CREATE-ISOLATED-APP-STORAGE
  PHASE-B-TARGET-VOLUME-ACCEPTANCE
  PROD-03-GENERATE-INSTALL-TOKENS
  PROD-04-BUILD-IMAGE
  PROD-05-START-ISOLATED-CONTAINER
  PROD-06-LOOPBACK-HEALTH-SMOKE

authorization.status  = FROZEN_NOT_REQUESTED
requestedActionIds    = []
approvedActionIds     = []
requestableActionIds  = []
nextActionId          = PROD-07-CONFIGURE-REVERSE-PROXY-TLS
```

This promotion records completed PROD-06 facts only. It does not authorize PROD-07.

## Production evidence promotion: PROD-07

The owner explicitly selected `jso.skmt617.top` and authorized only `PROD-07-CONFIGURE-REVERSE-PROXY-TLS`.

Before the route mutation, read-only production inspection confirmed no existing `jso.skmt617.top` Nginx route and no existing proxy to `127.0.0.1:3800`. The running PROD-05 container remained healthy with write admission and orphan cleanup disabled. The existing Cloudflare Origin certificate served on the host covers the `skmt617.top` wildcard family, so no new certificate issuance or private-key material was required.

The owner installed the dedicated Nginx route as root, ran `nginx -t` successfully, reloaded Nginx and confirmed the service remained active. Independent post-change verification then confirmed:

```text
result                         = PASS
recordedAtUtc                  = 2026-09-27T22:52:59Z
hostname                       = jso.skmt617.top
route                          = https://jso.skmt617.top
nginxConfigPath                = /etc/nginx/conf.d/jso-shooting-operations.conf
nginxConfigMode                = 0644
nginxConfigTest                = PASS_ROOT_OPERATOR
nginxReload                    = PASS_ROOT_OPERATOR
nginxActive                    = true
noExistingRouteOverwrite       = true
preMutationRouteMatchCount     = 0
postMutationRouteMatchCount    = 1
backend                        = http://127.0.0.1:3800
backendHealthStatus            = 200
publicHealthStatus             = 200
publicHealthWriteAdmission     = disabled
httpRedirectStatus             = 308
tlsOriginCertificateFamily     = skmt617.top
tlsOriginHostnameCoverage      = true
tlsOriginValidFromUtc          = 2026-06-22T08:45:00Z
tlsOriginValidToUtc            = 2041-06-18T08:45:00Z
tlsEdgeStatus                  = PASS
dnsProvider                    = Cloudflare
dnsProxyMode                   = PROXIED
publicWritePostStatus          = 503
publicWritePutStatus           = 503
publicWritePatchStatus         = 503
publicWriteDeleteStatus        = 503
publicWriteFailureCode         = WRITE_ADMISSION_DISABLED
boundedStagingPrincipalScope   = NO_PREACTIVATION_WRITES
writeAdmissionMode             = disabled
orphanCleanupMode              = disabled
orphanCleanupState             = disabled
orphanCleanupMarkerValid       = true
orphanCleanupActiveRuns        = 0
bootstrapRevision              = 0
stagingRequestPathCleanupDisabled = true
prod08RequiredForCurrentHttpsReachability = false
secretValuesRecorded           = false
evidencePath                   = /mnt/datadisk0/apps/jenn-shooting-operations/prod07-route-evidence.txt
evidenceSha256                 = sha256:a49ecf5e5d358f1774f631af57dd930401a3bc9c6468d339322966d1e6329cc1
rollbackActionId               = ROLLBACK-01-REMOVE-NEW-ROUTE
```

The public route is intentionally readable before activation but all mutating HTTP methods remain rejected by the same in-process greenfield write fence. PROD-07 did not enable staging writes, write admission, orphan cleanup, VCP, Kiosk or activation.

Authority state after this promotion:

```text
completedAcceptanceIds =
  PROD-01-TARGET-READONLY-PREFLIGHT
  PROD-02-CREATE-ISOLATED-APP-STORAGE
  PHASE-B-TARGET-VOLUME-ACCEPTANCE
  PROD-03-GENERATE-INSTALL-TOKENS
  PROD-04-BUILD-IMAGE
  PROD-05-START-ISOLATED-CONTAINER
  PROD-06-LOOPBACK-HEALTH-SMOKE
  PROD-07-CONFIGURE-REVERSE-PROXY-TLS

authorization.status  = FROZEN_NOT_REQUESTED
requestedActionIds    = []
approvedActionIds     = []
requestableActionIds  = []
nextActionId          = PROD-GF-13-ACTIVATE
```

Conditional `PROD-08-FIREWALL-SECURITY-GROUP` remains defined but was not required for the current HTTPS route, which is already externally reachable through Cloudflare. This promotion does not authorize `PROD-GF-13-ACTIVATE`.

### PROD-07 promotion exact-head validation

The implementation-bearing promotion head was independently validated by the repository production-authorization workflow:

```text
implementationHead = 60287c4ca29ad04e11550602286ba10c68932741
workflowRun        = 36356957798
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 763
pass               = 762
fail               = 0
skip               = 1 expected external VCP adapter absence
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:6f5b43acd1bf868f46c26237d7231f1023a1825cee4c9700a5b4eca5d15a901c
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-GF-13-ACTIVATE
```

This validation performed no production mutation. Because this paragraph changes only the acceptance document, the resulting final docs head is validated separately before merge eligibility.

## Production evidence promotion: PROD-GF-13

The owner explicitly authorized `PROD-GF-13-ACTIVATE`. Activation was performed only after a fresh read-only pre-enable verification of the already-routed Greenfield service.

Pre-enable verification established all of the following while the write fence was still disabled:

```text
instanceId                       = ins-mi85f3my
route                            = https://jso.skmt617.top
clientScope                      = HTTPS_ROUTE_ONLY_NO_VCP_NO_KIOSK
containerId                      = 45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99
imageId                          = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
hostPid                          = 747599
containerStartedAt               = 2026-09-27T17:49:01.319828677Z
targetVolumeContainerMountCount  = 1
containerProcessCount            = 1
preEnableWriteAdmission          = disabled
preEnableMutatingMethodsDenied   = true
preEnableOrphanCleanupState      = disabled
preEnableOrphanCleanupActiveRuns = 0
preEnableRevision                = 0
preEnableUploadRows              = 0
preEnableOperationRows           = 0
preEnableAuditRows               = 0
preEnableAttachmentFiles         = 0
integrationEnvCount              = 0
directStoreGuardCount            = 5
```

The route, container, image, process, target volume and database baseline were then fixed as the pre-enable identity set. Activation sent exactly one `SIGUSR2` to the existing container process. The process emitted:

```text
event           = WRITE_ADMISSION_ENABLED
writeAdmission  = enabled
transitionCount = 1
```

No container restart, image replacement, route change, Nginx change or volume remount occurred.

Post-enable verification confirmed:

```text
activatedAtUtc                     = 2026-09-27T23:11:00Z
verifiedAtUtc                      = 2026-09-27T23:12:00Z
sameContainerPost                  = true
sameHostPidPost                    = true
sameStartedAtPost                  = true
sameImagePost                      = true
sameRouteConfigPost                = true
sameDataVolumePost                 = true
loopbackHealth                     = 200
routedHealth                       = 200
loopbackWriteAdmission             = enabled
routedWriteAdmission               = enabled
unauthenticatedWriteProbeStatus    = 401
unauthenticatedWriteProbeCode      = UNAUTHORIZED
orphanCleanupPost                  = disabled
orphanCleanupActiveRunsPost        = 0
postEnableRevision                 = 0
postEnableUploadRows               = 0
postEnableOperationRows            = 0
postEnableAuditRows                = 0
postEnableAttachmentFiles          = 0
integrationsRemainDisabled         = true
orphanCleanupRestorationDeferred   = true
```

The unauthenticated write probe changing from pre-activation `503 WRITE_ADMISSION_DISABLED` to post-activation `401 UNAUTHORIZED` proves the in-process admission fence was enabled while the normal authorization boundary remained effective. The probe caused no business mutation; revision and every database/attachment baseline remained zero.

Low-disclosure production evidence:

```text
evidencePath   = /mnt/datadisk0/apps/jenn-shooting-operations/prod-gf13-activation-evidence.txt
evidenceMode   = 0600
evidenceSha256 = sha256:1af2e9dd6ca511631ac5d7efb949d0b96c306b1d2c551241a5910b7ba7b81cb2
secretValuesRecorded = false
```

Authority state after this promotion:

```text
completedAcceptanceIds includes PROD-GF-13-ACTIVATE
authorization.status  = FROZEN_NOT_REQUESTED
requestedActionIds    = []
approvedActionIds     = []
requestableActionIds  = []
nextActionId          = PROD-GF-14-RESTORE-ORPHAN-CLEANUP
```

VCP and Kiosk remain separate post-activation actions. Orphan cleanup remains disabled until a separately authorized `PROD-GF-14-RESTORE-ORPHAN-CLEANUP`. This promotion does not authorize any of them.

### PROD-GF-13 promotion exact-head validation (historical, superseded)

This is a historical branch snapshot retained for audit. It predates the durability-governance P1 and is superseded by the current reconciliation boundary below. The implementation-bearing activation promotion head was independently validated by the repository production-authorization workflow:

```text
implementationHead = f537ebadd8a45f430245e5b7456a17fdd4aa172b
workflowRun        = 36358069647
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 763
pass               = 762
fail               = 0
skip               = 1 expected external VCP adapter absence
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:cbabd9756a465d0d616e09407a08e173601a24e4e3f99a283a0ac7dcd509793d
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-GF-14-RESTORE-ORPHAN-CLEANUP
```

This validation performed no additional production mutation. Because this paragraph changes only the acceptance document, the resulting final docs head is validated separately before merge eligibility.



### Activation durability remediation

Review identified that the original one-time in-process activation would not survive a container restart because the original container startup mode remained disabled.

The remediation uses the existing startup contract rather than an unattended signal watcher. A non-sensitive runtime configuration now starts the production service with write admission enabled while orphan cleanup remains disabled. The exact production image was first verified against an isolated disposable volume.

The production container was then replaced using the same image, route, port, target volume and security posture. The prior container was retained as rollback protection until first-start verification passed. A deliberate restart of the replacement container then proved that activation survives restart without another signal.

This replacement/restart is now explicitly disclosed as an out-of-order remediation relative to the exact-action authorization model. It is not retroactively represented as having had an exact Action ID before execution, and it is not sufficient by itself to mint authoritative PROD-GF-13 completion. Current authority therefore requires the separate read-only reconciliation action `PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION` before activation completion can enter `completedAcceptanceIds`.

```text
durabilityRemediationStatus            = PASS
startedAtUtc                           = 2026-09-27T23:29:06Z
verifiedAtUtc                          = 2026-09-27T23:29:42Z
priorContainerId                       = 45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99
durableContainerId                     = 1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb
durableContainerStartedAt              = 2026-09-27T23:29:33.784982222Z
durableContainerImageId                = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
restartPolicy                          = unless-stopped
readOnlyRootfs                         = true
durableRuntimeEnvSha256                = sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c
firstDurableStartAdmission             = enabled
restartProbePerformed                  = true
restartProbeAdmission                  = enabled
publicHealthAfterRestart               = 200
publicAdmissionAfterRestart            = enabled
unauthenticatedWriteAfterRestart       = 401 UNAUTHORIZED
orphanCleanupAfterRestart              = disabled
orphanCleanupActiveRunsAfterRestart    = 0
databaseRevisionAfterRestart           = 0
uploadRowsAfterRestart                 = 0
operationRowsAfterRestart              = 0
auditRowsAfterRestart                  = 0
activeTargetVolumeMountCount           = 1
durableVolumeType                       = volume
durableVolumeName                       = jenn-shooting-operations_shooting_data
durableVolumeSource                     = /mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data
durableVolumeDestination                = /app/data
durableVolumeReadWrite                  = true
durableDataDeviceInode                  = 64784:1835042
durableDatabasePath                     = /app/data/shooting-operations.sqlite
durableDatabaseDeviceInode              = 64784:1835048
durableDatabaseIdentityVerified         = true
durableLoopbackHostIp                   = 127.0.0.1
durableLoopbackHostPort                 = 3800
durableContainerPort                    = 3800/tcp
durableVolumeIdentityVerified           = true
durableLoopbackBindVerified             = true
priorContainerRemovedAfterVerification = true
durableActivationAcrossRestartVerified = true
```

The remediation records no credential values.

### Durability remediation exact-head validation (historical, superseded)

This is a historical branch snapshot retained for audit. It predates the later finding that the replacement/restart itself lacked an exact Action ID. It is not current authorization state. The implementation-bearing durability remediation head was validated after the restart proof and authority update:

```text
implementationHead = d5c5d6acb9b98dd475ddc55664a9964923bbfee5
workflowRun        = 36359082926
result             = SUCCESS
runtime            = Node 24.21.0
fullTests          = 763
pass               = 762
fail               = 0
skip               = 1 expected external VCP adapter absence
manifestTargeted   = 112 / 112 PASS
baseManifest       = WO_06D_MANIFEST_VALID
baseDigest         = sha256:ece64d36ce042b0cee05ee08cb24f7eff71064a104bf886ba46c483d41b5b27b
greenfieldVerdict  = WO_06D_GREENFIELD_AUTHORITY_VALID
greenfieldDigest   = sha256:b2fc967fc00e63d26dead398373eca886a59c6f32ac8cf6ad3fa77edaf235e4c
authorization      = FROZEN_NOT_REQUESTED
requestableActions = []
nextAction         = PROD-GF-14-RESTORE-ORPHAN-CLEANUP
```

This validation followed a real restart proof: the replacement production container started with write admission enabled, was deliberately restarted, and remained enabled afterward while cleanup stayed disabled and the database/attachment baseline remained unchanged. This paragraph is docs-only, so the resulting final head is validated once more before merge eligibility.

### Governance reconciliation boundary

The durability remediation evidence is real, but the container replacement and restart happened before an exact durability-remediation Action ID existed. The authority therefore does not retroactively rewrite that history.

Current state:

```text
PROD-GF-13 runtime activation status = PASS
PROD-GF-13 governance status         = RECONCILED_EXACT_READ_ONLY
PROD-GF-13R reconciliation status    = PASS
PROD-GF-13 in completedAcceptanceIds = true
PROD-GF-13R in completedAcceptanceIds = true
nextActionId                         = PROD-GF-14-RESTORE-ORPHAN-CLEANUP
nextAction requires explicit auth    = true
```

`PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION` was separately authorized and executed read-only. It re-read and bound the exact current durable container to the approved image, `127.0.0.1:3800` host bind, approved target volume name/source/destination/device-inode, exact database path `/app/data/shooting-operations.sqlite` and database device/inode `64784:1835048`, restart proof, health/write-admission state, database baseline, cleanup-disabled state and integration-disabled state. It performed no recreate, restart, signal, remount, rebind, cleanup enablement or integration enablement.

Earlier exact-head validation blocks in this document are retained as historical snapshots of the branch at those heads. Current authority is the reconciled state below.

### PROD-GF-13R read-only reconciliation evidence

The owner explicitly authorized `PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION`. The action was executed as a read-only reconciliation against the merged authority. No production mutation occurred.

Fresh production facts at `2026-09-28T03:09:43Z`:

```text
instanceId                    = ins-mi85f3my
containerId                   = 1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb
imageId                       = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
containerState                = running
containerHealth               = healthy
containerStartedAt            = 2026-09-27T23:29:33.784982222Z
restartPolicy                 = unless-stopped
readOnlyRootfs                = true

loopbackBind                  = 127.0.0.1:3800 -> 3800/tcp

volumeType                    = volume
volumeName                    = jenn-shooting-operations_shooting_data
volumeSource                  = /mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data
volumeDestination             = /app/data
volumeReadWrite               = true
activeTargetVolumeMountCount  = 1
dataDeviceInode               = 64784:1835042

databasePath                  = /app/data/shooting-operations.sqlite
databaseRuntimePath           = /app/data/shooting-operations.sqlite
databaseDeviceInode           = 64784:1835048

writeAdmissionEnvironment     = enabled
orphanCleanupEnvironment      = disabled
orphanCleanupDomain           = jenn-shooting-operations-primary

loopbackHealthStatus          = 200
loopbackWriteAdmission        = enabled
routedHealthStatus            = 200
routedWriteAdmission          = enabled
unauthenticatedWriteStatus    = 401
unauthenticatedWriteCode      = UNAUTHORIZED

databaseRevision              = 0
uploadRows                    = 0
operationRows                 = 0
auditRows                     = 0
attachmentFiles               = 0

orphanCleanupState            = disabled
orphanCleanupMarkerValid      = true
orphanCleanupActiveRuns       = 0
integrationEnvCount           = 0

nginxConfigSha256             = sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33
durableRuntimeEnvSha256       = sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c
activationEvidenceSha256      = sha256:1af2e9dd6ca511631ac5d7efb949d0b96c306b1d2c551241a5910b7ba7b81cb2
remediationScriptSha256       = sha256:eb34f41d56c9fd464ae3517c0aa5b38c6836a96695bc4cbffea5282e682e7fb4

noProductionMutation          = true
secretValuesRecorded          = false
```

Every current identity matched the durable-activation facts already bound by authority, including the file-level database identity that closes the final storage ambiguity. The reconciliation therefore closes the disclosed out-of-order durability remediation without rewriting its history as prior authorization.

Current authoritative completion:

```text
completedAcceptanceIds includes PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION
completedAcceptanceIds includes PROD-GF-13-ACTIVATE
PROD-GF-13 status       = PASS
governanceStatus        = RECONCILED_EXACT_READ_ONLY
nextActionId            = PROD-GF-14-RESTORE-ORPHAN-CLEANUP
authorization.status    = FROZEN_NOT_REQUESTED
requestableActionIds    = []
```

This promotion does not authorize PROD-GF-14, VCP, Kiosk, DingTalk, any restart, any signal, or any other production mutation.

