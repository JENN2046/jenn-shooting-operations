# ADP-024：Scheduling Proposal Determinism and Shadow Evaluation

- 状态：`ACCEPTED / FROZEN_FOR_WO-05_LOCAL_IMPLEMENTATION`
- 日期：2026-09-22
- 决策范围：资源事实、版本化调度配置、确定性输入与摘要、Proposal 状态机、人工决策、canonical acceptance 前置门、样本资格与离线影子评估
- 替代：Architecture Decision Pack V2.1 的 ADP-013 全文
- 细化：ADP-014、ADP-017 第 5 节、ADP-018、ADP-019、实施计划书第 10 节与 WO-05
- 不替代：既有 Request / Schedule / Run 生命周期、三 revision 域、V1 兼容、Outbox 或 Kiosk 决定

> 本决定只授权本地契约、纯函数、SQLite 增量 schema、fixture 和离线评估实现。它不授权真实 LLM/Agent provider、外部 runner、生产数据、凭据、网络调用、自动采用、服务公开启动、Switch、部署或发布。

## 1. 背景与当前事实

ADP-013 已冻结“Agent 只生成 Proposal、人工最终确认”的正确方向，但尚不足以安全编码：

- `inputDigest` 没有字节规范与完整字段域；
- 没有 canonical resource catalog、业务日历或可发布配置；
- `accepted / partiallyAccepted` 没有选择集、原子性和幂等 receipt；
- 当前没有 canonical V2 schedule command，只有 V1 whole-snapshot 写入和 Kiosk V2 命令；
- V1 projector 需要稳定的 resource display place，而当前 normalized projection 中 `resources` 仍为空；
- 当前 checked-in fixtures 中，满足严格 task-level 完成样本资格的数量为 `0`。

因此 WO-05 必须拆成“可以诚实完成的本地能力”和“仍然被事实阻断的正式采用/真实影子验收”。不得借用 V1 `PUT /api/v1/snapshot`、直接 SQL 或伪造历史事实来关闭缺口。

## 2. 首批能力边界

首批调度器的 candidate universe 必须包含 scope 内全部 lifecycle 为 `open`，且不存在任何绑定到 `schedule_status <> cancelled` Schedule Item 的 `requests_v2`。结构化事实不完整的 request 仍进入 normalized input 与 `inputDigest`，并产生 hard diagnostic；只有通过全部 hard eligibility 的 subset 才能进入排程结果。这样既不会重复提案，也不会通过预过滤把阻断事实从摘要中藏掉。

首批确定性调度器只为以下 eligible subset 生成 item：

- 尚未排入正式时间块、结构化事实完整的单条 `requests_v2`；
- 已存在、active、显式授权且具有稳定 V1 display place 的资源；
- 明确 planning window 内的空闲时间；
- 配置中明确的持续时间策略、日历与 Buffer 规则。

首批调度器不得：

- 移动、修改、取消或解锁既有 Schedule Item；
- 自动拆分 `grouped_unallocated`；
- 把组合块时长分摊给单个 request；
- 创建 Production Run；
- 从 Brief、note、URL、附件名或其他自由文本推断 priority、样品状态、资源能力或硬约束；
- 自动采用自己生成的 Proposal。

所有 `schedule_status <> cancelled` 的时间块及其 Buffer 都是占用。作用域内存在未解析但可能相交的历史时间块时，必须以稳定 hard diagnostic 阻断该资源/窗口，不能假设它无害。候选全集和 eligible subset 必须都使用同一个冻结查询/normalize 规则。

## 3. Canonical Resource Fact

### 3.1 资源目录

WO-05 必须新增独立的 canonical resource catalog。最小事实为：

```text
resourceId
v1DisplayPlace
status: active | inactive
capabilityJson / capabilityDigest
createdAt
updatedAt
sourceOperationId
```

规则：

