# WO-06D Production Change Manifest + Authorization Packet

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- Branch: `codex/wo-06d-production-change-manifest`
- Current result: `WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / REVIEW_CLOSURE_BLOCKED / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`

## Goal

Freeze the exact production-change surface and the human-authorization packet without performing any production action.

WO-06D answers what could change, which exact target is affected, which prerequisites must hold, which evidence must be captured, which rollback corresponds to each change, which actions are requestable, and why other actions remain blocked.

A valid frozen definition is not deployment permission, implementation of an external capability, or proof that independent review is complete.

## Authority artifact

- Machine-readable authority candidate: `docs/operations/production-change-manifest.v1.json`
- Schema: `contracts/production-change-manifest.v1.schema.json`
- Validator: `src/production-change-manifest-v1.mjs`
- Validation command: `npm run validate:production-manifest`

The authorization packet is nested inside the manifest. The validator freezes lineage, exact action IDs and targets, risk, side effects, prerequisites, evidence, revalidation, requestability and source-scoped rollback bindings.

The only global pre-request check is `AUTHORITY_HEAD`. Host identity/conflicts, backup/rollback proof, secret storage, external readiness, rollback-target scope, build source/base digest and built-image digest remain allocated to the actions that require them. PROD-01 has no action-specific revalidation and requires exact candidate-host binding, not facts that the preflight is responsible for discovering.

## Frozen authorization semantics

```text
approvalModel = EXACT_ACTION_IDS_AND_TARGETS_ONLY
blanketApprovalAllowed = false
requestedActionIds = []
approvedActionIds = []
requestableActionIds = []
derivedRollbackActionIds = []
authorizationPacket = FROZEN_NOT_REQUESTED
deploymentAuthorizationRequest = BLOCKED_PREREQUISITES
deploymentGate = BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

Nothing in this document authorizes an action. No production host access, credential generation, migration, deployment, provider call, VCP/Kiosk enablement, proxy/TLS/firewall change, cutover, release or merge was performed by this correction.

## Current blockers

The dedicated deployment-level subset is exactly:

```text
VCP_DEPLOYABLE_ADAPTER_WIRING
KIOSK_DEPLOYABLE_AUTH_WIRING
PRODUCTION_TARGET_FACTS
PRODUCTION_DATA_MIGRATION
PRODUCTION_DEPLOYMENT_GATE
```

This five-gate subset is emitted as `deploymentBlockingGateIds`. Separately, `blockingGateIds` must equal every gate currently marked `BLOCKED`; all 25 current entries are reproduced in the machine verdict below. The correction binds PROD-12 to existing blocked gates; it promotes no gate and adds no new gate.

`WO06C_VCP_EXTERNAL` is blocked post-enable compatibility, not a deployment-level blocker or PROD-10 prerequisite. The sequence remains deployable VCP wiring → separately authorized PROD-10 → real pull / guarded push / verification pull → compatibility PASS → PROD-13 cutover. No such real operation has run. The gate remains exhaustive and a cutover prerequisite.

Kiosk follows the analogous sequence: `KIOSK_DEPLOYABLE_AUTH_WIRING` precedes PROD-11; real-device acceptance can close `WO06C_KIOSK_DEVICE` afterward, before cutover. Neither compatibility gate is deleted or self-promoted.

WO-06C local DingTalk readiness remains `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`, but exact app/provider/destination binding and deployable adapter/credential/runtime wiring remain blocked. PROD-12 now also requires `PRODUCTION_TARGET_FACTS`, `INTEGRATION_DEPLOYMENT_READINESS` and `PRODUCTION_DEPLOYMENT_GATE`. Local provider readiness therefore cannot bypass the production deployment chain.

`POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` is a PROD-14 prerequisite, not a sixth deployment-level blocker.

## Requestable actions

No action definition is currently requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` remains blocked by `TARGET_HOST_BINDING`, not `PRODUCTION_TARGET_FACTS`. One exact candidate host must first be structurally bound; a separately authorized preflight may then verify that identity and discover disk/port/container/proxy/TLS facts.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains `BLOCKED_PREREQUISITE`, with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING`. Its exact prerequisites are now:

```text
WO06C_DINGTALK_PROVIDER
DINGTALK_TARGET_BINDING
DINGTALK_DEPLOYABLE_ADAPTER_WIRING
PRODUCTION_TARGET_FACTS
INTEGRATION_DEPLOYMENT_READINESS
PRODUCTION_DEPLOYMENT_GATE
```

`DEPLOYMENT_CHAIN_COMPLETION_PROOF` is required both before requesting PROD-12 and in its completion evidence. It refers to the preceding deployment actions, not PROD-12's own send result. The existing secret-storage, runtime-adapter, external-readiness and rollback revalidation remains required. `DINGTALK_RUNTIME_WIRING_PROOF`, exact provider/destination scope and `SEND_RESULT` remain action evidence. No post-send result was introduced as a prerequisite for its own action, and no VCP/Kiosk pre-enable acceptance cycle was restored.

## Retained execution and recovery boundaries

PROD-09 still requires offline/quiescent source state or verified coordination, an absent target SQLite path, isolated storage and verified attachment-byte copying with source/target manifest and record/file parity. Import must complete before PROD-05 can initialize its runtime database.

PROD-07 remains staging-only: public unauthenticated writes are blocked, with any allowed staging writes limited to exact bounded principals. PROD-13 rechecks that restriction. This is not a target-wide write freeze; the separate target-side race in comment `4103936494` remains open and unimplemented.

All destructive orphan cleanup entry points, including startup, periodic timer, `saveUpload()` and `submitRequest()`, must remain disabled before cutover and be re-proved at PROD-05/07/13. PROD-14 separately owns restoration after cutover completion and protected attachment parity.

PROD-10 and PROD-11 remain `IRREVERSIBLE_OR_EXTERNAL`: disabling adapter/device configuration does not erase persisted VCP/Kiosk business facts.

Rollback order remains:

```text
remove new route
→ revert only the newly changed firewall/security-group rule
→ stop and remove the exact new container object while preserving its named volume
→ remove the exact PROD-04 image digest after proving all container references are absent
→ revoke/remove role-token runtime bindings created by PROD-03
→ disable only VCP configuration introduced by PROD-10
→ disable only Kiosk configuration introduced by PROD-11
→ disable only DingTalk configuration introduced by PROD-12
→ preserve data volume and stop mutation
```

Data-volume deletion is forbidden. Blocked post-Switch authority restoration is not represented as an available rollback capability.

## Fresh implementation-bearing evidence

- Head: `7abad25e55ea459cb38f8e5b8b92d8d870307199`
- Parent: `3f6fca1713e96b24e3533d7139d0fd7965855a69`
- Correction starting head: `0782e22eb361325a4038b1158329cc21d2a4d1bf`
- GitHub Actions run: `36137024497` (run #103)
- Workflow: `WO-06D Production Authorization Packet`
- Event: `push`
- Conclusion: `success`
- Verified job: `108077434515`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

The workflow checkout and recorded `git rev-parse HEAD` both identify the implementation SHA above. This is published exact-head GitHub evidence, not a local Codex task report.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     593
pass                           592
fail                           0
skipped                        1
manifest targeted tests        63
manifest targeted pass         63
manifest targeted fail         0
manifest targeted skipped      0
```

