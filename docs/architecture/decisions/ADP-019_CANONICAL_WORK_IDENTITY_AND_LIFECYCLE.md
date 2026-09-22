# ADP-019：Canonical Work Identity, Lifecycle Separation, and Lossless V1 Normalization

- 状态：`ACCEPTED_AND_FROZEN`
- 日期：2026-09-22
- 决策范围：Request/Task 身份、V1 字段落点、附件归属、Schedule/Run 生命周期和迁移默认值
- 细化/替代：原设计中的模糊 Request/Task 边界、混合 `lockStatus` 生命周期和裸 Schedule Item revision

## 1. 背景

Current V1 的 `task` 同时承载需求、可排工作项、展示状态、附件和部分 Brief。原 V2.1 表清单提出 `requests_v2`，而 `schedule_item_tasks` 又引用 `task_id`，却没有定义两者是否为同一个实体。

同时，原计划把 `draft/confirmed/completed/cancelled` 混在 `lockStatus` 中，与 `production_run` 的 `completed/cancelled` 重叠。如果现场完成改变 Schedule Item 状态，就会重新耦合 `runRevision` 与 `scheduleRevision`。

V1 还包含产品目录、自由文本交付、可选字段 presence、历史视频字段、未受管资产和场次文本。如果这些字段继续从旧 Snapshot 读取，V2 会形成第二事实源；如果丢弃，则无法无损生成 V1 兼容投影。

## 2. Canonical Work Identity

### 2.1 决定

V2.1 的 canonical schedulable work item 是 `requests_v2`。

```text
V1 task.id == requests_v2.id == schedule_item_tasks.task_id
```

规则：

- V1 `task` 是 V1 兼容投影名称，不是第二个事实实体；
- `requests_v2` 同时保存需求事实和 V2.1 最小可排工作项身份；
- 一条 V2.1 request 对应一个 schedulable work item；
- 不新增只有 ID 和 request FK 的空壳 `tasks_v2` 表；
- `schedule_item_tasks.task_id` 数据库外键指向 `requests_v2(id)`；
- API 可以继续使用 `taskId` 兼容现有语言，但文档必须说明它是 work-item/request ID；
- 迁移保留原 V1 task ID，不生成替代 ID；
- 未来如需“一条 request 拆成多个独立可排任务”，必须新增 superseding ADP。

### 2.2 Schedule Item 与 Production Run

- `schedule_items` 是资源和时间占用块；
- `schedule_item_tasks` 关联一个或多个 work item；
- `production_runs` 是一次实际执行尝试；
- Request、Schedule Item 和 Production Run 是三个不同实体；
- 一个 work item 可以因返拍或重做拥有多个 run，但 V2.1 不从历史状态伪造 run。

## 3. V1 全字段规范化落点

### 3.1 顶层与产品目录

新增 `product_catalog_entries`，至少保存：

```text
id
sku
name
display_order
source
imported_at
```

要求：

- 允许重复元组；
- 保留原数组顺序；
- 保留未被 request 引用的产品；
- V1 `products` 只能从该表按 `display_order` 投影，不能从 requests `DISTINCT` 重建。

### 3.2 requests_v2

`requests_v2` 必须能规范化保存以下 V1 字段和 presence：

```text
id
source_ordinal
sku
name
client
legacy_deliver_text
kind
legacy_v1_status
v1_status_mode
request_lifecycle
lifecycle_provenance
source
business_created_at
business_updated_at
imported_at
v1_assets_present
v1_request_present
production_type
shooting_subtype
deliverable_count
aspect_ratio
duration_seconds
audio_requirement
requested_by
desired_date
note
source_operation_id
core_brief_summary
brief_url
hero_asset_id
sample_status
sample_shelf_id
lighting_preset
reflectivity
priority
```

规范：

- V1 可选字段缺失与字段存在但空值/空数组必须可区分；
- `legacy_deliver_text` 原样保留，不能通过 NLP 猜测结构化 deliverables；
- V1 已发布的 `durationSeconds/audioRequirement` 和全部 subtype 必须可保留；
- 缺失业务时间保持 `NULL`；`imported_at` 只表示技术导入时间；
- 历史 `coreBriefSummary/priority/sampleStatus` 未知时保持 `NULL + legacy provenance`；
- 不伪造 `p1`、`unavailable` 或钉钉 URL；
- `lightingPreset/reflectivity` 可以使用正式 `unknown` 枚举；
- `briefUrl/heroAssetId/sampleShelfId` 缺失保持 `NULL`；
- 新 V2 提交可以使用比历史迁移更严格的 required profile。