- `resourceId` 是稳定身份，1–160 Unicode code points。WO-05 新路径必须使用单一共享 validator：以 `[...value].length` 计算 Unicode code points，拒绝空白首尾、控制字符、换行、U+2028/U+2029 和 lone surrogate；不得继续混用 JS UTF-16 `.length`；
- `v1DisplayPlace` 是生成 V1 session `place` 的稳定受控事实，不得只存在于可切换的 scheduling config 中；
- `v1DisplayPlace` 必须 trim 后不变、1–300 Unicode code points、拒绝控制字符/换行/U+2028/U+2029，并在整个 resource catalog 中唯一，使 active 与历史 inactive Schedule Item 的 V1 投影/反向兼容写入都不存在 label 歧义；
- capability 的 canonical owner 是 resource catalog；首批 `resource-capabilities-v1` 的 `capabilityJson` exact schema 固定为 `{ schemaVersion: 1, capabilityIds: string[] }`，`capabilityIds` 使用共享 identifier 规则、去重并按 Unicode code point 排序；`capabilityDigest` 对 domain-separated `{ domain: "resource-capabilities-v1", capabilityJson }` 的 canonical JSON 求 SHA-256。正文与 digest 必须同步变化，SchedulingInput 必须同时携带正文与 digest 并复算校验；scheduling config 只能引用 `resourceId + capabilityDigest`，不能维护第二份 capability 事实；未来扩展能力结构必须发布新的 capability schema version，不能在 v1 正文中静默加键或由 adapter 降维；
- 新正式 Schedule Item 只能引用 active resource；
- 资源创建、label/status/capability 变更只能通过 administrator 的 canonical application command；
- 任何 resource 创建、status 或 capability 变化都会增加全局 `scheduleRevision`，因此与变更同事务把全部 draft Proposal 保守转为 `stale`；仅 label 改名至少将引用该 resource 的 draft 与变更同事务 stale；采用时的事务内重算仍是最终防线；
- resource 创建、active/inactive 或调度能力变化会改变可排平面资源事实，因此同一事务增加一次 `scheduleRevision + projectionRevision`；
- 仅 `v1DisplayPlace` 受控改名不改变可排容量，只增加一次 `projectionRevision`，但因 digest 覆盖 V1 compatibility，仍使受影响的 draft Proposal stale；
- 不从历史 `legacy_place_text` 自动制造 resource；真实列表和 label 必须显式发布。

Migration v5 不根据既有 `schedule_items.resource_id` 或 `legacy_place_text` 自动回填 catalog。既有 resolved migration item 保持合法历史 occupancy，但对应 resource 在 administrator 明确执行 `RegisterSchedulingResourceV1` 前不能承接新 Proposal。注册命令必须显式给出 resource ID、唯一 V1 display place 和 capability；可以校验既有 migration batch 的 `resource_map_digest` 与该 ID 的历史使用，但不得从 legacy place 猜 display label 或 capability。

首批实现可以保持一个小型模块与一组 SQLite 语句，不得为每张表堆叠 Java 式 Repository/Manager/Factory 层。

## 4. Versioned Scheduling Configuration

### 4.1 不可变配置

`scheduling_config_versions` 保存发布后不可变的配置正文：

```text
configVersion
schemaVersion
algorithmVersion
calendarCompilerVersion
estimatePolicyVersion
configJson
configDigest
publishedBy
publishedAt
publishOperationId
```

另设单一 active pointer 与 append-only activation receipt。切换 active version 不修改旧配置正文。

配置至少包含：

```text
businessTimeZone              IANA zone
per-resource weekly windows
date closures / overrides
duration fallback policy
buffer rules
resource capability digest references
soft scoring weights
compatible algorithm versions
```

配置、嵌套对象和命令 DTO 使用 exact-key admission；数组唯一并按冻结语义排序；拒绝 `undefined`、非有限数字、重复 ID、重叠窗口和 unsafe object key。

### 4.2 不猜业务数值

本 ADP 不把 `Asia/Shanghai`、18:30、10 分钟或 35 分钟确认为真实运行值。fixture 可以使用明确标记的测试值，但本地 runtime 在没有已发布 active config 时必须返回 `SCHEDULING_CONFIG_NOT_ACTIVE`。

发布/激活配置只允许 trusted administrator。激活配置：

- 使全部 draft Proposal 保守变为 `stale`；
- 若 active config metadata 进入共享读投影，只增加一次 `projectionRevision`；
- 不增加 `scheduleRevision`；
- 不自动生成、采用或移动任何排期。

