# Jenn Shooting Operations Current → V2 Mapping V2.1

- 状态：`FROZEN_FOR_WO_01_02`
- 基线：`JSO-ARCH-V2.1-R3`
- 日期：2026-09-22
- 范围：V1 Snapshot、请求提交记录、SQLite 辅助表与附件引用到 V2 规范化模型的映射设计
- 非范围：执行迁移、修改 Schema、读取生产数据、切换写路径、删除 V1 数据

## 1. 目的与约束

本文定义 Current → V2 的字段级迁移语义，并把无法由当前事实可靠推导的内容显式标记出来。它不授权实现者用“合理默认值”补造历史事实。

解释优先级遵循 [Architecture Baseline Index V2.1](../ARCHITECTURE_BASELINE_INDEX_V2.1.md)，尤其受 ADP-017 至 ADP-020 约束。本文保留了审查阶段发现的“待确认”分类作为迁移报告语义；架构处理方式以第 13 节的冻结解决表为准。

硬性原则：

1. V1 `schedule_state.snapshot_json`、`operations`、`audit_log`、`uploads` 和附件文件在首次迁移中保持不变。
2. 迁移只增加 V2 表或写入隔离目标；不得覆盖源库。
3. 不从 `task.status`、场次区间或自由文本反推不存在的现场事件。
4. 不把多任务场次平均切分，不猜测单任务起止时间。
5. 不用迁移执行时间冒充业务创建时间或更新时间。
6. 不用 `place` 文本自动制造 `resourceId`。
7. 不自动挑选附件作为 `heroAssetId`。
8. V1 `revision` 只直接映射为 `projectionRevision`，不得重新混同三个 revision 域。

## 2. 分类

| 分类 | 含义 | 迁移行为 |
|---|---|---|
| **无损** | 源值的语义和取值可以完整保留 | 可机械映射，但仍需通过格式和引用校验 |
| **有损** | V2 当前表达面不能完整保留源语义，或转换会丢失信息 | 默认禁止执行；必须增加保留面或获得明确淘汰决定 |
| **待确认** | 需要业务配置、Schema 决定或真实数据核验后才能确定 | dry-run 产生阻断项，不猜测 |

“无损”不表示输入必然合法。重复 ID、坏引用、非法时间或附件不一致仍然必须失败关闭。

## 3. 当前事实面

### 3.1 V1 Snapshot

```text
schedule_state
  revision
  updated_at
  snapshot_json
    schemaVersion
    revision
    updatedAt
    products[] = [sku, name]
    tasks[]
    sessions[]
```

V1 Snapshot 是当前共享事实；其中数组顺序可能影响待排列表和兼容客户端，因此迁移不得把数组当作无序集合。

### 3.2 辅助表

```text
operations(operation_id, kind, response_json, created_at)
audit_log(id, action, role, entity_id, revision, result, created_at)
uploads(id, operation_id, original_name, content_type, kind,
        size, sha256, stored_name, claimed_task_id, created_at)
```

`uploads` 行与上传卷中的哈希命名文件共同构成附件事实。Snapshot 内 `task.assets[]` 是已认领附件的兼容投影，不可单独作为文件存在性的证明。

### 3.3 发布 Schema 与运行时 validator 的分裂

Current 不能被视为只有一个验证口径。JSON Schema 与 `src/contract-validator.mjs` 至少存在以下差异：

- 手写 Snapshot validator 不拒绝 task/session 的额外字段，也不完整校验 `status/source/timestamps/assets/request`；
- 手写 Snapshot validator 校验 `end > start`，JSON Schema 只校验字符串 pattern；
- JSON Schema 的时间 pattern 可接受 `29:59`，手写 validator 的 `\d{2}:\d{2}` 甚至可先接受更大小时值，两者都不证明真实日历时间有效；
- 手写 submission validator 不统一执行 JSON Schema 的 `additionalProperties: false` 和全部长度上限；
- Snapshot Schema 接受历史视频字段和 subtype，而当前 submission validator 明确拒绝其中部分新提交字段；
- `replaceSnapshot` 通过手写 validator 后会原样保留 task/session 内部对象，因此数据库中可能存在“运行时接受、发布 Schema 拒绝”的记录。

