# JSO 当前系统架构与启用边界

更新日期：**2026-10-30（Asia/Shanghai）**。这是当前实现及启用状态的说明图，不新增架构决定、权限或生产启用授权；历史冻结基线仍由[架构基线索引](ARCHITECTURE_BASELINE_INDEX_V2.1.md)管理。

当前阶段：**独立应用已上线；VCP 兼容代码已部署；日常客户端 Owner 会话已通过真实 WSS 只读核验；原生业务写入、生产准入与最终业务验收尚未完成。**

## 1. 组件与数据权威

箭头表示调用或依赖。实线为当前可用的应用/只读调用及内部实现关系；虚线为尚未启用并完成实机验收的原生业务写入链。黄色节点包含尚未放行的业务能力，不表示其全部代码未运行。图按逻辑边界组织，不表示服务器数量或物理位置。

```mermaid
flowchart TB
    OWNER["Jenn / 本人"]
    MODEL["模型 / Agent<br/>只读与建议，不产生权限"]

    subgraph CLIENT["使用入口：浏览器与 VCPChat"]
        WEB["JSO 管理页 / 今日作业"]
        CHAT["日常 VCPChat"]
        MAIN["可信主进程<br/>原生输入、展示核对、连接绑定<br/>Owner 会话已通过只读核验"]
        CHART["VChart<br/>派生显示，不保存业务权威事实"]
    end

    subgraph VCP["VCP 适配边界"]
        TOOLBOX["VCPToolBox<br/>标准工具调度"]
        READ["Jenn Extensions / JSO 适配器<br/>当前策略：read-only"]
        NATIVE["原生 WSS / stdio 会话链<br/>宿主只读核验已启用；业务写入关闭"]
    end

    subgraph JSO["JSO：Node.js 模块化单体"]
        BUSINESS["业务 HTTP<br/>可信身份、角色、资源与能力校验"]
        AGENT["Agent API<br/>固定工具契约、身份与资源校验<br/>写入另需精确授权"]
        DELEGATE["Owner 会话 / 精确委托<br/>会话校验已通；业务委托未放行"]
        APP["应用命令 / 业务校验 / 事务<br/>订单 → 排程 → 生产执行"]
        SCHED["确定性排程核心<br/>预览与方案，不自动采用"]
        VIEW["只读派生视图<br/>Daily Operations / 今日作业"]
        DB[("SQLite Schema12<br/>规范事实、revision、业务回执<br/>授权消费证据、既有 Outbox")]
        FILES["附件存储<br/>上传元数据与业务引用由 JSO 管理"]
    end

    OWNER --> WEB
    WEB --> BUSINESS
    BUSINESS --> APP
    BUSINESS --> VIEW
    VIEW -->|"读取规范事实"| DB
    APP --> SCHED
    APP -->|"事务提交事实与业务回执"| DB
    APP --> FILES

    MODEL --> CHAT
    CHAT --> TOOLBOX
    TOOLBOX --> READ
    READ -->|"授权范围内读取 / 预览"| AGENT
    AGENT --> APP
    READ -->|"状态快照"| CHART

    OWNER --> CHAT
    CHAT -->|"本机会话绑定"| MAIN
    MAIN -->|"已核验：status / recover"| NATIVE
    NATIVE -->|"只读 Owner 会话校验"| DELEGATE
    NATIVE -. "改期 / 完整采用 / 原回执恢复" .-> AGENT
    DELEGATE -. "精确授权校验" .-> AGENT

    classDef pending fill:#fff4d6,stroke:#996b00,color:#422f00,stroke-dasharray:5 5;
    class NATIVE,DELEGATE pending;
```

- **JSO 是业务事实的权威。** 订单、场次、任务绑定、生产事件及业务回执保存于 SQLite；VCPChat、VChart、模型输出和备份都不是第二套可独立写入的业务库。
- **JSO 保持模块化单体。** 图内的 HTTP、授权、排程、投影和事务是职责边界，不是需要分别部署的微服务。三种 revision 分别约束排程、单场执行和派生投影。
- **浏览器现有业务权限与原生接入分开。** “原生写入未启用”不表示 JSO 管理页全部只读；管理页继续走既有认证、预览、确认和回执语义。
- **标准模型工具入口保持只读。** 生成方案属于建议；模型、提示词、`approved=true` 或工具参数均不能产生 Owner 身份或写入授权。
- **附件字节与数据库需一起恢复。** 数据库保存上传元数据和业务引用，备份校验同时检查附件完整性。

