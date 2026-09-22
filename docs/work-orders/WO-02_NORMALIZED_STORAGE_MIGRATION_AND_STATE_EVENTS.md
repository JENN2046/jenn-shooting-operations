# WO-02：规范化存储、迁移证明与状态事件

- 状态：`PASS_WITH_LIMITS`（WO-02A / 02B / 02C / 02D 均已通过各自受限验收）
- 执行分支：`codex/v2-1-architecture-freeze`
- 架构基线：`JSO-ARCH-V2.1-R3`
- 前置门：WO-00 `PASS`、WO-01 `PASS`
- 范围：单调 SQLite Schema migration、V1→V2 只读 dry-run/verify、临时 fixture 隔离 apply/rollback proof、Production Run/Event、三 revision 与事务内 V1/V2 投影
- 明确不包含：生产数据库、在线 apply、Switch、部署、真实外部调用、Kiosk HTTP/UI、钉钉 Outbox、Agent Proposal、V1 PUT Adapter

## 1. 绑定决定

- ADP-017：`scheduleRevision / runRevision / projectionRevision` 三域必须在同一写事务检查与推进；
- ADP-018：多任务时间块保留为 `grouped_unallocated`，不得拆分或制造单任务时长；
- ADP-019：`requests_v2` 是 canonical work identity；Request/Schedule/Run 生命周期分离；
- ADP-020：统一 validator、L0–L3、正式 legacy fragment、严格 round-trip 与幂等；
- Migration Dry-run Spec：source 显式、只读、`query_only`、低披露报告、无隐式生产默认；
- Implementation Style Guardrails：普通 ESM + 显式 SQL，不引入 ORM 或逐表 Repository/Service/Manager 样板。

## 2. 分批顺序

### WO-02A：Schema migration foundation

状态：`PASS_WITH_LIMITS`

交付：

- `schema_migrations` 单一版本权威与 checksum divergence 检测；
- 显式、单调、事务化 V2 DDL；
- 规范化核心表、revision counters、projection、migration batch 与 fragment 表；
- `uploads.claimed_order` nullable 兼容列和索引；
- 当前四张 V1 表与数据保持不变；
- 仅临时/内存数据库测试，不接触现有数据库。

门禁：

- migration 列表必须是连续前缀，hole、未知高版本、name/checksum drift、半成品结构均失败关闭；
- 每个未应用 migration 使用独立 `BEGIN IMMEDIATE`；失败回滚且不写 marker；
- Schema migration 不增加任何业务 revision；
- read-only 路径不得运行 DDL、cleanup recovery 或目录创建；
- 不用 `IF NOT EXISTS` 掩盖除首次 marker bootstrap 之外的结构漂移。

### WO-02B：Dry-run and verify-only

状态：`PASS_WITH_LIMITS`（只读迁移证明；不等于 Switch-ready）

交付：

- `scripts/migrate-v1-to-v2.mjs` 薄 CLI；
- 显式 source、timezone、resource map 与 upload root；
- SQLite `readOnly + PRAGMA query_only=ON + BEGIN` 稳定读取；
- 纯内存映射、L1 fragment 物化、V1/V2 投影、round-trip、附件 manifest 与幂等模拟；
- 低披露 text/json 报告与稳定 exit code；
- `--verify-only` 只读核验隔离 target 的规范化事实，不补写；由于不核验 apply proof seal，成功状态仅为
  `TARGET_FACTS_VERIFIED_UNSEALED`，并保持 `INVALID_TARGET / exit 5 / Switch BLOCKED`；
- source、target、附件和报告路径的 realpath/inode/symlink 边界测试。

门禁：

- 不读取 `.env` 或隐式 `DATABASE_PATH`；
- L2/L3、缺失必需 V2 事实、DST 歧义、资源未映射、附件不一致均不得静默修复；
- V1 `task.source` 缺失时报告 `UNKNOWN_REQUIRED_V2_FIELD`，不猜 `workbench/import`；
- source DB bytes/stat/sidecar 集合前后不变；
- 报告不输出业务正文、附件名、绝对路径、hash 原值、SQL、stack 或环境变量；
- 本批不提供 `--apply` 写能力。

