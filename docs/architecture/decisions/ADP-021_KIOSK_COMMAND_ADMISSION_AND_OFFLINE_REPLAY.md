# ADP-021：Kiosk Command Admission and Offline Replay

- 状态：`ACCEPTED_AND_FROZEN`
- 日期：2026-09-22
- 决策范围：Kiosk current read model、first-start run admission、HTTP 身份边界、现场事件时间复核、浏览器离线队列与首版更新传输
- 细化：ADP-006、ADP-007、ADP-008、ADP-009、ADP-010、ADP-012、ADP-014、ADP-017、ADP-018、ADP-019、ADP-020
- 不替代：上述冻结决定

> 本文件已通过 WO-03A 独立审查，并纳入 `JSO-ARCH-V2.1-R4` 生效架构基线。该冻结只授权后续本地实现遵循本决定，不授权生产凭据、生产数据读取或写入、Switch、部署、发布或公网服务启动。

## 1. 背景

WO-02 已提供 API-free 的 Production Run/Event 用例、SQLite 事务实现、三 revision、V1/V2 事务内投影与事件幂等证明。WO-03 需要把这些能力接到摄影棚 Kiosk，并在断网、重复提交、设备时间偏差和多设备并发下继续维护服务端事实。

现有冻结决定仍留下以下实现空白：

- V1 migration 不创建 `production_run`，但现场事件需要稳定的 `runId`；
- `GET /api/v2/kiosk/current` 不能通过读取隐式创建事实；
- 浏览器提交的 `actorId` 或 `role` 不能被当作可信身份；
- 离线网络延迟和客户端时间异常必须在进入净工时前受到明确策略约束；
- localStorage 不能成为唯一的冲突或人工复核记录；
- 首版需要一个可验证、低复杂度的更新机制，但不应为此提前引入 SSE 生命周期管理；
- 同一设备的多个控制标签可能制造重复本地序列，但浏览器锁不能替代服务端幂等和 revision。

本决定只收口 WO-03 所需的 command admission 与 offline replay。`cancel`、`correction`、人工复核处置命令、重新拍摄准备命令和生产鉴权实现不在本决定中发布。

## 2. 继承的不变量

本决定不改变以下既有事实：

1. SQLite 规范化记录是唯一事实源；
2. Kiosk 只能读取现场工作和提交受控现场事件，不能修改正式排期、资源、优先级、锁、任务绑定或历史事件；
3. Production Event 追加写入，普通路径不得 UPDATE/DELETE 历史事件；
4. Kiosk 事件只增加对应 `runRevision` 和全局 `projectionRevision`，不得增加 `scheduleRevision`；
5. 失败、回滚和幂等重放不得消耗 revision；
6. 同一 run 基于同一 `expectedRunRevision` 的并发事件只能有一个成功；
7. grouped block 的状态和工时只属于组合场次，不得自动分摊到单任务或自动 fulfill 各 request；
8. V1 Snapshot `revision` 继续映射到 `projectionRevision`，V1 写入不得覆盖 V2 run/event 事实；
9. 生产网络、凭据、迁移 Switch 与部署继续使用独立授权门。

ADP-005 已被 ADP-017 全文替代；实现不得恢复“现场状态事件增加 `scheduleRevision`”的旧语义。

## 3. Kiosk current 是纯读取

### 3.1 显式 resourceId

Kiosk current 请求 `MUST` 携带显式 `resourceId`：

```text
GET /api/v2/kiosk/current?resourceId={resourceId}
```

- 服务端不得缺省为数据库中的第一项资源；
- `resourceId` 必须指向 Kiosk principal 被允许查看的资源范围；
- `deviceId` 不授予资源权限，也不能替代 `resourceId`；
- 未提供、格式非法、未知或超出 principal 范围时失败关闭。

### 3.2 确定性选择

读取使用服务端 `now`，并按以下顺序选择：

1. 查找该资源上状态为 `shooting` 或 `blocked` 的非终态 run；
2. 恰有一个时，将它作为 `active` 返回，即使其计划窗口已经结束；
3. 没有 active 时，在 `schedule_status = confirmed`、`resource_resolution_status = resolved` 且
   `plannedStart <= now < plannedEnd` 的时间块中选择 `currentCandidate`；
4. `next` 是该资源上 `plannedStart > now` 的最早 confirmed + resolved 非取消时间块；
5. 相同排序键必须使用稳定 ID 排序，但如果稳定排序会掩盖多个业务候选，则失败关闭而不是任取一个。