### 4.3 Calendar 与 Buffer 语义

Calendar compiler 将本地日历规则编译成显式 UTC half-open intervals：

```text
[windowStart, windowEnd)
```

调度核心不得读取系统 locale、默认时区或当前时钟。DST ambiguous/invalid、跨日解释不明确或窗口重叠必须失败关闭。

Buffer v1 定义为 Schedule Item 后置占用：

```text
[plannedStart, plannedEnd + bufferAfter)
```

业务任务与 Buffer 必须整体位于允许营业窗口内。采用后 `buffer_after_minutes` 保存解析后的整数分钟，`buffer_source` 必须引用所用 `configVersion`。未知 duration 且没有配置中的安全 fallback 时为 hard blocker。

历史 `buffer_after_minutes = NULL / buffer_source = legacy_unknown` 不得套用当前 config 或存储上限反推。只要 resolved resource 仍存在任一 non-cancelled legacy-unknown Buffer，该 resource 在整个 Proposal planning window 中失败关闭，并产生 `LEGACY_BUFFER_UNKNOWN`；只有 administrator 通过后续 canonical resolution command 写入显式 Buffer 后才恢复资格。只要存在 resource unresolved 的 non-cancelled block，全部 scoped resources 在整个 planning window 中失败关闭，并产生 `UNRESOLVED_LEGACY_BLOCK`，直到人工完成 resource/Buffer resolution。该规则宁可过度阻断，也不把未知历史事实伪装成有限安全区间。

## 5. Deterministic Scheduling Input

### 5.1 内部输入 DTO

调度器消费内部、低披露、不可变的 `SchedulingInputV1`，而不是公开 V2 Snapshot：

```text
schemaVersion
planningWindowStart / planningWindowEnd
businessTimeZone
baseScheduleRevision
algorithmVersion
calendarCompilerVersion
estimatePolicyVersion
configVersion / configDigest
resources[]
candidates[]
occupied[]
activeRuns[]
durationStats[]
```

输入必须显式携带 reference/planning time；纯核心不得读取 clock、DB、filesystem、random、network 或环境变量。

### 5.2 `inputDigest` 字节域

`inputDigest` 格式固定为 `sha256:<64 lowercase hex>`，内容是 UTF-8 canonical JSON。Canonicalization 必须：

- 对 object key 递归 code-point 排序；
- 对每个数组按文档冻结的语义键稳定排序；
- 时间归一为唯一 UTC 文本 `YYYY-MM-DDTHH:mm:ss.sssZ`；等价 offset 输入必须归一为相同字节；持续时间使用 safe integer milliseconds/minutes，`-0` 归一为 `0`；
- 拒绝 duplicate identifier、`undefined`、`NaN`、`Infinity`、稀疏数组和 unsafe object key；
- 拒绝 accessor、symbol、cycle、lone surrogate 和非 plain object；astral Unicode 按 code point 验证并保留 UTF-8 字节；
- 不把 `proposalId`、`createdAt`、actor display name 或自由文本放入算法结果摘要。

Digest 必须覆盖：

- scope 内全部候选 request 的规则相关结构化事实与 provenance；
- 显式 duration estimate、来源和版本；
- 全部非 cancelled occupancy、task binding、lock 和 Buffer；
- resource identity、status、capability 和 V1 display compatibility；
- 已编译 UTC calendar windows；
- config version + digest；
- algorithm、calendar compiler 和 estimate policy versions。

不得只 hash request IDs 或 `scheduleRevision`。无关的 `runRevision` / `projectionRevision` 变化，如果没有改变上述输入事实，不得单独改变 digest。

### 5.3 稳定结果

相同 normalized input、algorithm version 和 config version 必须生成 byte-equivalent：

```text
proposedItems + diagnostics
```

固定排序至少为：

```text
priority: p0 → p1 → p2 → unknown
desiredDate: earlier → later → null
sourceOrdinal
requestId
earliest available slot
resourceId
```

