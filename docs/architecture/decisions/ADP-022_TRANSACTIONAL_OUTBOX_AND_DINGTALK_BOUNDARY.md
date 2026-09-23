# ADP-022：Transactional Outbox and DingTalk Boundary

- 状态：`ACCEPTED / FROZEN_FOR_WO-04_LOCAL_IMPLEMENTATION`
- 日期：2026-09-22
- 决策范围：通知意图、Outbox schema/state machine、Dispatcher、DingTalk Port、最小披露卡片、callback admission、producer 接入边界
- 细化：ADP-004、ADP-006、ADP-010、ADP-011、ADP-014、ADP-016、ADP-017
- 不替代：事实源、revision、权限、迁移或生产授权决定

> 本决定只约束本地实现。它不授权真实钉钉网络、凭据、callback endpoint、生产数据、服务启动、Switch、部署或发布。

## 1. 背景与当前事实

WO-04 要提供新需求、排期确认和拍摄完成三类通知，但当前代码并不具备三条等价的 canonical V2 写链：

- `store.submitRequest` 仍是 V1 Snapshot 兼容事实路径，不创建 canonical `requests_v2`；
- `replaceSnapshot` 是 V1 整包替换，不是“排期确认”命令，不能从 diff 猜测业务意图；
- Production Run `complete` 已有完整 V2 `BEGIN IMMEDIATE`、revision、projection、receipt 和 audit 事务。

因此 WO-04 可以冻结并实现三类卡片投影，但 producer 只能加入真实权威命令的现有事务。不得通过提交后扫描、Snapshot diff、轮询数据库或补写脚本伪造 notification intent。

## 2. 继承的不变量

1. SQLite 业务事实仍是唯一事实源；Outbox 只是待交付副作用记录；
2. 业务事实、revision、projection、Outbox 和 audit 必须在同一业务事务提交；
3. 网络调用不得位于 SQLite 事务内；
4. Outbox 状态变化不得增加 `scheduleRevision`、`runRevision` 或 `projectionRevision`；
5. Outbox 使用独立 `dedupeKey`，不复用业务 operation/event ID 的权威语义；
6. 只保证至少一次投递；lost response 可能造成外部重复，不能宣称 exactly-once；
7. 真实配置缺失必须返回 `DINGTALK_NOT_CONFIGURED`，不得静默切换 Mock；
8. 不保存 token、cookie、Authorization、完整 Brief、附件内容/原名、原始 callback 或 provider raw response；
9. 钉钉不能成为 SSOT，也不能绕过 trusted principal、capability、revision 或 idempotency；
10. 所有真实外部调用和配置仍是独立授权门。

## 3. Notification Intent 与 Producer 规则

业务事务写入的是版本化 notification intent，而不是 provider-specific card JSON：

```text
request.submitted.v1
schedule.confirmed.v1
production-run.completed.v1
```

每条 intent 固定包含：

```text
outboxId
dedupeKey
intentType
aggregateType
aggregateId
routeKey
aggregateRevisionScope
aggregateRevision
cardSchemaVersion
deliveryPolicyVersion
payloadJson
payloadDigest
createdAt
```

规则：

- `routeKey` 是不含凭据的逻辑路由名，并一一映射到 SQLite `route_key`；webhook/token 不得入库；
- payload 使用 UTF-8、递归 key 排序、拒绝非有限数字的共享 canonical JSON 实现后计算 SHA-256；
- `dedupeKey` 固定为 `dingtalk:<cardSchemaVersion>:<intentType>:<aggregateType>:<aggregateId>:<revisionScope>:<revision>`；
- `dedupeKey` 冲突时，只有 intent/aggregate/route/payload digest 全部一致才是 exact no-op；否则返回 `OUTBOX_DEDUPE_MISMATCH` 并使业务事务失败关闭；
- 幂等业务 replay 不新增 Outbox，不改变已有投递状态；
- 业务命令失败、业务 no-op、rollback 或 review-pending 不产生完成通知。

### 3.1 当前 producer admission

