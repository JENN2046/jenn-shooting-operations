# ADP-020：V1 Contract Authority and Compatibility

- 状态：`ACCEPTED_AND_FROZEN`
- 日期：2026-09-22
- 决策范围：V1 Schema、运行时验证、历史宽松数据、round-trip 和 V1 PUT 边界
- 细化：ADP-009、ADP-017、ADP-019

## 1. 背景

当前 V1 JSON Schema 与手写 validator 是两套不一致的规则：

- Schema 声明 `additionalProperties: false`，手写 validator 没有完整执行；
- 手写 validator 没有完整校验 status、source、timestamp、assets、request、长度和 `uniqueItems`；
- Schema 不表达 ID 唯一、引用完整和 `end > start`；
- 两套规则都没有可靠拒绝真实不存在的日期；
- Snapshot Schema 时间 pattern 接受 `24:00–29:59`，手写 validator 更宽；
- `scripts/validate-contracts.mjs` 只解析 Schema，并没有真实执行 Draft 2020-12 校验。

因此，Schema PASS 或现有 validator PASS 都不能单独证明数据安全可迁移。

## 2. 权威契约

V1 权威契约固定为：

```text
JSON Schema structural validation
+ finite semantic invariant validation
```

### 2.1 Structural authority

`contracts/*.schema.json` 是 required/optional、type、enum/const、`additionalProperties`、长度、items、`uniqueItems`、pattern、numeric bounds 和对象/数组形状的唯一结构权威。

运行时 `MUST` 使用固定版本、支持 JSON Schema Draft 2020-12 的实现真实编译和执行 Schema，并显式启用所使用的 format assertion。JavaScript 不得继续复制结构枚举、长度和对象形状形成平行契约。

### 2.2 Semantic authority

手写语义层只负责：

- task/session ID 唯一；
- session task 引用存在；
- 日期实际存在且可精确 round-trip；
- 时间处于 `00:00–23:59` 且 `start < end`；
- revision 为 `0..Number.MAX_SAFE_INTEGER`；
- RFC 3339 timestamp 带明确 offset 或 `Z`；
- production type/subtype 条件组合；
- 附件数据库和文件完整性由独立 manifest validator 负责。

API、migration、fixture 和 contract script 必须汇合到相同公共验证入口。

### 2.3 时间和文本

V1 time pattern 修正为：

```regex
^(?:[01][0-9]|2[0-3]):[0-5][0-9]$
```

日期解析后按 `YYYY-MM-DD` 原样格式化必须完全相等。必填文本必须在长度范围内且至少包含一个非空白字符，但 validator 不得 trim 后改写原值。

## 3. 两个验证 profile

### 3.1 strict-write

适用于所有新 API 写入和 V2 激活后的领域命令：

- 完整 structural + semantic validation；
- 不接受未知属性；
- 不接受旧 validator 曾错误放行的非法日期、时间、状态或引用；
- 验证失败零写入、零 revision、零 Outbox。

### 3.2 legacy-read

只用于读取和分类既有 V1 source：

| 类别 | 定义 | 行为 |
|---|---|---|
| `L0_STRICT` | 新权威契约完全通过 | 可正常物化 |
| `L1_GRANDFATHERED_OPAQUE` | 非法片段不参与领域语义，且能精确保留 | 存入 legacy fragment；新写不可创建/修改 |
| `L2_REPAIR_REQUIRED` | 影响排期、状态、时间或绑定，无法安全物化 | dry-run 报告；阻断该实体命令和 Switch |
| `L3_SOURCE_CORRUPT` | 身份、引用或根结构不可可靠解释 | `INVALID_SOURCE`，停止 |

示例：

- 未知非冲突额外属性、非关键 optional timestamp 格式错误：L1；
- 未发布 status/source/subtype、非法时间/日期、`end <= start`、重复 session ids：L2；
- 重复主 ID、未知 task 引用、根结构错误、revision 非 safe integer：L3。

不得通过删除额外字段、去重、trim、截断或修正时间把 L1/L2 洗成 L0。

## 4. Legacy compatibility fragments

新增 `legacy_compat_fragments`，至少保存：

```text
entity_type
entity_id
json_pointer
value_json
value_digest
violation_code
classification
mapping_version
source_ordinal
```

规则：

- fragment 只保存 contract 外但必须兼容重放的 L1 原值；
- fragment 是受控规范化兼容事实，不是完整 Snapshot 第二事实源；
- L1 不参与资源映射、状态推导、训练、权限或领域命令；
- 日志和报告只输出 code、pointer 和 digest；
- PUT 相同值可回显，省略视为“不管理”；
- 修改 L1 或新增额外属性拒绝；
- L2/L3 不得通过 fragment 继续 Switch。

## 5. V1 round-trip 精度

必须分别验证：

### 5.1 Contract projection equality

- products 重复项和顺序；
- tasks 顺序、全部字段、optional presence、request、assets 和数组顺序；
- sessions 顺序、ids 顺序、date/start/end/place/note；
- `null`、缺失字段和空字符串不得互换；
- 不 trim、排序、去重或补默认值。

