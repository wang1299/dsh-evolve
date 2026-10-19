# 效果评价协议 v0.1

三组：baseline（同一Agent不提供经验）、retrieval（只按相似度召回）、evolve（来源验证＋作用域＋效用排序＋反馈更新）。

T008a起retrieval/evolve均使用同一BM25文本策略（普通检索不做来源/作用域/效用），并更新policyDigest；历史v1覆盖策略记录继续可评价，组内不可混用。离线四种消融、36条合成查询和全部错误见[检索诊断](evaluation/retrieval-v1.md)，不是新的Agent三组收益结果。本次没有追加模型调用。

T008b产品默认增加owner反馈备用表述/精确拒绝，现有冻结Codex配方仍显式固定bm25-v1，不悄悄改为feedback-v1，含irrelevant标签的库会在调用前被旧选择器拒绝。经验库新摘要加入有反馈应用的任务摘要/作用域，已有报告不改写。反馈夹具是已见开发测试；新策略需要新的明确配方和真实对照，本轮不运行模型。

以时间或任务族拆分经验积累任务和未见任务。冻结模型、版本、提示、任务集、每任务预算、随机种子、环境、验收脚本摘要。优化与选择不能查看未见验收答案。三组从相同干净代码快照运行，独立验收在 Agent 不可修改目录中；不能仅依靠提示词要求 Agent 不修改测试。

逐条记录：taskId、split、arm、model、budget、environmentDigest、acceptanceDigest、accepted、sameErrorRecurred、humanRework、wrongExperienceApplied、extraCost、experienceIds、runId。缺失项为 unknown，不补零。成本必须含经验提取、验证、检索和模型使用，不只看最终执行。

报告成功率、同类错误复发、人工返工、错误经验应用、额外成本，保留失败和无改善。三组任务／种子配对，展示样本量和重复运行；样本少标注 preliminary。来源修复回放和合成 smoke 不能冒充真实 Agent 对照实验。

实现入口：`node dist/src/cli.js evaluate --input <local-results.json>`。实际必填契约见`src/evaluation.ts`：基础提示、Agent配置、环境、经验库摘要需冻结，实际经验引用必须包含id/revision/sourceTaskId；每组policyDigest固定。校验的是记录一致性，不能代替实际运行执行器和独立验收的真实性证明。未配置执行器时不创建“真实Agent”实验数据。

方法依据与首版输入、输出、负反馈、数据需求和限制详见[方法说明](methods.md)。研究参考：
- MemRL：https://arxiv.org/abs/2601.03192，借鉴相似度召回与基于环境反馈的效用更新；不宣称首版实现了其完整RL算法。
- GEPA：https://github.com/gepa-ai/gepa，借鉴轨迹反馈、候选与独立评价；首版先采用简单可解释统计。
- ExpeL：https://arxiv.org/abs/2308.10144，经验提炼与召回已存在；项目贡献需由可执行验证、版本作用域、反例处理及实验体现。

当前真实仓库任务集的 Agent 收益实验：**未运行**。

T006b另有真实Codex的合成接入结果，见[验收记录](development/T006b-acceptance.md)：来源与baseline通过，evolve经两次显式续跑后通过；失败保留、预算不等，底层模型身份未冻结。它不作为本协议的三组数据，也不证明经验收益。

## T006c 初步三组执行（v2）

设计见[ADR-008](decisions/008-paired-codex-evaluation.md)。`scripts/paired-evaluation.ts`复用带SHA256的可信本地合成来源报告，在新仓库重放修复、重新验证并生成新经验；保留原始任务、经验和证明的映射。新任务为库存预留的异常回滚，外部验收不进入提示。三组从同一提交开始，冻结经验库，期间不学习或写入反馈。

固定请求`gpt-6.1-sol`／`low`、CLI `0.163.0-alpha.10.2`、每组1次调用／90秒／工具上限0、宿主提供提示32KiB和CLI输出1MiB上限；调用级provider重试为0。提示上限不含CLI自身添加的内部上下文。观察到工具事件即拒绝输出；事件到达前工具可能已启动，不宣称恶意代码强隔离。模型只提交源码提案，宿主受限写入和独立pytest后决定验收。retrieval只做文本匹配，evolve复用验证、作用域和效用筛选。

服务端模型revision、温度、sampling seed、token和金额硬上限均不可确认，明确保存null；replicate只是重复编号。调用、时间及工具策略相同不等于实际token和金额相同。资格在调用前原子保留，崩溃保留running/unknown，不自动补跑。单组CLI失败不取消其他组；验收未运行保持unknown，同时计入尝试分母。

`evaluate`同时接受原v1和新v2，见`src/paired-evaluation.ts`。v2保留完整计划和运行、控制／任务／经验库／提示摘要、精确经验版本、独立证明、usage与未知项；拒绝泄漏、缺组、重复、基线注入及失败冒称通过。检验的是记录一致性，不能证明输入文件来自真实CLI；运行证据需与执行器、原始本地报告和提交一起审计。

运行（会调用已登录的Codex模型，仅发送生成的合成代码）：

```sh
npm run paired-evaluation -- --live --source-evidence <本地合成来源报告> --source-digest <该报告SHA256>
node dist/src/cli.js evaluate --input <输出目录>/experiment.json
```

实现检查已通过32项测试。首轮真实运行三组均通过，但retrieval和evolve都因低相似度未注入经验，三组提示完全相同；因此只验证执行链路，不能评价经验收益。原始3次调用保留，未追加重跑。报告新增`experienceComparison`与各组`experienceOfferedAttempts`，计划引用数单列`plannedExperienceGroups`；尚未启动经验组为`no_treatment_attempts`，不能冒称提供过经验。提供次数表示携带经验参数的宿主调用尝试，不证明模型收到、读取或采用了它。相同配方后续未提供经验时，在调用前保留未开始计划并停止，不消耗模型调用。来源验证、实际结果、摘要与限制见[T006c验收](development/T006c-acceptance.md)，评审见[T006c评审](development/T006c-review.md)。一个手写任务、固定组顺序、一次重复始终标为preliminary，不用于普遍收益或算法优越性宣称。
