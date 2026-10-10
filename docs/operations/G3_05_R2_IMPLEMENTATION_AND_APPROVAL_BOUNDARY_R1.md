# G3-05 R2 实现、证据边界与后续批准

状态：`IMPLEMENTED_FOR_ISOLATED_REVIEW_ONLY`。GitHub P1 SSH 程序绑定修复的增量及证据适用范围见 `G3_05_R2_SSH_EXECUTABLE_REVIEW_FIX_R1.md`。Owner 已批准方法 R2；合并与生产执行均未批准。G3-05 仍 `BLOCKED`，PR #63 保持 Draft。

## 1. 批准来源与不变边界

批准的原文转录见 `g3-05-restricted-reference-method-owner-approval.r2.json`，它不是数字签名。批准对象为方法 SHA-256 `e1acba51102404d87e756b0e6a502c6a9cd92bbe4a2136c0f6d8c41b19b6ffd0`，批准时 PR head `358a713d7d7969544466bb85c971ef7c19c5bf2b`。方法原件字节保持不变。

固定 Schema6→10 重建只证明捕获状态的重建一致性；历史 writer 覆盖、历史全部 WAL 已提交记录是否进入 main 仍为 `NOT_PROVEN`。可能遗漏的已提交历史数据属于 Owner 明确接受的固定参照剩余风险，不产生通用 WAL 完整性结论。四项迁移时间例外只属于原重建；当前 10→11 比较没有时间例外。

R1 witness、R1 签名验证器、R1 两份合同保持原字节。R1 合同绑定了源码摘要，因此 R2 使用独立入口 `g3-forward-adoption-readonly-witness-r2.py`，复用经摘要固定的 R1 比较函数。这是相对于原计划修改同名文件的最小兼容调整。原 R1 对所有 `2/2` 的 `WAL_CHECKPOINT_COMPLETENESS_UNPROVEN` 拒绝保持；旧 Ed25519 入口仍拒绝 R2。

## 2. 合同和执行入口

新增证据合同及例外合同 R2，状态均为 `IMPLEMENTATION_PREPARATION_NOT_PRODUCTION_AUTHORITY`。`validate-g3-r2-preparation.py` 验证方法、Owner 转录、R1 历史、11 个运行源码、引用链、资源限制和全部 false 权限。

| 入口 | 行为 |
|---|---|
| 远端 R2 `preflight` | 只读复核受信窗口、对象、父链、挂载、别名、helper 和实际 writer 检查 |
| 远端 R2 `protect` | 固定 FD，先 active 后 preserved；任何部分成功保留保护，无解除入口 |
| 远端 R2 `verify` | 复核两 inode immutable 及全部原绑定 |
| 远端 R2 `capture` | 精确 proof、运行时、原 FD 摘要与格式检查后，只解释私有 tmpfs 副本 |
| Jenn `g3-collect-production-evidence.py` | 无调用者授权参数；从固定存证库读取批准，一次挑战、一次认证 SSH、保存原文、严格接受 |
| Jenn `verify-g3-production-evidence.py` | 独立进程只读 ledger 回放；`--require-fresh` 同时核对当前时钟和 Jenn boot |

R2 仅处理 preserved `2/2`、active `1/1`。没有已安装且批准的完整 proof 时，在 SQLite 解释前停止。原生产路径不交给 SQLite；不改头、不 checkpoint、不恢复数据库。

## 3. 精确批准如何绑定

远端固定库 `/etc/jso/g3-r2`；Jenn 固定库 `$HOME/.local/share/jso/g3-r2`。库须属执行主体、0700，完整父链无符号链接、无组/其他用户写权限。库不接受 CLI 路径覆盖。安装仍属于后续精确生产包的单独批准动作。当前没有安装任何生产库。

`approved.json` 是规范 UTF-8 JSON。字段严格固定为：

- `version/purpose/methodSha256/ownerApprovalSha256/contractSha256/exceptionSha256`；
- `referenceEvidenceSha256/sourceIndexSha256/reference/code`；
- 远端 `runtime` 与独立 Jenn `collectorRuntime`（版本、解释器、`_sqlite3`、实际映射的 libsqlite3 摘要）；
- `host/files/window/transport/scope/release/mergeRecordSha256/executionApprovalSha256`。

`release` 精确包含 PR head、批准 base、`postMergeCanonicalHead`、`sourceTree`；必须是实际合并产生的新提交。此实现不接受仍为 PR/base/原方法提交的 canonical。未来合并包应明确采用产生新提交的 GitHub 合并方式。

生产 `merge-record.json` 绑定方法、合同、11 项代码及完整 release；`execution-approval.json` 另外绑定**整个清单的规范编码摘要投影**，仅排除两个批准记录自身摘要，避免循环引用。因此对象、主机、boot、窗口、命令/主机密钥、运行时、参考链或 canonical 任一变化都会使旧批准失效。生产工具不联网查询 GitHub；合并事实和 Owner 原始批准由 Jenn 的受信管理员核验、独立记录并装入固定库。工具不能自行生成批准。

`reference.json` 固定方法、五项历史引用、两个 NOT_PROVEN 和 scope；调用者同时传材料及其自选摘要不能建立权威。`source-index.json` 固定原 receipt、status、stderr、一次消费记录、原授权、transport 源码和独立接受记录。原空 stderr 用明确空 base64 包装进入索引；原文件保持不变。Jenn 校验全部已登记原始材料摘要和原格式，不把历史有限接受当成新生产证据。

