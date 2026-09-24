# WO-05：Agent 调度器与影子评估

- 状态：`IN_PROGRESS / ARCHITECTURE_FROZEN`
- 执行分支：`codex/v2-1-architecture-freeze`
- 前置门：WO-00/01 `PASS`、WO-02/03/04 `PASS_WITH_LIMITS`
- 冻结决定：`ADP-024_SCHEDULING_PROPOSAL_DETERMINISM_AND_SHADOW_EVALUATION.md` + `ADP-025_SCHEDULING_CONTRACT_EXACTNESS_AND_EVIDENCE_BINDING.md`
- 范围：本地资源/配置/Proposal 契约、纯调度核心、SQLite 增量、fixture 离线评估、可信人工决策记录
- 非范围：真实 LLM/provider、外部 runner、生产数据、真实凭据、网络、自动采用、Switch、部署、发布

## 1. Reality Report

开始 WO-05 时仓库事实为：

- schema latest 为 migration v4，没有 resource/config/proposal/decision 表；
- 当前没有 canonical V2 schedule command 或 `/api/v2/schedule/commands`；
- V1 whole-snapshot PUT 不能作为 Proposal acceptance 通道；
- normalized public projection 的 resource catalog 为空；
- checked-in synthetic fixtures 已包含 Level A/Level B task-level completed samples；approved/real Level C dataset 数量仍为 0；
- migration、Kiosk、Outbox 已具有可复用的 transaction/revision/auth/idempotency 模式；
- Windows 兼容更新已纳入当前分支，但本工作包尚无 Windows runtime 验证。

结论：可以推进 contracts、纯核心、persistence、generate/read/reject 与 evaluator；真实 shadow acceptance 为 `BLOCKED_DATA`；accept/partial 在 canonical schedule command 完成前为 `NOT_WIRED`。

## 2. 分批顺序

### WO-05A：Architecture and Contracts

状态：`PASS`

完成检查点：`05A ARCHITECTURE_AND_CONTRACTS_PASS`

- 已实现 resource/config commands、`SchedulingInputV1`、deterministic Proposal item/result、Proposal/Decision envelope、sample/evaluation contract、diagnostic/reason allowlist、canonical JSON 与 digest；
- 已冻结 `resource-capabilities-v1` exact capability body/digest；
- candidate / occupancy / active run、Proposal/input、Decision/adoption、evaluation evidence 跨集合一致性 fail closed；
- calendar compiler/runtime tzdata fingerprint 进入 input/result/Proposal digest 链，DST transition fail closed；
- shadow evaluator 只消费 evidence-bound facts 与 trusted replay ports；报告 gate 固定 `BLOCKED_DATA`；
- 四组合约测试 `54/54 PASS`，项目全量 `446 PASS / 0 FAIL / 1 SKIP`；
- 独立复核 `0 Critical / 0 Major / 0 Minor`；
- Windows：05A 合约与全项目回归已在 Node.js 24.21.0 / tzdata 2026c 上通过；Linux/Windows 的 runtime-specific digest 不相同，golden test 改为校验 runtime digest 自洽并 pin 跨平台 body digest。

05A 只关闭纯契约门；不代表 scheduler、persistence、HTTP、acceptance 或真实 shadow 数据完成。

交付：

- ADP-024、ADP-025 与 baseline R8；
- resource/config/SchedulingInput/Proposal/Decision/evaluation contract；
- stable diagnostic/reason code；
- canonical JSON、input/result digest golden vectors；
- exact-key、unsafe object、duplicate ID、invalid time/calendar negative fixtures。

门禁：无 DB migration、无 HTTP、无 provider、无正式排期写入。

### WO-05B：Pure Deterministic Scheduler

状态：`LOCAL_ENGINE_PASS`

本地完成检查点：

