# Jenn Shooting Operations V2.1 Migration Dry-run Specification

- 状态：`FROZEN_FOR_WO_02_IMPLEMENTATION`
- 规范版本：`migration-dry-run-v2.1-r1`
- 日期：2026-09-22
- 依赖：[Current → V2 Mapping V2.1](CURRENT_TO_V2_MAPPING_V2.1.md)、ADP-019、ADP-020
- 非授权声明：本文不授权生产数据读取/写入、生产迁移、服务切流、附件变更或部署

## 1. 目标

dry-run 用于在不修改源数据库、目标数据库、上传卷或外部系统的前提下回答：

1. 当前 V1 数据能否按冻结映射进入 V2；
2. 哪些记录会无损映射、发生有损或需要人工确认；
3. 多任务 session、revision 和附件引用是否满足硬约束；
4. 生成的 V1 兼容投影能否与源数据 round-trip；
5. 未来 apply 和回滚需要哪些明确条件。

dry-run 是准入证明，不是迁移本身。`PASS` 仅表示给定输入、配置和规范版本可以进入隔离 apply 演练，不表示可以连接生产或 Switch。

## 2. 安全属性

### 2.1 必须保持只读

`--dry-run` 必须：

- 以 SQLite `readOnly` 和 `PRAGMA query_only = ON` 打开 source；
- 在稳定只读事务内读取所需表；
- 使用进程内模型或 `:memory:` SQLite 模拟目标；
- 不调用现有 `ScheduleStore` 的写构造、恢复或清理路径；
- 不创建/修改 source 的 WAL、journal、migration 表或审计行；
- 不打开外部网络；
- 不写 target；
- 不移动、删除、重命名或恢复上传文件；
- 默认只向 stdout/stderr 输出低披露报告。

若只读打开会导致 SQLite 修改源目录，工具必须失败并要求使用一致性副本，不得自动降级为读写打开。

### 2.2 输入路径约束

- source 必须是显式本地 SQLite 文件，不接受 URL、DSN 或环境变量隐式默认值；
- 不提供默认生产路径；
- source 和 target 规范化后不得相同；
- source 不得位于 target 目录的待覆盖位置；
- upload root 必须显式给出，且只用于 metadata/existence/hash 校验；
- 报告不得打印绝对路径，只输出用户提供的 label 和路径摘要；
- 符号链接必须解析后重新检查边界；附件验证不得跟随逃逸受控 root 的链接。

## 3. CLI 契约

建议入口：

```text
node scripts/migrate-v1-to-v2.mjs [mode] [options]
```

WO-00 只冻结契约，不创建该脚本。

### 3.1 Dry-run

```bash
node scripts/migrate-v1-to-v2.mjs \
  --dry-run \
  --source /explicit/path/source.sqlite \
  --source-label fixture-a \
  --business-time-zone Asia/Shanghai \
  --resource-map /explicit/path/resource-map.json \
  --upload-root /explicit/path/uploads
```

参数：

| 参数 | 必需 | 语义 |
|---|---:|---|
| `--dry-run` | 是 | 只读分析并在内存模拟，不写 target |
| `--source <file>` | 是 | 显式 V1 SQLite 文件 |
| `--source-label <text>` | 否 | 报告用非敏感标签；不使用原文件名时推荐 |
| `--business-time-zone <IANA>` | 是 | 解释 V1 `date/start/end`；不得从宿主机猜测 |
| `--resource-map <json>` | 有 session 时是 | 版本化 `place`→`resourceId` 映射；未知值阻断 |
| `--upload-root <dir>` | 有文件型 upload 时是 | 只读附件 manifest 校验根目录 |
| `--hash-uploads` | Switch 前是 | 对受控附件重新计算 SHA-256；普通快速 dry-run 可省略但结果不得标记 Switch-ready |
| `--format text\|json` | 否 | 默认 `text`；两种格式字段语义一致 |
| `--strict` | 否 | warning 也产生非零退出；CI/准入使用 |
| `--report-json <file>` | 否 | 显式写低披露报告；目标必须不存在，除非同时给 `--overwrite-report` |
| `--overwrite-report` | 否 | 只允许覆盖报告文件，不扩大数据库/附件写权限 |

不允许：

