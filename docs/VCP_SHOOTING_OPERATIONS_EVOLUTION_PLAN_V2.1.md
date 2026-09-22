# VCP 摄制运营调度工作台升级与 Agent 协同演进实施计划书（V2.1）

- 文档状态：`REVIEW_READY`
- 修订日期：2026-09-22
- 适用项目：`jenn-shooting-operations`
- 当前范围：本地设计、实现、迁移演练与验证
- 明确不包含：生产部署、真实钉钉凭据接入、真实外部通知、发布与切流
- 有效冻结架构基线：[Architecture Baseline Index V2.1](architecture/ARCHITECTURE_BASELINE_INDEX_V2.1.md)

## 0. 执行摘要

本计划用于将现有摄制收单与排班服务演进为连接“需求提报”“摄影棚现场执行”“VCP 排班工作台”和“钉钉协同通知”的摄制运营中枢。

V2.1 不再把这次升级视为对现有 Schema 的原地替换，而采用以下演进路线：

```text
现有 V1 服务
  ├─ 保留：需求提报、附件、幂等、revision、审计、备份、上传清理
  ├─ 新增：V2 规范化领域数据、状态事件、现场 Kiosk、通知 Outbox
  ├─ 兼容：持续生成 V1 Snapshot，避免当前看板与 VCP 接口突然失效
  └─ 演进：采集有效样本后，让 Agent 先影子建议，再由人工确认排期
```

本次修订锁定六项原则：

1. SQLite 服务端数据库是业务事实的唯一权威来源。
2. 钉钉是通知与交互投影，不是 SSOT；钉钉故障不得破坏核心收单和现场状态。
3. V1 契约不得被原地破坏；V2 通过新版本契约、迁移器和兼容投影接入。
4. 现场状态机与工时采样先于真实钉钉集成落地。
5. Agent 只生成建议，不自动覆盖已确认排班；人工确认是硬锁边界。
6. 部署、凭据、真实通知和生产切流继续受独立授权门控制。

---

## 1. 已核实的当前基线

### 1.1 当前共享数据模型

现有排班契约为 `schemaVersion: 1`，核心共享字段是：

```text
products
tasks
sessions
revision
updatedAt
```

当前不存在 `slots` 或 `timeline` 数组。`sessions` 通过 `ids` 引用一个或多个任务，使用 `date + start + end` 表达场次。

### 1.2 当前需求提报模型

现有请求为扁平 JSON，主要字段包括：

```text
schemaVersion
operationId
productionType
sku
name
kind
shootingSubtype
aspectRatio
deliver / deliverableCount
requestedBy
desiredDate
note
uploadIds
```

附件先绑定 `operationId`，请求保存成功后再认领到任务。现有文件类型、签名、数量、容量、哈希去重和孤立上传清理保护必须继续保留。

### 1.3 当前存储和并发模型

当前服务已经使用 `node:sqlite`、WAL、`BEGIN IMMEDIATE`、幂等操作记录、审计记录和 revision 乐观并发控制。共享排班目前以版本化 JSON Snapshot 存放在 `schedule_state` 中。

V2.1 将引入规范化业务表，但不得回退或削弱现有能力：

- `operationId` 幂等；
- `If-Match` / revision 冲突保护；
- 写接口鉴权失败关闭；
- 附件引用完整性；
- 在线上传与孤立上传清理的跨进程互斥；
- 清理 tombstone 恢复；
- 最小披露审计；
- 备份与恢复能力。

### 1.4 当前 VCP 集成状态

仓库保留了 VCP 同步集成测试，但外部 `shootingPlannerSyncService.js` 不在当前工作区时测试会明确跳过。因此，“VCP 适配器可用”不能仅凭本仓库测试推定，V2.1 必须设置独立的适配器恢复与契约验证门。

### 1.5 当前运行时基线

- Docker 当前使用 `node:24-alpine`；
- `package.json` 当前声明 `node >=22.13.0`；
- 从 Node.js 22.13.0 起，`node:sqlite` 不再要求 `--experimental-sqlite`；
- V2.1 不添加过时的 `--experimental-sqlite` 参数；
- 容器目标保持受支持的 Node 24 LTS，并在依赖验证后固定可复现版本或镜像 digest；
- 不以“秒级构建”作为验收条件，以可复现构建和健康检查为准。

