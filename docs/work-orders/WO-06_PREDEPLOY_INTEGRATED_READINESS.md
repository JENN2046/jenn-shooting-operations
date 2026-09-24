# WO-06：部署前综合预检

- Authority base: `8d5747439ccdfb29dd78ae294c1df82cba6476a3`
- 状态：`IN_PROGRESS / WO-06A_PREDEPLOY_EVIDENCE_BASELINE_PASS / WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS / WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS / WO-06C_EXTERNAL_VALIDATION_PENDING / WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`
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

| Area | Current evidence | WO-06A classification | Owner |
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
| Production change manifest | not yet frozen | `NOT_IN_SCOPE` | 06D |
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

GitHub Actions run `35976098214` on final implementation-bearing head `b10a2ff8fac20d6ba892a5a8bfc3232c4189c73d` completed successfully with:

- Ubuntu 24.04 / Linux `6.17.0-1022-azure`;
- Node `24.21.0`;
- npm `11.19.0`;
- tzdata `2026c`;
- ICU `78.3`;
- full `npm run check`: 530 tests / 529 pass / 0 fail / 1 expected external-VCP skip;
- this evidence citation correction is docs-only; the resulting PR head must also pass the same workflow before merge, with that run attached to the PR/check record rather than creating an impossible self-referential run ID inside the same commit;
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

The target also retained zero `production_events` and zero `notification_outbox` rows, so historical migration did not fabricate runtime or notification facts.

### Limits preserved

This PASS applies only to fresh isolated fixture paths under the frozen WO-02D contract. It does not authorize or claim:

- production DB migration;
- online migration;
- real upload-volume migration;
- production backup/restore;
- Switch/cutover;
- deployment/release.

WO-06C still owns VCP/Kiosk/DingTalk external readiness. WO-06D still owns the production change and authorization packet. The global deployment gate remains `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`.


## WO-06C：VCP_KIOSK_DINGTALK_EXTERNAL_READINESS

- Authority base: `e2a8de4a0f388e3322bd6c14eb223ba04ce2cb64`
- 本地状态：`WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS`
- 外部状态：`WO-06C_EXTERNAL_VALIDATION_PENDING`

### Fresh local evidence

GitHub Actions run `35981030282` on final implementation-bearing head `775b6072687c53d2135be8d069b650bb37771090` completed successfully with:

- Ubuntu 24.04 / Linux `6.17.0-1022-azure`;
- Node `24.21.0`;
- npm `11.19.0`;
- tzdata `2026c`;
- ICU `78.3`;
- full `npm run check`: 530 tests / 529 pass / 0 fail / 1 expected external-VCP skip;
- Kiosk targeted suite: 118/118 PASS;
- DingTalk/Outbox/Callback targeted suite: 64/64 PASS;
- VCP integration test: 1 skipped because the external adapter is absent;
- local external-boundary harness: PASS.

Machine verdict:

```text
WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS
VCP_EXTERNAL_COMPATIBILITY = BLOCKED_EXTERNAL_RUNTIME
KIOSK_REAL_DEVICE = BLOCKED_DEVICE
DINGTALK_PROVIDER = READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION
WO-06C_EXTERNAL_VALIDATION = PENDING
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

### Boundary facts

VCP:

- the repository still contains only the integration consumer/test;
- external `ShootingPlannerSyncService` is absent in this workspace;
- therefore no real VCP compatibility PASS is claimed.

Kiosk:

- static `/kiosk` entry serves locally;
- default runtime remains fail-closed with `AUTH_NOT_CONFIGURED`;
- explicit trusted-principal injection reaches the empty-resource current read path;
- real tablet/browser scenarios remain unexecuted and must not be inferred from local tests.

DingTalk:

- unconfigured adapter deterministically returns `DINGTALK_NOT_CONFIGURED`;
- local harness proves zero provider network calls;
- callback runtime remains `NOT_WIRED`;
- local Outbox/card/dispatcher/worker/callback boundaries are ready for a separately authorized provider-integration step.

### External closure still required

WO-06C remains open until required external evidence is recorded:

1. VCP real adapter compatibility run: pull → guarded push → verification pull;
2. Kiosk real browser/device acceptance against the frozen WO-03 checklist;
3. if authorized, DingTalk provider integration evidence without widening callback/domain authority.

No VCP runtime access, device operation, DingTalk credential/provider call, public callback endpoint, production identity mapping, deployment or cutover is authorized by this local PASS.

The global deployment gate remains `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`.


## WO-06D：PRODUCTION_CHANGE_MANIFEST_AND_AUTHORIZATION_PACKET

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- 状态：`WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`

### Authority candidate

`docs/operations/production-change-manifest.v1.json`

This manifest freezes:

- unresolved production target facts instead of guessing them;
- four secret classes without storing any secret values;
- prerequisite gates from WO-06A/B/C;
- exact production action IDs, risk, side effects and authority targets;
- per-action evidence requirements and rollback bindings;
- a rollback-first/no-data-deletion rule;
- an embedded human authorization packet with exact-action-only semantics.

### Authorization semantics

```text
approvalModel = EXACT_ACTION_IDS_AND_TARGETS_ONLY
blanketApprovalAllowed = false
requestedActionIds = []
approvedActionIds = []
deploymentAuthorizationRequest = BLOCKED_PREREQUISITES
deploymentGate = BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

