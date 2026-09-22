# WO-02D Isolated Apply Safety Contract V2.1

- 状态：`Frozen`
- 决策日期：2026-09-22
- 架构基线：`JSO-ARCH-V2.1-R3`
- 适用范围：WO-02D 的临时 fixture 与全新隔离路径
- 不授权：真实库、生产库、在线 apply、Switch、部署、发布或上传卷写入

## 1. 目的

本契约冻结 V1 → V2 隔离迁移的最后一个本地证明边界：先证明一致性备份可恢复，
再从该备份构造全新 target，最后以只读 post-verify / `verifyV2Target()` 复核。任何步骤失败都保留
artifact，不覆盖、不删除、不自动续跑。

本契约细化 Migration Dry-run Spec 第 3.3、11 节，不修改 ADP-017～020 的领域决定。

## 2. CLI 契约

`--apply` 必须同时提供：

```text
--apply
--fixture-root <existing absolute exclusive temp directory>
--source <existing absolute SQLite file>
--target <absolute isolated SQLite path>
--backup <absolute backup path>        # 首次 apply 必须新建；completed replay 只读复用
--rollback-target <absolute restore path> # 首次 apply 必须新建；completed replay 只读复用
--proof-seal <absolute proof path>     # 首次成功终检后新建；completed replay 只读复用
--business-time-zone <IANA>
--hash-uploads
--acknowledge-isolated-target
--acknowledge-offline-maintenance
```

有 session 时还必须提供 `--resource-map <versioned json>` 并关闭全部映射 blocker；有
`stored_name` 时还必须提供 `--upload-root <existing directory>`。无对应事实时允许省略，避免把
“条件需要”误写成无条件必需。

继续允许 `--source-label`、`--format text|json` 和 `--strict`。禁止：

- `--force`；
- 环境变量或默认 source/target/backup/rollback path；
- source 原地迁移；
- 一个确认开关同时表达“隔离目标”和“服务离线”；
- 把一次 acknowledgement 解释为未来持续授权。

`--rollback-target` 是 WO-02D 新增的冻结参数。它用于真实恢复演练，不是 apply 失败后
覆盖 source 的回滚目的地。

## 3. 运行范围

本工作包中的可执行 apply 仅允许测试创建的独占临时根目录：

- 根目录由测试使用 `mkdtemp` 新建；
- CLI 必须通过 `--fixture-root` 显式传入该目录；
- 目录必须位于操作系统真实 temp root 下，basename 以
  `jenn-shooting-migration-fixture-` 开头；
- fixture root 必须由当前 uid 拥有、mode 为 `0700`，运行前后 `dev + ino` 稳定；
- source、backup、rollback target、apply target、proof seal、upload root 与 resource map
  全部位于该根目录；
- source、resource map 和每个被读取的 attachment 必须是非 symlink、`nlink === 1` 的普通
  文件；不得通过 hardlink/symlink 把真实库或真实附件引入 fixture root；
- 所有写入路径在本次运行开始时均不存在；
- 不读取 `.env`、`DATABASE_PATH`、`BACKUP_DIRECTORY` 或 provider/runtime 配置。

普通共享目录、现有业务目录或真实附件目录上的 apply 保持关闭。仅有 CLI acknowledgement
不能技术上证明服务已经离线。

## 4. 路径与身份门禁

每个路径都必须为绝对路径。对新 artifact：

1. 解析已存在的真实 parent；parent 必须是非 symlink 目录；
2. 记录 parent `dev + ino`，操作前后复核；
3. final path、dangling symlink 与 `-wal/-shm/-journal` 必须不存在；
4. source、backup、rollback target、apply target、proof seal、upload root 与 resource map
   做规范路径与 inode 冲突检查；
5. 拒绝 hardlink、symlink、same-inode 与路径别名；
6. 使用 exclusive/no-follow 创建或 copy，文件权限为 `0600`；
7. 创建后必须是普通文件、非 symlink、`nlink === 1`，并复核 inode。

fixture root、source、upload root 与 resource map 的真实路径、owner/mode/device/inode 也属于
proof identity；任何阶段变化都失败关闭。

Node SQLite 按路径打开，无法完全消灭恶意 parent 替换竞态。因此本工作包只声称独占临时
目录下的本地证明；一般目录需要受控运维目录或未来 native `openat` 边界。

## 5. 备份与恢复证明

备份是 apply 的前置证明，不得沿用旧 `scripts/backup.mjs` 的 env/default/VACUUM-only 语义。

顺序固定为：

