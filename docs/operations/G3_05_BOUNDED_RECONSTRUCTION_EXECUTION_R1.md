# G3-05 有界隔离重建执行审批包 R1

状态：工具及合成验证完成，独立实现复审通过；**等待 Owner 对本包的一次真实执行授权**。未执行真实恢复包重建。G3-05 仍 BLOCKED，现有 E3 的 preserved `2/2` 拒绝逻辑保持不变。

任务 ID：`G3_05_BOUNDED_RECONSTRUCTION_EXECUTION_R1`。基线 `7328bc2a7cfa17f125cba79e6fb53a08ad89e734`。这次仅增加档案副本重建工具，不改业务、比较器合同或 runtime 开关。

## 本次要回答的问题

以独立保存的 Schema6 main/WAL 家族为起点，在原镜像内使用原迁移 7–10，显式关闭并重新打开，和已保存的 Schema10 main 对账。若相符，仅证明这两个固定档案对象之间存在所审查的重建关系。

不能据此证明历史抓取覆盖全部已提交事务、当时没有未知写入、历史 `journalMode` 字段来源、当前生产 preserved 与档案的连续绑定，也不签发生产 E3 准入。即便结果成功，仍需独立裁定本次补证支持范围，再决定是否存在可接受的最小 E3 适配依据。

## 固定对象

执行主机：`ubuntu@159.75.139.246`，期望 hostname `VM-0-12-ubuntu`。Jenn 本机负责调度及独立保存回执。沿用正常 SSH known_hosts 校验，不使用密码回退、代理转发、跳过主机校验或权限绕过。

归档基目录 `/home/ubuntu/G3-PREP-SOURCE-ALIGN-6-TO-10-20261006-01`：

| 对象 | 大小 | SHA-256 |
|---|---:|---|
| `recovery-family.tgz` | 30153 | `5c7e9a17d9762e8fb31d534e03ea2285182e44a82ddbaf6863f10b655989b103` |
| `schema10-prestate/recovery-family.tgz` | 19385 | `f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef` |

Schema6 精确成员顺序：`.` 目录、`./shooting-operations.sqlite-wal` 609792 字节、main 4096 字节、SHM 32768 字节。Schema10：`.` 目录、main 512000 字节。每个成员摘要已固定在 Python `SPECS` 中；拒绝缺失、多余、重复、链接、扩展元数据及大小/摘要差异。不会调用通用 tar 解压来处理真实恢复包。

原镜像 `sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144`（amd64），原源码 `6334e2ae851247cb1558074fbd80cfee06b28c11`；要求 Node `v24.21.0`、SQLite `3.53.4`。不拉取、不重新构建、不启动原镜像业务入口。

工具包 `g305-reconstruction-tool-r1.tgz`，7544 字节，SHA-256：
`72f3354d48ef6e4521ed27fe74473cc9d18c7120d589b2460bfe22436c87a360`

仅含以下两文件和 `SHA256SUMS`：

| 文件 | SHA-256 |
|---|---|
| `g3-bounded-reconstruction.py` | `5540c2c1d36fb1c15aeef5703f09e0cd1e28e7058d6fbcae3c5f0a560319ad3d` |
| `g3-bounded-reconstruction.mjs` | `04e2d0897503b34ebc82e2b27715fe48fa25a834bd65e1637f8b6b94495a099f` |

## 隔离和比较约束

- 宿主以 `O_NOATIME`、逐级 `O_NOFOLLOW` 打开档案，核对前后文件及父链身份，运行结束再次核验归档。不能满足权限时拒绝，不降级普通读。
- 新建 root 私有 `/var/tmp/jso-g305-reconstruction-7328bc2-r1`；必须不存在且与 `/mnt/datadisk0` 不同设备，启动前可用空间至少 1 GiB。宿主只保存有界输入副本及只读工具，容器仅挂载输入和工具为只读。
- 容器 `/work` 为 32 MiB tmpfs，`/tmp` 16 MiB，`/app/data` 1 MiB；只读根文件系统、UID/GID 1000、网络 none、无端口、无 Docker socket、drop ALL、no-new-privileges、禁用 healthcheck/restart/log driver。
- 内存及 swap 总上限均 256 MiB、CPU 1、PID 64、Node heap 128 MiB、禁止 core dump。单次 create 20 秒，运行 120 秒；每个管理调用另有 15–20 秒超时，不误称整体仅 120 秒。stdout/stderr 各 1 MiB 流式上限。
- 归档压缩输入各限 8 MiB，解压 tar 各限 16 MiB，且真实对象必须满足更小的精确大小。SHM 原件保持，只在工作副本重建 SHM。只在 tmpfs 副本发生 WAL 恢复、迁移和关闭；不对生产数据库 checkpoint、转换或恢复。
- 比较 schema、列、外键、索引及索引结构、属性、全部表/内部表、行数、rowid 和类型保持的行多重集；INTEGER 保留 BigInt，TEXT/BLOB 保留原字节。执行 integrity_check、foreign_key_check。
- 仅允许迁移标记 7–10 的 `applied_at` 不同；两端标记名称/校验值和时间格式必须有效，重建时间在本轮窗口内，标记 1–6 原样保留。不会把参考库时间回填重建库。
- 不修改共享 Docker 父目录权限、不停共享 Docker、不挂载 active/preserved、不启动业务、不生成实际采纳身份，不修改当前 writer 门禁。

