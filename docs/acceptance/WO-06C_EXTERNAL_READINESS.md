# WO-06C VCP / Kiosk / DingTalk External Readiness

- Authority base: `e2a8de4a0f388e3322bd6c14eb223ba04ce2cb64`
- Branch: `codex/wo-06c-external-readiness`
- Current result: `LOCAL_READINESS_RUNNING / EXTERNAL_VALIDATION_PENDING`
- Deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`

## Purpose

WO-06C proves that the repository-side boundaries are ready for separately authorized external validation.

It must not convert Mock, local loopback, test skip, or an unconfigured adapter into a claim that the external system was verified.

## Status model

Each external surface has its own verdict.

### VCP

Required final external proof:

- real `ShootingPlannerSyncService` implementation is present from an identified VCP runtime/source revision;
- `tests/vcp-sync-integration.test.mjs` runs instead of skipping;
- pull → guarded push → verification pull succeeds;
- no credentials or raw private content enter logs/reports.

Until then:

```text
VCP_EXTERNAL_COMPATIBILITY = BLOCKED_EXTERNAL_RUNTIME
```

### Kiosk

Repository-side readiness must fresh-pass:

- Kiosk static entry serves locally;
- default runtime has no implicit Kiosk authentication;
- current API returns `AUTH_NOT_CONFIGURED` without an injected auth port;
- explicitly injected trusted principal reaches the current-read path;
- targeted Kiosk contract/HTTP/offline/UI tests pass.

Real-device closure still requires the frozen WO-03 device/browser checklist:

- tablet landscape 1024×768;
- tablet portrait 768×1024;
- touch controls and blocking form under soft keyboard;
- DevTools/browser offline → online recovery;
- refresh;
- two tabs / local control lock;
- concurrent start / 409 conflict;
- 202 reviewRequired visibility;
- offline `start → block → resume → complete` replay;
- blocked cannot complete;
- browser-cache clearing does not change server facts.

Until recorded on real browser/device evidence:

```text
KIOSK_REAL_DEVICE = BLOCKED_DEVICE
```

### DingTalk

Repository-side readiness must fresh-pass:

- Outbox/card/dispatcher/worker/callback-admission targeted tests;
- unconfigured adapter reports exactly `DINGTALK_NOT_CONFIGURED`;
- unconfigured adapter performs zero network calls;
- Mock remains explicit-only;
- callback runtime remains `NOT_WIRED`;
- no provider credential/SDK is read.

If these pass, DingTalk may be classified:

```text
DINGTALK_PROVIDER = READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION
```

This is a pre-integration readiness verdict, not a real DingTalk integration PASS.

## Fresh local gate

The final branch head must run:

```text
npm ci
npm run check
Kiosk targeted suite
DingTalk/Outbox/Callback targeted suite
VCP integration test (expected explicit skip while adapter is absent)
external-readiness boundary harness
```

Expected local machine result:

```text
WO_06C_LOCAL_EXTERNAL_BOUNDARY_PASS
overallExternalClosure=PENDING
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

## Hard stops

Do not proceed automatically if closure requires:

- VCP external runtime access;
- a real tablet/browser device;
- DingTalk app/webhook/SDK credentials;
- real provider HTTP/DNS;
- callback public endpoint;
- production identity mapping;
- production database or deployment target.

Those require separate current authorization and evidence.

## Exit semantics

Local readiness may be merged while external checks remain open:

```text
WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS
VCP_EXTERNAL_COMPATIBILITY = BLOCKED_EXTERNAL_RUNTIME
KIOSK_REAL_DEVICE = BLOCKED_DEVICE
DINGTALK_PROVIDER = READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION
WO-06C_EXTERNAL_VALIDATION = PENDING
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

WO-06C is not fully closed until the required VCP and Kiosk external evidence exists and any separately authorized DingTalk integration step is recorded.