ADP-020 已冻结替代路线：WO-01 建立一个由 JSON Schema 结构校验与有限语义不变量组成的公共入口；所有新写走 `strict-write`，历史读取走 `legacy-read`。当前手写 validator 只作为迁移期观测证据，不再拥有独立契约权威。

| Legacy class | 定义 | 迁移行为 |
|---|---|---|
| `L0_STRICT` | 新权威契约完全通过 | 正常物化 |
| `L1_GRANDFATHERED_OPAQUE` | 非领域语义的历史额外片段可精确保留 | 写 `legacy_compat_fragments`；新写不可修改 |
| `L2_REPAIR_REQUIRED` | 非法状态、时间或绑定会影响领域语义 | 阻断该实体和 Switch，等待有证据的修复 |
| `L3_SOURCE_CORRUPT` | 身份、引用或根结构不可可靠解释 | `INVALID_SOURCE`，停止 |

WO-00 Fixture 必须保留当前分裂证据；WO-01 必须移除 JS 中重复的结构枚举/长度规则，不能任选一个旧 validator 隐藏差异。

## 4. 顶层 Snapshot 映射

| Current 字段 | V2 目标 | 分类 | 映射规则与验证 |
|---|---|---|---|
| `schemaVersion = 1` | 迁移来源版本 / projection source version | 无损 | 记录为 `sourceSchemaVersion = 1`；V2 输出自身使用 `schemaVersion = 2` |
| `revision` | `projectionRevision` | 无损 | 初始值严格复制；必须与 `schedule_state.revision` 相等且为非负安全整数 |
| `revision` | `scheduleRevision` | 无损基线 | 固定从 `0` 开始，表示 V2 排期并发 epoch；不冒充历史排期变更次数 |
| `updatedAt` | V1 兼容投影 `updatedAt` | 无损 | 保留原 ISO 时间；必须与 `schedule_state.updated_at` 一致或报告差异 |
| `updatedAt` | entity business timestamps | 不映射 | 顶层时间只属于兼容投影；不能复制成每个实体的业务时间 |
| `products[]` | `product_catalog_entries` | 无损 | 保留元组值、重复项和顺序；仅从 requests 重建被禁止 |
| `tasks[]` 顺序 | V1 兼容投影顺序 | 无损 | 迁移时保存稳定 `sourceOrdinal` 或等价 provenance；不得按 ID/时间擅自重排 |
| `sessions[]` 顺序 | V1 兼容投影顺序 | 无损 | 迁移时保存稳定 `sourceOrdinal`；V2 查询可另行排序，但 V1 round-trip 必须稳定 |

### 4.1 Products 的特殊约束

ADP-019 已冻结 `product_catalog_entries` 作为产品目录事实表。它必须保留尚未被 work item 引用的条目、重复元组和原顺序；不得使用 `SELECT DISTINCT request.sku, request.name` 替代原数组。

## 5. Task / Request 字段映射

ADP-019 已冻结单一身份模型：V1 `task.id`、`requests_v2.id` 和 `schedule_item_tasks.task_id` 是同一个 canonical work-item ID。V2.1 不创建第二个可漂移的 schedulable task 表；未来拆单需求必须通过 superseding ADP。

