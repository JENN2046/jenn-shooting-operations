# PROD-11 Kiosk Deployment Contract Freeze R1

Status: **DEVICE / BROWSER FROZEN / BLOCKED ON SCHEDULABLE PREAUTH + ISOLATED WO-03 EXECUTION GATES**

This document freezes the deployment mechanics and exact device/browser target for `PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE`.
It does **not** authorize PROD-11, replace the live container, generate a real credential, create the dedicated browser profile, enroll the device, prepare production scheduling data, or submit a production run event.

## Runtime image

```text
baseline source revision = d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7
image tag = jenn-shooting-operations:prod-d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7
image id = sha256:de849c3005e484874e0e55130ee3a36ab74e6db3785a817ad612c1903d8f1c72
Node = 24.21.0
Kiosk targeted = 158 / 158 PASS
full repository = 801 tests / 798 pass / 2 known migration-userland failures / 1 expected VCP skip
```

The two full-suite failures remain the previously reproduced Alpine `touch @<nanosecond timestamp>` limitation and are not Kiosk regressions.

### Replacement immutable image required before PROD-11 request

The already-built candidate remains a verified baseline:

```text
baseline image ID = sha256:de849c3005e484874e0e55130ee3a36ab74e6db3785a817ad612c1903d8f1c72
baseline tag      = jenn-shooting-operations:prod-d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7
baseline revision = d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7
```

That image is **not eligible for PROD-11 execution** because it does not implement the newly required `KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY`.

The baseline revision above is evidence only and is **not** the PROD-11 execution source authority.

The sole eventual PROD-11 runtime authority is the exact replacement binding:

```text
runtimeAuthorityBinding.prod11ExecutionAuthority.sourceRevision
= requestability.executionImageGate.finalSourceRevision

runtimeAuthorityBinding.prod11ExecutionAuthority.immutableImageId
= requestability.executionImageGate.finalImmutableImageId
```

Those values intentionally remain unresolved until the atomic-capable replacement image is exact-head tested, built, and frozen.

The replacement diagnostic tag is frozen by derivation at the same time:

```text
finalDiagnosticTag = jenn-shooting-operations:prod-<finalSourceRevision>
```

The tag is diagnostic only, not execution authority. Immediately before container creation it must resolve to the frozen replacement immutable image ID, and that image's OCI revision label must equal the frozen replacement source revision. The container is still created by immutable image ID.

Once resolved, every execution-bearing image/revision/tag reference, the isolated WO-03 runtime, and the production container create reference must agree exactly. The `d1fe85...` baseline may never substitute.

Therefore PROD-11 remains pre-request blocked until:

```text
KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY implemented with all three predicates:
  1. smoke event target = immutable authorization-frozen smoke item binding
  2. unique current STUDIO-PROD-01 item = that same binding, with no competing run/candidate
  3. active Scheduling businessTimeZone = Asia/Shanghai
→ exact-head tests PASS
→ replacement production image built
→ replacement diagnostic tag / immutable image ID / source revision frozen consistently
→ PROD-11 deployment binding updated to that replacement authority
```

The final immutable image ID is currently unresolved by design.

Before PROD-11 may be requested, the **complete frozen action-specific revalidation checklist** from the production manifest must fresh-pass:

```text
TARGET_HOST_IDENTITY
DISK_PORT_ROUTE_CONFLICTS
BUILT_IMAGE_DIGEST
SECRET_STORAGE
KIOSK_AUTH_RUNTIME_CONFIGURATION
EXTERNAL_READINESS_GATES
ROLLBACK_TARGETS
```

`BUILT_IMAGE_DIGEST` is necessary but not sufficient. Any stale, missing, changed, or failed item leaves PROD-11 non-requestable.

At eventual execution, immediately before production container create/replacement, the executor must revalidate `BUILT_IMAGE_DIGEST`: the frozen diagnostic tag must resolve to the frozen replacement immutable image ID, the OCI revision label must equal the frozen replacement source revision, and the container must be created by immutable image ID rather than mutable tag. Any mismatch is a hard stop.

## Frozen logical identity

```text
resourceId = STUDIO-PROD-01
deviceId   = KIOSK-PROD-01

principal.role        = operator
principal.subjectId   = KIOSK-PROD-01
principal.resourceIds = [STUDIO-PROD-01]
```

These are production logical identifiers, not the test-only `STUDIO-A` fixture.

## Frozen real device and browser

Owner-selected real device:

```text
device label = QLL-6
platform     = Windows 11
OS version   = 10.0.26200
```

