# R2 历史 WAL 完整性例外边界：P1 处置与独立复核 R1

外部审查提出 `HOLD_P1_WAL_COMPLETENESS_EXCEPTION_BOUNDARY`，本次接受该 finding。上一候选虽然披露了历史提交可能遗漏，却没有将这项风险与 `WAL_CHECKPOINT_COMPLETENESS_UNPROVEN` 拒绝原因及唯一拟议例外逐项关联。上一轮自审遗漏了这个方法边界，不能凭此前 PASS 继续申请批准。

本次结论：**P1 方法表述已修订，独立复核为 `PASS_FOR_EXACT_OWNER_METHOD_APPROVAL`；Owner 未批准，G3-05 仍 BLOCKED。**

## 当前唯一待批准版本

- 方法 ID：`G3_05_RESTRICTED_RECOVERY_REFERENCE_METHOD_R2`。
- [方法完整条款](G3_05_RESTRICTED_RECOVERY_REFERENCE_METHOD_R2.md)。
- 原始 UTF-8 字节 SHA-256：`e1acba51102404d87e756b0e6a502c6a9cd92bbe4a2136c0f6d8c41b19b6ffd0`。
- 前一候选 `d2098a6fea0c74fdded246f738a64e098c439dd958d003f3241e660c6f2c1e3d` 的待批准请求及审批就绪口径已撤回。
- 更早候选 `7624dca8c1bb9534b3a1b8ce104deddf1704a55f351244e3177d0ecae0caf688` 继续撤回。旧审查和自审报告保留，仅覆盖各自旧字节，不自动覆盖本次 P1 修订。

## 修订的确切含义

| 问题 | 现条款 |
|---|---|
| 重建证明了什么 | 固定 Schema6 main/WAL 的可见捕获状态，经原迁移 7–10 后与固定 Schema10 main 在既有 40 表比较范围内相符。只承认四个事先声明的重建时间字段例外；不输出逐帧、逐事务的历史覆盖结论。 |
| 重建未证明什么 | 未证明历史所有已提交 WAL 状态进入固定捕获状态或 Schema10 main，未证明原历史 checkpoint 完整。新重建 close/reopen、无 sidecar、integrity 成功均不能补出这个结论。该事实仍为 `NOT_PROVEN`。 |
| 唯一例外是否包含此风险 | 明确包含。原窗口 writer 覆盖缺口及历史已提交 WAL 状态可能遗漏，共同属于本案一个受限恢复参照资格例外；必须经技术审查及 Owner 精确批准。不是宣称完整性已证明，也不是证明已发生数据丢失。 |
| R1 是否放宽 | 不放宽。原 R1 witness 的所有 `2/2` 继续拒绝，拒绝代码仍为 `WAL_CHECKPOINT_COMPLETENESS_UNPROVEN`。 |
| 未来 R2 的允许范围 | 仅固定档案、精确获准方法和完整独立证明链，及完整匹配的当前 preserved `2/2` / active `1/1` 和其他强制条件。不能把 Owner 风险接受推广给其他无 sidecar 的 `2/2`。 |
| 结果如何解释 | 重建一致性、历史 WAL 完整性未知、例外批准、当前生产独立接受分别表达；不得合并为笼统的“完整性 PASS”。本次未设计新接口字段。 |

## 新摘要的独立复核

现有 `evidence_review` 独立 agent 重新只读审查上述新摘要，结论为 `PASS_FOR_EXACT_OWNER_METHOD_APPROVAL`，未沿用前一 PASS。本报告由主执行者按此次返回结果归档。

复核确认：P1 边界现已明确；原 R1 通用拒绝保持，历史 WAL 命题未改标；本案例外没有豁免当前来源、保护、完整 Schema10→11 语义比较。未发现新的阻断性合同冲突；未来限定参照资格不等于原切换满足 G2。

实际取阅：新条款全文及完整差异、现行 witness 拒绝分支、两份 R1 合同及摘要、重建代码的迁移/关闭/比较逻辑、Jenn 登记的原始 JSON 回执。原回执摘要、5733 字节、40 表、四项时间差异及三个 false 资格字段匹配。

未验证：未重新执行重建或合成实验，未重新验证完整 SSH/独立存证链，未检查真实归档内容或当前生产对象，未独立核实外部审查者的操作记录。外部审查自身声明只核验了 GitHub 代码/合同，未取得 Jenn 原始回执进行重新验签或完整回放。**这些范围均不能表述为生产证据链已经独立验收。**

## 交付边界

本次仅修改方法文档并新增本复核记录。R1 合同、现行 witness、签名验证器、重建工具、原始证据及旧审查文件均保持原字节；核对文件摘要和 `git diff --check`，未将历史测试计为本次重跑结果。

本次未访问生产、未执行生产操作、未合并 PR、未实现 `2/2` 接受。PR #63 保持 OPEN / DRAFT / NOT_MERGED；G3-05 保持 BLOCKED。新结论只表示此精确方法候选可提交 Owner 批准；批准点一通过后才可进入其限定的最小实现。
