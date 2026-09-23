# WO-04：钉钉 Outbox 与适配器

- 状态：`PASS_WITH_LIMITS / LOCAL_ONLY`
- 执行分支：`codex/v2-1-architecture-freeze`
- 前置门：WO-00 `PASS`、WO-01 `PASS`、WO-02/03 `PASS_WITH_LIMITS`
- 冻结决定：`ADP-022_TRANSACTIONAL_OUTBOX_AND_DINGTALK_BOUNDARY.md`、`ADP-023_OUTBOX_IDENTIFIER_COMPATIBILITY.md`
- 范围：本地 schema、纯卡片、Outbox repository/dispatcher、显式 Mock、unconfigured adapter、无网络 callback admission framework、已有权威命令 producer
- 非范围：真实钉钉调用/SDK/凭据、环境配置、callback endpoint、服务启动、部署、生产数据、V1/V2 Switch、补造 canonical request/schedule command

## 1. 分批顺序

### WO-04A：Architecture、Schema 与 Policy Freeze

状态：`PASS`

交付：

- ADP-022 独立复核与冻结；
- `notification_outbox` migration v4；
- 状态约束、immutable identity、terminal seal、索引和 schema drift 测试；
- `outbox-dispatch-v1` retry/lease/batch/poll policy；
- 三类 intent/card DTO 与最小披露测试；
- producer admission matrix。

### WO-04B：Repository、Dispatcher 与 Adapter Boundary

状态：`PASS`

交付：

- 小型 SQLite Outbox adapter；
- transaction-bound enqueue；
- 短事务 claim / 锁外 send / 短事务 settle；
- lease recovery、有限 retry/deadLetter、busy backoff；
- `DingTalkPort`、unconfigured adapter 和显式 Mock；
- 全部测试无网络、无真实等待、无环境凭据。

### WO-04C：Transactional Producers

状态：`PASS_WITH_LIMITS / PRODUCTION-RUN COMPLETE ONLY`

交付边界：

- `production-run.completed.v1` 接入 Kiosk/generic run complete 的现有 V2 事务，作为唯一可安全进行本地事务性 Outbox 接入的 producer；
- request/schedule builder 完成，但 producer 保持 `NOT_WIRED`；
- 不从 V1 Snapshot diff 或提交后扫描补造通知；
- 后续 canonical request/schedule command 建立后再接同事务 producer。

### WO-04D：Callback Admission Skeleton

状态：`PASS / LOCAL SKELETON ONLY`

交付：

- verifier/principal/action registry ports；
- `CallbackReplayStorePort` 契约与显式 fake；
- raw callback 不出 verifier 边界；
- unconfigured、伪造、过期、duplicate-key、nonce replay、未知动作失败关闭测试；
- enabled action allowlist 为空，不注册 HTTP route，不执行真实领域写入。
- runtime 持久 replay store 与 callback receipt 保持 `NOT_WIRED`；fake 测试不构成跨进程/重启后的持久重放保护。

### WO-04E：Regression and Independent Review

状态：`PASS_WITH_LIMITS`

门禁：

- [x] 默认测试无 DNS/HTTP/真实 provider；
- [x] migration、fixtures、V1/Kiosk/upload cleanup 回归全绿；
- [x] slow adapter 不持有 SQLite 写锁；
- [x] adapter 失败不回滚已提交业务事实；
- [x] exact replay 不新增 Outbox 或重复已确认发送；
- [x] Outbox 状态不消费任何业务 revision；
- [x] 数据库、日志和测试输出无禁止信息；
- [x] request/schedule producer 明确 NOT_WIRED；
- [x] isolated migration target 的 `notification_outbox` 存在且为空，不迁移或补发历史通知；
- [x] Dispatcher 不使用 flock、lockfile、rename lease、shell 或 `/tmp` 假设；
- [x] Windows 状态明确记录为 `WINDOWS_NOT_RUN`，不宣称 Windows-ready；
- [x] 独立审查无 Critical/Major；
- [x] 未宣称 exactly-once、真实联调、部署或 production-ready。

## 2. 文件所有权

| 轨道 | 范围 |
|---|---|
| Architecture/Schema | ADP-022、work order、`sqlite-schema-v2`、schema tests |
| Cards/Security | pure card/intents、adapter contract、callback admission、negative tests |
| Dispatcher | outbox SQLite adapter、dispatcher/policy、concurrency tests |
| Producer | run complete transaction integration、producer tests |
| Commander | 共享文件串行整合、回归、独立终审、提交与交付边界 |

## 3. 停止条件

- 需要读取/修改 `.env`、token、credential、cookie 或 provider/auth runtime config；
- 需要真实钉钉/DNS/HTTP、真实 callback、服务启动或外部通知；
- 要求从 V1 Snapshot diff 猜测 schedule confirm 或把 Outbox 当事实源；
- 网络调用进入业务事务或 Dispatcher 长时间持有写锁；
- retry 无上限、Mock 自动启用、provider raw response 被保存；
- callback 绕过 trusted mapping/capability/revision；
- 实现需要部署、Switch、生产数据或新增真实业务权限。

## 4. 验收证据

- migration v4、历史 migration checksum pin、partial/drift/unknown-object 失败关闭测试通过；
- Outbox enqueue/claim/settle、双连接 lease 排他、第 5 次失败终止、过期最终 lease 限批清理通过；
- 最多 8 条发送在 SQLite 锁外并发，slow adapter 期间第二连接仍可完成前台写入；
- settlement 使用临时 `PRAGMA busy_timeout = 100`，结束后恢复连接原值；`STORE_BUSY` 只重试 settlement，不重复 provider send；
- worker stop 等待当前有界 settlement，停止后不再 claim；
- generic/Kiosk `complete` 与业务事实、revision、projection、receipt、audit、Outbox 同事务，enqueue 失败整体回滚，exact replay 不新增记录；
- callback raw bytes 仅进入 verifier；duplicate key、伪造/过期、未知 principal/action、nonce replay 均失败关闭；默认 action allowlist 为空，持久 replay store、HTTP route 与领域动作未接入；
- 本地全量 `npm run check` 与两轮独立审查通过；最终审查为 `0 Critical / 0 Major`。

## 5. 当前结论

WO-04 的本地实现与防御性验收完成，状态为 `PASS_WITH_LIMITS / LOCAL_ONLY`。当前唯一接入事务性 Outbox 的 producer 是 V2 Production Run complete；request/schedule producer、真实 DingTalk adapter/SDK/credential、callback HTTP endpoint、verified provider port、持久 callback replay/receipt、非空 callback action、运行时启停接线与部署均保持 `NOT_WIRED`。投递语义仍是至少一次，不是 exactly-once。Windows 本机验证未执行，记录为 `WINDOWS_NOT_RUN`，因此不宣称 Windows-ready、真实联调完成、部署就绪或 production-ready。
