# ADR-005：对照实验结果格式

接受，2026-10-18，在实现前固定接口。

第一版评价入口读取本地JSON实验记录，校验三组真实运行是否可比较，并汇总指标；不内置计费模型调用，不生成假Agent结果。CLI `evaluate --input <file>` 输出报告。独立模型执行器及只读验收沙箱仍属T006。

协议v1包含accumulationTaskIds、evaluationTaskIds、每次run的taskId/seed/arm、model、temperature、budget（tokens/toolCalls）、environmentDigest、taskDigest、acceptanceDigest、source（agent或synthetic）、experienceSourceTaskIds、accepted、sameErrorRecurred、humanRework、wrongExperienceApplied、extraCostUSD。指标可为null，缺失不补0。

实现前独立评审补充：冻结基础提示basePromptDigest、基础Agent配置agentConfigDigest（不含组别经验适配器）、经验库experienceBankDigest；每组适配器用policyDigest标识且组内固定。实际应用经验记录experienceRefs的id/revision/sourceTaskId，替代只有来源任务列表的不足。baseline经验引用为空。原始JSON协议v1在未发布阶段补齐这些必填字段，缺失的旧草稿明确拒绝，不能补造摘要。

积累与评价任务不能重叠；经验来源必须在积累集合中；baseline不带经验；同一task/seed的三组必须齐全且模型、预算、温度、环境、任务和验收摘要相同；source来源不能混比。重复runId或task/seed/arm拒绝。每个声明评价任务必须有完整分组。

按每组每个指标同时给known/unknown样本量及已知值均值，保留所有原始失败，不在缺失条件下给确定的提升结论。存在synthetic或小样本时标注preliminary，合成报告明确不能作为Agent收益证据。
