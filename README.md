# Jenn Shooting Operations

Jenn Shooting Operations 是 `jenn-shooting-planner` 的独立协作服务边界。

它负责：

- 需求提报；
- 排班数据的唯一云端事实源；
- 只读排班看板；
- VCPChat 工作台的受控同步；
- 审计、备份与恢复。

它不负责：

- AI 视频生成、审片或交付；
- 群晖素材库管理；
- VCPChat 图表渲染；
- 未经确认的腾讯云部署或生产配置。

## 当前阶段

截至 **2026-10-30**，成果集成主线为 **`main`**。当前已部署的 JSO 代码基线为
`f39be58afa8787c4a5ecdfb9de9c12bb0cfd3511`（#96），生产 Node 为 **24.22.1**。
组件关系、事实权威与实际启用状态见[当前系统架构图](docs/architecture/CURRENT_SYSTEM_ARCHITECTURE.md)。
VCP 原生改期与完整采用的兼容代码已部署，只读会话核验通道已启用；日常客户端的
Owner 会话已通过实际 WSS 核验。适配策略仍为只读，生产客户端准入、原生业务写入和最终验收尚未完成。

Schema12 / V3 已包含五类订单、排程与预计结束、实际开拍/完成、参考图、管理员会话、
本人现场、受限 Kiosk、R5 原生对话接入，以及 Product R1 的 **Studio Day / 今日作业台**。
今日作业通过只读 Daily Operations 投影汇总当天场次、当前/下一场、可排未排订单和
确定性待处理事项；R1.1 仅优化登录后首屏密度、严重级别文字、动作主次与移动端触控，
没有改变 read model、API、Schema、写权限或业务语义。

真实 Agent 日常链路已在 #83 完成验收：
`VCPChat → VCPToolBox → JENN Extensions → JSO`。
AIC-R1 已在 #86 关闭；当前 canonical compatibility release 为 **`JSO_AGENT_R2`**，
immutable paired harness 为
`a6c7d447ddaa29799c60aa109d5119b102d1eae4`。该兼容发布固定的是已验收 runtime
component pins；后续 caller-only CI 提交不自动变成新的 runtime compatibility release。

Studio Day 的源码与 UI polish 已分别通过 #90 / #92 合入 `main`，但父任务 #89
**仍未完成真实日常客户端验收**。当前准确状态是：
`JSO_PRODUCT_R1_REAL_USE_ACCEPTANCE_PENDING`。源码合并、CI、兼容验证与 Jenn
日常客户端真实使用属于不同证据层，不能互相替代。

腾讯开发机与 Linux 日常 Chat 的既有图表验收仍保留：指定测试场次已完成认证读取、
15 分钟后移保存、恢复保存和原 operationId 回执核对。该结论绑定当时安装版本与测试场次，
不能自动扩展为 Studio Day 已在所有设备/稳定生产环境完成真实使用验收。

旧 G3 Schema11 记录属于历史域切换与治理路线。物理切换、授权核对和 UNKNOWN 恢复
继续保留历史效力，但不再作为当前产品主线。完整阶段、取舍、来源与仍待验收事项见
[项目开发史](docs/PROJECT_DEVELOPMENT_HISTORY.md)。

## 入口

- [当前系统架构图与启用边界](docs/architecture/CURRENT_SYSTEM_ARCHITECTURE.md)
- [项目开发史](docs/PROJECT_DEVELOPMENT_HISTORY.md)
- [今日作业只读投影 v1](docs/DAILY_OPERATIONS_V1.md)
- [Schema12 首发业务路径](docs/operations/first-launch-v3.md)
- [R5 原生对话接入](docs/operations/NATIVE_VCP_STARTUP_R5.md)
- [历史 G3 Schema11 Exact Cutover Target R1](docs/operations/G3_SCHEMA11_EXACT_CUTOVER_TARGET_R1.md)
- [历史 G3 Source-Prefix Alignment 6→10 R1](docs/operations/G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10_R1.md)
- [历史 G3 Schema11 Cutover Preparation R1](docs/operations/G3_SCHEMA11_CUTOVER_PREPARATION_R1.md)
- [G2 Minimal Release Contract](docs/operations/G2_MINIMAL_RELEASE_CONTRACT.md)
- [JSO Core Canonical R1](docs/JSO_CORE_CANONICAL_R1.md)
- [执行计划（历史初始阶段计划）](docs/EXECUTION_PLAN.md)
- [部署前检清单](docs/DEPLOYMENT_PREFLIGHT.md)
- [同步协议](contracts/SYNC_PROTOCOL.md)
- [排班快照 Schema](contracts/schedule-snapshot.schema.json)
- [需求提报 Schema](contracts/request-submission.schema.json)

