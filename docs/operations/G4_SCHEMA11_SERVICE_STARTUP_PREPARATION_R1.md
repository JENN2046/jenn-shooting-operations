# G4 Schema11 Service Startup Preparation R1

Status: **FROZEN_NOT_AUTHORIZED**

Authority base:

`codex/v2-1-architecture-freeze @ 1655d3646799d8a5923648bfbd033a690d8b03d0`

G3 Schema11 cutover is terminal **COMMITTED**. This preparation opens the first bounded action inside
**G4 PRODUCTION_V1_CLOSURE**. It does not start production, enable writers, enable Kiosk identity, enable
business runtime, or run the real business loop.

## G4-A action

`G4A_START_SCHEMA11_SERVICE_DISABLED`

Purpose: restore the exact current-canonical service on the existing production route while all ordinary
writes and destructive orphan cleanup remain fail-closed.

This action is deliberately separate from writer readmission.

## Exact artifact

```text
source commit =
1655d3646799d8a5923648bfbd033a690d8b03d0

image =
sha256:613cdb57b5359b89671ae4ea211028425a0e8f5a780045c45a9aa2957d749a59

offline image archive =
sha256:dc15df6a21fa89527d595e6d548afb139305a7f79c24172ece448fbf4fb7b44c

archive size =
63570944
```

The image is local-only at preparation time and is not staged on production.

## Fresh production target

Observed at `2026-10-07T05:33:34Z`:

```text
instance = ins-mi85f3my
host = VM-0-12-ubuntu
container name = jenn-shooting-operations-prod
container present = false
port 3800 = free

volume = jenn-shooting-operations_shooting_data
active DB Schema = 11
active DB sha256 =
sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9

journal_mode = delete
WAL / SHM / journal = absent
schedule revision = 3

G4 logical-facts digest =
sha256:8de6a00a7eddc5b33abd5edb6cdb14b08c72141d937c834ad7fea565d1083dd3
```

Existing Nginx route remains unchanged and currently returns 502 because no backend is listening:

```text
route = https://jso.skmt617.top
backend = http://127.0.0.1:3800
nginx config sha256 =
sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33
```

The existing production role-token file is identified only by path, permissions, exact key names and digest;
secret values are not recorded:

```text
/mnt/datadisk0/apps/jenn-shooting-operations/.env.tokens
sha256 =
sha256:4f8347a705a7cd5fbdd79d15436ac2c45f3746cf620e71208faf7d57f0133ae4

keys =
VIEWER_TOKEN
SUBMITTER_TOKEN
SCHEDULER_TOKEN
ADMIN_TOKEN
```

## Exact fail-closed startup

The only permitted startup configuration is:

```text
WRITE_ADMISSION_MODE=disabled
ORPHAN_CLEANUP_MODE=disabled
KIOSK_SERVICE_CONTEXT=PROD11_PRODUCTION
KIOSK_AUTH_CONFIG_PATH=
JSO_BUSINESS_RUNTIME absent
JSO_BUSINESS_IDENTITIES_JSON absent
```

Container boundary:

```text
user = node
rootfs = read-only
tmpfs = /tmp:rw,nosuid,nodev,noexec
security = no-new-privileges:true
restart policy = no
port = 127.0.0.1:3800:3800
volume = jenn-shooting-operations_shooting_data:/app/data:rw
```

No Nginx mutation is allowed.

## Explicitly authorized physical effects if G4-A is later approved

Starting the writable ScheduleStore is not byte-read-only. Current source intentionally moves SQLite from
DELETE to WAL mode and creates the orphan-cleanup disabled marker before serving traffic. Therefore a future
G4-A execution may produce only these bounded storage effects:

- exact image staging in the Docker image store;
- creation/start of the exact container;
- SQLite `DELETE → WAL` journal transition and WAL/SHM sidecars;
- creation/update of the orphan-cleanup disabled marker.

It may **not** change logical business facts or schedule revision.

Disposable exact-image acceptance proved:

```text
health = healthy
X-Write-Admission = disabled
running journal_mode = wal
disabled marker count = 1
physical DB hash changed = true

logical digest before =
sha256:4e778fe6be66660b0668f4a5d555ef26c41f8a7336d91170fe692809f82c133e

logical digest after =
sha256:4e778fe6be66660b0668f4a5d555ef26c41f8a7336d91170fe692809f82c133e
```

## Required post-start facts

A later G4-A execution is successful only if:

- exact container is running and healthy;
- loopback and existing HTTPS route return 200;
- `X-Write-Admission=disabled`;
- Schema11 and migration11 checksum remain exact;
- integrity is `ok`, FK violations are zero;
- runtime journal mode is WAL;
- production G4 logical-facts digest remains
  `sha256:8de6a00a7eddc5b33abd5edb6cdb14b08c72141d937c834ad7fea565d1083dd3`;
- schedule revision remains 3;
- Kiosk mode remains disabled;
- business runtime remains disabled.

## Prohibitions

G4-A does not authorize `SIGUSR2`, writer readmission, cleanup enablement, Kiosk auth/smoke enablement,
business-runtime identity enablement, VCP/DingTalk mutation, Nginx mutation, old-image restart, automatic restart,
or logical business-data mutation.

Writer readmission is a later independent authority decision. A temporary in-process admission enable must never
be represented as durable production mode.

## Exact approval target

```text
actionId =
G4A_START_SCHEMA11_SERVICE_DISABLED

authorityTargetDigest =
sha256:2b998133ebfe2216482feb52e19611e2044c2853eba3f78d529be6e7cfcb1586
```

Current state:

```text
G4-A startup = NOT AUTHORIZED
writer readmission = NOT AUTHORIZED
real business loop = NOT STARTED
durable production mode = NOT DESIGNED
```

Next action after this preparation is reviewed and merged:

`REQUEST_EXPLICIT_G4A_START_SCHEMA11_SERVICE_DISABLED_AUTHORIZATION`
