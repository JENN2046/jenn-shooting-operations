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

This five-gate subset is emitted as `deploymentBlockingGateIds`. Separately, `blockingGateIds` must equal every gate currently marked `BLOCKED`; all 25 current entries are reproduced in the machine verdict below. No gate status or blocker definition changed in the scanner correction.

`WO06C_VCP_EXTERNAL` is blocked post-enable compatibility, not a deployment-level blocker or PROD-10 prerequisite. The sequence remains deployable VCP wiring → separately authorized PROD-10 → real pull / guarded push / verification pull → compatibility PASS → PROD-13 cutover. No such real operation has run. The gate remains exhaustive and a cutover prerequisite.

Kiosk follows the analogous sequence: `KIOSK_DEPLOYABLE_AUTH_WIRING` precedes PROD-11; real-device acceptance can close `WO06C_KIOSK_DEVICE` afterward, before cutover. Neither compatibility gate is deleted or self-promoted.

WO-06C local DingTalk readiness remains `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`, but exact app/provider/destination binding and deployable adapter/credential/runtime wiring remain blocked. Local provider readiness does not make PROD-12 requestable. Its missing deployment-chain prerequisites are an additional unresolved review finding, described below.

`POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` is a PROD-14 prerequisite, not a sixth deployment-level blocker.

## Requestable actions

No action definition is currently requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` remains blocked by `TARGET_HOST_BINDING`, not `PRODUCTION_TARGET_FACTS`. One exact candidate host must first be structurally bound; a separately authorized preflight may then verify that identity and discover disk/port/container/proxy/TLS facts.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains `BLOCKED_PREREQUISITE`, with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING`. It currently requires exact target binding, deployable wiring, `DINGTALK_RUNTIME_ADAPTER_CONFIGURATION` and `DINGTALK_RUNTIME_WIRING_PROOF`. The required deployment-chain correction has not been applied in this scanner-only implementation.

## Retained execution and recovery boundaries

PROD-09 still requires offline/quiescent source state or verified coordination, an absent target SQLite path, isolated storage and verified attachment-byte copying with source/target manifest and record/file parity. Import must complete before PROD-05 can initialize its runtime database.

PROD-07 remains staging-only: public unauthenticated writes are blocked, with any allowed staging writes limited to exact bounded principals. PROD-13 rechecks that restriction. This is not a target-wide write freeze; the separate target-side race remains open.

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

- Head: `9f13b160bb43d3db37f30fc03bc42c635d0e181f`
- Parent: `cb456114e4d57d8ff12473da95737790a63e7118`
- GitHub Actions run: `36131969264` (run #99)
- Workflow: `WO-06D Production Authorization Packet`
- Event: `push`
- Conclusion: `success`
- Verified job: `108061064763`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

The workflow checkout and recorded `git rev-parse HEAD` both identify the implementation SHA above. This is published exact-head GitHub evidence, not a local Codex task report.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     587
pass                           586
fail                           0
skipped                        1
manifest targeted tests        57
manifest targeted pass         57
manifest targeted fail         0
manifest targeted skipped      0
```

The single full-suite skip is the absent external VCP adapter; it is not compatibility PASS. The targeted command is `node --test tests/production-change-manifest*.test.mjs`, including Unicode, shell-continuation and the new dynamic-values regression file.

### Machine verdict

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:32fa0a5d754c157345561e9a5e1f6fcd274f8f0f94b96f3f605df4aef609cd47",
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

The machine manifest JSON did not change. Its blob remains `873e8daca8aca4a8d797da843060c7ef091d4c03`, and the canonical digest is unchanged.

### Scanner correction and verified coverage

Only the scanner source and `tests/production-change-manifest-dynamic-values.test.mjs` changed in the implementation commit. Source blob: `9dd5efa0659544add4d7c49e9633290a1e348806`; test blob: `bfccd6ed9fbed687b1639a27ecd42451ba42f16a`.

The shell parser conservatively rejects any active, unescaped dollar or backtick character before whitespace can truncate a dynamic expression. This includes command/parameter/arithmetic substitutions and unsupported dollar-prefixed quoting. No expression is executed or evaluated. Single-quoted text and characters already consumed by the escape branch remain literal and subject to the normal length threshold. This intentionally rejects some short active-dollar strings rather than claiming to understand every shell expansion.

The config parser rejects unquoted values beginning with YAML scalar/tag/anchor/alias indicators `|`, `>`, `!`, `&` or `*`, rather than treating a multiline header as the complete token value. This is conservative syntax rejection, not a full YAML parser. Quoted short literal indicators remain ordinary values.

Six new test groups cover all five token keys, nested/quoted/concatenated/multiline substitutions, backticks, shell literal negative controls, ASCII and astral UTF-16 boundaries, continuations, literal/folded YAML scalars with modifiers/comments/quoted keys, YAML tags/anchors/aliases and ordinary short config literals. Existing UTF-16, continuation, Bearer, punctuation and concatenation regressions remain green. Synthetic strings are never configured as production credentials or executed as shell commands.

The validator continues to reject schema-level secrets, nonempty approval sets, blanket approval, incomplete blocker sets, target widening, prerequisite/status/evidence drift, wrong rollback bindings and combined semantic widening. These regression results do not close unrelated contract review findings.

## Remaining independent review work

Two previously reported production-contract P1 findings remain unimplemented by this scanner correction:

- Comment `4103894629`: PROD-12 needs the verified deployment chain, production target facts and deployment gate, with completion proof and corresponding revalidation. Current target/wiring guards alone are insufficient.
- Comment `4103936494`: target writes must be frozen and drained from before final source/target and attachment parity through Switch and read-only post-switch verification. A staging ACL or source quiescence alone does not prevent target-side races. The required ordered fence/drain/parity/switch/success-only-release contract has not been added here.

These remain review blockers even though the current frozen manifest validates. No new freeze capability or deployment-chain implementation is claimed. New findings from subsequent review must also be assessed against the actual current head.

## Exit and final-head evidence rule

This evidence synchronization is docs-only and follows implementation run #99 success. The resulting final PR head must independently pass the unchanged WO-06D workflow. Record that exact final SHA/run in the PR/check record, not self-referentially inside this same commit.

Before any separately authorized merge, require current exact head, successful exact-head workflow, zero unresolved review threads, an independent Codex clean signal for that same head, and OPEN / mergeable / not merged. Only an explicit human merge instruction permits merge, with `expected_head_sha`. CI success alone is insufficient.

WO-06D authority closure and deployment authorization remain separate. `docs/DEPLOYMENT_PREFLIGHT.md` is historical context and cannot override the current WO-06 authority or manifest.

## Historical review evidence boundary

The complete pre-correction document, including every chronological hardening section and its original SHA/run/digest, is preserved byte-for-byte in [the historical cb456114 snapshot](WO-06D_PRODUCTION_CHANGE_MANIFEST.HISTORICAL_cb456114.md). Its Git blob is `1ee7813131fb0170497a06442d015655db29b5a8`, identical to this document at `cb456114e4d57d8ff12473da95737790a63e7118`.

All uses of "current", requestable sets, blocker lists, PASS and execution sequences inside that snapshot apply only to their stated historical revisions. They do not override this current evidence, the current machine manifest or unresolved review findings. Original review comments remain additional provenance.

The inaccessible local-only Codex commit `86f6e0793b06baa2f70c7cccf9e327877801bc4a` is not the source of this implementation and supplies no accepted GitHub CI evidence. This correction was independently authored from the published parent and verified through run #99.