---

## 2. 产品目标、边界与非目标

### 2.1 产品目标

V2.1 完成后，系统应支持：

1. 美工或需求方提交结构化拍摄需求和视觉参考；
2. 调度员在 VCP 工作台中形成连续时间轴排期；
3. 现场人员通过 Kiosk 上报开始、阻塞、恢复、完成；
4. 服务端生成可信的计划时长、实际总时长和有效净工时；
5. 钉钉接收事务提交后的通知，并可提交受控交互动作；
6. Agent 基于真实样本生成排期建议、漂移预测和冲突诊断；
7. 所有正式排期变化均由授权人员确认并产生新 revision。

### 2.2 明确非目标

本计划不负责：

- AI 视频生成、审片或成片交付；
- NAS/群晖在线素材库管理；
- 自动发布、自动生产部署或自动切流；
- Agent 无人值守修改正式排班；
- 在日志中输出完整 Brief、附件内容、凭据或钉钉原始载荷；
- 以钉钉、浏览器 localStorage 或 VCP 本地缓存替代服务端事实源。

---

## 3. 目标架构与事实源划分

```text
需求提报页 ──┐
现场 Kiosk ──┼──► jenn-shooting-operations API ──► SQLite 事实源
VCP 工作台 ──┘                 │                    │
                               │                    ├─ V2 Snapshot 投影
                               │                    ├─ V1 兼容投影
                               │                    └─ 通知 Outbox
                               │                              │
                               └──────────────────────────────► 钉钉适配器

Agent 调度器读取事实源和统计投影，只输出 Proposal；
授权调度员确认后，Proposal 才能成为正式排期。
```

### 3.1 唯一事实源

SQLite 中已提交的领域记录和事件是唯一业务事实。以下内容都只是投影：

- V1/V2 Snapshot；
- 网页看板；
- VCP 本地镜像；
- 钉钉卡片；
- Kiosk 当前画面；
- Agent Proposal；
- 离线事件队列。

### 3.2 投影一致性

规范化业务写入、对应作用域 revision 自增、Snapshot 更新和 Outbox 入队必须在同一个 SQLite 事务中完成。V2.1 使用 `scheduleRevision`、`runRevision` 和 `projectionRevision` 三个明确作用域；具体语义以 ADP-017 为准。

事务提交之后才允许执行：

- 网络通知；
- SSE/轮询更新；
- 可选的文件导出；
- 其他外部副作用。

任何外部副作用失败都不得回滚已经提交的业务事实，而应保留可重试、可审计的失败状态。

### 3.3 V1 兼容策略

迁移期间继续提供：

```text
GET  /api/v1/snapshot
POST /api/v1/requests
POST /api/v1/uploads
PUT  /api/v1/snapshot
```

新增 V2 API 不复用 V1 路径。V1 客户端只有在兼容投影通过契约测试和真实 Fixture 验证后才允许切换底层读取来源。

---

## 4. V2 领域契约

### 4.1 命名规则

- API 和 JSON 使用现有项目一致的 `camelCase`；
- SQLite 列使用 `snake_case`；
- ID 是不透明字符串，不编码业务含义；
- 时间持久化为带时区的 ISO 8601 UTC；
- 展示时区由显式 `businessTimeZone` 配置决定，不依赖宿主机隐式时区；
- 枚举值一经发布不得静默改义。

### 4.2 Request V2

建议新增 `contracts/request-submission.v2.schema.json`，不原地改写 V1 `$id`。

核心字段：

```text
schemaVersion: 2
operationId
productionType
sku
name
kind
shootingSubtype
aspectRatio
deliverables
requestedBy
desiredDate
note
coreBriefSummary
briefUrl?
heroAssetId?
sampleStatus
sampleShelfId?
lightingPreset
reflectivity
priority
uploadIds[]
```

字段规则：

