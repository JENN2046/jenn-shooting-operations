# WO-06：部署前综合预检

- Authority base: `8d5747439ccdfb29dd78ae294c1df82cba6476a3`
- 状态：`IN_PROGRESS / WO-06A_PREDEPLOY_EVIDENCE_BASELINE_PASS / WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS / WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS / WO-06C_EXTERNAL_VALIDATION_PENDING / WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / FINAL_REVIEW_PENDING / BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`
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
- 状态：`WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / FINAL_REVIEW_PENDING / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Authority candidate: `docs/operations/production-change-manifest.v1.json`
- Acceptance: [WO-06D current acceptance](../acceptance/WO-06D_PRODUCTION_CHANGE_MANIFEST.md)
- Safety design: [Production Cutover Safety Contract V1](../operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md)
- Retained input design: [Production Evidence Input Boundary V1](../operations/PRODUCTION_EVIDENCE_INPUT_BOUNDARY_V1.md)

WO-06A/B/C above are retained checkpoints, not freshly executed container/external acceptance. This WO-06D batch implements repository contract controls only. Its still-unimplemented production capabilities stay explicitly blocked.

### One contract revision for three review classes

The complete design and failure semantics are in `docs/operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md`; this evidence does not duplicate that authority specification.

| Class | Implemented contract and regression control | Production capability status |
| --- | --- | --- |
| Target-writer race, comments `4103936494` / `4104786562` | Eight exact ordered PROD-13 effects bind authorization, persistent all-writer fencing, database/attachment drain, source consistency, same-fence final parity, immediate health/TLS, Switch, read-only verification and success-only release. Reordering is rejected. | `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY = BLOCKED`; deployed fence/drain/failure retention not implemented or accepted here. |
| Schema trust, comment `4105956155` | Complete canonical schema identity is pinned in reviewed validator source before compilation. A copied admitted snapshot prevents subsequent caller mutation. Joint schema/manifest alteration cannot self-authorize. | Repository validation control implemented; not production authorization or a defense against rewriting trusted validator code itself. |
| Cleanup recovery, comment `4105956167` | PROD-14 binds only rollback 12, which denies new cleanup at all four entries, cancels schedules, drains in-flight work and restores captured disabled configuration. Only approved PROD-14 derives it; ordered recovery puts it first in the applicable subset. | `RESTORED_CLEANUP_DISABLE_CAPABILITY = BLOCKED`; deployed disable-and-drain behavior remains unimplemented/unverified. |

`FINAL_PARITY_UNDER_FENCE_PLAN` replaces the old pre-request final-parity result. Acquisition, drain, final parity and release receipts are generated after exact authorization, not required before requesting their producing action. The final proof binds source snapshot, database/upload-volume identities, target revision, attachment digests, operation and fence epoch. Staging, API, integration/callback, background and direct-storage writers are covered. A separately authorized exclusive final-sync writer, when needed, must be revoked and drained before parity; the offline path proves its absence.

Failure, restart, timeout, fence loss or uncertainty invalidates parity and retains CLOSED admission independently of process/container lifetime. No automatic retry or lease-expiry release. Divergent staging facts stop cutover, not authorize deletion. Cleanup remains disabled through successful Switch until separately authorized PROD-14. Existing post-Switch authority recovery stays independently blocked.

PROD-14 captures disabled configuration and verifies disable/drain recovery before restoring any control. Its effects and rollback-12 effects are order-sensitive. The rollback strategy is `STOP_CLEANUP_THEN_ROUTE_RUNTIME_PRESERVE_DATA`; it executes only the approved/applicable derived subset. Disabling cleanup cannot restore deleted files, so PROD-14 remains `IRREVERSIBLE_OR_EXTERNAL`.

### Preserved boundaries

The packet remains non-authorizing:

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

`AUTHORITY_HEAD` is still the only global pre-request check. PROD-01 does not require its own discovered facts. VCP/Kiosk retain deployable wiring -> separately authorized enablement -> real acceptance -> cutover. Their post-enable compatibility/device gates stay BLOCKED and remain cutover prerequisites, not deployment-level blockers. PROD-12 retains exact target/wiring and completed-deployment requirements. PROD-09 still requires source consistency, absent target SQLite, isolated storage and attachment parity before startup. Container removal precedes unused-image removal; named data is preserved.

The manifest now has 31 gates, 27 exhaustive BLOCKED gates and 25 actions. The deployment subset stays exactly the five gates shown in the machine verdict. No old gate is promoted. Schema content changes only its rollback-strategy constant; the complete schema is now pinned.

Raw duplicate rejection and declaration-only evidence admission are unchanged. Both files are read once as bytes; matching the schema pin and parsing its admitted snapshot do not replace raw-source checks. Unsupported credential/config/header snippets remain rejected at every length. Runtime authentication, dependencies and workflow permissions are unchanged. All invalid semantic results now return without a digest. This remains bounded admission, not universal detection of unlabelled secrets or covert encodings.

### Fresh implementation-bearing evidence

- Implementation SHA: `86aabe9dc15e9c8c0cc82ff166b6551e45a463e3`
- Parent checkpoint: `4d21ff89ee16a3662061132cb7c2983a7c53e3cf`
- GitHub Actions run #113: `36162028011`
- Job: `108160656968`
- Workflow: `.github/workflows/wo06d-production-authorization.yml`
- Event: `push`; conclusion: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`
- Runner: Ubuntu `24.04.5`, Linux `6.17.0-1022-azure`