只忽略对象 key 顺序和 JSON 空白。Migration baseline 不忽略 `revision/updatedAt`；正式写成功后只允许服务端拥有的 revision/updatedAt 合理变化。

### 5.2 Legacy envelope equality

L1 fragment 必须能按 pointer、类型和完整 JSON 值精确重组并比较，不能只证明 digest 存在。

### 5.3 Public compatibility behavior

兼容 GET 可以重发 grandfathered L1；兼容 PUT 只允许相同 L1 回显或省略保留，不允许修改或新增。

报告必须分别输出：

```text
strictContractStatus
contractProjectionEqual
legacyEnvelopeEqual
combinedSourceRoundTripEqual
legacyIssueCountsByClass
```

## 6. V1 PUT 差异边界

规范化事实源激活后，V1 PUT 只表达正式排期变化，不再是任意全量覆盖。

| 输入差异 | 决定 | Revision |
|---|---|---|
| schema/body/header revision 不匹配 | 422/409 拒绝 | 无 |
| 客户端修改 updatedAt | 拒绝 | 无 |
| products 内容或顺序变化 | 拒绝，未来走产品目录命令 | 无 |
| task 新增、删除、换 ID、重排或字段变化 | 拒绝 | 无 |
| pending↔scheduled | 只能作为 session 差异的投影结果 | 随 schedule + projection |
| completed/cancelled 变化 | 拒绝，走 lifecycle/run command | 无 |
| session 新增 | 允许，转排期命令 | schedule + projection |
| session ids/date/start/end/place/note 修改 | 允许，经过 resource/lock/conflict 规则 | schedule + projection |
| session 删除 | 仅无 lock/run/event/V2-only dependency 时允许 | schedule + projection |
| session ID 修改 | 拒绝 | 无 |
| session updatedAt 客户端新值 | 拒绝 | 无 |
| sessions 重排 | 允许，作为兼容排序事实 | schedule + projection |
| grouped session 保持多个有序 ID | 允许 | schedule + projection |
| grouped 自动拆分/平均时长 | 拒绝 | 无 |
| L1 原值回显/省略 | 允许 no-op/保留 | 无额外 revision |
| 修改 L1/新增未知/V2-only 字段 | 拒绝 | 无 |
| 完全等价 PUT | 成功 no-op | 无 |

Idempotency key 必须绑定 canonical payload digest。同 key 不同 payload 返回 `409 IDEMPOTENCY_KEY_REUSE`。

## 7. Revision bootstrap

首次 V1 → V2 基线事务：

```text
projectionRevision = source V1 revision
scheduleRevision = 0
production run rows = 0
runRevision rows = 0
```

- migration 不消耗 revision；
- projection、legacy fragments 和 counters 同事务提交；
- 第一次正式排期变化：schedule `0→1`，projection `n→n+1`；
- 新 run 初值 0，首个事件后为 1；
- no-op、失败、回滚、幂等重放和 Outbox 状态不增加业务 revision；
- V1 GET `revision` 始终等于 projectionRevision。

## 8. 工作包门禁

### 进入 WO-01 前

- 本 ADP 已冻结；
- structural/semantic 职责和两个 profile 冻结；
- V1 Snapshot/Submission parity Fixture 矩阵就绪；
- contract script 的目标改为真实执行权威契约；
- 不再保留第二套 JS enum/长度结构规则。

### 进入 WO-02 前

- L0–L3 classifier 和 fragment Schema 已冻结；
- 每个已知差异都有单一原因 Fixture；
- dry-run 分别报告 strict/legacy/combined round-trip；
- 不能通过删除或修正源值让迁移通过。

### 进入 Switch 前

- 实际输入 L2/L3 为 0；
- L1 全部可精确重组且不与 V2 字段冲突；
- V1 round-trip、双投影、附件、revision 和 VCP Adapter 验证通过；
- 所有拒绝差异验证零事实、零 revision、零 Outbox。

## 9. 最低验收测试

必须覆盖：

1. Draft 2020-12 Schema 被真实编译执行；
2. root/task/session/request/asset/submission extra properties 拒绝；
3. status/source/asset 字段和长度边界拒绝；
4. whitespace-only 必填文本拒绝但不改写；
5. duplicate IDs、duplicate session task IDs 和 unknown references 拒绝；
6. 非法时间、日期、end <= start 拒绝；
7. RFC 3339 timestamp 和 safe integer 严格校验；
8. Snapshot/Submission 的 Schema 与公共 validator 一致；
9. L1 精确保留、回显、不可修改；
10. L2/L3 不产生 Switch-ready；
11. V1 PUT stale/no-op/allowed/rejected 差异符合矩阵；
12. 所有拒绝路径零写入；
13. 所有成功命令的事实、revision、projection、audit 和 Outbox 同事务可见；
14. bootstrap 和幂等重放不多消耗 revision。

## 10. 结论

Schema 不再只是说明文件，手写 validator 也不再是平行契约。V2.1 对新写入执行严格单入口契约，对历史宽松数据只允许分类、精确保留或显式修复；迁移器不得静默清洗，V1 PUT 不得再覆盖 V2-only 事实。