- 通过 `DATABASE_PATH`、`.env` 或工作目录猜测 source；
- `--dry-run` 与 `--apply` 同时存在；
- 仅凭 `--force` 忽略 blocker；规范不定义通用 `--force`；
- 把真实 Brief、人员、附件原名或原始 JSON 写入报告。

### 3.2 Verify-only

```bash
node scripts/migrate-v1-to-v2.mjs \
  --verify-only \
  --source /explicit/path/source.sqlite \
  --target /explicit/path/isolated-v2.sqlite \
  --business-time-zone Asia/Shanghai \
  --resource-map /explicit/path/resource-map.json \
  --upload-root /explicit/path/uploads \
  --hash-uploads
```

`--verify-only` 以只读方式打开 source 和 target，执行迁移后核验。它不得补写缺失 projection、migration row 或 revision。

目标异常处理：

- target 不存在、不可读、不是 SQLite 或 integrity check 失败：`INVALID_TARGET`；
- target 与 source 解析为同一 inode/真实路径：`INVALID_USAGE`，不得打开写模式；
- target 缺少预期 migration marker/schema version：`INVALID_TARGET`；
- target 只有部分 V2 表或 batch 状态为 incomplete：报告 `PARTIAL_TARGET_MIGRATION`，不得自动补写；
- target 的 batch source/config digest 与本次不一致：`TARGET_BATCH_MISMATCH`；
- target 已有完全相同的 completed batch：按幂等核验，不再写入，结果可为 `ALREADY_APPLIED_VERIFIED`；
- target 含无归属业务行或更高 schema version：失败关闭，不做降级或清空。

### 3.3 Future apply（非 WO-00 实现范围）

未来 apply 至少要求：

```text
--apply
--source <explicit file>
--target <explicit isolated file>
--backup <verified backup file>
--business-time-zone <IANA>
--resource-map <versioned json>
--acknowledge-isolated-target
```

没有显式 target 和已验证 backup 时必须拒绝。首次实现不得把 `--target` 省略后原地迁移 source。生产 apply、在线 apply 和 Switch 仍需独立授权与门禁。

Future apply 对 target 的规则：

- 默认要求 target 为不存在的新文件；
- 若 target 已存在，只允许它是工具创建、schema/batch marker 完整且 source/config digest 完全匹配的可验证幂等目标；
- 禁止 `--force` 清空或覆盖异常 target；
- 创建失败或事务回滚后保留失败 target 与低披露证据，后续只能 verify/人工处置，不能假装从空库重来；
- SQLite `-wal/-shm/-journal` sidecar 也属于目标身份检查范围。

## 4. Resource map 契约

资源映射文件不包含凭据，建议结构：

```json
{
  "schemaVersion": 1,
  "mapVersion": "studio-map-2026-09-22",
  "businessTimeZone": "Asia/Shanghai",
  "places": {
    "棚 A": "studio-a"
  }
}
```

规则：

- 键做精确 Unicode 字符串匹配，不 trim 后模糊合并；
- 不匹配时报告 `UNMAPPED_RESOURCE`，不得用 slug 自动创建；
- 多个 place 映射到同一 resource 允许，但必须进入重叠检查；
- map timezone 必须与 CLI timezone 一致；
- 报告记录 map version 和内容 digest，不输出全部 place 文本；
- 资源 ID 必须满足 V2 Schema；
- 映射文件变化会改变 migration batch digest，不能被视为同一次幂等重放。

## 5. 执行阶段

### Phase A：预检

1. 解析参数，确认模式互斥；
2. 解析真实路径并验证边界；
3. 只读打开 source；
4. 执行 `PRAGMA quick_check`，准入/回滚演练执行 `integrity_check`；
5. 检查必需表和列，不执行 DDL；
6. 读取 `schedule_state` 唯一行；
7. 校验 `schedule_state.revision/updated_at` 与 JSON 顶层一致；
8. 校验 Snapshot V1 契约和额外交叉不变量；
9. 通过 ADP-020 的统一入口执行 Schema 结构校验与有限语义校验，并输出 L0–L3 compatibility classification；在 WO-01 完成前，额外记录当前 runtime validator 结果作为基线差异证据；
10. 计算不含业务正文的 source fingerprint。

Source fingerprint 至少包含：

```text
schema shape digest
snapshot revision
canonical structural digest
row counts
mapping spec version
resource map digest
```

canonical structural digest 可以覆盖完整 canonical JSON，但报告只输出摘要，不输出输入内容。