Fresh device inspection shows Google Chrome installed at:

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
Chrome version at freeze = 153.0.8010.53
```

The Kiosk must **not** reuse the operator's ordinary Chrome profile.

The frozen browser isolation target is:

```text
profile mode = dedicated user-data-dir
profile root = %LOCALAPPDATA%\JennShootingOperations\Chrome-Kiosk-PROD-01
profile directory = Default
existing normal profile reuse = false
```

The dedicated profile directory does not exist yet by design. Creating it is part of the later explicitly authorized PROD-11 execution, not this freeze.

The server-authoritative `deviceId` is a logical identity binding. The current Kiosk design does not claim cryptographic hardware attestation.

`QLL-6 + Chrome dedicated profile` is frozen as the **primary production Kiosk identity target**. It is necessary evidence, but it is not sufficient to close the full WO-03 browser/device acceptance matrix.

## WO-03 browser/device matrix remains fully binding

The authoritative matrix in `docs/acceptance/WO-03_KIOSK_BROWSER_AND_DEVICE_ACCEPTANCE.md` is not reduced by this deployment freeze.

Before `REAL_DEVICE_ACCEPTANCE` can close, evidence must still cover all of the following:

### Browser viewport plan

- Desktop 1440×900: keyboard operation, focus order, dialog focus return, long task-name wrapping;
- Tablet landscape 1024×768: touch controls, status wrapping, offline recovery;
- Tablet portrait 768×1024: current/next stacking and blocking form under the soft keyboard;
- Mobile 390×844: two-column controls, safe-area, 200% zoom and screen-reader announcement;
- Chromium/Safari Web Locks support differences and lease fallback;
- DevTools offline/online, refresh, two tabs, concurrent start, 409 conflict and 202 `reviewRequired` visible feedback.

### On-site device checklist

- iPad or on-site tablet opens the explicit `resourceId` Kiosk URL and fails closed without configured identity;
- landscape/portrait rotation, auto-lock recovery, weak network, offline and reconnect;
- rapid taps and two-tab contention do not create duplicate facts; non-controller tab is read-only;
- offline `start → block → resume → complete` replays in strict order;
- blocked state cannot directly complete;
- conflict/reviewRequired stays at queue head without automatic rebase or skip;
- browser-cache clearing removes only local delivery state and does not change server facts;
- grouped sessions display all tasks without pretending they are one-task labor time, using the exact isolated grouped-session environment defined below;
- real screen reader, external keyboard, touch-target and studio-lighting contrast checks;
- operator logout, identity expiry and device handoff flow.

The following remain mandatory PROD-11 **execution/closure targets** after QLL-6 selection:

```text
EXACT_ON_SITE_IPAD_OR_TABLET
EXACT_SAFARI_BROWSER_TARGET
EXACT_MOBILE_VIEWPORT_EXECUTION_TARGET
EXACT_ACCESSIBILITY_ASSISTIVE_TECH_ENVIRONMENT
```

Their **exact target bindings are pre-request blockers**: the on-site tablet/iPad, Safari, mobile viewport, and accessibility environments must be frozen as part of the exact isolated WO-03 environment before PROD-11 may be requested. The acceptance tests themselves remain post-authorization because identity-expiry, offline replay, and related flows require the authorized Kiosk runtime. Those executions remain hard gates before `REAL_DEVICE_ACCEPTANCE`, PROD-11 formal completion, or any production-ready claim.

No Windows-Chrome-only evidence set may be used to mark `REAL_DEVICE_ACCEPTANCE` complete.

### Full WO-03 acceptance uses a separately bounded isolated environment

The entire WO-03 browser/device matrix, not only grouped-session presentation, must run with **test identity and isolated test data**.

This applies to the full viewport and on-site checklist whenever the evidence depends on authentication, queue state, run state, contention, replay, cache behavior, grouped data, accessibility interaction, identity expiry, or device handoff.

The isolated WO-03 environment has two distinct phases:

```text
before PROD-11 request:
  freeze the exact isolated endpoint / database / test identity / fixture digests / device targets
  freeze and complete the separately bounded authority for any setup writes
  bind the environment to the exact replacement immutable image/revision

after PROD-11 authorization, before production Kiosk activation:
  execute the full isolated WO-03 matrix
```

The environment setup/binding is therefore a **pre-request gate**, while the actual WO-03 acceptance execution remains post-authorization.

Critically, before the PROD-11 request the prepared isolated environment must already be bound to **the same replacement immutable image ID and source revision frozen for eventual production activation**.

Immediately before post-authorization WO-03 execution, that binding is freshly revalidated. Evidence from the current baseline image, a different image, a different revision, or an unverified rebuild is invalid.

Immediately before isolated WO-03 execution, fresh prove:

```text
isolated runtime image ID = frozen replacement production image ID
isolated runtime revision = frozen replacement production source revision
replacement image exact-head validation = PASS
```

Then fresh-revalidate the already-bound isolated environment facts (all of these exact targets were frozen before the PROD-11 request):

```text
exact isolated test endpoint
exact isolated database identity
exact test identity / authorization scope
exact single-item fixture digest
exact grouped-item fixture digest
exact device/browser/accessibility targets
```

Its data plane must contain both:

```text
single fixture:
  one test-only single schedule item
  exactly one bound test request
  usable for normal run/offline/conflict/review flows

