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

没有新表、migration、写权限或 Agent command；Trusted Action 与 compatibility 基础设施
不变。现有 `read_state` 已有 scoped orders/sessions/progress，可复用回答今日/当前/下一场，
但没有完整时长/confirmed forecast，不能声称它已经覆盖所有 daily attention。
本批不扩充 Agent API；P1D 若需要完整 briefing，另行复用这个只读投影。