## 2. 原生改期 / 完整采用的执行与恢复设计

以下绘制已实现并通过隔离测试的“先预览展示、再本人确认”路径，**不是当前生产原生写入已经开启的证明**。既有精确原生改期指令的直办分支未在此展开，仍受真实来源、会话及精确授权校验约束，不改变本轮逐次业务写入确认要求。本轮仅覆盖改期与完整采用；部分采用、批量操作及其他业务写入不在本轮原生验收范围内。

```mermaid
sequenceDiagram
    actor Owner as Jenn / 本人
    participant Main as VCPChat 主进程
    participant Host as ToolBox 原生宿主
    participant Ext as Extensions 会话适配器
    participant JSO as JSO 授权与业务边界
    participant DB as SQLite

    Note over Owner,DB: Owner 只读连接已核验；原生业务写入仍需生产准入与逐次本人确认
    Main->>Host: 认证会话中的读取 / 提案请求
    Host->>Ext: 宿主绑定上下文与受限调用能力
    Ext->>JSO: read_state / preview_shift / generate_proposal
    JSO-->>Ext: 规范状态与预览，预览不提交业务变更
    Ext-->>Main: 改期影响 / 完整采用的全部项目
    Main->>Main: 核对实际展示、来源及当前连接
    Owner->>Main: 针对本次具体动作的本人确认
    Main->>Host: 当前原生输入与来源绑定
    Host->>Ext: 传递受验证的本次调用上下文
    Ext->>JSO: Owner 精确委托：动作、来源、命令摘要、资源与期限
    Ext->>JSO: reschedule / adopt_proposal（固定原操作 ID）
    JSO->>DB: 先持久化授权消费证据
    Note over JSO,DB: 授权消费不等于业务提交；同一来源不能再次派发
    JSO->>DB: 独立业务校验后，事务提交事实与业务回执
    alt 收到确定提交结果
        JSO-->>Ext: 业务回执
        Ext-->>Main: 提交结果与最新状态投影
    else 回复丢失、超时或结果不确定
        Ext->>JSO: 仅 read_receipt，使用原 operationId / decisionId
        JSO->>DB: 读取并核对原回执、完整资源范围与摘要
        JSO-->>Ext: 可核验回执，或继续待核对
        Note over Main,DB: 不自动重发，不更换操作 ID，不以新授权恢复写入资格
    end
```

具体边界：

- Owner 与执行者均须覆盖目标资源；Owner 会话、Agent 身份与宿主凭据分离，凭据不进入模型或插件参数。宿主给子进程的是短期受限调用能力。
- 改期与完整采用使用各自的业务标准化和校验。完整采用必须展示全部项目，并通过操作者核实的 synthetic/non-customer 订单白名单；预览混入白名单外项目时拒绝整个方案，不裁剪后冒充完整采用。
- 方案展示、来源或连接变化后，旧确认资格失效；实际提交仍受权限、期限、当前 revision、业务约束和事务内执行检查约束。
- 直接提交响应与回执查询分开校验。采用恢复必须有 `kind=proposalDecision`、原 `decisionId`、匹配的完整 `resourceScope` 及决定摘要；缺失则保持待核对。改期继续使用原 `operationId` 和独立的资源校验。
- 业务库中的授权消费证据是防止重复派发的持久记录；VCP journal 保存来源、操作标识和待核对状态。journal 不是业务事实权威，也不会把重启前的确认资格恢复为新授权。

## 3. 当前状态与证据边界

截至 **2026-10-30**：JSO 镜像与 #96 部署记录相符；ToolBox 的只读原生核验通道已启用，策略仍为 `read-only`；错误 Owner 凭据被拒绝；公网原生 HTTP 已封闭，核验走既有认证 WSS。日常 Windows 客户端已实际收到成功的 Owner 会话核验回复，记录与本次启动 UUID、客户端 UUID 和主进程 PID 对应。

