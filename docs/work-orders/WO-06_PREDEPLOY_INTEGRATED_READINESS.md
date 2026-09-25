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

`AUTHORITY_HEAD` remains the only global pre-request check. Host/conflict facts apply after PROD-01; build source/base digest applies at PROD-04; built-image checks apply downstream. Backup, secret, external and rollback checks remain action-specific. The scanner correction changes none of those definitions.

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

`blockingGateIds` is separately exhaustive across every current BLOCKED gate: all 25 entries are reproduced in the machine verdict below. `POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` belongs to PROD-14, not the five deployment-level blockers.

No action is requestable, requested or approved. PROD-01 remains gated by exact `TARGET_HOST_BINDING`, not the target facts it must discover. PROD-12 still has unresolved exact DingTalk target binding and deployable wiring, with runtime configuration/wiring evidence required. Local provider readiness does not make it requestable; its missing deployment-chain prerequisite contract remains an open P1.

### Retained execution and recovery contract

PROD-09 requires offline/quiescent source state or verified coordination, an absent target SQLite path, isolated storage, target attachment-byte copy capability and source/target manifest plus record/file parity. Import precedes PROD-05 container initialization.

PROD-07 permits only restricted staging exposure. Public unauthenticated writes remain blocked; bounded staging writers are not equivalent to a target-wide freeze. The target-side final-parity race remains an open P1, not a capability completed by this correction.

Startup, timer, `saveUpload()` and `submitRequest()` destructive orphan cleanup must remain disabled and be re-proved at PROD-05/07/13. PROD-14 separately restores cleanup only after cutover completion and protected attachment parity.

VCP/Kiosk enablement remains `IRREVERSIBLE_OR_EXTERNAL`; configuration rollback does not erase persisted business facts. The rollback order remains route removal → exact firewall rule restoration → exact container stop/removal with volume preservation → unused exact image removal → generated role-token binding removal → source-scoped VCP/Kiosk/DingTalk configuration rollback → volume preservation. Data-volume deletion remains forbidden, and blocked post-Switch authority recovery is not an available capability.

### Hard boundary

No production host access, credential generation, provider call, migration, container start, reverse-proxy/TLS/firewall/security-group change, VCP/Kiosk enablement, cutover, deployment, release or merge is authorized or performed by this correction. Only repository code/tests/docs changed.

The packet stays blocked until the selected action's exact targets and prerequisites are resolved in a reviewed authority revision and the human provides exact current authorization. Post-enable compatibility is completion/cutover evidence, not an input that must be generated by an unauthorized operation.

### WO-06D fresh evidence

Published implementation head `9f13b160bb43d3db37f30fc03bc42c635d0e181f`, parent `cb456114e4d57d8ff12473da95737790a63e7118`, passed GitHub Actions run `36131969264` (run #99), job `108061064763`:

```text
workflow                       WO-06D Production Authorization Packet
event                          push
conclusion                     success
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

Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`. The checkout and recorded HEAD match the implementation SHA. The one expected external-VCP skip is not compatibility PASS. The targeted glob `node --test tests/production-change-manifest*.test.mjs` includes Unicode, shell-continuation and dynamic-values regressions.

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

The machine JSON/blob/digest is unchanged by this scanner correction. Machine blob: `873e8daca8aca4a8d797da843060c7ef091d4c03`.

### WO-06D current scanner correction

The shell parser rejects active unescaped dollar/backtick syntax before top-level whitespace can truncate a dynamic value. It does not evaluate shell input. Short single-quoted or escaped literal forms preserve their literal length; long literals still trigger the credential threshold. Active-dollar rejection is intentionally conservative, not a complete shell expansion parser.

The config parser conservatively rejects unquoted YAML scalar/tag/anchor/alias prefixes `|`, `>`, `!`, `&`, `*`, including multiline headers with modifiers and comments. Quoted short literal indicators remain ordinary values. This is unsupported-syntax rejection, not YAML evaluation.

Six new groups in `production-change-manifest-dynamic-values.test.mjs` cover all five token keys, nested/quoted/concatenated/multiline substitution, backticks, literal negatives, ASCII/astral 15/16 UTF-16 boundaries, continuations, YAML scalar modifiers/quoted keys/comments/tags/anchors/aliases and short config literals. Existing UTF-16 counting, Bearer punctuation, shell concatenation and continuation handling remain green. No test executes the synthetic shell strings or installs real credentials.

Implementation source blob: `9dd5efa0659544add4d7c49e9633290a1e348806`; new test blob: `bfccd6ed9fbed687b1639a27ecd42451ba42f16a`.

### Remaining implementation and review work

The scanner correction does not implement either outstanding production-contract P1:

- `4103894629`: bind PROD-12 to production target facts, verified deployment-chain readiness and the production deployment gate, preserving exact DingTalk target/wiring requirements and adding completion proof.
- `4103936494`: require target-wide writer freeze/drain spanning final parity through Switch, same-fence verification and read-only post-switch checks, with success-only release and fail-closed retention. Its execution order must be enforced, not merely compared as a set. The current staging restriction/source checks do not close this race.

No new gate/capability is claimed to exist here. Later review findings must also be checked against the exact current head. Current workflow success alone does not establish review closure or merge readiness.

This docs-only synchronization follows implementation run #99 success. Its resulting final SHA requires its own successful exact-head workflow; final SHA/run belong in the PR/check record to avoid self-reference. Before any separately requested merge require unchanged exact head, successful exact-head CI, zero unresolved threads, Codex clean for that SHA, OPEN / mergeable / not merged, and explicit human merge instruction. Use `expected_head_sha`; no merge is requested here.

### WO-06D historical review evidence boundary

The entire prior work order, including full WO-06A/B/C details, every chronological WO-06D hardening section and the original SHA/run/digest trail, is preserved byte-for-byte in [the historical cb456114 snapshot](WO-06_PREDEPLOY_INTEGRATED_READINESS.HISTORICAL_cb456114.md). Its Git blob is `0bf6b062b68ff4c0f2953ad18b3b4cc9282d4490`, identical to the pre-correction file at `cb456114e4d57d8ff12473da95737790a63e7118`.

Historical uses of "current", requestable sets, blockers and PASS apply only to their stated revisions and cannot override this current summary, actual branch checks or machine manifest. The prior acceptance snapshot is linked from the current WO-06D acceptance document. `docs/DEPLOYMENT_PREFLIGHT.md` remains historical, not authorization authority.

The inaccessible local-only Codex commit `86f6e0793b06baa2f70c7cccf9e327877801bc4a` supplies no accepted publication or GitHub CI evidence. The current scanner correction was independently authored from the published parent and verified by run #99.