- `coreBriefSummary` 必填，最大 100 个 Unicode 字符；
- `briefUrl` 选填，并进行协议与允许域名校验；不得把“必须存在钉钉链接”作为离线收单前提；
- `heroAssetId` 优先引用已有受控上传，不直接接受任意外部图片 URL；
- `sampleStatus` 使用 `arrivedVerified | inTransit | unavailable`；
- `sampleShelfId` 在 `arrivedVerified` 时允许填写，但是否必填由业务规则配置；
- `lightingPreset` 和 `reflectivity` 允许 `unknown`，避免提报人伪造专业判断；
- 平面和视频 `deliverables` 使用判别联合结构，保持字段互斥；
- V1 历史记录迁移时允许缺省值 `unknown`，不得伪造钉钉链接或货架位。

### 4.3 优先级

持久化字段只使用：

```text
priority: p0 | p1 | p2
```

语义固定为：

| 值 | 业务语义 | 排序等级 |
|---|---|---:|
| `p0` | 紧急加急 | 300 |
| `p1` | 常规排期 | 200 |
| `p2` | 长尾备选 | 100 |

数值等级只由服务端派生，不同时持久化 `priority` 与可冲突的 `urgencyWeight`。

### 4.4 Schedule Item V2

连续时间轴的最小事实字段：

```text
id
taskBindings[]
allocationMode: single | groupedUnallocated
resourceId
plannedStart
plannedEnd
bufferAfterMinutes
scheduleStatus: draft | confirmed | cancelled
lockStatus: unlocked | locked | null
source: human | agentProposal | migration
createdAt
updatedAt
```

规则：

- `plannedEnd` 必须晚于 `plannedStart`；
- 数据库中任务关系通过 `schedule_item_tasks` 表达，`taskBindings[]` 只是读投影；
- V1 多任务 session 迁移为 `groupedUnallocated`，不得自动平均分配单任务时长；
- 同一 `resourceId` 的已确认项目不得物理重叠；
- `completed/cancelled` 现场状态属于 Production Run，不得借用 Schedule lock 字段表达；
- V2 Schedule Item 不允许裸 `revision`，排期命令只使用 `expectedScheduleRevision`；
- `nextStart` 是派生值，不持久化为独立事实；
- `diagnostics` 是读模型，不进入排期事实表；
- 缓冲时间来自版本化配置或测量模型，不把 10/35 分钟永久硬编码进领域事实；
- 多摄影棚、多机位或多人并行通过显式 `resourceId` 表达，不能假设系统永远只有单通道。

### 4.5 现场运行状态

状态集合：

```text
scheduled
shooting
blocked
completed
cancelled
```

常规转换：

```text
scheduled ──start────► shooting
shooting  ──block────► blocked
blocked   ──resume───► shooting
shooting  ──complete─► completed
scheduled ──cancel───► cancelled
blocked   ──cancel───► cancelled
```

异常修正不得删除或改写旧事件。由授权角色提交 `correction` 事件，记录原因、操作者和被修正事件。

阻塞原因初始枚举：

```text
sampleWaiting
specConfirming
deviceIssue
talentWaiting
siteIssue
other
```

选择 `other` 时必须提供短说明。阻塞原因可以新增，但已有枚举不得改义。

### 4.6 事件契约与离线重放

每个现场动作都提交一个不可重复的事件：

```text
eventId
scheduleItemId
eventType
expectedRunRevision
occurredAt
deviceId
actorId
reason?
note?
```

服务端补充：

```text
receivedAt
previousState
resultingState
resultingRevision
```

约束：

- `eventId` 唯一，同一事件重放返回原结果；
- `expectedRunRevision` 不匹配返回 `409 REVISION_CONFLICT`；
- 成功的现场事件增加对应 `runRevision` 和共享 `projectionRevision`，但不得仅因状态打点增加 `scheduleRevision`；
- 服务端校验状态转换，不信任客户端给出的 `previousState`；
- `occurredAt` 超出允许时钟漂移范围时进入人工复核，不直接污染工时；
- 离线队列按本机序列顺序重放，遇到第一个冲突立即停止；
- 客户端只有收到成功或明确的幂等重放结果后才能删除队列项；
- 离线待发送状态必须在界面上明确标识，不得伪装成已同步。

### 4.7 工时计算

```text
grossDuration = completedAt - startedAt
blockedDuration = 所有有效 block/resume 区间之和
netDuration = grossDuration - blockedDuration
```

补充规则：