Owner 凭据经受控启动只进入进程内存：启动器仅向本次 Electron 启动显式提供引用，其他探测子进程使用去除 Owner 的环境；主进程捕获后移除该环境引用，不再向插件继承。不写入绑定 JSON、诊断文件或持久系统环境。诊断只表示最近一次会话核验成功，**不证明本人已确认业务动作，也不构成生产客户端准入**。`vcp_chat.c2` 仍为 `PRODUCTION_DISABLED`，原生业务写入没有开启。

| 层次 | 已具备 / 已部署 | 尚未完成或不能据此推断 |
|---|---|---|
| JSO 独立应用 | Schema12 / V3 订单、排程、生产执行、附件与今日作业；生产兼容更新已应用 | Studio Day 的当前日常客户端完整验收仍由 #89 收尾 |
| 标准 VCP 工具 | 授权范围内读取、预览及原改期回执探测通过；适配策略保持 `read-only` | 模型工具调用不获得写权限 |
| 原生改期 / 完整采用 | #96 / 扩展 #32 / ToolBox #300 的兼容代码已合并部署；针对性与跨仓库隔离测试通过；宿主只读核验可用 | 生产客户端准入、写入拒绝路径、两类逐次确认业务写入及原回执核对 |
| VCPChat / VChart | #79 的内存凭据隔离与最小诊断已应用，实际日常客户端 Owner 会话只读核验通过；保留原有展示与投影实现 | 本轮未通过真实客户端执行业务写入；源码、UUID 和诊断文件都不授予写权限 |
| Kiosk / 现场与通知 | 既有代码能力与独立授权边界；Outbox 属于业务数据 | 本图未重新验收 Kiosk 启用状态，也不表示真实外部通知已开启 |
| 备份 / 回滚 | 部署备份及恢复副本核验；最新业务库与 VCP journal 的隔离恢复测试 | 实际版本两端协同回滚的最终验收仍待完成；不得用旧快照覆盖后续新写入 |

部署对应代码：

| 仓库 | 合并提交 | 更新内容 |
|---|---|---|
| JSO | [`f39be58`](https://github.com/JENN2046/jenn-shooting-operations/pull/96) | 动作绑定的 Owner 委托、完整采用和 scoped 回执 |
| Jenn Extensions | [`9f99d81`](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/pull/32) | 原生完整采用、白名单、展示与未知结果恢复 |
| VCPToolBox | [`0e3a1cd`](https://github.com/JENN2046/VCPToolBox/pull/300) | 在现有运行基线上补齐 broker 支持，保留 NativeSync |
| VCPChat | [`20268e7`](https://github.com/JENN2046/VCPChat/pull/79) | 最小会话诊断与进程内凭据隔离；日常安装按文件应用，保留 NativeSync 与原有主进程逻辑 |

JSO 生产 Node 为 **24.22.1**。这些部署提交不自动改变已接受的 `JSO_AGENT_R2` compatibility release pins；历史 #83 验收只证明其当时版本与场景，不能替代当前日常客户端验收。本文的当前集成批次也不构成新的兼容发布。

## 4. 维护与进一步阅读

- [JSO Agent API v1](../JSO_AGENT_API_V1.md)：工具契约、精确授权、授权消费与原回执恢复。
- [R5 原生接入](../operations/NATIVE_VCP_STARTUP_R5.md)：启动组合、身份分离与准入材料。
- [今日作业只读投影](../DAILY_OPERATIONS_V1.md)：从既有规范事实派生日常运营视图。
- [架构基线索引](ARCHITECTURE_BASELINE_INDEX_V2.1.md)：冻结决定与历史替代关系。
- [真实日常使用验收 #89](https://github.com/JENN2046/jenn-shooting-operations/issues/89)：原有产品验收及未完成项。

启用状态、组件职责或事实权威边界变化时，同步更新本文的日期、图、状态表和代码证据。启用某一条虚线前，先取得该路径的实际验证结果；文档提交本身不启用任何运行能力。