以下状态固定为冲突：

- 多个 active run：`MULTIPLE_ACTIVE_RUNS`；
- 多个 current-window candidate：`MULTIPLE_CURRENT_CANDIDATES`；
- 多个无法通过业务事实唯一确定的 next candidate：`MULTIPLE_NEXT_CANDIDATES`。

历史重叠可以被只读保存，但 Kiosk 不得把歧义解释成现场指令。

### 3.3 读取结果

current DTO 至少包含：

```text
resourceId
serverTime
projectionRevision
current?
next?
```

`current` 是一个统一槽位：存在 active run 时承载 active，否则承载唯一的 current-window candidate。客户端不得在 active 与 candidate 之间自行选择。

每个可执行项至少包含：

```text
scheduleItemId
allocationMode
tasks[]
plannedStart
plannedEnd
runId
runRevision
runState
isGrouped
groupedNotice
```

`tasks[]` 必须按底层 task binding 的 `displayOrder` 返回受控的 SKU、名称、100 字核心摘要和受控 `heroAssetId` 投影。`grouped_unallocated` 必须返回全部任务、`isGrouped = true`，并以 `groupedNotice` 明确标记“组合场次，未拆分单任务工时”。尚未创建 run 的 candidate 使用 `runId = null`、`runRevision = 0`、`runState = scheduled` 作为只读 admission baseline；这不表示数据库中已经存在 run，也不允许 GET 将其物化。服务端不得为了 current DTO 抓取任意外部图片 URL。

`GET /api/v2/kiosk/current`、Snapshot 读取和更新轮询 `MUST NOT`：

- 创建 `production_run`；
- 写 receipt、audit 或 projection；
- 增加任何 revision；
- 修正、重排或补全业务事实。

## 4. First-start 原子创建 run

### 4.1 客户端生成 runId

Kiosk 的每个事件请求体 `MUST` 携带 `runId`。对从未产生 run 的时间块提交第一个 `start` 时，
该 `runId` 由客户端使用 Web Crypto 生成，并在同一离线事件链中保持不变。推荐格式为：

```text
RUN-{crypto.randomUUID()}
```

不得使用 `Math.random()` 或可预测计数器生成 `runId` 或 `eventId`。浏览器缺少所需安全随机能力时，写操作失败关闭。

### 4.2 admission 条件

首次 `start` 只有在同一个 `BEGIN IMMEDIATE` 事务内确认以下条件后才能创建 run：

- 调用 principal 具有 `submitRunEvent` capability；
- 事件结构、ID 和 canonical payload 合法；
- `scheduleItemId` 存在；
- `schedule_status = confirmed`；
- `resource_resolution_status = resolved`；
- task binding 完整且 allocation mode 合法；
- 该 schedule item 从未存在任何 `production_run`，包括 terminal run；
- `expectedRunRevision = 0`；
- `eventType = start`；
- `runId` 未被其他 schedule item 使用；
- revision、状态和时间策略均通过。

scope 从事实确定，客户端不得声明：

```text
single
  → scope = task
  → taskId = 唯一 binding

grouped_unallocated
  → scope = block
  → taskId = NULL
```

事务内固定顺序为：

```text
authorize and validate outside transaction where safe
→ BEGIN IMMEDIATE
→ inspect event/review receipts for idempotent replay
→ load schedule, bindings, run history and revision counters
→ validate first-start or existing-run admission
→ check expectedRunRevision
→ apply versioned event-time policy
→ persist review receipt, or create runRevision=0 and immediately fold start
→ persist accepted event / run / revisions / projections / receipt / audit
→ COMMIT
```

新 run 和 `start` 事件必须在同一事务提交。不得留下没有对应成功 start 的 Kiosk-created scheduled run，也不得先提交 run 后在另一个事务应用事件。

### 4.3 已有 run

若 schedule item 已存在 `shooting` 或 `blocked` run：

- 后续事件必须携带该 exact `runId`；
- 不匹配返回 `RUN_ID_MISMATCH`；
- 不得自动切换到数据库中的“最近一个” run；
- 同一 run 的事件继续检查 `expectedRunRevision`。

若 schedule item 已存在任何 `completed` 或 `cancelled` run，Kiosk 不得自动创建重拍 run，也不得复活 terminal run，固定返回：

```text
RUN_PREPARATION_REQUIRED
```

