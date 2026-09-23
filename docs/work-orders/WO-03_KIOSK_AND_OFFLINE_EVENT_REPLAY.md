# WO-03：Kiosk 与离线事件重放

- 状态：`PASS_WITH_LIMITS / BROWSER_AND_DEVICE_NOT_RUN`
- 执行分支：`codex/v2-1-architecture-freeze`
- 架构基线：`JSO-ARCH-V2.1-R4`
- 前置门：WO-00 `PASS`、WO-01 `PASS`、WO-02 `PASS_WITH_LIMITS`
- 当前约束来源：`docs/architecture/decisions/ADP-021_KIOSK_COMMAND_ADMISSION_AND_OFFLINE_REPLAY.md`
  `ACCEPTED_AND_FROZEN`；已通过独立复核并纳入 `JSO-ARCH-V2.1-R4`
- 范围：Kiosk V2 读/写契约、可信角色边界、首次 Run provisioning、时间复核、纯离线队列、有限轮询、Kiosk UI 和受限浏览器验收
- 明确不包含：V1 接口变更、真实/现有业务库读取或写入、active auth config、真实 token、持久或对外服务启动、生产配置、Switch、部署、发布、SSE、cancel、correction、自动重拍

## 1. 绑定决定

- ADP-006：Kiosk 可重试事件使用唯一 `eventId`，exact replay 返回原结果，不同 payload 复用失败关闭；
- ADP-007：现场状态使用追加事件与物化 run，普通路径不得静默改写历史；
- ADP-008：服务端 `receivedAt` 是权威时间，超出版本化边界的 `occurredAt` 不得污染工时；
- ADP-010：Kiosk 通过独立 HTTP Interface 接入，只能读取当前任务和提交现场事件；
- ADP-012：离线队列不是事实源，只能保存待发送事件和最小只读缓存；
- ADP-014：现场事件使用 capability 授权，不能仅靠隐藏按钮；鉴权未配置时受保护写入失败关闭；
- ADP-017：现场事件只增加对应 `runRevision + projectionRevision`，不得增加 `scheduleRevision`；
- ADP-018：`single` 使用 task-scope run；`grouped_unallocated` 使用 block-scope run并显示全部绑定任务，不分摊工时；
- ADP-019：Request、Schedule Item 和 Production Run 是不同实体；历史迁移不伪造 run/event；
- ADP-020：strict write/legacy read、稳定差异分类与失败零事实/零 revision 继续适用；
- ADP-021 `ACCEPTED_AND_FROZEN`：首次 start provisioning、trusted principal、time-review、离线重放与有限轮询语义；
- Implementation Style Guardrails：保持普通 ESM、明确 Application Use Case 和 SQLite transaction，不增加无业务价值的 Controller/Manager/Repository 层级。

ADP-021 已冻结；03B 已在本地注入式 Auth Port 与临时 SQLite 边界内完成，03C 已完成纯离线队列和并发重放防线，03D 已完成零构建 Kiosk UI 与静态接线。生产身份、真实凭据、浏览器/真机验收、服务启动和生产可用仍受各自门禁约束。

## 2. 冻结语义摘要

### 2.1 首次 Run provisioning

Kiosk 事件路由继续以 Schedule Item 为边界：

```text
POST /api/v2/schedule-items/:id/events
```

每个 Kiosk 事件请求体必须携带 `runId`。首个 `start` 使用客户端 Web Crypto 生成的 `runId`；
服务端只在同一 `BEGIN IMMEDIATE` 中满足以下全部条件时创建 `runRevision = 0` 的 run，并立即应用该 start：

- Schedule Item 存在；
- `schedule_status = confirmed`；
- `resource_resolution_status = resolved`；
- 该 Schedule Item 从未存在任何 Production Run；
- `single` 时间块创建 task-scope run，且唯一 task binding 一致；
- `grouped_unallocated` 时间块创建 block-scope run，且不得制造单任务时间或工时。