源码 bootstrap 在导入前固定完整 11 项源文件集合，拒绝预加载 R2 模块，执行核验过的源码字节而不使用 pyc。最外层入口/bootstrap、Python 系统库、SSH 程序及其启动目录仍属于 `TRUSTED_HOST_ADMIN` 部署责任；执行包必须对其实际部署位置、权限和工件作精确复核。该模型不抵御已获授权的 root/Jenn 主体故意伪造批准。

## 4. 保护、解释与存证

窗口责任同时绑定三类原件：可信管理员完整责任、disabled 配置事实、旧 helper 约束；还绑定实际只读 writer 探测命令及预期结果。disabled 文本不能替代进程排空、旧 helper 和父目录管理责任。探测只支持固定白名单的 docker inspect、systemctl is-active/show、pgrep 参数数组，不启动业务或停止共享 Docker，不改共享 Docker 父目录权限。

捕获检查全父链和固定 FD，复核挂载、路径、内容、时间元数据、flags 和已登记别名。在副本解释之后以及清理之后重复检查。R2 自带一次保护入口只使用固定 inode，部分失败绝不撤销已有保护。

副本解释先 unshare mount namespace，再 recursive private，并核查所有挂载无传播标记，之后才创建 root 私有目录和 8 MiB tmpfs。复制前限制单件及累计大小；原 FD 有界读取与复制前后摘要均核对；关闭所有可写 FD，再用 `mode=ro&immutable=1` 读副本。该参数不证明历史 WAL 完整性，也不承担原件 E1 保护。

运行限制为 256 MiB 地址空间、60 秒 CPU、120 秒墙钟、stdout/stderr 各 1 MiB。清理仅包含本次两副本、私有挂载和目录；清理不确认则拒绝。SIGKILL、主机失联等不可处理退出可能留下空目录或未知状态，须记录 UNKNOWN/BLOCKED，不能自动重试或擅自扩大清理范围。

Jenn 使用正常认证 SSH，固定主机密钥、身份、实例、boot、命令、代码、两端运行时。客户端固定 `/usr/bin/ssh`；批准清单 transport 必须包含 `sshExecutablePath` 与 `sshExecutableSha256`。启动前和回放时验证 root 保管的完整父链及程序字节，无 PATH 回退。启动环境仅为已固定的 PATH、LANG、LC_ALL，且作为 transport 原文的 `environment` 字段严格核验；不继承调用者环境。挑战从签发开始 300 秒，墙钟和单调时钟都必须有效；先耐久消费再启动传输。原 stdout/stderr、退出和时序先独立保存并 fsync；原记录不得回写。

ledger 的成功候选写为 `PENDING_FINAL_ACCEPTANCE`，提交并 fsync 后再记录时限内接受决定到只创建一次的 `acceptance.json`。独立回放必须同时验证完整 ledger、接受 seal、原文摘要、挑战、全部语义检查和引用链。单独 PENDING、缺失/未知 seal、迟到成功 JSON 均拒绝。历史回放只证明当时完成接受；不延长有效期，不授予跨 G3 阶段新鲜性。

## 5. 本轮验证与诚实边界

结果和逐项摘要见 `../acceptance/g3-05-r2-isolated-validation.r1.json`。原始实验记录、SSH 原文、SQLite ledger、批准清单历史及独立复核保留在 Jenn 本地 `artifacts/g3-05-r1/r2-implementation-r1`。

实验只使用 Jenn 管理的可丢弃 KVM guest、真实 ext4、真实 loopback SSH 和合成数据库；无共享目录，QEMU restrict 网络，无生产连接。Ubuntu 24.04 guest 实测 Python 3.12.3 / SQLite 3.45.1；Jenn 采集器使用自己的独立固定运行时。

生产 profile 的仓库单测使用显式构造的结构回执，并仅为正常结构分支 mock 历史前缀摘要；取消该 mock 时合成前缀被拒绝。这不声称当前生产数据已经通过。固定历史来源离线测试则读取已登记原始回执字节；未重复原迁移、未访问生产数据库、未扩大历史搜索。

原中文/空格 checkout 的全检触发既有 URL.pathname 路径问题；在逐文件哈希一致的 ASCII checkout 完成仓库检查。未修改这部分历史验证器。

## 6. 剩余批准与退出条件

下一步仅请求 **批准点二：精确 PR head 与 base 的合并**。代码复审、完整检查和实际隔离结果必须先完成；Owner 批准后再次核对两端无漂移。不同 head/base 不能继承本次批准。

实际合并后，记录 canonical commit/tree 和工具字节，才形成批准点三的完整生产包。该包必须列出所有固定库文件/部署工件、两端运行时、原对象、完整父链与挂载/别名、责任窗口、旧 helper、writer 排空证据、命令顺序、创建/卸载/清理对象和失败保护保留策略。当前不预填未知 canonical 或生产事实，不用本轮 lab manifest 填充生产批准。

批准点三获准后才可一次生产窗口完成：现场复核→active/preserved 保护→新挑战 E1/E2/E3→独立接受及回放→独立终验。保护持续覆盖证据使用期，除 Owner 单独批准退出外不得解除。失败保留原文和已落实保护，UNKNOWN 不自动重试。

G3-05 退出标准仍为获准方法下的**生产 E1/E2/E3 独立接受**；本轮实现或实验通过不能关闭 G3-05。G3-06、治理采纳、writer 放行、服务启动均未授权。