新的重拍或重开 run 必须由未来明确的 scheduler/application command 准备，并保留旧 run。该命令不属于 WO-03。

若不存在 run 且事件不是 `start`，同样返回 `RUN_PREPARATION_REQUIRED`。

## 5. Kiosk 事件与 trusted principal

### 5.1 HTTP 请求边界

事件入口保持：

```text
POST /api/v2/schedule-items/:scheduleItemId/events
```

严格请求体允许：

```text
schemaVersion
eventId
runId
scheduleItemId
eventType
expectedRunRevision
occurredAt
deviceId
localSequence
reasonCode?
note?
```

WO-03 Kiosk 入口仅允许：

```text
start
block
resume
complete
```

本入口不允许 `cancel` 或 `correction`。未知字段失败关闭。请求体尤其 `MUST NOT` 接受：

```text
actorId
role
previousState
resultingState
scope
taskId
scheduleRevision
projectionRevision
```

URL 是 schedule item 路由权威；body 中的 `scheduleItemId` 必须与 URL 完全相等，不一致时以 `SCHEDULE_ITEM_ID_MISMATCH` 失败关闭，服务端不得任选其一。`localSequence` 是客户端队列的非权威交付/审计元数据，参与 canonical command digest，但不参与权限、状态选择或 revision，且服务端不得改写或 rebase。Application Use Case 从 trusted principal 注入：

```text
actorId = principal.subjectId
actorRole = principal.role
capabilities = principal.capabilities
```

`deviceId` 是非授权的设备审计标签：

- 参与 canonical command digest；
- 记录于 accepted event 或 review fact；
- 不授予角色、资源或写入权限；
- 同一 deviceId 不能证明是同一真实设备。

### 5.2 capability matrix

授权不得继续使用“最低角色等级”的线性比较。V2.1 角色按 capability 判断：

| Role | readSchedule | submitRunEvent | modifySchedule | correctRunEvent | administer |
|---|---:|---:|---:|---:|---:|
| viewer | 是 | 否 | 否 | 否 | 否 |
| submitter | 是 | 否 | 否 | 否 | 否 |
| operator | 是 | 是 | 否 | 否 | 否 |
| scheduler | 是 | 是 | 是 | 是 | 否 |
| administrator | 是 | 是 | 是 | 是 | 是 |

新需求/附件权限继续由独立 `submitRequest` capability 表达，不得因为 `operator` 可以提交 run event 而推导其可提交需求。

鉴权未配置、principal 缺失、subject 缺失或 capability 不足时失败关闭。真实浏览器身份建立、Token/session 交付和生产凭据配置不由本决定授权；本地测试通过显式注入 Auth Port 和测试 principal 完成。

## 6. 版本化 event-time policy

### 6.1 local-v1 参数

WO-03 本地实现使用版本化策略：

```text
policyVersion: kiosk-event-time-local-v1
maximumFutureSkew: 5 minutes
maximumOfflineAge: 24 hours
```

比较权威是服务端生成的 `receivedAt`：

- `occurredAt <= receivedAt + 5 minutes` 通过未来偏移边界；
- `occurredAt >= receivedAt - 24 hours` 通过历史离线窗口；
- 恰好位于边界的事件可继续 admission；
- 超出任一边界的事件不得进入 `production_events`、run fold 或净工时。

该策略是本地 V2.1 验证基线，不是生产设备校准结论。生产前必须使用目标平板、目标浏览器、实际断网时长和系统时钟行为重新验证；未完成真机校准时不得声称 production-ready。

### 6.2 review fact

一个在其他 admission 条件均通过、但 event-time policy 超限的事件，必须在同一事务写入服务端规范化 review fact：

```text
run_event_reviews
```

最少字段：

```text
event_id                  PRIMARY KEY
run_id
schedule_item_id
command_digest
response_digest
event_type
expected_run_revision
occurred_at
received_at
device_id
actor_id
actor_role
reason_code?
note?
time_policy_version
review_reason             tooFarFuture | tooOld
review_status             pending
response_json
created_at
```

review fact 的规则：

