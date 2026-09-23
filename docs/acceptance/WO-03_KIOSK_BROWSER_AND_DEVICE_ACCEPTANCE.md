# WO-03 Kiosk Browser and Device Acceptance

- 状态：`PASS_WITH_LIMITS / BROWSER_AND_DEVICE_NOT_RUN`
- 基线：`JSO-ARCH-V2.1-R4`、ADP-021
- 范围：WO-03D 的静态 UI、轮询、控制权提示、可访问性基线和后续真机检查计划
- 不代表：production-ready、真实鉴权可用、真实设备已验收、服务已启动、已部署

## 1. Playwright 判断

本批不引入 Playwright：当前前端是零构建原生 HTML/CSS/ESM，仓库没有浏览器自动化依赖；加入 Playwright 会新增 lockfile 变化、浏览器二进制和缓存，并要求建立本批未授权的服务面。当前已授权范围可由 Node 单元测试、纯 transport/storage fake、静态资源真实流式读取和源代码检查覆盖。

该决定只适用于本批。后续若授权 loopback 服务与浏览器二进制，可在独立工作包中补充真实浏览器自动化，不得把本文件当作免除真机验收的依据。

## 2. 已执行的本地证据

- [x] `start/block/resume/complete` 控件、complete 二次确认和 blocking reason 校验；
- [x] `blocked → complete` 在 UI 派生状态中失败关闭；
- [x] server confirmed state 与 local pending/sync state 分开展示；
- [x] 当前与下一场显示全部任务，grouped 场次显示固定未分摊提示；
- [x] 可见时 3 秒轮询，失败指数退避上限 30 秒，恢复可见立即刷新；
- [x] Web Locks 为首选，localStorage lease 为 UX fallback；服务端幂等与 revision 仍是安全边界；
- [x] 触控目标最小 48px、键盘 focus、语义 label、live region、reduced-motion 和响应式断点有静态测试；
- [x] `/kiosk` 与四个 Kiosk 资产通过固定白名单返回，并继承 CSP；HTML 为 `no-store`；
- [x] UI 无 V1 写路径、token、actorId、role、真实 endpoint credential 或外部 URL；
- [x] 未启动服务、未访问真实库、未调用真实身份提供方、未产生外部通知。

## 3. 浏览器视口计划

以下项目本批均为 `NOT RUN`，不能由静态测试替代：

- [ ] Desktop：1440×900，键盘完整操作、焦点顺序、dialog 返回焦点、长任务名换行；
- [ ] Tablet landscape：1024×768，四操作按钮触控、状态条换行、断网恢复；
- [ ] Tablet portrait：768×1024，当前/下一场堆叠、软键盘下 blocking form；
- [ ] Mobile：390×844，双列操作按钮、safe-area、200% zoom、屏幕阅读器朗读；
- [ ] Chromium/Safari 实测 Web Locks 支持差异和 lease fallback；
- [ ] DevTools offline/online、刷新、双标签、并发 start、409 conflict、202 reviewRequired 的可见反馈。

## 4. 摄影棚真机检查表

以下项目必须在具有测试身份和隔离测试数据的受控环境中执行；当前全部 `NOT RUN`：

- [ ] iPad/现场平板打开明确 `resourceId` 的 Kiosk URL，未配置身份时失败关闭；
- [ ] 横竖屏、自动锁屏恢复、弱网、断网和重新联网；
- [ ] 连点与双标签竞争不会产生重复事实，非控制标签明确只读；
- [ ] 离线 `start → block → resume → complete` 严格顺序重放；
- [ ] blocked 状态无法直接 complete；
- [ ] conflict/reviewRequired 停在队首，不自动 rebase 或跳过；
- [ ] 清空浏览器缓存只清除本地交付状态，不改变服务端事实；
- [ ] grouped 场次显示全部任务且不误导为单任务工时；
- [ ] 真实屏幕阅读器、外接键盘、触控命中区域和摄影棚照明下的对比度；
- [ ] 操作者退出、身份过期和设备交接流程。

## 5. 放行边界

WO-03D 可在“本地实现完成、浏览器与真机未执行”的边界上记为 `PASS_WITH_LIMITS`。在以上未执行项关闭、真实身份接入通过独立门禁、隔离环境验证完成之前，Kiosk 不得标记为 production-ready，也不得部署、切换或用于真实拍摄事实写入。