存在非终态 run 时，事件必须携带该 run 的 exact `runId`。只要存在 terminal 或其他历史 run，Kiosk 不得自动创建重拍 run，固定返回 `RUN_PREPARATION_REQUIRED`。新的重拍/重做尝试必须由后续明确授权的 scheduler 命令准备，不复活旧 run。

首次 run、event、receipt、revision、投影和 audit 必须作为一个事务结果提交；任一失败整体回滚。`GET` 路径绝不 provisioning，也绝不写数据库。

### 2.2 Event 与可信身份

Kiosk HTTP body 允许：

```text
schemaVersion
eventId
runId
scheduleItemId
expectedRunRevision
eventType
occurredAt
deviceId
localSequence
reasonCode?
note?
```

URL path 是路由权威；body 中的 `scheduleItemId` 必须与 path 完全一致，二者不一致时失败关闭。
`localSequence` 只是非权威交付元数据，不参与权限、状态选择或 revision。body 禁止接受以下权威字段：

```text
actorId
role
previousState
resultingState
receivedAt
```

`actorId` 和 `role` 必须由已认证 trusted principal 注入。`deviceId` 只用于设备/审计关联，不授予角色或 capability，也不得替代操作者身份。

V2 鉴权必须改为显式 capability matrix，至少冻结：

| Capability | viewer | submitter | operator | scheduler | administrator |
|---|---:|---:|---:|---:|---:|
| `readSchedule` | 是 | 是 | 是 | 是 | 是 |
| `submitRunEvent` | 否 | 否 | 是 | 是 | 是 |
| `modifySchedule` | 否 | 否 | 否 | 是 | 是 |

不得通过给线性 role level 插入一个数字来推导全部权限，也不得使 `operator` 因层级关系意外获得需求提交或正式排期写入能力。

Kiosk 首版只发布：

```text
start
block
resume
complete
```

底层已有的 `cancel` 不进入本工作包 HTTP/UI；`correction` 继续等待独立契约和授权决定。

### 2.3 Time-review

本地 V2.1 首版策略标识为 `kiosk-event-time-local-v1`：

```text
futureSkew: 5 minutes
pastAge: 24 hours
```

服务端 `receivedAt` 是权威时间。`occurredAt` 超过上述窗口时，不得直接污染 run 或工时，而是在同一事务保存同 `eventId` 的 `run_event_reviews` pending 记录/receipt：

- 不创建或修改 Production Run；
- 不插入 `production_events`；
- 不增加 `runRevision`、`projectionRevision` 或 `scheduleRevision`；
- exact replay 返回同一 review receipt；
- 同一 `eventId` 不同 payload 返回 `409` 幂等冲突；
- 队列收到 review 结果后停止重放并进入 `reviewRequired`，不得自行改写时间或 revision 后重试。

review 的批准、拒绝、修正及其角色边界不属于 WO-03；本批只建立 pending intake 和幂等读取语义。

### 2.4 Current read 与有限轮询

最小读接口：

```text
GET /api/v2/kiosk/current?resourceId=...
```

读模型必须来自规范化 V2 facts，不得调用 V1 `schedule_state` 作为 Kiosk 权威来源。返回至少覆盖：

- `projectionRevision` 和服务端当前时间；
- resource scope；
- 当前 Schedule Item、全部 task bindings 和对应 request 展示字段；
- active run、`runId`、状态和 `runRevision`；
- 下一 confirmed item 和计划时间；
- grouped block 明示“组合场次，未拆分单任务工时”；
- 无当前任务、V2 未初始化、资源未解析和需要人工处理的可区分状态。

多资源或单资源部署都不得静默选择数据库第一条记录。调用方必须显式传 `resourceId`，并由
trusted principal 的 resource scope 校验。

首版不实现 SSE。HTTP read 支持 `ETag / If-None-Match`；页面可见时每 3 秒轮询，错误退避上限 30 秒，页面不可见时暂停或显著降频。轮询与响应发送都在写事务之外。