The packet's deployment-level blocker subset is frozen as:

- `WO06C_VCP_EXTERNAL`;
- `WO06C_KIOSK_DEVICE`;
- `PRODUCTION_TARGET_FACTS`;
- `PRODUCTION_DATA_MIGRATION`;
- `PRODUCTION_DEPLOYMENT_GATE`.

This is emitted as `deploymentBlockingGateIds`.

Separately, `blockingGateIds` is exhaustive across **every current `BLOCKED` gate**, including action-specific gates such as `DINGTALK_TARGET_BINDING`, `CUTOVER_FORWARD_CHAIN`, `CUTOVER_SWITCH_RECOVERY`, `TARGET_HOST_BINDING`, `CONTAINER_START_READINESS`, `HEALTH_SMOKE_READINESS`, and `PROXY_BACKEND_READINESS`. The validator derives this exhaustive set from gate statuses.

No action definition is currently marked requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` is `BLOCKED_PREREQUISITE` behind `TARGET_HOST_BINDING`. It no longer depends on `PRODUCTION_TARGET_FACTS`, because those are the facts the read-only preflight is responsible for discovering after one exact candidate host has been bound.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains externally provider-ready at the WO-06C local boundary, but is `BLOCKED_PREREQUISITE` in WO-06D because `DINGTALK_TARGET_BINDING = BLOCKED`. No concrete app/provider identity or bounded test destination is present, so it is not requestable.

No action is requested or approved.

### Hard boundary

WO-06D performs no production host access, credential generation, provider call, migration, container start, reverse-proxy change, firewall/security-group mutation, VCP/Kiosk enablement, cutover or deployment.

A validated packet may still remain:

```text
DEPLOYMENT_AUTHORIZATION_REQUEST = BLOCKED_PREREQUISITES
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

until all required external/target/data prerequisites are separately closed and the human gives exact current authorization.


### WO-06D fresh evidence

GitHub Actions run `36024210771` on implementation-bearing head `5ea293522846b9be2b6e82803c0df3b56826d591` passed:

