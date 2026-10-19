# DSH-Evolve

从真实开发中的失败、修正和验证证据中积累经验，帮助 DSH 在后续相似任务中减少重复错误。

**状态：本地开发预览，未发布。** 当前分支的已实现能力与验证记录见 [路线](docs/roadmap.md)。完整产品需求见 [产品定义](docs/product.md)。

## 第一版

单仓库 Python＋pytest Bug 修复：记录失败和修正 → 隔离验证 → 结构化经验 → 相似任务应用 → 反馈、修订和停用 → 最小经验面板。

经验附带来源、代码与依赖条件。修复验证通过只证明来源修复有效；产品收益必须在未见任务上另外评价。允许没有合适经验时不注入。

## 开发状态

- 需求与架构：v0.2细化为58项编号需求、15个黄金验收场景、模块/数据/状态/接口/异常契约和完整追踪表；实现与目标分列，后续缺口见[架构总纲](docs/architecture.md)。T009交付门槛见[设计验收](docs/development/T009-design-acceptance.md)及关联PR。
- 核心功能：已实现来源验证、候选与作用域选择、反馈及经验版本。T010新增按事实/经验版本绑定的纠正与测试来源、摘要/归属检查及历史引用保留；默认evidence-v1拒绝事实来源不完整的经验。见[设计](docs/decisions/013-fact-evidence.md)与[验收](docs/development/T010-acceptance.md)。
- DSH：固定0.2.0-rc.2，官方服务/安装探针通过；Windows完整官方CLI/Web已独立试装、在插件页显示运行中且重启后仍加载。正常DSH完整学习闭环、Desktop及其他平台完整应用仍待验证；真实SDK回合的partial结果见[T011记录](docs/development/T011-acceptance.md)，安装见[试装记录](docs/development/T006d-installation.md)。
- 追加真实DSH回归：用户另授权最多5元后，T015实际执行一次、2个HTTP；两条计费回执在起始usage结构处保守拒绝，预算unknown预留使后续停止，经验/复用仍未完成。SDK保守估算0.009626元不是账单或原账本结算，见[T015失败与后续缺口](docs/development/T015-acceptance.md)。
- 计费结构诊断：T016支持拒绝位置及有限字段指纹；T017另授权最多3元后只做1次最小真实请求，HTTP200，确认当前起始usage有service_tier字段，值及历史T015原因未知。保留2.232768元最坏未知占额（不是账单），未重跑；兼容修复和完整学习仍待完成，见[T017记录](docs/development/T017-acceptance.md)。
- 原生Agent演练：新增`npm run dsh-rehearsal`，用真实AgentLoop和固定脚本响应回归经验保存/验证/引用/新会话复用/独立验收反馈；包含四个负路径，零付费。脚本模型不证明真实模型学习，见[T014记录](docs/development/T014-acceptance.md)。
- 面板：本机经验查看、来源与版本、反馈、修订、停用和恢复，HTTP与浏览器交互已验证。
- 评价：三组结果一致性、泄漏检查及v2执行器已实现；历史首轮三次均通过验收，但未选入经验，只验证执行链路，不能判断经验收益。见[T006c记录](docs/development/T006c-acceptance.md)。
- 检索：T008a加入长任务BM25、弱匹配拒绝和版本化策略；普通检索对照使用同一算法。36条预先冻结合成查询的召回/误选/漏选与成本全部保留，尚不能证明Agent收益。见[离线诊断](docs/evaluation/retrieval-v1.md)。
- 反馈记忆：当前版本的已接受应用可提供最多8个备用检索表述；原文都不匹配时才尝试。owner标记“不相关”后，同一完整任务表述不再收到该经验；策略错误/反例仍停用版本。见[反馈检索设计](docs/decisions/010-feedback-retrieval.md)。
- 真实初步对照：1次积累通过后，两个新合成任务各运行三组，共7次真实Codex调用。Evolve两题均提供反馈经验，三组验收均2/2，未观察到成功率或复发率改善，增加输入成本；任务作者可见，只有一次重复。见[结果与限制](docs/development/T008c-acceptance.md)。
- 验证：T008b已由PR #22完成39项两平台CI/实际安装和独立评审；T008c执行头44项本地及两平台CI、实际安装通过，两项预审阻塞已修复并复审。最终交付头见[PR #24](https://github.com/wang1299/dsh-evolve/pull/24)及[本轮记录](docs/development/status.md)，不以历史检查代替当前头验证。
- 完整Web试装：T006d只有安装文档变化，本机已实际加载与停止重启；该文档交付的最终CI/独立审查见[PR #26](https://github.com/wang1299/dsh-evolve/pull/26)。
- GitHub：T010已由PR #30合并；T011 / PR #32记录首次有预算的真实DSH验证，结果partial，后续[引用契约修复](docs/development/T012-acceptance.md)已合并PR #35；#34的[数值用量诊断](docs/development/T013-acceptance.md)已由PR #36合并，真实采样仍待完成；CI/评审/合并状态见关联PR。
- npm、GitHub Release、线上部署：未发布。

## 开发组织

按照需求与设计、聚焦任务分支、测试、自审、Draft PR、独立只读评审、修复及条件合并推进。Run2Skill用于研究开发组织及需求/架构文档颗粒度；产品、数据与实现以DSH-Evolve自己的定义为准，见[ADR012](docs/decisions/012-detailed-design-baseline.md)和[贡献指南](CONTRIBUTING.md)。

## 本地开发

从源码开发需要 Node.js 24.10+、Git、Python3.10+ 和 pytest9.1.1。安装项目依赖后执行检查：

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

`demo` 只创建合成数据，打印证据目录与`config.json`位置。随后打开面板：

```sh
node dist/src/cli.js panel --config <打印的目录>/config.json
```

面板令牌只在本机终端显示，不要分享其完整地址。数据API仅限本机并需要令牌。经验恢复会产生待验证版本。

SQLite已升级v3：v2旧记录不改写；v1沿用既有报告降级、追加候选并要求重验的迁移，历史保留。无事实引用的旧经验默认不自动复用，可在面板补充来源。旧SQLite2程序不能混跑或直接降级；本机既有DSH预览安装未自动更新。历史实验仍显式固定原bm25-v1/feedback-v1，不代表新evidence-v1收益。

面板反馈“此任务不相关”仅记住当前经验版本与相同任务表述；“策略无效/发现反例”会停用当前实际应用版本。旧数据可直接读取；写入新增`irrelevant`反馈后，旧程序不能解析该枚举，不支持混跑或直接降级。

## DSH接入与当前限制

插件提供六个工具：开始/结束任务、记录纠正、提出候选、验证和关联事实来源。纠正与验证返回来源凭据，候选返回事实摘要；用`evolve_link_fact_evidence`按精确revision关联：相同引用保留原版本；已验证且来源完整的经验锁定来源，需owner检查反馈并显式修订后才能更换。其他来源变化产生新版本。引用只校验出处/归属/摘要，不自动认证主张语义。未配置模型时，仍可通过核心API和合成案例检查流程。T011真实DSH已观察到begin/纠正及有效源码修复，但候选引用输入被拒绝，首次结果为partial；经验提炼/复用仍未完成，见[真实记录](docs/development/T011-acceptance.md)。

配置和固定版本边界见[兼容性](docs/compatibility.md)。执行验证及经验发送给当前DSH模型均默认关闭，由owner明确开启；HTTP和模型工具不能修改这些授权。当前面板是独立loopback页面，与DSH共享本地数据库。

验证只在明确受信任的仓库执行项目代码，临时目录是文件隔离，**不是恶意代码安全沙箱**。源修复必须已有前后两个commit；验收测试放在仓库之外并保存内容摘要和最小输入；未提交或未能验证的修复保留候选。完整Agent效果实验还需要运行器约束验收目录为只读，不能仅靠提示词约定。

本机没有npm时，可在临时目录使用npm官方分发包；这不是产品依赖。MIT许可，尚未向npm或GitHub Release发布。

首版选择、反馈更新、数据需求和研究取舍见[方法说明](docs/methods.md)。

## 可选Codex实验执行器

本地Codex CLI复用已有登录，以只读分析、结构化修复、宿主受限写入和外部pytest检查经验闭环。`codex-demo -- --live`显式开启真实模型，最多三次调用；显式续跑另计，默认及CI不调用模型。

历史真实合成案例中，来源与baseline通过；evolve超时、首次续跑格式失败，收紧输出契约后第二次续跑通过。失败及资格修复前的历史两次续跑均保留，预算不等，不能判断经验收益。该阶段GitHub交付未重跑模型；后续T008c新增调用另列，不上传原始模型／学习报告。见[执行说明](docs/codex-runner.md)和[历史验收](docs/development/T006b-acceptance.md)。它不替代真实DSH模型回合。

新增`paired-evaluation -- --live --source-evidence <本地合成来源报告> --source-digest <SHA256>`配方：固定请求模型／推理／CLI版本，每组一次调用、失败不重试。v2记录原子资格、冻结经验库、精确引用及独立验收；温度／seed／服务端权重及token／金额硬限未知，不补造控制。历史首轮没有经验暴露，结果保留；后续同一配方缺少经验时，在调用前停止。检索漏选由[Issue #15](https://github.com/wang1299/dsh-evolve/issues/15)跟进。

`feedback-evaluation`为另行冻结的feedback-v1小实验，v3记录积累应用的真实验收与反馈链、两个新合成转移目标和最多7次新调用。支持0调用prepare-only和明确不算模型的process-fixture模式，live需要显式开启并消费一次性协议资格；v1/v2和历史结果不改写。当前执行/失败/限制见[T008c记录](docs/development/T008c-acceptance.md)，不能从准备或夹具结果宣称Agent收益。