同分使用 Unicode code-point 排序，不使用 locale collation。`proposalItemId` 使用 domain-separated SHA-256：`spi_<64 lowercase hex>`，从冻结的 item canonical content 与 `proposal-item-v1` domain tag 计算，不能依赖 random、wall clock 或进程状态。Golden vectors 必须 pin 住该值。正式 `scheduleItemId` 不属于 Proposal deterministic result，在人工采用事务中按第 9 节生成。

## 6. Hard Constraints and Diagnostics

P0 只改变候选顺序，不能抵消 hard blocker。首批 hard code 至少包括：

```text
SAMPLE_NOT_VERIFIED
PRIORITY_UNKNOWN
DURATION_UNKNOWN
RESOURCE_UNKNOWN
RESOURCE_INACTIVE
RESOURCE_CAPABILITY_MISMATCH
RESOURCE_OVERLAP
OUTSIDE_BUSINESS_CALENDAR
LOCKED_INTERVAL_CONFLICT
UNRESOLVED_LEGACY_BLOCK
LEGACY_BUFFER_UNKNOWN
V1_DATE_BOUNDARY
```

首批 soft code 至少包括：

```text
LIGHTING_SWITCH
REFLECTIVITY_SEQUENCE
IDLE_GAP
EXPECTED_OVERRUN
DESIRED_DATE_MISS
```

Diagnostics 只保存 allowlisted code、受控 identifier 和结构化 field path；不保存 Brief、note、URL、附件名、原始事件或任意 provider 内容。UI 负责把 code 映射成人类文案。

## 7. Proposal Envelope and Persistence

Proposal 分为 immutable content 与 guarded lifecycle。Immutable content 创建后不可改写：

```text
proposalId
schemaVersion
baseScheduleRevision
algorithmVersion
calendarCompilerVersion
estimatePolicyVersion
configVersion
configDigest
planningWindowStart / planningWindowEnd
resourceScope
inputSnapshotJson
inputDigest
proposedItemsJson
diagnosticsJson
resultDigest
generationOperationId / generationCommandDigest
createdBy / createdAt
```

`resultDigest` 只覆盖 canonical `proposedItems + diagnostics + algorithm/config/compiler/estimate versions`，不覆盖 proposal identity、actor、createdAt 或 lifecycle。Lifecycle 只包含：

```text
status
terminalDecisionId?
lifecycleUpdatedAt
```

状态机固定为：

```text
draft → accepted
draft → partiallyAccepted
draft → rejected
draft → stale
```

只有 `draft` 非终态。四个终态均 sealed；immutable content 永远不可修改；lifecycle 只能以 `WHERE status = 'draft'` CAS 一次转到终态，并在同一事务插入唯一 decision receipt；禁止删除。主动 stale 使用同一 CAS 与 system receipt，不能只改 status。Proposal 创建、读取、拒绝和 stale 不增加 `scheduleRevision`。创建 Proposal 的流程固定为：

1. 在单一 SQLite `BEGIN DEFERRED` read snapshot 中读取全部输入后结束读事务；不得使用多次 autocommit 查询拼接“快照”；
2. normalize、计算 input digest 并运行纯核心；
3. 开启短 `BEGIN IMMEDIATE`；
4. 先检查 generation operation 幂等 receipt；
5. 重读当前 `scheduleRevision`、active config 和同一 digest 字段域；
6. 任一变化返回 `SCHEDULING_INPUT_CHANGED_RETRY`，不保存 draft；
7. 插入 Proposal、receipt 与最小审计后 commit。

纯计算不得长时间持有 SQLite 写锁。

## 8. Human Decision and Staleness

### 8.1 独立决策 receipt

`scheduling_proposal_decisions` 是一对一 append-only receipt，至少包含：

```text
decisionId / decisionCommandDigest
proposalId
decisionType: accept | partiallyAccept | reject | stale
selectedProposalItemIdsJson / selectionDigest
decidedBy / decidedAt
decisionNote
baseScheduleRevision / currentScheduleRevision / resultingScheduleRevision
decisionReceiptDigest
reasonCode
```

`decisionReceiptDigest` 覆盖该 decision row 的全部 canonical 业务字段，但不覆盖 digest 自身；它与 Proposal `resultDigest` 不是同一概念。`decisionNote` 限长，不进入调度输入、诊断或日志。相同 `decisionId + commandDigest` 返回原 receipt；相同 ID 不同内容返回 `IDEMPOTENCY_KEY_REUSE`。两个 decision 并发竞争同一 draft Proposal，只能一个 CAS 成功。

