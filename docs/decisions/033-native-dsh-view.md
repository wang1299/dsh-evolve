# ADR033：DSH 同宿主经验界面

> 历史设计记录：当时的内部名称按原实现保留。当前身份、路由与升级规则见 [ADR037](037-project-identity.md) 和[安装指南](../installation.md)。

2026-10-22，T031；基线 4dd2f14，实现前决定。

## 接口和结构

固定官方 DSH 0.2.0-rc.2。使用发布包的 `dsh.client` 元数据和 `./client` 导出，原生 `settings.plugins.tab`、`main` 和 `conversation.session.header.actions` 槽位。对话按钮打开全宽经验主面板，设置页也可查看；返回按钮恢复原对话选择。CLI/无 connection 宿主仍可运行后端。

原生 React 外壳复用现有 panel-view，以 sandbox=allow-scripts 的 srcdoc 子文档隔离样式和 DOM。不是加载独立 localhost 页面：没有新端口、访问令牌、外部资源或 allow-same-origin。子文档 CSP 默认禁止网络/资源，仅允许本次 nonce 的内联脚本和样式。只允许原生外壳与其确切 contentWindow 交换随机通道、请求 ID 关联的消息；父页面验证 source/协议/有限消息形状，卸载取消处理，超时不会重放写入。保留现有单独面板作兼容入口。

数据走官方 authenticated `connection.rpc.call('/api', ...)` 和下述两个精确 fetch 路由，处理器与 DSH 工具共享同一个 EvolveService。将现有面板只读投影和 mutation 分派抽出供 HTTP/RPC 复用，不绕过 strict schema、revision、来源、仓库和用户反馈约束。仅公开 info 和 request；request 要求与当前绑定 repositoryId 相同，不接收文件路径、执行命令或授权变更。对话入口另校验真实 session.header.cwd；设置页明确显示这是配置绑定的单仓库，不能暗示跟随任意当前工作区。

宿主入口只硬依赖 sessions，单例服务/worker/数据库生命期归宿主根；Agent 工具绑定延迟到 tools/systemPrompt 就绪，不能反过来阻塞只读原生界面。标准 Web 实际提供这两个根服务；初始怀疑它们缺失的判断已被宿主诊断排除。原生通道仅以 connection 为可选依赖，最终方案不注入 webServer。保留直接 bindDsh 的测试兼容入口。不把前端可用宣称为所有 Agent 预设已完成学习适配。

固定 rc.2 的 generic rpc.handle 在真实宿主仍因 Cordis getter shadow 指向提供者上下文而拒绝 webServer 访问；显式增加消费者 inject 不能修复。采用官方 `connection.fetch.register` 的精确 `/api/dsh-evolve-info` 和 `/api/dsh-evolve-request` 路由，仍由官方 `/api` 共享通道完成身份、Host/Origin 和取消检查，前端用 `connection.rpc.call('/api', ...)`。仅在这两个精确路由解析严格 Connection 请求信封并回送其 rpcId，使用 streaming body 在读取 32 KiB 时拒绝超限；不改官方包或认证。原 `/dsh-evolve` 独立逻辑通道方案不交付。

挂载跟随可选 connection 服务生命周期，处理器仅接受宿主 operator peer，拒绝停用/取消请求，错误返回固定中文说明而不暴露异常或私有路径。读取不启动面板、模型或作业；写入只沿用已有 owner 操作。响应以现有状态契约为准；大库分页本次不引入。info 只给 repositoryId 和仓库 basename。

前端读取不占用写入去重额度。并发请求最多 16 项，结束即释放；单次挂载最多登记 4096 个写入 ID，重复或额度已满时显式拒绝，不静默丢弃，也不阻塞读取。写入超时不自动重试。组件卸载会丢弃未保存草稿；轮询保留编辑不代表关闭页面后仍保留草稿。

## 兼容与未实现

SQLite v9、公开 Agent 工具与授权配置不变。自动学习开关和额度不变；原生视图加载不证明来源或收益，不创建权限和模型调用。安装包加入构建后的 client bundle，固定依赖宿主前端接口；未验证其他 DSH 版本、Desktop 或其他宿主。配置向导和跨仓库动态服务不在本次范围。

## 验收

先补共享 API、RPC 拒绝及前端消息用例；验证 revision 冲突、未认证与不同 session/cwd、卸载清理、写入超时不重试。实际 tgz 安装与官方 Web 加载、设置/对话跳转、经验详情、窄屏及重启验收；零新增模型调用。稳定 SHA 独立只读评审、必要修复、最终 CI 和仓库规则满足后 squash。