- `deterministic-scheduler-v1` 只消费已规范化的冻结输入与 active config；不读取 DB、clock、random、filesystem、network、env 或默认 locale；
- 完成 calendar window 再验证、显式/retrospective/fallback duration 解析、Buffer 占用、sample/resource/capability/legacy hard gate、p0/p1/p2 稳定顺序、soft diagnostic 与 deterministic Proposal item ID；
- grouped/locked occupancy 不拆分或移动，未知历史 Buffer 和 unresolved resource 失败关闭；
- Windows 本地 `12/12` 定向测试通过，项目全量 `456 PASS / 0 FAIL / 3 SKIP`；Linux/跨运行时回归尚未执行；
- review 修复：业务窗口按 planning range 裁剪后必须与配置编译的完整窗口集合精确一致，防止部分日范围丢失可用时段或静默漏报；单次 planning range 的本地日历跨度超过 366 天时失败关闭；
- review 修复：`desiredDate: null` 显式排在所有有效日期之后，包括 `9999-12-31`；
- 无 DB、HTTP、真实 provider、正式排期写入或自动采用。

交付：

- calendar compiler；
- duration-policy resolver；
- Buffer occupancy；
- hard eligibility filter；
- p0/p1/p2 stable ordering；
- soft score/diagnostic；
- deterministic proposal item IDs；
- property/metamorphic tests。

门禁：核心不读取 DB、clock、random、filesystem、network、env 或 locale default。

### WO-05C：Persistence and Proposal Generation

状态：`LOCAL_PROPOSAL_PASS_WITH_ACCEPTANCE_NOT_WIRED`

本地完成检查点：

- append-only migration v5 新增 canonical resource catalog、显式 request capability/estimate facts、immutable config versions、single active pointer/activation receipts、immutable Proposal 和 append-only decision receipts；v1–v4 SQL/checksum 未修改；
- admin 内部命令支持资源登记/替换、配置发布/激活和显式需求能力登记；使用 expected revision、operation digest 与同事务读投影刷新；变更时 draft Proposal 在同一事务保守失效；
- DB input assembler 只读取结构化字段、明确登记的需求能力与版本化配置；缺失能力事实保留为 `null` 并由 hard diagnostic 阻断，不从自由文本猜测；
- Proposal generate 在 `BEGIN DEFERRED` 读取一致快照，锁外纯计算，`BEGIN IMMEDIATE` 内复核 active config、schedule revision 与 input digest；支持 read/reject/stale、exact replay 与 one-shot terminal receipt；
- 未连接 HTTP、principal adapter、真实数据库、正式排期采用或 schedule Outbox；admin projection port 未配置时失败关闭；
- Windows 本地 schema/Proposal 定向测试通过，全项目 `465 PASS / 0 FAIL / 3 SKIP`；Linux/跨运行时回归尚未执行。

交付：

- append-only migration v5；v1–v4 SQL/checksum 不变；
- canonical resource catalog；
- immutable config versions + active pointer/activation receipt；
- immutable Proposal + append-only decision receipt；
- input assembler、lock-free compute + short persist recheck；
- create/read/reject/stale application use cases；
- explicit unconfigured auth/HTTP boundary。

门禁：不接受 Proposal，不写 `schedule_items`，不接 schedule Outbox。

### WO-05D：Canonical Schedule Acceptance

状态：`LOCAL_ACCEPTANCE_PASS / HTTP_PRINCIPAL_ADAPTER_IMPLEMENTED_LOCAL_ONLY`

本地完成检查点：

