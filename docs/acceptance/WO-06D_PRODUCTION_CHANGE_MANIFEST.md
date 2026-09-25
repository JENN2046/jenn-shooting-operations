# WO-06D Production Change Manifest + Authorization Packet

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- Branch: `codex/wo-06d-production-change-manifest`
- Current result: `WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / REVIEW_CLOSURE_BLOCKED / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`

## Goal and authority

Freeze exact production actions, targets, prerequisites, evidence, recovery bindings and human authorization without performing production actions. A valid definition is not execution permission, implementation of an external capability or independent review closure.

- Machine authority candidate: `docs/operations/production-change-manifest.v1.json`
- Schema: `contracts/production-change-manifest.v1.schema.json`
- Semantic validator: `src/production-change-manifest-v1.mjs`
- Source admission: `src/production-manifest-json-v1.mjs`
- Decoded-text admission: `src/production-evidence-input-boundary-v1.mjs`
- Shared design: [Production Evidence Input Boundary V1](../operations/PRODUCTION_EVIDENCE_INPUT_BOUNDARY_V1.md)
- Validation command: `npm run validate:production-manifest`

`AUTHORITY_HEAD` remains the only global pre-request check. Host/conflict facts, backup, secret storage, external readiness, rollback scope, build source/base digest and built-image checks stay assigned to the appropriate actions. PROD-01 needs exact candidate-host binding, not results the preflight is responsible for discovering.

## Unchanged authorization semantics

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

No production host access, real credential generation, production migration, deployment, real provider/VCP/Kiosk operation, proxy/TLS/firewall mutation, cutover, release or merge occurred in this input-boundary correction. Synthetic fixtures do not authorize those actions.

## Production blockers and requestability

The five deployment-level blockers remain exactly:

```text
VCP_DEPLOYABLE_ADAPTER_WIRING
KIOSK_DEPLOYABLE_AUTH_WIRING
PRODUCTION_TARGET_FACTS
PRODUCTION_DATA_MIGRATION
PRODUCTION_DEPLOYMENT_GATE
```

Separately, `blockingGateIds` equals every current BLOCKED gate; all 25 entries appear in the fresh machine verdict below. The input-boundary correction changes no manifest/schema, production action/gate, authorization array, dependency or workflow permission.

VCP retains deployable wiring -> separately authorized PROD-10 -> real pull / guarded push / verification pull -> compatibility PASS -> PROD-13. `WO06C_VCP_EXTERNAL` stays BLOCKED, exhaustive and a cutover prerequisite, not a PROD-10 prerequisite or deployment-level blocker. No real compatibility operation was performed. Kiosk retains the equivalent deployable-auth wiring -> PROD-11 -> real-device acceptance -> cutover sequence. Neither post-enable gate is deleted or self-promoted.

No action is requestable. PROD-01 remains bound to `TARGET_HOST_BINDING`. PROD-12 remains `BLOCKED_PREREQUISITE` with `UNRESOLVED_DINGTALK_TARGET_BINDING`; its exact prerequisites remain:

```text
WO06C_DINGTALK_PROVIDER
DINGTALK_TARGET_BINDING
DINGTALK_DEPLOYABLE_ADAPTER_WIRING
PRODUCTION_TARGET_FACTS
INTEGRATION_DEPLOYMENT_READINESS
PRODUCTION_DEPLOYMENT_GATE
```

WO-06C local DingTalk readiness is not deployable wiring or provider authorization. `DEPLOYMENT_CHAIN_COMPLETION_PROOF` remains required before requesting PROD-12 and in action evidence; it proves predecessor deployment completion, not PROD-12's own send. Runtime-adapter configuration, secret/external/rollback checks, wiring proof and exact bounded provider/destination/send evidence remain intact. No integration prerequisite cycle is reintroduced.

`POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` remains a PROD-14 prerequisite, not a sixth deployment-level blocker.

## Retained execution and recovery contract

PROD-09 requires offline/quiescent source state or verified coordination, an absent target SQLite path, prepared isolated storage, target attachment-byte copy capability and source/target manifests plus record/file parity. Import precedes PROD-05 database initialization.

PROD-07 remains staging-only, blocking public unauthenticated writes and limiting any permitted staging writes to exact principals. PROD-13 rechecks that restriction, but it is not a target-wide write fence. Comments `4103936494` / `4104786562` remain separate unimplemented cutover findings.

All destructive orphan cleanup entry points, including startup, periodic timer, `saveUpload` and `submitRequest`, must remain disabled before cutover and be re-proved at PROD-05/07/13. PROD-14 separately owns restoration after cutover completion and protected attachment parity. PROD-10/11 remain `IRREVERSIBLE_OR_EXTERNAL`: disabling configuration does not erase their persisted business facts.

Rollback order remains:

