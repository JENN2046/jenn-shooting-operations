# Jenn Shooting Operations Architecture Decision Pack V2.1

- Pack ID：`JSO-ADP-V2.1`
- 状态：`FROZEN_FOR_IMPLEMENTATION`
- 冻结日期：2026-09-22
- 适用范围：V2.1 本地设计、实现、迁移演练和验证
- 上位计划：[VCP 摄制运营调度工作台升级与 Agent 协同演进实施计划书 V2.1](../VCP_SHOOTING_OPERATIONS_EVOLUTION_PLAN_V2.1.md)
- 不构成：生产部署授权、真实钉钉调用授权、凭据配置授权、生产数据迁移授权

> **Supersession notice：** 本文件保留初次冻结的完整历史决定。当前有效基线请从 [Architecture Baseline Index V2.1](ARCHITECTURE_BASELINE_INDEX_V2.1.md) 进入。ADP-005 已被 ADP-017 替代；原单任务 `schedule_items.taskId` 假设已被 ADP-018 细化。除本通知外，下方历史正文未被改写。

## 0. 冻结规则

本文件是 V2.1 实施的规范性架构基线。文中使用以下词语：

- `MUST`：实现必须满足；
- `MUST NOT`：实现不得违反；
- `SHOULD`：默认采用，偏离时必须记录理由；
- `MAY`：允许但不强制。

冻结后不得在普通实现提交中静默改变架构决定。需要改变时，必须：

1. 新增一份带编号的 superseding ADR；
2. 写明触发事实、影响面、迁移和回滚方案；
3. 标明被替代的决定和生效阶段；
4. 重新运行受影响的契约、迁移、并发和回归验证；
5. 涉及生产、凭据、外部真实调用或其他硬边界时，另行取得当前明确授权。

本 Pack 冻结的是架构边界，不冻结仍需通过数据确定的业务参数。开放参数见第 17 节。

---

## 1. ADP-001：部署拓扑采用模块化单体

**状态：Accepted / Frozen**

### 决定

V2.1 `MUST` 保持一个 Node.js 应用、一个 SQLite 数据库和一个部署单元。内部按领域、应用、接口和基础设施划分模块，不拆分微服务。

初始进程拓扑：

```text
Node.js process
  ├─ HTTP API / Static UI
  ├─ Application commands and queries
  ├─ SQLite store and projections
  ├─ SSE update stream
  └─ In-process Outbox dispatcher

SQLite database + upload volume
```

Outbox 投递器 `MAY` 在未来拆成独立 worker，但 V2.1 不要求拆分。即使同进程运行，也必须通过持久化 Outbox 恢复未完成投递。

### 理由

当前规模、部署方式和团队边界不需要分布式系统。模块化单体可以提供清晰边界，同时保持事务一致性、备份简单性和低运维成本。

### 排除项

V2.1 `MUST NOT` 为预期中的未来规模引入 Kafka、RabbitMQ、Redis、Kubernetes、服务网格、多数据库或跨服务分布式事务。

---

## 2. ADP-002：依赖方向与模块边界

**状态：Accepted / Frozen**

### 决定

新建 V2 代码 `MUST` 遵守以下依赖方向：

```text
interfaces ──► application ──► domain
                      ▲
                      │ ports
infrastructure ───────┘
```

职责：

```text
domain/          领域实体、值对象、状态转换、无副作用规则
application/     命令、查询、用例编排、事务边界、Ports
infrastructure/  SQLite、Snapshot、Outbox、DingTalk、VCP 实现
interfaces/      HTTP、Kiosk、定时/进程入口、输入输出映射
```

### 强制约束

