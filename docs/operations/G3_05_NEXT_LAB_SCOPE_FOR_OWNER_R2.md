# 隔离验收批准提案 R2

状态：仅提案，未批准、未配置、未执行。适用代码为本任务交付的本地修复候选；执行前必须绑定其完整 commit/tree、审批库和各运行时指纹。旧 `NEXT_LAB_SCOPE_FOR_OWNER.txt` 和失败证据原样保留，本文件不追认旧尝试。

## 批准范围与最小权限

请求批准一次新的可丢弃非生产 KVM 来宾实验。使用已固定 SHA-256 为 `d1940f7d69d343355e183dff1e08a59852d32e7309baa7a4bad8365b11b005ac` 的 Ubuntu 镜像，2 vCPU、2 GiB RAM、8 GiB overlay、总实验时限 30 分钟。若镜像或必需依赖不在本地，不下载、不开放网络，停止报告。

为避免使用 HOME 覆盖或写入宿主 Jenn 的真实审批库，客户端和独立回放运行于来宾内固定 `jenn` 账号，系统账号记录指向 `/home/jenn`；远端传输使用另一个 `tester` 账号及来宾 loopback sshd。二者都不具 sudo、Docker 组或其他管理组权限；不沿用旧 `tester: ALL=(ALL) NOPASSWD:ALL`。Jenn 的审批与 ledger 目录仅 Jenn 可写，tester 不可读写；root 通过唯一绑定的本地虚拟串口部署源材料、校验主机密钥并启动一次性 witness。管理员属于既有 TRUSTED_HOST_ADMIN 信任边界。

这是一台机器内不同身份/独立进程的真实认证 SSH 验收，可验证入口和 ledger 行为，但不证明跨主机隔离或生产环境已适用。Jenn 与 witness 的管理员仍相同；不得描述成新增独立可信主体。独立回放必须另起进程读取固定 custody，不能复用采集器内存或改 HOME 指向归档。

与旧方案相比，不给来宾配置网络设备，不创建宿主 TCP 转发端口、桥接、TAP、路由或共享目录。SSH 仅监听来宾 127.0.0.1；没有互联网、生产、宿主服务、管理网络、metadata 网络入口。数据和代码只通过本轮绑定的串口或只读 seed 输入；不挂宿主 home、Docker socket、SSH agent 或生产磁盘。

## SSH 权限差异与可达资源

仅在新来宾的初始专用 sshd 配置中设置：`AllowTcpForwarding local`、`AllowStreamLocalForwarding local`，同时要求 `PermitOpen none`、`PermitListen none`、`MaxSessions 0`、`PermitTTY no`、`PermitUserRC no`、`AllowAgentForwarding no`、`X11Forwarding no`、`PermitTunnel no`、`PermitRootLogin no`、关闭密码及交互认证，仅允许 tester 的一次性公钥。MaxSessions 0 用于禁止 shell/exec/subsystem，保留转发；root 仅通过串口管理。不得直接套用旧 cloud-init/sudo 设置。