grouped fixture:
  allocation_mode = grouped_unallocated
  task binding count >= 2
  all bound requests = test-only
  grouped item = current during the grouped browser/device run
```

Isolation requirements:

```text
no production data-volume mount, copy, or mutation
no production Kiosk or role credentials
no real DingTalk/provider delivery
no production request/schedule/run/review/receipt/audit/revision mutation
exact environment + fixture digests bound before execution
```

The evidence mapping is explicit:

```text
REAL_DEVICE_ACCEPTANCE
= isolated WO-03 environment + exact real device/browser evidence

OFFLINE_REPLAY_RESULT
= isolated test-data replay evidence

production Kiosk smoke
= separate integration evidence only
```

A production smoke event, if later authorized and executed, **cannot** satisfy or replace WO-03 `REAL_DEVICE_ACCEPTANCE` or `OFFLINE_REPLAY_RESULT`.

### WO-03 must close before production Kiosk activation

Because WO-03 now has its own isolated endpoint, test identity, isolated database and disposable fixtures, there is no reason to expose production Kiosk credentials before the matrix passes.

The mandatory ordering is:

```text
PROD-11 explicit authorization
→ fresh-revalidate the already-bound exact isolated WO-03 environment and execute the matrix
→ REAL_DEVICE_ACCEPTANCE = PASS
→ OFFLINE_REPLAY_RESULT = PASS
→ fresh replacement immutable image-ID / revision revalidation
→ only then enable exact production Kiosk config / credential / dedicated profile / identity mapping
→ revalidate the frozen production smoke item
→ authenticated production current-read evidence
→ KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY passes all three predicates inside the same event transaction
→ KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY passes the exact two-phase mutation/ID/sequence/window gate
→ KIOSK_SMOKE_OUTBOX_ISOLATION_CAPABILITY is active for the exact acceptance-only notification intent
→ only then may the first bounded production Kiosk run event commit
```

Until isolated WO-03 passes, the production Kiosk config file must not be mounted, the production credential must not be provisioned to QLL-6, the dedicated production profile must not be activated for production identity, and production Kiosk run-event writes must remain at zero.

If the exact isolated environment target or its setup authority is unresolved, PROD-11 must not even be requested.

If the environment was prepared correctly but isolated WO-03 later fails or remains incomplete, PROD-11 must not cross the production activation boundary.

Even after production activation, `GET /api/v2/kiosk/current` is diagnostic/device-facing evidence only. It and the event POST are separate requests.

### Exact bounded production smoke write budget

The PROD-11 production smoke is not an open-ended run-event session.

Only this exact two-phase mutation sequence may ever commit under PROD-11 smoke authority.

The identifiers are **not** public constants. They must come from the reviewed Kiosk client's existing secure generator:

```text
secureId('RUN')   -> RUN-{crypto.randomUUID()}
secureId('EVENT') -> EVENT-{crypto.randomUUID()}
```

If Web Crypto secure randomness is unavailable, the client fails closed.

```text
1. START
   runId = client-generated secureId('RUN')
   eventId = client-generated secureId('EVENT')
   expectedRunRevision = 0
   localSequence = 0
   occurredAt = must satisfy KIOSK_SMOKE_ACCEPTANCE_RUN_START <= occurredAt <= KIOSK_SMOKE_ACCEPTANCE_RUN_END
   trustedServerTime = capture from the server clock only after entering the same write transaction; must independently satisfy KIOSK_SMOKE_ACCEPTANCE_RUN_START <= trustedServerTime <= KIOSK_SMOKE_ACCEPTANCE_RUN_END
   required result = RUN_EVENT_APPLIED / shooting / runRevision 1
   binding = accepted immutable start receipt locks exact runId + start eventId

2. COMPLETE
   runId = exact runId locked by the accepted start receipt
   eventId = new client-generated secureId('EVENT')
   expectedRunRevision = 1
   localSequence = 1
   occurredAt = must satisfy KIOSK_SMOKE_ACCEPTANCE_RUN_START <= occurredAt <= KIOSK_SMOKE_ACCEPTANCE_RUN_END
   trustedServerTime = capture from the server clock only after entering the same write transaction; must independently satisfy KIOSK_SMOKE_ACCEPTANCE_RUN_START <= trustedServerTime <= KIOSK_SMOKE_ACCEPTANCE_RUN_END
   required result = RUN_EVENT_APPLIED / completed / runRevision 2
   binding = accepted immutable complete receipt locks exact complete eventId
