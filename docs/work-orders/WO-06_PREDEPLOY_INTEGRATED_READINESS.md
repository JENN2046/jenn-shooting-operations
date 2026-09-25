# WO-06：部署前综合预检

- Authority base: `8d5747439ccdfb29dd78ae294c1df82cba6476a3`
- 状态：`IN_PROGRESS / WO-06A_PREDEPLOY_EVIDENCE_BASELINE_PASS / WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS / WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS / WO-06C_EXTERNAL_VALIDATION_PENDING / WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / REVIEW_CLOSURE_BLOCKED / BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`
- 目标：证明系统是否具备进入“申请部署授权”的条件，不执行部署。
- 硬边界：不接生产 DB、不写真实凭据、不调用真实钉钉/VCP provider、不发布、不切流、不做 Switch。

## WO-06A：PREDEPLOY_EVIDENCE_BASELINE

状态：`WO-06A_PREDEPLOY_EVIDENCE_BASELINE_PASS`

### 目标

建立一份可审计的部署前证据基线，把“已有证据”“需要 fresh rerun”“外部环境阻塞”“后续工作包负责”分开，禁止用历史 PASS、Mock、skip 或口头判断替代当前证据。

### 本批只做

1. 固定 authority lineage 与当前运行环境事实。
2. fresh 执行本地核心门禁：
   - `npm ci`
   - `npm run check`
3. fresh 执行最小容器 baseline：
   - 固定 Node 24.21.0 作为 CI host runtime；
   - Docker image build；
   - 镜像声明非 root；
   - 不使用 `--experimental-sqlite`；
   - 空数据卷启动；
   - `/healthz` 成功；
   - 容器内 uid != 0；
   - 同一数据卷重启后再次健康。
4. 对迁移/备份恢复、VCP、Kiosk、钉钉和生产变更清单建立证据分类，不在 06A 偷跑后续授权门。

### 明确不做

- WO-06B 的 migration / backup / restore / rollback 深验收；
- WO-06C 的 VCP 真实适配器兼容、Kiosk 真机、钉钉真实联调；
- WO-06D 的生产目标、凭据、网络、切流、release 变更执行；
- 真实业务数据、真实 provider、真实 Token、生产环境变量；
- 自动扩大 Agent 权限。

## Evidence classification

| 状态 | 含义 |
| --- | --- |
| `FRESH_PASS` | 当前 authority-derived head 上 fresh 执行并通过 |
| `EVIDENCE_PRESENT` | 仓库存在可审计实现/历史证据，但本批不把它冒充 fresh acceptance |
| `FRESH_RERUN_REQUIRED` | 后续工作包必须 fresh 验证 |
| `EXTERNAL_BLOCKED` | 缺真实外部组件/设备/授权，必须明确阻塞 |
| `NOT_IN_SCOPE` | 当前工作包明确不处理 |

## Initial evidence matrix

This matrix records the original WO-06A baseline, not a fresh container or external-integration run performed by the current WO-06D correction.

| Area | Current evidence at WO-06A | WO-06A classification | Owner |
| --- | --- | --- | --- |
| Contract + full local tests | Run #3: Node 24.21.0, `npm run check`, 530 tests / 529 pass / 0 fail / 1 skip | `FRESH_PASS` | 06A |
| Container build/start | Run #3: locked runtime deps, image build, empty-volume start, `/healthz` | `FRESH_PASS` | 06A |
| Container non-root | Run #3: image user=`node`, container uid != 0 | `FRESH_PASS` | 06A |
| Empty DB startup | Run #3 created `/app/data/shooting-operations.sqlite` and became healthy | `FRESH_PASS` | 06A |
| Same-volume restart | Run #3 removed first container and restarted healthy on same named volume | `FRESH_PASS` | 06A |
| Historical migration | migration v1-v6 code/tests exist | `EVIDENCE_PRESENT / FRESH_RERUN_REQUIRED` | 06B |
| Backup/restore/rollback | recovery code + WAL hardening/tests exist | `EVIDENCE_PRESENT / FRESH_RERUN_REQUIRED` | 06B |
| VCP compatibility | integration test expects external `ShootingPlannerSyncService`; adapter absent in repo | `EXTERNAL_BLOCKED` | 06C |
| Kiosk browser/device | static/browser evidence exists; acceptance says `BROWSER_AND_DEVICE_NOT_RUN` | `EXTERNAL_BLOCKED` for device | 06C |
| DingTalk | local Outbox/Mock boundary `PASS_WITH_LIMITS / LOCAL_ONLY`; real provider not wired | `EXTERNAL_BLOCKED` | 06C |
| Production change manifest | not yet frozen at this initial baseline | `NOT_IN_SCOPE` | 06D |
| Production deployment | explicitly unauthorized | `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE` | separate human gate |

