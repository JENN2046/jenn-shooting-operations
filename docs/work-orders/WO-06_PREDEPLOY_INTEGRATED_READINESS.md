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

WO-06A/B/C above are retained checkpoints, not newly executed container or external acceptance. Current WO-06D evidence includes the safety batch, continuous source/target barriers, operation-bound final-sync exception and explicit source acquisition. Production capabilities remain blocked; this is a definition/validator revision, not an executor or permission to deploy.

### Current contract and source-acquisition correction

The safety batch pins complete schema identity before compilation, validates exact ordered cutover effects and binds PROD-14 solely to coauthorized rollback 12 for cleanup disable/cancel/drain and restoration of captured disabled configuration. Deleted data is not recovered by configuration rollback. The source barrier remains held through final parity, Switch, old-source demotion and read-only verification; success opens only the target, never the old source.

The final-sync exception is separately authorized and phase-limited, bound to parent cutover, sync operation/identity, source/target storage, both epochs, scope and finite bounds. Ordinary writers stay denied. No source writes are granted; offline mode admits no exception. Revocation, database drain, attachment drain and durable phase sealing precede parity. Later phases require zero active exception and mutation, rejecting late/replayed/stale grants. Failure keeps both sides closed without automatic retry or reopening.

Review comment `4107365457` identified that the prior final-sync revision assumed the source barrier was held without explicitly acquiring it. Published implementation `4cf90416c190e1bcac0b6ae00812030ce5075cd8` restores the exact effect in step 2 while retaining the eight-step sequence:

```text
With the same fence and no sync exception active, acquire and retain the source-wide database/upload barrier; deny and drain all source writers across processes; drain all initial in-flight target database and attachment mutations across every process; keep every orphan-cleanup entry point disabled
```

This identical manifest/validator binding runs after exact authorization and target fencing but before either the synchronized or offline branch. It produces the existing `SOURCE_WRITE_BARRIER_ACQUISITION_AND_DRAIN_PROOF`; pre-request checks still require capabilities/plans, not unauthorized execution receipts. An already-held source barrier is verified and retained without a release gap. Every source database/attachment writer across processes is covered, including ordinary requests/uploads, integrations/callbacks, background/timers, maintenance/cleanup and direct storage. Unknown coverage, incomplete drain or uncertain ownership stops before sync/parity; global fail-closed rules apply at every step.

`CUTOVER_SOURCE_CONSISTENCY` retains the exact criterion `REQUIRES_DEPLOYABLE_SOURCE_WRITE_BARRIER_AND_EXACT_OFFLINE_OR_OPERATION_BOUND_FINAL_SYNC_PLAN_THROUGH_OLD_SOURCE_DEMOTION`. It remains BLOCKED, as do target fencing, cleanup-disable and post-Switch recovery. Completed sync parity cannot substitute for source-exclusion capability and an exact plan. All prior proof/plan, source/target invariant and sync lifecycle bindings remain intact.

The implementation changes one line each in manifest and validator, adds two source-acquisition test groups and aligns the safety design. Existing tests, schema, pin, dependencies, workflow and authentication are unchanged. New tests reject target-only and assumption-only effects, missing acquisition/drain, partial source coverage, offline skipping, late acquisition, missing execution receipt and pre-request receipt cycles. Existing 28 pairwise cutover-order checks remain. These are contract regressions, not real deployed concurrency evidence.

### Fresh implementation-bearing evidence

This section mirrors the acceptance document's implementation identity, counts, verdict and source table.

- Implementation SHA: `4cf90416c190e1bcac0b6ae00812030ce5075cd8`
- Parent checkpoint: `1181885fd182ddd5d185846f28dcbffab7eeed49`
- Implementation tree: `398ce977b825077be4d93e7a72cb29b6672bc83b`
- GitHub Actions run #119: `36174425984`
- Job: `108201457151`
- Workflow: `.github/workflows/wo06d-production-authorization.yml`
- Event: `push`; attempt: `1`; result: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`
- Runner: Ubuntu `24.04.5`, Linux `6.17.0-1022-azure`

The complete log was inspected. Checkout and recorded `git rev-parse HEAD` both match the published implementation SHA. Every workflow step succeeded; these are GitHub results, not an unpublished local run.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     642
pass                           641
fail                           0
skipped                        1
manifest targeted tests        112
manifest targeted pass         112
manifest targeted fail         0
manifest targeted skipped      0
```

The only full-suite skip is the absent external VCP adapter, not compatibility PASS. The unchanged command `node --test tests/production-change-manifest*.test.mjs` covers the retained 93 targeted tests plus 13 safety groups, two source-barrier, two final-sync and two source-acquisition tests, totaling 112. Both new source-acquisition names and retained source-barrier/final-sync names pass in both suites. No filter, extra skip or weaker existing assertion was introduced. This subsequent evidence-only commit changes no implementation, test, schema or manifest.

### Machine verdict

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:25e934fcb1159dd094a533fea042601c2744dc7581bf4b1a84f20ff87a905569",
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

The four changed-file identities were read from published implementation commit/file responses. Five previously verified blobs are inherited unchanged from the parent, confirmed by the complete commit comparison. These identities match the acceptance document and identify the current implementation tree.

