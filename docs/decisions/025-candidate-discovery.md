# ADR025：自动候选的发现与待检查提醒

日期：2026-10-19。T022，基线84f5d57。先设计再改公开接口；延续SQLite v5，不增加持久化状态或迁移。

## 问题与边界

T021需在用户输入中携带reviewedCandidateId，面板候选入口在后台任务展开后才可见。本次让用户与Agent发现已存在的自动候选，不以提醒代替owner检查、执行授权、来源验证或未来收益。无模型HTTP、未读/已读账目、OS通知、跨会话检索或自动唤醒。

## 数据投影

`service.pendingCandidates(sessionId?, taskId?)`只关联本仓库的extraction_jobs.candidateId与来源任务、经验当前版本，且job.state=candidate、experience.status=candidate。手工候选、已验证、停用和外仓库不计入。恢复/修订后读取当前版本，不用job创建时的旧快照。排序为提炼updatedAt降序、job.id确定打破平局；返回total、最多10条items及more。每条包含来源task ID/有限摘要、经验ID/revision/title/策略前512字符与截断标记；没有任意会话、原始模型输出或执行命令。只读，不做版本检查/测试，不提升状态或记录应用。外task显式查询先执行现行requireTask所有权检查。

## DSH 0.2.0-rc.2 接口

新增第七工具`evolve_list_candidates(taskId?:string)`。只允许正常session-backed Agent且cwd realpath匹配，强制当前session，不接受session/repo参数。shareWithModel=false时返回固定sharing_disabled_by_owner，不含数量、ID或存储内容；不授权提炼传输。

固定版本官方`AssembleContext.agent`、`assembleContextFor`及`systemPrompt.context`源码/类型支持动态user-role上下文。在下一次正常assembly时按相同session/cwd规则计算数量，只返回宿主固定文案及数量，不拼入候选文字/ID。无Agent/异仓库/共享关闭/卸载时空串；读取异常返回空串，不破坏正常对话。提醒不自动调用查询、验证或唤醒Agent，数量为待检查而非未读。workflow提示用户请求检查时调用工具，再按实际候选选择；仅存在候选不是验证指令。卸载由官方组件效果移除context和工具。

## 面板接口与刷新

增加令牌保护的只读`GET /api/candidates`，使用同一仓库投影、跨session仅owner可见；现有完整state/来源/历史不删改。顶部提醒框每5秒读取一次；隐藏页暂停，返回可见时刷新；in-flight不重叠，失败保留旧结果但显示更新失败。此刷新只改提醒框，不改state/经验编辑表单。候选按钮由ID绑定事件，textContent显示数据；点击时显式刷新state并打开当前详情。旧候选已改变则显示当前状态，不能自动验证。没有候选明确显示0；超过10条显示more并可用原有完整经验库查看。现有鉴权/Host/Origin/CSP继续适用，无写入或授权接口。

## 验收证据

失败用例先于实现：候选投影的session/repo隔离、当前版本/状态、截断与只读；官方工具/动态context开关/卸载；新HTTP鉴权。实际安装包的脚本Agent从真实工具回执获得ID，不再用用户消息/Adapter私有experienceId传递验证参数。共享关闭仍不能发现/复用；自动生成初始candidate不变。浏览器验证后台新增提醒及表单草稿保留，另记录实际tgz/两平台CI/稳定SHA独立评审。以上只证明机械流程，不是实际模型理解或经验收益。