- `domain` `MUST NOT` 读取环境变量、文件、网络、SQLite、HTTP request 或系统时钟；
- 时间和 ID `MUST` 通过应用层依赖注入；
- `application` `MUST NOT` 依赖钉钉 SDK 或 VCP 具体文件路径；
- `infrastructure` `MUST` 通过明确 Port 实现被应用层调用；
- `interfaces` `MUST NOT` 直接执行 SQL 或拼装领域状态；
- 现有 V1 文件可在绞杀式迁移期间保留，不要求一次性搬迁目录；
- 新 V2 行为不得继续堆入单个 `store.mjs` 或 `http-app.mjs`。

### 最小 Ports

```text
UnitOfWork
RequestRepository
ScheduleRepository
ProductionRunRepository
ProjectionRepository
OutboxRepository
ProposalRepository
Clock
IdGenerator
DingTalkPort
VcpProjectionPort
```

---

## 3. ADP-003：SQLite 规范化记录是唯一事实源

**状态：Accepted / Frozen**

### 决定

V2 激活后，SQLite 中的规范化业务记录是唯一权威事实。以下内容 `MUST` 被视为可重建投影或缓存：

- V1/V2 Snapshot；
- VCP 本地数据；
- 网页看板；
- Kiosk 当前画面；
- 钉钉卡片；
- Agent Proposal；
- 浏览器离线队列。

### 规范化事实表

V2.1 使用以下逻辑表边界：

```text
requests_v2
schedule_items
production_runs
production_events
scheduling_proposals
scheduling_config_versions
notification_outbox
snapshot_projections
schema_migrations
```

现有以下表在迁移期 `MUST` 保留：

```text
schedule_state
operations
audit_log
uploads
```

### 非完整 Event Sourcing

V2.1 `MUST NOT` 采用完整 Event Sourcing。`production_events` 保存现场状态历史；`production_runs` 保存事务内同步更新的当前状态。请求和排期继续采用常规关系型当前状态模型。

---

## 4. ADP-004：使用单一事务提交事实、revision、投影与 Outbox

**状态：Accepted / Frozen**

### 决定

每个改变业务事实的命令 `MUST` 在一个 `BEGIN IMMEDIATE` SQLite 事务中完成：

```text
validate command
→ check authorization
→ check idempotency
→ check expected revision
→ write normalized facts/events
→ increment relevant revisions
→ refresh affected projections
→ enqueue Outbox records when needed
→ append minimal audit record
→ COMMIT
```

网络请求、钉钉发送、SSE 推送和普通文件导出 `MUST NOT` 在数据库事务内执行。

### 失败语义

- 事务内任何必要步骤失败：整体回滚；
- 事务提交后外部通知失败：业务事实保留，Outbox 进入重试状态；
- 投影构建失败：业务事务失败关闭，不提交无法读取的新事实；
- 非必要的提交后文件导出失败：记录低披露错误并可重建，不回滚业务事实。

---

## 5. ADP-005：revision 分为全局排期 revision 与实体 revision

**状态：Accepted / Frozen**

### 决定

V2 使用两种明确作用域的 revision：

1. `scheduleRevision`：排班和共享 Snapshot 的全局单调版本；
2. `runRevision`：单个现场运行记录的单调版本。

规则：

- V1 `revision` 映射到 `scheduleRevision`；
- 正式排期命令 `MUST` 携带 `expectedScheduleRevision`；
- Kiosk 状态事件 `MUST` 携带 `expectedRunRevision`；
- 成功的现场事件自增对应 `runRevision`；
- 影响共享读模型的现场事件同时生成新的 `scheduleRevision`；
- API `MUST NOT` 使用无作用域的裸 `expectedRevision` 表达两种含义；
- revision 冲突返回 `409 REVISION_CONFLICT` 和当前版本，不自动覆盖。

### 理由

保持 V1 全局并发语义的同时，避免两个无关 Kiosk 任务仅因全局 revision 变化而互相阻塞。

---

## 6. ADP-006：命令幂等与事件唯一性

**状态：Accepted / Frozen**

### 决定