## 3. 分批顺序

### WO-03A：Contract、Schema、Role 与 Time-review Freeze

状态：`PASS_WITH_LIMITS`

交付：

- ADP-021 独立复核、修订和冻结；
- `contracts/kiosk-current.v2.schema.json`；
- `contracts/kiosk-run-event.v2.schema.json`；
- `contracts/kiosk-run-event-result.v2.schema.json`；
- 稳定 HTTP status/error code 映射；
- `run_event_reviews` 的单调 SQLite migration、约束、索引和幂等 ownership；
- capability matrix 与 trusted principal 最小契约；
- `local-v1` time policy 及边界时刻测试表；
- first-start、existing-active、historical-terminal、review-pending 四类事务状态机测试设计；
- 低披露规则：HTTP 错误不得返回 SQL、绝对路径、stack、token 状态细节或业务正文。

验收：

- [x] ADP-021 状态为 `ACCEPTED_AND_FROZEN`，独立复核无 Critical/Major；
- [x] command schema 禁止 `actorId/role/previousState` 等客户端权威字段；
- [x] `runId`、URL `scheduleItemId`、`eventId` 和 payload digest 的幂等关系无双重权威；
- [x] review receipt exact replay 与 payload reuse conflict 被契约测试覆盖；
- [x] `run_event_reviews` 不能与已应用 `production_events` 对同一 `eventId` 同时成为成功事实；
- [x] capability matrix 明确覆盖五个角色，未配置鉴权时写入失败关闭；
- [x] Schema migration 重跑幂等，checksum/name/partial drift 失败关闭；
- [x] 未修改任何 V1 HTTP 或 V1 contract。

进入 WO-03B 的门：`PASS_WITH_LIMITS`。限制是 HTTP/read/provisioning/review use case、离线队列、UI、浏览器与真机验收仍未实现；这些限制不阻止 03B 本地开发，但禁止宣称 Kiosk 已可用或 production-ready。

### WO-03B：Backend HTTP、Read Model 与 Run Provisioning

状态：`PASS_WITH_LIMITS`

交付：

- `GET /api/v2/kiosk/current` 专用只读 use case 与 SQLite read adapter；
- `POST /api/v2/schedule-items/:id/events` 薄 HTTP Interface；
- capability 鉴权、trusted principal 注入和最小审计；
- first-start 原子 provisioning 与 existing-run event application；
- pending time-review 原子 intake 和 exact replay；
- stable result 到 HTTP status/code 的显式映射；
- current-read `ETag / 304` 支持；
- 真实内存/临时 SQLite 测试与现有 run-event 回归。

验收：

- [x] `viewer/submitter` 不能提交事件，`operator/scheduler/administrator` 可以；
- [x] `operator` 不获得 `modifySchedule`；
- [x] 客户端伪造 actor/role/state 被 Schema 拒绝，持久化身份只来自 principal；
- [x] first start 仅在 confirmed + resolved + zero-history 条件下原子创建并应用；
- [x] 双连接并发 first start 只有一个事实结果；
- [x] exact replay 不重复计时、建 run、写 event 或增加 revision；
- [x] active run 必须 exact `runId`；terminal/history 返回 `RUN_PREPARATION_REQUIRED`；
- [x] start → block → resume → complete 的净工时正确；
- [x] grouped complete 不自动 fulfill 每个 request，也不产生 task-level 工时；
- [x] time-review 产生 pending receipt 且零业务事实、零业务 revision；
- [x] run event 只增加对应 `runRevision + projectionRevision`，`scheduleRevision` 不变；
- [x] current GET、ETag/304 和失败路径均零写入；
- [x] V1 service、上传清理、migration 和 WO-02 run-event 测试继续通过。