### Phase B：读取与交叉核验

在一个稳定只读事务内读取：

- Snapshot 顶层、products、tasks、sessions；
- `operations` 中与迁移关联的 kind 和最小响应字段；
- `uploads` 的引用和 metadata；
- `audit_log` 的计数、revision 范围与结构，不输出 result 内容。

验证：

- ID 唯一；
- session task 引用完整；
- task 与 session status 的可疑组合；
- operationId→task 恢复是一对零或一；
- upload→task 与 task.asset→upload 双向一致；
- session time 在指定时区有效且 end > start；
- 同一 resource 的 confirmed legacy sessions 是否重叠；
- 多任务 session 被识别为 grouped，而非拆分候选。

必须区分 managed upload 与没有 `uploads` 行的 legacy imported asset；后者映射到 `legacy_asset_entries` 并产生信息项，不得被错误当成已认领文件丢失。

### Phase C：内存映射

按冻结字段矩阵创建内存目标：

- request/task identity；
- schedule items 与 task bindings；
- migration provenance；
- revision counters proposal；
- V1/V2 projection 候选；
- 不创建 production events；
- 默认不创建 production runs；
- 不创建 notification outbox；
- 不创建 Agent proposal。

遇到 **有损** 或未关闭的 **待确认** 字段时，不填默认值，记录稳定 issue code。L1 runtime-only 字段写入 `legacy_compat_fragments`；L2 repair-required 与 L3 corrupt 输入不得物化目标记录。若必填目标字段没有冻结表达，目标记录标记 `notMaterializable`。

### Phase D：投影与 round-trip

1. 从内存 V2 模型生成 `schedule-v1-compat`；
2. 使用 ADP-020 legacy-read profile 校验，并将当前 V1 runtime validator 结果作为迁移期对照证据；
3. canonicalize 源和 round-trip Snapshot；
4. 比较 products、tasks、sessions 的字段、引用和顺序；
5. 把 V1 `revision` 对照 proposed `projectionRevision`；
6. 生成只含 pointer/type/digest 的差异摘要；
7. V2 projection 使用未来 V2 validator 校验；在 WO-01 前必须明确报告 `NOT_RUN`，不得写 PASS。

另外模拟 ADP-020 冻结的 V1 PUT 差异矩阵，至少确认：

- V2-only 字段不会因旧客户端整包写入而被清空；
- asset diff 不会绕过 upload claim；
- grouped binding 不会被单 task 字段覆盖；
- run state/event 不会被 V1 task status 回滚；
- 仅 schedule diff 才增加 `scheduleRevision`；
- no-op PUT 不写事实、不增加任何 revision。

### Phase E：附件 manifest

fast dry-run：

- 验证数据库引用、stored name 格式、文件存在性和大小；
- 不读取文件正文。

`--hash-uploads`：

- 以只读流重新计算 SHA-256；
- 结果只报告匹配/不匹配计数；
- 不输出路径、文件名或 hash 原值；
- 发现文件在读取期间 size/mtime 变化，标记 `UPLOAD_SET_CHANGED_DURING_SCAN` 并停止 Switch-ready 判定。

### Phase F：幂等模拟

对同一 source fingerprint、迁移版本和配置 digest 在全新内存模型中运行两次：

- 规范化事实计数不增加；
- binding 不重复；
- revision 不二次增加；
- migration batch identity 相同；
- projections canonical digest 相同。

任一不成立为 blocker。

## 6. 报告契约

### 6.1 顶层结构

JSON 报告建议结构：

```json
{
  "specVersion": "migration-dry-run-v2.1-r1",
  "mode": "dry-run",
  "result": "PASS_WITH_WARNINGS",
  "source": {
    "label": "fixture-a",
    "schemaDigest": "sha256:…",
    "structuralDigest": "sha256:…",
    "snapshotRevision": 12
  },
  "configuration": {
    "businessTimeZone": "Asia/Shanghai",
    "resourceMapVersion": "studio-map-2026-09-22",
    "resourceMapDigest": "sha256:…",
    "uploadHashing": false
  },
  "counts": {},
  "mapping": {},
  "compatibility": {
    "classification": "L0_STRICT",
    "legacyFragmentsPreserved": 0,
    "repairRequired": 0,
    "corruptRecords": 0
  },
  "revisions": {},
  "roundTrip": {},
  "attachments": {},
  "rollbackReadiness": {},
  "issues": []
}
```