- 独立 canonical V2 schedule transaction kernel 接受调用方已开启的 `BEGIN IMMEDIATE`，一次性创建 selected Schedule Items 与单一 request binding；Proposal handler 不直接写排班表，也不调用 V1 whole-snapshot PUT；
- 采用命令对 revision、active config、完整 input digest、algorithm 和重算结果做同事务复核；revision/config/input 漂移只留下 stale receipt，不创建正式排班；普通约束或投影失败整笔回滚；
- 全选/部分采用只增加一次 schedule/projection revision，同事务刷新 V1/V2 投影、保存 decision/operation/audit，并为每个正式场次入队一条 `schedule.confirmed.v1` Outbox intent；不启动外部通知执行器；
- `ba16abe` 已完成 post-merge independent code/evidence verification，结果为 `PASS_TO_HTTP_WIRING`；reviewer 环境因无法 clone GitHub，fresh runtime re-execution 记录为 `NOT_RUN_ENVIRONMENT_LIMIT`，不得冒充 fresh PASS；
- 已实现本地 HTTP principal adapter：`POST /api/v2/proposals/:id/decisions` 只接受注入 Auth Port 产生的 trusted `scheduler` / `administrator` principal；`accept/partiallyAccept` 路由到 canonical acceptance，`reject` 路由到 canonical rejection use case；所有 human decision ID 共享 `operations` 全局幂等命名空间；`spd_` system-stale 命名空间只禁止新的 human decision 占用，升级前已存在且可按当前 contract 重新验证的 exact human decision 仍优先允许 replay，即使同 ID 存在历史 unrelated operation；system stale exact replay 必须同时匹配 proposal/digest/type；URL proposal ID 为路由权威，body actor/role/subject 不构成身份，所有 decision 的 resource scope 与 `modifySchedule` 均失败关闭；
- runtime composition 仍不读取或猜测真实凭据、真实用户映射或 resource scope；未显式注入 scheduling Auth Port 时保持 `AUTH_NOT_CONFIGURED`，direct server env 未启用该能力；projection 的 `businessTimeZone` 从当前 active scheduling config 读取，不建立第二份部署级时区事实；
- HTTP adapter 不启动外部通知执行器、不允许 Agent/LLM/background worker 自动采用，也不代表生产鉴权、部署或公开服务完成。

前置：

- canonical V2 schedule command/application use case；
- resource → V1 display projection；
- trusted scheduler/admin principal HTTP adapter；
- transaction-bound schedule.confirmed Outbox producer。

交付：

- full/partial acceptance；
- selection validation；
- revision/digest/config/hard-constraint recheck；
- all-or-nothing multi-item apply；
- one revision increment per decision；
- idempotency/concurrency/rollback tests。

禁止：直接 SQL、V1 PUT、自动采用或在 05C 临时实现 acceptance。

### WO-05E：Sample Capture and Offline Evaluation

状态：`BLOCKED_DATA / POST_MERGE_CODE_EVIDENCE_VERIFIED / FRESH_RUNTIME_PENDING`

#### WO-05E-A：Future Run-Context Capture

状态：`POST_MERGE_CODE_EVIDENCE_VERIFIED / FRESH_RUNTIME_PENDING`

当前实现：

- schema migration v6 新增 `scheduling_run_context_snapshots`，每个 run 至多一条，禁止 update/delete；
- Kiosk 与 generic run-event 两条 canonical start 路径都以 `scheduled → shooting` 状态转换判定 first-start，并在各自原 `BEGIN IMMEDIATE` 事务内写 snapshot；Kiosk 是否同时 provision run 与是否 capture 完全解耦；capture 不额外增加 schedule/run/projection revision；
- task run 在 request/resource/config/duration/buffer 事实完整且可由 evaluation contract 无损表达时写 `contextStatus=complete`；合法生产事实若无法映射到冻结的 evidence token（例如含空格/非 ASCII 的 duration `sourceVersion`），不得截断或阻断开拍，必须降级为 `contextStatus=ineligible / RULE_FACT_MISSING`；缺 config 或规则事实同样诚实写 ineligible；grouped block 固定 `GROUPED_UNALLOCATED`；
- `capturedAt` 使用 first-start 的注入事务 clock，排除在 snapshot content digest 外；snapshot content 由 `buildSchedulingRunContextSnapshotV1` canonicalize/digest；
- exact event replay 不重复 snapshot；历史 run 不回填，不因本迁移自动升级 Level B；
- generic `run-event-use-case-v2` 虽只更新既有 run，但 `scheduled → shooting` 本身就是 first-start，因此已接入同一 capture builder/persistence port；预创建 run 与现场 provisioned run 均不会因入口差异永久失去 Level B snapshot。

05E-A post-merge independent code/evidence verification 已通过；authority HEAD 上无 GitHub Actions/check-run，当前隔离执行环境无法取得 exact checkout，因此 fresh runtime `npm check` 仍为 pending。

#### WO-05E-B：Checked-in Fixture Dataset + Offline Replay

状态：`MERGED / POST_MERGE_VERIFICATION_PENDING`

当前实现：

