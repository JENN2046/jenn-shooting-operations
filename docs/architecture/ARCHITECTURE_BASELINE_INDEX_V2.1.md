# Jenn Shooting Operations V2.1 Effective Architecture Baseline

- Baseline ID：`JSO-ARCH-V2.1-R6`
- 状态：`FROZEN_FOR_IMPLEMENTATION`
- 生效日期：2026-09-22
- 适用范围：WO-00 至 WO-06 的本地设计、实现、迁移演练和验证
- 不构成：生产部署、真实凭据配置、真实外部调用或生产数据迁移授权

## 1. 有效文档集合

V2.1 的有效架构基线由以下文件共同组成：

1. [Architecture Decision Pack V2.1](ARCHITECTURE_DECISION_PACK_V2.1.md)
2. [ADP-017：Revision Domains and Projection Versioning](decisions/ADP-017_REVISION_DOMAINS_AND_PROJECTION_VERSIONING.md)
3. [ADP-018：Legacy Grouped Session Binding](decisions/ADP-018_LEGACY_GROUPED_SESSION_BINDING.md)
4. [ADP-019：Canonical Work Identity and Lifecycle](decisions/ADP-019_CANONICAL_WORK_IDENTITY_AND_LIFECYCLE.md)
5. [ADP-020：V1 Contract Authority and Compatibility](decisions/ADP-020_V1_CONTRACT_AUTHORITY_AND_COMPATIBILITY.md)
6. [ADP-021：Kiosk Command Admission and Offline Replay](decisions/ADP-021_KIOSK_COMMAND_ADMISSION_AND_OFFLINE_REPLAY.md)
7. [ADP-022：Transactional Outbox and DingTalk Boundary](decisions/ADP-022_TRANSACTIONAL_OUTBOX_AND_DINGTALK_BOUNDARY.md)
8. [ADP-023：Outbox Identifier Compatibility](decisions/ADP-023_OUTBOX_IDENTIFIER_COMPATIBILITY.md)
9. [Implementation Style Guardrails V2.1](IMPLEMENTATION_STYLE_GUARDRAILS_V2.1.md)
10. [VCP 摄制运营调度工作台升级与 Agent 协同演进实施计划书 V2.1](../VCP_SHOOTING_OPERATIONS_EVOLUTION_PLAN_V2.1.md)

## 2. 优先级与替代关系

发生冲突时按以下顺序解释：

```text
当前明确用户决定
→ ADP-017 / ADP-018 / ADP-019 / ADP-020 / ADP-021 / ADP-022 / ADP-023
→ Architecture Decision Pack V2.1 中未被替代的条款
→ Implementation Style Guardrails V2.1
→ 实施计划书 V2.1
→ 普通工作包说明与实现便利性
```

明确替代关系：

| 新决定 | 被替代或细化的旧条款 | 结果 |
|---|---|---|
| ADP-017 | ADP-005 全文；ADP-004、ADP-009、ADP-013 中相关 revision 语义 | 生效 revision 改为 `scheduleRevision`、`runRevision`、`projectionRevision` 三域 |
| ADP-018 | ADP-003、ADP-008、ADP-009、ADP-015 中关于 `schedule_items.taskId` 或单任务假设 | `schedule_items` 表达时间块，任务通过 `schedule_item_tasks` 关联 |
| ADP-019 | 模糊 Request/Task 身份；Schedule/Run 混合生命周期；V1 字段无落点 | `requests_v2` 是 canonical work item；三套生命周期分离；V1 全字段规范化保存 |
| ADP-020 | V1 Schema 与手写 validator 双轨；模糊历史兼容和 V1 PUT 全量覆盖 | Schema + 有限语义规则成为单入口；历史按 L0–L3 分类；V1 PUT 仅表达受控排期差异 |
| ADP-021 | ADP-006、ADP-007、ADP-008、ADP-009、ADP-010、ADP-012、ADP-014 的 Kiosk admission 与离线重放空白 | 冻结 first-start、trusted principal、time-review、eventId 单一所有权、离线队列与 ETag 轮询语义 |
| ADP-022 | ADP-004、ADP-006、ADP-010、ADP-011、ADP-014、ADP-016、ADP-017 的 Outbox/钉钉适配与 callback admission 空白 | 冻结本地 Outbox schema/state machine、至少一次投递、最小披露卡片、显式 Mock、callback fail-closed 与 producer admission；不授权真实钉钉集成 |
| ADP-023 | ADP-022 第 8 节的通用 128 code-point identifier 上限 | Card/Intent 业务 identifier 与现有 V2 canonical 160 上限一致；首版 providerRef 使用 ASCII safe allowlist，未来扩展不得改写 migration v4 |

原冻结 Pack 保留为完整历史基线，不通过无痕编辑覆盖原决定。实现者 `MUST` 从本索引进入架构文档，不能只读取原 Pack 后忽略 superseding 决策。

## 3. 当前生效架构摘要

```text
模块化单体
SQLite 规范化事实源
Application Commands + UnitOfWork
局部追加生产事件，不采用完整 Event Sourcing
scheduleRevision / runRevision / projectionRevision 三作用域
V1/V2 双投影和受控兼容写入
schedule_items + schedule_item_tasks 保留历史组合场次
requests_v2 作为 canonical schedulable work identity
Request / Schedule / Production Run 生命周期分离
V1 strict-write + legacy-read 双 profile 契约
Kiosk first-start 原子建 run，event/review receipt 同事务且 eventId 单一归属
可信 principal + capability 授权，客户端 actor/role 不构成权威
版本化 event-time review 与不可变离线命令重放
Transactional Outbox，锁外发送外部通知
VCP / Kiosk / DingTalk / Agent 全部通过适配器边界
Agent Proposal 不得直接成为正式排期
Expand → Shadow → Switch → Contract 迁移
```

## 4. 实施入口

任何工作包开始前，实施者必须获得一个有界上下文包：

```text
当前 WO 的目标与非目标
本索引
与该 WO 直接相关的 ADP 条款
实现风格指南
允许修改的文件范围
验收测试与停止条件
```

不得把全部架构材料当作模糊背景后自由发挥，也不得只摘取工作包而忽略本索引中的强制不变量。

## 5. 变更规则

本基线再次发生架构变化时，必须新增后续编号 ADP，并更新本索引的替代关系。不得直接改写既有 ADP 的决定内容来隐藏历史。