## 审批后的一次执行顺序

以下命令是审批内容，尚未运行。SSH 统一选项：`-F /dev/null -i /home/jenn/.ssh/TXY_159_75_139_246_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ForwardAgent=no -o ConnectTimeout=10`。工具包来自 Jenn 本机 `artifacts/g3-05-r1/reconstruction-implementation-r1/`。

1. 在 Jenn 新建权限 0700 的本任务存证目录（已有目录则停止），保存 Owner 批准文本、本审批包、工具包摘要、SSH 目标及 UTC 开始时间。对远端 hostname、`sudo -n` 可用性、镜像 ID、无既存本任务目录做只读复核。任何不一致停止。
2. 通过该 SSH 通道在远端以 `mkdir -m 700 /home/ubuntu/g305-reconstruction-transfer-r1` 原子新建传输目录。用相同 SSH 选项的 scp 传送固定工具包到该目录。核对精确大小及上面的包摘要；不一致停止，绝不执行包内容。
3. `sudo -n mkdir -m 700 /var/tmp/jso-g305-reconstruction-tool-r1` 原子新建工具目录。仅对已核验工具包执行 `sudo -n tar -xzf /home/ubuntu/g305-reconstruction-transfer-r1/g305-reconstruction-tool-r1.tgz -C /var/tmp/jso-g305-reconstruction-tool-r1 --no-same-owner --no-same-permissions`。执行 `sudo -n sh -c 'cd /var/tmp/jso-g305-reconstruction-tool-r1 && sha256sum -c SHA256SUMS'` 并与本审批包的两项摘要核对。记录目录及文件身份。
4. 通过同一认证 SSH 通道执行**一次**：

   ```sh
   sudo -n python3 /var/tmp/jso-g305-reconstruction-tool-r1/g3-bounded-reconstruction.py --execute-approved
   ```

   Jenn 将 stdout、stderr、SSH 退出码分别保存为权限 0600 文件，随后计算本地 SHA-256。不通过终端复制重建回执，不从远端拷贝数据库或业务行。`--execute-approved` 是防误触开关，不代表工具能够认证 Owner 的授权。
5. 正常返回必须同时满足：SSH 退出 0、JSON 状态 `LIMITED_RECONSTRUCTION_EVIDENCE`、两个档案摘要及 runner/image 与本包一致、`archivePostcheck:true`、`scratchRemoved:true`、三个资格字段 `productionAdmission/historicalCoverageProven/livePreservedBound` 均为 false。通过认证 SSH 独立复核回执中的精确容器不存在、scratch 不存在。保存结束时间、核验结果、本地存证摘要。
6. 限定清理传输和工具目录：先对步骤 2/3 登记的目录身份及已知文件摘要核验，只删除已知文件（传输包、工具两文件、SHA256SUMS 按各自目录逐项处理），再 `rmdir` 对应目录；若出现未知文件、身份变化或拒绝，则保留并报告。不得用 Docker prune 或清理其它目录。保留 Jenn 上的审批、回执、日志、摘要及独立复核记录。
7. 独立复审本次有限补证；向 #57 回贴低披露结果及其限制。该步骤不自动解除 G3-05 BLOCKED，不推进 G3-06，不启动 writer/服务。

## 部分失败与保留责任

执行工具在成功或失败路径都尝试按精确容器名及所有权 label 删除本次容器，再按 scratch 原 inode 清理本次目录。输入档案始终保留。删除容器成功后 tmpfs 消失；生产保护状态不在本工具修改范围内。

若 SSH 中断、create 结果未知、管理调用超时、守护进程异常或清理未确认：结果记 UNKNOWN/BLOCKED，**不自动重试**，不宣布通过。失败 JSON 提供固定原因和已知本次容器身份，并要求独立核查。调度者负责查询已登记身份；身份确认前不扩大删除范围，无法证明清理完成则保留目录/状态供 Owner 处理。不得因未看到容器就推断尚在进行的 create 一定没有发生。

若对账拒绝，报告“本次重建不能提供所需证明”，不自动宣布历史数据损坏、不改原件、不自动 rollback。

## 验证和复审

Jenn 本机原镜像合成验证 **18/18**：归档/成员绑定、链接与展开限制、限定挂载；实际 WAL 重建、BigInt/BLOB 正常输入及整数差异、旧标记时间差异、错误源版本、Unicode/NUL、无效 UTF-8 字节一致和不一致、运行超时、输出超限、32 MiB 空间超限及清理。未重跑已经通过的 E1/E2 实验。

```sh
JSO_RECONSTRUCTION_DOCKER_TEST=1 python3 -m unittest discover -s tests -p test_g3_bounded_reconstruction.py -v
```

Node 测试入口 `tests/g3-bounded-reconstruction.test.mjs` 在常规 CI 执行归档防护测试；真实原镜像 Docker 合成测试仅在显式设置上述环境变量时执行，不能将 CI 的跳过项误报为已执行。

独立实现复审：`PASS_FOR_EXECUTION_PACKET_PREPARATION`，绑定上面两项源码摘要。已修复 TEXT 字节保真及 scratch 无容量上限两项发现，另补流式输出上限、失败身份、归档末尾及父链复核。这不是本次真实执行授权。