```

Web Crypto provenance is established by exact-head client implementation/tests. Server admission validates canonical ID structure, phase/order, exact authenticated identity, schedule binding, local sequence, and immutable receipt consistency; it must not substitute predictable operator-authored identifiers.

Both events must target `KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID`, which equals the authorization-frozen derived acceptance schedule item.

Both events must also be checked against the immutable authorization-frozen smoke window **inside the same `KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY` transaction**.

Two independent time predicates are mandatory:

```text
1. command.occurredAt is inside the frozen acceptanceRunStart / acceptanceRunEnd window
2. trustedServerTime, captured from the server runtime clock only after entering the same write transaction / serialization boundary, is inside that same frozen window
```

The second predicate is the authorization-time gate. Client clock skew must never open the smoke window early or keep it open late. A prior clock sample, `/current` read, database schedule-window read, or client `occurredAt` alone is evidence only and cannot authorize the commit.

The accepted smoke receipt/audit timestamps must use that same trusted in-transaction server time. The normal event-time policy still applies in addition to both stricter bounded-smoke predicates.

Forbidden under this authority:

```text
block
resume
any third accepted mutation
complete with a runId different from the runId bound by the accepted START receipt
replay with an eventId or command digest different from the corresponding immutable phase receipt
predictable or contract-hard-coded run/event IDs
another schedule item
any new mutation after the exact complete receipt exists
widening a conflict or reviewRequired outcome into an improvised retry sequence
```

Exact idempotent replay of one already-persisted phase command is allowed only when the run ID, event ID, and command digest match the corresponding immutable receipt and no new production fact is written.

Any conflict, reviewRequired, normal time-policy failure, `occurredAt` outside the frozen smoke window, trusted server transaction time outside the frozen smoke window, trusted server time sampled before entering the smoke event transaction, binding/current-item/time-zone mismatch, invalid secure-ID structure, START localSequence other than 0, COMPLETE localSequence other than 1, COMPLETE runId mismatch, unexpected pre-existing smoke fact, or non-success for a not-yet-persisted phase is a hard stop. No later smoke mutation is authorized without a newly frozen recovery/smoke authority.

The smoke terminal condition is machine-evaluable:

```text
exact complete receipt exists
resultingState = completed
runRevision = 2
same cryptographically generated runId bound by the START receipt
same frozen scheduleItemId
START localSequence = 0
COMPLETE localSequence = 1
exactly two accepted smoke event facts
no pending review for either receipt-bound smoke event ID
```

After that terminal point, all PROD-11 smoke write authority is closed. Normal operation remains separately blocked.

### Smoke notification outbox containment

The authorized `complete` event creates a production-run-completed notification intent. That acceptance-only intent must never later dispatch to a real provider.

Therefore these are additional pre-request capabilities:

```text
KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY
KIOSK_SMOKE_OUTBOX_ISOLATION_CAPABILITY
```

The outbox isolation mechanism must preserve the acceptance audit/outbox fact while permanently preventing real DingTalk or other provider delivery, without mutating unrelated outbox facts.

`KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY` must also consume the immutable `KIOSK_SMOKE_ACCEPTANCE_RUN_START` / `KIOSK_SMOKE_ACCEPTANCE_RUN_END` bindings and, for each smoke phase, capture trusted server time only after entering the same write transaction. Before commit it must reject unless **both** the untrusted client `occurredAt` and that trusted in-transaction server time fall inside the exact frozen window. The accepted receipt/audit time must be that same trusted server value.

Before any **bounded PROD-11 production-smoke** run-event write is allowed, the replacement frozen runtime must implement:

```text
KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY
```

Inside the **same transaction that commits the Kiosk event**, the replacement runtime must enforce all three authority predicates:

```text
1. immutable authorization binding:
   event schedule target
   = KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID
   = authorization-frozen derived acceptance scheduleItemId

2. STUDIO-PROD-01 resource-wide current selection:
   unique current schedule item
   = KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID
   no competing current candidate or active run

3. active Scheduling config:
   businessTimeZone = Asia/Shanghai
   exact match with frozen Kiosk runtime businessTimeZone
