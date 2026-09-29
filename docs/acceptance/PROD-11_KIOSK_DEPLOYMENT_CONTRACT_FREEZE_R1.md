# PROD-11 Kiosk Deployment Contract Freeze R1

Status: **DEVICE / BROWSER FROZEN / BLOCKED ON SCHEDULABLE ACCEPTANCE TARGET**

This document freezes the deployment mechanics and exact device/browser target for `PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE`.
It does **not** authorize PROD-11, replace the live container, generate a real credential, create the dedicated browser profile, enroll the device, prepare production scheduling data, or submit a production run event.

## Runtime image

```text
runtime source authority = d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7
image tag = jenn-shooting-operations:prod-d1fe85ec73e3241e8da3cff6c5f433b7e22e20e7
image id = sha256:de849c3005e484874e0e55130ee3a36ab74e6db3785a817ad612c1903d8f1c72
Node = 24.21.0
Kiosk targeted = 158 / 158 PASS
full repository = 801 tests / 798 pass / 2 known migration-userland failures / 1 expected VCP skip
```

The two full-suite failures remain the previously reproduced Alpine `touch @<nanosecond timestamp>` limitation and are not Kiosk regressions.

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
- grouped sessions display all tasks without pretending they are one-task labor time;
- real screen reader, external keyboard, touch-target and studio-lighting contrast checks;
- operator logout, identity expiry and device handoff flow.

Therefore the following remain explicit blockers after QLL-6 selection:

```text
EXACT_ON_SITE_IPAD_OR_TABLET
EXACT_SAFARI_BROWSER_TARGET
EXACT_MOBILE_VIEWPORT_EXECUTION_TARGET
EXACT_ACCESSIBILITY_ASSISTIVE_TECH_ENVIRONMENT
```

No Windows-Chrome-only evidence set may be used to mark `REAL_DEVICE_ACCEPTANCE` complete.

## Frozen runtime auth config

```text
host path      = /mnt/datadisk0/apps/jenn-shooting-operations/kiosk-auth.v1.json
container path = /app/kiosk-auth.v1.json
env            = KIOSK_AUTH_CONFIG_PATH=/app/kiosk-auth.v1.json
mount          = read-only bind
host owner     = uid 1000 / gid 1000
host mode      = 0600

schemaVersion     = 1
authMode          = basic-v1
realm             = Jenn Shooting Operations Kiosk
username          = jso-kiosk-prod-01
businessTimeZone  = Asia/Shanghai
allowedBriefHosts = []
```

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

Those checks require an exact canonical V2 request, production resource, active scheduling config, canonical proposal acceptance, derived schedule item and exact task binding. They cannot be truthfully closed against an empty scheduling domain.

The supported Scheduling path requires `schedule_item_tasks.task_id` to reference `requests_v2`, and a single schedule item must bind exactly one request. A V1 snapshot-only request is insufficient.

Preparing that schedulable acceptance target is a **separate production scheduling write** and must not be smuggled into PROD-11's frozen effects.

Before PROD-11 can be requested, a separately authorized preparation must create or fresh-confirm:

```text
exact canonical requests_v2 acceptance request
resourceId = STUDIO-PROD-01
applicable active scheduling config
deterministic acceptance proposal
canonical accept decision
derived Kiosk acceptance schedule item
schedule_item_tasks binding from that item to the exact V2 request
```

The schedule item and task binding must come from the canonical proposal-acceptance path. Direct SQL insertion is forbidden.

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

## Requestability decision

Closed:

```text
PRIMARY_PRODUCTION_KIOSK_TARGET_SELECTED      = QLL-6
DEDICATED_CHROME_PROFILE_TARGET_FROZEN        = PASS
FRESH_PRE_AUTH_TARGET_ATTESTATION             = PASS
DATABASE_WIDE_BRIEF_HOST_COMPATIBILITY        = PASS_CURRENT_STATE
```

Still blocked:

```text
KIOSK_ACCEPTANCE_V2_REQUEST_ABSENT
PRODUCTION_RESOURCE_STUDIO_PROD_01_ABSENT
ACTIVE_SCHEDULING_CONFIG_ABSENT
KIOSK_ACCEPTANCE_SCHEDULE_ITEM_ABSENT
KIOSK_ACCEPTANCE_TASK_BINDING_ABSENT
SEPARATE_SCHEDULING_PREPARATION_AUTHORITY_UNRESOLVED
WO03_FULL_DEVICE_BROWSER_MATRIX_INCOMPLETE
WO03_ADDITIONAL_DEVICE_BROWSER_TARGETS_UNRESOLVED
```

Therefore:

```text
PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
= NOT READY TO REQUEST EXPLICIT AUTHORIZATION

formal authorization state
= FROZEN_NOT_REQUESTED
```

Credential generation, dedicated Chrome profile creation, config materialization, live container replacement, identity enrollment, real-device acceptance, offline replay and any run-event submission remain inside the later explicitly authorized PROD-11 execution.

Machine-readable contract:

`docs/operations/prod11-kiosk-deployment-contract.r1.json`