### 3.3 schedule_items

Schedule Item 的事实字段至少包括：

```text
id
source_ordinal
resource_id
resource_resolution_status
resource_mapping_version
legacy_place_text
planned_start
planned_end
buffer_after_minutes
buffer_source
schedule_status
schedule_status_provenance
lock_status
note
source
source_ref
business_created_at
business_updated_at
imported_at
```

约束：

- Schedule Item 不保存裸 `revision`；
- `resource_id` 对新 V2 正式排期必填；
- migrated 记录允许 `resource_id = NULL`，但必须是 `resource_resolution_status = unresolved`；
- `legacy_place_text` 始终原样保留；
- unresolved 时间块只读，不得执行、确认编辑或进入 Agent 排程；
- Switch 前，切点之后仍有效的 migrated 时间块必须全部 resolved；
- V1 session 有明确排期证据，因此迁移为 `schedule_status = confirmed`、provenance 为 `legacy_snapshot`；
- 历史 Buffer 未知时 `buffer_after_minutes = NULL`、`buffer_source = legacy_unknown`；
- 历史 Lock 未知时 `lock_status = NULL`；
- `session.updatedAt` 只进入 `business_updated_at`，不得填充 `business_created_at`；
- `imported_at` 不得冒充历史业务时间。

## 4. 附件事实与兼容资产

### 4.1 受管 uploads

现有 `uploads` 继续是本地受管文件及摘要的事实源：

- `claimed_task_id` 在语义上引用 canonical work item，即 `requests_v2.id`；
- 增加 nullable `claimed_order` 以保存 V1 asset 顺序；
- 一个 upload 最多归属一个 work item；
- `hero_asset_id` 只能引用同一 work item 已认领且 `kind = image` 的受管 upload；
- 迁移不得移动、复制、重命名或重新认领文件；
- upload 与 V1 asset metadata/owner 任一不一致都失败关闭，不能自动修正。

### 4.2 metadata-only legacy assets

V1 imported/workbench task 可能包含没有对应 `uploads` 行的 asset metadata。为避免丢失，新增 `legacy_asset_entries`，至少保存：

```text
id
request_id
display_order
name
content_type
kind
size
sha256
source
imported_at
```

规则：

- 仅在 V1 asset ID 没有任何 upload 行时创建 metadata-only entry；
- 若 upload 行存在但 owner、metadata、hash 或文件不一致，必须停止，不能降级成 legacy asset；
- 受管 upload ID 与 legacy asset ID 不得冲突；
- legacy asset 不声称存在可下载文件，不能作为 `hero_asset_id`；
- V1 `assets[]` 投影按 managed `claimed_order` 与 legacy `display_order` 合并恢复原顺序；
- metadata-only 资产不进入孤立上传清理。

## 5. 三套生命周期分离

### 5.1 Request lifecycle

```text
open ───────► fulfilled
  └────────► cancelled
```

| V1 status | request lifecycle | 必须保留 | 禁止推导 |
|---|---|---|---|
| 缺失 | `NULL` | `v1_status_mode = legacy_omitted` | 默认 pending |
| `pending` | `open` | 原值和 legacy provenance | run/event |
| `scheduled` | `open` | 原值；session 单独核验 | scheduled run/start event |
| `completed` | `fulfilled` | 历史业务断言 | 完成事件、时间和训练样本 |
| `cancelled` | `cancelled` | 历史业务断言 | run cancellation event |

建议字段：

```text
legacy_v1_status
v1_status_mode: legacy_exact | legacy_omitted | canonical
request_lifecycle
lifecycle_provenance: legacy_snapshot | domain_command
```

只有明确领域命令可以把 `v1_status_mode` 转为 `canonical`。

### 5.2 Schedule lifecycle

排期状态与锁状态分开：

```text
schedule_status: draft | confirmed | cancelled
lock_status: unlocked | locked | NULL
```

```text
draft ─────► confirmed
  └───────► cancelled
confirmed ─► cancelled
```

- Schedule Item 没有 `completed` 状态；
- run 完成不修改 `schedule_status`；
- `lock_status` 不表达生命周期；
- schedule cancel 不伪造 run cancellation；
- 如果一个用户动作需要同时取消 schedule 和 run，必须是显式跨域命令，同时检查 `expectedScheduleRevision` 和 `expectedRunRevision`。