```

All three predicates must be read after entering the event transaction/write serialization boundary. A prior `/current` GET, prior expected-item comparison, or prior config read is evidence only and cannot authorize the commit.

If any of the three predicates is unavailable or fails, the transaction aborts before any run/review/receipt/revision/audit/outbox fact commits.

`KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY` is **not implemented in the current baseline image**, so this is a PROD-11 **pre-request blocker**, not something that may be added after authorization.

The expected-item predicate is scoped only to the bounded PROD-11 smoke. Successful smoke completion does **not** grant this container authority to process later unrelated production schedule items.

### Post-smoke normal operation remains a separate authority gap

After the bounded smoke evidence is complete, this contract authorizes no further production Kiosk run-event writes.

Before PROD-11 itself can become requestable, a separate contract must freeze how the smoke-gated runtime transitions to normal ongoing Kiosk production authority without either:

- keeping one immutable smoke item as a permanent lock;
- hot-rotating the smoke binding between normal jobs;
- inferring authority from whatever database item happens to be current; or
- silently recreating a normal-operation container without explicit bounded authority.

Current blocker:

```text
KIOSK_POST_SMOKE_NORMAL_OPERATION_TRANSITION_CONTRACT_UNRESOLVED
```

#33 records this as an unresolved authority boundary. It does not design or implement that later lifecycle.

QLL-6 + its dedicated Chrome profile remains the primary production Kiosk identity target. It is not permission to run the WO-03 stateful matrix against production scheduling facts.

## Frozen runtime auth config

Deployment metadata is separate from the JSON file payload:

```text
host path      = /mnt/datadisk0/apps/jenn-shooting-operations/kiosk-auth.v1.json
container path = /app/kiosk-auth.v1.json
env            = KIOSK_AUTH_CONFIG_PATH=/app/kiosk-auth.v1.json
mount          = read-only bind
host owner     = uid 1000 / gid 1000
host mode      = 0600
```

None of those deployment fields may appear inside `kiosk-auth.v1.json`.

### Authorization-frozen schedule-item runtime binding

The authorization-frozen schedule item is not added to `kiosk-auth.v1.json`; that file keeps its exact loader-defined schema.

The replacement PROD-11 runtime must require a separate container-lifetime environment binding:

```text
KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID = exact authorization-frozen derived acceptance scheduleItemId
```

The final value is unresolved until the separately authorized scheduling preparation derives the exact schedule item. The one-time PROD-11 authorization packet freezes that ID, and production container creation supplies exactly that frozen value.

This binding is **smoke-only authority**. While present, the PROD-11 acceptance-smoke container must deny Kiosk production run-event writes for every other schedule item. It is not a standing normal-production item lock and must not be hot-rotated from item to item.

Required behavior:

- no default, database-derived fallback, or current-item inference;
- startup fails closed before listen when missing or invalid;
- canonical Scheduling identifier validation at startup;
- immutable for the container lifetime with no hot reload;
- the database's current item is evidence, never authority for the expected ID.


The final file must contain **exactly** these top-level keys:

```text
schemaVersion
authMode
realm
username
deviceId
principal
businessTimeZone
allowedBriefHosts
credential
```

The frozen payload template is:

```json
{
  "schemaVersion": 1,
  "authMode": "basic-v1",
  "realm": "Jenn Shooting Operations Kiosk",
  "username": "jso-kiosk-prod-01",
  "deviceId": "KIOSK-PROD-01",
  "principal": {
    "subjectId": "KIOSK-PROD-01",
    "role": "operator",
    "resourceIds": ["STUDIO-PROD-01"]
  },
  "businessTimeZone": "Asia/Shanghai",
  "allowedBriefHosts": [],
  "credential": {
    "algorithm": "scrypt-v1",
    "saltBase64": null,
    "hashBase64": null
  }
}
```

The two `null` values are **materialization placeholders only** and must never be written as the final file:

- `/credential/saltBase64` receives canonical Base64 for exactly 16 execution-generated random bytes;
- `/credential/hashBase64` receives canonical Base64 for exactly 32 scrypt-v1 output bytes derived from the dedicated execution-generated Kiosk password and that salt.

Before atomic installation, the fully materialized file must pass `loadKioskRuntimeAuthV1` with the four existing role credential values supplied only as forbidden comparison inputs. The final JSON must contain no deployment metadata or extra keys.

## Database-wide brief-host compatibility

Fresh production inspection:

```text
requests_v2 rows with non-empty brief_url = 0
observed brief hosts                      = []
allowedBriefHosts                         = []
current compatibility                     = PASS
```

The empty allowlist is safe **only while the whole database has no non-empty `requests_v2.brief_url`**.

Before PROD-11 authorization or execution, the whole `requests_v2` table must be scanned again.
If any request, scheduled or unscheduled, has a non-empty `briefUrl`, PROD-11 remains blocked until every observed host is explicitly reviewed and included in `allowedBriefHosts`.

A scheduled-only compatibility check is forbidden.

## Frozen credential generation

A dedicated Kiosk credential is generated only after explicit PROD-11 authorization.

```text
password = node:crypto.randomBytes(32).toString('base64url')
salt     = node:crypto.randomBytes(16)
hash     = scrypt-v1(password, salt, 32 bytes)

server config stores:
  saltBase64
  hashBase64

server config never stores:
  raw password
```

The raw password must not enter Git, repository evidence, logs, or chat.
It is provisioned once to the selected device/operator. Loss is handled by rotation, not plaintext recovery.
The Kiosk credential must remain distinct from VIEWER/SUBMITTER/SCHEDULER/ADMIN tokens.

## Frozen container topology

The deployment reuses the current production container topology and changes only the image plus the Kiosk config binding:

```text
container        = jenn-shooting-operations-prod
rollback backup  = jenn-shooting-operations-prod-pre-prod11
volume           = jenn-shooting-operations_shooting_data:/app/data
port             = 127.0.0.1:3800:3800
rootfs           = read-only
tmpfs            = /tmp
security          = no-new-privileges:true
restart           = unless-stopped

tokens env        = /mnt/datadisk0/apps/jenn-shooting-operations/.env.tokens
runtime env       = /mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime
pre-PROD11 backup = /mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime.pre-prod11
```

The production volume is never copied into a test container and is never deleted by rollback.

## Fresh pre-authorization attestation

Recorded at `2026-09-29T09:44:33Z`:

```text
production host = VM-0-12-ubuntu