- 所有可重试写命令 `MUST` 有 `operationId` 或 `eventId`；
- 同一 ID、同一命令类型重放 `MUST` 返回原结果，并标记 `replayed: true`；
- 同一 ID 被不同命令类型或不同实体复用 `MUST` 返回 `409 IDEMPOTENCY_KEY_REUSE`；
- `production_events.event_id` `MUST` 具有数据库唯一约束；
- 幂等记录和业务事实 `MUST` 在同一事务提交；
- 不得只依赖内存、浏览器或进程锁实现幂等。

Outbox 使用独立 `dedupeKey`。系统提供至少一次投递语义，不宣称不可证明的 exactly-once 外部交付。

---

## 7. ADP-007：现场状态采用追加事件与物化当前状态

**状态：Accepted / Frozen**

### 决定

正式状态集合固定为：

```text
scheduled
shooting
blocked
completed
cancelled
```

允许的常规转换固定为：

```text
scheduled → shooting
shooting  → blocked
blocked   → shooting
shooting  → completed
scheduled → cancelled
blocked   → cancelled
```

常规流程 `MUST NOT` 允许：

```text
blocked   → completed
completed → shooting
cancelled → shooting
```

需要纠正时，由 `scheduler` 或 `administrator` 提交独立 `correction` 命令。纠正 `MUST`：

- 保留原事件；
- 记录被纠正事件、原因和角色；
- 重新计算当前状态和工时投影；
- 产生新 revision；
- 不通过 UPDATE/DELETE 静默改写历史事件。

被取消后重新安排拍摄 `MUST` 创建新的 `production_run`，不复活旧 run。

---

## 8. ADP-008：时间、时区、资源和派生字段

**状态：Accepted / Frozen**

### 决定

- 持久化时间 `MUST` 使用 UTC ISO 8601；
- `businessTimeZone` `MUST` 使用合法 IANA 时区；默认值为 `Asia/Shanghai`，部署前可通过非秘密配置明确覆盖；
- 旧 V1 `date/start/end` 迁移时 `MUST` 使用当时确认的业务时区；
- `plannedEnd` `MUST` 晚于 `plannedStart`；
- 排期 `MUST` 携带显式 `resourceId`；
- 同一资源的 confirmed 项目 `MUST NOT` 重叠；
- `nextStart`、漂移区间和 diagnostics 是派生字段，`MUST NOT` 成为独立可写事实；
- Buffer 值来自带版本号的配置或模型，不永久硬编码进领域逻辑。

服务端时间是 `receivedAt` 的权威来源。客户端 `occurredAt` 超过允许漂移时 `MUST` 进入人工复核，不能直接污染净工时。

---

## 9. ADP-009：版本化 API 与 V1 兼容投影

**状态：Accepted / Frozen**

### 决定

V1 契约在 V2.1 迁移期间保持可用；V2 使用独立 Schema 和 `/api/v2` 路径。

V1 保留面：

```text
GET  /api/v1/snapshot
POST /api/v1/requests
POST /api/v1/uploads
PUT  /api/v1/snapshot
```

V2 核心面：

```text
GET  /api/v2/snapshot
POST /api/v2/requests
POST /api/v2/schedule/commands
GET  /api/v2/kiosk/current
POST /api/v2/schedule-items/:id/events
GET  /api/v2/updates
POST /api/v2/proposals/:id/decisions
```

### V1 写入兼容规则

规范化事实源激活后，`PUT /api/v1/snapshot` `MUST NOT` 直接覆盖数据库全量状态。它必须经过 V1 Adapter：

1. 校验 V1 契约和 `If-Match`；
2. 计算 V1 可表达字段的差异；
3. 转换为受控领域命令；
4. 保留所有 V2-only 状态、事件和关系；
5. 冲突或不可表达变化失败关闭。

V1 Snapshot 是兼容投影，不得包含未经契约定义的 V2 扩展字段。

### 退役条件

V1 写接口只有在 VCP 适配器完成 V2 切换、兼容观察期通过并另有明确决定后才能退役。退役不属于 V2.1 自动动作。