- checked-in synthetic fixture `fixtures/shadow-evaluation-v1/synthetic-level-a-b.v1.json` 固定包含一个 Level A 与一个 Level B case，明确保持 Level C = 0；
- fixture 固定 dataset/result digest、case classification、eligibility/exclusion counts 与完整 low-disclosure expected report；
- `src/shadow-evaluation-fixture-replay-v1.mjs` 依次重放 dataset admission、sample classifier 与 `shadow-metrics-v1` evaluator，并用 canonical JSON 校验 expected classification/report；
- replay context 对 hard/priority ports 固定为 null；由于 fixture 无 Level C，不伪造 hard conflict / priority 结论，全部 Agent shadow metrics 必须保持 `NOT_ENOUGH_DATA + value:null`；
- Level B retrospective duration baseline 可得到确定性 100ms median absolute error / P90 overrun，仅作为 baseline，不冒充 Agent shadow metric；
- `npm run evaluate:shadow:fixtures` 只读取 checked-in fixture，不访问网络、provider、环境凭据或生产数据库；CLI 只输出 classification 与 low-disclosure report；
- regression 覆盖 deterministic replay、digest/report tamper fail-closed、zero Level C 和 low-disclosure output。

05E-B post-merge independent code/evidence verification 已通过；checked-in fixture 的 event/metrics/snapshot/dataset/report SHA-256 已由独立 canonical implementation 重新计算并 7/7 匹配。fresh runtime replay 仍为 pending。

#### WO-05E-C：Low-Disclosure Report Integration Closure

状态：`POST_MERGE_CODE_EVIDENCE_VERIFIED_WITH_VERIFICATION_FIX / FRESH_RUNTIME_PENDING`

当前实现：

- `src/shadow-low-disclosure-report-v1.mjs` 为 aggregate shadow report 增加独立 admission boundary，只接受固定 report root、eligibility、exclusion 与 metric allowlist；`approvedLowDisclosure` 还必须匹配来自已验证 dataset context 的 trusted `expectedApprovalDigest + expectedDatasetDigest`；
- report admission 验证 synthetic / approved-low-disclosure approval matrix、stable exclusion code/order/count、Level A/B/C count relation、cohort denominator 绑定，以及每类 metric 的 `OK / NOT_ENOUGH_DATA` 数值与 duration precision 矩阵；
- `resultDigest` 由不含 `generatedAt` 的 report fact body 重新计算并核对；`generatedAt` 仅做 RFC3339 规范化，不参与事实 digest；
- report-only integration 出口固定为 `npm run evaluate:shadow:report`，不输出 fixtureId、sampleId、requestId、scheduleItemId、runId 或 per-case classification；
- `npm run validate:shadow` 只读取 checked-in synthetic fixture，重放 evaluator 后再经过 low-disclosure admission；
- `npm check` 已串入 `validate:shadow`，使 report schema widening、digest drift、zero-denominator 伪成功或不稳定 exclusion 直接阻断主检查；
- regression 覆盖 root/nested disclosure widening、`NOT_ENOUGH_DATA + value:null`、metric-specific numerator/denominator semantics、resultDigest、generatedAt-outside-digest 与 exclusion allowlist/order/bounds。

05E-C post-merge independent review 发现并修复一处 aggregate exclusion/cohort consistency gap：Level B/Level C exclusion counts 现在与对应 cohort shortfall 绑定，并补充 outcome/event subset 约束与回归。该 verification fix 合并且 fresh runtime `npm check` 完成后，WO-05E 才可进入 `SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA`；真实 shadow acceptance 仍不得声称通过。

真实 Level C 数据与真实 shadow threshold gate 继续保持 `BLOCKED_DATA`。

交付：

- Level A/B/C sample classifier；
- future immutable run-context capture；
- checked-in fixture replay；
- dataset/config/algorithm/metric versioned low-disclosure report；
- `NOT_ENOUGH_DATA + value:null` 与 exclusion reason（`N/A` 仅 UI 展示）；
- independent review and regression。

真实 shadow 指标门只有在存在足量 Level C 数据且阈值另行冻结后才可能通过。本工作包不得通过合成样本或历史猜测关闭该门。

## 3. 文件所有权