## Stop conditions

立即停止并报告，不得自行越界：

- 需要真实凭据、Token、生产 DB 或生产环境变量；
- 需要真实外部 HTTP/provider、钉钉发送或 VCP 外部运行时；
- 需要真实 Kiosk 设备；
- 需要部署、发布、Switch、切流或 production migration；
- fresh baseline 失败时不得把状态写成 PASS。

## WO-06A exit

只有以下全部成立才可关闭 06A：

- evidence matrix 已冻结；
- fresh `npm run check` PASS；
- container baseline 每项 PASS，或失败被明确记录并修复后重新 fresh PASS；
- 所有外部缺口被正确归类到 06C，而不是伪装为通过；
- diff 经独立 review；
- 仍保持 `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`。

06A PASS 只意味着“部署前证据基线可用”，不代表 WO-06 总体 PASS，更不代表授权部署。

## WO-06B：MIGRATION_BACKUP_RESTORE_ROLLBACK_FRESH_ACCEPTANCE

- Authority base: `b66c6e0377531064b4e1db03dbc2067d4457acf0`
- 状态：`WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS`

### Fresh evidence

The retained WO-06B checkpoint is GitHub Actions run `35976098214` on implementation-bearing head `b10a2ff8fac20d6ba892a5a8bfc3232c4189c73d`, which completed successfully with:

- Ubuntu 24.04 / Linux `6.17.0-1022-azure`;
- Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`;
- full `npm run check`: 530 tests / 529 pass / 0 fail / 1 expected external-VCP skip;
- targeted migration/recovery suite: 126/126 PASS;
- fresh full-chain acceptance: PASS.

The full-chain harness proved:

```text
dry-run                    PASS / switchReadiness=NOT_RUN
isolated apply             APPLIED_VERIFIED
verified backup            BACKUP_VERIFIED
verified rollback restore  ROLLBACK_VERIFIED
target post-verify         ALREADY_APPLIED_VERIFIED
completed replay           ALREADY_APPLIED_VERIFIED
apply/replay switch state  BLOCKED
source bytes               unchanged
completed artifacts        unchanged on replay
```

The target retained zero `production_events` and zero `notification_outbox` rows, so historical migration did not fabricate runtime or notification facts.

### Limits preserved

This PASS applies only to isolated fixture paths under the frozen WO-02D contract. It does not authorize or claim production DB migration, online migration, real upload-volume migration, production backup/restore, Switch/cutover or deployment/release. This WO-06B checkpoint is retained evidence, not a new production recovery run in the current WO-06D scanner correction.

WO-06C owns external readiness. WO-06D owns the production-change definition and authorization packet. The global deployment gate remains blocked.

## WO-06C：VCP_KIOSK_DINGTALK_EXTERNAL_READINESS

- Authority base: `e2a8de4a0f388e3322bd6c14eb223ba04ce2cb64`
- 本地状态：`WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS`
- 外部状态：`WO-06C_EXTERNAL_VALIDATION_PENDING`

### Fresh local evidence

The retained WO-06C checkpoint is GitHub Actions run `35981030282` on implementation-bearing head `775b6072687c53d2135be8d069b650bb37771090`, which completed successfully with:

- Ubuntu 24.04 / Linux `6.17.0-1022-azure`;
- Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`;
- full `npm run check`: 530 tests / 529 pass / 0 fail / 1 expected external-VCP skip;
- Kiosk targeted suite: 118/118 PASS;
- DingTalk/Outbox/Callback targeted suite: 64/64 PASS;
- VCP integration test: skipped because the external adapter is absent;
- local external-boundary harness: PASS.

