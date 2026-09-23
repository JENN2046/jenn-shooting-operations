# ADP-023：Outbox Identifier Compatibility

- 状态：`ACCEPTED / FROZEN_FOR_WO-04_LOCAL_IMPLEMENTATION`
- 日期：2026-09-22
- 细化并替代：ADP-022 第 8 节的通用 128 code-point identifier 上限
- 不改变：migration v4、至少一次投递、producer admission 或真实钉钉授权边界

## 1. 背景

现有 V2/Kiosk 合法业务 identifier 最长为 160 Unicode code points。若 Card/Intent 边界只接受 128，合法的 129–160 长度 Run/Schedule/Resource ID 会在完成事务中构建通知失败，并错误回滚业务命令。

## 2. 决定

- Card 中的 `requestId`、`scheduleItemId`、`resourceId`、`runId` 使用既有 canonical 上限：1–160 Unicode code points；
- Intent 的 `outboxId`、`aggregateId` 使用 1–160 Unicode code points；
- 上述 identifier 仍必须 trim 后非空，并拒绝控制字符、换行、U+2028 与 U+2029；
- `routeKey`、`workerId`、`leaseToken` 继续限制为 128 code points；`dedupeKey` 限制为 1024 code points；
- 本地 v1 `providerRef` 在真实 provider 格式尚未核实前采用 `[A-Za-z0-9._:/+=@-]`、1–256 code points 的失败关闭 allowlist；migration v4 的 512 字符列约束只是存储上限，不扩大应用 admission；
- 若未来官方 provider reference 需要其他字符，必须先验证官方契约，再通过后续 migration/adapter decision 扩展；不得直接改写 migration v4 checksum。

## 3. 验收

- 160 code-point canonical identifier 必须通过 Card/Intent；161 必须拒绝；
- Unicode、内含空格或 257 code-point 的 `providerRef` 必须在 Port normalization 阶段拒绝，不能到达 `leased → sent` 数据库写回；
- producer integration 必须覆盖 160 边界，证明通知不会缩窄既有业务命令契约。
