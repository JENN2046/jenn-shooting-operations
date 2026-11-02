# 只读日常简报 v1

本模块把已有、已经认证并按资源范围过滤的 [Daily Operations v1](DAILY_OPERATIONS_V1.md)
整理成五个展示段：所选日期安排、当前、下一场、可排未排、阻塞与待处理。
纯投影与渲染函数不获取数据、不读取数据库、不调用模型、不拥有业务状态。
Schema12 的现有 Agent `read_state` 已增加只读接线，复用原入口，不新增工具或路由。
调用方仍负责原有认证与资源范围；`readonly: true` 是输出用途说明，不是授权凭证。

## 本地入口

```bash
npm run demo:daily-briefing
npm run demo:daily-briefing -- --json
npm run demo:daily-briefing -- --html
```

也可直接运行 `node scripts/demo-daily-briefing.mjs`，支持相同参数。
演示只使用 `examples/daily-briefing-synthetic-v1.mjs` 的固定合成事实，经过现有
`projectDailyOperations` 生成投影后再生成简报；不创建数据库或连接任何服务。
日期固定为 2026-10-12（Asia/Shanghai），所有输出明确标记合成样本，不冒充机器今天或真实业务。
`--html` 将独立 HTML 写到标准输出，调用方可显式保存后在浏览器打开；不运行服务器。
CLI 不接受数据库路径、输入文件、URL、身份或凭据参数。

## 代码入口与语义

- `projectDailyBriefing(daily)`：消费现有 Daily Operations v1 的成功结果。
- `renderDailyBriefingText(briefing)`：纯文本展示。
- `renderDailyBriefingHtml(briefing, {synthetic})`：独立静态 HTML，可在无网络时查看。

函数都不读取当前时钟；观察时间和上海业务日期来自输入，版本仅保留原有
`scheduleRevision / projectionRevision`。相同输入得到相同结果，不修改输入。
输出采用字段白名单，不复制 `sourceFacts`、原始 runs、附件内容、身份或任意额外字段。

原投影仍负责业务选择、时长解析、待处理规则和顺序。
展示层只核对所给内容的一致性：不会根据时间自动开拍/完成，不会生成或采用排期，也不会为冲突指针挑选替代场次。
计划时长仅表示计划区间；实际完成只来自输入中一致的实际起止事实；预计结束单列，缺少原操作引用时标为待核对。

## 缺失与矛盾

| 状态 | 展示含义 |
|---|---|
| ready | 已提供该段数据，可查看 |
| empty | 上游明确提供空集合或空指针，且与给定场次一致 |
| unknown | 数据缺失、不完整或执行事实未知，不能解读为空 |
| conflict | 重复标识、多个当前场次、错误指针、日期或绑定等信息冲突 |

`dataQuality=complete` 仅说明这个投影的简报输入没有发现展示一致性缺口，
不代表业务没有阻塞、资料覆盖全部业务事实、数据实时有效、权限已放行或生产验收通过。
遇到缺失字段、汇总与明细不一致、业务日期与观察时间不一致，会输出稳定的核对提示。
无法识别的头部/版本返回固定 `DAILY_BRIEFING_INPUT_INVALID`，不回显输入。

所选日期视图沿用当前已记录事实，不是历史状态重放；观察时间保留显示，不在浏览器偷偷刷新为当前时间。
这一版本没有实时连接或后台刷新，也不把旧快照当作当前运行态。

## 展示边界

页面不包含脚本、外链、网络资源、表单或业务动作按钮，CSP 禁止默认资源加载。
动态字符串经过 HTML 转义；文本输出移除终端控制和双向覆盖字符。
来源依据置于原生折叠区，保留必要的原操作与版本引用，方便人工回查。
HTML 文件本身可能包含调用方提供的授权范围内业务名称，应按其数据边界保存和分享；本地演示仅包含合成信息。

## Agent 只读接线（源码已完成，未部署）

现有 `read_state` 在 Schema12 下增加 `dailyBriefing` 字段，原字段、两字段请求封装和八个 command 保持不变。
调用先经过原有身份、readSchedule 能力与请求资源范围检查；新增读取位于同一个只读事务，
使用同一版本快照和宿主注入的观察时间。请求资源子集不会扩张为身份可访问的全部资源。
Schema11 保持原响应形状；新增投影异常只返回 `dailyBriefing: {ok:false,code:"DAILY_BRIEFING_UNAVAILABLE"}`，
不破坏原成功读取，也不回显异常内容。

`src/agent-daily-briefing-v1.mjs` 复用现有场次读模型及已经过滤的订单字段；不冒充管理角色，
不查询订单估时、附件、场次备注或跨资源订单名称。确认预计结束沿用原操作/回执核验。
因此“所选日期安排、当前、下一场”可展示授权范围内事实，但“可排未排”明确为 unknown，
“阻塞与待处理”仅展示可核实的部分事项，也标为 unknown。未暴露估时不能被描述为缺失估时，
部分目录不能被描述为没有待办。`dataQuality` 为 `needs_review`。
这与固定演示消费完整合成投影的展示覆盖范围不同。

本批没有扩充 Agent command、公开 MCP、API 路由、业务数据库 Schema、写权限、通知或 Home 常驻服务。
真实运行接入与部署另行验收，不能让模型传入身份、令牌或任意目标地址。

## 验证

投影、渲染、Agent 接线与集成测试加入 `current` lane；保留原 lane 选择及 CI 行为。
覆盖投影复用、只读不变性、缺失/空数据、冲突、时间与版本、原操作引用、字段白名单、文本/HTML 转义和固定样本标识。
合成样本、隔离测试与静态页面通过不构成真实日常客户端或生产验收。

Agent 验证覆盖 Schema11 兼容、Schema12 query-only/禁写读取、精确资源子集、并发快照一致性、异常降级、
实际 HTTP 鉴权与拒绝提权，以及固定接受版本 Extensions stdio 客户端的字段透传。跨仓测试在缺少显式 peer 时保留可选跳过。
