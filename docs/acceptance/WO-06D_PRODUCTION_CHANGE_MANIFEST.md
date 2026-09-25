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

This five-gate subset is emitted as `deploymentBlockingGateIds`. Separately, `blockingGateIds` must equal every gate currently marked `BLOCKED`; all 25 current entries are reproduced in the machine verdict below. The scalar-boundary correction changes no manifest, action, gate, authorization array, workflow or runtime dependency.

`WO06C_VCP_EXTERNAL` is blocked post-enable compatibility, not a deployment-level blocker or PROD-10 prerequisite. The sequence remains deployable VCP wiring → separately authorized PROD-10 → real pull / guarded push / verification pull → compatibility PASS → PROD-13 cutover. No such real operation has run. The gate remains exhaustive and a cutover prerequisite.

Kiosk follows the analogous sequence: `KIOSK_DEPLOYABLE_AUTH_WIRING` precedes PROD-11; real-device acceptance can close `WO06C_KIOSK_DEVICE` afterward, before cutover. Neither compatibility gate is deleted or self-promoted.

WO-06C local DingTalk readiness remains `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`, but exact app/provider/destination binding and deployable adapter/credential/runtime wiring remain blocked. PROD-12 also requires `PRODUCTION_TARGET_FACTS`, `INTEGRATION_DEPLOYMENT_READINESS` and `PRODUCTION_DEPLOYMENT_GATE`. Local provider readiness cannot bypass the production deployment chain.

`POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` is a PROD-14 prerequisite, not a sixth deployment-level blocker.

## Requestable actions

No action definition is currently requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` remains blocked by `TARGET_HOST_BINDING`, not `PRODUCTION_TARGET_FACTS`. One exact candidate host must first be structurally bound; a separately authorized preflight may then verify that identity and discover disk/port/container/proxy/TLS facts.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains `BLOCKED_PREREQUISITE`, with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING`. Its exact prerequisites remain:

```text
WO06C_DINGTALK_PROVIDER
DINGTALK_TARGET_BINDING
DINGTALK_DEPLOYABLE_ADAPTER_WIRING
PRODUCTION_TARGET_FACTS
INTEGRATION_DEPLOYMENT_READINESS
PRODUCTION_DEPLOYMENT_GATE
```

`DEPLOYMENT_CHAIN_COMPLETION_PROOF` is required both before requesting PROD-12 and in its completion evidence. It refers to the preceding deployment actions, not PROD-12's own send result. The existing secret-storage, runtime-adapter, external-readiness and rollback revalidation remains required. `DINGTALK_RUNTIME_WIRING_PROOF`, exact provider/destination scope and `SEND_RESULT` remain action evidence. No post-send result is a prerequisite for its own action, and no VCP/Kiosk pre-enable acceptance cycle is restored.

## Retained execution and recovery boundaries

PROD-09 still requires offline/quiescent source state or verified coordination, an absent target SQLite path, isolated storage and verified attachment-byte copying with source/target manifest and record/file parity. Import must complete before PROD-05 can initialize its runtime database.

PROD-07 remains staging-only: public unauthenticated writes are blocked, with any allowed staging writes limited to exact bounded principals. PROD-13 rechecks that restriction. This is not a target-wide write freeze; the separate target-side race in comments `4103936494` and `4104786562` remains open and unimplemented.

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

