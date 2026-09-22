# ADP-017：Revision Domains and Projection Versioning

- 状态：`ACCEPTED_AND_FROZEN`
- 日期：2026-09-22
- 决策范围：排期并发、现场事件并发、读投影新鲜度和 V1 兼容
- 替代：Architecture Decision Pack V2.1 的 ADP-005
- 细化：ADP-004、ADP-009、ADP-013 中的 revision 语义

## 1. 背景

原 ADP-005 将 `scheduleRevision` 与 `runRevision` 分离，但同时要求影响共享读模型的现场事件增加 `scheduleRevision`。

这会造成一个矛盾：摄影棚 Kiosk 的开始、挂起、恢复和完成事件虽然只修改单个运行实例，却会使后台调度员基于 `scheduleRevision` 提交的正式排期命令过期。频繁打点仍可能制造与排期无关的 `409 REVISION_CONFLICT`，没有真正实现并发域隔离。

同时，V1 Snapshot 需要在现场状态、待排需求或正式排期任一可见内容变化时更新。如果把它的 `revision` 直接等同于正式排期 revision，就无法表达只发生现场变化时的投影新鲜度。

## 2. 决定

V2.1 `MUST` 使用三个作用域明确的 revision：

| Revision | 保护对象 | 何时自增 |
|---|---|---|
| `scheduleRevision` | 正式排期和平面资源事实 | 时间、资源、Buffer、锁、任务绑定、正式取消或确认发生变化 |
| `runRevision` | 单个 `production_run` | 开始、阻塞、恢复、完成、运行取消或 correction 成功 |
| `projectionRevision` | 对外共享读投影 | 任意会改变 V1/V2 Snapshot 可见内容的事务成功 |

### 2.1 scheduleRevision

正式排期命令 `MUST` 携带 `expectedScheduleRevision`。

以下变化 `MUST` 增加 `scheduleRevision`：

- 新建或删除正式排期时间块；
- 修改 `plannedStart`、`plannedEnd`、`resourceId` 或 Buffer；
- 修改排期锁；
- 增加、移除或重新排序时间块中的任务绑定；
- 接受 Agent Proposal 并转化为正式排期；
- 正式确认 Soft Drift；
- 通过排期命令取消一个正式时间块。

以下变化 `MUST NOT` 单独增加 `scheduleRevision`：

- Kiosk 开始、阻塞、恢复或完成；
- 只新增一个尚未排期的请求；
- 钉钉通知发送状态；
- Outbox lease 或重试状态；
- 只重建内容等价的投影。

### 2.2 runRevision

每个 `production_run` 拥有独立 `runRevision`。Kiosk 或其他运行状态命令 `MUST` 携带 `expectedRunRevision`。

- 一个 run 的事件不得使另一个 run 的 `runRevision` 变化；
- 同一 run 的并发事件只有一个可以基于相同 expected revision 成功；
- correction 也必须检查并增加当前 run revision；
- run 事件不得因为无关排期或其他 run 变化而失败。

### 2.3 projectionRevision

`projectionRevision` 是共享读模型的单调版本。以下任一可见变化 `MUST` 增加它一次：

- 请求进入或离开待排池；
- 正式排期变化；
- 现场运行状态或有效工时变化；
- 会改变 V1/V2 Snapshot 的 correction；
- 会改变公开 diagnostics 的已提交配置版本变化。

同一数据库事务即使改变多个实体，也只增加一次全局 `projectionRevision`。

纯 Outbox 状态、内部 lease、审计追加或内容等价的投影重建 `MUST NOT` 增加 `projectionRevision`。

## 3. 组合变化

一个命令可能跨越多个 revision 域，但必须明确声明：

```text
仅排期变化：scheduleRevision + projectionRevision
仅现场变化：对应 runRevision + projectionRevision
仅待排请求变化：projectionRevision
排期和运行同时变化：scheduleRevision + runRevision + projectionRevision
仅通知投递状态：不增加上述业务 revision
```

跨域命令必须在同一事务检查所有 expected revision，并在同一事务更新所有事实和投影。

## 4. API 语义

### 4.1 V2

V2 Snapshot `MUST` 明确返回：

```json
{
  "schemaVersion": 2,
  "projectionRevision": 42,
  "scheduleRevision": 12,
  "updatedAt": "2026-09-22T09:00:00.000Z"
}
```

运行详情同时返回自身 `runRevision`。

V2 API `MUST NOT` 使用无作用域的 `expectedRevision`：

```text
排期命令：expectedScheduleRevision
现场事件：expectedRunRevision
读缓存/增量刷新：projectionRevision
```

### 4.2 V1 兼容

V1 Snapshot 的既有 `revision` 映射到 `projectionRevision`，因为旧客户端只能理解一个代表完整 Snapshot 新鲜度的版本。

`PUT /api/v1/snapshot` 在兼容期继续使用旧 `If-Match`：

- `If-Match` 与当前 `projectionRevision` 不一致时返回 409，要求旧客户端刷新；
- 一致时由 V1 Adapter 计算正式排期差异并转换为领域命令；
- Adapter `MUST` 检查当前 `scheduleRevision`，保留 V2-only 运行状态和事件；
- V1 写入不得通过提交旧 Snapshot 回滚现场状态、待排请求或 V2-only 字段。

旧 V1 写路径可能因现场变化而要求刷新，这是兼容期的安全代价。V2 VCP Adapter 使用 `expectedScheduleRevision` 后，现场打点不再造成无关排期冲突。

## 5. Agent Proposal

Proposal 继续记录：

```text
baseScheduleRevision
inputDigest
algorithmVersion
configVersion
```

接受 Proposal 时：

1. `baseScheduleRevision` `MUST` 等于当前 `scheduleRevision`；
2. `inputDigest` `MUST` 重新计算，覆盖该 Proposal 使用的待排请求、资源和配置输入；
3. 任一不匹配都将 Proposal 标记为 `stale`；
4. `projectionRevision` 不作为 Proposal 可用性的唯一依据，因为无关现场状态也会改变它。

## 6. 数据与事务要求

- revision 计数器 `MUST` 存放在 SQLite 事实域中；
- 读取、比较和递增 `MUST` 位于同一写事务；
- 不得先在内存判断 revision，再开启写事务；
- revision `MUST` 使用安全整数范围内的非负整数；
- 失败和回滚不得消耗 revision；
- 幂等重放返回原结果，不再次增加 revision；
- Projection payload 与其 `projectionRevision` `MUST` 在同一事务提交。

## 7. 验收测试

必须覆盖：

1. Kiosk 开始事件增加 `runRevision` 和 `projectionRevision`，但不增加 `scheduleRevision`；
2. 调度员持有旧 `projectionRevision`、最新 `scheduleRevision` 时，V2 排期命令仍可成功；
3. 同一 run 的两个并发事件只有一个成功；
4. 两个排期命令基于同一 `scheduleRevision` 时只有一个成功；
5. 新增待排请求增加 `projectionRevision`，不增加 `scheduleRevision`；
6. Outbox 状态变化不增加任何业务 revision；
7. V1 Snapshot 的 `revision` 随现场可见状态变化；
8. V1 旧写入不能覆盖 V2 现场状态；
9. 幂等重放不二次增加任何 revision；
10. Proposal 在 schedule revision 或 input digest 变化后变为 stale。

## 8. 结论

`scheduleRevision` 保护计划，`runRevision` 保护单次现场运行，`projectionRevision` 表达共享读模型的新鲜度。三者不可互换，也不得通过一个含义模糊的全局 revision 重新耦合。
