# ADP-025：Scheduling Contract Exactness and Evidence Binding

- 状态：`ACCEPTED / FROZEN_FOR_WO-05_LOCAL_IMPLEMENTATION`
- 日期：2026-09-22
- 细化：ADP-024 第 4、5、7、8、11、12 节
- 不授权：生产部署、真实 provider、真实数据、自动采用、canonical acceptance 接线

本决定记录 WO-05A 独立审查后新增的 exact contract；不回写或隐藏已经冻结的 ADP-024 历史。

## 1. 管理命令与配置正文

资源注册/替换均为 full-state exact command：`{ operationId, expectedScheduleRevision, expectedProjectionRevision, resource }`；resource 为 ADP-024 的 canonical resource body。command digest 排除 operationId/actor，domain 分别为 `scheduling-resource-register-command-v1` 与 `scheduling-resource-replace-command-v1`。

Config publish exact command 为 `{ operationId, configVersion, algorithmVersion, calendarCompilerVersion, estimatePolicyVersion, configJson, configDigest }`；activate 为 `{ operationId, configVersion, expectedProjectionRevision }`。command digest 分别使用 `scheduling-config-publish-command-v1` / `scheduling-config-activate-command-v1`。

`configJson` v1 exact keys：`schemaVersion:1`、`businessTimeZone`、`resourceCalendars[]`、`durationFallbackRules[]`、`bufferRules[]`、`softScoringWeights`、`compatibleAlgorithmVersions[]`。

- resource calendar 为 `{ resourceId, capabilityDigest, weeklyWindows, dateOverrides }`；weekly window 使用 weekday 1..7 与 `HH:mm` start/end，不跨日、不重叠；
- date override 为 `{ date, status: closed|custom, windows }`，完全替换当日 weekly；closed 要求空数组，custom 要求非空且不重叠；
- duration/buffer selector 为 productionType + shootingSubtype，优先级 exact subtype > production-only > global；同一 selector 唯一，允许缺 global；
- soft weight exact keys 为五个 ADP-024 soft diagnostic code，值为 0..1,000,000 safe integer；
- compatible algorithm versions 非空、唯一、code-point 排序；所有数字 `-0` 归一为 0；
- configDigest = SHA-256 canonical `{ domain: "scheduling-config-v1", configJson }`。

这些只冻结结构与确定性，不提供真实业务数值。

## 2. Calendar compiler 与 tzdata

首批只支持 `calendar-compiler-v1`。编译必须拒绝 endpoint ambiguous/invalid 以及窗口内部任何 UTC offset transition。实际 runtime tzdata fingerprint（Node 为 `process.versions.tz`）必须存在并与 caller exact match；任意标签不能替代实现证明。

`timeZoneDataVersion` 是 SchedulingInputV1、SchedulingResultV1 与 Proposal immutable content 的必填 exact 字段，并进入 input/result/Proposal digest 链。compiled calendar result digest 同时覆盖 compiler 与 tzdata version。不同 runtime fingerprint 或未运行 Windows golden 时不得声称跨平台 byte-equivalent。

## 3. Proposal 与 decision exact fields

Generation command 为 `{ operationId, planningWindowStart, planningWindowEnd, resourceScope }`，scope 非空/唯一/code-point 排序；digest 排除 operationId/actor，domain 为 `scheduling-proposal-generation-command-v1`。

decisionNote 为 NULL 或最多 1000 Unicode code points 的 trim-stable 低披露文本，拒绝 C0/C1 control、换行、U+2028/U+2029 与 lone surrogate。stale reason allowlist：

```text
SCHEDULE_REVISION_CHANGED
SCHEDULING_INPUT_CHANGED
SCHEDULING_CONFIG_CHANGED
SCHEDULING_ALGORITHM_UNSUPPORTED
RESOURCE_CHANGED
REQUEST_FACTS_CHANGED
```

System stale decisionId 使用 `spd_` 加 canonical `{ domain:"scheduling-system-stale-decision-id-v1", triggerOperationId, proposalId, reasonCode }` 的 SHA-256 hex；command digest 使用同 tuple 与 `scheduling-system-stale-command-v1` domain。

accept/partial receipt 的 adoptedItems exact shape 为 `{ proposalItemId, scheduleItemId, sourceOrdinal }`，与 selection 一一对应；reject/stale 的 adoption fields 为 NULL。system receipt 构造必须由 trusted triggerOperationId context 复算，不接受 body 自报。Proposal item 必须交叉引用 input candidate、active scoped resource并位于 planning window。

## 4. Evaluation evidence boundary

Level A/B/C 资格不得由裸布尔值升级；event chain、metrics、run-context、SchedulingInput、Proposal、Decision、Outcome 必须使用 canonical body/digest 与 ID/version 关系验证。受支持版本由本地 allowlist 判定，不接受 caller 的 `versionSupported` 结论。

Level C case 携带可复算的完整低披露 SchedulingInput。hard-conflict 与 priority metrics 只消费受信 pure replay port 的 exact versioned result；port 缺失、抛错、返回扩展/错误版本或无法覆盖完整 cohort时，对应 metric 为 `NOT_ENOUGH_DATA + value:null`，不得汇总 dataset 自报结论。

Dataset class 仅为 `synthetic | approvedLowDisclosure`。approved dataset 必须同时满足 canonical approval digest 与 trusted expected-approval context；manifest 自签字段不能自封 approved。所有本阶段 report 的 `gateStatus` 固定为 `BLOCKED_DATA`，阈值与真实 Level C 数据另行冻结。

## 5. Shared admission primitive

WO-05 identifier 统一复用 core `isSchedulingIdentifierV1`：按 Unicode code point 限长，拒绝 trim 变化、空白、C0/C1 control、U+2028/U+2029 与 lone surrogate。admin、Proposal、evaluation 不得复制另一套 identifier 规则。