```text
read-only source + hashed upload manifest
→ exclusive SQLite backup
→ backup integrity/fingerprint verification
→ exclusive restore to rollback target
→ restored integrity/fingerprint verification
→ ROLLBACK_VERIFIED
→ create apply target
```

备份证据至少绑定：

- source schema digest、structural digest 与 Snapshot revision；
- Snapshot canonical digest；
- V1 表 row counts 与 audit count/min/max；
- backup artifact digest；
- hashed upload manifest digest；
- migration/spec/config/resource-map/time-zone version；
- `PRAGMA integrity_check = ok`。

source 数据库 family 与 hashed upload manifest 在 backup 前冻结为本次 proof identity。rollback
完成后、apply 前、commit 后和 post-verify 后都必须重新观测并与同一 identity 对照；任何变化都
停止并保留已创建 artifact。不得在中途用“重新扫描后的新 manifest”替换原 identity。
若变化发生在 commit 后，结果必须是 `COMMITTED_BUT_UNVERIFIED`，该 target 永远不得进入自动
复用分支。

恢复必须落到全新路径。恢复后的数据库必须与 backup/source 的上述逻辑证据一致，并重新通过
V1 legacy-read validator。恢复不覆盖 source、backup 或上传卷。

backup、rollback 与 completed target 在进入 verified 状态前必须：关闭所有 writable
connection，`fsync` 文件与 parent directory，确认 `-wal/-shm/-journal` 全部不存在，再重新以
read-only/query-only 打开执行 integrity/fingerprint。WAL source 只能通过 SQLite backup API
生成一致性 backup，禁止直接复制 main database file。

## 6. Target 状态机

### 6.1 首次创建

仅当 target 与全部 sidecar 均不存在、backup 与 rollback 均已验证时，才允许从 verified
backup exclusive copy 创建 target。

### 6.2 已存在 target

已存在 target 永远不进入写模式。该分支不再创建任何 artifact；显式 backup 与 rollback
target 必须已经存在，并分别以只读方式重新证明为同一 source/proof identity 的 verified
backup 与 restore；proof seal 也必须存在并验证通过。唯一允许的结果是：

- 同一 source/config/batch；
- completed marker；
- 完整 `verifyV2Target()` 通过；
- proof seal 精确绑定当前 target artifact digest、batch identity、backup proof identity、
  rollback proof identity 与冻结的 source/upload identity；
- 文件身份与 sidecar 集合前后不变；
- 返回 `ALREADY_APPLIED_VERIFIED`。

空文件、schema-only、partial migration、`applying`、`failed`、不同 batch、额外事实、损坏
projection 或任何 target/backup/rollback `-wal/-shm/-journal` sidecar 全部失败关闭，不补写、
不清空、不自动续跑。`journal_mode=DELETE` 的 completed proof 不允许保留 sidecar。

## 7. 写事务

Schema migration 保持现有“每个 migration 独立 `BEGIN IMMEDIATE`”语义。Schema 完成后，
全部 migration business facts 必须在一个 `BEGIN IMMEDIATE` 中提交：

1. 再次确认 V1 preserved facts 与 verified backup 一致；比较 uploads 时排除 V2 新增的
   `claimed_order`，但 V1 projection 必须保持精确等价；
2. 插入确定性 batch row，事务内状态从 `applying` 变为 `completed`；
3. 仅更新已保留 `uploads.claimed_order`，不改写其他 V1 行；
4. 写入 catalog、requests、schedule items、bindings、legacy assets/fragments；
5. 写入 revision counters，初值为 source projection revision / schedule revision 0；
6. 写入精确 V1/V2 projections；
7. 断言 production runs/events 为零且 V1 facts 未漂移；
8. 设置合法 `completed_at >= started_at` 后提交。

所有迁移生成的 `imported_at/created_at` 使用 batch `started_at`；事务内不得再次调用 clock。
固定 target 运行参数为 `journal_mode=DELETE`、`synchronous=FULL`。

## 8. Success proof seal

`completed` batch 本身不代表最终 proof 成功。只有在 writable connection 已关闭、target 已
`fsync`、post-verify 通过，并且最终 source family 与 full-hash upload manifest 仍等于冻结
identity 后，才允许 exclusive/no-follow 创建 proof seal。

seal 使用 canonical、低披露 JSON，至少包含：

```text
schemaVersion
migrationVersion
batchIdentity
targetArtifactDigest
backupProofIdentity
rollbackProofIdentity
sourceAndUploadIdentityDigest
verifiedAt
```