```text
remove new route
-> revert only the newly changed firewall/security-group rule
-> stop and remove the exact new container while preserving its named volume
-> remove the exact PROD-04 image after proving container references are absent
-> revoke role-token runtime bindings introduced by PROD-03
-> disable only VCP configuration introduced by PROD-10
-> disable only Kiosk configuration introduced by PROD-11
-> disable only DingTalk configuration introduced by PROD-12
-> preserve data volume and stop mutation
```

Data-volume deletion is forbidden. Blocked post-Switch authority restoration is not an available recovery capability.

## Unified input admission, not another syntax exception

The five scanner findings are handled by one intentionally narrower contract. The machine manifest stores declarative summaries and exact credential declarations, not environment files, request headers, shell commands, YAML snippets or secret values. The partial shell/config parsers and header length heuristic have been removed.

```text
original UTF-8 bytes
-> duplicate-rejecting JSON source admission
-> strict schema
-> declarative text and exact declaration-path admission
-> frozen semantic bindings
-> valid verdict and stable digest
```

Raw admission reuses the existing pure `parseCallbackJsonRejectingDuplicateKeysV1` unchanged. Its historical callback name introduces no callback/provider dependency. The manifest adapter adds a 1 MiB UTF-8 source limit, fatal byte decoding, fixed low-disclosure failures and no repair. The parser rejects repeated decoded keys in each object before member overwrite, including nested, equal-valued and escaped-equivalent duplicates. Separate objects may reuse the same key. Invalid syntax/encoding/BOM, trailing tokens and nesting beyond 64 fail closed.

The CLI reads schema and manifest once as bytes and sends both through this loader. It never first parses an entire object with native `JSON.parse`, and never hashes a separately reread source. The parsed-object semantic API remains usable but cannot attest to discarded source members; file/text callers must use raw admission first.

Decoded string values and keys admit Unicode letters/marks/numbers, ASCII space and `. , : ; ( ) / + _ -` only. Credential labels are forbidden outside the exact `secrets[index].id` declaration path, index 0 through 3, regardless of case, layout, length or substring placement. Existing strict secret schema and token-shaped checks remain required. The declaration exception cannot authorize sibling values, fake textual paths or a fifth credential declaration.

This closes continued headers, append assignments, plain-YAML backslashes, continued keys and split name/value entries without executing, decoding or inferring a second language. Even empty, short and placeholder credential snippets are rejected. Prior negative controls containing such snippets now assert rejection; independent runtime-authorizer assertions remain preserved. Runtime token acceptance rules are unchanged. Plain nonsecret summaries still pass lexical admission but cannot change frozen authority without semantic rejection.

Boundary failures emit `SECRET_MATERIAL_DETECTED` at `/` before semantic diagnostics or digest. The compatibility code includes unsupported evidence syntax; it does not establish that a real secret exists. Raw failures use `MANIFEST_JSON_DUPLICATE_KEY`, `MANIFEST_JSON_INVALID` or `MANIFEST_JSON_TOO_LARGE`. The CLI suppresses input-derived paths and exceptions, emits a single invalid verdict on stderr, no success/digest, and exits nonzero. Read/compile errors use `MANIFEST_SOURCE_VALIDATION_ERROR`.

## Fresh implementation-bearing evidence

- Exact implementation head: `3f454f9fb41a5a65b6125360783cc804be15adb9`
- Parent: `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13`
- Unified-boundary batch starts after: `36a8a0a3000e8fb750fe60196eddb7a1c97a960c`
- GitHub Actions: run #109 / `36152821332`
- Workflow: `WO-06D Production Authorization Packet`
- Event: `push`; conclusion: `success`
- Verified job: `108130052543`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