- 它是服务端事实，不是 accepted Production Event；
- 写入时不得创建 run、修改 run、插入 `production_events`、刷新 Snapshot 或增加 `runRevision`、`scheduleRevision`、`projectionRevision`；
- review fact、对应幂等 receipt 和最小 audit 必须在一个事务提交；
- receipt kind 与 accepted event receipt 可区分，但 `eventId` 必须跨 accepted event、review fact 和 operation receipt 保持单一语义；
- 同一 `eventId`、同一 canonical payload 重放返回原 review receipt，并标记 `replayed: true`；
- 同一 `eventId`、不同 payload 返回 `IDEMPOTENCY_KEY_REUSE`；
- review replay 的查找发生在当前 revision、run 状态和时间策略重新判断之前，以保证原结果稳定；
- Kiosk 收到 review receipt 后停止队列，不得把该事件改为已同步或自动生成替代事件；
- 清空浏览器缓存不会删除服务端 review fact。

review response 至少包含：

```text
ok: false
code: EVENT_TIME_REVIEW_REQUIRED
eventId
runId
reviewStatus: pending
reviewReason
policyVersion
replayed
```

人工接受、拒绝或修正 pending review 的命令必须由 `scheduler` 或 `administrator` 执行，并另行冻结其 revision 和审计语义。WO-03 不实现该处置命令。

### 6.3 admission precedence

稳定优先级为：

1. 鉴权与 strict request validation；
2. existing accepted/review receipt replay 或 key reuse；
3. schedule/run/scope/binding 上下文；
4. exact `runId` 与 `expectedRunRevision`；
5. event-time policy；
6. 状态转换、事件顺序与净工时 fold；
7. 事务写入。

因此 stale revision 不会仅因时间异常而被保存为 review，非法实体也不能制造 review 垃圾；但已经持久化的 exact review replay 不会因后续 revision 变化而改变结果。

## 7. 离线队列协议

### 7.1 队列项

localStorage 只保存待发命令和最小只读缓存。队列项至少包含：

```text
schemaVersion
eventId
scheduleItemId
runId
expectedRunRevision
eventType
occurredAt
deviceId
localSequence
reasonCode?
note?
```

`runId` 是强制字段，确保一个晚到离线事件仍然指向创建它时的 run，不能被重新解释为同一 schedule item 的未来重拍 run。

### 7.2 write-ahead 与本地状态

用户动作必须先 durable 写入队列，再允许网络发送或渲染 pending overlay：

```text
validate local action
→ allocate eventId / runId when needed / localSequence
→ persist queue item
→ render pending, explicitly unconfirmed state
→ attempt send
```

若 localStorage 写入失败，不得发送事件。客户端可以从最后一次服务端 `runRevision` 加上同 run 前序 pending 事件数量，预测后续离线事件的 `expectedRunRevision`；该预测只用于生成不可变队列命令，不能被显示为服务端确认。

最小只读缓存必须记录其 `projectionRevision` 和 `lastSyncedAt`，并明确显示为 stale/cache。缓存不得覆写、合并或修正服务端事实。

### 7.3 重连重放

重连算法固定为：

```text
refresh current run and authoritative runRevision
→ read queue in ascending localSequence
→ submit the immutable head item
→ delete only after RUN_EVENT_APPLIED or exact applied replay
→ stop on first revision conflict, review receipt, invalid transition or ambiguous context
```

补充约束：

- exact review replay 仍是 `reviewRequired`，不得删除队列头；
- 网络错误、超时、5xx 或无法解析响应时保留原队列项和原 `eventId`；
- 客户端不得因 refresh 得到新 revision 而重写、rebase 或重新编号已持久化事件；
- 客户端不得跳过失败的队列头继续提交后续事件；
- 丢失成功响应后，原 `eventId` 的重试必须依赖服务端 receipt 获得 exact replay；
- `synced | pending | conflict | reviewRequired` 必须在 UI 中可区分；
- 清空 localStorage 只能丢失未确认的本地队列/缓存，不能改变任何服务端 event、run、review 或 revision。

localStorage 损坏、Schema 版本未知或 `localSequence` 重复/倒退时，客户端失败关闭并显示 `reviewRequired`，不得静默删除、排序修复或继续发送。

## 8. 单控制标签

一个 device profile 同时只允许一个 Kiosk 控制标签：

1. 优先使用 Web Locks API 获取命名控制锁；
2. 未取得锁的标签进入只读状态；
3. 浏览器不支持 Web Locks 时，使用带 owner、expiry 和 heartbeat 的 localStorage lease 降低冲突；
4. lease 的时间常量可由实现内版本化配置确定，并使用注入 clock 测试；
5. storage event 用于尽快通知其他标签失去 lease。