资源存在性由通过 `validateTrustedPrincipal` 的 `principal.resourceIds` 权威声明；排期行只是可变工作负载事实，不能兼任资源目录。因此已授权但暂时没有任何 Schedule Item 的资源返回合法空 DTO，而未进入 principal scope 的资源在读取前返回 `FORBIDDEN`。03B 没有配置真实身份提供方或生产 token，运行时只提供显式 `kioskAuthenticate` 注入接缝；未注入时 V2 Kiosk 路由以 `AUTH_NOT_CONFIGURED` 失败关闭。

03B 的 `PASS_WITH_LIMITS` 表示本地 HTTP、read model、provisioning、review、receipt integrity、ETag 与 runtime composition 已通过测试和独立审查；它不表示真实鉴权、现有业务库、服务启动、Kiosk UI、浏览器或生产已就绪。

实现目标应接近：

```text
HTTP Interface
  → Kiosk Application Use Case
      → existing Run Event Unit of Work / domain rules
      → small SQLite Kiosk read adapter
```

不得把 SQL 直接堆入 HTTP router，也不得为每张表建立 Repository/Service/Manager 样板。

### WO-03C：Pure Offline Queue and Replay

状态：`PASS_WITH_LIMITS`

交付：

- 与 DOM、localStorage 和真实网络解耦的纯队列状态机；
- 浏览器 storage adapter 和可注入 transport/clock；
- queue item schema：`schemaVersion/eventId/runId/scheduleItemId/expectedRunRevision/eventType/occurredAt/deviceId/localSequence/reasonCode?/note?`；
- write-ahead enqueue：发请求前先持久化；
- 固定重连顺序：refresh current → 按 `localSequence` replay；
- `synced | pending | conflict | reviewRequired` 同步状态；
- exact success/replay 删除一项；首个 conflict/review 停止；
- 网络失败保留队列，不伪装成功，不自动 rebase revision；
- 最小只读缓存与权威 server state 明确分离。

验收：

- [x] 连点、重复 enqueue 和重复 replay 不制造重复事实；
- [x] 队列顺序稳定，删除只能发生在明确 success 或 exact replay 后；
- [x] 首 conflict 停止，后续事件不越过冲突发送；
- [x] reviewRequired 停止，且不修改 occurredAt、eventId 或 expectedRunRevision 后重试；
- [x] 刷新/崩溃后 pending 队列可恢复；清空浏览器缓存不改变服务端事实；
- [x] localStorage 不保存 token、trusted actor/role 或完整业务数据库；
- [x] server status 与 sync status 为两个独立维度；
- [x] 多标签页/重复 worker 场景依赖服务端幂等仍保持单一事实结果。

03C 使用与 DOM、真实网络解耦的 queue core，并提供 browser storage/fetch adapters。持久层采用不可变 item、永久 sequence marker 和按事件单调 terminal marker：陈旧的 cache/pending commit 不能覆盖 concurrent conflict/reviewRequired；只有 exact applied/replayed head removal 可以清除对应终态。完整 browser-safe response validation 在任何 `<500` 状态变更前执行，且 refresh 只接受冻结的 `200/304`。

03C 的测试使用 fake storage/transport 和内存 localStorage surface，不调用真实服务、不启动持久进程、不读取真实数据库。`PASS_WITH_LIMITS` 不表示 Safari/Chromium 真实存储配额、设备生命周期或清缓存体验已完成真机验证。

### WO-03D：Kiosk UI、Polling、Browser and Device Acceptance

状态：`PASS_WITH_LIMITS / BROWSER_AND_DEVICE_NOT_RUN`

交付：

- `public/kiosk.html`、`public/kiosk.js` 和必要的 Kiosk 样式；
- 全屏深色高对比布局、大触控目标、当前/下一任务、组合场次标识；
- start/block/resume/complete 控件，complete 二次确认；
- 防连点、待发送计数、冲突和 reviewRequired 明确反馈；
- 页面可见时 3 秒 ETag 轮询、失败退避不超过 30 秒；
- 键盘、触控、屏幕阅读器标签和 reduced-motion 基线；
- 桌面、平板、手机视口的浏览器测试计划；
- 摄影棚真机检查表和未执行项记录。