- 未闭合的阻塞区间不能生成最终净工时；
- 取消任务不进入常规完成样本；
- 人工修正必须保留原始事件并重新物化统计；
- 统计样本记录算法和规则版本；
- 计划书所称“纯净工时”仅指剔除已标注阻塞，不代表绝对生产效率或绩效结论。

---

## 5. 目标存储模型

建议在保留现有表的前提下增量添加：

```text
schema_migrations
product_catalog_entries
requests_v2
schedule_items
schedule_item_tasks
legacy_asset_entries
production_runs
production_events
snapshot_projections
notification_outbox
scheduling_proposals
scheduling_config_versions
legacy_compat_fragments
```

现有表继续保留：

```text
schedule_state
operations
audit_log
uploads
```

关键约束：

- 所有迁移有单调版本号并在事务中执行；
- 初次 V2 迁移不删除 V1 表或列；
- 外键保持开启；
- `production_events.event_id` 唯一；
- `requests_v2.id` 是 canonical work item ID，V1 `task.id` 和 binding `task_id` 均映射到它；
- Outbox 事件有稳定去重键；
- `projectionRevision` 作为 Snapshot/投影版本全局单调递增；
- 上传记录和附件文件的引用、清理与恢复逻辑不因新表引入而失效；
- 数据库事务内不执行网络请求，也不把普通文件写入伪装成数据库原子事务。

### 5.1 Snapshot 投影

至少生成两个投影：

1. `schedule-v2`：完整时间轴、现场状态和派生诊断；
2. `schedule-v1-compat`：继续满足现有 `products/tasks/sessions` 契约。

每个投影记录：

```text
projectionName
schemaVersion
revision
updatedAt
payloadJson
sourceSchemaVersion
```

V1 兼容投影无法无损表达的 V2 字段不得偷偷塞进 V1 扩展字段；它们只在 V2 API 中出现。

---

## 6. 演进阶段与准入门

| 阶段 | 核心目标 | 主要交付物 | 进入条件 | 退出条件 |
|---|---|---|---|---|
| **P0：基线与迁移设计** | 冻结事实、建立映射和回滚方案 | 字段映射、ADR、迁移 Fixture、风险清单 | 当前仓库可验证 | 映射无未决破坏项 |
| **P1：V2 契约与兼容投影** | 新增版本化契约，不破坏 V1 | V2 Schema、校验器、V1/V2 投影测试 | P0 通过 | 旧 UI/VCP Fixture 继续通过 |
| **P2：规范化存储与状态机** | 建立服务端权威事件和工时计算 | 迁移器、事件表、状态转换 API、回滚演练 | P1 通过 | 幂等、并发、迁移、恢复测试通过 |
| **P3：Kiosk 与样本采集** | 现场可靠上报与离线重放 | Kiosk、事件队列、同步状态、统计投影 | P2 通过 | 模拟与真机验收通过 |
| **P4：钉钉协同** | 事务后通知和受控卡片交互 | Outbox、适配器、Mock、卡片回调验证 | P2 稳定；凭据另行授权 | 无凭据本地测试通过；真实联调单独授权 |
| **P5：VCP Agent 影子调度** | 生成建议、漂移和冲突诊断 | 调度引擎、评估报告、人工确认流 | 足量且合格的真实样本 | 建议质量达标，仍不自动写正式排期 |
| **P6：部署与渐进切流** | 受控生产上线 | 备份、回滚、监控、切流记录 | 独立生产授权 | 另行定义，不由本计划自动触发 |

依赖关系：

```text
P0 → P1 → P2 → P3 → P5
                 └────→ P4

P4 不阻塞 P3；P5 可以在没有真实钉钉的情况下使用本地数据影子运行。
```

---

## 7. 迁移、兼容与回滚策略

### 7.1 迁移原则

- 先读后写，先影子后切换；
- 不在首个迁移中删除 V1 数据；
- 不伪造历史字段；
- 每个迁移可重复检测，但不可重复写入；
- 每次迁移输出计数和摘要，不输出 Brief、附件名或私人内容；
- 数据量、关联数、revision 和抽样记录必须可核对。

### 7.2 Current → V2 映射