| Current 字段 | V2 目标 | 分类 | 映射规则与验证 |
|---|---|---|---|
| `task.id` | `requests_v2.id` / task identity | 无损 | 原样保留；全局唯一；不得生成替代 ID |
| `task.sku` | `sku` | 无损 | 原样保留，继续满足长度限制 |
| `task.name` | `name` | 无损 | 原样保留，不在报告中输出内容 |
| `task.client` | `requests_v2.client` | 无损 | 原样保存；不得丢弃 |
| `task.deliver` | `requests_v2.legacy_deliver_text` | 无损 | 原文保存；不能 NLP 猜测结构化 deliverables |
| `task.kind` | `kind` | 无损 | 原枚举复制；与 `shootingSubtype` 不一致时报告，不自动改写 |
| `task.status` | `legacy_v1_status` + request lifecycle | 无损 | 按 ADP-019 保存原值和 provenance；不等同 production run 状态 |
| `task.source` | provenance source | 无损 | 保留 `workbench/submission/import`；V2 新来源不得反向改写历史值 |
| `task.createdAt` | `business_created_at` | 无损（存在时） | 合法 ISO 时间原样转换为 UTC；缺失时保持 `NULL`，不得用迁移时间填充 |
| `task.updatedAt` | `business_updated_at` | 无损（存在时） | 合法 ISO 时间原样转换为 UTC；缺失时保持 `NULL + legacy provenance` |
| `task.assets[]` | managed uploads / `legacy_asset_entries` | 无损 | 有 upload 时交叉核验；无 upload 的 imported metadata 独立保存，不制造文件 |
| `task.request.productionType` | `productionType` | 无损 | `平面/视频` 原样保留 |
| `task.request.shootingSubtype` | `shooting_subtype` | 无损 | V2 兼容 profile 覆盖全部已发布 V1 Snapshot 枚举 |
| `task.request.deliverableCount` | `deliverable_count` | 无损 | nullable 明确列保存；V2 新写可另有判别联合规则 |
| `task.request.aspectRatio` | `aspectRatio` | 无损 | 原枚举复制 |
| `task.request.durationSeconds` | `duration_seconds` | 无损 | nullable 明确列保存 |
| `task.request.audioRequirement` | `audio_requirement` | 无损 | nullable 明确列保存 |
| `task.request.requestedBy` | `requestedBy` | 无损 | 原样保留；报告不得输出个人内容 |
| `task.request.desiredDate` | `desiredDate` | 无损 | 空字符串映射为缺省/`NULL`，有效日期原样保留；不得改成当天 |
| `task.request.note` | `note` | 无损 | 原样保留于事实库，不进入低披露迁移报告 |
| 缺失 | `coreBriefSummary` | 无损缺省 | 历史为 `NULL + legacy provenance`；不从 note 生成 |
| 缺失 | `briefUrl` | 无损缺省 | 为空；不得伪造钉钉 URL |
| 缺失 | `heroAssetId` | 无损缺省 | 为空；不得自动挑第一张图 |
| 缺失 | `sampleStatus` | 无损缺省 | 历史为 `NULL + legacy provenance`；新写使用严格枚举 |
| 缺失 | `sampleShelfId` | 无损缺省 | 为空；不得从 note 提取 |
| 缺失 | `lightingPreset` | 无损缺省 | 写正式 `unknown + legacy provenance`；不得从图片、kind 或 note 推断 |
| 缺失 | `reflectivity` | 无损缺省 | 写正式 `unknown + legacy provenance`；不得从商品名或图片推断 |
| 缺失 | `priority` | 无损缺省 | 历史为 `NULL + legacy provenance`；不得默认 p1 |

### 5.1 operationId 的恢复

请求成功响应只在 `operations.response_json` 中保存 `taskId`，Snapshot task 本身不保存 `operationId`。迁移器可以对 `operations.kind = 'request.submit'` 做受控关联：

```text
parse response_json
→ response.taskId == task.id
→ recover operations.operation_id as request provenance
```

分类：

- 恰好一个匹配：**无损**；
- 零个匹配：**允许 legacy 来源**，`source_operation_id = NULL` 并记录 provenance；不得生成 operationId；
- 多个不同 operationId 指向同一 task：**源完整性错误，停止**；
- response JSON 无法解析或 kind/结构不符：**源完整性错误，停止**。

`operations.response_json` 不是重新创建业务输入的来源；只允许读取已定义的 ID、revision 和时间摘要。

### 5.2 V1 status 与生产运行状态

V1 task status 是展示/排期生命周期，不是由现场事件证明的 production run 状态：