The complete job log verifies both checkout SHA and recorded `git rev-parse HEAD`. The unchanged workflow executes the public source loader, schema, text boundary, semantic validator and full repository tests; it is not a local-only task report.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     623
pass                           622
fail                           0
skipped                        1
manifest targeted tests        93
manifest targeted pass         93
manifest targeted fail         0
manifest targeted skipped      0
```

The full-suite skip is the absent external VCP adapter, not external compatibility PASS. Targeted command remains `node --test tests/production-change-manifest*.test.mjs`, with no name filter. The added suites contribute 13 unified-boundary groups and 11 raw-source/CLI groups; retained hostile suites also execute.

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

The manifest blob remains `a80f7a715cac9b3493d2373293bfff18fd83ce57`. The input-policy and source-loader changes do not alter its digest. The older `32fa0a5d...` digest remains historical.

### Source identities and regression evidence

| File | Git blob at the verified implementation |
| --- | --- |
| `src/production-change-manifest-v1.mjs` | `f21f86bc9bac9e08cca00e725cbf7db0c8c93854` |
| `src/production-evidence-input-boundary-v1.mjs` | `4756d357614d7d85ab51f58f0767246f03b4488d` |
| `src/production-manifest-json-v1.mjs` | `f07eeb38da40fb7481129c828c3fa87f254f36e0` |
| `tests/production-change-manifest-input-boundary.test.mjs` | `e163ec2c955d8d6b47d4ee1adb3af8c0c5693408` |
| `tests/production-change-manifest-json-source.test.mjs` | `09e8524a58ad1ca0c11cab4394e5283518a3fb51` |
| Unchanged reused `src/callback-json-v1.mjs` | `c3dacf1aaa9ea76fd3ae49d9a420a35e0eaeb681` |

Unified tests exercise all five scanner classes across gate/action/target/effect surfaces, all role names/cases, length and fragmentation variants, forbidden ASCII/Unicode syntax, real declaration-path isolation, safe vocabulary, immutability and rejection before sensitive diagnostics. Existing short-value controls were migrated explicitly to the narrower contract, not removed to conceal failures.

Raw tests cover duplicate members at every depth, literal/escaped-equivalent names, equal values, duplicate complete gates/secrets/authorization sections, separate object scopes, apparent properties inside strings, 100 generated unique documents, malformed syntax, UTF-8/BOM/depth/size limits and formatting-independent normal digest. The reported exploit is first shown to pass native-parse/object-validation, then rejected by the source loader.

End-to-end tests invoke the real CLI against copied input/script files in temporary directories using actual source modules. They prove hidden duplicates, duplicate schema properties, malformed bytes, missing files and hostile schema-error paths fail without stdout, source echo or digest. The checkout's authority files are never modified. Six pure source groups also passed locally under Node 22.16.0; that limited check is not full acceptance. Run #109 is the authoritative full Node 24.21.0 execution. Synthetic shell/config strings are never executed, and no real credential is used.

## Review disposition and limits

Implementation and regression coverage now address these six input findings as one design: `4104724822`, `4104786571`, `4105069439`, `4105112228`, `4105165136`, and raw-source duplicate finding `4105771369`. Their evidence replies and actual thread resolutions must follow successful final-head CI; this document does not pre-claim those mutations. The intermediate evidence comment `4105672730` is addressed by this synchronization, subject to final-head verification.

Separate cutover comments `4103936494` / `4104786562` remain unimplemented and open. All target database/attachment writers must be fenced and drained through final parity, Switch and read-only verification, with same-fence continuity, machine-enforced ordering, success-only release and fail-closed retention. Pre-request capability/plan checks must not require results of an unauthorized freeze. This batch does not implement that production capability or promote a gate.

The boundary is not a universal detector for unlabelled passwords, arbitrary encodings or covert channels. Lexically valid alphanumeric text can still be sensitive; frozen semantic binding and source-grounded review remain independent controls. No clean-review or zero-unresolved claim follows from CI. Later live findings belong in the PR/thread record, not a perpetually rewritten static count.

## Final-head and merge gate

This docs-only synchronization follows implementation run #109 success. The resulting final PR SHA must independently pass the unchanged workflow. Record that exact SHA/run in PR/check records and review replies rather than self-referentially in this same commit. Only after complete evidence synchronization request one independent exact-final-head review, not one review per syntax example.

Before any separately authorized merge, require unchanged current head, exact-head workflow success, zero unresolved threads, Codex clean for that exact SHA and OPEN / mergeable / not merged. Require explicit human merge instruction and `expected_head_sha`. Nothing here authorizes merge or deployment.

## Historical evidence boundary

The complete pre-unification acceptance remains in Git at `36a8a0a3000e8fb750fe60196eddb7a1c97a960c`, blob `9f8ee65575446e3b3e15e5ceca7b0b27c67975ef`, including all earlier chronological details. The early [HISTORICAL_cb456114 snapshot](WO-06D_PRODUCTION_CHANGE_MANIFEST.HISTORICAL_cb456114.md), blob `1ee7813131fb0170497a06442d015655db29b5a8`, is unchanged. No duplicate snapshot is created.

Retained checkpoints: dynamic values `9f13b160...` / run #99 `36131969264`, docs `0782e22e...` / #100 `36132684480`, 587/586/0/1 and 57/57; multiline/escaped-key/DingTalk `7abad25e...` / #103 `36137024497`, docs `14726a2a...` / #104 `36137791590`, 593/592/0/1 and 63/63; scalar boundaries `61b1695466abeb62402392588ac42626fd08a06c` / #105 `36141921053`, docs `36a8a0a3000e8fb750fe60196eddb7a1c97a960c` / #106 `36142458740`, 599/598/0/1 and 69/69. Their current/PASS wording applies only to those revisions. The former parser's short-value acceptance is superseded, not the runtime authorizer.

The unified implementation was published in `4c2ec4d4a4fef5425f074ad5137a899b0d982195`, with independent runtime-auth assertions preserved by `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13`; raw-source admission is `3f454f9fb41a5a65b6125360783cc804be15adb9`. Run #109 validates their combined final implementation. The inaccessible local-only commit `86f6e0793b06baa2f70c7cccf9e327877801bc4a` remains unaccepted evidence. `docs/DEPLOYMENT_PREFLIGHT.md` is historical context and cannot override current authority.
