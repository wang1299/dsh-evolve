# ADR-002：固定 DSH 适配边界

状态：固定发行包类型与真实服务探针已验证，2026-10-18。完整模型会话和官方安装器尚未验证。

目标发行版 `@deepseek-ai/dsh@0.2.0-rc.2`，2026-10-18 npm 查询的 latest。所有 DSH peer 固定同版；禁止静默追 master。当前官方 master SHA `687f282e8625c6b8d11ff58211a90524be2e4317` 仅作接口参考，非兼容结论。

官方支持方向：`session/event` 增量观察、`tools/result` 最终结果、tools 注册、systemPrompt section 或 agent.inject。实际名称和结构以 npm 包 types 和运行探针为准。

任务以 `evolve_begin_task` / `evolve_finish_task` 显式绑定，工具可由 Agent 在普通会话内调用；首版不把每条用户消息或空闲当作独立成功任务。提示区指导 Agent 调用工具。用户纠正必须明确记录，不由任意聊天猜测。

默认事件采集仅保存允许的元数据，不保存任意调用参数和输出。测试和 diff 证据由专用验证步骤产生。模型可提出候选但不能直接授予验证状态。

先做真实 Cordis/DSH 服务探针，再验证安装包。真实模型会话、Desktop/Web 安装未运行时必须单独列明。

实际发行包验证：Cordis4.0.5，dsh-session/tools/system-prompt/agent均为0.2.0-rc.2；Tool execute 必须返回 Promise。探针使用真实Context、SessionStore、ToolRuntime和SystemPrompt，Agent身份为fixture，仅验证服务边界，不伪装真实LLM回合。

经验共享默认关闭，用户显式配置shareWithModel后，begin工具结果才提供一条经验；不绕过DSH权限，不直接改模型请求。配置按启动时固定的单仓库生效，工具检查session.header.cwd，其他仓库会话拒绝操作。模型没有写入正反馈或修改执行信任配置的工具。

安装层补充：官方include中id/name是覆盖语法；新bundle必须用insert加入条目。固定app-boot组合真实manifest的回归必须保留，实际tgz安装组件探针另见Issue #7。

来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md