```text
WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS
VCP_EXTERNAL_COMPATIBILITY = BLOCKED_EXTERNAL_RUNTIME
KIOSK_REAL_DEVICE = BLOCKED_DEVICE
DINGTALK_PROVIDER = READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION
WO-06C_EXTERNAL_VALIDATION = PENDING
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

### Boundary facts

VCP has only the integration consumer/test in the repository; external `ShootingPlannerSyncService` is absent. No real compatibility PASS is claimed.

Kiosk static `/kiosk` serves locally. The default runtime fails closed with `AUTH_NOT_CONFIGURED`; explicit trusted-principal injection reaches only the empty-resource read path. Real tablet/browser acceptance remains unexecuted.

DingTalk's unconfigured adapter returns `DINGTALK_NOT_CONFIGURED`; the local harness proves zero provider calls. Callback runtime remains `NOT_WIRED`. Local Outbox/card/dispatcher/worker/callback boundaries are readiness evidence only.

### External closure still required

WO-06C remains open until required external evidence is recorded:

1. VCP real adapter pull → guarded push → verification pull;
2. real Kiosk browser/device acceptance against the frozen WO-03 checklist;
3. if separately authorized, bounded DingTalk integration evidence without widened callback/domain authority.

No VCP runtime access, device operation, credential/provider call, public callback endpoint, production identity mapping, deployment or cutover is authorized by local PASS. No new external acceptance run occurred in this correction.

## WO-06D：PRODUCTION_CHANGE_MANIFEST_AND_AUTHORIZATION_PACKET

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- 状态：`WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / REVIEW_CLOSURE_BLOCKED / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Authority candidate: `docs/operations/production-change-manifest.v1.json`
- Acceptance: [WO-06D current acceptance](../acceptance/WO-06D_PRODUCTION_CHANGE_MANIFEST.md)
- Shared input contract: [Production Evidence Input Boundary V1](../operations/PRODUCTION_EVIDENCE_INPUT_BOUNDARY_V1.md)

The manifest freezes unresolved production targets, four secret classes without values, exact action IDs/targets, prerequisites, risk/effects, evidence and source-scoped rollback. Input admission and definition validation are not production authorization, implemented external capabilities or independent review closure.

### Unchanged authorization semantics

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

`AUTHORITY_HEAD` remains the only global pre-request check. Host/conflict facts apply after PROD-01; build source/base digest applies at PROD-04; built-image checks apply downstream. Backup, secret, external and rollback checks remain action-specific. PROD-12 retains prior `DEPLOYMENT_CHAIN_COMPLETION_PROOF`. This correction changes no production action, gate or authorization rule.

### Current production blockers

The five deployment-level blockers remain exactly:

```text
VCP_DEPLOYABLE_ADAPTER_WIRING
KIOSK_DEPLOYABLE_AUTH_WIRING
PRODUCTION_TARGET_FACTS
PRODUCTION_DATA_MIGRATION
PRODUCTION_DEPLOYMENT_GATE
```

Exhaustive `blockingGateIds` separately contains all 25 BLOCKED gates, reproduced below. `POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` belongs to PROD-14, not the deployment subset. No gate is promoted, deleted or newly added.

VCP retains wiring -> separately authorized PROD-10 -> real pull / guarded push / verification pull -> compatibility PASS -> cutover. `WO06C_VCP_EXTERNAL` stays blocked, exhaustive and required by PROD-13; it is not a deployment-level blocker or a prerequisite of its own producing action. Kiosk retains deployable authentication -> PROD-11 -> real-device acceptance -> cutover. No real compatibility operation was executed.

No action is requested, approved or requestable. PROD-01 requires exact `TARGET_HOST_BINDING`, not its own discovered facts. PROD-12 keeps `UNRESOLVED_DINGTALK_TARGET_BINDING` and `BLOCKED_PREREQUISITE`. Its exact prerequisites remain `WO06C_DINGTALK_PROVIDER`, `DINGTALK_TARGET_BINDING`, `DINGTALK_DEPLOYABLE_ADAPTER_WIRING`, `PRODUCTION_TARGET_FACTS`, `INTEGRATION_DEPLOYMENT_READINESS` and `PRODUCTION_DEPLOYMENT_GATE`. Deployment-chain proof is required before request and as evidence, not a prerequisite requiring PROD-12's own send. Existing runtime/secret/external/rollback and bounded provider/wiring/destination/send checks remain intact.

### Retained execution and recovery

PROD-09 requires offline/quiescent source state or verified coordination, absent target SQLite, prepared isolated storage, attachment-byte copy capability and source/target manifests plus record/file parity. Import precedes PROD-05 startup.

PROD-07 remains staging-only; limited staging writes are not a target-wide fence. PROD-13's target-side race remains unimplemented in comments `4103936494` / `4104786562`. All destructive orphan-cleanup entries, including startup, timer, `saveUpload` and `submitRequest`, remain disabled through cutover and are re-proved at PROD-05/07/13. PROD-14 owns separate post-cutover restoration after protected parity.