- full `npm run check`: 559 tests / 558 pass / 0 fail / 1 expected external-VCP skip;
- production-manifest targeted tests: 29/29 PASS;
- manifest validator: `WO_06D_MANIFEST_VALID`;
- manifest digest: `sha256:7de680a5e8b748faddc9cea087914acc5b26a22229c7e508c9f7c0bd492f01c3`;
- authorization packet: `FROZEN_NOT_REQUESTED`;
- deployment request: `BLOCKED_PREREQUISITES`;
- deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`.

This PR branch remains `MERGE_PENDING`. It does not publish authority PASS before merge and does not request or approve any production action.


### WO-06D review hardening

The production authorization validator now freezes, for every one of the 18 action IDs:

- requestability/status;
- exact authority target;
- exact prerequisite-gate set;
- exact rollback-action set.

The requestable status set is additionally checked bidirectionally against the frozen empty requestable set. Unknown/replaced action IDs are rejected. Secret scanning now rejects ordinary Bearer material in schema-valid free text.

The exact-head hostile regressions cover all 4×P1 + 1×P2 review findings plus combined multi-axis widening. The authorization packet remains:

```text
FROZEN_NOT_REQUESTED
requestedActionIds = []
approvedActionIds = []
DEPLOYMENT_AUTHORIZATION_REQUEST = BLOCKED_PREREQUISITES
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```


### WO-06D complete semantic freeze

After re-review, the packet additionally freezes:

- exact `authorityBase`;
- target unresolved-fact set;
- gate evidence;
- global invariant set;
- per-action title/category/risk/sideEffect/effects/evidenceRequired;
- exact pre-request revalidation checklist.

Together with the prior target/precondition/status/rollback hardening, this makes the production authorization definition fail closed across lineage, scope, risk, prerequisites, evidence and recovery semantics.

Current packet state remains unchanged:

```text
FROZEN_NOT_REQUESTED
requestedActionIds = []
approvedActionIds = []
DEPLOYMENT_AUTHORIZATION_REQUEST = BLOCKED_PREREQUISITES
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```


### WO-06D firewall rollback-order hardening

The global rollback plan now explicitly includes `ROLLBACK-05-REVERT-FIREWALL-RULE` immediately after removing the newly added reverse-proxy route:

```text
remove new route
→ revert new firewall/security-group rule
→ stop new container
→ revoke/remove role-token runtime bindings created by PROD-03
→ disable newly enabled external config
→ preserve data volume
```

This closes the gap where a future authorized firewall mutation could otherwise survive a rollback sequence. Omission or misplacement of rollback 05 is covered by hostile regression and fails closed.


### WO-06D DingTalk exact-target fail-closed correction

The latest P1 established that a generic DingTalk target description is insufficient for `EXACT_ACTION_IDS_AND_TARGETS_ONLY`.

WO-06D therefore does not fabricate a concrete DingTalk app/provider or recipient. Instead it freezes:

```text
DINGTALK_TARGET_BINDING = BLOCKED
evidence = EXACT_APP_PROVIDER_AND_TEST_DESTINATION_UNRESOLVED

PROD-12.status = BLOCKED_PREREQUISITE
PROD-12.authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING
requestableActionIds = [PROD-01-TARGET-READONLY-PREFLIGHT]
```

Two different candidate DingTalk app/destination targets are exercised by hostile regression and both fail closed before requestability. The packet remains `FROZEN_NOT_REQUESTED`; requested/approved action arrays remain empty.


### WO-06D production-host target + role-token rollback correction

Exact-current Codex review identified that `PROD-01` was still requestable without a concrete host and that `PROD-03` lacked a rollback dedicated to its generated role-token bindings.

Current machine contract now freezes:

```text
PROD-01.status = BLOCKED_PREREQUISITE
PROD-01.authorityTarget = UNRESOLVED_PRODUCTION_HOST_IDENTITY
requestableActionIds = []

PROD-03.rollbackActionIds = [ROLLBACK-06-REVOKE-ROLE-TOKENS]
```

The validator rejects attempts to promote either a HOST_A or HOST_B candidate into requestability before exact host binding, rejects rebinding PROD-03 to the generic external-config rollback, and rejects omission of rollback 06 from the global rollback sequence.

Implementation evidence: head `239527fbdd88e6aad27fc039ac1ab20d9165b138`, run `36015492997`, 553/552/0/1 full-suite result, 23/23 manifest suite, digest `sha256:4ae83ba4ce1fb4e6cace95b2768a011f36bd91efb4432b36bae49e92845b3531`.


### WO-06D cutover chain + derived rollback authority

Cutover is now blocked by the dedicated `CUTOVER_FORWARD_CHAIN` gate until verified completion evidence exists for the required forward deployment chain. `PROD-13` also requires `FORWARD_CHAIN_COMPLETION_PROOF`.

Rollback authority is no longer a second-approval dead end:

```text
rollbackAuthorizationModel = BOUND_ROLLBACK_IDS_COAUTHORIZED_WITH_FORWARD_ACTION
separateRollbackApprovalRequired = false
derivedRollbackActionIds = []
```

Forward actions still require explicit human authorization. Rollback-only actions are authorized only as the exact rollback IDs bound to an approved forward action; the validator derives that set and rejects forged rollback authority.

Implementation evidence: head `a9f80f38b2745ee739f6d35fae708172840cdefa`, run `36016721973`, 555/554/0/1 full suite, 25/25 manifest suite, digest `sha256:f3d912fa3afeb94473bee8d75583516a0899e45f69374d7754b8d0389e0f3575`.


### WO-06D post-Switch authority recovery blocker

The migration authority explicitly separates pre-Switch rollback from post-Switch business recovery. Post-Switch reversal requires a separately designed dual-read / compatible-write path and switch record.

WO-06D now freezes:

```text
CUTOVER_SWITCH_RECOVERY = BLOCKED
evidence = POST_SWITCH_DUAL_READ_COMPATIBLE_WRITE_AND_SWITCH_RECORD_NOT_DESIGNED

