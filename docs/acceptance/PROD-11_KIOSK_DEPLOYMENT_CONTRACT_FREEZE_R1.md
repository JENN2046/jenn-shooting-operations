# PROD-11 Kiosk Deployment Contract Freeze R1

Status: **DEPLOYMENT MECHANICS FROZEN / BLOCKED ON EXACT REAL DEVICE**

This document freezes the deployment mechanics for `PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE`.
It does **not** authorize PROD-11, replace the live container, generate a real credential, enroll a browser, or submit a production run event.

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

The exact physical device and exact browser/profile are **not yet selected**. No historical authority or owner instruction identifies them.
Therefore this contract remains fail-closed and PROD-11 is not requestable yet.

The server-authoritative `deviceId` is a logical identity binding. The current Kiosk design does not claim cryptographic hardware attestation.
The real physical device/browser association must therefore be recorded as acceptance evidence for the owner-selected device.

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

`allowedBriefHosts` is deliberately empty for the initial freeze. A business brief host must not be guessed from the JSO API hostname.
If a future scheduled item needs a `briefUrl`, that host requires an explicit separately reviewed allowlist update.

## Frozen credential generation

A dedicated Kiosk credential is generated only after explicit PROD-11 authorization and exact real-device selection.

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

Current verdict:

```text
PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
= NOT REQUESTABLE YET
```

Blocking facts:

```text
EXACT_REAL_DEVICE_UNRESOLVED
EXACT_BROWSER_PROFILE_UNRESOLVED
FRESH_PRE_AUTH_TARGET_ATTESTATION_NOT_YET_RECORDED
```

PROD-11 becomes requestable only when:

1. the owner selects one exact physical Kiosk device and exact browser/profile;
2. a fresh read-only pre-authorization attestation confirms the production host, live container, route, volume and candidate image identities;
3. review confirms no widening of the frozen resource/device/config/rollback scope.

Credential generation, config materialization, real-device acceptance and offline replay occur only inside the later explicitly authorized PROD-11 execution. They are not performed during this freeze.

Machine-readable contract:

`docs/operations/prod11-kiosk-deployment-contract.r1.json`