字段矩阵固定为：

| decisionType | Proposal status | selection | current/resulting revision | reasonCode | actor |
|---|---|---|---|---|---|
| `accept` | `accepted` | 全集；JSON/digest 必填 | current/resulting 必填 | `NULL` | trusted scheduler/admin |
| `partiallyAccept` | `partiallyAccepted` | 非空真子集；JSON/digest 必填 | current/resulting 必填 | `NULL` | trusted scheduler/admin |
| `reject` | `rejected` | 两者 `NULL` | 两者 `NULL` | `HUMAN_REJECTED` | trusted scheduler/admin |
| `stale` | `stale` | 两者 `NULL` | current 必填、resulting `NULL` | allowlisted stale reason 必填 | 触发采用的 trusted principal，或 `system:scheduling-invalidation-v1` |

所有行都必须保存 Proposal 的 `baseScheduleRevision`。system stale 的 `decisionId` 与 command digest 从触发变更 operation ID、proposal ID 和 reason code 的 canonical digest 确定性派生；exact replay 不重复插入。

### 8.2 选择集

- `accept` 必须选择全部 proposal item；
- `partiallyAccept` 必须选择非空真子集；
- selected IDs 必须唯一且属于 Proposal；
- `reject` 不包含选择集；handler 不执行 revision gate，但只允许当前仍为 draft 的 Proposal；若已被 proactive stale，则返回已有终态/`PROPOSAL_NOT_DRAFT`，不能覆盖 stale；
- partial 是一次性终态，未选项不能日后继续接受，必须重新生成 Proposal；
- 选择集应用必须 all-or-nothing，不能逐项部分提交。

### 8.3 Stale

采用路径必须在同一写事务重新检查：

- 当前 `scheduleRevision == baseScheduleRevision`；
- 重新计算的 `inputDigest` 完全一致；
- config version 仍 active 且 digest 相同；
- algorithm version 仍受支持；
- 所有 selected item 的 hard constraints 仍通过。

revision/input/config mismatch 将 draft 原子变为 `stale`，保存低披露 decision receipt，但不创建正式事实、不增加 schedule/projection revision、不写 schedule Outbox。任何增加全局 `scheduleRevision` 的变更必须在同一事务主动把全部 draft Proposal CAS 为 stale 并写 system receipt；config activation 同样在激活事务 stale 全部 draft；label-only 变化在同一事务 stale 引用该 resource 的 draft；任何会改变 candidate universe 或规则相关 request facts 的 request mutation 在同一事务保守 stale 全部 draft，即使它只增加 `projectionRevision`。采用事务内重算仍是最终防线。

## 9. Canonical Schedule Acceptance Gate

Proposal handler 不得直接写 `schedule_items`，也不得调用 V1 whole-snapshot PUT。`accept / partiallyAccept` 必须调用 canonical V2 schedule transactional kernel/application use case；该 kernel 必须接受已开启的 transaction context，不能内部再开连接或嵌套事务。全部步骤在调用方同一个 `BEGIN IMMEDIATE` 中完成：

```text
decision idempotency
→ read and require status = draft without transition
→ revision / digest / config / algorithm recheck
→ selected set hard-constraint revalidation
→ create canonical Schedule Item + single binding facts
→ scheduleRevision +1 and projectionRevision +1 exactly once
→ V1/V2 projections
→ operation receipt + minimal audit
→ one schedule.confirmed Outbox intent per created Schedule Item when that producer is wired
→ final CAS draft → accepted/partiallyAccepted + decision receipt
→ CAS every other draft → stale + deterministic system receipts
→ commit
```

若 revision/digest/config recheck 失败，成功路径的事实写入不得发生；同一事务改走 `CAS draft → stale + stale receipt` 后 commit。若普通 hard constraint、ID collision、ordinal exhaustion、projection 或 Outbox 构建失败，整个事务 rollback，Proposal 保持 draft。不得先把 Proposal 写成 accepted 再尝试改 stale，也不得用事务外二次补写终态。