live container = b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be
live image     = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
live revision  = 92b7137211bf807f178901e878a8c3d6e335cec4
live health    = healthy

candidate image    = sha256:de849c3005e484874e0e55130ee3a36ab74e6db3785a817ad612c1903d8f1c72
candidate revision = d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7

production volume = jenn-shooting-operations_shooting_data
backend health    = 200
public health     = 200
write admission   = enabled
database revision = 3

KIOSK_AUTH_CONFIG_PATH in live = absent
Kiosk runtime file in live     = absent

Nginx route file   = /etc/nginx/conf.d/jso-shooting-operations.conf
Nginx route SHA256 = 35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33

QLL-6 -> https://jso.skmt617.top/healthz = 200
QLL-6 Chrome = 153.0.8010.53
dedicated Kiosk profile exists = false
```

The absence of the dedicated profile is expected. No browser state is created before PROD-11 authorization.

## Schedulable acceptance readiness

Fresh production inspection now shows:

```text
requests_v2                           = 0
scheduling_resources                  = 0
STUDIO-PROD-01 resource rows          = 0
scheduling_active_config              = 0
schedule_items                        = 0
schedule_item_tasks                   = 0

non-empty requests_v2.brief_url       = 0
```

This blocks PROD-11 requestability.

The production integration-smoke path requires an exact canonical V2 request, production resource, active scheduling config, canonical proposal acceptance, derived schedule item and exact task binding. Those production facts are **not** the WO-03 acceptance dataset. The full WO-03 stateful matrix runs against the separately bounded isolated environment described above.

The supported Scheduling path requires `schedule_item_tasks.task_id` to reference `requests_v2`, and a single schedule item must bind exactly one request. A V1 snapshot-only request is insufficient.

Preparing that schedulable production-smoke target is a **separate production scheduling write** and must not be smuggled into PROD-11's frozen effects. It exists only to support an exact bounded production wiring smoke **after isolated WO-03 has passed and production Kiosk activation is allowed**; it cannot be cited as WO-03 acceptance evidence.

Before PROD-11 can be requested, a separately authorized preparation must create or fresh-confirm:

```text
exact canonical requests_v2 acceptance request
resourceId = STUDIO-PROD-01
active scheduling config with businessTimeZone = Asia/Shanghai
deterministic acceptance proposal
canonical accept decision
derived Kiosk acceptance schedule item
schedule_item_tasks binding from that item to the exact V2 request
```

The active acceptance Scheduling config must use `businessTimeZone = Asia/Shanghai`, exactly matching the frozen Kiosk auth payload. This equality must be verified before proposal generation and revalidated before PROD-11 Kiosk event execution so projection refresh cannot change legacy wall-clock dates/times between Scheduling and Kiosk paths.

The schedule item and task binding must come from the canonical proposal-acceptance path. Direct SQL insertion is forbidden.

### Acceptance item execution-window binding

Existence of a schedule item is not enough. Before PROD-11 may be requested, the authorization packet must bind:

```text
exact acceptanceRunStart
exact acceptanceRunEnd
exact derived acceptance scheduleItemId
exact canonical V2 acceptance requestId
```

A fresh read must prove the same item is:

```text
schedule_status = confirmed
resourceId = STUDIO-PROD-01
exactly one schedule_item_tasks binding to the frozen V2 acceptance request
zero prior production runs
planned_start <= acceptanceRunStart < acceptanceRunEnd <= planned_end
```

The authorization packet becomes stale if the item is used, cancelled, rebound, changed, no longer covers the bound acceptance run, or `planned_end` passes before execution starts.

Before PROD-11 becomes requestable, the replacement-image contract must also prove support for the immutable `KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID` binding. The value in the eventual container must equal the same derived schedule item ID frozen in the authorization packet; it may not be inferred from whichever database item is current at execution time.

The same replacement runtime must also require two separate smoke-window bindings, outside `kiosk-auth.v1.json`:

```text
KIOSK_SMOKE_ACCEPTANCE_RUN_START = exact authorization-frozen acceptanceRunStart
KIOSK_SMOKE_ACCEPTANCE_RUN_END   = exact authorization-frozen acceptanceRunEnd
```

Both values are canonical RFC3339 UTC instants, required before listen in PROD-11 smoke mode, immutable for the container lifetime, and have no default, database-derived fallback, or hot-reload path. The container values must exactly equal the one-time authorization packet.

For START and COMPLETE, the replacement runtime must capture the trusted server clock **after entering the same event transaction/write-serialization boundary** and require that server time to be within these two immutable instants. This server-time predicate is additional to the command `occurredAt` predicate and the normal event-time policy.

Only **after** isolated WO-03 has closed `REAL_DEVICE_ACCEPTANCE` and `OFFLINE_REPLAY_RESULT`, a replacement atomic-capable image has been frozen, and the exact production Kiosk configuration has then been enabled, immediately before the first bounded production smoke run event the executor must fresh-read the same schedule item, task binding and run state and prove again:

```text
confirmed
unused
exact resource / exact V2 request binding
planned_start <= current time < planned_end
planned_end still covers acceptanceRunEnd
```

That row-level check is necessary but not sufficient. After isolated WO-03 has passed, the replacement immutable image has been revalidated, the exact PROD-11 Kiosk auth configuration is enabled, and server-authoritative device identity is verified, the executor performs an authenticated:

```text
GET /api/v2/kiosk/current?resourceId=STUDIO-PROD-01
```

immediately before the first run event and require:

```text
HTTP/current-read success
current.scheduleItemId = exact frozen derived acceptance scheduleItemId
```

This resource-wide GET is device-facing evidence only. Any `MULTIPLE_CURRENT_CANDIDATES`, other current item, other active run, null current item, authentication/identity failure, or other non-success result is an immediate hard stop. A successful GET still does **not** authorize the event write: inside the Kiosk event transaction `KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY` must atomically re-evaluate all three predicates: (1) the submitted smoke event target equals `KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID` and the authorization-frozen derived scheduleItemId, (2) the unique current `STUDIO-PROD-01` item equals that immutable binding with no competing run/candidate, and (3) the active Scheduling `businessTimeZone` equals `Asia/Shanghai`.

If the immutable authorization-binding check, row-level recheck, resource-wide current-selection check, or active time-zone check fails, no Kiosk run event may be submitted. PROD-11 does not authorize creating, moving or replacing the schedule item. The flow returns to a separately authorized scheduling preparation; if Kiosk runtime configuration has already changed, only the bound configuration rollback may be used.

The exact preparatory Action ID is not yet frozen and remains an authority gap.

## Rollback contract

`ROLLBACK-10-DISABLE-KIOSK-CONFIG` is configuration-only.

Before any accepted/review-required Kiosk business fact exists, a failed swap/health/identity acceptance may restore the exact pre-PROD11 container.

After any accepted or review-required Kiosk submission:

1. keep all production runs/reviews/receipts/audit/revision facts;
2. restore the pre-PROD11 runtime env without `KIOSK_AUTH_CONFIG_PATH`;
3. remove the Kiosk read-only bind;
4. recreate the service on the PROD-11 image with the same volume, port, rootfs, tmpfs, security and restart policy;
5. verify VCP remains unchanged and DingTalk remains disabled/unmodified.

Fresh inspection shows the live database already has the continuous migration prefix 1 through 6, and both old and new runtimes recognize migration v6. The rollback therefore does not depend on a schema downgrade.

## Current Greenfield authority gate

The static `production-change-manifest.v1.json` remains the frozen parent contract, not the current requestability source. Its historical `BLOCKED_PREREQUISITE` values must not be mistaken for live Greenfield state; in particular, `INTEGRATION_DEPLOYMENT_READINESS` is explicitly superseded by the Greenfield authority.

Conversely, this PROD-11 deployment contract **cannot make itself requestable**.

Immediately before any PROD-11 authorization request, the current `production-greenfield-authority.v1.json` must fresh-pass its validator and prove:

```text
authorization.nextActionId = PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
completed: PROD-GF-13-ACTIVATE
completed: PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE
completed: PROD-10-ENABLE-VCP-REMOTE-SYNC

