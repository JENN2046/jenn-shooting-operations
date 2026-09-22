# WO-01：V2 契约、校验器与兼容投影

- 状态：`PASS`
- 执行分支：`codex/v2-1-architecture-freeze`
- 架构基线：`JSO-ARCH-V2.1-R3`
- 前置门：WO-00 `PASS`
- 范围：版本化 V1/V2 Schema、公共校验入口、纯领域状态规则、V1/V2 显式投影及契约测试
- 明确不包含：SQLite V2 表、迁移器、HTTP V2 路由、真实数据迁移、生产配置、外部调用、部署

## 1. 绑定决定

- ADP-017：`scheduleRevision / runRevision / projectionRevision` 三域；
- ADP-018：多任务时间块使用有序 `taskBindings`，不得自动拆分；
- ADP-019：`requests_v2` 是 canonical work identity；Request/Schedule/Run 生命周期分离；
- ADP-020：JSON Schema 结构权威 + 有限语义校验；strict-write/legacy-read 双 profile；
- Implementation Style Guardrails：普通 ESM 函数与对象，不堆叠 Repository/Service/Manager 样板。

## 2. 指挥拆分

| 轨道 | 独占范围 | 目标 |
|---|---|---|
| Contract | `contracts/`、公共 validator、contract tests、固定 validator dependency | 真实执行 Draft 2020-12；V1/V2 strict 与 legacy classification |
| Projection | `src/projections-v2.mjs`、projection tests | internal normalized model 显式生成 V1/V2；round-trip 与 ordering |
| Domain rules | `src/domain-rules-v2.mjs`、domain tests | 三套生命周期、非法转换和 revision effects |
| Commander | 工作包、交叉集成、回归、独立复核与提交 | 消除契约冲突和过度抽象，守住非范围 |

## 3. 验收门

- [x] V1 `$id` 不被原地改成 V2；
- [x] V1 Snapshot/Submission Schema 被真实编译并执行；
- [x] WO-00 24-case parity matrix 的 strict/current/legacy 预期可重复验证；
- [x] V2 request discriminated deliverables、Brief/sample/lighting/priority 有正负测试；
- [x] V2 schedule contract 包含 scoped revisions、ordered bindings、schedule/lock/run 分离；
- [x] extra properties、长度、空白文本、日期、时间、RFC 3339、safe integer 和引用失败关闭；
- [x] V1 compatibility projection 精确保留 presence、顺序、legacy fragments 与 grouped session；
- [x] V2 projection 不把 `nextStart/diagnostics` 变成可写事实；
- [x] 状态转换矩阵与 revision effects 是无数据库纯规则；
- [x] V1 现有测试全部保持通过；
- [x] 无数据库、HTTP、外部系统或生产行为变更。

## 4. 验证证据

完成后填写：

```text
Contract tests: PASS — 15/15；五份 Draft 2020-12 Schema 真实编译执行；24-case parity、正式 legacy fragment contract 与 lifecycle 组合通过
Projection tests: PASS — 9/9；exact V1、完整 V2、L1 fragments、optional timestamp overlay、空属性名、grouped/asset ordering 与负向路径通过
Domain rule tests: PASS — 11/11；三生命周期、非法转换、grouped complete 与 revision scopes 通过
npm run check: PASS — 59 tests, 58 passed, 1 VCP skip, 0 failed
WO-00 fixture validator: PASS — 13/13 JSON，strict/legacy parity、round-trip 与附件 cases 通过
Dependency audit: PASS — npm audit --omit=dev, 0 vulnerabilities
Independent review: PASS — 第三轮独立探针确认 L1 timestamp overlay、9 字段 fragment、V1 exact replay、V2 schema closure、空属性名与 reserved path fail-close 全部闭合；无 blocking/major
Git scope: PASS — 仅 contracts/validator/projections/domain rules/tests/fixture expectations/dependency lock 与工作包；未触碰 HTTP/store/database/external systems
```

## 5. 退出结论

`PASS`。允许进入 WO-02；已知外部 VCP Adapter 缺失只阻断后续 Switch，不阻断本工作包退出。WO-01 不授权数据库迁移、外部联调、Switch 或部署。
