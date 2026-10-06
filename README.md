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

**G1 CORE_CANONICAL / G2 MINIMAL_RELEASE_CONTRACT 已关闭**。本次生产前置动作以
`codex/v2-1-architecture-freeze @ 26a3390035fa209bbd1a926a3ebb1bb0df486935`
为 authority base。

当前 Gate 仍是 **G3 SCHEMA11_CUTOVER Preparation**。已授权并完成
`G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10`：生产数据库由 Schema 6 对齐到 Schema 10，
migration 11 保持不存在，`integrity_check=ok`、FK violation=0，并在 normal writers 继续被
contain 的状态下建立了独立验证的 Schema-10 recovery artifact。

**BLOCKED_SOURCE_SCHEMA_MISMATCH 已清除。** 但 Schema 11 cutover 仍未授权、未开始；
executable G3 packet 仍未创建，旧 Schema-6 生产容器保持 stopped / restart=no，不能重新启动。

## 入口

- [G3 Source-Prefix Alignment 6→10 R1](docs/operations/G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10_R1.md)
- [G3 Schema 11 Cutover Preparation R1](docs/operations/G3_SCHEMA11_CUTOVER_PREPARATION_R1.md)
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