The single full-suite skip is the absent external VCP adapter; it is not compatibility PASS. The targeted command is `node --test tests/production-change-manifest*.test.mjs`, including Unicode, shell-continuation, dynamic-values and the new review-closure regression file.

### Machine verdict

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:029f63f56fa46faa8fbd0f68ede496dadc01526a83887ea81005e4642ee2ee7c",
  "authorizationPacket": "FROZEN_NOT_REQUESTED",
  "deploymentAuthorizationRequest": "BLOCKED_PREREQUISITES",
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "requestableActionIds": [],
  "blockingGateIds": [
    "WO06C_VCP_EXTERNAL",
    "VCP_DEPLOYABLE_ADAPTER_WIRING",
    "WO06C_KIOSK_DEVICE",
    "KIOSK_DEPLOYABLE_AUTH_WIRING",
    "DINGTALK_TARGET_BINDING",
    "DINGTALK_DEPLOYABLE_ADAPTER_WIRING",
    "CUTOVER_FORWARD_CHAIN",
    "CUTOVER_SWITCH_RECOVERY",
    "CUTOVER_SOURCE_CONSISTENCY",
    "CUTOVER_LIVE_SERVICE_READINESS",
    "TARGET_HOST_BINDING",
    "CONTAINER_START_READINESS",
    "PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL",
    "HEALTH_SMOKE_READINESS",
    "PROXY_BACKEND_READINESS",
    "PRE_CUTOVER_ROUTE_WRITE_RESTRICTION",
    "PRODUCTION_IMPORT_STORAGE_READINESS",
    "PRODUCTION_IMPORT_TARGET_ABSENCE",
    "PRODUCTION_IMPORT_SOURCE_CONSISTENCY",
    "PRODUCTION_ATTACHMENT_COPY_CAPABILITY",
    "INTEGRATION_DEPLOYMENT_READINESS",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION",
    "PRODUCTION_DEPLOYMENT_GATE"
  ],
  "deploymentBlockingGateIds": [
    "VCP_DEPLOYABLE_ADAPTER_WIRING",
    "KIOSK_DEPLOYABLE_AUTH_WIRING",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "PRODUCTION_DEPLOYMENT_GATE"
  ]
}
```

The manifest changed only to bind DingTalk to the existing production gates and deployment-chain proof. Its current Git blob is `a80f7a715cac9b3493d2373293bfff18fd83ce57`. The old `32fa0a5d...` digest is historical and must not be used to verify this revision.

### Scanner correction and verified coverage

The shell parser retains its conservative rejection of active unescaped dollar/backtick syntax before whitespace termination, without executing or evaluating input. Short single-quoted or escaped literal forms, UTF-16 counting and shell continuations remain supported. The config parser retains rejection of unsupported unquoted YAML scalar/tag/anchor/alias prefixes `|`, `>`, `!`, `&`, `*`.

The new correction closes two additional syntax bypasses:

1. Colon assignments preserve the physical newline after the delimiter. The config scanner rejects a remaining multiline snippet rather than measuring only its first physical line. This covers plain and quoted YAML continuation, LF/CRLF/CR, and a value starting on the next line. Terminal trailing newline/whitespace remains harmless. Rejection intentionally also covers ambiguous multi-entry snippets after a recognized token assignment; this is not YAML scope or folding evaluation.
2. Quoted assignment keys containing backslash escapes or physical line breaks are rejected before matching literal role names. This intentionally rejects unsupported escaped-key syntax, rather than attempting partial JSON/YAML decoding or missing a role name concealed by one escaped character.

New file `tests/production-change-manifest-review-closure.test.mjs` adds six test groups covering all five token keys, multiline plain/quoted values, comments and conservative multi-entry rejection, each key-character Unicode escape and fully escaped keys, YAML x/U forms, normal short-value controls, UTF-16 boundaries, retained continuations/dynamic rejection, removal of DingTalk prerequisites/completion proof and non-authorizing state preservation. No synthetic shell input is executed and no real credential is used.

Current source blob: `65831991116280d657f8ad47e0f25b6265cba271`; new test blob: `f857cd9d18af49d008c2b6e83786fa8d9e37c7e0`; aligned main-test blob: `1009bc032f8b3210768800b616f228f277c7b052`.

The validator continues to reject schema-level secrets, nonempty approval sets, blanket approval, incomplete blocker sets, target widening, prerequisite/status/evidence drift, wrong rollback bindings and combined semantic widening. These regression results do not close unrelated contract review findings.

### Failed intermediate run and correction

Implementation commit `3f6fca1713e96b24e3533d7139d0fd7965855a69` ran in `36135791873` and failed one existing exact-array assertion: the main test still expected PROD-12's previous revalidation list without `DEPLOYMENT_CHAIN_COMPLETION_PROOF`. The six new review-closure groups passed. Commit `7abad25e55ea459cb38f8e5b8b92d8d870307199` changes only that expected array to include the new required proof. No production gate, scanner guard, workflow or test was removed or weakened. Run #103 then passed the complete suite and all 63 manifest tests.

## Remaining independent review work

Comment `4103936494` remains unimplemented: target writes must be frozen and drained from before final source/target and attachment parity through Switch and read-only post-switch verification. A staging ACL or source quiescence alone does not prevent target-side races. The ordered fence/drain/parity/switch/success-only-release contract and its deployable capability gate have not been added in this correction. Execution order must be machine-enforced rather than compared as a set, and a future change must not require an unauthorized freeze result before request.

Comment `4103894629` is addressed at the implementation level by the new PROD-12 bindings and regressions. Comments `4104348023` and `4104348028` are addressed by the multiline/escaped-key correction. Review-thread closure and an independent clean review must still be confirmed against the eventual exact final head. New findings from subsequent review must also be assessed; CI success is not independent review closure.

## Exit and final-head evidence rule

This evidence synchronization is docs-only and follows implementation run #103 success. The resulting final PR head must independently pass the unchanged WO-06D workflow. Record that exact final SHA/run in the PR/check record, not self-referentially inside this same commit.

Before any separately authorized merge, require current exact head, successful exact-head workflow, zero unresolved review threads, an independent Codex clean signal for that same head, and OPEN / mergeable / not merged. Only an explicit human merge instruction permits merge, with `expected_head_sha`. CI success alone is insufficient.

WO-06D authority closure and deployment authorization remain separate. `docs/DEPLOYMENT_PREFLIGHT.md` is historical context and cannot override the current WO-06 authority or manifest.

## Historical review evidence boundary

The complete pre-correction document, including every chronological hardening section and its original SHA/run/digest, is preserved byte-for-byte in [the historical cb456114 snapshot](WO-06D_PRODUCTION_CHANGE_MANIFEST.HISTORICAL_cb456114.md). Its Git blob is `1ee7813131fb0170497a06442d015655db29b5a8`, identical to this document at `cb456114e4d57d8ff12473da95737790a63e7118`.

The subsequent published dynamic-values scanner checkpoint was implementation `9f13b160bb43d3db37f30fc03bc42c635d0e181f`, run #99 `36131969264`, followed by docs head `0782e22eb361325a4038b1158329cc21d2a4d1bf`, run #100 `36132684480`. Those historical results were 587/586/0/1 full tests, 57/57 targeted and digest `sha256:32fa0a5d754c157345561e9a5e1f6fcd274f8f0f94b96f3f605df4aef609cd47`. Their prior source/test blobs were `9dd5efa0659544add4d7c49e9633290a1e348806` and `bfccd6ed9fbed687b1639a27ecd42451ba42f16a`. These snapshots do not override the fresh run #103 evidence above.

All historical uses of "current", requestable sets, blocker lists, PASS and execution sequences apply only to their stated revisions. Original review comments and Git history remain additional provenance.

The inaccessible local-only Codex commit `86f6e0793b06baa2f70c7cccf9e327877801bc4a` supplies no accepted publication or GitHub CI evidence. The current correction was independently authored from the published `0782e22...` parent; it does not claim to recover that missing artifact.