PROD-13.preconditions += CUTOVER_SWITCH_RECOVERY
PROD-13.rollbackActionIds += ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH

ROLLBACK-07.status = BLOCKED_PREREQUISITE
ROLLBACK-07.authorityTarget = UNRESOLVED_POST_SWITCH_AUTHORITY_RECOVERY_CAPABILITY
```

Rollback 07 is not executable, not in the global rollback order, and not derivable as rollback authority while blocked. It becomes a real rollback capability only through a later reviewed authority revision that provides the dual-read/compatible-write recovery proof and switch-record contract.

Implementation evidence: head `11c172f50d6cf843eed391de400f473f43db1f04`, run `36020032853`, full suite 556/555/0/1, manifest suite 26/26, digest `sha256:91d0fd5fb681e402fd0fda67f211d6abc6002eab4eff3976e8c5c441d483de3e`.


### WO-06D exhaustive blocker surface + proxy backend readiness

`blockingGateIds` is now defined as the exhaustive set of all gates currently in `BLOCKED` state. `deploymentBlockingGateIds` separately preserves the five deployment-level blockers, so action-specific blockers remain visible without changing their meaning.

Current action-specific blocked gates include:

```text
DINGTALK_TARGET_BINDING
CUTOVER_FORWARD_CHAIN
CUTOVER_SWITCH_RECOVERY
TARGET_HOST_BINDING
CONTAINER_START_READINESS
HEALTH_SMOKE_READINESS
PROXY_BACKEND_READINESS
```

`PROD-07-CONFIGURE-REVERSE-PROXY-TLS` now requires:

```text
PROXY_BACKEND_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_04_05_06
BACKEND_BUILD_START_HEALTH_PROOF
```

Therefore route/TLS exposure cannot be authorized before build, isolated-container start, and loopback health verification have completed successfully.

Implementation evidence: head `3440cf3efdc6c5fa5a0ea1667ea21f43a99a7260`, run `36022131601`, full suite 557/556/0/1, manifest suite 27/27, digest `sha256:c10a179016e15aac94614fa6588e772b67b6f0dc533e1454603c6c98ef3cabbb`.


### WO-06D target-preflight cycle + runtime predecessor chain

The target preflight no longer depends on the facts it is meant to discover:

```text
TARGET_HOST_BINDING = BLOCKED
evidence = EXACT_CANDIDATE_PRODUCTION_HOST_UNRESOLVED

PROD-01.preconditions = [TARGET_HOST_BINDING]
```

After an exact candidate host is structurally bound, PROD-01 may verify that identity and discover the remaining target facts.

Runtime startup is now sequenced by explicit predecessor gates:

```text
CONTAINER_START_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02_03_04

HEALTH_SMOKE_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_05
```

So the frozen path is:

```text
target binding
→ preflight
→ target facts
→ storage/tokens/image
→ container start
→ loopback health
→ proxy/TLS
```

Implementation evidence: head `5ea293522846b9be2b6e82803c0df3b56826d591`, run `36024210771`, full suite 559/558/0/1, manifest suite 29/29, digest `sha256:7de680a5e8b748faddc9cea087914acc5b26a22229c7e508c9f7c0bd492f01c3`.