GREENFIELD_ACTIVATION_COMPLETION = PASS
GREENFIELD_FORWARD_CHAIN = PASS
PRODUCTION_TARGET_FACTS = PASS
PRODUCTION_DEPLOYMENT_GATE = PASS

base INTEGRATION_DEPLOYMENT_READINESS
= handled only through the frozen Greenfield supersession contract

requestableActionIds includes exactly the intended PROD-11 action
```

If current Greenfield authority does not explicitly admit PROD-11 after all fresh prerequisite evidence is present, the authorization request is prohibited. #33 supplies no independent self-authorization path.

## Requestability decision

Closed:

```text
PRIMARY_PRODUCTION_KIOSK_TARGET_SELECTED      = QLL-6
DEDICATED_CHROME_PROFILE_TARGET_FROZEN        = PASS
FRESH_PRE_AUTH_TARGET_ATTESTATION             = PASS
DATABASE_WIDE_BRIEF_HOST_COMPATIBILITY        = PASS_CURRENT_STATE
```

Still blocked before PROD-11 may be requested:

```text
KIOSK_ACCEPTANCE_V2_REQUEST_ABSENT
PRODUCTION_RESOURCE_STUDIO_PROD_01_ABSENT
ACTIVE_SCHEDULING_CONFIG_ABSENT
ACTIVE_ACCEPTANCE_CONFIG_TIME_ZONE_NOT_YET_BOUND
KIOSK_ACCEPTANCE_SCHEDULE_ITEM_ABSENT
KIOSK_ACCEPTANCE_TASK_BINDING_ABSENT
SEPARATE_SCHEDULING_PREPARATION_AUTHORITY_UNRESOLVED
KIOSK_ACCEPTANCE_EXECUTION_WINDOW_NOT_YET_BOUND_AND_FRESH
KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY_NOT_IMPLEMENTED_IN_CURRENT_BASELINE_IMAGE
PROD11_REPLACEMENT_IMMUTABLE_IMAGE_NOT_YET_BUILT_TESTED_AND_FROZEN
KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_RUNTIME_BINDING_NOT_IMPLEMENTED_IN_CURRENT_BASELINE_IMAGE
KIOSK_POST_SMOKE_NORMAL_OPERATION_TRANSITION_CONTRACT_UNRESOLVED
WO03_ISOLATED_ENVIRONMENT_PREPARATION_AUTHORITY_UNRESOLVED
WO03_ISOLATED_ENVIRONMENT_EXACT_TARGET_NOT_FROZEN
WO03_ISOLATED_ENVIRONMENT_SETUP_INCOMPLETE
FULL_PROD11_ACTION_SPECIFIC_REVALIDATION_NOT_YET_FRESH_PASS
CURRENT_GREENFIELD_AUTHORITY_PROD11_REQUESTABILITY_NOT_YET_FRESH_PASS
KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY_NOT_IMPLEMENTED_IN_CURRENT_BASELINE_IMAGE
KIOSK_SMOKE_OUTBOX_ISOLATION_CAPABILITY_NOT_IMPLEMENTED_IN_CURRENT_BASELINE_IMAGE
```

The atomic production-context capability is a hard **pre-request** gate for the bounded production smoke. It must cover immutable authorization-frozen smoke schedule-item binding, current-item uniqueness, and active Scheduling time-zone equality inside the same event transaction. It is not normal-operation authority. It may not be implemented after authorization or introduced by swapping to an unreviewed image.

Immediately before the PROD-11 authorization request, fresh revalidate all seven manifest-bound checks: target host identity, disk/port conflicts, built image digest, secret storage, Kiosk auth runtime configuration, external readiness gates, and rollback targets.

Before the PROD-11 authorization request, the following preparation gates must already be closed:

```text
WO03_ISOLATED_ENVIRONMENT_PREPARATION_AUTHORITY
WO03_EXACT_ISOLATED_ACCEPTANCE_ENVIRONMENT_BOUND
WO03_ISOLATED_ENVIRONMENT_SETUP_COMPLETE
```

These preparation gates do **not** execute the WO-03 matrix.

After explicit authorization, but **before production Kiosk activation**, the following isolated execution gates must close:

```text
WO03_EXACT_ISOLATED_ACCEPTANCE_ENVIRONMENT_BOUND
WO03_FULL_ISOLATED_VIEWPORT_AND_ON_SITE_MATRIX
REAL_DEVICE_ACCEPTANCE
OFFLINE_REPLAY_RESULT
IDENTITY_EXPIRY_AND_DEVICE_HANDOFF
ACCESSIBILITY_AND_ON_SITE_ENVIRONMENT_ACCEPTANCE
```

Only after the pre-request isolated-environment preparation gates and the post-authorization WO-03 execution gates both PASS may the frozen replacement image be revalidated and the bounded **acceptance-smoke** production Kiosk config/credential/profile/identity mapping be enabled.

Normal ongoing production use remains blocked by `KIOSK_POST_SMOKE_NORMAL_OPERATION_TRANSITION_CONTRACT_UNRESOLVED`; successful smoke evidence must not be interpreted as blanket authority for later production items.

After production activation, before the first production smoke event:

```text
KIOSK_ACCEPTANCE_ITEM_EXECUTION_TIME_RECHECK
KIOSK_SMOKE_AUTHORIZATION_BINDING_EQUALS_EVENT_TARGET
KIOSK_CURRENT_SELECTION_EQUALS_FROZEN_ACCEPTANCE_ITEM
KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY = PASS for all three predicates inside same event transaction
KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY = PASS
KIOSK_SMOKE_OUTBOX_ISOLATION_CAPABILITY = PASS
PROD11_PRODUCTION_SMOKE_SEPARATE_FROM_WO03
```

All three smoke capabilities are co-required authority. Passing the atomic production-context predicates alone never authorizes a production smoke write.

`REAL_DEVICE_ACCEPTANCE` and `OFFLINE_REPLAY_RESULT` come only from the isolated WO-03 environment. Production smoke evidence is separate and non-substitutable.

Therefore:

```text
PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
= NOT READY TO REQUEST EXPLICIT AUTHORIZATION

formal authorization state
= FROZEN_NOT_REQUESTED
```

Credential generation, production profile activation, production config materialization, live container replacement, production identity enrollment, and any production run-event submission remain prohibited until their respective gates above close.

Machine-readable contract:

`docs/operations/prod11-kiosk-deployment-contract.r1.json`