- Head: `61b1695466abeb62402392588ac42626fd08a06c`
- Parent and correction starting head: `14726a2a1dac20c4c8b5496b0ae5527e23f28ae3`
- GitHub Actions run: `36141921053` (run #105)
- Workflow: `WO-06D Production Authorization Packet`
- Event: `push`
- Conclusion: `success`
- Verified job: `108093583730`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

The workflow checkout and recorded `git rev-parse HEAD` both identify the implementation SHA above. The complete job log includes the six new scalar-boundary tests in both the full and targeted runs. This is published exact-head GitHub evidence, not a local Codex task report.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     599
pass                           598
fail                           0
skipped                        1
manifest targeted tests        69
manifest targeted pass         69
manifest targeted fail         0
manifest targeted skipped      0
```

The single full-suite skip is the absent external VCP adapter; it is not compatibility PASS. The targeted command is `node --test tests/production-change-manifest*.test.mjs`, including Unicode, shell-continuation, dynamic-values, review-closure and scalar-boundaries regression files.

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

The manifest and its Git blob `a80f7a715cac9b3493d2373293bfff18fd83ce57` are unchanged from `14726a2...`. The old `32fa0a5d...` digest remains historical and does not verify this revision.

### Scalar-boundary correction and verified coverage

The implementation changes exactly two files: scanner source (18 added / 4 removed lines) and the new 136-line `tests/production-change-manifest-scalar-boundaries.test.mjs`. No existing test is removed or altered.

1. Inside a YAML single-quoted scalar, two consecutive apostrophes count as one literal character. The parser consumes both while remaining in single-quote state. This rule is restricted to colon/config parsing; adjacent shell quoted segments retain their different semantics. The reported six letters plus ten escaped apostrophes now measure 16 UTF-16 units and trigger `SECRET_MATERIAL_DETECTED`.
2. The shell parser no longer uses JavaScript's broad whitespace class to terminate an unquoted value. Space, tab and unescaped LF retain their boundary behavior; NBSP, CR, VT, FF and the other tested Unicode whitespace are counted as literal word content. The assignment matcher also stops consuming non-ASCII whitespace after `=`, so a leading NBSP cannot disappear before value sizing. Existing quoted/escaped characters and backslash-LF continuation retain their handling. Conservative handling of other syntax is not a claim of full shell evaluation.

Six new regression groups cover all five recognized token names, quoted/case-varied YAML keys, 9/10/11 doubled-quote pairs, leading/trailing/repeated/all-apostrophe scalars, literal backslashes, astral Unicode and 15/16-unit boundaries, explicit YAML-versus-shell distinction, 14 literal-whitespace characters in leading/middle/trailing positions at 15/16/17 units, genuine ASCII separators, quoted/escaped whitespace, continuations and prior unsupported-syntax rejection. Values are checked against the actual in-memory `createAuthorizer`; no shell snippet or provider call is executed.

Before publication, isolated local scanner tests reproduced five failures in the six new groups against the exact old source and passed all six against the patch. That local extraction was not a full repository acceptance; run #105 is the complete public-validator/schema/manifest and repository verification.

Current source blob: `5e76483c24acd5a78a1b38afa498dc7b372f6114`; new scalar-boundaries test blob: `2f66863754bbfde9b8497eb1e6f2a4ff606fd915`. The original source was verified byte-for-byte against blob `65831991116280d657f8ad47e0f25b6265cba271` before editing.

The prior multiline/escaped-key, command-substitution, block-scalar, UTF-16, continuation and DingTalk prerequisite regressions remain green. Unsupported dynamic shell and YAML syntax is still rejected without evaluation. The validator continues to reject schema-level secrets, nonempty approval sets, blanket approval, incomplete blocker sets, target widening, prerequisite/status/evidence drift, wrong rollback bindings and combined semantic widening.

## Remaining independent review work

The two P2 problem types are addressed at the implementation level: YAML comments `4104553788` / `4104786582` and shell-separator comments `4104553803` / `4104786593`. Their four exact review threads require evidence replies and resolution after final-head verification; this document does not pre-claim those writes.

Separate P1s remain unimplemented:

- `4103936494` / `4104786562`: target-wide writer freeze/drain must span final parity through Switch and read-only verification. Include database and attachment writers, same-fence continuity, machine-enforced ordering, success-only release and fail-closed retention. Pre-request capability/plan checks must not require outputs of an unauthorized freeze.
- `4104724822`: continued Bearer header text can be truncated at a physical newline. This is the backslash-newline continuation finding, not a leading-whitespace finding; the earlier PR description of it was inaccurate.
- `4104786571`: shell `+=` token assignments are not matched. This separate syntax case is not fixed by whitespace counting.

This is three remaining P1 problem types represented by four already-observed threads, not a zero-unresolved or clean-review claim. Subsequent live findings must also be assessed. CI success does not close unrelated review findings.

## Exit and final-head evidence rule

This evidence synchronization is docs-only and follows implementation run #105 success. The resulting final PR head must independently pass the unchanged WO-06D workflow. Record that exact final SHA/run in the PR/check record, not self-referentially inside this same commit.

Before any separately authorized merge, require current exact head, successful exact-head workflow, zero unresolved review threads, an independent Codex clean signal for that same head, and OPEN / mergeable / not merged. Only an explicit human merge instruction permits merge, with `expected_head_sha`. CI success alone is insufficient.

WO-06D authority closure and deployment authorization remain separate. `docs/DEPLOYMENT_PREFLIGHT.md` is historical context and cannot override the current WO-06 authority or manifest.

## Historical review evidence boundary

The complete early document, including chronological hardening sections and original SHA/run/digest evidence, remains byte-for-byte in [the historical cb456114 snapshot](WO-06D_PRODUCTION_CHANGE_MANIFEST.HISTORICAL_cb456114.md), blob `1ee7813131fb0170497a06442d015655db29b5a8`.

The dynamic-values checkpoint was implementation `9f13b160bb43d3db37f30fc03bc42c635d0e181f`, run #99 `36131969264`, followed by docs head `0782e22eb361325a4038b1158329cc21d2a4d1bf`, run #100 `36132684480`: 587/586/0/1 full tests, 57/57 targeted, digest `sha256:32fa0a5d754c157345561e9a5e1f6fcd274f8f0f94b96f3f605df4aef609cd47`, source/test blobs `9dd5efa0659544add4d7c49e9633290a1e348806` / `bfccd6ed9fbed687b1639a27ecd42451ba42f16a`.

The next checkpoint was implementation `7abad25e55ea459cb38f8e5b8b92d8d870307199`, run #103 `36137024497`, followed by docs head `14726a2a1dac20c4c8b5496b0ae5527e23f28ae3`, run #104 `36137791590`: 593/592/0/1 full tests and 63/63 targeted, with the same `029f63f5...` manifest digest used now. That correction added multiline and escaped-key rejection and DingTalk deployment prerequisites. Its initial commit `3f6fca1713e96b24e3533d7139d0fd7965855a69` failed run `36135791873` on one old exact-array assertion omitting the new PROD-12 proof; `7abad25...` changed only that assertion. Source/review-test/main-test blobs were `65831991116280d657f8ad47e0f25b6265cba271` / `f857cd9d18af49d008c2b6e83786fa8d9e37c7e0` / `1009bc032f8b3210768800b616f228f277c7b052`. The complete preceding acceptance remains in Git at `14726a2...`, blob `995122ec13627c983f9a6b57393587f97be7f7d2`; no additional duplicate snapshot is needed.

Historical uses of current, requestable sets, blockers and PASS apply only to their stated revisions and do not override run #105, current machine authority or live review state. Original comments and Git history retain provenance. The inaccessible local-only commit `86f6e0793b06baa2f70c7cccf9e327877801bc4a` supplies no accepted publication or CI evidence; this correction starts from the published `14726a2...` parent and does not claim to recover that artifact.