| File | Git blob in implementation tree |
| --- | --- |
| `contracts/production-change-manifest.v1.schema.json` | `1b5a0e0b9d74384016792893842eb415fa0c893b` |
| `docs/operations/production-change-manifest.v1.json` | `391dd831901c007dfcab01002c50f5a7c8f06a21` |
| `src/production-change-manifest-v1.mjs` | `151f2073c8c6a9e02374db4946eb8e3ac979666d` |
| `tests/production-change-manifest.test.mjs` | `6fa93fb5be12a55bff30cc8fc735891d54ac6e2f` |
| `tests/production-change-manifest-safety-contract.test.mjs` | `f3359f4cb4b8117bd51b65a4ec04995ad833ba78` |
| `tests/production-change-manifest-source-barrier.test.mjs` | `526521d5c873e6d11c1aecb64df1ed64448fb286` |
| `tests/production-change-manifest-final-sync-exception.test.mjs` | `8d48982644d153ee8ad4abb527121b2641bda079` |
| `tests/production-change-manifest-source-acquisition.test.mjs` | `94535e513d78b3feb0338c7445839e694bcddf68` |
| `docs/operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md` | `cc13d1f0705429f56f2f2f143d1d08a797b73e8d` |

Canonical schema SHA-256 remains `2627409f8a0d6b7342bfe9ce0ffe616e5697e8f7d26c79aacd9263f2f07aaf9e`, not the manifest digest.

### Preserved authority and exit boundary

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

31 gates / 27 exhaustive BLOCKED gates / 25 actions. The deployment subset is exactly the five gates in the verdict. `WO06C_VCP_EXTERNAL` and `WO06C_KIOSK_DEVICE` remain post-enable acceptance and cutover prerequisites, not substitutes for deployable wiring. `AUTHORITY_HEAD` is the only global pre-request check; initial target preflight does not require its own output. Integration sequencing, import-before-startup, attachment parity, source-scoped rollback and named-volume preservation remain intact. No production capability or gate is promoted.

Raw duplicate rejection, declaration-only evidence admission, fixed low-disclosure failures and no-digest invalid results remain unchanged. Schema content and pin are unchanged. No production data, credential, provider, device, SSH, network, deployment, barrier, synchronization or cutover action was performed.

The docs-only final commit must independently pass the unchanged workflow, followed by independent clean review and complete unresolved-thread verification at the exact current SHA. Final SHA/run and merge outcome belong in PR/check records and replies, avoiding self-referential evidence commits. The user's conditional merge authorization remains valid; it does not authorize deployment or Switch. Merge requires `expected_head_sha` and fresh OPEN / mergeable / not merged / unchanged-head checks.

### Historical evidence boundary

The final-sync implementation `2623a442c4d9c42fec68a4ce06f693af5b227e54`, tree `bf94a5a0adf98c8ca56ce39bfb4e0750bfa2c406`, passed #117 `36171063329` / job `108190419732`; docs-only `1181885fd182ddd5d185846f28dcbffab7eeed49` passed #118 `36171804403` / job `108192896262`. Both had 640/639/0/1, targeted 110/110 and digest `sha256:77fd91b1da4febcd28ca379624a523f84758ace6dbb0420fd94a92cea78d88ac`. Complete evidence and eight blob identities remain at `1181885fd182ddd5d185846f28dcbffab7eeed49`. Review identified missing explicit source acquisition, so that checkpoint is not clean and cannot validate the current correction.

Source-barrier implementation `4854d4d560fa8bea9029ce023ddbb63e1d60e1f0` passed #115 `36165638366`, fresh rerun job `108179830147`; docs-only `02429a5d00c98e9f1197946da10c8fdd66eaf1f4` passed #116 `36168398516` / job `108181676602`, with 638/637/0/1 and 108/108. Digest `sha256:ed797ad375fcec18575e14a2dd945f6aa472f0944bd52ccae19ba0e8faf0c004` and seven identities remain at that immutable ref. Its review produced final-sync findings and was not clean. Local-only `d97006c0c2073da5f977c8d075293bcc6d5ee473` is not a published GitHub CI identity.

The first safety batch, implementation `86aabe9dc15e9c8c0cc82ff166b6551e45a463e3` / #113 `36162028011` and docs-only `b4dbb12fcad0c2618b006b5a81f7a096ea9d8881` / #114 `36163156059`, passed 636/635/0/1 and 106/106. Digest `sha256:d9db0806c49189529543c952c7955f35aeb62a90063c32529c1f7e0b4dc83ad3` is historical; its review contained a valid finding.

Previous input evidence remains at `4d21ff89ee16a3662061132cb7c2983a7c53e3cf`. Implementation `3f454f9fb41a5a65b6125360783cc804be15adb9` passed #109 `36152821332`, final docs passed #112 `36156164951`, with 623/622/0/1, targeted 93/93 and digest `sha256:029f63f56fa46faa8fbd0f68ede496dadc01526a83887ea81005e4642ee2ee7c`. These are not current safety evidence.

Earlier chronology remains at `36a8a0a3000e8fb750fe60196eddb7a1c97a960c` and unchanged `HISTORICAL_cb456114` files. No new snapshot is created. Verified input ancestry remains `16bc1a8ce94a53003bb12881d24b8ae9a57b630f` -> `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13` -> `3f454f9fb41a5a65b6125360783cc804be15adb9`. Local-only `86f6e0793b06baa2f70c7cccf9e327877801bc4a` is not publication/CI evidence. Old no-fence/no-cleanup-rollback/unpinned-schema claims and digests cannot override current definitions; `docs/DEPLOYMENT_PREFLIGHT.md` cannot override current authority.