| Intent | 卡片契约 | 当前权威业务 producer | WO-04 接入决定 |
|---|---|---|---|
| `production-run.completed.v1` | 实现 | V2 run-event `complete` | 可以加入同一事务 |
| `request.submitted.v1` | 实现 | 只有 V1 Snapshot submission | 暂不接入；等待 canonical request command 或单独兼容 producer 决策 |
| `schedule.confirmed.v1` | 实现 | 不存在 canonical confirm command | 暂不接入；禁止从 V1 replaceSnapshot diff 猜测 |

卡片契约可完成不等于对应业务 producer 已接通。验收报告必须分别标记。

## 4. `notification_outbox` Schema

Schema migration 新增一张严格表：

```text
notification_outbox
  outbox_id                TEXT PRIMARY KEY
  channel                  TEXT NOT NULL, dingtalk
  dedupe_key               TEXT UNIQUE NOT NULL
  intent_type              TEXT NOT NULL
  aggregate_type           TEXT NOT NULL
  aggregate_id             TEXT NOT NULL
  aggregate_revision_scope TEXT NOT NULL
  aggregate_revision       INTEGER NOT NULL
  route_key                TEXT NOT NULL
  card_schema_version      TEXT NOT NULL
  delivery_policy_version  TEXT NOT NULL
  payload_json             TEXT NOT NULL, json_valid
  payload_digest           TEXT NOT NULL
  status                   pending | leased | sent | retryableFailed | deadLetter
  attempt_count            INTEGER NOT NULL
  available_at             TEXT NULL
  lease_token              TEXT NULL
  lease_owner              TEXT NULL
  lease_expires_at         TEXT NULL
  provider_ref             TEXT NULL
  delivery_receipt_digest  TEXT NULL
  last_error_code          TEXT NULL
  created_at               TEXT NOT NULL
  updated_at               TEXT NOT NULL
  sent_at                  TEXT NULL
) STRICT
```

数据库约束与触发器必须保证：

- `channel = dingtalk`，`intent_type`、`aggregate_type`、`aggregate_revision_scope`、`status` 和 `last_error_code` 均为冻结枚举；
- `aggregate_revision`、`attempt_count` 是 `0..Number.MAX_SAFE_INTEGER`；本地 policy 另将领取尝试限制为 5；
- `payload_digest` 和非空 `delivery_receipt_digest` 必须是 `sha256:<64 lowercase hex>`；
- identity、dedupe、intent、aggregate/revision、route、card/policy version、payload/digest、createdAt 不可修改；
- `attempt_count` 单调；
- `sent` 和 `deadLetter` 为终态，本工作包没有 requeue/delete；
- 合法迁移仅为：`pending` 且 attempt 为 0、已到 `available_at` 时领取为第 1 次 `leased`；`retryableFailed` 已到期且 attempt 小于 5 时递增并转 `leased`；过期 `leased` 且 attempt 小于 5 时递增并换 token；`leased → sent`；retryable result 在 attempt 小于 5 时 `leased → retryableFailed`，在 attempt 等于 5 时直接 `leased → deadLetter` 并保留稳定 provider error；non-retryable result 直接 `leased → deadLetter`；过期 `leased` 且 attempt 等于 5 时以 `OUTBOX_DELIVERY_OUTCOME_UNKNOWN` 进入 `deadLetter`；
- `leased` 必须有 token/owner/expiry；非 leased 不得保留 lease；
- `pending` 必须 attempt 为 0、有 `available_at`，且无 lease/provider/error/sent 字段；
- `leased` 必须 attempt 至少为 1，清空 `available_at`，且无 provider/error/sent 字段；
- `retryableFailed` 必须有冻结的 retryable error 和下一次 `available_at`，且无 lease/provider/sent 字段；
- `sent` 必须有低披露 providerRef、delivery receipt digest、sentAt，清空 `available_at`，且无 lease/error；
- `deadLetter` 必须有冻结 error code，清空 `available_at`，且无 lease/provider/sent 字段；
- `provider_ref` 限长、禁止控制字符，并建立非空唯一索引；非 `sent` 的 provider/receipt/sent 字段必须为空；
- failed/deadLetter 必须有稳定 error code，不能保存 message/stack/raw response；
- `delivery_receipt_digest` 只可由 allowlisted adapter result 的 `outboxId/dedupeKey/payloadDigest/attemptCount/providerRef/sentAt` canonical projection 计算；
- 表的 lease/retry 状态不触发任何业务 revision。