---

## 10. ADP-010：VCP、Kiosk、钉钉和 Agent 采用适配器边界

**状态：Accepted / Frozen**

### 决定

四个外部边界 `MUST` 通过独立 Adapter/Port 接入：

```text
VcpAdapter
KioskHttpInterface
DingTalkAdapter
SchedulingEnginePort
```

### 权威边界

| 参与者 | 可以做什么 | 不可以做什么 |
|---|---|---|
| VCP | 读取 Snapshot；经并发保护提交排期命令 | 绕过 API 直接写数据库；覆盖 V2-only 状态 |
| Kiosk | 读取当前任务；提交现场事件 | 修改正式排期、优先级、资源或历史事件 |
| 钉钉 | 接收通知；提交受验证的白名单动作 | 成为 SSOT；无鉴权改排期；离线替代数据库 |
| Agent | 读取结构化投影；生成 Proposal 和 diagnostics | 直接修改正式排期；绕过硬约束或人工确认 |

任何 Adapter 不可用时，核心数据库事实必须保持可读取和可恢复。

---

## 11. ADP-011：Transactional Outbox 与钉钉失败语义

**状态：Accepted / Frozen**

### 决定

钉钉通知 `MUST` 使用 Transactional Outbox。业务代码 `MUST NOT` 在请求事务中直接发送卡片。

Outbox 状态最少包括：

```text
pending
leased
sent
retryableFailed
deadLetter
```

规则：

- worker 领取消息时使用 SQLite 锁和有期限 lease；
- 进程崩溃后过期 lease 可被重新领取；
- 发送成功后记录 provider message/card ID 的低披露引用；
- 重试采用有上限的指数退避；
- 超过上限进入 `deadLetter`，不得无限重试；
- 不保存凭据、原始请求头或不必要的完整 Brief；
- 真实环境缺少钉钉配置时返回 `DINGTALK_NOT_CONFIGURED`，不得 Mock 成功；
- 测试只能通过显式注入使用 Mock，默认禁止真实网络。

卡片回调 `MUST` 通过签名、时间窗、nonce、操作者、角色、动作白名单、幂等和 revision 检查后才能转为领域命令。

---

## 12. ADP-012：Kiosk 离线队列不是事实源

**状态：Accepted / Frozen**

### 决定

Kiosk localStorage `MAY` 保存待发送事件和最小只读缓存，但 `MUST NOT` 被当作已确认状态。

重连顺序固定为：

```text
refresh current run and runRevision
→ replay local events in device sequence
→ delete one event only after success or idempotent replay
→ stop on first conflict
→ display manual-resolution state
```

离线队列项最少包含：

```text
eventId
scheduleItemId
expectedRunRevision
eventType
occurredAt
deviceId
localSequence
reason?
```

Kiosk `MUST` 明确显示 `synced | pending | conflict | reviewRequired`，不得把本地乐观状态伪装成服务端确认。

---

## 13. ADP-013：Agent Proposal 与正式排期隔离

**状态：Accepted / Frozen**

### 决定

Agent 输出是独立的 `scheduling_proposal`，不是 Schedule Item 状态。

Proposal 最少记录：

```text
proposalId
baseScheduleRevision
algorithmVersion
configVersion
inputDigest
proposedItems
diagnostics
status
createdAt
decidedBy?
decidedAt?
decisionNote?
```

状态固定为：

```text
draft
accepted
partiallyAccepted
rejected
stale
```

约束：

- 调度器核心 `SHOULD` 是确定性纯函数；
- 相同输入摘要、算法和配置版本 `MUST` 产生相同结构化结果；
- Proposal 创建不自增正式排期 revision；
- 人工接受时重新检查 `baseScheduleRevision` 和全部硬约束；
- base revision 过期时标记 `stale`，不得静默套用；
- 接受操作转换为普通排期命令，并走相同事务、鉴权、审计和 Outbox；
- V2.1 不授权 Agent 自动接受自身 Proposal。