| Current | V2 | 规则 |
|---|---|---|
| `task.id` | `request/task id` | 保留原 ID |
| `task.sku/name/client/deliver/kind` | Request V2 对应字段 | 无损复制 |
| `task.request.*` | Request V2 | 已有值复制；新增字段填 `unknown` 或空值 |
| `task.assets[]` | 受控资产引用 | 保留现有 upload/asset ID 与摘要 |
| `session.id` | `scheduleItem.id` | 保留原 ID或记录旧 ID 映射 |
| `session.ids[]` | Schedule Item + Task Bindings | 单任务映射为 `single`；多任务保留为 `groupedUnallocated`，不得猜测各任务时长 |
| `date/start/end` | `plannedStart/plannedEnd` | 使用明确业务时区转换为 UTC |
| `task.status` | 请求/运行状态 | `pending/scheduled/completed/cancelled` 显式映射 |
| 缺失现场事件 | 无历史事件 | 不反推或伪造开始、阻塞、完成时间 |

`session.ids` 包含多个任务时，是迁移中最重要的不确定点。默认不得平均分割时长。必须通过 `schedule_item_tasks` 保留为一个 `groupedUnallocated` 时间块，待调度员确认后再拆分为单任务时间轴项目；未拆分的 block-level 工时不得进入单任务估时样本。

### 7.3 迁移演练

迁移器必须支持：

```text
--dry-run       只验证和报告
--source        指定受控输入数据库或 Fixture
--target        指定隔离目标数据库
--verify-only   只运行迁移后核验
```

不得提供默认连接生产数据库的行为。迁移验证至少包括：

- V1/V2 记录数和引用完整性；
- 多任务 session 未被静默拆错；
- revision 单调；
- 附件仍可被对应任务读取；
- V1 兼容 Snapshot 通过原校验器；
- 迁移前后备份可恢复；
- 重复运行不会产生重复记录。

### 7.4 回滚

在正式切流前保持 V1 写路径可恢复。回滚点至少包含：

- 迁移前 SQLite 一致性备份；
- 上传卷引用核对；
- 当前代码版本；
- Schema migration 版本；
- VCP 客户端兼容版本。

回滚不得通过删库、覆盖上传目录或 `git reset --hard` 完成。

---

## 8. Kiosk 与现场协作设计

### 8.1 界面要求

Kiosk 使用全屏、深色、高对比、大触控目标，显示：

- 当前任务 SKU、名称、受控封面；
- 100 字核心摘要；
- 当前状态和持续时间；
- 同步状态：已同步 / 待发送 / 冲突 / 需人工处理；
- 开始、挂起、恢复、完成按钮；
- 阻塞原因选择；
- 下一任务和已确认计划时间。

所有关键动作必须有防连点和结果反馈。完成动作需要二次确认，但不得设计成难以操作的长流程。

### 8.2 服务端接口

建议接口：

```text
GET  /api/v2/kiosk/current
POST /api/v2/schedule-items/:id/events
GET  /api/v2/snapshot
GET  /api/v2/updates          # SSE；不支持时退化为有限轮询
```

Kiosk 只能提交状态事件，不能修改计划开始/结束时间、优先级或资源分配。

### 8.3 离线行为

localStorage 只保存待发送事件和最小展示缓存，不保存权威状态。恢复网络时：

1. 先刷新服务端 revision；
2. 按本地序列重放事件；
3. 成功或幂等命中后删除对应事件；
4. 出现冲突即停止；
5. 显示冲突详情并交给授权调度员处理。

---

## 9. 钉钉协同设计

### 9.1 定位

钉钉只承担：

- 新需求通知；
- 排期确认或变更通知；
- 完成通知；
- 指向工作台和受控 Brief 的入口；
- 经验证后的有限卡片动作。

钉钉不承担：

- 业务数据唯一存储；
- 无鉴权地修改排期；
- 在卡片载荷中长期保存完整业务敏感内容；
- 服务端数据库不可用时的替代写入通道。

### 9.2 Adapter 与 Mock

定义稳定接口：

```text
sendCard(message)
updateCard(cardInstanceId, patch)
verifyActionCallback(input)
```

要求：