## 当前数据校验

```powershell
node scripts/validate-current-planner.mjs `
  "<VCPCHAT_ROOT>\AppData\Charts\jenn-shooting-planner\data.json"
```

校验器只读取工作台数据，不写入、不迁移，也不会访问网络。

## 本地验证

日常 Schema12/V3 修改使用当前开发 gate：

```sh
npm run check:current
```

兼容、历史保障分别使用 `npm run check:compat`、`npm run check:historical`。
混合职责的测试文件会明确出现在多个 lane；新增测试必须加入
`tests/test-lanes.json`，每条 lane 都会先校验完整性。
逐项职责、完整回归要求与固定验证环境见[测试 lanes](docs/TEST_LANES.md)。

原有完整回归入口继续保留：

```powershell
npm run check
```

默认启动地址是 `127.0.0.1:3800`。健康检查、只读排班、需求提报和附件上传
可公开访问；排班修改接口始终需要有效的 `SCHEDULER_TOKEN`，未配置时失败关闭。

## 孤立上传维护

默认命令只读预演，报告超过 24 小时且尚未绑定任务的上传数量，不修改数据库或文件：

```powershell
npm run uploads:cleanup
```

确认预演结果后，维护人员可以显式执行清理：

```powershell
npm run uploads:cleanup -- --apply
```

可用 `--max-age-hours <hours>` 调整保留期。命令读取 `DATABASE_PATH` 和
`UPLOAD_ROOT`；默认输出只有统计数量，不输出上传文件名或内容。执行模式与在线上传
共同使用 SQLite `BEGIN IMMEDIATE` 写锁，文件去重、引用复核和删除在同一写临界区
内完成，避免相同哈希文件被并发上传重新引用后又遭清理。待删除文件先原子重命名
到同一上传卷内的专用 `.cleanup` 目录，数据库提交后才最终删除；进程在提交前终止
时，后续 Store 会依据仍存在的上传记录自动恢复该文件。恢复只扫描 `.cleanup`
目录，不会随永久保留的已认领资产数量线性变慢。

### Optional public daily board (Schema12)

`JSO_PUBLIC_BOARD=enabled` exposes only confirmed, resolved Jenn schedule items and their associated order details/reference images at the existing board page. Unscheduled orders, cancelled/draft items, management state, configuration history and credentials are excluded. Anyone with the public URL can read those scheduled customer details and download the associated images. The default is disabled. This flag is bound by the existing runtime configuration digest (including R5); use a matching immutable image/source and acceptance installation rather than editing a live container.

The public read routes are `GET /api/v3/public/board` and `GET /api/v3/public/board/references/:id`. A reference must belong to an actual order in that public schedule; knowing an arbitrary upload ID is insufficient. Existing business/management reads, all mutations and uploads keep their original authentication. `/manage` continues to use the administrator's private credential; no credential is embedded in the public board.

公开看板开关默认关闭；启用后任何可访问链接者都能读取约定排期、客户说明与关联参考图，系统不识别“同事”。公共JSON和图片请求不携带Cookie或Bearer，管理页的现有浏览器会话、本人V4队列、Agent及独立Kiosk认证保持。启用时沿用现有R5 source/image/runtime绑定，同时保留browserSessions配置摘要；本变更不自动启用生产。

## 图表中的未来日期计划调整

未开拍、未锁定且无执行记录的已确认场次，可在其原北京时间日期内拖动（含未来日期）。复用 day-adjustment preview/apply：按该日期的工作日历和缓冲计算，并在预览中列出该日期后续场次的影响；不自动跨天。正在拍摄或受阻的预计结束调整仍仅限当天，不改写实际开拍／完成事实。跨日期移动继续使用管理页拍摄改期。

保存继续使用原预览摘要、版本核对、幂等操作和回执；自动补读沿用认证 HTTP 约5秒轮询。其他日期固定占用与不确定实际结束仍保守核验，不能通过选择未来日期绕过冲突。需要配套 JsoChartEditor 提示升级；此源码候选不代表已部署。
