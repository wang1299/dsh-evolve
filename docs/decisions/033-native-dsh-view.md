# ADR033：DSH 同宿主经验界面

2026-10-22，T031；基线 4dd2f14，实现前决定。

## 接口和结构

固定官方 DSH 0.2.0-rc.2。使用发布包的 `dsh.client` 元数据和 `./client` 导出，原生 `settings.plugins.tab`、`main` 和 `conversation.session.header.actions` 槽位。对话按钮打开全宽经验主面板，设置页也可查看；返回按钮恢复原对话选择。CLI/无 connection 宿主仍可运行后端。

原生 React 外壳复用现有 panel-view，以 sandbox=allow-scripts 的 srcdoc 子文档隔离样式和 DOM。不是加载独立 localhost 页面：没有新端口、访问令牌、外部资源或 allow-same-origin。子文档 CSP 默认禁止网络/资源，仅允许本次 nonce 的内联脚本和样式。只允许原生外壳与其确切 contentWindow 交换随机通道、请求 ID 关联的消息；父页面验证 source/协议/有限消息形状，卸载取消处理，超时不会重放写入。保留现有单独面板作兼容入口。

数据走官方 authenticated `connection.rpc` 通道 `/dsh-evolve`，处理器与 DSH 工具共享同一个 EvolveService。将现有面板只读投影和 mutation 分派抽出供 HTTP/RPC 复用，不绕过 strict schema、revision、来源、仓库和用户反馈约束。仅公开 info 和 request；request 要求与当前绑定 repositoryId 相同，不接收文件路径、执行命令或授权变更。对话入口另校验真实 session.header.cwd；设置页明确显示这是配置绑定的单仓库，不能暗示跟随任意当前工作区。

RPC 挂载跟随可选 connection 服务生命周期，处理器仅接受宿主 operator peer，拒绝停用/取消请求，payload 上限 32 KiB，错误返回固定中文说明而不暴露异常或私有路径。读取不启动面板、模型或作业；写入只沿用已有 owner 操作。响应以现有状态契约为准；大库分页本次不引入。info 只给 repositoryId 和仓库 basename。

## 兼容与未实现

SQLite v9、公开 Agent 工具与授权配置不变。自动学习开关和额度不变；原生视图加载不证明来源或收益，不创建权限和模型调用。安装包加入构建后的 client bundle，固定依赖宿主前端接口；未验证其他 DSH 版本、Desktop 或其他宿主。配置向导和跨仓库动态服务不在本次范围。

## 验收

先补共享 API、RPC 拒绝及前端消息用例；验证 revision 冲突、未认证与不同 session/cwd、卸载清理、写入超时不重试。实际 tgz 安装与官方 Web 加载、设置/对话跳转、经验详情、窄屏及重启验收；零新增模型调用。稳定 SHA 独立只读评审、必要修复、最终 CI 和仓库规则满足后 squash。
