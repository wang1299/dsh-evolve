# 效果评价协议 v0.1

三组：baseline（同一Agent不提供经验）、retrieval（只按相似度召回）、evolve（来源验证＋作用域＋效用排序＋反馈更新）。

以时间或任务族拆分经验积累任务和未见任务。冻结模型、版本、提示、任务集、每任务预算、随机种子、环境、验收脚本摘要。优化与选择不能查看未见验收答案。三组从相同干净代码快照运行，独立验收在 Agent 不可修改目录中；不能仅依靠提示词要求 Agent 不修改测试。

逐条记录：taskId、split、arm、model、budget、environmentDigest、acceptanceDigest、accepted、sameErrorRecurred、humanRework、wrongExperienceApplied、extraCost、experienceIds、runId。缺失项为 unknown，不补零。成本必须含经验提取、验证、检索和模型使用，不只看最终执行。

报告成功率、同类错误复发、人工返工、错误经验应用、额外成本，保留失败和无改善。三组任务／种子配对，展示样本量和重复运行；样本少标注 preliminary。来源修复回放和合成 smoke 不能冒充真实 Agent 对照实验。

方法依据：
- MemRL：https://arxiv.org/abs/2601.03192，借鉴相似度召回与基于环境反馈的效用更新；不宣称首版实现了其完整RL算法。
- GEPA：https://github.com/gepa-ai/gepa，借鉴轨迹反馈、候选与独立评价；首版先采用简单可解释统计。
- ExpeL：https://arxiv.org/abs/2308.10144，经验提炼与召回已存在；项目贡献需由可执行验证、版本作用域、反例处理及实验体现。

当前真实 Agent 三组实验：**未运行**。