采用生成的 Schedule Item 必须满足：

```text
scheduleStatus = confirmed
allocationMode = single
source = agent_proposal
sourceRef = proposalId
resource = resolved active resource
buffer = explicit config-derived value
lockStatus = unlocked
scheduleStatusProvenance = domain_command
exactly one canonical request binding
```

采用时为每个 selected item 生成 `scheduleItemId = ssi_<64 lowercase hex>`，digest 输入固定为 `schedule-item-v1 + decisionId + proposalItemId` 的无歧义 canonical tuple。ID 与分配结果写入 decision receipt；相同 decision exact replay 复用，新的 decision 不会因 item 内容相同而与已取消历史 PK 冲突。一次接受 N 项时，在同一 `BEGIN IMMEDIATE` 中读取 `coalesce(max(source_ordinal), -1)`，按 selected proposal item canonical order 连续分配 `max + 1 ... max + N`；结果超过 `Number.MAX_SAFE_INTEGER` 时以 `SCHEDULE_ORDINAL_EXHAUSTED` 失败关闭。失败不消耗 ordinal，exact replay 从 receipt 返回原 ID/ordinal。

采用不创建 Production Run。N 个 selected items 仍只增加一次 `scheduleRevision` 与一次 `projectionRevision`。当 schedule Outbox producer 接通时，每个新 Schedule Item 各写一条 ADP-022 `schedule.confirmed.v1` intent：`aggregateType = schedule_item`、`aggregateId = scheduleItemId`，共享 resulting `scheduleRevision`，但 dedupe key 按各 aggregate ID 独立。不得把 N 项重载成一个未冻结的 batch intent。任何一步失败全部回滚；exact replay 返回原 receipt，不重复 revision、projection、Outbox 或 audit。

当前仓库尚无该 canonical V2 schedule command 和完整 resource projection，因此：

```text
accept             = NOT_WIRED
partiallyAccept    = NOT_WIRED
schedule.confirmed producer from Proposal = NOT_WIRED
```

在前置能力完成前，API 必须不暴露上述动作，或稳定返回 `PROPOSAL_ACCEPT_NOT_WIRED` 且保持 Proposal 为 draft。不得用“临时 SQL”缩短路径。

## 10. Authorization Boundary

- Proposal generate/read/reject/accept 只接受 trusted `scheduler` 或 `administrator` principal；
- resource/config publish/activate 只接受 trusted `administrator`；
- 每个 resource 必须通过 principal resource scope；
- body 中的 actor/role/subjectId 不构成权威身份；
- V2.1 禁止 Agent、background worker、callback 或 LLM 自动调用 acceptance；
- 首批实现可以复用既有 `modifySchedule` / `administer` capability；若未来需要独立审计能力名，再以兼容方式扩展，不为抽象完整性提前膨胀权限枚举。

普通 V2 schedule HTTP 的可信 principal adapter 当前仍未接线。应用 use case 与测试 principal 完成不等于生产 authentication 已完成。

## 11. Sample Qualification

样本分为三级，不得混称：

### Level A：OperationalDurationSample

可用于低置信 retrospective duration baseline，必须同时满足：

- task scope，且 Schedule Item 只有一个 request binding；
- Production Run 已完成；
- event chain 按版本化规则 replay-valid；
- metrics algorithm/version 已知；
- net duration 为正 safe integer；
- 没有 pending review；`sample-classifier-v1` 对任何 correction provenance 固定以 `CORRECTION_PRESENT` 排除，直到后续版本明确列出可证明不影响指标的 correction allowlist；
- 不是 cancelled、grouped、legacy synthesized 或 incomplete chain。

### Level B：ModelFeatureSample

除 Level A 外，还必须有 run start 时保存的 immutable rule-context snapshot，能证明当时的 production type、shooting subtype、lighting、reflectivity、resource/config/version 等输入。现有历史数据不得事后猜测回填。

### Level C：ShadowEvaluationCase

除 Level B 外，还必须有完整的历史 scheduling input、Proposal、人工 item-level decision/diff 和可归因 outcome。只有 Level C 可以计算 Agent shadow acceptance/override 等指标。