未来如引入 LLM，只能作为不受信任建议适配器；硬约束、契约和最终写入仍由确定性服务端规则执行。

---

## 14. ADP-014：角色与能力矩阵

**状态：Accepted / Frozen**

### 决定

V2.1 角色集合：

```text
viewer
submitter
operator
scheduler
administrator
```

| 能力 | viewer | submitter | operator | scheduler | administrator |
|---|---:|---:|---:|---:|---:|
| 查看排班 | 是 | 是 | 是 | 是 | 是 |
| 提交需求和附件 | 否 | 是 | 否 | 是 | 是 |
| 提交现场状态事件 | 否 | 否 | 是 | 是 | 是 |
| 修改正式排期 | 否 | 否 | 否 | 是 | 是 |
| 处理事件 correction | 否 | 否 | 否 | 是 | 是 |
| 接受 Agent Proposal | 否 | 否 | 否 | 是 | 是 |
| 管理迁移、备份和配置版本 | 否 | 否 | 否 | 否 | 是 |

角色校验 `MUST` 位于应用用例边界，不能只靠隐藏前端按钮。鉴权未配置时，所有受保护写入继续失败关闭。

钉钉用户到内部角色的映射属于真实集成配置，不在代码中硬编码。

---

## 15. ADP-015：迁移采用 Expand → Shadow → Switch → Contract

**状态：Accepted / Frozen**

### 决定

迁移顺序固定为：

```text
Expand
  添加 V2 表、Schema、适配器和投影，不改变现有行为

Shadow
  从 V1 Snapshot dry-run/backfill 到隔离 V2 模型，生成并比较兼容投影

Switch
  写入改走领域命令和规范化事实；V1 请求经 Adapter 转换；读改用投影表

Contract
  观察期和外部适配器迁移完成后，另行决定是否退役遗留写路径
```

### 强制约束

- V2.1 首次迁移 `MUST NOT` 删除 V1 表、字段或上传；
- 迁移器默认 `MUST` 是 dry-run 或要求显式目标数据库；
- 多任务 `session.ids[]` `MUST NOT` 被自动平均分配时长；
- 缺失的历史现场事件 `MUST NOT` 被伪造；
- 迁移 `MUST` 可检测重复执行并保持幂等；
- Switch 前 `MUST` 通过 V1 round-trip、记录数、引用、revision、附件和恢复验证；
- 任一兼容比较不通过时停止，不进入 Switch；
- Contract 阶段不是默认自动步骤。

### 单一写路径

Switch 后不允许 V1 和 V2 两套代码各自写不同事实表。所有 V1/V2 写接口必须汇合到相同 Application Command 和 UnitOfWork。

---

## 16. ADP-016：安全、日志与可观察性采用最小披露

**状态：Accepted / Frozen**

### 决定

日志和审计只记录定位运行问题所需的最少信息。

允许记录：

```text
request/operation/event ID
action type
role
entity ID
revision
result/error code
duration bucket
timestamp
outbox attempt count
```

禁止记录：

```text
Token / credential / cookie
原始 Authorization header
完整 Brief 或原始请求体
附件内容
不必要的附件原名
钉钉原始回调载荷
provider raw response
个人敏感信息
```

外部 URL `MUST` 进行协议和允许域验证。视觉封面优先使用受控 `heroAssetId`；服务端不得为了生成缩略图而任意抓取用户提供的外部 URL。

错误响应使用稳定 code，不向客户端返回 SQL、文件绝对路径、堆栈或凭据状态细节。

---

## 17. 开放参数：未冻结为架构事实

以下内容仍需通过业务确认或样本确定，但不得破坏前述架构边界：