索引至少覆盖：

```text
(status, available_at, created_at, outbox_id)
(status, lease_expires_at)
```

## 5. Outbox Local Policy V1

首版冻结为版本化实现常量，不构成生产调优结论：

```text
policyVersion        = outbox-dispatch-v1
batchSize            = 8
leaseDurationMs      = 30_000
deliveryTimeoutMs    = 8_000
maxAttempts          = 5
retryBaseDelayMs     = 2_000
retryMaxDelayMs      = 300_000
retryJitterRatio     = 0.25
idlePollMs           = 2_000
idlePollJitterRatio  = 0.25
busyBaseDelayMs      = 250
busyMaxDelayMs       = 2_000
resultBusyTimeoutMs  = 100
resultRetryMs        = [50, 100, 200]
```

退避为 `min(base * 2^(attempt-1), max)` 后施加注入式 deterministic jitter。测试必须注入 clock/random，不能依赖真实等待。

## 6. Dispatcher 状态机

一次 dispatch 固定分三段：

```text
短 BEGIN IMMEDIATE：领取有限批次、写 lease、attempt + 1
COMMIT
锁外：调用 DingTalkPort
短 BEGIN IMMEDIATE：按 lease owner 写 sent / retryableFailed / deadLetter
COMMIT
```

领取顺序为 `availableAt, createdAt, outboxId`。只有 attempt 为 0 且已到期的 `pending`、已到期且 attempt 小于 5 的 `retryableFailed`、过期且 attempt 小于 5 的 `leased` 可领取。第 5 次 retryable result 必须直接进入 `deadLetter`，任何 clock 推进都不得产生第 6 次 claim。

- DB busy 使用有上限退避，并优先让前台业务写入；
- 空队列不高频抢写锁；
- shutdown 后不领取新消息；in-flight 结果仍可做一次有界回写；
- 结果回写必须同时匹配 `outboxId + leaseToken`；旧 worker 或仅 owner 相同的旧 lease 不能覆盖新 worker；
- attempt 在 claim 时递增，因此 crash-before-send 也保守消耗一次 attempt；
- 最终 attempt 的 lease 若因崩溃过期，下一次维护将其清除 lease 后置 `deadLetter`，稳定码为 `OUTBOX_DELIVERY_OUTCOME_UNKNOWN`；该名称承认进程可能在发送前或 provider 接受后崩溃，不能伪称确定失败；
- 新记录可触发进程内 wake signal，但 signal 不是持久事实；
- 外部 lost response 仍属于至少一次语义，provider adapter 应在支持时传递 dedupeKey。

## 7. DingTalkPort 与显式 Mock

Port 只接受受控 card DTO，并提供不产生投递尝试的 readiness：

```text
readiness()
  → { ok: true }
  → { ok: false, code: DINGTALK_NOT_CONFIGURED }

sendCard({ dedupeKey, routeKey, card })
  → { ok: true, code: DINGTALK_CARD_SENT, providerRef }
  → { ok: false, code, retryAfterMs? }

updateCard({ dedupeKey, routeKey, providerRef, card })
  → { ok: true, code: DINGTALK_CARD_UPDATED, providerRef }
  → { ok: false, code, retryAfterMs? }
```

约束：