| V1 status | 可保留事实 | 禁止推导 |
|---|---|---|
| `pending` | V1 兼容状态 pending | 不创建 run/event |
| `scheduled` | V1 兼容状态 scheduled；是否存在 session 单独校验 | 不创建 start 事件 |
| `completed` | V1 兼容历史完成标记 | 不创建 start/complete 时间，不产生训练样本 |
| `cancelled` | V1 兼容历史取消标记 | 不创建 production cancellation event |

ADP-019 已冻结 `legacy_v1_status/v1_status_mode/request_lifecycle/lifecycle_provenance`。不得用空事件流物化出虚假的 `production_runs`；历史 `completed` 数据没有闭合事件，明确排除在净工时和 Agent 单任务训练样本之外。

## 6. Session → Schedule Item 映射

| Current 字段 | V2 目标 | 分类 | 映射规则与验证 |
|---|---|---|---|
| `session.id` | `schedule_items.id` | 无损 | 原样保留；重复 ID 停止 |
| `session.ids[]` | `schedule_item_tasks` | 无损 | 每个 ID 建一个 binding，按数组顺序写 `display_order`；未知 task 停止 |
| `session.ids.length === 1` | `allocation_mode = single` | 无损 | 必须且只能创建一个 binding |
| `session.ids.length > 1` | `allocation_mode = grouped_unallocated` | 无损 | 保留组合块；不拆分，不平均时长，不生成单任务分钟数 |
| `session.date + start` | `planned_start` | 无损（需配置） | CLI 必须显式提供 `businessTimeZone`；按该 IANA 时区解释后转 UTC |
| `session.date + end` | `planned_end` | 无损（需配置） | 同上；V1 校验要求同日且 end > start，不推断跨日 |
| `session.place` | `resource_id` | 无损（需配置） | 只通过显式、版本化 place→resource 映射转换；未映射可保留 Shadow，但阻断可执行 Switch |
| `session.place` | `legacy_place_text` | 无损 | 原文保存；不能因生成 resourceId 而丢失 |
| `session.note` | `schedule_items.note` | 无损 | 原文保存，不进入低披露报告 |
| `session.updatedAt` | `business_updated_at` | 无损（存在时） | 合法 ISO 时间复制；缺失不得用 Snapshot 时间或迁移时间伪造 |
| 缺失 | `buffer_after_minutes` | 无损缺省 | 历史写 `NULL` 并记录 `buffer_source = legacy_unknown`，不得套用当前默认值 |
| 缺失 | `lock_status` | 无损缺省 | 历史写 `NULL` 并记录 legacy provenance；不能由 V1 status 推断 |
| 固定迁移来源 | `source = migration` | 无损 | 同时保存 `source_ref = session.id` 和 migration batch/version |
| Snapshot 数组位置 | schedule item source ordinal | 无损 | 保存以维持 V1 round-trip 顺序 |

### 6.1 Multi-task session 强制规则

对 `session.ids = [t1, t2, ...]`：

```text
schedule_items
  id = session.id
  allocation_mode = grouped_unallocated

schedule_item_tasks
  (session.id, t1, display_order = 0)
  (session.id, t2, display_order = 1)
  ...
```

强制不变量：

- 不创建 `task_id` 单列来替代关联表；
- 不为每个任务复制相同的完整场次时长；
- 不按数组顺序猜测串行时间片；
- 未拆分时仅允许 block-scope run，且本次历史迁移默认不创建 run；
- 组合块不进入 task-level 工时训练集；
- V1 投影必须恢复相同 ID 数组、顺序、日期和时间；
- 后续人工拆分保留原组合块 provenance 和已有 block-level 事件。

## 7. Revision 映射

### 7.1 初始值

| Revision 域 | 迁移规则 | 状态 |
|---|---|---|
| `projectionRevision` | 复制当前 V1 `snapshot.revision` | 已冻结 |
| `scheduleRevision` | 固定为 `0`，表示 V2 正式排期命令的新并发 epoch，不虚构历史排期变更次数 | 已冻结（ADP-019/020） |
| `runRevision` | 不创建历史 run，因此无初始 runRevision；未来新 run 从 `0` 开始 | 已冻结方向 |
| V1 projection `revision` | 始终映射当前 `projectionRevision` | 已冻结 |