### WO-02C：Production run/event and materialized projections

状态：`PASS_WITH_LIMITS`（API-free use case；HTTP/Kiosk 尚未接入）

交付：

- Production Run/Event 表与 append-only event 约束；
- run event application use case，检查 `eventId + payload digest + expectedRunRevision`；
- 同 run 并发只有一个成功，重放不二次计时；
- `runRevision + projectionRevision` 同事务推进，`scheduleRevision` 不变；
- V1/V2 projection payload 与 counters 同事务提交；
- start/block/resume/complete/cancel 净工时；未闭合 block 不生成最终净工时；
- grouped block complete 不自动 fulfill 每个 request，也不生成 task-level training sample。

边界：

- WO-02C 只提供 API-free store/use-case 接缝，HTTP 与 Kiosk 留给 WO-03；
- correction 的 payload、review disposition 与 revision 语义尚未完全冻结，本批不发布 correction 命令；
- 新 V2 request 的 `client/legacyDeliverText` 推导与新 schedule 的持久化 resource catalog 不在本批猜测；只处理已规范化、可验证事实。

### WO-02D：Isolated apply and rollback proof

状态：`PASS_WITH_LIMITS`（仅临时 fixture + 全新隔离路径；不等于真实库或 Switch-ready）

只有 02A–02C 通过后进入。交付：

- 显式不存在或同 batch 已完成的隔离 target；
- verified backup、恢复到新隔离路径与 integrity/digest/count 对照；
- `--acknowledge-isolated-target` 与离线维护确认门；
- 单事务 facts/counters/projections/batch marker apply；
- 失败 target 保留证据，不删除、不覆盖、不自动重来；
- generic `--verify-only` 不声明 seal 完整性；只有 `--apply` 对既有相同 batch target 完成
  backup、rollback 与 proof seal 全链复核后，才只读返回 `ALREADY_APPLIED_VERIFIED`。

本工作包不授权生产 apply、在线 apply、Switch 或部署。

## 3. Schema 边界

WO-02A 至少冻结：

```text
schema_migrations
migration_batches
revision_counters
product_catalog_entries
requests_v2
schedule_items
schedule_item_tasks
legacy_asset_entries
legacy_compat_fragments
production_runs
production_events
snapshot_projections
```

现有表继续保留：

```text
schedule_state
operations
audit_log
uploads
```

`notification_outbox`、`scheduling_proposals` 和 `scheduling_config_versions` 留给对应后续工作包，不提前冻结未实现字段面。

SQLite CHECK/FK/UNIQUE 负责行内和静态约束；以下必须由同事务应用规则负责：

- grouped/single binding cardinality 与连续顺序；
- 同资源区间冲突；
- run scope 与 schedule allocation/binding 一致；
- 跨表 managed/legacy asset ID/order、hero owner/kind；
- 业务 revision 恰好增加一次及失败/重放零消耗；
- event fold、净工时与未闭合 block；
- projection JSON 与规范化事实/counters 等价；
- V1 round-trip、L1 envelope 与 optional presence。

## 4. 实施所有权

| 轨道 | 独占范围 | 目标 |
|---|---|---|
| Schema | `src/sqlite-schema-v2.mjs`、Schema migration tests、最小 `store.mjs` 接入 | 单调、幂等、漂移失败关闭 |
| Migration proof | migration CLI/module/tests/非敏感 fixture | dry-run、verify-only、只读与低披露 |
| Run events | V2 store/use-case、event/net-time tests | scoped revision、事件幂等、事务投影 |
| Commander | 工作包、交叉集成、回归、独立复核与分批提交 | 守住 frozen decisions 与非范围 |

各轨道不得同时编辑 `store.mjs`；由 Commander 串行整合。

## 5. 总验收门