- `providerRef` 必须是长度受限的低披露 opaque identifier；
- exact-key result 和 error code 使用本地 allowlist；未知/截断/超长结果归一化为 `DINGTALK_ADAPTER_PROTOCOL_ERROR`；
- success code 仅允许 `DINGTALK_CARD_SENT`、`DINGTALK_CARD_UPDATED`；
- retryable 分类由 application 的固定 code map 决定，不信任 adapter 自报布尔值；
- `DINGTALK_TIMEOUT`、`DINGTALK_RATE_LIMITED`、`DINGTALK_UNAVAILABLE`、`DINGTALK_TRANSPORT_ERROR` 可重试；
- `DINGTALK_NOT_CONFIGURED`、`DINGTALK_AUTH_REJECTED`、`DINGTALK_REQUEST_REJECTED`、`DINGTALK_RESPONSE_INVALID`、`DINGTALK_ADAPTER_PROTOCOL_ERROR` 不可重试；
- `retryAfterMs` 仅允许出现在 `DINGTALK_RATE_LIMITED`，必须是限界非负 safe integer，且最终延迟仍受本地 `retryMaxDelayMs` 限制；
- 不接收/持久化 provider message、headers、body 或 stack；
- adapter exception 在边界归一化为 `DINGTALK_TRANSPORT_ERROR`；
- `createUnconfiguredDingTalkAdapter` 的 readiness/send/update 均固定返回 `DINGTALK_NOT_CONFIGURED`；
- readiness 未通过时 Dispatcher 不领取消息、不增加 attempt，记录保持 pending 并通过低频 health/status 暴露稳定 code；
- readiness 只是领取前优化，存在配置变化的 TOCTOU；send/update result 才是本次 attempt 的权威结果；
- Mock 只能通过显式依赖注入创建，默认 runtime 永不加载 Mock；
- 单元测试禁止 DNS、HTTP、真实时间等待或读取环境凭据。

WO-04 本地 dispatcher 只消费 `sendCard`；`updateCard` 只冻结 Port 契约并由 unconfigured/Mock 实现，不产生 update intent。真实网络 adapter、SDK 选择、endpoint、credential 和 provider-specific dedupe 能力留给独立授权的 integration work package。即便未来 provider 接受 `dedupeKey`，也不改变当前至少一次语义，更不构成 provider exactly-once 证明。

## 8. 三类最小披露卡片

所有 builder 是纯函数，严格拒绝未知字段，不读取数据库或网络。共同约束为：DTO exact-key；identifier 禁止控制字符与换行并限制为 128 Unicode code points；时间必须为 RFC 3339；revision、duration 和 taskCount 必须是非负 safe integer；所有枚举均使用冻结 allowlist。

### 8.1 新需求

```text
requestId, priority, productionType, desiredDate
```

不包含 requestedBy、note、Brief、附件、客户正文或 URL。

### 8.2 排期确认

```text
scheduleItemId, resourceId, plannedStart, plannedEnd, taskCount, scheduleRevision
```

不包含完整任务正文、Brief 或人员信息。

### 8.3 完成

```text
runId, scheduleItemId, resourceId, scope, taskCount, completedAt, netDurationMs, runRevision
```

不包含阻塞 note、actor/device、完整任务、附件或事件历史。

首版 card 不使用外部图片 URL。Brief URL allowlist 冻结为空；受控 `heroAssetId` 也不进入卡片，直到存在经过鉴权的受控媒体读取路由。不得由服务端抓取用户 URL。

### 8.4 Revision scope 映射

| Intent | revision scope / value | 状态 |
|---|---|---|
| `production-run.completed.v1` | `run / runRevision` | WO-04 可接入 |
| `schedule.confirmed.v1` | `schedule / scheduleRevision` | `NOT_WIRED` |
| `request.submitted.v1` | 尚未冻结；等待 canonical request command | `NOT_WIRED` |

不得用 `projectionRevision` 冒充 request aggregate revision。

## 9. Callback Admission Framework

本批冻结框架但不发布 callback HTTP endpoint：

```text
raw request
→ raw byte size/content-type/header singleton gate
→ provider verifier port 对 exact raw bytes 做签名、timestamp、nonce 与必要解密
→ 对 verified plaintext 做 duplicate-key rejecting exact schema parse
→ trusted callback principal mapping
→ provider card ref 与 aggregate 绑定
→ card template + action allowlist
→ callback ID / digest idempotency
→ capability + entity + expected revision
→ existing application command
→ minimal callback receipt/audit
```

规则：