### 6.2 必需计数

```text
products
tasks
sessions
singleSessions
groupedUnallocatedSessions
taskBindings
operationsByRelevantKind
uploads
claimedUploads
orphanUploads
assetProjectionReferences
wouldCreateRequests
wouldCreateScheduleItems
wouldCreateProductionRuns (= 0 for baseline migration)
wouldCreateProductionEvents (= 0)
unmappedRecords
```

### 6.3 Mapping 摘要

按字段/规则输出：

```text
losslessCount
lossyCount
pendingDecisionCount
notMaterializableCount
issue codes by severity
```

不得用“多数无损”掩盖任一必填字段 blocker。

### 6.4 Revision 摘要

```text
sourceV1Revision
proposedProjectionRevision
proposedScheduleRevision
createdRunCount
runRevisionRange
revisionMonotonicityCheck
idempotentReplayConsumesRevision: false
```

### 6.5 Round-trip 摘要

```text
validatorStatus
sourceCanonicalDigest
roundTripCanonicalDigest
productsEqual
tasksEqual
sessionsEqual
orderingEqual
diffCount
```

### 6.6 Attachment 摘要

```text
databaseReferencesValid
filesChecked
filesMissing
sizeMismatches
hashesChecked
hashMismatches
unsafePaths
stagedTombstonesObserved
uploadSetStable
```

### 6.7 Issue 格式

```json
{
  "code": "UNMAPPED_RESOURCE",
  "severity": "BLOCKER",
  "entityType": "session",
  "entityRef": "digest:…",
  "field": "/place",
  "count": 1,
  "message": "A versioned resource mapping is required"
}
```

`entityRef` 默认使用稳定摘要或序号；只有明确需要本地人工定位时才允许内部 ID。报告禁止包含：

- SKU/name/client/requestedBy/note/deliver/Brief 正文；
- `original_name`、附件内容或绝对路径；
- Token、cookie、header、环境变量值；
- SQL 原文、堆栈、provider raw response。

## 7. 结果状态与退出码

| 状态 | 条件 | Exit code |
|---|---|---:|
| `PASS` | 无 blocker/error；完整 hash 与 V1/V2 validator 均通过 | 0 |
| `PASS_WITH_WARNINGS` | 无 blocker/error，但存在非破坏性 warning；或 fast 模式未做完整 hash | 0；`--strict` 下为 2 |
| `BLOCKED_MAPPING` | 存在有损字段或未关闭的必填待确认项 | 2 |
| `INVALID_USAGE` | 参数、路径或配置错误 | 3 |
| `INVALID_SOURCE` | 源库、Snapshot、引用或附件完整性失败 | 4 |
| `INVALID_TARGET` | verify-only 目标结构/迁移结果失败 | 5 |
| `INTERNAL_ERROR` | 未分类异常；输出低披露 code | 10 |

WO-01 V2 Schema/validator 尚不存在时，V2 validator 必须显示 `NOT_RUN`，因此报告最多可作为 WO-00 mapping readiness，不得声称 `PASS_SWITCH_READY`。

## 8. 稳定 Issue codes

至少冻结以下 codes：