`grouped_unallocated` 只能作为完整 occupancy，不得进入单任务 duration/model 样本。视频交付物 `durationSeconds` 是成片时长，不是拍摄工时；deliverable count 也不能当作工时。

### 11.1 Future run-context capture

为了从现在开始形成 Level B 证据，migration v5 后所有可以创建 run 的 canonical first-start 路径（Kiosk 与 generic application use case）必须在权威事务中至多写入一条 `scheduling_run_context_snapshots`。任何未接入 capture 的其他入口所创建 run 永久不具备 Level B 资格：

- 与 run 创建、first-start event、run/projection revision、projection、receipt 和 audit 在同一事务；
- exact event replay 返回原 receipt，不重复 snapshot；同一 run 的 snapshot 禁止 update/delete；
- snapshot 只保存 `runId/scope/scheduleItemId/requestId?/resourceId`、production type/subtype、lighting、reflectivity、resolved duration estimate+provenance/version、Buffer+source、resource capability digest、active config version/digest、capture schema version、context status、capturedAt 和 snapshot digest；
- 不保存 client、requestedBy、Brief、note、URL、附件、actor/device、原始事件或 provider 内容；
- single run 且所有字段完整才可标记 `complete`；grouped、缺配置或缺规则事实保存 `ineligible` 与 allowlisted reason，不得事后猜测补全；
- snapshot 插入属于既有 first-start 事务的证据写入，不额外增加 `scheduleRevision`、`runRevision` 或 `projectionRevision`；该事务仍只按 ADP-017 的 run-create 规则增加一次对应 revision；
- `capturedAt` 使用注入的事务 clock、采用唯一 UTC 文本格式，并排除在事实内容 digest 外；其余 snapshot content canonicalized 后计算 digest。

现有历史 run 不回填该 snapshot。加入 capture 是未来样本建设，不会把既有样本自动升级为 Level B。

## 12. Offline Shadow Evaluation

离线 evaluator 只读取 checked-in fixture 或显式批准的低披露 dataset，不访问网络、provider、环境凭据或生产数据库。每份报告固定记录：

```text
datasetDigest
algorithmVersion
configVersion / configDigest
metricDefinitionVersion
eligibility counts
exclusion counts by stable reason code
metrics with numerator / denominator
generatedAt outside result digest
```

首批 `metricDefinitionVersion = shadow-metrics-v1` 固定使用 dataset manifest 的 `windowStart/windowEnd/outcomeCutoff`。事件发生在 cutoff 后、cutoff 时仍无完整 outcome、版本不支持或资格不完整的 case 以 stable exclusion code 排除，不做右截尾猜测。原始 duration observation 使用整数 milliseconds；偶数样本 median 允许精确的 `.5ms`，metric value schema 因此使用有限非负 number，其他 duration metric 保持整数：

| Metric | Cohort / denominator | 可复现计算 |
|---|---|---|
| median absolute duration error | Level C、单任务、存在 Proposal predicted duration 与合格 actual net duration 的 items | 排序 `abs(predictedMs - actualNetMs)`；奇数取中值，偶数取中间两值算术平均 |
| P90 overrun | 同上 | `max(actualNetMs - predictedMs, 0)` 排序，nearest-rank `ceil(0.9 * n)`（1-based） |
| setup buffer miss rate | Level C 中同时有显式 measured setup duration 与 proposed buffer 的 transition | numerator 为 `measuredSetupMs > bufferMs`；不得用两次 run 的空档或成片时长冒充 setup measurement |
| hard conflict count | 全部 Level C proposed items | 用冻结 hard-validator version 对原始 input 重放；报告冲突 item 数和总 item 数 |
| human override rate | 有确定 item-level human decision 且在 cutoff 前有 final human schedule/diff 的 Level C proposed items | rejected/unselected，或最终 `resource/start/end/buffer` 任一不同即为 override |
| priority violation count | 同一 Level C input 中可竞争的 eligible candidate pair | 若较低 priority item 占用某 slot，而较高 priority item在该 slot/同资源通过全部 hard constraints 却更晚或未排，计 1 个有序 pair；报告 pair count 与 comparable-pair denominator |