PROD-10/11 remain irreversible/external. Rollback removes the exact new route and changed firewall rule, stops/removes the exact new container before its unused exact image, revokes introduced token bindings, disables only origin-scoped integration configurations, and preserves named data. Volume deletion remains forbidden. Blocked post-Switch authority recovery is not available capability.

### One input boundary for all scanner findings and raw-source duplicates

The machine manifest admits declarative summaries and exact credential declarations only, not shell/config/header snippets or credential values. Partial shell/YAML parsing and header length guessing are removed. See the shared design for the complete admission matrix and rationale.

```text
original UTF-8 bytes
-> duplicate-rejecting JSON source admission
-> strict schema
-> declarative text and exact declaration-path admission
-> frozen semantic contract
-> valid verdict and stable digest
```

`src/production-manifest-json-v1.mjs` reuses the existing pure callback JSON parser unchanged, with no callback/provider behavior. Original source is limited to 1 MiB, decoded fatally, and not normalized or repaired. Repeated decoded keys are rejected per object before overwriting, including nested, equal-valued and escaped-equivalent keys. Separate objects may reuse names. Invalid syntax, UTF-8/BOM, trailing tokens and excess depth fail closed.

The CLI reads schema and manifest once as bytes and uses the raw loader for both. It does not run whole-object native `JSON.parse` first or hash a reread file. Lower-level parsed-object validation does not prove source integrity; file/text callers must enter through raw admission.

`src/production-evidence-input-boundary-v1.mjs` admits only Unicode letters/marks/numbers, ASCII space and `. , : ; ( ) / + _ -` in decoded strings and keys. Reserved credential labels are forbidden outside exact `secrets[index].id`, indices 0 through 3, regardless of value length or layout. Existing strict secret schema prevents extra value fields. Quoting, backslashes, equals signs, controls, non-ASCII whitespace and line breaks are rejected rather than decoded or joined.

All five reported classes therefore share one boundary: continued header, append assignment, plain-scalar backslash, continued key and split name/value. Short/empty/placeholder credential snippets are intentionally rejected too. Existing negative controls were migrated to this stricter policy, with independent runtime-authorizer assertions retained. No server token rule changes and no new YAML/shell dependency are involved.

For schema-valid text rejection, `SECRET_MATERIAL_DETECTED` appears only at `/`, before semantic diagnostics or digest. It also represents unsupported syntax, not proof of a real secret. Raw failures use fixed `MANIFEST_JSON_DUPLICATE_KEY`, `MANIFEST_JSON_INVALID` or `MANIFEST_JSON_TOO_LARGE`. The CLI reduces all errors to fixed root paths, suppresses source/exception details, produces no stdout/digest on rejection and exits nonzero. I/O/compile failure is `MANIFEST_SOURCE_VALIDATION_ERROR`.

### WO-06D fresh implementation-bearing evidence

- Exact head: `3f454f9fb41a5a65b6125360783cc804be15adb9`
- Parent: `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13`
- Batch starting checkpoint: `36a8a0a3000e8fb750fe60196eddb7a1c97a960c`
- GitHub Actions run #109: `36152821332`
- Workflow: `WO-06D Production Authorization Packet`; event `push`; conclusion `success`
- Verified job: `108130052543`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

Both checkout and recorded `git rev-parse HEAD` match the exact implementation. The complete job log was inspected. This is published GitHub execution of the full repository, not a local task report.

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

The sole skip is the absent external VCP adapter, not external acceptance. The unchanged targeted command is `node --test tests/production-change-manifest*.test.mjs`; no test-name filter or new skip was introduced. Thirteen unified-boundary groups and eleven raw-source/CLI groups join the retained hostile suites.

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

Manifest blob remains `a80f7a715cac9b3493d2373293bfff18fd83ce57`. No source-policy change alters its current digest. The old `32fa0a5d...` digest is historical.

### Verified source and coverage

Current semantic validator blob: `f21f86bc9bac9e08cca00e725cbf7db0c8c93854`; unified boundary: `f16fb7ed2473a416d32bc6737ffe658e5cac8694`; raw adapter: `f07eeb38da40fb7481129c828c3fa87f254f36e0`; unified tests: `e163ec2c955d8d6b47d4ee1adb3af8c0c5693408`; raw tests: `09e8524a58ad1ca0c11cab4394e5283518a3fb51`. Reused parser `src/callback-json-v1.mjs` is unchanged at `c3dacf1aaa9ea76fd3ae49d9a420a35e0eaeb681`.