### 5.3 Production Run lifecycle

Production Run 继续遵守 ADP-007：

```text
scheduled → shooting
shooting  → blocked
blocked   → shooting
shooting  → completed
scheduled → cancelled
blocked   → cancelled
```

- V1 migration 不创建 run 或 event；
- single run 的 complete 命令可以显式同时将 request 置为 fulfilled；
- grouped block complete 只证明组合场次完成，不能自动 fulfill 每个 request；
- block-level 工时不得分摊到单任务，也不得进入 task-level 训练样本。

## 6. V1 投影

### 6.1 Task projection

- 全部字段和 optional presence 从规范化记录恢复；
- assets 按统一 order 从受管 uploads 和 legacy assets 恢复；
- `legacy_exact` 输出原 `legacy_v1_status`；
- `legacy_omitted` 不输出 status；
- `canonical` 时：cancelled → `cancelled`，fulfilled → `completed`，open 且有非取消 schedule → `scheduled`，否则 `pending`；
- `shooting/blocked` 在 V1 中仍投影为 `scheduled`；
- grouped block complete 不自动改变其中每个 task 的 V1 status。

### 6.2 Session projection

- 一个非取消 Schedule Item 投影为一个 session；
- `ids` 按 binding `display_order`；
- migrated item 的 place 始终使用 `legacy_place_text`；
- new item 使用 resource 的稳定 V1 display label；
- note 原样；
- UTC 按冻结 business timezone 转回 V1 date/start/end；
- cancelled canonical item 不再出现在 sessions；
- legacy round-trip 模式在领域命令接管前保持源数组存在性和顺序。

### 6.3 Top-level projection

- products 从 `product_catalog_entries` 按 display order 输出；
- V1 `revision = projectionRevision`；
- 初始 Shadow round-trip 保留源 `updatedAt`；
- 后续领域事务使用投影提交时间；
- 不向 V1 偷塞 V2 字段。

## 7. Revision bootstrap

首次 Shadow/isolated migration 固定为：

```text
projectionRevision = source V1 revision
scheduleRevision = 0
production_runs = 0
runRevision rows = 0
```

迁移本身不消耗 revision。第一次正式排期变化令 `scheduleRevision 0 → 1`，同时令 `projectionRevision n → n+1`。

## 8. 迁移和 Switch 边界

- 未映射 place 可在 Shadow 中作为 unresolved 保存，但阻断可执行 Switch；
- 已结束的历史 unresolved block 可以继续只读保存，但不参与资源冲突和训练；
- V1 status 与 session 不一致时保留两者并报告，不自动修正；
- 历史重叠排期原样保留并诊断，不静默移动；
- 缺失业务时间保持 NULL；
- legacy buffer/lock 不填 0/unlocked；
- V1 Snapshot 不再作为 V2 激活后的事实源；
- 所有 V1 兼容字段必须从规范化表和兼容 fragment 重建。

## 9. 验收门

至少覆盖：

1. V1 task ID 等于 canonical request/work-item ID；
2. `schedule_item_tasks.task_id` 只能引用 `requests_v2.id`；
3. 不存在第二个可漂移的 schedulable task 表；
4. 产品重复项、孤立项和顺序 round-trip；
5. optional 字段缺失、空数组和空字符串精确保留；
6. 历史 completed/cancelled 不生成 run/event/time/training sample；
7. 缺失时间保持 NULL，`imported_at` 不冒充业务时间；
8. Buffer/Lock 历史未知保持 NULL；
9. session updatedAt 不填 createdAt；
10. unresolved place 在 Shadow 保留、在可执行 Switch 前阻断；
11. managed upload owner/metadata/hash 不一致失败关闭；
12. metadata-only legacy asset 可 round-trip 但不可下载/作 hero；
13. run complete 不修改 schedule status；
14. schedule cancel 不伪造 run event；
15. grouped block complete 不自动 fulfill 每个 request；
16. V2 Schema/API 不存在裸 `revision/expectedRevision`；
17. migration bootstrap 使用 source projection revision 和 schedule revision 0；
18. V1 task/session/products 可语义无损 round-trip。

## 10. 结论

V2.1 采用一个 canonical work identity，不制造 Request/Task 镜像表；排期块、现场运行和需求结果拥有独立生命周期；全部 V1 契约事实都有规范化落点；未知历史保持 NULL 或显式 legacy provenance，不通过默认值伪造精确事实。