- 测试通过显式依赖注入使用 Mock；
- 本地开发可显式设置 Mock，并在日志和 UI 中标识；
- 非测试环境缺少配置时返回 `DINGTALK_NOT_CONFIGURED`，不得静默伪造成功；
- Mock 不输出完整 Brief、链接查询参数、附件名或人员敏感字段；
- 单元和集成测试禁止真实网络请求。

### 9.3 Transactional Outbox

业务事务只写入 `notification_outbox`，异步投递器负责发送。每条消息包含：

```text
outboxId
eventType
aggregateId
aggregateRevision
dedupeKey
payloadSummary
status
attemptCount
nextAttemptAt
lastErrorCode
createdAt / sentAt
```

使用去重键避免重试导致重复通知。重试使用有限指数退避，超过上限进入人工重试队列。

### 9.4 卡片动作安全

真实联调前必须具备：

- 官方签名/来源验证；
- 时间戳和 nonce 重放保护；
- 卡片实例与内部实体绑定；
- 操作者身份映射和角色授权；
- `eventId` / `operationId` 幂等；
- revision 冲突检测；
- 允许动作白名单；
- 最小披露审计。

任何验证失败都不得执行状态变化。

---

## 10. VCP Agent 调度与漂移治理

### 10.1 调度输入

Agent 只能读取已授权的结构化字段：

- priority；
- sampleStatus；
- lightingPreset；
- reflectivity；
- 计划/实际净工时统计；
- resourceId 与营业边界；
- 已确认锁和不可移动区间；
- 版本化缓冲配置。

不得从未确认的自由文本自动推断高影响优先级、样品状态或强制排期约束。

### 10.2 硬约束

- 样品未验证到棚；
- 同一资源时间重叠；
- 超出明确营业或安全边界；
- 已确认不可移动锁；
- 缺失必要资源；
- 任务持续时间未知且没有安全缺省策略。

硬约束不满足时只能报告，不能自动绕过。

### 10.3 软约束

- 切换布光成本；
- 反光材质顺序；
- 空闲间隙；
- 预计延误；
- 同类任务聚类；
- 人工偏好。

软约束必须产生可解释的诊断代码，不只输出一个最终顺序。

### 10.4 分层调度

```text
Step 1  过滤硬阻断任务
Step 2  按 p0 → p1 → p2 分层
Step 3  在同层级内按资源可用性与已确认锁切分窗口
Step 4  在窗口内评估布光/材质切换成本
Step 5  注入版本化 Buffer，生成 Proposal
Step 6  运行冲突检测并输出解释
Step 7  由调度员确认、部分采用或拒绝
```

P0 优先是默认规则，但不能绕过样品未到、物理重叠、安全闭棚等硬约束。

### 10.5 Soft Drift 与 Hard Confirm

- 现场事件只更新实际进度和预估漂移；
- 预估漂移以视觉虚线或建议区间展示；
- 不自动改写 `plannedStart/plannedEnd`；
- 只有授权调度员点击确认后才生成新 revision；
- 确认写入成功后才创建通知 Outbox；
- 冲突时必须刷新，不得覆盖他人变更。

### 10.6 进入影子调度的样本门

“至少 30 组样本”只是最低数量，不是唯一条件。进入 P5 前还需满足：

- 样本来自已完成且事件闭合的任务；
- 覆盖主要拍摄类型与布光类型；
- 异常修正和取消样本被正确排除或标记；
- 阻塞原因质量达到可分析水平；
- 已确定基线指标：时长误差、P90 超时、Buffer 充足率、人工改写率；
- 规则和配置带版本号，可复现实验结果。

影子阶段至少评估：

```text
median absolute duration error
P90 overrun
setup buffer miss rate
hard conflict count
human override rate
priority violation count
```

在人工接受度和安全指标达标前，Agent 不得自动写入正式排期。

---

## 11. 实施工作包

所有工作包遵守：一次只改变一个清晰边界；先测试再接下一阶段；不得在同一工作包顺带部署、配置真实凭据或发送真实消息。

### WO-00：基线冻结与迁移设计

**目标**

建立可验证的 Current → V2 映射，不改生产行为。

**交付物**

- 字段映射矩阵；
- 事实源与投影 ADR；
- 多任务 session 的迁移决策；
- V1、V2、非法输入 Fixture；
- 迁移 dry-run 规范；
- VCP 外部适配器存在性与版本检查。