验收：

- [x] Kiosk UI 不调用 V1 写接口，也没有正式排期编辑入口；
- [x] 本地乐观状态不会伪装为服务端确认状态；
- [x] 页面刷新、断网恢复、连点、冲突、reviewRequired 和幂等重放具有明确本地状态与恢复逻辑；
- [x] grouped 场次显示全部任务和“未拆分单任务工时”提示；
- [x] HTML/JS 不嵌入 token、actorId、真实 endpoint credential 或环境配置；
- [x] 静态路由继续使用白名单、CSP、HTML `no-store`；
- [x] 桌面/平板/手机的静态可访问性证据与未执行浏览器项目已分别记录；
- [x] 真机验收未执行状态已明确记录，未宣称 WO-03 或 Kiosk production-ready。

Playwright 不在 03A–03C 自动引入。进入 03D 时必须单独判断：

- 是否确有浏览器自动化价值；
- 依赖、lockfile、浏览器二进制、缓存和 CI 成本；
- 是否可继续使用当前零构建原生前端；
- 是否需要任何服务启动或网络访问；
- 替代方案能否覆盖关键验收。

未经该判断，不修改 `package.json/package-lock.json`，不下载浏览器。当前工作包不授权持久或对外服务启动；需要 loopback/browser/真机服务面时必须另行建立有界执行条件。

03D 判断结果：不引入 Playwright，不修改依赖或 lockfile，不下载浏览器。理由、静态证据、桌面/平板/手机计划和摄影棚真机 `NOT RUN` 清单见 `docs/acceptance/WO-03_KIOSK_BROWSER_AND_DEVICE_ACCEPTANCE.md`。

## 4. 文件所有权

| 轨道 | 独占范围 | 目标 |
|---|---|---|
| Contract / Schema | ADP-021、`contracts/kiosk-*.v2.schema.json`、validator、`run_event_reviews` migration/tests | 冻结 HTTP、幂等、review、角色与 Schema |
| Backend | `src/auth.mjs`、`src/server.mjs`、`src/http-app.mjs`、Kiosk use-case/read adapter、后端 HTTP tests | 可信 principal、read、provisioning、event/review transaction |
| Queue | 纯队列模块、storage/transport adapters、queue unit tests | write-ahead、顺序重放、首冲突停止 |
| UI | `public/kiosk.html`、`public/kiosk.js`、Kiosk 样式、UI helper tests | 现场交互、同步状态、轮询和可访问性 |
| Browser / Device | 03D browser harness、视口/可访问性证据、真机检查记录 | 不越过服务启动和真实凭据边界 |
| Commander | 本工作包、跨轨集成、回归、独立复核与分批提交 | 串行共享文件、守住冻结决定与非范围 |

共享文件规则：

- `src/auth.mjs`、`src/server.mjs`、`src/http-app.mjs` 只允许 Backend 轨道编辑；
- `package.json/package-lock.json` 只在 03D Playwright 判断通过后由 Commander 串行处理；
- Contract/Schema 轨道冻结 public contract 后，Backend/Queue/UI 才能依其实现，不得各自定义 error code；
- UI 不编辑后端 auth/router；Backend 不编辑 `public/kiosk*`；
- 各轨使用独立测试文件，Commander 最后整合共享测试与文档。

## 5. 总验收门

- [x] ADP-021 已独立复核并冻结；
- [x] 03A contract、Schema、capability 和 time-review 全部门禁通过；
- [x] 03B HTTP/read/provisioning/review 全部门禁通过；
- [x] 03C queue/replay 全部门禁通过；
- [x] 03D UI/轮询/浏览器验收达到其已授权范围；
- [x] V1 四个保留接口的契约和行为未改变；
- [x] 当前 V1 board/submit/upload cleanup 与 crash recovery 回归未退化；
- [x] 无任何真实/现有业务库读取或写入；
- [x] 无 `.env`、active auth config、真实 token、credential 或 provider 配置读取/修改；
- [x] 无持久/对外服务启动、生产调用、外部通知、Switch、部署或发布；
- [x] `npm run check`、targeted tests、`npm audit --omit=dev`、`git diff --check` 通过；
- [x] 独立终审无 Critical/Major，且所有未执行浏览器/真机项目被明确标为限制；
- [x] 未以 local fixture、mock、静态页面或未执行真机验收宣称 production-ready。

