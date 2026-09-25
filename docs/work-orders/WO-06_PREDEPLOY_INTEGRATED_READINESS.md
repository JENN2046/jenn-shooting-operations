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

The manifest freezes unresolved production target facts, four secret classes without values, prerequisite gates, exact action IDs/targets, risk/side effects, evidence, rollback bindings and an embedded exact-action human authorization packet. A valid definition is not a completed independent review or an implemented deployment capability.

### Authorization semantics

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

`AUTHORITY_HEAD` remains the only global pre-request check. Host/conflict facts apply after PROD-01; build source/base digest applies at PROD-04; built-image checks apply downstream. Backup, secret, external and rollback checks remain action-specific. This correction additionally requires prior `DEPLOYMENT_CHAIN_COMPLETION_PROOF` in PROD-12's exact pre-request checklist.

### Current blockers and requestability

The five deployment-level blockers remain exactly:

```text
VCP_DEPLOYABLE_ADAPTER_WIRING
KIOSK_DEPLOYABLE_AUTH_WIRING
PRODUCTION_TARGET_FACTS
PRODUCTION_DATA_MIGRATION
PRODUCTION_DEPLOYMENT_GATE
```

`WO06C_VCP_EXTERNAL` remains blocked post-enable compatibility, not a deployment-level blocker or PROD-10 prerequisite. Deployable wiring precedes separately authorized enablement and real pull / guarded push / verification pull; compatibility PASS is required before PROD-13. The real operation has not run. Kiosk retains the analogous deployable-auth-wiring → PROD-11 → real-device acceptance → cutover sequence.

`blockingGateIds` is separately exhaustive across every current BLOCKED gate: all 25 entries are reproduced in the machine verdict below. `POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` belongs to PROD-14, not the five deployment-level blockers. No gate status is promoted and no new capability gate is added in this correction.

No action is requestable, requested or approved. PROD-01 remains gated by exact `TARGET_HOST_BINDING`, not the target facts it must discover.

PROD-12 keeps `UNRESOLVED_DINGTALK_TARGET_BINDING` and `BLOCKED_PREREQUISITE`. Its exact prerequisite set now contains `WO06C_DINGTALK_PROVIDER`, `DINGTALK_TARGET_BINDING`, `DINGTALK_DEPLOYABLE_ADAPTER_WIRING`, `PRODUCTION_TARGET_FACTS`, `INTEGRATION_DEPLOYMENT_READINESS`, and `PRODUCTION_DEPLOYMENT_GATE`. `DEPLOYMENT_CHAIN_COMPLETION_PROOF` is required both in pre-request revalidation and action evidence; it proves predecessor deployment completion, not PROD-12's own send. Existing runtime/secret/external/rollback checks and bounded provider/destination/wiring/send evidence remain intact. Local provider readiness cannot bypass the deployment chain. No provider was configured or called.

### Retained execution and recovery contract

PROD-09 requires offline/quiescent source state or verified coordination, an absent target SQLite path, isolated storage, target attachment-byte copy capability and source/target manifest plus record/file parity. Import precedes PROD-05 container initialization.

PROD-07 is staging-only: public unauthenticated writes are blocked or write access is limited to exact bounded staging principals. PROD-13 revalidates this restriction, but that is not a target-wide write freeze. Comment `4103936494` remains unimplemented and blocks review closure.

All destructive orphan-cleanup entry points (startup, periodic timer, `saveUpload`, `submitRequest`) must remain disabled through cutover and be re-proved at PROD-05/07/13. PROD-14 separately restores cleanup after cutover completion and protected attachment parity.

PROD-10/11 remain `IRREVERSIBLE_OR_EXTERNAL`; disabling configuration does not remove persisted VCP/Kiosk business facts. Rollback removes the exact new route and changed firewall rule, stops and removes the exact new container before removing its exact built image, revokes introduced role-token bindings, disables only origin-scoped integration configurations, and preserves the named data volume. Data-volume deletion is forbidden. Blocked post-Switch authority recovery is not an available capability.

### WO-06D fresh implementation-bearing evidence

