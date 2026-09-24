# WO-06C VCP / Kiosk / DingTalk External Readiness

- Authority base: `e2a8de4a0f388e3322bd6c14eb223ba04ce2cb64`
- Branch: `codex/wo-06c-external-readiness`
- Current result: `WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS / EXTERNAL_VALIDATION_PENDING`
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


## Fresh run history

### Run 1 — HARNESS_CONTRACT_MISMATCH

- Head: `c348d34da501c1d4b1331ec0235e628519147a33`
- GitHub Actions run: `35978740143`
- `npm run check`: PASS
- Kiosk targeted suite: `118/118 PASS`
- DingTalk/Outbox/Callback targeted suite: `64/64 PASS`
- VCP integration classification: `1 skipped / external adapter absent`
- local boundary harness: FAIL on Kiosk error-envelope assertion

Actual frozen Kiosk unauthenticated envelope:

```json
{
  "schemaVersion": 2,
  "ok": false,
  "code": "AUTH_NOT_CONFIGURED",
  "replayed": false
}
```

Classification: harness assertion mismatch, not a Kiosk implementation failure.

Run 1 is preserved as non-PASS evidence. A fresh rerun is required.


### Run 2 — HARNESS_PERSISTENCE_PRECONDITION_MISMATCH

- Head: `59d7e8dbc7eb29b600d9650e881959aa6499bfe9`
- GitHub Actions run: `35978853404`
- `npm run check`: PASS
- Kiosk targeted suite: `118/118 PASS`
- DingTalk/Outbox/Callback targeted suite: `64/64 PASS`
- VCP integration classification: `1 skipped / external adapter absent`
- local boundary harness: FAIL after trusted-principal injection

Observed:

```text
configured Kiosk current HTTP status = 500
expected = 200
```

Root cause: the harness used a newly initialized database without the revision-counter bootstrap fact required by the frozen Kiosk composition contract. The existing composition test explicitly seeds `revision_counters(id=1, projection_revision=0, schedule_revision=0)` before validating an empty-resource read.

Classification: harness persistence-precondition mismatch, not a Kiosk implementation failure.

Correction: seed only the frozen revision-counter bootstrap fact in the isolated harness database before the configured loopback read. No application code or production path is changed.


### Run 5 — LOCAL_FRESH_PASS

- Final implementation-bearing head: `e0f3d3fea7c0906f0365272243c149d9b808ca1b`
- GitHub Actions run: `35979065391`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`
- `npm run check`: 530 tests / 529 pass / 0 fail / 1 expected external-VCP skip
- Kiosk targeted suite: `118/118 PASS`
- DingTalk/Outbox/Callback targeted suite: `64/64 PASS`
- VCP integration classification: `0 pass / 0 fail / 1 skipped`, reason `external VCP sync adapter is not present in this workspace`
- local external-boundary harness: PASS

Machine result:

```json
{
  "status": "WO_06C_LOCAL_EXTERNAL_BOUNDARY_PASS",
  "vcp": {
    "externalAdapterPresent": false,
    "compatibility": "BLOCKED_EXTERNAL_RUNTIME"
  },
  "kiosk": {
    "localHttpBoundary": "PASS",
    "defaultAuth": "AUTH_NOT_CONFIGURED",
    "explicitTrustedPrincipal": "PASS",
    "realBrowserDevice": "EXTERNAL_BLOCKED_DEVICE"
  },
  "dingtalk": {
    "localBoundary": "PASS",
    "readinessCode": "DINGTALK_NOT_CONFIGURED",
    "networkCalls": 0,
    "providerIntegration": "READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION",
    "callbackRuntime": "NOT_WIRED"
  },
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "overallExternalClosure": "PENDING"
}
```

This is the final implementation-bearing local-readiness run. Any later docs-only status/evidence commit must itself pass the unchanged WO-06C workflow before merge; that final-head run is attached to the PR/check record rather than replacing the implementation-bearing evidence above.

## Current closure state

```text
WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS
VCP_EXTERNAL_COMPATIBILITY = BLOCKED_EXTERNAL_RUNTIME
KIOSK_REAL_DEVICE = BLOCKED_DEVICE
DINGTALK_PROVIDER = READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION
WO-06C_EXTERNAL_VALIDATION = PENDING
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

The local repository boundary is ready. The external validation gate is intentionally still open.
