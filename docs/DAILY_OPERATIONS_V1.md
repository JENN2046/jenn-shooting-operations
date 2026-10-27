# 今日作业只读投影 v1

`GET /api/v3/business/daily-operations?date=YYYY-MM-DD` 复用现有 business/state
认证与资源范围；仅 Schema12 可用。省略日期时，以服务端观察时间的 Asia/Shanghai
日期为准。日期须为真实日历日期；重复日期、未知参数被拒绝。

返回 `ok / version / date / businessToday / timeZone / observedAt / revisions`，以及：

- `todaySessions`：按计划开始、场次 id 排序的非取消场次；跨日计划按日期相交计算。
  今日还包括持续至今的旧日 shooting/blocked。保留原计划、缓冲、绑定订单、原始 runs、
  实际起止和经既有调整回执验证的 `confirmedForecast`，附参考图与下一处理入口。
- `currentSession`：唯一有实际 shooting/blocked 事实的场次；多场执行中时返回 null，
  以 UNKNOWN_OCCUPANCY 明确暴露歧义。计划占用不完整不会抹掉已知的实际执行事实。
- `nextSession`：当天计划顺序中最早的 confirmed、尚无开拍事实场次。
  逾期仍保留为待开始，并进入待处理；此选择不声称它已经开拍或结束。
- `readyUnscheduledOrders`：open、样品 arrivedVerified、有明确时长或生效配置默认时长、
  且无非取消 schedule binding。复用现有排程器时长解析；不靠 UI 或模型猜测。
  按期望日期、优先级、id 排序。它表示资料具备，不授予写权限或保证产能可用。
- `attentionQueue`：下表的确定性事项，含 code、severity、entityType/entityId、summary、
  recommendedAction、reason/sourceFacts；按规则顺序、实体类型、实体 id、摘要排序。
- `summary`：总数、实际完成/拍摄中/受阻、待开始、待处理/可排订单数、最晚预计拍完时间，
  以及当前场到下一场的计划间隔（未扣除缓冲）。完成场次的结束取实际 completedAt。

| 顺序 | Code | 事实条件 |
|---|---|---|
| 1 | BLOCKED_RUN | 当前 run 明确为 blocked |
| 2 | UNKNOWN_OCCUPANCY | 范围内计划占用不完整、执行记录矛盾、多场执行中或无法编译 forecast 工作窗口 |
| 3 | PAST_CONFIRMED_WITHOUT_RUN_FACT | confirmed 已过计划结束，仍无实际开拍/完成事实 |
| 4 | WRITE_ADMISSION_DISABLED | 现有 write admission 为 disabled；读取保持可用 |
| 5 | FORECAST_OUTSIDE_WINDOW | 已确认 forecast（含缓冲）不在现有日历编译器给出的工作窗口内 |
| 6 | DESIRED_DATE_AT_RISK | 未完成且期望日期已过，或截至所选日期仍未排，或计划/已确认 forecast 晚于期望日 |
| 7 | UNSCHEDULED_READY | 符合 readyUnscheduledOrders 条件 |
| 8 | SAMPLE_NOT_READY | 未排 open 订单的样品尚未核实到货 |
| 9 | DURATION_MISSING | 未排 open 订单没有可用明确/默认时长 |

该日期筛选不是历史状态重放：run 状态始终是当前已记录事实。输入中的观察时间明确，
投影不自行读时钟；同一快照、观察时间、日期产生同一结果。管理快照在只读事务中读取，
并内嵌 `dailyOperations`，管理页无需另发请求或在浏览器重新推断业务状态。

页面顶部是概览、当前/下一场、待处理和可排订单；完整日历、订单、时长、动态调整、
改期与 Proposal 留在下面。快捷按钮只定位、选择或填入现有表单，不提交写请求。
原 preview、人工采用、CAS、idempotency 和原 operationId 回执核对路径保留；后台新快照
不会重置草稿或替换其 CAS 基线。未保存草稿所见的较新作业入口要求先刷新再选择。
请求级入口通过 sourceFacts 中的绑定 id 解析场次；绑定不唯一时要求人工明确选择。

没有新表、migration、写权限或 Agent command；Trusted Action 与 compatibility 基础设施
不变。现有 `read_state` 已有 scoped orders/sessions/progress，可复用回答今日/当前/下一场，
但没有完整时长/confirmed forecast，不能声称它已经覆盖所有 daily attention。
本批不扩充 Agent API；P1D 若需要完整 briefing，另行复用这个只读投影。


## R1.1 展示层说明

Product R1.1（#92）只调整 `/manage` 的 Studio Day presentation，不改变本文件定义的
Daily Operations v1 read model 或 API 语义。

展示层当前约定：

- 登录后的状态头压缩为更紧凑的日常工具栏，但 identity、auto-sync、refresh、logout、
  pending reconciliation 与错误提示继续保留；
- `attentionQueue.severity` 直接映射为可见文字：
  `critical → 阻塞`、`warning → 需核对`、`info → 提醒`，不能只依赖颜色表达优先级；
- 后端 `attentionQueue` 仍完整保留 `UNSCHEDULED_READY`。因为页面已有独立
  `readyUnscheduledOrders` 区域，主待处理列表在 UI 层不重复渲染这类项目；这不修改
  API 数据、排序或业务条件；
- 当前拍摄卡的 primary action 为「本人现场」，下一场卡的 primary action 为「查看并开拍」。
  这只是视觉层级，按钮仍调用原有 navigation/selection handler，不会自动 POST、自动开拍
  或绕过 preview/CAS/idempotency/receipt reconciliation；
- attention 与 ready 列表默认展示前 5 条，可本地展开/收起；展开状态属于纯 UI state，
  同一 snapshot 自动刷新不会改变服务器事实，也不会创建业务写入；
- 移动端日常按钮采用更大的触控尺寸，并移除嵌套小滚动区；这些变化不改变 canonical facts。

因此，R1.1 后仍成立：

`read model / API / business semantics changes = 0`

当前产品源码已经包含 R1 + R1.1，但真实日常客户端验收由父任务 #89 单独记录。
在该验收完成前，不应把 fixture/Chromium/CI 通过表述为
`JSO_PRODUCT_R1_REAL_USE_ACCEPTANCE_PASS`。