**验收**

- 当前 `npm run check` 通过；
- V1 Fixture 可重复验证；
- 所有无法无损映射的字段被明确列出；
- 没有文件、数据库或外部系统写入。

### WO-01：V2 契约、校验器与兼容投影

**目标**

新增版本化 V2 契约，不原地破坏 V1。

**交付物**

- `request-submission.v2.schema.json`；
- `schedule-snapshot.v2.schema.json`；
- V2 校验器；
- V1 ↔ 内部模型 ↔ V2 的显式投影器；
- 契约正向和负向测试。

**验收**

- V1 全部已有测试继续通过；
- V2 必填、条件字段、枚举和时间关系均有负向测试；
- `nextStart`、diagnostics 等派生字段不成为重复事实源；
- 无真实数据迁移和外部调用。

### WO-02：规范化存储、迁移器与状态事件

**目标**

在保留现有表和上传安全能力的基础上增加 V2 事实表。

**交付物**

- 单调 Schema migration；
- 隔离数据库 dry-run 迁移器；
- 状态事件与净工时计算；
- 三作用域 revision 与多任务时间块关联；
- V1/V2 Snapshot 事务内物化；
- migration/rollback/幂等/并发测试。

**验收**

- WAL、外键、revision 和 operations 仍有效；
- Kiosk 状态事件不制造无关 `scheduleRevision` 冲突；
- V1 多任务 session 可 round-trip，且不产生伪造的单任务时长；
- 重复事件不重复计时；
- 非法转换失败关闭；
- 两个客户端并发修改时只有一个成功；
- 孤立上传清理、崩溃恢复和在线上传竞态测试继续通过；
- 迁移前备份可恢复，且未删除 V1 数据。

### WO-03：Kiosk 与离线事件重放

**目标**

提供可在摄影棚平板使用的服务端权威控制界面。

**交付物**

- `public/kiosk.html`、`public/kiosk.js`；
- 状态事件 API；
- SSE 或受限轮询更新；
- 带 idempotency 和 revision 的本地待发队列；
- 桌面、平板、手机可访问性测试。

**验收**

- 开始 → 挂起 → 恢复 → 完成的净工时正确；
- 连点、重复重放、乱序、冲突和断网恢复有测试；
- 待发送状态可见；
- Kiosk 无权修改正式排期；
- 浏览器缓存清空不会改变服务端事实。

### WO-04：钉钉 Outbox 与适配器

**目标**

在不耦合核心事务的前提下建立钉钉通知能力。

**交付物**

- `dingtalk-adapter` 接口；
- 显式 Mock；
- Transactional Outbox；
- 新需求、排期确认、完成三类最小披露卡片；
- 回调验证和幂等框架；
- 无网络测试。

**验收**

- 默认测试不会访问网络；
- 非测试环境缺配置不伪造成功；
- 业务提交成功、通知失败时业务记录仍存在且 Outbox 可重试；
- 重试不重复发卡；
- 日志不包含完整 Brief、凭据或原始回调载荷；
- 真实凭据联调被保留为独立授权步骤。

### WO-05：Agent 调度器与影子评估

**目标**

生成确定性、可解释、不可自动覆盖正式排期的 Proposal。

**交付物**

- 纯函数调度核心；
- 版本化 Buffer 配置；
- 硬冲突和软警告诊断；
- Proposal 持久化；
- 离线回放评估报告；
- 人工采用/拒绝/部分采用记录。

**验收**

- P0 在没有硬阻断时优先于 P1/P2；
- P0 不能绕过样品、资源、安全边界；
- 相同输入、规则版本和配置得到相同结果；
- Proposal 不直接修改正式 Schedule Item；
- 所有建议包含诊断和规则版本；
- 影子指标达到事先定义的阈值后才讨论扩大权限。

### WO-06：部署前综合预检

**目标**

证明系统具备进入“申请部署授权”的条件，而不是执行部署。

**交付物**

- 构建、迁移、回滚、备份恢复报告；
- VCP 适配器真实兼容性结果；
- Kiosk 真机检查记录；
- 钉钉真实联调前检查表；
- 未决风险和生产变更清单。

**验收**