| 轨道 | 范围 |
|---|---|
| Contracts | DTO validators、canonicalization、diagnostic codes、golden vectors |
| Scheduler | pure engine、calendar/buffer/duration、determinism tests |
| Persistence | migration v5、resource/config/proposal/decision SQLite adapter |
| Acceptance | canonical schedule command、projection/revision/Outbox transaction |
| Evaluation | sample classifier、fixture dataset、aggregate low-disclosure report |
| Commander | architecture、共享文件串行整合、回归、独立复核、提交与安全交付 |

共享 schema、HTTP composer 和 public exports 由 Commander 串行整合，避免子任务并发覆盖。

## 4. Required Test Matrix

### Contract

- exact root/nested keys；
- identifier/length/control-char boundary；
- astral Unicode code-point、lone surrogate、offset-equivalent UTC、`-0` golden vectors；
- duplicate/unsorted/unsafe keys；
- invalid IANA zone/date/window/DST；
- digest golden vector and mutation coverage。

### Scheduler

- input permutation yields byte-equivalent result；
- P0 before P1/P2 when eligible；
- P0 blocked by sample/resource/calendar/overlap/lock/duration；
- buffer overlap and calendar end boundary；
- grouped block remains indivisible occupancy；
- stable tie break and proposalItemId。

### Persistence

- v4→v5 incremental upgrade；
- historical checksums unchanged；
- immutable config/proposal/decision triggers；
- single active config pointer；
- create Proposal consumes no business revision；
- compute-time input change inserts no draft；
- exact replay vs idempotency reuse；
- concurrent one-shot decision CAS；
- run-create/first-start context snapshot 同事务、immutable、exact replay 不重复且不额外消费 revision。

### Future Acceptance Gate

- unwired accept produces no schedule fact or terminal state；
- wired batch acceptance increments schedule/projection once；
- any failure rolls back facts/revision/projection/Outbox/decision；
- stale mismatch creates only stale receipt；
- V1 projection has stable place and no cross-business-date invalid session。

### Evaluation

- grouped、legacy synthesized run、cancelled、review-pending、unknown-metrics、incomplete-chain excluded；真实 post-migration single task run 仍按 A/B/C 资格判断，不因数据库来自 migration 永久排除；
- zero denominator returns `NOT_ENOUGH_DATA + value:null`，never zero success；
- report contains dataset/version/digest and exclusion counts；
- report contains no Brief/note/raw events/provider/private data；
- no threshold result expands permission automatically。

## 5. Stop Conditions

- 需要真实 LLM/provider、外部 Codex/runner、DNS/HTTP、凭据/env/auth configuration；
- 需要真实或生产 DB、在线 migration、Switch 或服务公开启动；
- 需要猜业务时区、资源列表、营业/闭棚时间、Buffer 或真实阈值；
- 试图绕过 trusted principal、revision、input digest、hard constraints 或 human decision；
- 试图自动拆 grouped block、伪造 run-context/history 或把 deliverable metadata 当工时；
- 需要部署、release、publish 或自动权限升级。

## 6. Completion States

```text
LOCAL_ENGINE_PASS
LOCAL_PROPOSAL_PASS_WITH_ACCEPTANCE_NOT_WIRED
LOCAL_ACCEPTANCE_PASS_WITH_HTTP_PRINCIPAL_NOT_WIRED
SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA
WINDOWS_NOT_RUN
```

只有以下事实全部成立后，WO-05 才可报告完整 PASS：

- 05A–05E 所有实现门通过；
- canonical schedule acceptance 已完成且独立复核；
- 存在足量合格 Level C dataset；
- `shadow-metrics-v1` contract 已实现并通过 golden tests，真实阈值已另行冻结；
- 真实离线 shadow report 达标；
- 仍保持 human-in-the-loop，未扩大 Agent 权限。

## 7. 当前下一步

WO-05E A/B/C post-merge independent code/evidence verification 已完成。当前唯一未关闭的实现证据门为 fresh runtime `npm check`；verification 分支同时包含一处 C 段 aggregate exclusion/cohort consistency 修复。approved/real Level C dataset 仍为 0，真实 shadow acceptance gate 继续保持 `BLOCKED_DATA`。
