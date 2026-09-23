# WO-04：钉钉 Outbox 与适配器

- 状态：`IN_PROGRESS / WO-04A ARCHITECTURE_FROZEN`
- 执行分支：`codex/v2-1-architecture-freeze`
- 前置门：WO-00 `PASS`、WO-01 `PASS`、WO-02/03 `PASS_WITH_LIMITS`
- 冻结决定：`ADP-022_TRANSACTIONAL_OUTBOX_AND_DINGTALK_BOUNDARY.md`、`ADP-023_OUTBOX_IDENTIFIER_COMPATIBILITY.md`
- 范围：本地 schema、纯卡片、Outbox repository/dispatcher、显式 Mock、unconfigured adapter、无网络 callback admission framework、已有权威命令 producer
- 非范围：真实钉钉调用/SDK/凭据、环境配置、callback endpoint、服务启动、部署、生产数据、V1/V2 Switch、补造 canonical request/schedule command

## 1. 分批顺序

### WO-04A：Architecture、Schema 与 Policy Freeze

状态：`ARCHITECTURE_FROZEN / SCHEMA_IMPLEMENTATION_PENDING`

交付：

- ADP-022 独立复核与冻结；
- `notification_outbox` migration v4；
- 状态约束、immutable identity、terminal seal、索引和 schema drift 测试；
- `outbox-dispatch-v1` retry/lease/batch/poll policy；
- 三类 intent/card DTO 与最小披露测试；
- producer admission matrix。

### WO-04B：Repository、Dispatcher 与 Adapter Boundary

状态：`NOT_STARTED`

交付：

- 小型 SQLite Outbox adapter；
- transaction-bound enqueue；
- 短事务 claim / 锁外 send / 短事务 settle；
- lease recovery、有限 retry/deadLetter、busy backoff；
- `DingTalkPort`、unconfigured adapter 和显式 Mock；
- 全部测试无网络、无真实等待、无环境凭据。

### WO-04C：Transactional Producers

状态：`NOT_STARTED`

交付边界：

- `production-run.completed.v1` 接入 Kiosk/generic run complete 的现有 V2 事务，作为唯一可安全进行本地事务性 Outbox 接入的 producer；
- request/schedule builder 完成，但 producer 保持 `NOT_WIRED`；
- 不从 V1 Snapshot diff 或提交后扫描补造通知；
- 后续 canonical request/schedule command 建立后再接同事务 producer。

### WO-04D：Callback Admission Skeleton

状态：`NOT_STARTED`

交付：

- verifier/principal/action registry ports；
- `CallbackReplayStorePort` 契约与显式 fake；
- raw callback 不出 verifier 边界；
- unconfigured、伪造、过期、duplicate-key、nonce replay、未知动作失败关闭测试；
- enabled action allowlist 为空，不注册 HTTP route，不执行真实领域写入。
- runtime 持久 replay store 与 callback receipt 保持 `NOT_WIRED`；fake 测试不构成跨进程/重启后的持久重放保护。

### WO-04E：Regression and Independent Review

状态：`NOT_STARTED`

门禁：

- [ ] 默认测试无 DNS/HTTP/真实 provider；
- [ ] migration、fixtures、V1/Kiosk/upload cleanup 回归全绿；
- [ ] slow adapter 不持有 SQLite 写锁；
- [ ] adapter 失败不回滚已提交业务事实；
- [ ] exact replay 不新增 Outbox 或重复已确认发送；
- [ ] Outbox 状态不消费任何业务 revision；
- [ ] 数据库、日志和测试输出无禁止信息；
- [ ] request/schedule producer 明确 NOT_WIRED；
- [ ] isolated migration target 的 `notification_outbox` 存在且为空，不迁移或补发历史通知；
- [ ] Dispatcher 不使用 flock、lockfile、rename lease、shell 或 `/tmp` 假设；
- [ ] Windows Node 24 targeted migration/dispatcher tests PASS，或记录 `WINDOWS_NOT_RUN` 且不宣称 Windows-ready；
- [ ] 独立审查无 Critical/Major；
- [ ] 未宣称 exactly-once、真实联调、部署或 production-ready。

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

## 4. 当前结论

WO-04A 架构已冻结，migration v4 与实现仍待完成。当前唯一可安全进行本地事务性 Outbox 接入的 producer 是 V2 Production Run complete；request/schedule 只冻结卡片与 enqueue contract，不伪造事务接入。此状态不代表钉钉可用、真实通知已发送、Windows 已验证或生产配置已完成。