Level B 可以另报 `retrospectiveDurationBaseline`，公式与 duration 两项相同，但其中 `predictedMs` 必须来自 run-context snapshot 的 resolved duration estimate，而不是 Proposal；报告必须明确标为 baseline，不能冒充 Agent shadow metric。`setup buffer miss rate` 在没有显式 setup measurement schema 前必然无分母。

任何 metric 没有合格分母时，机器状态固定为 `NOT_ENOUGH_DATA`、`value = null`；`N/A` 只用于 UI 展示，不存在 `N-A` 机器值。不得输出 0 或 PASS。当前 checked-in fixtures 的严格 task-level 完成样本为 0，因此真实 WO-05 shadow acceptance gate 为：

```text
BLOCKED_DATA
```

这不阻止纯函数、schema、fixture 和 Proposal generate/read/reject 的本地实现，但阻止声称“真实影子指标达标”。阈值只能在基线样本形成后用后续决策冻结；指标达标也不会自动扩大 Agent 权限，仍需新 ADP 和 Jenn 的明确授权。

## 13. 分批实施与门禁

```text
WO-05A  Architecture + contracts + canonical digest/golden vectors
WO-05B  Pure scheduler + calendar/buffer/duration policy + deterministic tests
WO-05C  Resource/config/proposal/decision persistence + generate/read/reject
WO-05D  Canonical V2 schedule command + human accept/partial + schedule Outbox
WO-05E  Sample capture + offline evaluator + low-disclosure report + integration review
```

05D 不得在 05C 中偷渡。05E 在没有 Level C 样本时只能交付 evaluator 和诚实的 `BLOCKED_DATA` 报告，不能关闭真实 shadow gate。

## 14. Windows and Cross-platform Boundary

- 纯算法、canonical JSON、digest 和 fixture 禁止依赖 POSIX path、`flock`、shell、`/tmp`、locale 或文件 rename lock；
- path 测试使用仓库已有跨平台相等语义；
- 测试不依赖真实 sleep 或 wall clock；
- Linux 本地通过不能声明 Windows-ready；只有 Windows runner/真机证据可把 `WINDOWS_NOT_RUN` 改为 PASS。

## 15. 停止条件

以下情况必须停止当前工作包：

- 需要真实 LLM/provider、外部 runner、网络、凭据/env/auth provider 配置；
- 需要读取或写入生产/真实业务数据库；
- 试图由 V1 whole-snapshot PUT 或直接 SQL 接受 Proposal；
- 试图猜测真实资源、时区、营业时间、闭棚边界、Buffer 或 duration policy；
- 试图自动接受、自动移动正式排期或绕过 trusted principal/revision/hard constraints；
- 试图把 grouped block、legacy synthesized run 或不完整事件链伪装成训练/评估样本；
- 需要 Switch、部署、发布或权限扩大。

## 16. 验收不变量

1. 相同 normalized input/version/config 的结果 byte-equivalent；
2. 输入数组乱序不改变结果或 digest；
3. 任一规则相关 request/resource/calendar/config/occupancy 变化都会改变 digest；
4. 无关 run/projection revision 不单独改变 digest；
5. P0 不能越过任一 hard blocker；
6. grouped block 不被拆分或用于单任务估时；
7. Proposal 创建/拒绝/stale 不修改正式排期 revision；
8. Proposal payload immutable，终态 sealed，decision one-shot；
9. accept/partial 在 canonical command 未完成前保持 NOT_WIRED；
10. evaluator 无样本时返回 `NOT_ENOUGH_DATA + value:null`，不伪造 0、PASS 或阈值；
11. 默认测试无网络、provider、环境凭据或生产数据；
12. Windows 未执行时明确记录 `WINDOWS_NOT_RUN`。

## 17. 结论

WO-05 的架构升级是边界补全，不是重写既有模块化单体。调度器的可信核心是版本化结构化事实、确定性纯函数、完整 input digest 和人工 canonical command；Agent 只是 Proposal 来源。当前可以推进本地能力，但真实 shadow acceptance 必须保持 `BLOCKED_DATA`，正式 accept/partial 必须保持 `NOT_WIRED`，直到各自前置事实真实成立。