初次 V2 投影的 payload 与这些 counter 必须在同一目标事务提交。dry-run 必须显示三个域的“source / proposed / reason”，但不得修改源 revision。

### 7.2 迁移后的变化

```text
新待排请求              → projectionRevision
正式排期变化            → scheduleRevision + projectionRevision
单个现场 run 变化        → runRevision + projectionRevision
Outbox / audit 状态变化  → 不增加上述业务 revision
```

内容等价的投影重建不增加 revision。重复迁移命中相同 batch/source digest 时不创建记录，也不消耗 revision。

## 8. 附件与上传安全映射

### 8.1 权威关系

受管附件继续使用当前 `uploads` 表和上传卷，不在 V2 请求表复制另一套文件事实。通过旧 `PUT /api/v1/snapshot` 进入的 `workbench/import` asset 可能只有 Snapshot metadata、没有 `uploads` 行；它进入 ADP-019 冻结的 `legacy_asset_entries`，不能伪装成受管上传。

对每个 `task.assets[]` 项先分类：

- 找到 `uploads.id = asset.id`：按受管附件验证；
- 未找到，且 task source 为 `workbench/import`：写入 `legacy_asset_entries` 并报告信息项 `UNMANAGED_LEGACY_ASSET_PRESERVED`；不得制造 upload 行或文件；
- 未找到，且 task source 为 `submission`：`UPLOAD_REFERENCE_MISSING`，源完整性失败；
- source 缺失或无法分类：阻断并要求人工确认。

对每个受管 asset 必须验证：

1. 已存在 `uploads.id = asset.id`；
2. `uploads.claimed_task_id = task.id`；
3. `content_type/kind/size/sha256` 与 asset 投影一致；
4. `stored_name` 为 `NULL` 时只能出现在明确无文件卷的测试模型；
5. 有文件卷时，对应文件必须存在于受控 upload root；
6. 文件大小必须匹配；完整 SHA-256 校验作为 apply/Switch 前硬门禁；
7. 任何路径必须由受控 root 与 `stored_name` 组合，不信任原始文件名；
8. 不跟随逃逸 upload root 的符号链接。

反向也要核对：每个 `uploads.claimed_task_id` 必须指向已知 task，并在该 task 的 asset 投影中恰好出现一次。以下情况全部停止：

- dangling `claimed_task_id`；
- submission asset 对应 upload 行缺失；
- 同一 upload 被多个 task 投影引用；
- metadata 或 hash 不一致；
- 已认领行仍被误判为 orphan；
- 引用文件缺失且 `.cleanup` tombstone 无法安全恢复。

### 8.2 不允许的迁移动作

- 不移动、重命名、重新哈希或复制附件文件；
- 不修改 `claimed_task_id`；
- 不调用 orphan cleanup；
- 不扫描或输出附件正文；
- 不在报告中输出 `original_name`、完整路径或 Brief；
- 不自动选择第一张 image 作为 `heroAssetId`。

`legacy_asset_entries` 是兼容事实，不是可下载的受管附件。V1 round-trip 必须恢复其 metadata；任何下载、预览或清理逻辑都不得把它当成上传卷文件。

迁移与现有上传清理必须使用同一数据库/文件锁安全模型；任何未来 apply 在服务仍接受上传时执行，必须先证明不会与 `saveUpload` 或清理流程形成竞态。否则 apply 只允许离线窗口。

## 9. operations 与 audit 的处理

| Current | V2 处理 | 分类 |
|---|---|---|
| `operations` | 原表保留；可恢复 request operationId 和历史幂等响应 | 无损 |
| `audit_log` | 原表保留，不改写历史 revision 语义 | 无损 |
| 历史 `audit_log.revision` | 标记为 legacy V1 projection revision | 已冻结 |
| 迁移自身幂等键 | 使用 source DB identity + source revision + mapping config digest + migration version | 无损设计 |
| 迁移审计 | 只在未来 apply 的目标事务写低披露摘要 | 无损设计 |

