# WO-00：基线冻结与迁移设计

- 状态：`PASS`
- 执行分支：`codex/v2-1-architecture-freeze`
- 架构基线：`JSO-ARCH-V2.1-R3`
- 范围：只读校准、映射文档、候选 Fixture、dry-run 规范和 VCP Adapter 存在性检查
- 明确不包含：V2 Schema、迁移器实现、数据库写入、生产行为变化、外部真实调用、部署

## 1. 有效上下文

- [Architecture Baseline Index V2.1](../architecture/ARCHITECTURE_BASELINE_INDEX_V2.1.md)
- [ADP-017：Revision Domains](../architecture/decisions/ADP-017_REVISION_DOMAINS_AND_PROJECTION_VERSIONING.md)
- [ADP-018：Legacy Grouped Session Binding](../architecture/decisions/ADP-018_LEGACY_GROUPED_SESSION_BINDING.md)
- [ADP-019：Canonical Work Identity and Lifecycle](../architecture/decisions/ADP-019_CANONICAL_WORK_IDENTITY_AND_LIFECYCLE.md)
- [ADP-020：V1 Contract Authority and Compatibility](../architecture/decisions/ADP-020_V1_CONTRACT_AUTHORITY_AND_COMPATIBILITY.md)
- [Implementation Style Guardrails](../architecture/IMPLEMENTATION_STYLE_GUARDRAILS_V2.1.md)
- [实施计划书 V2.1](../VCP_SHOOTING_OPERATIONS_EVOLUTION_PLAN_V2.1.md)

## 2. 当前事实

- V1 Snapshot 使用 `products / tasks / sessions / revision / updatedAt`；
- V1 `session.ids[]` 允许一个时间块绑定多个任务；
- 当前 SQLite 事实仍是 `schedule_state.snapshot_json`；
- 当前 API 使用 `/api/v1`，排期写入依赖全局 `revision + If-Match`；
- 当前已有幂等、审计、附件认领、上传清理互斥和崩溃恢复；
- 当前 VCP 集成测试在外部 Adapter 不存在时明确跳过；
- 当前工作包不得改变以上运行行为。

## 3. 指挥拆分

| 轨道 | 范围 | 输出 |
|---|---|---|
| A：字段与迁移映射 | Current → V2 字段、revision、附件、回滚和停止条件 | 映射矩阵、dry-run 规范 |
| B：候选迁移 Fixture | single/grouped、有效/无效、revision 域 | `fixtures/migration-v2/` |
| C：独立审查 | 架构一致性、VCP 状态、风险与缺口 | 审查结论 |
| Commander | 交叉复核、验证、范围控制、提交 | 本执行记录与最终证据 |

## 4. 必须交付

- [x] Current → V2 字段映射矩阵；
- [x] 无损、有损、待人工确认分类；
- [x] `grouped_unallocated` 无损迁移规则；
- [x] 三 revision 映射；
- [x] 附件引用与上传清理安全保持规则；
- [x] migration dry-run 命令和报告规范；
- [x] V1 single/grouped/full-compatibility Fixture；
- [x] 候选 V2 records/projection Fixture；
- [x] expected-invalid 与 L0–L3 compatibility Fixture；
- [x] VCP Adapter 存在性与可验证状态；
- [x] 所有 JSON 可解析；
- [x] 当前 `npm run check` 通过；
- [x] 无生产代码、数据库和外部系统写入。

## 5. 硬停止条件

- 需要猜测或平均拆分历史多任务工时；
- 需要伪造历史现场事件、钉钉链接、货架位或任务时间；
- 迁移设计会覆盖 V2-only 状态或破坏 V1 round-trip；
- 新模型削弱 operation/event 幂等、revision、审计或附件安全；
- 需要读取秘密、活动生产配置或真实 provider 响应；
- 需要连接或写入生产数据库；
- 需要真实外部调用、部署、切流或不可逆操作。

## 6. 验证证据

完成后填写：

```text
JSON parse: PASS — 13/13 JSON fixtures parse
V1 contract fixture readiness: PASS — 3 valid V1 baselines + 24-case Snapshot/Submission parity matrix；当前 runtime 观测吻合冻结预期，真正 Draft 2020-12 strict/legacy validator 归 WO-01
Fixture invariant validation: PASS — exact V1→candidate V2→V1 round-trip、canonical identity、grouped order、revision bootstrap、NULL/provenance、negative-path detection、L1/L2/L3 evidence 与 9 个附件 manifest cases 通过
npm run check: PASS — 24 tests, 23 passed, 1 skipped
VCP Adapter: NOT PRESENT — runtime/VCPChat/modules/services/shootingPlannerSyncService.js 不存在；现有集成测试按设计 SKIP，Switch gate 保持关闭
Independent review: PASS — final review found no remaining blocking or major issue; WO-00 may enter WO-01
Git scope: PASS — 仅 V2.1 架构/迁移文档、Fixture 与 WO-00 fixture validator；未触碰运行时业务代码、数据库或外部系统
```

## 7. WO-00 退出结论

`PASS`。WO-00 已通过并允许进入 WO-01；VCP Adapter 仍为 `NOT PRESENT`，继续阻断真实集成验证与 Switch，但不阻断本地契约实现。WO-00 通过不构成数据库迁移、生产部署或真实外部集成授权。