The full job log was inspected. Both checkout and recorded `git rev-parse HEAD` match the implementation SHA. All workflow steps succeeded on this exact published commit, not an unpublished local task result.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     636
pass                           635
fail                           0
skipped                        1
manifest targeted tests        106
manifest targeted pass         106
manifest targeted fail         0
manifest targeted skipped      0
```

The only full-suite skip remains the missing external VCP adapter; it is not compatibility PASS. The unchanged targeted command is `node --test tests/production-change-manifest*.test.mjs`. Thirteen new safety-contract groups join the previous 93 targeted tests. Existing test groups and hostile input fixtures remain; only expectations made obsolete by this reviewed safety contract were synchronized. No dependency, workflow permission, runtime-authentication change, test-name filter or new skip was introduced.

### Machine verdict

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:d9db0806c49189529543c952c7955f35aeb62a90063c32529c1f7e0b4dc83ad3",
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
    "CUTOVER_TARGET_WRITE_FENCE_CAPABILITY",
    "RESTORED_CLEANUP_DISABLE_CAPABILITY",
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

### Verified source identities

| File | Verified Git blob |
| --- | --- |
| `contracts/production-change-manifest.v1.schema.json` | `1b5a0e0b9d74384016792893842eb415fa0c893b` |
| `docs/operations/production-change-manifest.v1.json` | `a015def4442fc1206e8ac3cc3c52e29830a42b86` |
| `src/production-change-manifest-v1.mjs` | `fd38287ea4fcf1bcd1f3f0490964f837066da5f2` |
| `tests/production-change-manifest.test.mjs` | `6e174d42b7662678619945224cd9156a29a1adfb` |
| `tests/production-change-manifest-safety-contract.test.mjs` | `23ea1c718c66070914730e96debbe47cc91e713f` |
| `docs/operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md` | `d95d9c2841dd971dd0d60e6faf994db85f4859fb` |

Unchanged input modules remain `src/production-evidence-input-boundary-v1.mjs` at `f16fb7ed2473a416d32bc6737ffe658e5cac8694` and `src/production-manifest-json-v1.mjs` at `f07eeb38da40fb7481129c828c3fa87f254f36e0`. The complete canonical schema SHA-256 pinned by the validator is `2627409f8a0d6b7342bfe9ce0ffe616e5697e8f7d26c79aacd9263f2f07aaf9e`; this is a schema identity, not the manifest digest.

### Coverage and limits

The new 13-group matrix covers both blocked capabilities, every new proof/plan binding, all 28 pairwise cutover step swaps, omitted/duplicated steps, fail-open substitutions, cleanup scope/order and old recovery boundaries. Schema tests jointly forge schema/manifest states, remove schema constants/constraints, substitute invalid/permissive/external-reference schemas, preserve formatting equivalence and test post-construction mutation. An isolated real CLI test requires nonzero exit, empty stdout, fixed root-path errors and no digest for the forged pair; normal input remains valid and blocked.

Existing groups and hostile-input samples are retained. Only obsolete exact expectations were synchronized. Synthetic CLI fixtures use real source modules without modifying checkout authority. No supplied shell/config text executes. These tests validate definitions and bindings, not deployed writer fencing or real cleanup recovery. No production operation, credential, migration, integration, network mutation or cutover occurred.

### Final review and merge gate

This evidence is synchronized only after implementation run #113 success. The resulting docs-only exact head must pass the same workflow independently. Final SHA/run belong in the PR/check record and replies, not inside that same commit. Reply/resolve and one independent review follow final-head CI; no zero-thread or clean-review result is pre-claimed here.

The user has authorized merge only after these gates pass. Recheck unchanged exact head, successful exact-head workflow, zero unresolved threads, independent Codex clean for that SHA, OPEN / mergeable / not merged; merge with `expected_head_sha`. Merge does not grant production authorization. Subsequent live review inventory is maintained in PR/thread records rather than rewriting static test evidence for every comment.

### Historical evidence boundary

The complete previous evidence remains in Git at `4d21ff89ee16a3662061132cb7c2983a7c53e3cf`. Its input-boundary implementation `3f454f9fb41a5a65b6125360783cc804be15adb9` passed run #109 `36152821332`, and its final docs passed #112 `36156164951`, with 623/622/0/1 and targeted 93/93. Those results and manifest digest `sha256:029f63f56fa46faa8fbd0f68ede496dadc01526a83887ea81005e4642ee2ee7c` are historical, not evidence for the current safety revision.

Earlier complete chronology remains at `36a8a0a3000e8fb750fe60196eddb7a1c97a960c` and in the unchanged `HISTORICAL_cb456114` files. No new snapshot is created. Verified input ancestry remains `16bc1a8ce94a53003bb12881d24b8ae9a57b630f` -> `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13` -> `3f454f9fb41a5a65b6125360783cc804be15adb9`. Local-only `86f6e0793b06baa2f70c7cccf9e327877801bc4a` is not publication/CI evidence. Old no-fence/no-cleanup-rollback/unpinned-schema claims and older digests do not override current definitions; `docs/DEPLOYMENT_PREFLIGHT.md` cannot override current authority.
