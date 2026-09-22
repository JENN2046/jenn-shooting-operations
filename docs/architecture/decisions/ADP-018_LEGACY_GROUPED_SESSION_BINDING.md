# ADP-018：Legacy Grouped Session Binding

- 状态：`ACCEPTED_AND_FROZEN`
- 日期：2026-09-22
- 决策范围：V1 多任务场次、V2 排期时间块、生产运行和训练样本
- 细化/替代：原设计中 `schedule_items.taskId` 的单任务假设

## 1. 背景

V1 `sessions` 使用：

```json
{
  "id": "SESSION-1",
  "ids": ["TASK-1", "TASK-2"],
  "date": "2026-09-22",
  "start": "09:00",
  "end": "11:00"
}
```

一个时间段可以包含多个任务，但没有记录各任务的独立开始、结束或时长。迁移时平均分割总时长、按数组顺序猜测区间，或只保留第一个任务，都会制造不存在的历史事实。

## 2. 决定

`schedule_items` 表达一个占用资源的连续时间块，不直接持有单一 `taskId`。任务关系通过关联表表达：

```text
schedule_items
schedule_item_tasks
```

### 2.1 schedule_items

最小事实字段：

```text
id
resource_id
planned_start
planned_end
buffer_after_minutes
lock_status
allocation_mode
source
source_ref
created_at
updated_at
```

`allocation_mode` 在 V2.1 固定为：

```text
single
grouped_unallocated
```

### 2.2 schedule_item_tasks

最小字段：

```text
schedule_item_id
task_id
display_order
created_at
```

约束：

- 主键或唯一约束为 `(schedule_item_id, task_id)`；
- `display_order` 在同一时间块内唯一且稳定；
- `single` 必须且只能绑定一个任务；
- `grouped_unallocated` 必须绑定两个或更多任务；
- `grouped_unallocated` 不保存虚构的单任务开始、结束或计划分钟数；
- 新 V2 人工排期默认创建 `single`；
- `grouped_unallocated` 只用于遗留迁移、V1 兼容输入或明确的组合拍摄业务决定。

## 3. 生产运行作用域

`production_runs` `MUST` 支持：

```text
scope: task | block
schedule_item_id
task_id: nullable
```

规则：

- `single` 时间块使用 `scope: task`，`task_id` 必须与唯一绑定一致；
- `grouped_unallocated` 在未拆分前使用 `scope: block`，`task_id` 必须为空；
- block-level run 的状态和净工时只代表整个组合场次；
- 系统不得把 block-level 净工时自动分摊到其中任务；
- block-level 样本不得进入单任务时长预测训练集；
- Kiosk 必须显示组合场次中的全部任务，并明确标记“组合场次，未拆分单任务工时”。

## 4. 迁移规则

迁移 V1 session 时：

```text
ids.length === 1
  → 创建 allocation_mode = single
  → 创建一个 task binding

ids.length > 1
  → 创建 allocation_mode = grouped_unallocated
  → 按 V1 ids 顺序创建多个 bindings
  → 不创建单任务时长
  → 不猜测任务切换点
```

迁移记录 `MUST` 保留：

- 原 V1 session ID；
- 原 `ids` 顺序；
- 原计划开始和结束；
- 来源标记 `migration`；
- 迁移批次或版本。

不得为了满足新表非空约束而制造假任务、假时间或假生产事件。

## 5. 人工拆分

调度员可以将 `grouped_unallocated` 拆为多个 `single` 时间块。拆分属于正式排期命令，必须：

1. 携带 `expectedScheduleRevision`；
2. 明确每个任务的新时间和资源；
3. 验证总区间、重叠和营业边界；
4. 保留原组合时间块的 provenance；
5. 增加 `scheduleRevision` 和 `projectionRevision`；
6. 产生最小披露审计记录；
7. 不删除已存在的 block-level production events。

已经产生现场事件的组合场次拆分时，历史 block-level run 保留。拆分后的新 task-level run 从新确认的边界开始，不回填伪造历史。

## 6. V1/V2 投影

### V1 投影

一个 `schedule_item` 投影为一个 V1 session：

- `ids` 按 `display_order` 输出；
- `date/start/end` 从业务时区转换；
- grouped item 继续表现为多任务 session；
- 不在 V1 中添加未定义扩展字段。

### V2 投影

V2 时间块返回：

```text
id
taskBindings[]
allocationMode
resourceId
plannedStart
plannedEnd
bufferAfterMinutes
lockStatus
```

`taskBindings[]` 是关联表的读投影，不允许客户端通过整体替换绕过领域命令修改关系。

## 7. Agent 调度规则

- Agent `MUST NOT` 自动拆分 `grouped_unallocated`；
- 组合时间块作为不可细分占用区间参与冲突检测；
- 组合时间块的 block-level 时长不得作为单任务估时样本；
- Agent 可以建议人工拆分，但建议必须解释缺少单任务边界；
- 人工拆分后产生的新 `single` 数据只有在事件完整时才可成为训练样本。

## 8. 数据完整性约束

必须通过数据库约束或同事务领域校验保证：

- 不存在无任务绑定的活动时间块；
- 不存在绑定未知任务的时间块；
- `single` 不会绑定多个任务；
- `grouped_unallocated` 不会只有一个任务；
- 删除或取消任务时不会留下悬空绑定；
- 修改绑定会触发正式排期 revision；
- V1 round-trip 保持多任务 ID 和顺序。

## 9. 验收测试

必须覆盖：

1. 单任务 V1 session 迁移为 `single`；
2. 多任务 V1 session 迁移为 `grouped_unallocated`；
3. 多任务迁移不产生单任务分钟数；
4. V1 → V2 → V1 保持 ID 集合、顺序和场次时间；
5. grouped block 的净工时不会进入 task-level 样本；
6. Agent 不自动拆分 grouped block；
7. 人工拆分检查 schedule revision；
8. 已有 block-level events 在拆分后仍可审计；
9. 非法 allocation mode 与绑定数量组合失败关闭；
10. 删除/取消不会产生悬空关联。

## 10. 结论

排期时间块与任务不是强制一对一。V2.1 通过显式关联保留 V1 多任务场次，不把迁移不确定性伪装成精确数据；只有人工确认后的单任务时间块和完整事件才能成为单任务调度模型的可信样本。