Boundary tests cover five problem classes across four evidence surfaces, all credential names/cases, fragmentation/layout/length variants, forbidden characters, declaration-path isolation, safe summary vocabulary, no mutation and no sensitive diagnostic echo. Historical hostile samples remain. Former short-literal negatives now require rejection under the documented narrower input contract; runtime-authorizer assertions remain independent.

Raw tests reject hidden earlier evidence, complete gates/secrets/authorization duplicates and equal-valued repeats, including decoded-equivalent keys. They cover independent object scopes, apparent properties inside strings, 100 generated unique documents, syntax/encoding/BOM/depth/size and unchanged-format digest. The exact exploit is demonstrated on the old native-parse path and rejected on the new loader.

Real CLI tests run copied script/input files in temporary layouts using actual source modules. They verify duplicate manifest/schema keys, malformed bytes, missing input and hostile schema-error paths produce nonzero exit, no stdout, source echo or digest. Normal input retains the non-authorizing verdict. Checkout authority files are not changed. Six pure-source groups additionally passed locally under Node22.16.0; that is not the complete acceptance, which is run #109 on Node24.21.0. No supplied shell/config text is executed and no real secret or provider is used.

### Remaining review and final-head gate

This batch implements and tests the five scanner findings `4104724822`, `4104786571`, `4105069439`, `4105112228`, `4105165136` plus duplicate-source P1 `4105771369` under one design. Their exact reply/resolve operations must follow final-head success; this file does not pre-claim them. Intermediate evidence P2 `4105672730` is covered by this synchronization, subject to final-head verification.

Target-fence P1 comments `4103936494` / `4104786562` remain unimplemented and open. They require every target database/attachment writer to be frozen/drained through final parity, Switch and read-only checks, with same-fence continuity, enforced ordering, success-only release and fail-closed retention. Pre-request capability/plan is distinct from outputs of an authorized freeze. This input batch does not provide that capability or authorize it.

The boundary is not universal detection of unlabelled secrets or arbitrary/covert encodings. Frozen semantic binding and source-grounded review still matter. CI success does not imply zero unresolved threads or independent clean review; subsequent live findings stay in the PR/thread record.

This docs-only synchronization follows run #109 success. Its resulting exact SHA must independently pass the unchanged workflow. Record final SHA/run in the PR/check record, not self-referentially here. Request one independent final-head review after the batch is complete, not one per example. Merge still requires explicit human instruction, unchanged exact head, exact-head CI success, zero unresolved threads, current-head Codex clean, OPEN / mergeable / not merged and `expected_head_sha`. No merge or production operation is authorized.

### Historical evidence boundary

The complete preceding work order remains at `36a8a0a3000e8fb750fe60196eddb7a1c97a960c`, blob `e87946c85c3da462fcc45166773a2a77fdc4eccb`, including all earlier chronological detail. The early [HISTORICAL_cb456114 snapshot](WO-06_PREDEPLOY_INTEGRATED_READINESS.HISTORICAL_cb456114.md), blob `0bf6b062b68ff4c0f2953ad18b3b4cc9282d4490`, is unchanged. WO-06A/B/C above are retained checkpoints, not newly performed external/container acceptance. No duplicate snapshot is created.

Retained WO-06D checkpoints: dynamic values `9f13b160...` / #99 `36131969264`, docs `0782e22e...` / #100 `36132684480`, 587/586/0/1 and 57/57; multiline/escaped-key/DingTalk `7abad25e...` / #103 `36137024497`, docs `14726a2a...` / #104 `36137791590`, 593/592/0/1 and 63/63; scalar boundaries `61b1695466abeb62402392588ac42626fd08a06c` / #105 `36141921053`, docs `36a8a0a3000e8fb750fe60196eddb7a1c97a960c` / #106 `36142458740`, 599/598/0/1 and 69/69. Full prior failure/correction provenance remains in the referenced Git revision. Historical current/PASS/short-value-acceptance wording is not the new input policy.

The unified change is `16bc1a8ce94a53003bb12881d24b8ae9a57b630f`, followed by boundary/authority assertion separation at `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13` and raw-source admission at `3f454f9fb41a5a65b6125360783cc804be15adb9`. These parent links are verified from Git commit objects. Run #109 validates the combined implementation. The inaccessible local-only `86f6e0793b06baa2f70c7cccf9e327877801bc4a` is not publication/CI evidence. `docs/DEPLOYMENT_PREFLIGHT.md` cannot override current authority.