## 6. 明确非范围

本工作包不授权或不实现：

- 修改、退役或切换任何 `/api/v1` 接口；
- V1 PUT Adapter、VCP Switch 或兼容观察期；
- 读取或写入真实、现有、生产数据库和上传卷；
- 读取或修改 `.env`、active auth config、token、cookie、credential、provider 配置；
- 真实 token、生产身份提供方或真实操作者映射；
- 持久服务启动、LAN/公网暴露、反向代理、域名、证书和部署；
- SSE/WebSocket；首版只使用 ETag 有限轮询；
- Kiosk cancel、事件 correction、review approve/reject；
- terminal/history run 后由 Kiosk 自动创建重拍；
- 修改正式排期、时间、资源、Buffer、priority、lock 或 task bindings；
- 外部 URL 抓图或任意 Brief URL 访问；
- 钉钉 Outbox、Agent Proposal、训练样本生成；
- 未经 03D 单独判断引入 Playwright 或其他前端框架/构建链。

## 7. 当前风险与停止条件

### 当前风险

- 真实身份提供方、token/cookie/session、操作者映射和设备交接尚未配置；未注入 Auth Port 时 Kiosk API 失败关闭；
- 浏览器、iPad/平板、手机、真实断网恢复、存储配额和清缓存体验均未执行，详见 acceptance checklist；
- localStorage adapter 保留小型永久 sequence marker 以避免并发清空后的序号回退；真实设备上的长期容量和维护策略尚未验证；
- 同 projection revision 的并发 cache meta 写可能使非权威 `lastSyncedAt` 回退；它不改变队列 item、terminal marker、server fact 或 revision，也不能重新开放已停止的队首；
- 多资源部署仍要求调用方显式传 `resourceId` 并通过 trusted principal resource scope，不存在默认资源选择；
- 受控封面尚无安全读取路由；本工作包不得用任意外部 URL 抓取补齐；
- 本批没有启动服务、接触真实业务库或执行真实身份链路，因此不能从本地测试推导部署/生产就绪；
- 本批已决定不引入 Playwright；真实浏览器自动化需在后续有界工作包中重新判断。

### 停止条件

出现以下任一条件立即停止相应批次，不向后推进：

- ADP-021 独立复核出现未解决 Critical/Major；
- public contract、review ownership、capability 或 run provisioning 出现双重权威；
- 实现要求读取真实库、active auth config、真实 token 或启动对外服务；
- event/review 失败路径消费业务 revision 或产生半提交事实；
- Kiosk 需要通过 V1 PUT、直接 SQL、客户端 actor/role 或自动 rebase 绕过服务端规则；
- 需要修改 V1 接口、Switch、部署、发布或真实外部系统；
- 新依赖或浏览器自动化无法证明必要性和有界副作用；
- 发现会覆盖其他轨道或用户未提交工作的文件冲突。

## 8. 当前结论

结论：`PASS_WITH_LIMITS / BROWSER_AND_DEVICE_NOT_RUN`。

WO-03 已完成冻结契约、Kiosk backend admission、current/updates、首次 run provisioning、time review、纯离线重放队列、静态 UI、轮询和浏览器资源接线。Queue 与 UI 两个独立终审均无 Critical/Major；`npm run check` 为 317/318 通过、1 个既有 external VCP adapter skip，WO-00 fixtures 13/13，`npm audit --omit=dev` 为 0 vulnerabilities，`git diff --check` 通过。浏览器/真机和真实身份链路为明确未执行限制。本状态不代表服务启动、Switch、部署或生产可用。