```text
SOURCE_SCHEMA_MISSING
SOURCE_INTEGRITY_FAILED
SNAPSHOT_ROW_COUNT_INVALID
SNAPSHOT_REVISION_MISMATCH
SNAPSHOT_INVALID
DUPLICATE_TASK_ID
DUPLICATE_SESSION_ID
UNKNOWN_TASK_REFERENCE
OPERATION_RESPONSE_INVALID
OPERATION_TASK_AMBIGUOUS
MISSING_LEGACY_TIMESTAMP
LEGACY_FIELD_NO_V2_TARGET
VALIDATOR_DIVERGENCE
LEGACY_RUNTIME_ONLY_RECORD
LEGACY_L1_FRAGMENT
LEGACY_L2_REPAIR_REQUIRED
SOURCE_L3_CORRUPT
STRICT_CONTRACT_FAILED
REQUEST_TASK_BOUNDARY_UNRESOLVED
LEGACY_STATUS_UNMAPPED
SCHEDULE_RUN_LIFECYCLE_CONFLICT
UNKNOWN_REQUIRED_V2_FIELD
BUSINESS_TIME_ZONE_REQUIRED
INVALID_LOCAL_TIME
RESOURCE_MAP_REQUIRED
UNMAPPED_RESOURCE
RESOURCE_OVERLAP
GROUPED_SESSION_PRESERVED
GROUPED_SESSION_WOULD_SPLIT
UPLOAD_REFERENCE_MISSING
UPLOAD_PROJECTION_MISSING
UNMANAGED_LEGACY_ASSET_PRESERVED
UPLOAD_CLAIM_MISMATCH
UPLOAD_METADATA_MISMATCH
UPLOAD_FILE_MISSING
UPLOAD_SIZE_MISMATCH
UPLOAD_HASH_MISMATCH
UPLOAD_PATH_UNSAFE
UPLOAD_SET_CHANGED_DURING_SCAN
STAGED_UPLOAD_RECOVERY_REQUIRED
ROUND_TRIP_MISMATCH
ORDERING_MISMATCH
REVISION_MAPPING_UNRESOLVED
IDEMPOTENCY_SIMULATION_FAILED
V2_VALIDATOR_NOT_AVAILABLE
BACKUP_NOT_VERIFIED
ROLLBACK_NOT_VERIFIED
PARTIAL_TARGET_MIGRATION
TARGET_BATCH_MISMATCH
TARGET_SCHEMA_UNSUPPORTED
V1_PUT_DIFF_UNRESOLVED
```

`GROUPED_SESSION_PRESERVED` 是信息项；`GROUPED_SESSION_WOULD_SPLIT` 是 blocker。

## 9. 立即停止条件

遇到以下任一条件，停止映射阶段，不继续生成“尽力而为”的目标：

- source 不是只读打开或需要修改才能读取；
- SQLite integrity check 失败；
- `schedule_state` 不是恰好一行；
- relational revision 与 JSON revision 不一致；
- legacy-read 分类为 L2 repair-required 或 L3 corrupt；L0 strict 与可无损保留的 L1 可继续；
- task/session ID 重复或 session 引用未知 task；
- 多任务 session 将被拆分、丢 ID 或改变顺序；
- 业务时区缺失、无效或遇到无法无歧义解释的本地时间；
- place 缺少显式 resource 映射且目标是可执行 apply/Switch（Shadow 可保留 unresolved 状态）；
- 必填 V2 字段只能靠伪造默认值满足；
- operation response 无法安全解析或一 task 对应多个 operationId；
- 已认领 upload 引用、metadata、文件、大小或 hash 不一致；
- 发现路径逃逸、符号链接逃逸或不受控 upload root；
- 需要调用 upload cleanup/recovery 才能继续；
- round-trip 丢失字段、顺序或引用；
- 重复运行模拟产生重复事实或 revision；
- source/附件集合在扫描期间变化且目标是 Switch-ready 证明；
- 任一身份、生命周期或 V1 PUT diff 需要偏离 ADP-019/020 才能通过；
- verify-only target 缺表、部分迁移、digest 不符、版本更高或包含无归属事实；
- 需要秘密、生产配置、真实外部服务或生产数据库权限。

停止报告必须说明已完成的只读检查、未执行的写操作、稳定错误码和最小修复条件。

## 10. 在线数据与一致性边界

SQLite WAL 可以提供稳定数据库读事务，但数据库快照与上传卷不是天然跨介质事务快照。若服务同时接受上传或执行清理：

- 普通 dry-run 可以报告数据库结构，但不能宣称附件集合 Switch-ready；
- 完整迁移演练必须使用协调生成的一致性数据库备份和同一边界下的上传 manifest；
- 在跨进程 upload/migration 协调未实现和验证前，apply 必须在离线维护窗口进行；
- 不允许把文件 `EEXIST`、短暂缺失或 cleanup tombstone 当作成功迁移证据。

## 11. 备份与回滚验证

### 11.1 迁移前备份证明

未来 apply 前必须得到：

- SQLite 一致性备份文件；
- `PRAGMA integrity_check = ok`；
- Snapshot canonical digest 与 revision；
- 表结构 digest 和行数摘要；
- 上传 manifest（ID、claimed task、stored name digest、size、sha256 匹配状态）；
- 代码版本、migration spec/version、resource map digest；
- 备份生成时间和非敏感 label。