放宽 AllowTcpForwarding 是针对已存证 OpenSSH 9.6p1 对 Unix channel 的共同门禁拒绝；额外 PermitOpen none 用于禁止 TCP 目的地。须在实际来宾版本核对支持性和有效配置，不能把文档语义当实测成功。[OpenSSH sshd_config 文档](https://man.openbsd.org/sshd_config)支持这些配置项的语义，但不能替代本轮有效配置证明。

Unix 转发权限不等于“仅 capture.sock”：它仍可触达 tester 的 Unix DAC/ACL 允许访问的其他 socket。批准范围明确接受这一剩余能力，仅限无外部网络的合成来宾。执行者必须在发挑战前经独立串口盘点所有 pathname 和 abstract Unix listener、文件权限/ACL、进程和账号组；目标仅为 `/run/jso-g3-r2/capture.sock`。若发现 tester 可用的其他管理/敏感 socket、Docker socket、跨身份 ledger 或未知 listener，则停止；不得现场试探或临时 chmod 消除阻塞。客户端固定 argv 不作为服务端 socket-only 授权证明。

## 执行前有效隔离核验

先记录本轮 UUID、镜像/overlay/seed hash、QEMU PID 与启动时间、完整 argv、串口路径及所有本轮资源。通过宿主进程/监听清单确认没有 hostfwd、外部网卡、共享设备；通过独立来宾控制台核对 boot/instance ID、仅 loopback 的接口和路由、sshd 监听地址、针对 tester/loopback 连接条件的 `sshd -T -C` 输出及配置来源、完整 sudo 授权和组清单、authorized_keys 托管、endpoint 父链、运行时/代码 pin、Jenn 固定 home 和 custody 权限。只读盘点无法证明边界时即停止，不以 QEMU 存在替代内部授权核验。

不得用攻击载荷或旧失败 challenge 验证隔离，也不得为了完成验收增加回退路径。上述初始配置不能在拒绝之后继续放宽。若实际版本不支持组合或仍拒绝 Unix channel，保留失败并停止。

## 一次性流程与限额

所有预检通过后，预先绑定本轮生成的 UUID、账号 UID/home、运行时、代码、审批库/source chain 和公开密钥指纹，明确标记 ISOLATED_VALIDATION_ONLY。该绑定是本批准范围的实例化，不能赋予生产权威。未取得对本提案的明确批准不得开始创建资源或实例化权限。

root 经串口独立启动一次性 endpoint；Jenn 签发一个全新 challenge，仅做一次无 session 真实采集，再由独立 Jenn 进程进行一次 require-fresh 回放。挑战自签发起 300 秒；witness 最多 120 秒 wall / 60 秒 CPU / 256 MiB 地址空间，副本总计 8 MiB，stdout/stderr 各至多 1 MiB，保持现行 frame/SSH stream 上界，不扩大限额。保存原始字节、ledger、审批/source 材料、witness 与 tunnel 两套 terminal、良性启动 sentinel、原始合成数据库不变性和清理记录。仅合成数据库；不重跑旧 challenge、E1/E3 全矩阵或真实 Docker 重建矩阵。

Docker P1 本轮只请求后续独立代码审查与普通回归，真实 root/Docker 执行不包含在本批准中。不能因 SSH 成功把 Docker P1 一并宣布实测关闭。

## 清理责任、停止条件及验收门

执行本实验的 Codex 负责在成功或失败后归档原文并校验哈希，再清理本轮清单内确定身份的 endpoint、进程、VM、overlay、seed 和临时私钥；保留公开材料/必要证据，验证退出、socket/进程消失以及没有宿主 listener。若进程/资源归属不明，只报告精确残留，交 Owner 处置，不能按通配符删除或宣告完成。30 分钟到期或任何前置约束失败即结束实验并清理。

拒绝、输出不全/超限、超时、状态 UNKNOWN、UID/home/指纹漂移、可达范围超标、发现全权 sudo、配置不符、异常副作用或清理未证实：保存证据，停止，不重试、不改权限、不换传输路线。旧失败仍为 sshd 主动拒绝且 UNKNOWN；与本任务沙箱 UID 映射导致的普通测试失败明确区分。

即使本轮采集成功，三个 P1 仍分别需要证据核验、独立增量审查、精确 head 的回归/CI 和新的合并批准。历史 WAL 完整性 NOT_PROVEN，G3-05 BLOCKED，生产/G3-06/writer/服务仍未授权。

## 合并批准请求

请批准：按本文件 R2 范围创建上述唯一离线可丢弃来宾，配置两名无 sudo 的实验账号、一次性密钥及限定 loopback SSH 转发策略；在预检全部通过后运行一个新 challenge 的采集与独立 fresh 回放，归档并清理。本次不包含推送、GitHub 回贴/关闭线程、合并、生产操作或真实 Docker 重建。

需要明确批准的依据是用户本轮硬边界：尚未批准改变 SSH/网络/安全设置、创建实验凭据、启动新虚拟机或真实 SSH 实验。批准前停在此处。