- [x] 当前 V1 表、数据、上传清理与崩溃恢复回归不变；
- [x] Schema migration 重跑幂等，漂移/半成品/高版本失败关闭；
- [x] source dry-run 全程只读且无隐式路径；
- [x] single/grouped、products 顺序、optional presence、L1 fragments 精确 round-trip；
- [x] migration bootstrap 为 source projection revision + schedule revision 0 + 零 run/event；
- [x] verify-only 对 partial/mismatch/extra rows失败关闭；
- [x] 事件重放、非法转换和 revision 冲突零重复事实、零多余 revision；
- [x] run event 不改变 schedule revision；
- [x] V1/V2 投影与事实、revision 在同一事务可见；
- [x] rollback 在新隔离路径验证，不覆盖 source/upload；
- [x] `npm run check`、WO-00 validator、migration targeted tests、audit 与独立复核通过；
- [x] 无生产读取/写入、外部调用、Switch 或部署。

## 6. 当前阻塞与处理

- VCP Adapter 缺失：继续只阻断 Switch，不影响本工作包的本地受限结论；
- 真实 `businessTimeZone`、resource map、附件 manifest：作为未来真实离线预检输入，不在代码中猜测；
- 已完成的 backup/restore/apply 证明只适用于独占临时 fixture 与全新隔离路径；现有业务库、生产库和真实上传卷仍未授权、未读取、未写入；
- 跨进程 migration/upload 协调未证明：在线 apply 继续关闭；
- correction、新 V2 request 的 V1 兼容文本、新 schedule resource catalog：不猜测，留待相应冻结决定或后续工作包。

## 7. 当前验证证据

```text
Schema migration targeted: 28/28 PASS
Migration / recovery / materialization / isolated apply targeted: 85/85 PASS
Production run/event targeted: 18/18 PASS
npm run check: 190 tests / 189 PASS / 1 expected VCP adapter SKIP / 0 FAIL
WO-00 fixture validator: 13/13 PASS
npm audit --omit=dev: 0 vulnerabilities
git diff --check + untracked whitespace scan: PASS
Independent final review: PASS_WITH_LIMITS / 0 Critical / 0 Major
```

边界证据：

- Schema 首次初始化、V1-only、partial-prefix 和双 Store 首开均使用真实独立进程验证；
- dry-run 观测主库及 WAL/SHM/journal family，真实并发 writer 会失败关闭；
- verify-only 做规范化事实、batch ownership、V1/V2 重投影和 T1 apply / T2 verify 时间语义核验；
- 附件 manifest 支持 no-files、fast size/stat 和 full hash，只读且低披露；
- staged cleanup tombstone 会以 `STAGED_UPLOAD_RECOVERY_REQUIRED` 失败关闭；附件读取使用
  `O_NOFOLLOW + fstat + same-descriptor hash`，拒绝 symlink swap；
- run event 的事实、revision、双投影、append-only receipt digest 与 audit 同事务提交，失败整体回滚；
- operation 与 audit 同时被伪造时，receipt replay 仍由 append-only event 失败关闭；
- isolated `--apply` 在独占临时 fixture 中完成 verified backup、全新 rollback restore、单事务 facts materialization、post-verify 与 proof seal；既有 target 只允许同一 `--apply` 全链只读重证；
- generic `--verify-only` 只证明 target facts，固定返回 unsealed/blocked，不得替代 proof seal；
- 真实库 apply、报告文件写入、HTTP/Kiosk、Switch、部署与生产读取/写入仍未开放。

终审保留限制：

- overlap 扫描对嵌套区间可能少计冲突对数，但至少一个冲突仍会阻断 Switch；
- compatibility table DDL 刻意绑定 canonical V1 形态；任何真实库工作仍必须另行离线预检与授权；
- 当前通过范围不含现有/生产数据库、真实上传卷、在线协调、Switch、部署或发布。

## 8. 退出结论

结论：`PASS_WITH_LIMITS`。四个子批次均已通过各自受限验收；本结论只覆盖本地 fixture、隔离路径与 API-free 证明，不等于 Switch-ready、deploy-ready 或 production-ready。
