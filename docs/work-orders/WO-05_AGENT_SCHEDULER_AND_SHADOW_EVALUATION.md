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
- checked-in fixtures 中严格 task-level completed sample 数量为 0；
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

状态：`LOCAL_ACCEPTANCE_PASS / HTTP_PRINCIPAL_NOT_WIRED`

本地完成检查点：

- 独立 canonical V2 schedule transaction kernel 接受调用方已开启的 `BEGIN IMMEDIATE`，一次性创建 selected Schedule Items 与单一 request binding；Proposal handler 不直接写排班表，也不调用 V1 whole-snapshot PUT；
- 采用命令对 revision、active config、完整 input digest、algorithm 和重算结果做同事务复核；revision/config/input 漂移只留下 stale receipt，不创建正式排班；普通约束或投影失败整笔回滚；
- 全选/部分采用只增加一次 schedule/projection revision，同事务刷新 V1/V2 投影、保存 decision/operation/audit，并为每个正式场次入队一条 `schedule.confirmed.v1` Outbox intent；不启动外部通知执行器；
- 本地可信 principal 授权 port 未配置时失败关闭；没有 HTTP 路由或真实鉴权绑定，因此此状态不代表网页端可采用或生产就绪。

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

状态：`BLOCKED_DATA / IMPLEMENTATION_ALLOWED`

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

下一步需独立复核 WO-05D 的本地采用链路，并在单独授权下把 trusted scheduler/admin HTTP principal adapter 接入；当前 `accept` 仅可通过内部显式授权 port 调用，不是可公开使用的 API。05E 的真实 shadow 指标仍为 `BLOCKED_DATA`。