- 全部本地门禁通过；
- 无秘密值进入仓库、日志或报告；
- 生产动作、目标、回滚和影响范围明确；
- 仍保持 `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`，等待单独明确授权。

---

## 12. 质量门禁

### 12.1 每个工作包的共同门禁

- [ ] 变更范围与工作包一致，无顺带重构；
- [ ] V1 回归测试通过；
- [ ] 新功能含正常路径、非法输入、并发、重试和恢复测试；
- [ ] `npm run check` 通过；
- [ ] 关键前端脚本通过语法检查；
- [ ] 数据契约 Fixture 通过；
- [ ] 无真实网络调用；
- [ ] 无秘密值或原始敏感载荷进入输出；
- [ ] 变更后的差异经过再次审阅；
- [ ] 验证失败时不得报告 PASS。

### 12.2 风险导向测试

不再把“100% 覆盖率”作为单独完成标准。关键路径必须覆盖：

- 状态机所有允许与拒绝转换；
- revision 冲突；
- operation/event 幂等；
- 离线重复与乱序；
- Snapshot 双投影；
- 迁移重复执行和回滚恢复；
- Outbox 提交、重试和去重；
- 上传保存与清理竞态；
- 调度硬约束优先于软优化；
- VCP 适配器缺失时明确 NOT RUN/SKIP，而不是伪装通过。

### 12.3 容器验收

- [ ] 使用固定 Node 24 LTS 版本或 digest；
- [ ] 不需要 Python/Make/G++ 等本地编译工具；
- [ ] 不添加 `--experimental-sqlite`；
- [ ] 非 root 用户运行；
- [ ] 数据卷和健康检查有效；
- [ ] 空数据库启动和已有数据库迁移均通过；
- [ ] 构建可复现，不以不稳定的耗时阈值作为门禁。

### 12.4 现场场景验收

- [ ] 开始 → 挂起 10 分钟 → 恢复 → 完成，净工时准确扣除 10 分钟；
- [ ] 两台设备同时开始同一任务，第二台收到冲突；
- [ ] 离线完成后恢复网络，事件只提交一次；
- [ ] 阻塞未恢复就请求完成时，按明确规则拒绝或由授权操作处理；
- [ ] Soft Drift 不修改正式排期；
- [ ] Hard Confirm 产生新 revision 和通知 Outbox；
- [ ] 钉钉不可用时核心业务仍能提交；
- [ ] VCP 不在线时服务端和 Kiosk 仍保持一致事实。

---

## 13. 风险与停止条件

出现以下任一情况时，停止当前工作包并保留可审查证据：

- Current → V2 无法无损映射且缺少业务决策；
- 迁移可能覆盖或删除现有排期、任务或附件；
- V1 兼容投影无法满足当前看板/VCP；
- 上传清理安全机制出现回归；
- 需要读取或修改真实凭据、Token、生产环境变量或活动运行配置；
- 需要发送真实钉钉通知或连接真实外部服务；
- 需要启动公网服务、修改网络/域名/证书/安全组；
- 需要生产数据库写入、部署、发布或切流；
- 验证失败且无法在当前本地边界内修复。

停止时必须报告：已完成的安全工作、未执行的高风险动作、当前验证结果和最小下一步。

---

## 14. 完成定义

V2.1 的“实施完成”不等于“生产上线”。在申请部署前，必须同时满足：

1. V2 契约和 Current → V2 映射冻结；
2. V1 看板和同步契约保持兼容；
3. 规范化存储、状态事件、revision、幂等和双投影通过测试；
4. Kiosk 离线重放和并发冲突通过验证；
5. 上传和清理安全能力无回归；
6. 钉钉 Mock/Outbox 完成，但真实凭据和真实通知仍未启用；
7. VCP 外部适配器完成真实代码级兼容验证，不再仅依赖跳过测试；
8. Agent 只处于影子建议模式，并有可解释的评估指标；
9. 备份、迁移 dry-run 和回滚恢复被验证；
10. 形成单独的生产部署前检包，等待 Jenn 对具体部署动作的明确授权。

最终演进目标不是让 Agent “接管现场”，而是让系统先建立可信事实、可恢复操作和清晰的人机边界，再让 Agent 在可解释、可拒绝、可回滚的范围内逐步承担调度辅助。
