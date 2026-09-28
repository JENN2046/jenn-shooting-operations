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


### Canonical-status implementation run — LOCAL_FRESH_PASS

- Final implementation-bearing head: `775b6072687c53d2135be8d069b650bb37771090`
- GitHub Actions run: `35981030282`
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
    "realBrowserDevice": "BLOCKED_DEVICE"
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


## PROD-10 adapter-owner R1 source compatibility checkpoint

Architecture R1 separates reviewed adapter-source compatibility from live VCPToolBox runtime enablement.

The identified Jenn-owned adapter package is content-bound as a complete two-file source package:

```text
repository = JENN2046/VCPToolBox-JENN-Extensions
revision   = e4da9e65a442c7bba3c56ec267cdf69848ed09e5
owner      = VCPTOOLBOX_JENN_EXTENSIONS

index path =
ShootingOperationsPackages/VcpSyncAdapter/index.cjs
index sha256 =
2c97bdeaba97affce3454feda4202816be6f483f224ff5319e43e4fe8d7fd973

manifest path =
ShootingOperationsPackages/VcpSyncAdapter/package-manifest.json
manifest sha256 =
f52d13cbd9b7c38422304916a88fbba16825e5f7ffbacc8644b624b3c6f72161

exact package files =
index.cjs
package-manifest.json
```

The compatibility harness rejects an incomplete package, a package with extra sibling files, a mismatched owner/path/revision declaration, a mismatched source digest, or a package manifest that changes the frozen runtime-disabled / PROD-10 / rollback boundary.

That package is deliberately runtime-disabled and non-authorizing:

```text
defaultEnabled                 = false
runtimeEnabled                 = false
runtimeEligible                = true
activationState                = SOURCE_ONLY_RUNTIME_DISABLED
networkAuthorized              = false
realBackendAuthorized          = false
realAuthAuthorized             = false
businessWritesAuthorized       = false
persistentEnablementAuthorized = false
productionActionRequired       = PROD-10-ENABLE-VCP-REMOTE-SYNC
rollbackActionId               = ROLLBACK-09-DISABLE-VCP-CONFIG
```

Fresh adapter-source validation at exact extension head `e4da9e65a442c7bba3c56ec267cdf69848ed09e5`:

```text
targeted adapter suite = 17 / 17 PASS
full extension suite   = 1856 / 1856 PASS
fail                   = 0
skip                   = 0
```

The review-hardened adapter proves:

- response bodies are capped while streaming rather than after full buffering;
- write-side 5xx and transport failures are classified as uncertain and are not automatically retried;
- verify-after-write uses structural equality that preserves array order without depending on object property insertion order;
- the runtime source and package metadata are bound in `manifests/MANIFEST.sha256`;
- `snapshot.revision` must exactly equal the guarded `expectedRevision` before any write request is emitted;
- scheduler credentials require HTTPS except for explicit loopback HTTP used by isolated tests;
- the scheduler credential remains private adapter state and is absent from public properties and JSON serialization;
- the validated base URL and credential-bearing transport are immutable private state;
- guarded-write revision and operation identity are captured once and reused for the wire headers and response-revision check.

Fresh isolated cross-repository compatibility proof used:

```text
Jenn Shooting Operations head = cb40716d33e89a0bda87e7abcc7da4601cf5e966
Jenn extension adapter head    = e4da9e65a442c7bba3c56ec267cdf69848ed09e5
adapter owner                  = JENN2046/VCPToolBox-JENN-Extensions
adapter index sha256           = 2c97bdeaba97affce3454feda4202816be6f483f224ff5319e43e4fe8d7fd973
adapter manifest sha256        = f52d13cbd9b7c38422304916a88fbba16825e5f7ffbacc8644b624b3c6f72161
runtime                        = approved JSO production image / Node 24.21.0
network                        = Docker --network none
production data volume         = not mounted
production endpoint            = not used
production scheduler credential = not used
synthetic scheduler credential = used only inside isolated loopback test
```

Result:

```text
tests/vcp-sync-integration.test.mjs
1 pass
0 fail
0 skip

adapter flow:
pull
→ revision-guarded/idempotent push
→ verification pull

independent JSO observation:
stored revision = 1
stored task id  = TASK-INTEGRATION
request trace   =
GET /api/v1/snapshot
PUT /api/v1/snapshot
GET /api/v1/snapshot
```

The persisted store observation and HTTP request trace are independent of the adapter's returned `write` / `verifiedSnapshot` object, so the compatibility proof cannot pass merely by synthesizing a success result.

The WO-06C local-boundary harness with that source package reports source state separately from live external state:

```text
sourceAdapterPresent = true
sourceIdentityVerified = false
architectureOwner = VCPTOOLBOX_JENN_EXTENSIONS
verifiedAdapterOwner = null
externalAdapterPresent = false
sourceCompatibility = ADAPTER_SOURCE_PRESENT_REQUIRES_IDENTITY_AND_COMPATIBILITY_RUN
compatibility = BLOCKED_EXTERNAL_RUNTIME
overallExternalClosure = PENDING
```

The separate package-bound compatibility test above supplies the source compatibility PASS and verifies the exact Jenn extension owner/revision/digests before module load. The local-boundary harness intentionally treats a configured filesystem path as unverified source presence only; it does not assign a verified owner from path existence. It also continues to report live VCP compatibility as `BLOCKED_EXTERNAL_RUNTIME` because source compatibility does not prove installation, registration, endpoint binding, secret binding, or rollback readiness in the live VCPToolBox runtime.

The normal repository workflow intentionally does not inject an external adapter package identity. Its local run therefore continues to classify VCP as externally blocked rather than fabricating live runtime evidence.

This checkpoint establishes **source implementation compatibility only**. It does not establish:

- installation or registration in the live VCPToolBox runtime;
- exact live VCPToolBox release/package binding;
- production endpoint binding;
- scheduler-principal secret binding;
- `ROLLBACK-09-DISABLE-VCP-CONFIG` live readiness;
- real production pull / guarded push / verification pull;
- PROD-10 authorization or completion.

Therefore the canonical live external state remains:

```text
VCP_SOURCE_COMPATIBILITY = PASS
VCP_EXTERNAL_COMPATIBILITY = BLOCKED_EXTERNAL_RUNTIME
PROD-10-ENABLE-VCP-REMOTE-SYNC = NOT_AUTHORIZED
```

The historical VCPChat adapter-path assumption is no longer used by the integration test or the WO-06C VCP boundary harness. Historical WO-06C evidence remains unchanged as historical evidence.
