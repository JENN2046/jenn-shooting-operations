# PROD-11 Kiosk Auth Runtime Wiring R1

Status: **SOURCE IMPLEMENTED / NOT DEPLOYED / NON-AUTHORIZING**

This checkpoint prepares the deployable authentication boundary required before
`PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE` may be requested.

It does not authorize or perform PROD-11.

## Scope

The production Kiosk authentication mechanism is deliberately independent from
the existing viewer, submitter, scheduler, and administrator role tokens.

The runtime binding is:

```text
real browser/device
  ↓ TLS
HTTP Basic credential dedicated to one Kiosk identity
  ↓
KIOSK_AUTH_CONFIG_PATH
  ↓
scrypt-v1 credential verification
  ↓
trusted principal
role = operator
resourceIds = exact server-side scope
subjectId = exact server-bound deviceId
  ↓
existing Kiosk V2 readSchedule + submitRunEvent capability checks
```

The dedicated Kiosk principal does not receive `modifySchedule`,
`correctRunEvent`, or administrator capability.

## Runtime configuration boundary

Kiosk auth remains disabled by default.

If `KIOSK_AUTH_CONFIG_PATH` is absent, the production entrypoint preserves the
existing `AUTH_NOT_CONFIGURED` behavior.

When configured, the path must be absolute and the referenced config must:

- be opened with no-follow + nonblocking semantics and validated/read through the same descriptor;
- be owned by the running process UID;
- expose no group/other permissions and no owner execute bit;
- contain an exact schema with no extra keys;
- use `authMode = basic-v1`;
- use an `operator` principal only;
- bind `principal.subjectId` exactly to `deviceId`;
- contain a non-empty explicit resource scope;
- store only scrypt salt/hash material, never a cleartext password.

The runtime object does not serialize the credential hash or password. Startup also rejects any Kiosk credential that collides with the configured viewer, submitter, scheduler, or administrator token. Request-time password verification uses asynchronous scrypt with a fixed four-attempt concurrency bound; excess attempts fail closed instead of blocking the Node event loop or building an unbounded authentication queue.

## Browser/device identity

The browser does not invent a production device identity.

After Basic authentication it reads the server-bound identity from:

```text
GET /api/v2/kiosk/identity
```

The browser stores that exact non-secret device identifier locally.

Rules:

- first-use offline browsers cannot invent an identity;
- an existing mismatched local identity fails closed;
- an already provisioned browser may queue offline while identity verification is
  temporarily unavailable;
- every online synchronize attempt re-verifies identity before refresh or replay; initial identity failure still starts a read-only recovery poller, and a later verified identity may acquire the control lock without manual reload;
- authoritative identity mismatch or HTTP auth rejection is first latched in memory, then best-effort persisted; it remains fail-closed across later outages even if localStorage persistence fails, until a matching 200 identity response clears it;
- run-event submission is denied if the command `deviceId` does not match the
  authenticated runtime device binding.

## HTTP boundary

Configured Kiosk authentication adds a standard Basic challenge to the Kiosk
entrypoint and Kiosk APIs.

The static JS/CSS assets contain no runtime secret material.

The API continues to enforce:

- trusted-principal validation;
- explicit resource scope;
- role-derived capability checks;
- global write admission;
- immutable offline queue semantics;
- revision/idempotency/run-event rules;
- reviewRequired/conflict behavior.

## Validation

Approved production image runtime:

```text
image = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
Node  = 24.21.0
network = none
production volume = not mounted
```

Targeted Kiosk auth/device/runtime tests:

```text
90 / 90 PASS
0 fail
0 skip
```

A full repository check in that image reported:

```text
786 tests
783 pass
2 fail
1 expected VCP skip
```

The two failures are the pre-existing migration WAL mtime tests whose use of
`touch @<nanosecond timestamp>` is unsupported by the image's userland. The
same two failures reproduce on base commit
`204d35d38e5e2ea55bfa00c45d79a449eedf00eb` in the same image. They are not
introduced by the Kiosk auth diff.

GitHub exact-head CI remains the merge authority for the final PR head.

## Live production preflight

Read-only production inspection currently shows:

```text
running image = c305de265b...
Kiosk auth runtime wiring in running image = absent

scheduling resources = []
active scheduling config count = 0
schedule item count = 0
production run count = 0
production event count = 0
Kiosk review table in running schema = absent
```

Therefore source implementation alone does not make PROD-11 requestable.

Before real-device activation, a later authorized deployment must bind:

- an approved image containing this runtime wiring and current Kiosk schema;
- exact production resource scope;
- exact dedicated Kiosk credential;
- exact device identity;
- exact browser/device acceptance evidence;
- offline replay evidence;
- `ROLLBACK-10-DISABLE-KIOSK-CONFIG` readiness.

## Rollback semantics

The deployable auth mechanism is disable-only.

Removing the Kiosk runtime config binding must return the runtime to the existing
unconfigured Kiosk authentication state.

Configuration rollback must not erase already committed production runs,
reviews, receipts, audit facts, or revision history.

## Current authority

```text
PROD-10-ENABLE-VCP-REMOTE-SYNC = COMPLETED
nextActionId = PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE

KIOSK_DEPLOYABLE_AUTH_WIRING = SATISFIED
KIOSK_AUTH_RUNTIME_SOURCE = IMPLEMENTED
KIOSK_AUTH_RUNTIME_LIVE = NOT_DEPLOYED
KIOSK_REAL_DEVICE = NOT_VERIFIED
PROD-11 = NOT_AUTHORIZED
```