- 未配置 verifier 或 principal mapping 固定失败关闭；
- 官方签名算法/header/response protocol 未经真实资料核实前不得凭记忆实现或宣称兼容；
- 不得把 callback 先 parse/re-serialize 再验签；普通 `JSON.parse` 不能提供重复 key 拒绝保证；
- raw callback 只在 verifier 边界内短暂存在，不记录、不回显、不传给领域层；
- verifier 输出不能自报 capability，角色来自 trusted mapping；
- 本地 WO-04 的 enabled action allowlist 为空，因为尚无适合从钉钉开放的 canonical command；
- 不得为了“演示 callback”新增无权威业务命令或让钉钉直接写表；
- 冻结 `CallbackReplayStorePort`：nonce 只允许以域分离 digest 表示；相同 nonce/digest 可返回原 receipt，不同 digest 复用失败关闭；
- 本地测试只可显式注入 fake replay store 证明 admission 顺序与 Port 契约，不得据此宣称跨进程或重启后的持久重放保护；
- runtime 没有持久 `CallbackReplayStorePort`、verified provider port、trusted mapping 或非空 action registry 时统一 `CALLBACK_NOT_CONFIGURED`，所有动作拒绝；
- 已签名但发生业务冲突的 callback，未来只有在 nonce claim、拒绝 receipt 与领域事务共享同一持久事务时才允许启用；
- 持久 callback receipt/nonce、真实 action 与 HTTP route 都是 `NOT_WIRED`，留待 action registry 非空时的后续 migration。

## 10. Windows 与跨平台执行边界

- Outbox lease 只使用 SQLite `BEGIN IMMEDIATE`、持久时间字段和 `outboxId + leaseToken` CAS；禁止 POSIX `flock`、lockfile、rename-based lease、shell command、`/tmp` 假设或 OS signal correctness；
- worker/lease token 使用 `crypto.randomUUID()` 或显式注入的 deterministic factory，不依赖 hostname、PID、路径大小写或 inode 作为唯一性保证；
- timer、clock、random 全部注入；持久时间统一为 UTC `toISOString()`，避免按混合 offset 文本排序；
- migration v4 只通过现有 SQLite migration transaction 增加 schema，不生成 filesystem artifact；旧 migration 1–3 的 SQL/name/checksum 不变；
- isolated V1→V2 apply/verify 必须证明 `notification_outbox` 存在且为空，不迁移历史通知，不自动补发；
- 触碰 migration path/artifact 代码时复用 `platform-filesystem.mjs` 的 `pathsEqual`、`hasExactPermissions`、`supportsDirectoryFsync` 与必要的 `IS_WINDOWS`，不得恢复 POSIX-only 比较；
- 子进程测试使用 `execFile(process.execPath, args)` 或等价无 shell API；脚本 URL 转路径使用 `fileURLToPath()`；
- Windows 未实跑时必须记录 `WINDOWS_NOT_RUN`，不得宣称 Windows-ready。

## 11. 测试与放行门

必须覆盖：

1. migration 单调、重跑幂等、DDL/marker drift、partial schema 和 unknown object 失败关闭；
2. enqueue exact no-op 与 dedupe mismatch 全事务回滚；
3. 业务事实提交而 adapter 失败时，事实保留、Outbox 可重试；
4. 业务事务回滚时 Outbox 为零；
5. 双 worker 只能由有效 lease owner 回写；expired lease 可恢复；
6. 网络调用发生在事务外，slow adapter 不占 SQLite 写锁；
7. 有限重试、退避/jitter、最终 deadLetter；
8. 第 5 次 `DINGTALK_TIMEOUT` 直接进入 deadLetter，推进任意 clock 后仍不能发生第 6 次 claim；
9. sent/deadLetter 不能重开，Outbox 状态不增加业务 revision；
10. 卡片严格最小披露；日志/记录不含禁止字段；
11. 默认/unconfigured 不访问网络、不伪造成功；Mock 只能显式注入；
12. callback 未配置、伪造签名、过期 timestamp、duplicate JSON key、nonce replay、未知动作/角色全部失败关闭；fake replay store 只证明 Port 契约，持久 replay protection 标记 `NOT_WIRED`；
13. request/schedule 未有 canonical producer 时明确 NOT WIRED，不能用 fake integration 通过验收。

跨平台放行还必须满足：Windows Node 24 targeted migration/dispatcher tests `PASS`，或明确记录 `WINDOWS_NOT_RUN` 且不宣称 Windows-ready。

## 12. 结论

WO-04 的核心不是“能发一张卡”，而是一个可恢复、低披露、不会穿透业务事务的副作用边界。只有现有权威命令可以生产通知；没有 command 就保持未接入，而不是从 Snapshot 或数据库状态猜测一次业务动作。
