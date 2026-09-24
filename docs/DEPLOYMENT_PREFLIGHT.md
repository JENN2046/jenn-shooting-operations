# 腾讯云部署前检清单

状态：历史部署前参考；生产部署未执行。

> Authority note: 当前生产变更与授权事实以 `docs/work-orders/WO-06_PREDEPLOY_INTEGRATED_READINESS.md`、
> `docs/acceptance/WO-06D_PRODUCTION_CHANGE_MANIFEST.md` 和
> `docs/operations/production-change-manifest.v1.json` 为准。本文件保留历史证据，不得单独作为部署授权依据；
> 若与 WO-06A/B/C/D 冲突，必须服从当前 WO-06 authority。

## 本地证据

- 当前 VCP 工作台数据可映射到 v1 契约。
- 服务权限、幂等、版本冲突和非法快照均有自动化测试。
- 历史环境曾验证 VCP 同步客户端的本地 HTTP 拉取/写入/再拉取闭环；当前 authority 仍以 WO-06C `BLOCKED_EXTERNAL_RUNTIME` 为准，独立仓库中的 VCP skip 不构成真实兼容性 PASS。
- 浏览器已验证需求提交后进入待排池。
- 图片与附件上传已覆盖类型白名单、文件签名、单文件数量与总容量限制。
- 2026-09-22 已在本机构建 `jenn-shooting-operations:local-preflight` 镜像。
- 临时容器以 `node` 用户运行，只绑定 `127.0.0.1`，`/healthz` 烟测通过；测试后
  容器已停止并清理。
- 使用合成 Token 的 `docker compose config --quiet` 解析通过；未读取或写入真实凭据。

## 部署目标约束

- 使用现有腾讯云 Ubuntu 实例。
- 使用独立容器名、独立数据卷和独立反向代理路径。
- 应用容器只暴露给服务器本机反向代理，不直接开放应用端口到公网。
- 公网只保留 HTTPS；HTTP 仅用于跳转。
- 不读取或改动现有容器的环境变量、数据库或卷。
- 部署前再次确认磁盘余量、端口、容器名和反向代理路由没有冲突。

## 必须在部署时生成的秘密值

- viewer token
- submitter token
- scheduler token
- administrator token

四个值必须独立随机生成，只写入服务器受限配置，不进入 Git、聊天记录、
部署文档或命令输出。

## 部署动作

以下动作属于生产部署门，尚未执行：

1. 在服务器创建独立应用目录与持久化卷。
2. 上传经过检查的源代码或构建上下文。
3. 在服务器生成并安装四类 Token。
4. 构建镜像并启动容器。
5. 验证容器健康检查和本机回环访问。
6. 配置反向代理路径与 HTTPS。
7. 调整安全组或防火墙（仅在确有需要时）。
8. 导入现有工作台数据作为初始版本。
9. 在 VCPChat 中启用服务地址和 scheduler token。
10. 完成手机提报、工作台排班、看板更新和回滚演练。

## 回滚点

- 部署前不接管任何现有域名或路由。
- 新容器、新卷和新反向代理片段保持独立。
- 回滚时先移除新路由，再停止新容器；不删除数据卷。
- VCPChat 未启用云配置时继续使用现有本地数据文件与 localStorage 镜像。

## 已知后续维护项

孤立上传维护命令已经实现：`npm run uploads:cleanup` 默认使用只读数据库连接做
dry-run，只报告超过保留期且未绑定任务的候选数量；`--apply` 必须显式提供才会
删除。生产启用前仍需对目标数据库先运行 dry-run 并人工核对，不得删除已经绑定
到任务的图片或附件。

VCP 同步集成测试依赖工作区外部适配器。适配器存在时 `npm run check` 会执行真实
本地联调；独立仓库环境中缺失时会明确标记为 `SKIP`，其余合同、服务与 UI 测试
仍必须通过。

## 部署授权边界

执行上传、生成生产 Token、启动容器、修改反向代理或安全组之前，需要 Jenn
对本清单所列生产部署动作给出当前明确授权。
