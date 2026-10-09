# Codex 执行任务｜JSO G3-03 隔离证据验收与 E3 最小适配

**TASK_ID:** `G3_03_ISOLATED_EVIDENCE_ACCEPTANCE_R1`

**Repository:** `JENN2046/jenn-shooting-operations`

**Canonical branch:** `codex/v2-1-architecture-freeze`

**Task nature:** 非生产代码修复、隔离测试、独立审查与证据交付。

## 一、执行目标

正式推进 G3-03。

基于已经冻结的 G3-02 方法合同，完成 E1/E2/E3 的隔离环境集成验收，以及 E3 的最小必要代码修复。

**核心目标不是重新设计安全架构，而是让现有方法通过可复现、可审计的隔离验收。**

本任务仅授权非生产、可丢弃环境内的必要代码与测试操作。

不包含生产部署、生产数据库读取或写入、真实生产 custody 修改、服务启动、Schema11 正式采纳、PR Merge 或进入 G3-04 的授权。

## 二、先核对当前权威状态

正式执行前，必须 fresh 读取：

- Issue #57：总路线图与阶段顺序
- Issue #59：G3-02 最终方法冻结合同
- Issue #60：R1/R2 隔离验收及独立复审
- Issue #55：历史 G3 证据
- Issue #58：TRUSTED_HOST_ADMIN 最终批准
- Draft PR #56：现有 witness、验证器和三个生产证据 findings

重点：

`https://github.com/JENN2046/jenn-shooting-operations/issues/59#issuecomment-6074360103`

确认：

```text
G3_02=FROZEN_NON_EXECUTABLE_METHOD_DESIGN
G3_03=NOT_YET_ACCEPTED
TRUST_MODEL=TRUSTED_HOST_ADMIN
```

上次观察到的 canonical HEAD：

`371bf8982b0cd0df579b0e981964b27f9d0319fc`

上次观察到的 PR #56 HEAD：

`620136f322fddd194144ae90a44d833a40e15fff`

以上均为历史快照，必须重新核实。

若发现冻结合同已被新的 authority 取代、任务已被执行或目标存在冲突，立即停止并报告，不重复工作。

## 三、E1：隔离与持续保护验收

复用 G3-02 已冻结的双 inode immutable、完整父目录链 custody 与现有 writer deny 方法。

只针对 G3-03 尚未覆盖的集成风险设计测试。

必须验证：

1. 两个原始数据库 inode 的身份与哈希绑定。
2. 父目录链、叶子文件、mount alias 和 namespace 的一致性。
3. 旧 FD、残留 helper、普通非可信 writer 对保护状态的影响。
4. 崩溃、重启、部分保护、目录或 inode 替换后的拒绝行为。
5. 保护状态在有界 capture 前后的复核。
6. 状态 UNKNOWN、权限异常或隔离失效时不得进入 claim。
7. custody 的保护、持续性和撤除均不依赖单纯的进程锁。

**只在 synthetic disposable fixture 内验证。**

已通过的 R1 44/44、F3 8/8 不重新运行，除非有新的代码变更或明确的回归假设。

不得将测试通过解释成生产环境已经受到持续保护。

## 四、E2：可信来源与证据链验收

复用已冻结的：

- 认证 SSH 与预绑定 host identity
- 一次性 challenge
- 传输前持久消费
- 完成和最终接受两个 deadline
- 原始 stdout/stderr/exit 绑定
- 来源外证据保管
- 严格只读终态回放

本轮重点检查 E1/E2/E3 集成后的证据一致性。

必须覆盖：

1. challenge、capture、ledger、receipt 一一对应。
2. 传输成功但过期时拒绝。
3. 响应丢失与 UNKNOWN 不能重新消费身份。
4. receipt 缺失或篡改时拒绝。
5. verifier/runtime/hash 与实际执行内容不一致时拒绝。
6. 非预绑定 host、错误来源或重复挑战拒绝。
7. 证据从生成到独立 readback 的完整性。

复用既有 R2 工具，不建设新的 signer 平台或常驻 nonce 服务。

不得把同一宿主上的隔离环境称为独立第三方取证。

## 五、E3：最小代码修复

这是本轮明确需要实施的代码任务。

优先复用 PR #56 现有代码：

`scripts/g3-forward-adoption-readonly-witness.py`

以及实际被选用的验证器。

### E3-01：SQLite WAL header 兼容

当前 witness 只接受 `1/1` 文件格式，无法正确处理合法的 `2/2` WAL header。

实现最小适配：

- 保留原始文件 FD、bytes、header 和 digest。
- 只在隔离的内存副本中进行必要的格式规范化。
- 保留合法 `1/1` 输入路径。
- 合法 `2/2` 输入必须正确处理。
- Mixed/unknown header 必须拒绝。
- 发现 `-wal`、`-shm`、`-journal` 任一 sidecar 即 fail-closed。本轮不实现 sidecar 合并或恢复；仅支持经完整性验证的无 sidecar `1/1`、`2/2` 输入。
- 不得修改原始数据库。
- 不得把缺失的 WAL 内容伪装成完整一致的快照。

### E3-02：O_NOATIME

修复现有只读打开路径。

要求：

- 显式使用 `O_NOATIME`。
- 不支持或权限不足时 fail-closed。
- 禁止静默回退到可能修改 atime 的普通读取。
- 保持现有 `O_NOFOLLOW`、FD identity；核对 R2 完整父链检查如何覆盖实际 witness 打开的 FD，缺失处仅做必要适配。必须证明目录链、叶子身份和实际读取 FD 一致，不能以外围检查代替读取路径绑定。
- 验证正常读取前后原始文件的相关元数据没有意外变化。

