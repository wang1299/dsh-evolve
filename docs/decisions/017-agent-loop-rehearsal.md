# ADR-017：真实Agent循环的离线闭环演练

2026-10-19，T014，基线8f9a8a5。原T011的5元预算与unknown不改变；本轮没有付费采样。

## 问题与决定（先于实现）

现有compat调用官方ToolRuntime但Agent仅身份fixture。新增开发命令使用固定`@deepseek-ai/dsh-agent-loop@0.2.0-rc.2`及实际AgentRegistry、SessionStore、SystemPrompt、LLM运行时与插件六工具。仅增加固定开发依赖，不改插件公开接口或SQLite格式。运行时只注册一个进程内脚本适配器，不加载DeepSeek/HTTP/凭据服务；没有官方模型请求或账本新资格。

脚本响应是预先编写的测试行为，参数从实际LLM请求内的工具回执读取，复制task/experience/revision/fact/evidence字段；不直接写Store来制造学习结果。脚本故意给出固定修复，仅检验编排和接口，绝不能作为模型学习/理解/收益证据。来源和目标代码均由测试生成，无真实用户材料。

同一来源session分两轮：begin/显式纠正/修复提案 → 宿主AST限制与提交 → propose无citations/verify/link/finish。只有真实报告、完整同任务纠正引用、精确base/fix和closed成立才进入新session的相似任务。真实begin返回应用后需同callId成功结果和后续assistant；独立外置pytest判断目标修复，宿主反馈注明合成基准来源。idle仅负责等待。

使用进程内固定响应，最多12次适配器调用，步骤/工具名固定，不失败自动重试。Agent轮等待有deadline与取消清理、pytest单次有deadline；创建全新临时合成仓库/SQLite，命令只在ignored目录输出有限去敏报告，不保存完整请求或session正文。旧T011计划、事件、账本、SDK/Web profile及Key均不读取或写入。

来源输入自审补充：合成user消息以封闭结构显式携带纠正文案，适配器从实际GenerateOptions.user内容解析并记录该值；缺失时停止，不能从私有常量补造。最早失败的报告也保留明确null/false字段，不把未开始当通过。

## 验收

先提交设计及缺少演练入口的失败回归。成功必须实际验证来源与新任务、来源引用、精确版本交付及反馈；错误receipt当citation和来源修复无效时停止且不产生transfer成功。报告显式`realModel:false`、`benefitEvaluated:false`及`scripted`，保留失败。运行类型/静态/构建、针对测试、固定DSH兼容、两平台CI及稳定SHA独立只读评审。完整发行SDK/HTTP/真实模型/自主提炼/收益仍需单独实验，不因本演练变成已验证。