Web Locks 和 fallback lease 都不是事实或安全边界。标签崩溃、设备休眠、时钟回拨和存储竞争仍可能产生双控制者；服务端 `eventId` 幂等、exact `runId` 和 `expectedRunRevision` 是最终防线。实现和报告不得宣称浏览器锁提供 exactly-once。

## 9. 首版更新协议

WO-03 首版使用 ETag 条件轮询，不实现 SSE：

```text
GET /api/v2/updates?resourceId={resourceId}
If-None-Match: "projection-{projectionRevision}"
```

规则：

- 有变化返回 `200`、最新 Kiosk read model 和新 ETag；
- 无变化返回 `304`，无业务 payload；
- ETag 只编码公开的 `projectionRevision`，不包含业务正文或秘密值；
- visible 页面正常间隔为 3 秒；
- 网络错误和 5xx 使用有上限的指数退避，最大 30 秒；
- 页面重新 visible 时立即 refresh，再恢复 3 秒轮询；
- conflict 或 reviewRequired 只停止命令 replay，不得伪造同步成功；读取轮询可以继续以展示服务端事实；
- 轮询、304 和内容等价读取不增加任何 revision，不写 audit 或数据库；
- 请求必须继续通过 read capability 与 resource scope 检查。

SSE 可以在后续真实负载证明有必要后另行加入，不能与首版轮询并行制造两个未经协调的刷新状态机。

## 10. HTTP 状态和稳定 code

Kiosk HTTP Adapter 只映射 Application Use Case 的结构化结果，不解析异常字符串。最低映射固定为：

| HTTP | 场景 | 稳定 code 示例 |
|---:|---|---|
| 200 | accepted event 的 exact replay；成功 GET | `RUN_EVENT_APPLIED` + `replayed: true` |
| 201 | 新 accepted event，包括原子 first start | `RUN_EVENT_APPLIED` |
| 202 | 新建或 exact replay 的 pending review | `EVENT_TIME_REVIEW_REQUIRED` |
| 304 | ETag 对应投影无变化 | 无 body |
| 400 | JSON 无法解析、缺少必需 HTTP 参数 | `INVALID_JSON`, `INVALID_REQUEST` |
| 401 | 无可信 principal 或鉴权未配置 | `UNAUTHENTICATED`, `AUTH_NOT_CONFIGURED` |
| 403 | principal 缺 capability 或 resource scope | `FORBIDDEN` |
| 404 | resource、schedule item 或显式既有 run 不存在 | `RESOURCE_NOT_FOUND`, `SCHEDULE_ITEM_NOT_FOUND`, `RUN_NOT_FOUND` |
| 409 | revision/idempotency/run context/当前选择冲突 | `REVISION_CONFLICT`, `IDEMPOTENCY_KEY_REUSE`, `RUN_ID_MISMATCH`, `RUN_ID_REUSE`, `SCHEDULE_ITEM_ID_MISMATCH`, `RUN_PREPARATION_REQUIRED`, `MULTIPLE_ACTIVE_RUNS`, `MULTIPLE_CURRENT_CANDIDATES`, `MULTIPLE_NEXT_CANDIDATES`, `INVALID_RUN_TRANSITION`, `EVENT_TIME_OUT_OF_ORDER` |
| 422 | 请求字段、ID、event type、blocking reason 或 timestamp 结构非法 | `INVALID_RUN_EVENT_COMMAND`, `INVALID_EVENT_ID`, `INVALID_EVENT_TIME`, `INVALID_BLOCKING_REASON`, `BLOCKING_REASON_NOTE_REQUIRED` |
| 500 | receipt/事实完整性损坏或未分类内部失败 | `EVENT_RECEIPT_INTEGRITY_ERROR`, `INTERNAL_ERROR` |
| 503 | 有界 SQLite busy/暂时不可用 | `STORE_BUSY`, `SERVICE_UNAVAILABLE` |

响应不得包含 SQL、堆栈、数据库路径、环境变量、Token 状态细节或原始内部异常。`409 REVISION_CONFLICT` 必须返回 scope 和当前 `runRevision`；不得自动覆盖或自动 rebase。

## 11. 非目标和授权边界

WO-03 不包含：

- Kiosk `cancel`；
- event `correction`；
- pending review 的人工处置命令；
- terminal run 的自动重拍或自动复活；
- 正式排期、资源、优先级、锁或 binding 修改；
- SSE；
- 真实身份 provider、真实 Token/session 配置或浏览器长期凭据存储；
- 生产数据库、真实业务数据迁移、Switch、部署、发布或公网暴露；
- 以客户端锁、localStorage 或乐观 UI 替代服务端幂等/revision。