| 参数 | 默认/当前建议 | 最晚确认阶段 |
|---|---|---|
| `businessTimeZone` | `Asia/Shanghai` | WO-02 前 |
| 资源类型和 `resourceId` 列表 | 先支持单影棚，数据模型允许多资源 | WO-02 前 |
| `sampleShelfId` 是否条件必填 | 默认选填 | WO-01 前 |
| Brief URL 允许域 | 钉钉官方域名白名单，具体列表待真实集成 | WO-04 前 |
| Buffer 默认值 | 作为版本化假设配置，不锁死 10/35 分钟 | WO-05 前 |
| 闭棚安全边界 | 由业务日历配置 | WO-05 前 |
| 客户端允许时钟漂移 | 通过现场设备验证确定 | WO-03 前 |
| Outbox 重试次数与退避 | 有上限，具体值通过测试确定 | WO-04 前 |
| Agent 影子指标阈值 | 基线样本后冻结 | P5 评审前 |
| 数据保留期限 | 需结合备份和隐私策略 | 部署前 |
| 生产鉴权实现 | 保持 Port，不在 V2.1 本地阶段引入真实凭据 | 部署前 |

开放参数 `MAY` 通过版本化配置冻结，不需要为普通数值调整重写架构 ADR；如果调整改变事实源、权限、事务或外部副作用边界，则必须新增 superseding ADR。

---

## 18. 实现不变量

任何 V2.1 实现都必须同时满足：

1. 只有 SQLite 规范化记录是事实源；
2. V1/V2 写接口最终汇合到同一应用命令；
3. 领域写入、revision、投影、Outbox 和审计处于同一事务；
4. 外部网络调用不进入数据库事务；
5. V1 客户端不能覆盖 V2-only 状态；
6. Kiosk 不能修改正式排期；
7. 钉钉不能成为事实源或静默 Mock 成功；
8. Agent 不能自动接受自己的 Proposal；
9. 完成和取消事件不能通过普通流程被静默撤销；
10. 上传保存、认领、清理和恢复的现有安全属性不得回归；
11. VCP 外部适配器缺失时必须明确 SKIP/NOT RUN，不得声称集成通过；
12. 生产部署、真实凭据和真实外部通知保持独立授权门。

任何违反上述不变量的实现都应视为架构回归，而不是局部实现取舍。

---

## 19. Implementation Gate

开始 WO-01 前：

- [ ] 本 Pack 已被实现者完整阅读；
- [ ] V1 当前契约和 Fixture 基线通过；
- [ ] 新文件路径和模块边界符合 ADP-002；
- [ ] 不存在原地改写 V1 `$id` 的方案；
- [ ] 开放参数与架构决定已区分。

开始 WO-02 前：

- [ ] V2 Schema 和负向测试通过；
- [ ] `scheduleRevision` / `runRevision` 已进入 API 契约；
- [ ] 状态转换矩阵已编码为领域规则；
- [ ] migration dry-run 和隔离目标设计完成；
- [ ] 现有上传安全回归测试保持为硬门禁。

进入任何 Switch 前：

- [ ] V1 round-trip 兼容通过；
- [ ] 迁移记录数、引用、revision 和附件核对通过；
- [ ] 备份恢复已在隔离环境演练；
- [ ] VCP Adapter 实际存在并通过兼容测试；
- [ ] 回滚不依赖破坏性 Git 或文件系统操作；
- [ ] 未触碰生产部署门。

---

## 20. 冻结结论

V2.1 的架构基线冻结为：

> 一个以 SQLite 为唯一事实源的模块化单体；使用明确 Application Commands、局部追加事件、双 revision、V1/V2 投影和 Transactional Outbox；VCP、Kiosk、钉钉与 Agent 全部通过受控适配器接入；迁移采用 Expand → Shadow → Switch → Contract；任何外部通知、Agent 建议和离线队列都不得越过服务端事实、并发保护与人工确认边界。

此结论自本文件冻结起约束 V2.1 实现。未通过 superseding ADR，不得以“实现方便”为由绕过。
