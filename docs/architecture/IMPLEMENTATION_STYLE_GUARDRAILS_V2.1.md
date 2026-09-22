# Jenn Shooting Operations V2.1 Implementation Style Guardrails

- 状态：`BINDING_FOR_V2.1_IMPLEMENTATION`
- 日期：2026-09-22
- 目的：在遵守 Ports & Adapters 边界的同时，防止 JavaScript/ESM 实现出现无业务价值的类型和层级膨胀

## 1. 总原则

```text
为真实边界建立抽象。
为业务规则建立名字。
为测试建立稳定接缝。
不为模式本身制造文件。
```

架构的目标是降低耦合和风险，不是最大化接口、类、工厂或目录数量。

## 2. 什么时候建立 Port

只有当依赖满足以下至少一项时才建立 Port：

- 外部网络或 provider；
- 数据库/事务；
- 文件系统；
- 系统时间或随机 ID；
- 需要稳定 Mock 的进程边界；
- 存在两个真实实现；
- 未来替换已经有明确迁移路径，而不是纯猜测。

推荐的 Port 形式是普通 ESM 函数或对象契约：

```js
export function createClock({ now = () => new Date() } = {}) {
  return { now };
}
```

不要求抽象基类、继承层次、装饰器或依赖注入框架。

## 3. 不允许的过度抽象

V2.1 `MUST NOT`：

- 为每张表机械创建 Repository、Service、Manager、Factory 四层包装；
- 创建只有一个实现、一个方法且没有替换/测试价值的接口文件；
- 使用抽象类模拟 TypeScript 接口；
- 为简单数据对象建立 getter/setter 类；
- 用通用事件总线代替清晰的函数调用；
- 用反射、运行时容器或 service locator 隐藏依赖；
- 把一个 SQLite 查询拆成多层无规则转发；
- 仅为了“未来可能”引入插件系统；
- 将领域错误包装多次后丢失稳定 error code。

代码评审出现以下调用链时必须重新审视：

```text
HTTP → Controller → Handler → Service → Manager → Repository → DAO → SQLite
```

正常目标应接近：

```text
HTTP interface → Application use case → UnitOfWork / Repository port
                                      → Domain rule
```

## 4. 模块粒度

- 一个领域概念可以先从一个文件开始；
- 只有文件出现多个独立变化原因时才拆分；
- 单个 use case 应能在少量相邻文件内读懂；
- 共享 helper 必须有两个以上真实调用方，不能提前建“万能 utils”；
- SQL 可以与对应 SQLite repository 实现相邻放置；
- 小型行映射函数不需要单独 Mapper 类；
- 数据结构使用普通对象；只有存在不变量和行为时才考虑领域对象。

目录结构是边界提示，不是必须填满的模板。

## 5. Application Use Case 结构

每个写用例应清晰体现：

```text
parse/validate input
authorize
begin unit of work
check idempotency and scoped revision
invoke domain rule
persist facts/events
refresh affected projections
enqueue outbox if required
record minimal audit
commit
map stable result
```

这些步骤可以由少量函数组合实现，不要求每一步一个类。

应用层返回稳定的结构化结果，不抛出需要 HTTP 层解析字符串的错误。

## 6. Transaction 与 SQL

- 事务边界只能由 Application Use Case 或 UnitOfWork 明确控制；
- Repository 方法不得在调用者不知情时自行提交嵌套事务；
- 网络和长耗时计算不得持有 SQLite 写锁；
- SQL 使用参数绑定；
- 表创建和迁移使用显式、可审查 SQL；
- 不引入 ORM 只为替代当前少量 SQL；
- 需要多表一致性的写入必须共享同一数据库连接和事务；
- `SQLITE_BUSY` 不通过无限重试掩盖，应使用有限重试、busy timeout 和可观察错误码。

## 7. Outbox Dispatcher 实现约束

Dispatcher `MUST` 把领取、外部发送和结果回写拆开：

```text
短事务：领取有限批次并写入 lease
COMMIT
锁外：调用外部 Adapter
短事务：写 sent / retryableFailed / deadLetter
COMMIT
```

强制要求：

- 单次领取批次有小上限；
- lease 有到期时间；
- 网络调用不持有数据库事务；
- 新 Outbox 记录提交后可在进程内唤醒 Dispatcher；
- 空闲轮询使用可配置间隔与 jitter，初始建议 1–3 秒范围；
- 失败使用有上限的指数退避；
- 数据库忙时退避，优先保证前台业务写入；
- 不为零流量持续高频抢占 `BEGIN IMMEDIATE`；
- 进程关闭时停止领取新消息，但不把未发送 lease 标记为成功。

## 8. 测试策略

工作包采用测试先行，但不要求把故意失败的中间状态提交到 Git。

推荐循环：

```text
写最小失败测试
→ 确认失败原因与目标行为一致
→ 写最小实现
→ 运行目标测试
→ 运行相关回归
→ 重审变更
```

测试优先级：

1. 领域规则纯单元测试；
2. SQLite 真实内存库/临时库集成测试；
3. HTTP 契约测试；
4. V1/V2 round-trip 和迁移 Fixture；
5. 并发、崩溃恢复、重试和负向安全测试；
6. 必要的浏览器交互验证。

Mock 用于外部网络和不可控 provider，不应用 Mock 替代真正需要验证的 SQLite 事务语义。

## 9. AI 工作包上下文

给编码 Agent 的单次任务上下文应只包含：

- 一个 WO；
- 有效架构基线索引；
- 与当前 WO 直接相关的 ADP 条款；
- 本指南；
- 当前文件范围和已有测试；
- 明确验收、禁止项和停止条件。

实施者仍必须知道全局 12 条不变量，但不应把全部长文档当作未分层 Prompt 后要求自由重构。

推荐每个任务开头写明：

```text
Do not broaden scope.
Do not change frozen architecture.
Prefer plain ESM functions and objects.
Add no abstraction without a named boundary or second real use.
Preserve V1, upload safety, idempotency, scoped revisions and rollback.
Stop on data-loss risk, secret access, external real call or production action.
```

## 10. 评审问题

每个工作包提交前回答：

1. 新增的每个抽象对应哪个真实边界？
2. 删除任何一层后是否仍能保持测试性和依赖方向？
3. 一个业务动作是否可以在少量文件内完整追踪？
4. 是否在数据库事务内执行了网络或慢操作？
5. 是否无意引入第二事实源？
6. 是否保留了 V1、附件、幂等和 revision 安全属性？
7. 测试是否覆盖失败、冲突、重放和恢复，而不只覆盖成功路径？
8. 输出是否误报了未运行、跳过或未授权的能力？

## 11. 完成标准

一个实现只有在以下条件同时满足时才符合本指南：

- 依赖方向清晰；
- Port 数量与真实外部边界相称；
- 领域规则可以无数据库和网络测试；
- SQLite 事务由少量明确用例控制；
- 关键动作没有无价值的多层转发；
- Outbox 不长时间占用写锁；
- 最终检查和相关回归通过；
- 没有以“企业级架构”为理由引入当前不需要的基础设施。