本地测试只使用临时数据库、显式 fixture、注入 principal、注入 clock 和无真实网络的 HTTP harness。

## 12. 最低验收测试

### 12.1 current read model

1. 缺少或未知 `resourceId` 失败关闭；
2. active run 优先于当前窗口 candidate；
3. 多 active、多 current candidate 和无法唯一确定的 next 失败关闭；
4. current/updates GET 零数据库写入、零 revision；
5. grouped item 返回全部 task binding 和组合场次标记。

### 12.2 run admission

1. 首次 start 在同一事务创建正确 task/block scope 的 revision 0 run 并立即应用事件；
2. run/event 任一步失败均不留下孤立 run；
3. first-start 并发只有一个成功，另一个返回稳定冲突或 exact replay；
4. 已有 active run 要求 exact `runId`；
5. terminal/history run 返回 `RUN_PREPARATION_REQUIRED`，不创建新 run；
6. GET 不会隐式创建 run。

### 12.3 principal 与 HTTP

1. operator、scheduler、administrator 可 `submitRunEvent`；viewer、submitter 不可；
2. body 中 `actorId/role/previousState` 和其他未知字段被拒绝；
3. accepted event 和 audit actor 来自 trusted principal；
4. deviceId 不能扩大 capability 或 resource scope；
5. HTTP status/code 与本文件映射一致且无内部信息泄漏。

### 12.4 time review

1. 恰好未来 5 分钟和过去 24 小时可继续 admission；
2. 超出边界写一条 pending review、一个 receipt 和最小 audit；
3. review 路径零 run 创建、零 accepted event、零 run/schedule/projection revision；
4. exact review replay 返回原 receipt，不二次写入；
5. 同 eventId 不同 payload 返回 `IDEMPOTENCY_KEY_REUSE`；
6. stale revision 优先返回 conflict，不制造 review；
7. 清空浏览器缓存不删除 review fact。

### 12.5 offline replay

1. 队列 durable write 失败时不发送；
2. 按 `localSequence` 严格串行，不能跳过 head；
3. 只有 success 或 accepted-event exact replay 删除队列项；
4. lost response 使用相同 eventId 后只产生一个 accepted event；
5. conflict/review/非法转换停止后续发送；
6. refresh 不修改已排队 expected revision；
7. localStorage 损坏或未知版本失败关闭；
8. Web Lock 第二标签只读；fallback lease 竞争仍由服务端幂等/revision 拦截。

### 12.6 updates 与现场场景

1. ETag 变化返回 200，无变化返回 304；
2. visible 页面 3 秒轮询，失败指数退避不超过 30 秒，重新 visible 立即刷新；
3. 轮询不写数据库或消耗 revision；
4. 两设备同时 start，只有一个成功；
5. 离线 `start → block → resume → complete` 重放一次且净工时正确；
6. blocked 状态直接 complete 被拒绝；
7. 清空浏览器缓存后服务端事实完全不变。

## 13. 审查门

本提案进入 Accepted / Frozen 前必须确认：

- run history “从未有 run” 查询和 first-start insert 位于同一 `BEGIN IMMEDIATE`；
- accepted event 与 review receipt 的 `eventId` 不会形成两个可漂移的幂等域；
- review path 不会间接刷新 Snapshot 或增加 `projectionRevision`；
- capability matrix 不再通过角色数值大小推导；
- `actorId` 只能由 trusted principal 注入；
- queue 的 `runId`、不 rebase 和 stop-on-head-failure 已进入测试；
- current/updates 全程只读；
- 首版没有暗中增加 SSE、真实凭据或生产启动路径；
- Implementation Style Guardrails 得到遵守，没有为每张表建立多层样板。

若独立审查发现上述决定与冻结基线冲突，应保持本文件 Proposed 并修订，不得通过实现先行把提案事实化。

## 14. 结论

WO-03 的安全核心不是浏览器按钮，而是一次可证明的 admission：明确资源、明确 run、可信 principal、版本化时间策略、服务端 review fact、不可变离线命令和 scoped revision。Kiosk 可以在断网后重放意图，但不能重写历史、替服务端决定事实，或在 terminal run 后自行创造一次新的拍摄。
