# Jenn 拍摄排班 UI / UX 验收

- 日期：2026-09-22
- result: PASS
- final result: passed
- 范围：四个现有页面的 UI、响应式与必要交互反馈；未改后端业务、接口、契约、鉴权或部署配置。
- 实际预览：[排班](http://127.0.0.1:3810/board)、[需求入口](http://127.0.0.1:3810/submit)、[平面表单](http://127.0.0.1:3810/submit/print)、[视频表单](http://127.0.0.1:3810/submit/video)。

## 定稿依据与对照

采用本轮选定的轻暖灰页面、白色圆角容器、柔和多色渐变卡片、连体侧展和橙色边光。按最后一条确认，日历所有格子（包括今天、周末和跨月日期）使用白底；今天仅在日期按钮上保留浅黄色标记。

- 定稿源图：[参考](C:/Users/617/.codex/generated_images/01a0c8d4-8611-7b63-8c23-20e3d6369d1f/exec-473bc6cb-d713-43cf-899c-537b6939a9d6.png)
- 实现截图：[桌面展开状态](C:/Users/617/.codex/visualizations/2026/09/22/01a0c8d4-8611-7b63-8c23-20e3d6369d1f/ui-implementation/board-desktop-expanded.png)
- 对照视口：源图 1487 × 1058；实现使用 1487 × 1058 桌面视口；系统滚动条与浏览器截图输出会占用部分宽度。
- 已将源图和实现截图在同一次图像检查中并排输入复核。检查结构、留白、字体层级、白底格线、渐变、侧展轮廓及边光。
- 实现为可操作界面，不是图片覆盖。格线四角的局部加深来自 CSS；没有每个交点的黑色圆点。
- 示例使用 6 个场次、3 个待排任务；源图有 5 个场次、3 个待排任务。新增半小时场次用于边缘展开测试。示例时钟固定为 10:15，仅在外部测试服务中替换时钟默认值，项目代码无测试时钟或假数据。
- 已修正：初稿字号偏小、工具栏横向对齐、短场次侧展滚动条、手机展开框越界、视口变化打断展开、Escape 焦点恢复。
- 开放 P0 / P1 / P2：0。非阻塞限制见下文。

## 修改文件

| 文件 | 内容 |
| --- | --- |
| public/app.css | 统一视觉样式、白底周月历、渐变与边光、侧展、表单和上传区域、响应式与焦点样式 |
| public/board.html | 看板层级、视图导航、待排侧栏、当日场次与完整详情弹窗 |
| public/board.js | 日期导航、周月渲染、场次详情、移动端当日列表、显示状态与边缘展开 |
| public/common.js | 共用反馈、日期与显示状态、重叠布局、选图合并和容量反馈辅助函数 |
| public/submit.html | 两个独立需求入口 |
| public/submit-print.html | 平面独立表单分组、字段提示、同框选图与附件入口 |
| public/submit-video.html | 视频独立表单分组、视频专属字段、同框选图与附件入口 |
| public/submit.js | 追加选图、去重与单独移除、大图弹窗、容量反馈、字段错误、提交防连点及成功反馈 |
| tests/ui-helpers.test.mjs | 日期边界、显示状态、重叠布局、文件追加与容量边界测试 |
| design-qa.md | 本验收记录 |

修改前 public 文件已在工作区外保留基线；未删除或替换其他现有工作。该领域项目原本为根仓库下的未跟踪目录，本轮没有提交、推送或部署。

## 验证

- 修改前已逐页检查四页桌面与手机效果；修改后四页再次实际打开检查。
- 桌面：1440 × 1000；定稿对照：1487 × 1058；平板边界：1024 × 900；手机：390 × 844，另查 360 × 800 看板。
- 四页桌面和手机 document scrollWidth 均不超过 clientWidth。
- 周历、月历、上一期、下一期、今天，以及周月切换保持当前日期：通过。
- 手机完整七天／七列、点击日期更新当日场次：通过。
- 场次点击展开、键盘 Tab 展开、Escape 收起与焦点恢复、完整详情弹窗：通过。
- 靠右卡片向左展开、短场次信息和详情入口：通过。
- 图片：空状态选择、两张同时选择、继续追加保留旧图、查看大图、关闭、单独移除、移除后再次添加：通过。
- 附件选择和单独移除：通过。
- 超过 12 MB 图片拒绝，保留之前的选择并显示具体错误：通过。
- 必填错误提示、计数、日期及视频画幅／声音／时长选择：通过。
- 平面与视频提交成功、失败后保留输入和文件、成功后复位与任务编号：在独立假数据服务验证通过。任务编号明确为 UI-PREVIEW-NOT-SAVED，无数据库或真实需求写入。
- npm run check：PASS。合同验证通过，16 项测试全部通过（原有 11 项 + 新增 5 项）。
- node --check：board.js、submit.js、common.js 通过。
- 对比原始表单：全部字段名称、类型、required、min、max、maxlength、accept 和 option value 保持一致。
- 对比原始脚本：提交 payload 对象及 uploadFile 请求函数保持一致。
- 10 个后端、数据契约、package.json、Dockerfile、compose.yaml 文件的 SHA-256 基线比对：0 个变化。
- 原有检查覆盖匿名读取、公开提需求、受保护排班写入、平面视频属性隔离、幂等性、并发更新和恶意上传拒绝。
- 全部浏览器提交验证只使用隔离的假数据服务；真实预览 3810 仅浏览与本地选图，没有实际提交。

## 截图证据

证据目录：C:/Users/617/.codex/visualizations/2026/09/22/01a0c8d4-8611-7b63-8c23-20e3d6369d1f/ui-implementation/

| 页面 / 状态 | 截图 |
| --- | --- |
| 实际看板桌面空状态 | board-desktop-final.png |
| 实际看板手机空状态 | board-mobile-final.png |
| 桌面渐变、连体展开与橙色边光 | board-desktop-expanded.png |
| 手机展开 | board-mobile-expanded.png |
| 平板靠右短场次向左展开 | board-tablet-left-expand.png |
| 月历桌面 / 手机 | board-month-desktop.png / board-month-mobile.png |
| 入口桌面 / 手机 | entry-desktop-final.png / entry-mobile-final.png / entry-mobile-bottom.png |
| 平面桌面 / 手机 | print-desktop-final.png / print-mobile-final.png |
| 视频桌面 / 手机 | video-desktop-final.png / video-mobile-final.png |
| 手机上传与大图 | upload-mobile-selected.png / upload-mobile-dialog.png |
| 提交反馈 | submission-error.png / submission-success.png / video-success-mobile.png |

手机入口及展开状态使用实际视口截图；全页截图工具对入口页产生的异常拼接图不作为验收依据。

## 非阻塞限制与业务边界

1. 现有数据契约没有实际开拍状态。“拍摄中”只根据场次日期／时间与非完成、非取消任务显示，30 秒更新一次，仅影响显示，不写入状态。实际开拍确认需要单独设计业务流程，本轮未改。
2. HEIC 等格式是否能显示缩略图取决于浏览器解码支持。已提供无法预览的提示，保留文件选择；服务端文件类型、签名、数量、单文件和总容量校验全部保留。
3. 验证覆盖当前浏览器的桌面与手机视口，未在 iOS / Android 真机逐一验证系统文件选择器。
4. 真实本地预览仍为原来的空排班数据，所以橙色光效与场次密度通过隔离示例和截图验收，没有为了展示效果加入真实任务。
5. 没有触碰腾讯云、服务器、域名、密钥、安全组、生产配置、权限体系或安全校验；没有引入新框架。
