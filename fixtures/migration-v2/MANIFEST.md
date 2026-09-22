# WO-00 Migration V2 Fixture Manifest

本目录是 V2.1 迁移设计的基线 Fixture 集，不是已冻结的 V2 JSON Schema，也不授权真实数据迁移。字段语义受 ADP-017 至 ADP-020 约束；WO-01 将把候选记录转成正式契约测试。

## 分类

| 文件 | 分类 | 目的 |
|---|---|---|
| `v1-single-session.json` | valid V1 source | 一个 V1 session 绑定一个已知任务 |
| `v1-grouped-session.json` | valid V1 source | 一个 V1 session 按既有顺序绑定两个任务 |
| `v1-full-compatibility.json` | valid V1 source | 覆盖未引用/重复产品、完整 request、metadata-only imported asset 与 completed legacy status |
| `candidate-v2-single-normalized.json` | candidate | 展示单任务 session 的候选规范化记录与 V2 投影 |
| `candidate-v2-grouped-normalized.json` | candidate | 展示多任务 session 保留为 `grouped_unallocated` 的候选记录与投影 |
| `expected-invalid-dangling-task-binding.json` | expected-invalid | 绑定引用未知任务时必须拒绝且不写入 |
| `expected-invalid-fabricated-group-split.json` | expected-invalid | 迁移器伪造单任务时间边界时必须拒绝且不写入 |
| `revision-domain-examples.json` | candidate scenario matrix | 展示 `scheduleRevision`、`runRevision`、`projectionRevision` 的独立变化 |
| `legacy-runtime-only-extra-property.json` | compatibility L1 | runtime 曾接受、strict Schema 拒绝的未知字段必须进入 opaque legacy fragment |
| `legacy-repair-required-invalid-time.json` | compatibility L2 | `29:00` 不是可物化的民用时间，必须先修复 |
| `legacy-source-corrupt-unknown-task.json` | compatibility L3 | session 引用未知 task 时必须失败关闭 |
| `v1-contract-parity-matrix.json` | contract parity matrix | 冻结 Snapshot root/task/session/request/asset 与 Submission 的 strict/legacy/current-runtime 预期 |
| `attachment-manifest-cases.json` | attachment case matrix | 覆盖 managed upload 双向引用、owner/metadata、混排顺序、tombstone 与文件缺失 |

`valid V1 source` 文件应通过当前 `contracts/schedule-snapshot.schema.json`。候选和负例没有声称通过尚未建立的 V2 Schema；后续 WO-01 应将其转换成正式契约测试，而不是把这些候选字段原样视为冻结 API。

## 固定断言

- V1 `ids.length === 1` 迁移为一个 `single` 时间块和一个任务绑定。
- V1 `ids.length > 1` 迁移为一个 `grouped_unallocated` 时间块，绑定顺序与原 `ids` 一致。
- 多任务场次不得平均分时、猜测切换点或只保留第一个任务。
- 缺失现场事件时不得从 V1 `status` 反推 `production_run`、开始时间、结束时间或净工时。
- 所有墙钟时间按 Fixture 显式给出的 `Asia/Shanghai` 转换为 UTC；真实迁移仍必须显式传入 `businessTimeZone`。
- Fixture 未提供权威 place→resource map，因此候选记录保留 `legacy_place_text`，将 `resource_id` 留空并标记 `unresolved`；这可用于 Shadow，但阻断可执行 Switch。
- 首次迁移复制 V1 `revision` 到 `projectionRevision`，并令新的 V2 `scheduleRevision = 0`；没有 `production_run` 时不存在可伪造的 `runRevision`。
- V1 `task.id`、`requests_v2.id` 与 binding `task_id` 必须相同。
- 历史缺失的 buffer、lock、resource 和业务创建时间保持 `null + provenance`；独立 `imported_at` 只表示技术接收时间。
- single/grouped candidates 必须精确 V1 → candidate V2 → V1 round-trip，包括顶层和 session `updatedAt`。
- parity matrix 的 `strictWrite/legacyRead` 是 WO-01 正式 validator 的冻结验收预期；WO-00 只执行并记录现有 runtime 行为，不能伪称已执行尚不存在的统一 validator。
- 每个 revision 场景均从其文件的 `initialState` 独立开始，不按数组顺序累计。

## 已知实现边界

1. V2 正式 JSON Schema、DDL、约束名和 API casing 由 WO-01/WO-02 实现；候选文件使用数据库 snake_case 与投影 camelCase 区分边界。
2. 实际 `businessTimeZone`、resource map、附件 manifest 与源数据 L0–L3 分类是运行准入输入，不由 Fixture 代替。
3. `v1-full-compatibility.json` 的 asset 是 metadata-only imported asset，只能进入 `legacy_asset_entries`，不能制造 upload row 或文件。
4. ADP-020 的统一 validator 尚待 WO-01 实现；当前 runtime validator 只用于记录历史行为，不能继续充当唯一契约。

## 建议验证

```text
node scripts/validate-wo00-fixtures.mjs
```

该脚本解析全部 JSON，记录三个 V1 baseline 和 24 个 parity case 的当前 runtime 行为，并验证精确 round-trip、canonical identity、grouped binding 顺序、revision bootstrap、NULL/provenance、负例实际检测、L1–L3 差异证据与 9 个附件 manifest case。WO-01 还必须用真实 Draft 2020-12 validator 覆盖正式 strict/legacy profiles 和零写入拒绝路径。