不得将历史 audit revision 批量重写成 `scheduleRevision`。

## 10. V1 Round-trip 等价定义

Shadow 验证必须从 V2 隔离模型生成 V1 Snapshot，并与源 Snapshot 比较。

必须完全相等：

- `products` 元组、重复性和顺序；
- task ID、字段、嵌套 request、asset metadata 和数组顺序；
- session ID、task ID 集合及顺序、date/start/end/place/note；
- session `updatedAt` 的 presence 与原值；
- task/session 数量和引用关系。

迁移基线的 `updatedAt` 必须保持源值。正式领域写入后的兼容投影才允许由服务端推进 `updatedAt`；这不属于 migration baseline round-trip 的允许差异。

允许不同：

- `revision` 的承载位置，但返回 V1 时数值必须等于 `projectionRevision`；
- JSON 对象键顺序和无意义空白。

比较采用 canonical JSON；不得通过删除未知字段让比较“通过”。差异报告只输出 JSON Pointer、差异类型和值摘要哈希，不输出业务文本。

## 11. V1 PUT 差异矩阵

规范化事实源激活后，`PUT /api/v1/snapshot` 不能再做全量 JSON 覆盖。ADP-020 已冻结为受控排期兼容入口：Adapter 必须在同一事务计算差异，只允许 V1 能无歧义表达的 session 排期变更；产品、任务、附件、生命周期与 provenance 变更全部拒绝并引导专用命令。

| V1 diff | 目标动作 | 默认结果 | Revision |
|---|---|---|---|
| body `revision` 与 `If-Match` 不同 | 一致性检查 | 拒绝；两者必须相等 | 无 |
| `If-Match != projectionRevision` | 无 | `409 REVISION_CONFLICT` | 无 |
| products 新增/改名/删除/重排 | 产品目录专用命令 | V1 PUT 拒绝 | 无 |
| task 新增 | create request command | V1 PUT 拒绝 | 无 |
| task 删除 | cancel request command | V1 PUT 拒绝 | 无 |
| task `sku/name/client/deliver/kind/request.*` 修改 | update request command | V1 PUT 拒绝 | 无 |
| task `source/id/createdAt` 修改 | 不可变 provenance | 拒绝 | 无 |
| task `updatedAt` 由客户端修改 | 服务端时间/provenance | 拒绝 | 无 |
| task `status` 直接变化 | request/schedule/run 专用命令 | 拒绝；`pending↔scheduled` 仅可作为已接受 session diff 的精确派生结果，不得独立驱动命令 | 随 schedule + projection；否则无 |
| task assets metadata/数组修改 | upload/asset 专用命令 | V1 PUT 不得创建、认领、删除或改写受管附件；差异默认拒绝 | 无 |
| session 新增 | create schedule item + bindings | resource/timezone/绑定校验通过后允许 | schedule + projection |
| session time/place 修改 | reschedule/reassign command | place 必须映射 resource；保留 V1 place/note | schedule + projection |
| session ids 增删/重排 | binding command | ADP-018 校验；不得自动拆 grouped block | schedule + projection |
| session 删除 | cancel/remove schedule command | 已有 run/event 时不得破坏历史；默认失败关闭 | schedule + projection（若允许） |
| session note-only 修改 | schedule metadata command | 允许，属于排期事实变更 | schedule + projection |
| V1 未携带的 V2-only 字段 | merge preserve | 必须原样保留，不得清空 | 由真实 diff 决定 |
| 内容完全等价的 PUT | 幂等/no-op | 成功返回当前投影；不写事实 | 无 revision |

Adapter 在检查 `If-Match` 后还必须读取当前 `scheduleRevision`，并把所有领域命令汇合到与 V2 相同的 Application Use Case。不得由 V1 Adapter 直接写事实表或“以客户端整包为准”。