seal 必须以 `0600`、no-overwrite 创建，写入后 `fsync` seal 与 parent directory，再只读重开并
逐字段验证。不得包含绝对路径、业务正文、附件名、raw audit result、SQL、stack 或环境变量。

如果 post-verify、最终 identity 复核或 seal 创建/复核任一步失败，结果均为
`COMMITTED_BUT_UNVERIFIED`；target 保留且无有效 seal，existing-target 自动分支必须永久拒绝。
seal 缺失、损坏、重复、字段不匹配或 artifact digest 不匹配都不得通过后续只读重放。

## 9. 失败保全

一旦 backup、rollback 或 target artifact 被创建，失败时必须：

- 保留文件及 sidecar 作为证据；
- 不删除、不覆盖、不清空、不自动重命名；
- 不在回滚后另起事务伪造 `failed` batch；
- 返回低披露稳定错误码与 path digest；
- 后续同路径仅允许只读检查或人工处置。

业务事务失败应回滚全部 batch/facts/counters/projections/claimed-order 更新，但允许 target 保留
已完成的 Schema。commit 后 verify 失败记为 `COMMITTED_BUT_UNVERIFIED`，不得自动复用。

## 10. 稳定状态与错误码

成功状态：

```text
BACKUP_VERIFIED
ROLLBACK_VERIFIED
APPLIED_VERIFIED
ALREADY_APPLIED_VERIFIED
```

至少支持：

```text
ISOLATED_TARGET_ACK_REQUIRED
OFFLINE_MAINTENANCE_ACK_REQUIRED
HASH_UPLOADS_REQUIRED
ROLLBACK_TARGET_REQUIRED
DESTINATION_EXISTS
DESTINATION_SIDECAR_EXISTS
PATH_IDENTITY_CONFLICT
DESTINATION_PARENT_CHANGED
UNSAFE_DESTINATION
BACKUP_CREATE_FAILED
BACKUP_EVIDENCE_MISMATCH
BACKUP_NOT_VERIFIED
ROLLBACK_RESTORE_FAILED
ROLLBACK_EVIDENCE_MISMATCH
ROLLBACK_NOT_VERIFIED
TARGET_CREATE_FAILED
TARGET_APPLY_FAILED
TARGET_IDENTITY_CHANGED
SOURCE_CHANGED_DURING_APPLY
FAILED_TARGET_PRESERVED
COMMITTED_BUT_UNVERIFIED
PROOF_SEAL_REQUIRED
PROOF_SEAL_INVALID
```

确认/路径问题归类 `INVALID_USAGE`；source/backup/upload 问题归类 `INVALID_SOURCE`；restore/apply/
post-verify 问题归类 `INVALID_TARGET`。

## 11. 最低测试矩阵

- CLI 缺任一 flag/ack/hash、模式组合、重复/未知参数、`--force`；
- fixture root 的 temp containment、owner/mode/identity 漂移，以及 source/resource map/upload
  attachment 的 hardlink/symlink/nlink 边界；
- 四个数据库路径的 symlink/hardlink/same-inode/sidecar/parent 变化；
- WAL source 的一致性 backup、备份前后 source writer 变化；
- corrupt/truncated/非 SQLite backup 与证据字段逐项不匹配；
- rollback 首次恢复成功、existing/different target 拒绝、恢复中途失败保留；
- empty/single/grouped/L1/managed upload/legacy asset/operation preservation apply；
- target 抢占、schema migration、facts 中途、commit 前后、post-verify 前故障注入；
- 每个失败证明 source、backup、uploads 未改变，失败 target 保留，同路径重试拒绝；
- completed exact batch 重放只读，bytes/stat/sidecar/revisions 不变；
- commit 后故障、post-verify 失败与 seal 创建失败都不产生有效 seal；缺失/篡改 seal 的
  completed target 永远不得自动复用；
- 报告不包含绝对路径、业务正文、附件名、raw hash、audit result、SQL、stack 或 env。

## 12. 明确延后

- 在线 apply 与跨进程 upload/cleanup/migration 协调；
- 真实停机、process lock 或 maintenance lease；
- 现有/生产数据库与真实附件目录；
- partial target 自动恢复或失败 artifact 自动清理；
- Switch、部署、release、外部调用与真实通知；
- Switch 后双读/兼容写回滚。

WO-02D 通过仅代表“临时 fixture + 新隔离路径的 apply/rollback proof”通过，不代表
Switch-ready、deploy-ready 或 production-ready。