现有 `scripts/backup.mjs` 使用 `VACUUM INTO`，但当前只证明“创建文件”。在作为迁移回滚门前，必须补充目的地防覆盖、备份完整性校验和恢复演练；不得仅凭命令退出 0 宣称可恢复。

### 11.2 恢复演练

恢复必须发生在新的隔离路径，不覆盖源库或上传卷：

1. 将备份恢复到全新隔离数据库路径；
2. 以只读方式执行 integrity check；
3. 对照备份前 revision、结构 digest、记录计数和 Snapshot canonical digest；
4. 使用只读 upload manifest 验证已认领附件引用；
5. 运行 V1 contract validator；
6. 启动验证如需要，只允许本地隔离端口且需另行纳入对应工作包；
7. 记录 `ROLLBACK_VERIFIED`，不删除原 target 作为“回滚”。

### 11.3 回滚语义

在 Switch 前，V2 apply 的安全回滚是：

```text
停止使用隔离 V2 target
→ 继续保留未修改的 V1 source
→ 必要时从已验证备份恢复到新的隔离位置
→ 核对 upload manifest
```

禁止用以下方式回滚：

- `git reset --hard`；
- 删除或覆盖唯一数据库；
- 覆盖上传目录；
- 批量删除 V2 表而无验证备份；
- 修改 revision 伪装回退；
- 丢弃失败证据后重新运行。

Switch 后的业务回滚必须另行设计双读/兼容写路径和切换记录，不属于 dry-run 自动能力。

## 12. 验收 Fixture 矩阵

实现 dry-run 时至少覆盖：

| Fixture | 预期 |
|---|---|
| 空 V1 Snapshot | 可映射；projection revision 保留 |
| 单 pending task，无附件 | 无损映射，缺失新字段按冻结 legacy 规则处理 |
| 单任务 session | `single` + 一个 binding |
| 多任务 session | `grouped_unallocated` + 稳定 bindings；无单任务时长 |
| 多任务 session round-trip | ID、顺序、date/time/place/note 全等 |
| Snapshot 扩展视频 subtype | 不被当前 request validator 范围误删 |
| task status completed，无事件 | 不创建伪 production events/训练样本 |
| task 缺时间戳 | 稳定 issue；不写迁移时间 |
| products 含孤立项/重复项 | 兼容投影完整保留或明确阻断 |
| session 引用未知 task | `INVALID_SOURCE` |
| 未映射 place | `BLOCKED_MAPPING` |
| 时区 DST 歧义/不存在时间 | `INVALID_LOCAL_TIME`，不猜测 |
| 一 task 多 request operation | `INVALID_SOURCE` |
| task asset 与 uploads 一致 | PASS |
| claimed upload 缺 task asset | `INVALID_SOURCE` |
| asset metadata/hash 不一致 | `INVALID_SOURCE` |
| 文件在 hash 时变化 | 非 Switch-ready |
| 重复 dry-run | 相同 digest、计数和 revision proposal |
| verify-only target 重复记录 | `INVALID_TARGET` |
| V1 round-trip 差异 | `ROUND_TRIP_MISMATCH` |
| root/task/session/request/asset 额外属性 | strict-write 拒绝；可精确保留且不参与领域语义时 legacy-read 分类 L1 |
| 非法 status/source/time/date/timestamp/revision | 按 ADP-020 分类 L2/L3；不得静默清洗 |
| Submission 额外属性、长度、空白文本、条件组合 | strict-write 拒绝且零写入 |
| managed upload 双向一致 | PASS，按 claimed/legacy order 恢复 V1 assets |
| upload owner 或 metadata/hash 不一致 | `INVALID_SOURCE` |
| claimed upload 未出现在 task assets | `INVALID_SOURCE` |
| staged tombstone 或文件缺失 | `STAGED_UPLOAD_RECOVERY_REQUIRED` / `UPLOAD_FILE_MISSING` |

## 13. 完成标准

dry-run 规范进入实现的条件：

- Current → V2 映射中的所有必填阻断都有冻结处理；
- V2 Schema 和 validator 存在，或工作明确限定为 WO-00 mapping-only；
- CLI 没有隐式 source/target/production 默认值；
- source、target、upload root 的读写边界可测试；
- 报告满足最小披露；
- multi-task、revision、附件、round-trip、幂等和恢复均有负向 Fixture；
- 未执行真实迁移、生产读取、附件变更或外部调用。