## 12. Schedule lifecycle 与 Run lifecycle

ADP-019 已关闭冲突并冻结三个正交状态面：

- `scheduleStatus = draft | confirmed | cancelled` 表示时间块分配生命周期；
- `lockStatus = unlocked | locked | null` 仅表示编辑锁属性，迁移历史使用 `null + legacy provenance`；
- `productionRun.status = scheduled | shooting | blocked | completed | cancelled` 仅由现场运行命令和事件改变。

Kiosk complete 只增加对应 `runRevision + projectionRevision`，不修改 schedule status 或 lock。取消时间块与取消一次 run 是不同命令；V1 `task.status` 只保存在 legacy/request 兼容面，不能覆盖任何已有 run。

## 13. 冻结解决表

| ID | 冻结决定 | 依据 |
|---|---|---|
| `MAP-001` | `scheduleRevision = 0`，源 V1 revision 仅进入 projection domain | ADP-019/020 |
| `MAP-002` | 缺失业务时间写 `NULL + legacy provenance`；迁移接收时间单列 `imported_at` | ADP-019 |
| `MAP-003` | `client/legacy_deliver_text/legacy_place_text/note` 均有明确事实列 | ADP-019 |
| `MAP-004` | `product_catalog_entries` 保留重复项、孤立项和顺序 | ADP-019 |
| `MAP-005` | 保存 `legacy_v1_status`；不创建历史 run/event | ADP-019 |
| `MAP-006` | 历史新字段使用 nullable + provenance；`lightingPreset/reflectivity` 使用显式 unknown 表达 | ADP-019 |
| `MAP-007` | legacy deliver 文本与结构化计数/时长/音频各自保存 | ADP-019 |
| `MAP-008` | legacy-read profile 覆盖全部已发布 V1 Snapshot 枚举 | ADP-020 |
| `MAP-009` | dry-run/apply 必须显式提供 IANA `businessTimeZone`；架构默认不替代执行参数 | 本文第 6 节 |
| `MAP-010` | place 仅由版本化精确映射解析；未映射可做不可执行 Shadow，阻断 Switch | 本文第 6 节 |
| `MAP-011` | 历史 Buffer/lock 均为 `NULL + legacy provenance` | ADP-019 |
| `MAP-012` | 未证明跨进程 upload/migration 协调前，apply 仅允许离线维护窗口 | 本文第 8、10 节 |
| `MAP-013` | `requests_v2` 是 canonical schedulable work identity，不创建第二套 task aggregate | ADP-019 |
| `MAP-014` | Schema+语义 validator 为统一入口；strict-write 与 legacy-read 分离，按 L0–L3 分类 | ADP-020 |
| `MAP-015` | imported metadata-only asset 写 `legacy_asset_entries`，绝不制造 upload/file | ADP-019 |
| `MAP-016` | schedule status、lock 和 run lifecycle 拆分，revision 域保持隔离 | ADP-019 |
| `MAP-017` | V1 PUT 仅允许受控 session 排期 diff；其余领域变化拒绝；no-op 不增 revision | ADP-020 |

## 14. 完成门

本映射只有在以下条件同时满足时才可标记 `FROZEN_FOR_WO_01_02`：

- 上述 `MAP-*` 阻断项都有明确决定；
- ADP-019/020 已为全部需保留 V1 事实指定规范化或 compatibility 落点，WO-01 Schema 必须按此编码；
- 多任务场次 Fixture 可 V1 → V2 → V1 无损 round-trip；
- 附件双向引用和文件 manifest 规则通过；
- revision 三域初值和幂等重复运行语义冻结；
- dry-run 对所有有损和待确认项产生稳定 code；
- 没有以默认值、当前时间、文本推断或自动拆分伪造历史事实。

上述架构条件已由 ADP-017 至 ADP-020 和本映射关闭。真实数据质量、实际 `businessTimeZone`、resource map、附件 manifest、备份与恢复演练仍是 WO-02 dry-run/apply 的运行准入门，不回退为架构歧义。