- Head: `7abad25e55ea459cb38f8e5b8b92d8d870307199`
- Parent: `3f6fca1713e96b24e3533d7139d0fd7965855a69`
- Correction starting head: `0782e22eb361325a4038b1158329cc21d2a4d1bf`
- GitHub Actions run: `36137024497` (run #103)
- Workflow: `WO-06D Production Authorization Packet`; event `push`; conclusion `success`
- Verified job: `108077434515`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

The checkout and recorded `git rev-parse HEAD` both match the implementation SHA. This is published exact-head GitHub evidence, not a local-only task report.

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

The full-suite skip is the absent external VCP adapter and is not external acceptance. The targeted command is `node --test tests/production-change-manifest*.test.mjs`, including Unicode, shell-continuation, dynamic-values and review-closure regression files.

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

The machine manifest changed only for the DingTalk prerequisite/completion-proof binding. Its current blob is `a80f7a715cac9b3493d2373293bfff18fd83ce57`; the old `32fa0a5d...` digest is historical and no longer verifies the current manifest.

### WO-06D current scanner and regression correction

The shell parser retains rejection of active unescaped dollar/backtick syntax before top-level whitespace can truncate a dynamic value. It does not evaluate shell input. Short single-quoted or escaped literal forms preserve literal length; long literals still trigger the UTF-16 credential threshold. Existing shell concatenation and continuation handling remains intact.

The config parser retains conservative rejection of unquoted YAML scalar/tag/anchor/alias prefixes `|`, `>`, `!`, `&`, `*`. The new correction additionally rejects remaining multiline colon-assignment snippets, covering plain/quoted YAML continuation, LF/CRLF/CR and values starting on the next line. The delimiter matcher no longer consumes that line break. A terminal newline remains harmless. Ambiguous multi-entry snippets are intentionally rejected instead of attempting YAML indentation/folding/scope evaluation.

Quoted assignment keys containing backslash escapes or physical line breaks are now rejected before literal role-name matching. This conservatively rejects unsupported encoded-key syntax, including a token key concealed with a single Unicode escape; it does not claim to be a complete JSON/YAML decoder.

Six new groups in `production-change-manifest-review-closure.test.mjs` test the two scanner fixes across all five token keys, literal-negative controls, every key-character Unicode escape plus fully escaped keys, YAML x/U forms, UTF-16 boundaries, retained continuations/dynamic syntax rejection, removal of DingTalk gates/completion proof, and non-authorizing state. All 63 targeted groups pass. Tests do not execute synthetic shell snippets or use production credentials.

Current source blob: `65831991116280d657f8ad47e0f25b6265cba271`; new review-closure test blob: `f857cd9d18af49d008c2b6e83786fa8d9e37c7e0`; aligned main-test blob: `1009bc032f8b3210768800b616f228f277c7b052`.

The first published implementation `3f6fca1713e96b24e3533d7139d0fd7965855a69` failed run `36135791873` on one old exact-array assertion omitting PROD-12's newly required pre-request completion proof. Its six new test groups passed. The next commit `7abad25e55ea459cb38f8e5b8b92d8d870307199` changes only that expected array; no scanner guard, production prerequisite, workflow or test was removed or weakened. Exact-head run #103 then passed fully.

### Remaining implementation and review work

Comment `4103936494` remains unimplemented: require target-wide writer freeze/drain spanning final parity through Switch and read-only post-switch checks, same-fence verification, success-only release and fail-closed retention. The execution order must be machine-enforced, not compared as a set. Current staging access restrictions/source checks do not close the target-side race. A future correction must distinguish pre-request deployable capability and exact plan from freeze/parity results produced inside authorized execution; this packet grants no such execution.

The two new scanner comments `4104348023` / `4104348028` and the DingTalk deployment-chain comment `4103894629` are addressed at implementation level by the current published correction and regressions. Their actual review-thread closure and any subsequent independent findings must still be checked against the exact final head. No clean review or merge readiness is claimed by this evidence update.

This docs-only synchronization follows implementation run #103 success. Its resulting final SHA requires its own successful exact-head workflow; final SHA/run belong in the PR/check record to avoid self-reference. Before any separately requested merge require unchanged exact head, successful exact-head CI, zero unresolved threads, Codex clean for that SHA, OPEN / mergeable / not merged, and explicit human merge instruction. Use `expected_head_sha`; no merge is requested here.

### WO-06D historical review evidence boundary

The entire prior work order, including full WO-06A/B/C details, every chronological WO-06D hardening section and the original SHA/run/digest trail, is preserved byte-for-byte in [the historical cb456114 snapshot](WO-06_PREDEPLOY_INTEGRATED_READINESS.HISTORICAL_cb456114.md). Its Git blob is `0bf6b062b68ff4c0f2953ad18b3b4cc9282d4490`, identical to the pre-correction file at `cb456114e4d57d8ff12473da95737790a63e7118`.

The later published dynamic-values scanner checkpoint was implementation `9f13b160bb43d3db37f30fc03bc42c635d0e181f`, run #99 `36131969264`, followed by docs head `0782e22eb361325a4038b1158329cc21d2a4d1bf`, run #100 `36132684480`. Historical counts were 587/586/0/1 full and 57/57 targeted; digest was `sha256:32fa0a5d754c157345561e9a5e1f6fcd274f8f0f94b96f3f605df4aef609cd47`. Those snapshots and prior source/test blobs `9dd5efa0659544add4d7c49e9633290a1e348806` / `bfccd6ed9fbed687b1639a27ecd42451ba42f16a` do not override fresh run #103 evidence.

Historical uses of "current", requestable sets, blockers and PASS apply only to their stated revisions and cannot override this current summary, actual branch checks or machine manifest. The prior acceptance snapshot is linked from the current WO-06D acceptance document. `docs/DEPLOYMENT_PREFLIGHT.md` remains historical, not authorization authority.

The inaccessible local-only Codex commit `86f6e0793b06baa2f70c7cccf9e327877801bc4a` supplies no accepted publication or GitHub CI evidence. The current correction was independently authored from the published `0782e22...` parent; it does not claim to recover that missing artifact.
