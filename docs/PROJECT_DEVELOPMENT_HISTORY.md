# JSO 项目开发史

Jenn Shooting Operations（JSO）从 VCPChat 中的拍摄计划图表，逐步发展为拥有独立业务数据库、订单管理、确定性排程、现场执行记录和 VCP 原生客户端的协作系统。贯穿这段开发的核心问题是：多人和 Agent 可以共同查看、提出和执行操作，但需求、计划、实际开拍和已保存结果必须各有明确来源，不能由界面显示或一次网络响应互相替代。

本文覆盖主仓从 **2026 年 9 月 22 日至 10 月 27 日**的演进，并记录完成日常 Chat、Agent 集成与 Studio Day 产品化的相关成果。日期统一使用 **America/Adak**；拍摄业务仍使用 **Asia/Shanghai**。例如，GitHub 的 10 月 26 日 UTC 合并事件，在本文中可能记为 10 月 25 日。

截至本次整理，成果集成主线为 **`main`**，当前产品代码基线为 [`e5f3599`](https://github.com/JENN2046/jenn-shooting-operations/commit/e5f3599e331d96bcf1dff5cdccc897330570c1f5)（#92）；其后的 docs-only 提交不改变该产品代码基线。`56b620b`（#78）仍是 10 月 25 日日常图表验收与源码归整的历史里程碑，不再是当前产品代码基线。原默认分支 `codex/v2-1-architecture-freeze` 已重命名为 `main`；更名保留原提交。旧文档中的分支名、Gate 状态和候选标记，应按其当时的目标与日期理解。

## 主要阶段时间线

| 日期 | 阶段 | 形成的成果与当时边界 |
|---|---|---|
| 9 月 22 日 | 从本地图表拆出协作服务 | 初始 Node.js / SQLite 服务、需求提报、只读看板、受控快照接口与孤立上传维护；主仓起点为 `27ca1ef`，维护增量见 [#1](https://github.com/JENN2046/jenn-shooting-operations/pull/1)。 |
| 9 月 22–23 日 | V2.1 数据和执行模型 | 冻结需求、时间块、实际执行三种实体，分开版本域；完成规范化存储、迁移演练、Kiosk、离线队列和 Outbox 的本地实现。见[架构基线](architecture/ARCHITECTURE_BASELINE_INDEX_V2.1.md)。 |
| 9 月 23–24 日 | 确定性排程与可恢复提交 | 调度器、方案持久化、正式采用、可信 HTTP 身份、运行上下文和离线影子评估陆续合并；部署前证据、备份恢复和外部接入准备独立推进。代表记录为 [#2](https://github.com/JENN2046/jenn-shooting-operations/pull/2)、[#5](https://github.com/JENN2046/jenn-shooting-operations/pull/5)、[#14](https://github.com/JENN2046/jenn-shooting-operations/pull/14)、[#15](https://github.com/JENN2046/jenn-shooting-operations/pull/15)。 |
| 9 月 25–30 日 | 首次云端运行与 VCP 接入 | 发现实际目标没有旧 JSO 服务，采用独立新域而非虚构旧库迁移；逐项记录运行、路由、启用、清理恢复和 VCP 同步证据，再推进 Kiosk 的受限接入。代表记录为 [#20](https://github.com/JENN2046/jenn-shooting-operations/pull/20)、[#25](https://github.com/JENN2046/jenn-shooting-operations/pull/25)、[#31](https://github.com/JENN2046/jenn-shooting-operations/pull/31)、[#37](https://github.com/JENN2046/jenn-shooting-operations/pull/37)、[#42](https://github.com/JENN2046/jenn-shooting-operations/pull/42)。 |
| 10 月 5–9 日 | 业务核心收敛与旧域治理 | 将 JSO 业务核心和外部宿主职责分开；完成一次 Schema10→11 物理切换，但随后发现授权基线不一致，旧域继续禁写并进入恢复与核对。见 [#43](https://github.com/JENN2046/jenn-shooting-operations/pull/43)、[#49](https://github.com/JENN2046/jenn-shooting-operations/pull/49)、[#51](https://github.com/JENN2046/jenn-shooting-operations/pull/51)、[#54](https://github.com/JENN2046/jenn-shooting-operations/pull/54)。 |
| 10 月 11–12 日 | 独立启动接纳与 Schema12 产品能力 | 将新域接纳从旧 G3 恢复实验中拆出；补齐五类订单、实际开拍/完成、动态预计结束、参考图、拍摄看板和在线现场控制台。见 [#65](https://github.com/JENN2046/jenn-shooting-operations/pull/65) 至 [#69](https://github.com/JENN2046/jenn-shooting-operations/pull/69)。 |
| 10 月 13–14 日 | 原生对话执行与 R5 | 增加绑定业务身份、原确认和持久回执的对话执行；R5 将这一路径纳入独立启动接纳。见 [#70](https://github.com/JENN2046/jenn-shooting-operations/pull/70)、[#71](https://github.com/JENN2046/jenn-shooting-operations/pull/71)。 |
| 10 月 17–18 日 | 网页与图表持续读取 | 管理页补读已提交排期、现场离线续记、R5/Kiosk 共存、统一管理员登录、本人现场视图、默认关闭的公共看板和未来日期图表调整陆续合并。见 [#72](https://github.com/JENN2046/jenn-shooting-operations/pull/72) 至 [#77](https://github.com/JENN2046/jenn-shooting-operations/pull/77)。 |
| 10 月 25 日 | 日常客户端验收与源码归整 | 收敛 Linux 日常 Chat 的实际安装；完成独立测试场次后移 15 分钟保存及恢复保存。补齐未开拍取消 API 和原生日历正式源码，修正日期缓存与读取文案；[#78](https://github.com/JENN2046/jenn-shooting-operations/pull/78) 和[扩展 #24](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/pull/24) 合并。默认主分支更名为 `main`。 |
| 10 月 26 日 | Agent 日常真实验收 | [#83](https://github.com/JENN2046/jenn-shooting-operations/issues/83) 完成 VCPChat → VCPToolBox → JENN Extensions → JSO 的真实日常 Agent 验收，覆盖读取、proposal、人工确认写入、丢回包后按原 operationId 核对、取消与重启恢复；结论为 `JSO_AGENT_REAL_ACCEPTANCE_R1_PASS`。 |
| 10 月 26–27 日 | AIC-R1 与 JSO_AGENT_R2 | [#86](https://github.com/JENN2046/jenn-shooting-operations/issues/86) 将四仓集成收敛为 canonical paired CI、compatibility manifest 与 Trusted Action v1；Extensions [#28](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28) 完成 R2A/R2B/R2C，canonical compatibility release 晋升为 `JSO_AGENT_R2`，四仓 caller post-merge 均为 512/512 PASS。 |
| 10 月 27 日 | Product R1 Studio Day | [#90](https://github.com/JENN2046/jenn-shooting-operations/pull/90) 合入只读 Daily Operations 投影与「今日作业」第一屏；[#92](https://github.com/JENN2046/jenn-shooting-operations/pull/92) 完成 R1.1 UI polish。源码与 UI 已进 `main`，但父任务 [#89](https://github.com/JENN2046/jenn-shooting-operations/issues/89) 仍等待 Jenn 日常客户端真实使用验收，不能把 CI/浏览器 fixture 当作真实使用完成。 |

时间线的日期是代码合并或所述验收发生的日期；一项功能合并时尚未部署，不会因出现在表中就被记为当天已上线。

## 从计划图表到独立事实源

最初的 `jenn-shooting-planner` 把产品、任务、场次和视图偏好组织在一个图表对象中。拆出 JSO 后，SQLite 成为协作业务事实源；VCPChat 保留展示和交互职责，本机视图偏好不进入云端业务事实。同步使用版本核对和操作编号，断网时保留镜像与待核对操作，避免一次旧快照覆盖后来修改。原始边界见[初始执行计划](EXECUTION_PLAN.md)。

V2.1 进一步明确：`requests_v2` 是需求与可排工作项的稳定身份，`schedule_items` 是资源时间块，`production_runs` 是实际执行尝试。历史任务 ID 保留，组合场次通过关联表表达，不凭空拆成若干新任务，也不根据“计划时间已过去”制造实际执行记录。[ADP-019](architecture/decisions/ADP-019_CANONICAL_WORK_IDENTITY_AND_LIFECYCLE.md)记录了这一决定。

相应地，排期、执行和投影各自拥有版本。管理员改计划、现场登记完成、界面重新读取分别影响不同事实；它们不能共享一个含糊的“已完成”或“最新版本”标记。这是后续图表编辑、现场补传和 Agent 操作能够共存的基础。

## 从排程建议到正式安排

早期工作先建立确定性调度核心，再增加方案存储和正式采用接口。调度器依据明确的资源、日历、时长、缓冲与完整输入摘要生成 Proposal（待确认方案）；它不能从自由文本猜测样品已到、优先级或资源能力，也不能自行采用方案。相同输入应得到可比较的结果，人工确认后仍需在事务中复核版本与约束。[ADP-024](architecture/decisions/ADP-024_SCHEDULING_PROPOSAL_DETERMINISM_AND_SHADOW_EVALUATION.md)及 [#2](https://github.com/JENN2046/jenn-shooting-operations/pull/2)–[#5](https://github.com/JENN2046/jenn-shooting-operations/pull/5)构成这条主线。

随后加入不可变运行上下文、完成样本和离线影子评估，使估时与评估能够追溯到当时的输入、算法和事实。但合成样本通过，不等于已有足够真实摄影棚数据证明估时效果；这段开发不能被概括为“AI 已自动完成可靠排程”。

Kiosk 的开拍、完成和离线队列，以及事务 Outbox 的投递状态，也在这一时期建立。Outbox 解决业务提交与通知意图的关联，不等于钉钉已经真实发出通知。后来的 Schema12 新业务路径明确关闭外部通知，不能把早期适配器能力当成当前外发事实。

## 云端运行与旧域治理的转折

首次云端绑定时，目标上没有既有 JSO V1 正式库，因此引入新域部署路径，保留原来适用于“有旧源迁移”的合同。不能为了通过迁移检查，伪造一个不存在的旧库或附件复制结果。后续运行与 VCP 接入分别留下启用、读取、受控写入和回读证据；这比只确认 HTTP 健康更接近真实协作。见[首次新域部署说明](acceptance/WO-06E_GREENFIELD_PRODUCTION_AUTHORITY.md)和 [VCP 远程同步验收](acceptance/PROD-10_VCP_REMOTE_SYNC_EVIDENCE.md)。

10 月的 [Core 收敛](JSO_CORE_CANONICAL_R1.md)重新划定职责：订单、排程、业务身份、实际执行、审计和回执属于 JSO；通用传输、原生工具注册、窗口输入和宿主管理属于 VCP。不能让独立的宿主或生产控制实验无限成为业务核心开发的前置条件。

旧 G3 过程留下了两个必须保留的事实：Schema10→11 的物理切换已经完成；执行时的代码授权基线却与批准目标不一致。因此“数据库是 Schema11”没有自动带来合法的普通写入准入。随后一次回退尝试在持久认领后发生远端查询超时，未执行文件交换，但结果仍按 UNKNOWN 保留，不能换编号假装从未发生。见[物理切换终态](operations/G3_SCHEMA11_TERMINAL_COMMITTED_R1.md)、[授权绑定核对](operations/G3_AUTHORITY_BINDING_RECONCILIATION_R1.md)和 [UNKNOWN 恢复设计](operations/G3_ROLLBACK_UNKNOWN_RECONCILIATION_RECOVERY_R1.md)。

这些记录解释了旧域为什么曾持续停止，也解释了为什么不能把旧 README 的准备状态当成今天所有 JSO 实例的状态。旧 G3 的恢复参照与证据准备 [#63](https://github.com/JENN2046/jenn-shooting-operations/pull/63)截至本文仍未合并；后续新正式域走了独立接纳路线，没有通过改写旧审批来宣称旧事件已被追认。

## Schema12 与面向实际拍摄的产品能力

[#65](https://github.com/JENN2046/jenn-shooting-operations/pull/65)使启动和重启能够依据受信管理员安装的、精确绑定目标与备份的前瞻接纳材料进行校验。[#66](https://github.com/JENN2046/jenn-shooting-operations/pull/66)建立 Schema12 新域及五类订单：静物中的产品 3D 主图、细节图、功能图，以及模特、场景。这里的“产品 3D 主图”是拍摄分类，不表示系统具备建模或渲染服务。

这一阶段补上了普通业务闭环中的具体缺口：结构化新建订单、显式时长、样品资格、首次排程、实际开拍/完成、按实际开始计算的预计结束，以及整批时间调整。预计结束属于估计回执，不会改写实际事件；已完成、锁定或有执行记录的场次不能被拖动悄悄重排。版本、配置、预览摘要和整批影响必须在保存时再次核对。详见[首发业务路径](operations/first-launch-v3.md)与[动态时间调整](operations/dynamic-day-first-launch.md)。

[#67](https://github.com/JENN2046/jenn-shooting-operations/pull/67)–[#69](https://github.com/JENN2046/jenn-shooting-operations/pull/69)继续补齐参考图、上传收尾、看板和在线现场操作。它们分别解决“资料可见”“提交可靠”“实际发生了什么”，不能用看板状态推断现场已经开拍。新正式域的初始化、配置、接纳和实际启用也各有独立记录，空库初始化完成不等于业务已经开放。

## 原生对话与多端协作

[#70](https://github.com/JENN2046/jenn-shooting-operations/pull/70)把对话执行落到业务服务：业务身份、预览、确认、操作摘要与持久回执相互绑定；[#71](https://github.com/JENN2046/jenn-shooting-operations/pull/71)的 R5 接纳机制进一步绑定实际对话运行时与配置。模型提出调用、宿主取得实际输入、业务服务授权提交和数据库持久保存，是相邻但不同的步骤。[R5 说明](operations/NATIVE_VCP_STARTUP_R5.md)保留了这一边界。

后续的协作体验按小步补齐：管理页和编辑图表以约 5 秒的认证 HTTP 读取获取最新提交；现场队列保留点按时刻和原操作编号；R5 与受限 Kiosk 共存；管理员登录后可进入本人现场视图；公共只读看板默认关闭；未开拍场次可以在原北京时间日期内调整，包括未来日期。[#72](https://github.com/JENN2046/jenn-shooting-operations/pull/72)–[#77](https://github.com/JENN2046/jenn-shooting-operations/pull/77)记录了这些增量。

图表的约 5 秒补读不是 WebSocket 即时推送，也不是页面自动替用户保存。客户端断线或超时后，应核对原操作的回执，而不是生成新编号再提交一次。[现场协议说明](kiosk/ONLINE_V3.md)区分了在线接收时间、设备声明发生时间和服务器登记时间。

### 四个仓库的分工

| 仓库 | 在 JSO 中负责的部分 | 本次历史中的相关成果 |
|---|---|---|
| [jenn-shooting-operations](https://github.com/JENN2046/jenn-shooting-operations) | 业务事实、管理网页、排程、执行、审计和回执 | 主线 `main`，业务基线 `56b620b`。 |
| [VCPChat](https://github.com/JENN2046/VCPChat) | 通用图表宿主、窗口输入、保存与退出保护 | 日常 Chat 收敛到有效源码基线 `ff064b8`，保留既有本机扩展；不能用其保留的旧 Git HEAD 代替实际安装版本。 |
| [VCPToolBox](https://github.com/JENN2046/VCPToolBox) | 已认证工具入口、传输和服务桥 | 承接已有业务身份与 JSO 桥接，不成为第二个业务数据库。 |
| [VCPToolBox-JENN-Extensions](https://github.com/JENN2046/VCPToolBox-JENN-Extensions) | Jenn 的 JSO 适配器、编辑器和原生日历包 | 原生日历源码及修正汇入 [#24](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/pull/24)，合并 `6a6f0a9`。 |

## 日常客户端的真实验收

到 10 月 25 日，服务器能力与本机实际安装之间的差异成为必须闭合的问题。远端 PR 已合并、服务器 preview 成功、隔离 Electron 测试通过，都不能代替“日常 Chat 中确实能保存”。本轮先整理实际安装字节，保留 Crown/writer 等本机扩展，再使用腾讯开发机的既有 `vcptoolbox` 完成认证读取与原生窗口操作。

实际验收暴露出一条历史测试场次的未知占用：它已过计划时间，但没有实际开拍或完成记录。系统没有据此假定它已结束。Jenn 明确确认该旧测试未开拍且作废后，新增正规取消接口，将订单和唯一未开拍场次一起取消，保留 ID、原时间、绑定、审计和可查询回执。没有伪造实际完成，也没有放宽未知占用规则。[#78](https://github.com/JENN2046/jenn-shooting-operations/pull/78)记录了这项业务补齐。

随后在独立测试场次中完成 **09:00–09:30 → 09:15–09:45 → 09:00–09:30** 两次真实保存，并按两个原操作 ID 查回权威回执。当前日历拖动粒度为 15 分钟，不能把最初设想的 5 分钟称为已验收能力。日期和写准入在业务版本不变时也必须刷新；这项宿主缓存修正与原生日历源码一并归整到[扩展 #24](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/pull/24)。

同一轮还修正了成功读取后仍显示“正在读取”的文案，以及后台读取失败盖住待核对保存提示的问题。45 项相关回归和[远端 CI](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/actions/runs/40268496907)通过，三文件修正实际安装；ChartService 将图表代码版本从 1 升到 2，并保留旧源码历史。重开后界面显示成功读取，图表 stable，权威排程/投影版本仍为 9/14，原回执与空 pending 状态保持。

两次真实正常退出和重开也通过，第二次捕获退出码 0、用户 service 立即回收。历史约 90 秒的收尾等待本轮未复现，根因仍未确认；没有通过缩短超时或强制结束进程宣称修复。随后 #78 与扩展 #24 合并，并完成 `main` 更名。

## Agent 实际验收与兼容发布

10 月 26 日的 [#83](https://github.com/JENN2046/jenn-shooting-operations/issues/83) 首次把日常 Agent 链路作为一个真实组合验收，而不是分别引用四个仓库的局部测试。验收链路为：

`VCPChat → VCPToolBox → JENN Extensions → JSO`

该验收覆盖了只读查询、proposal、人工确认后的受控写入、响应丢失后的原 operationId reconciliation、取消 tombstone 和重启后的重复写保护。它证明的是当时冻结组合上的真实日常 Agent 行为，不能自动替代未来任意新 commit 的兼容性证明。

随后 [#86](https://github.com/JENN2046/jenn-shooting-operations/issues/86) 完成 AIC-R1，将四仓集成从一次性验收整理为机器可验证发布：

- Extensions 持有 JSO Agent compatibility manifest、paired harness 与 reusable workflow；
- VCPToolBox 持有通用 Trusted Action v1 normative contract；
- VCPChat 作为 consumer；
- JSO 继续只持有业务事实、Agent API 与业务授权。

Extensions [#28](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28) 最终完成 `JSO_AGENT_R2` compatibility advancement。当前 canonical immutable harness 为：

`a6c7d447ddaa29799c60aa109d5119b102d1eae4`

R2 固定的 accepted runtime component pins 为：

| Component | Accepted SHA |
|---|---|
| Extensions | `54b0bfb4d94bc9f3a53516cd4082fb7c4c6d351c` |
| VCPChat | `900fdda5e24347d802b738924d8456a42c01477f` |
| VCPToolBox | `b0552cd3e109a8cfe38ac5ee292cc026891d7442` |
| JSO | `bfaf4dfe1c6558beb0ff9113990946aa85a257a3` |

这组 pins 描述 **compatibility release 的已验收 runtime composition**，不是当前四个仓库所有后续文档、CI 或 UI commit 的 HEAD。R2C 之后的 caller-only 或产品 UI 提交会作为 candidate against accepted-other-three 运行 paired CI；不能因为 candidate CI 通过，就无条件把 compatibility manifest 的 accepted runtime pins 改成最新 HEAD。

## Studio Day 产品化

Product R1 [#89](https://github.com/JENN2046/jenn-shooting-operations/issues/89) 将现有订单、排程、执行与参考图事实组织成一个日常工作视图，而没有再创建第二套业务模型。

[#90](https://github.com/JENN2046/jenn-shooting-operations/pull/90) 新增只读 Daily Operations 投影和 `GET /api/v3/business/daily-operations`。它从现有 Schema12 facts 派生：

- 当天场次；
- 唯一当前执行场次；
- 下一场；
- 已到样且具备时长但尚未排期的订单；
- 确定性 attention queue；
- 当日摘要。

该投影不会因为计划时间已经过去就制造实际开拍或完成，也不会把 forecast 当成完成。多场执行中、占用事实不完整等情况显式进入 `UNKNOWN_OCCUPANCY`，而不是让 UI 猜一个“当前场”。

[#92](https://github.com/JENN2046/jenn-shooting-operations/pull/92) 的 R1.1 只做 presentation polish：压缩登录后首屏、给 attention severity 增加「阻塞 / 需核对 / 提醒」文字、在 UI 层去掉 `UNSCHEDULED_READY` 与可排订单区域的重复展示、强化当前/下一场主动作，并改善移动端触控和列表展开。它没有修改 Daily Operations read model、API、Schema、写权限、Agent command 或 business semantics。

当前源码已包含 R1 + R1.1，但 [#89](https://github.com/JENN2046/jenn-shooting-operations/issues/89) 仍保持 open。剩余验收是 **Jenn 日常客户端 real-use acceptance**：实际打开 Studio Day，核对今日/当前/下一场/待处理，并用独立测试订单或场次完成一个既有安全动作后按原 operationId 查回 receipt。完成前，准确状态为：

`JSO_PRODUCT_R1_REAL_USE_ACCEPTANCE_PENDING`

## 已完成与仍需区分的边界

| 事项 | 截至本文的准确状态 |
|---|---|
| 最新成果主线 | `main` 的当前产品代码基线为 `e5f3599e331d96bcf1dff5cdccc897330570c1f5`（#92）；后续 docs-only commit 可位于其上，这不等于所有环境已部署。 |
| 腾讯开发机日常图表 | 已完成认证读取、15 分钟后移保存、恢复保存、原回执核对及正常重开。该结论绑定当时版本与测试场次；不能自动覆盖 Studio Day 新 UI 的真实使用验收。 |
| Agent 集成发布 | #83 已完成真实日常 Agent 验收；#86 / Extensions #28 已关闭，canonical compatibility release 为 `JSO_AGENT_R2`。 |
| Studio Day | #90 / #92 已合入 `main`；#91 已关闭，父任务 #89 仍等待 real-use acceptance。 |
| 旧 G3 恢复路线 | #63 仍开放；不能将其设计和隔离证据记为已合并或旧域全面恢复。 |
| 现场离线能力 | 代码与隔离浏览器有相应验证；本次日常图表验收没有覆盖摄影棚设备的离线开拍、完成与恢复全过程。 |
| 身份暂时读取失败 | [#75 的 P2](https://github.com/JENN2046/jenn-shooting-operations/pull/75#discussion_r4307565194)仍未解决：本人现场初次身份/当天读取遇临时故障后，可能需要整页刷新或重新登录。 |
| 外部通知 | 新 Schema12 业务路径明确关闭外发；不把 Outbox 或钉钉适配器的实现称为真实发送成功。 |
| 其他客户端和环境 | Linux 本机的验收不能自动覆盖 Windows、其他电脑或腾讯稳定生产机；本轮没有对稳定生产机作变更。 |
| 退出等待 | 历史问题保留，本轮两次未复现；不把未复现写成根因已修复。 |

Schema12 是数据库结构版本，V3 是相应业务接口/分类协议，R5 是启动接纳合同，日历“代码版本 2”是单个图表的源码修订号。这些编号服务于不同对象，不能合并理解为一个产品版本。

## 后续如何延续开发记录

后续里程碑继续追加本时间线，写明解决了什么、采用了什么取舍、合并到哪个提交，以及部署和实际使用分别验证到哪一步。修复旧问题时链接原记录，不把旧失败删除为成功；若历史合同已被新范围替代，在入口标明适用对象和时间，保留原决定。

开发的三条经验已经具体化：业务事实由 JSO 持有；提交未知就查原回执；源码、部署和实际使用分别验收。后续工作可以沿用这些已存在的能力，不必为了文档完整再引入新的 Gate 或控制框架。