### E3-03：签名验证器兼容

检查可选 signed-envelope verifier 中硬编码的：

`fileFormatRead=1 / fileFormatWrite=1`

如果本次集成验收选择使用该验证器，必须完成与合法 `2/2` 原始 header 的兼容修复和负例测试。

如果不选用，明确 DEFER，不能宣称签名验证链已通过。

### E3-04：SQLite 语义完整性

保留现有比较范围，包括：

- 40/42 表名册及 38 张业务表语义。
- 类型敏感、重复敏感、rowid 敏感的比较。
- Migration11 name/checksum 与前 10 条历史迁移记录。
- 两张新表为空；prestate/recovery 身份保持绑定。
- 完整性和外键约束。
- `application_id`、`user_version`、encoding、page size、auto vacuum。
- `table_xinfo`、`index_xinfo` 等必要元数据。

不能因兼容性适配而放宽既有比较语义。

对于排除的 SQLite 状态，必须给出精确理由。

## 六、实现纪律

遵守：

`Understand Before Reuse → Reuse Before Build → Minimal Residual Gap`

要求：

1. 不修改冻结的 G2 六条不变式。
2. 不新增 gate family。
3. 不重写 G3 状态机。
4. 不创建通用安全平台。
5. 不新增不必要的公开 API、持久状态或后台服务。
6. 不扩大 PR #56 的原有治理范围。
7. 不删除历史 negative cases。
8. 不修改历史 approval、rollback receipt 或 ledger。
9. 对代码修复执行独立审查。
10. 如实现与已冻结方法发生实质冲突，停止并报告，不擅自改写 G3-02 合同。

必须从 fresh 核验且包含现有 witness 的 PR #56 精确 head 创建 `codex/` 隔离工作分支，记录基线。不要直接修改 canonical 分支或现有 PR #56 的 head。

## 七、验收与测试

必须完成：

**A. 源码验证**

- 最小 diff 审查。
- 精确 code/runtime SHA256 pin。
- 相关测试通过。
- 可复现性验证。

**B. 隔离集成验收**

先形成覆盖矩阵，逐项标记“继承已签收证据”或“本轮新增执行”。新增执行须对应具体代码变化或跨组件风险；继承项注明原证据与适用理由，不计入本轮新执行数量。

- 正常成功路径。
- WAL 2/2 正例。
- WAL/sidecar/format 负例。
- 文件与父链漂移。
- 非可信 writer 与残留 helper。
- 崩溃和重启。
- 错误来源与证据篡改。
- 过期、重复消费与 UNKNOWN。
- E1/E2/E3 跨组件绑定一致性。

**C. 独立复审**

由未直接实施该 patch 的 Verifier 检查：

- 测试确实执行，而不是只读取预填 PASS。
- 测试断言与源码行为对应。
- 所有新增代码属于 G3-03。
- 原 G2/G3 硬门保持不变。
- 没有将非生产 PASS 升级为生产 admission。

任何真实阻断不能通过删除测试、放宽断言或人工修改 evidence 来解决。

## 八、GitHub 交付

形成：

`G3_03_ISOLATED_EVIDENCE_ACCEPTANCE_PACKET_R1`

至少包含：

```text
TASK_ID
CANONICAL_EXACT_HEAD
IMPLEMENTATION_BASE_HEAD
IMPLEMENTATION_EXACT_HEAD
REVIEWED_EXACT_HEAD

G3_02_AUTHORITY_REFERENCE
CHANGED_FILES
CODE_DIFF_SUMMARY

E1_INTEGRATION_VERDICT
E2_INTEGRATION_VERDICT
E3_COMPATIBILITY_VERDICT

TEST_MATRIX
NEGATIVE_CASE_RESULTS
INDEPENDENT_REVIEW_RESULT

VERIFIER_RUNTIME_PIN
EVIDENCE_DIGESTS
UNRESOLVED_FINDINGS

PRODUCTION_PROOF=NOT_ADMITTED
G3_04_ENTRY_AUTHORIZED=FALSE
PRODUCTION_MUTATIONS=NONE
PR56_MERGE=FALSE
```

使用隔离分支提交代码。

如果需要 PR，创建独立 Draft PR，保持未合并。

将最终报告与证据链接回贴 Issue #57，并在适当的 G3-03 执行记录中交叉引用。不存在相应 Issue 时，不为了编号而重复创建任务。

GitHub 评论回贴后必须 readback 核验。

PR #56 的三个生产证据 findings 保持 OPEN，不能借本轮隔离测试关闭。

## 九、最终裁定

只允许下列结论之一：

```text
PASS_ISOLATED_G3_03
BLOCKED_WITH_EXACT_FINDINGS
```

PASS 的前提：

- 必要代码修复完成。
- 隔离正负验收通过。
- 独立审查通过。
- 证据完整且可复现。
- 无未处理的 G3-03 关键阻断。

失败时只列出精确且最小的剩余修复项。

禁止无限扩大设计或陷入无休止的补丁循环。

## 十、硬停止

完成 G3-03 后必须停止。

不得自动：

- Merge 任一 PR。
- 进入 G3-04。
- 在生产主机执行取证、chattr、mount 或权限变更。
- 读取或写入生产 SQLite。
- 执行 Schema11 forward adoption。
- 消费真实生产 operation identity。
- 解除 writer deny。
- 启动 production service。
- 进入 G4。
- 修改旧 G3/rollback 历史状态。

**最终交付时只需要清楚报告：完成了什么、哪些证据通过、是否有阻断、下一步唯一建议任务。**

目标是一次性完成 G3-03 范围内的真实隔离验收，而不是再开始新一轮架构探索。