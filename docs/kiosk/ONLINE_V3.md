# Schema12 在线现场控制台（V3）

范围：北京时间当天已确认的单任务场次、仍在进行的跨日场次、五分类展示、受限设备/操作员身份、开拍和完成。沿用 Kiosk 页面布局与控制锁。暂停/恢复、离线事件补录和队列迁移不在在线版范围内；遇到已暂停或组合场次显示只读，交负责人处理。

## 显式启用与权限

`JSO_KIOSK_ONLINE_RUNTIME=enabled` 和 `JSO_KIOSK_ONLINE_IDENTITIES_JSON` 提供数组，每项恰为 `token,subjectId,deviceId,resourceId`。这是部署保管人提供的配置，不在仓库发行真实身份。token 仅允许可见ASCII字符 `0x21–0x7E`（不含任何空白、控制字符或非ASCII），至少32字节、不得重复或与业务/旧角色环境凭据相同；设备不可重复；标识使用8–128字符的字母数字及 `._:-`。默认不启用；配置非法则停止启动。

服务端固定 `operator` 角色，只给一个资源的读排期和现场事件能力。客户端不能指定角色或设备，不能使用管理端身份。在线版与旧 Kiosk 认证不能同时启用；旧 `KIOSK_SERVICE_CONTEXT` 仍需既有合法且 DISABLED 的绑定。新运行时经构造器校验，只有 Schema12 才能接入，不取消旧 `/api/v2/*` 的协议闸门。两个新环境配置字段纳入既有runtimeConfigDigest，首发启动核对注入运行时与获准环境身份一致。既有启动准入、维护锁及 PREPARED 只读要求保持；需要主动写入仍必须已有 ACTIVE 许可。不要仅为测试改生产准入。

## HTTP 契约

所有JSON响应 `Cache-Control: no-store`。Bearer身份每次重新验证，资源从身份确定；接口不接受查询参数。

- `GET /api/v3/kiosk/identity`：`ok,protocolVersion:3,subjectId,role:operator,deviceId,resourceId`。
- `GET /api/v3/kiosk/day`：上述身份，加 `today,serverTime,revisions:{scheduleRevision,projectionRevision},sessions,currentId,conflict,writeAdmission`。每个场次含 `id,plannedStart,plannedEnd,allocationMode,tasks:[{id,sku,name,kind,shootingSubtype}],run,state,supported`。run为null或`{id,status,runRevision,startedAt,completedAt}`。只读真实执行状态，不以计划时间冒充已开拍；多进行中场次显示冲突。资源停用返回403。
- `POST /api/v3/kiosk/events`：恰为 `eventId,runId,scheduleItemId,eventType:start|complete,expectedRunRevision,expectedScheduleRevision`。编号沿用既有标识约束，版本非负安全整数。设备、actor、occurredAt不接受客户端指定。时间取服务端接收时刻，不支持离线补录。事务内复查资源、排期版本、状态及执行版本；仅开始当天单任务场次，可完成已开拍的跨日场次。
- `GET /api/v3/kiosk/events/:eventId`：仅同操作员/设备/资源可读取自己的已保存回执。未找到404，不代表稍早在途请求永远不会提交；原编号重试仍由事务幂等保护。

成功事件返回既有执行回执，加`source:kiosk-online-v3,actor,deviceId,resourceId,eventId,recordedAt`。回执键为`kiosk-online:<eventId>`，与管理端分开；相同身份和相同命令重复返回原结果，编号不同内容冲突，不产生第二事件。不伪称owner-management来源，不发送外部通知。

错误：401无身份；403越权；400查询参数/JSON错误；422非法命令；409陈旧版本、状态冲突或协议不适用；404回执不存在；503禁写/未启用。HTTP方法或路径未支持返回404。全局禁写检查先于协议/身份，写入可能优先503。

## 客户端恢复规则

凭据只在页面内存中，刷新后重新登录。写入前持久化一个待核对命令（不含凭据），发送中禁止双击和其他新动作。收到明确非鉴权4xx拒绝可清除该命令并刷新；网络错误、超时、5xx或鉴权不确定保留记录，先GET核对。404时只提供原编号手动重试，不自动回放；刷新/重新登录同一身份仍保留待核对记录。

断网立即禁写；恢复连接只刷新，不自动提交。存储不可用/损坏时禁写并保留记录。旧`jenn.kiosk.offline-queue.v2`一律保留原值并提示隔离，新页面不加载旧队列模块，不导入或发送旧命令。控制锁复用既有模块，不宣称在线版已完成完整离线租约/跨设备队列兼容。

## 验证与限制

运行`node --test tests/kiosk-online-v3.test.mjs`，完整`npm run check`；浏览器脚本见`tests/support/kiosk-online-browser.mjs`（本地测试身份及既有隔离准入夹具）。不把本地夹具验收标记为生产放行或固定镜像验收。真实部署仍需保管人配置设备身份与独立审阅。

## PR69 P2 修正

当天查询先通过现有资源/日期索引缩小范围，再以精确北京时间窗口筛选；跨日分支从现有活跃运行部分索引驱动，避免历史已确认场次逐条明细查询。带时区偏移的时间戳保留原语义，无新增索引或数据库迁移。不支持的场次在列表及所选状态明确显示只读，所选/下一场次说明需交负责人处理，禁写规则保持。回执路径只解码一次后校验事件编号；畸形编码或非法编号返回400，身份绑定和原编号幂等不变。回归包括历史量/查询计划、北京时间边界、跨日拍摄/暂停、冒号编号及畸形编码，真实 Chrome 脚本同时核对只读提示和编码回执恢复。

## 内部错误恢复与页面控制权

仅Kiosk HTTP边界将内部写失败、Node/SQLite错误映射为500，明确业务拒绝的4xx保持。客户端原有5xx处理保留同一待核对命令；先查回执，404才允许原编号手动重试，不自动发送。失败可以是已完整回滚，不代表已提交数据丢失。

未登录页面不申请控制锁；认证成功后申请，退出或身份401失效时释放。页面恢复先重新读取服务端身份绑定的当天状态，成功后重新申请；已有合法控制页仍保持互斥。被拒页面可在原控制页退出后点击“刷新场次”重新申请，无资源分锁或权限模型变化。

## Token字符合同

字符范围收窄为 `0x21–0x7E`，以在启动时拒绝不能可靠往返Authorization头的配置；不做trim、重编码或自动替换。保留原始凭据精确比较及至少32字节约束。该合同也主动排除部分此前可传输的前导/内部空白和Latin-1值，并非宣称所有此类字符都会失败。非法值返回既有通用配置错误，不回显token；不会修改任何实际凭据。
