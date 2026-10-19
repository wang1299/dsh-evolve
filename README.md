# DSH-Evolve

从真实开发中的失败、修正和验证证据中积累经验，帮助 DSH 在后续相似任务中减少重复错误。

**状态：本地开发预览，未发布。** 当前分支的已实现能力与验证记录见 [路线](docs/roadmap.md)。完整产品需求见 [产品定义](docs/product.md)。

## 第一版

单仓库 Python＋pytest Bug 修复：记录失败和修正 → 隔离验证 → 结构化经验 → 相似任务应用 → 反馈、修订和停用 → 最小经验面板。

经验附带来源、代码与依赖条件。修复验证通过只证明来源修复有效；产品收益必须在未见任务上另外评价。允许没有合适经验时不注入。

## 开发状态

- 安装包自动学习演练：T021通过实际tgz/Loader和真实AgentLoop跑自动候选→显式验证→新会话回执→目标独立pytest→合成基准反馈，另保留坏提炼/关闭共享/无效目标三条负路径。新增独立Windows完整CLI/Web安装及重启核对，24个产品JS一致。模型为固定脚本，未验证真实模型质量；见[验收](docs/development/T021-acceptance.md)。

- 自动候选提炼：T020在独立授权后，把ready修复证据交给DSH已注册模型；宿主固定事实、来源与代码条件，模型生成策略或拒绝，结果仅为候选。SQLite v5保存调用资格、次数和结果，重启不退额、中断不自动重试。默认关闭，本轮仅合成模型验证；见[设计](docs/decisions/023-automatic-candidate-extraction.md)与[任务](docs/tasks/T020-auto-extraction.md)。
- 自动证据整理：T019在显式结束任务后自动归并同任务纠正、工具事件元数据、版本、有限Python差异和测试报告；后台队列支持去重、重启恢复与陈旧任务拒绝，面板可查看证据包和处理历史。默认不运行测试，后台pytest须单独开启且有执行信任。见[设计](docs/decisions/022-task-evidence-jobs.md)与[验收](docs/development/T019-acceptance.md)。
- 需求与架构：v0.2细化为58项编号需求、15个黄金验收场景、模块/数据/状态/接口/异常契约和完整追踪表；实现与目标分列，后续缺口见[架构总纲](docs/architecture.md)。T009交付门槛见[设计验收](docs/development/T009-design-acceptance.md)及关联PR。
- 核心功能：已实现来源验证、候选与作用域选择、反馈及经验版本。T010新增按事实/经验版本绑定的纠正与测试来源、摘要/归属检查及历史引用保留；默认evidence-v1拒绝事实来源不完整的经验。见[设计](docs/decisions/013-fact-evidence.md)与[验收](docs/development/T010-acceptance.md)。
- DSH：固定0.2.0-rc.2，官方服务/安装探针通过；Windows完整官方CLI/Web已独立试装、在插件页显示运行中且重启后仍加载。正常DSH完整学习闭环、Desktop及其他平台完整应用仍待验证；真实SDK回合的partial结果见[T011记录](docs/development/T011-acceptance.md)，安装见[试装记录](docs/development/T006d-installation.md)。
- 追加真实DSH回归：用户另授权最多5元后，T015实际执行一次、2个HTTP；两条计费回执在起始usage结构处保守拒绝，预算unknown预留使后续停止，经验/复用仍未完成。SDK保守估算0.009626元不是账单或原账本结算，见[T015失败与后续缺口](docs/development/T015-acceptance.md)。
- 计费结构诊断：T016支持拒绝位置及有限字段指纹；T017另授权最多3元后只做1次最小真实请求，HTTP200，确认当前起始usage有service_tier字段，值及历史T015原因未知。保留2.232768元最坏未知占额（不是账单），未重跑；兼容修复和完整学习仍待完成，见[T017记录](docs/development/T017-acceptance.md)。
- 计费兼容修复：T018提供显式新策略，只接受文档standard服务档位或缺省，保留旧策略及未知值拒绝；100项本地检查通过，当前头CI/评审见[T018记录](docs/development/T018-acceptance.md)及关联PR。只用合成流验证，未新增模型调用，不能认定T017实际值或真实兼容已通过。
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

SQLite已升级v5：v2/v3/v4旧JSON和历史不改，v1沿用既有报告降级、追加候选并要求重验的迁移。新增提炼Job及调用授权账目，已引用的最小来源继续保留；旧SQLite4及更早程序不能混跑或直接降级。本机既有DSH预览安装未自动更新。历史实验仍显式固定原bm25-v1/feedback-v1，不代表新evidence-v1收益。

完成现有`evolve_finish_task`后，后台自动整理本地证据。默认`backgroundVerification=false`，只复用已有匹配的验证报告；希望在没有候选经验时自动验证修复，需由owner在配置同时设置`backgroundVerification=true`和`executionTrusted=true`，并提供仓库外的`acceptanceDir`。DSH插件或CLI面板启动时恢复队列。没有报告/版本变化/材料超限时明确显示不完整；验证可能执行后中断为未知，不自动重跑。证据齐备不等于已经提炼或应用经验。

### 开启自动候选提炼

默认不发送材料。owner可以在DSH插件配置中添加以下对象（provider/model替换为**自己DSH已注册**的精确路由，grantId自行生成新UUID）：

```json
{
  "extraction": {
    "grantId": "57c09cc6-7bca-4a15-9c35-64e8041c3f54",
    "provider": "your-registered-provider",
    "model": "your-registered-model",
    "maxCalls": 1,
    "maxTokens": 2048,
    "timeoutMs": 30000
  }
}
```

这会授权随后显式结束的任务发送最多32KiB的去敏摘要、Python差异、固定版本与测试／纠正事实；不会回填已关闭任务。每个任务仅一次提炼，ready且版本未变才调用；没有DSH模型服务或相应provider时等待。CLI面板只展示状态，不提供模型。修改配置后重新加载插件；删除extraction即可停止后续调用。分享经验、执行测试的开关分别独立。

maxCalls是本插件**逻辑调用次数**，maxTokens是请求控制，不是人民币费用上限；DSH适配器／中间件可能有其他行为。调用前即保守占额，未知结果不退额或重跑，同grantId不能增额／改策略；新授权须换UUID。面板可查看占额与候选来源。候选不会自动激活，仍需检查并运行来源验证；当前未验证真实模型提炼质量或后续收益。

面板反馈“此任务不相关”仅记住当前经验版本与相同任务表述；“策略无效/发现反例”会停用当前实际应用版本。旧数据可直接读取；写入新增`irrelevant`反馈后，旧程序不能解析该枚举，不支持混跑或直接降级。

## DSH接入与当前限制

插件提供七个工具：开始/结束任务、记录纠正、提出候选、验证、关联事实来源和查询自动候选。纠正与验证返回来源凭据，候选返回事实摘要；用`evolve_link_fact_evidence`按精确revision关联：相同引用保留原版本；已验证且来源完整的经验锁定来源，需owner检查反馈并显式修订后才能更换。其他来源变化产生新版本。引用只校验出处/归属/摘要，不自动认证主张语义。未配置模型时，仍可通过核心API和合成案例检查流程。T011真实DSH已观察到begin/纠正及有效源码修复，但候选引用输入被拒绝，首次结果为partial；经验提炼/复用仍未完成，见[真实记录](docs/development/T011-acceptance.md)。

### 查看自动候选

打开本机面板，顶部“自动候选 · 待检查”每5秒更新，点击即可查看当前版本、完整策略和事实来源；刷新提醒保留正在编辑的内容。仅统计自动提炼且当前仍待验证的经验，已验证/停用后移除，恢复为待验证新版本后重新出现。显示最近10条，其余可在经验库筛选“待验证”查看；这不是未读状态。

DSH开启`shareWithModel`后，可在原会话直接说“查看这次生成的候选经验”。Agent通过`evolve_list_candidates`取得当前ID与有限预览，不需要用户复制ID；可选taskId必须属于当前会话。下一次正常模型步骤只提醒同会话候选数量，不自动唤醒模型或运行验证。共享关闭时查询不返回存储信息。候选文字仍可能有误，查看不等于批准，验证需要现有owner执行授权。实现边界与实际验证见[T022](docs/tasks/T022-candidate-discovery.md)。

配置和固定版本边界见[兼容性](docs/compatibility.md)。执行验证及经验发送给当前DSH模型均默认关闭，由owner明确开启；HTTP和模型工具不能修改这些授权。当前面板是独立loopback页面，与DSH共享本地数据库。

验证只在明确受信任的仓库执行项目代码，临时目录是文件隔离，**不是恶意代码安全沙箱**。源修复必须已有前后两个commit；验收测试放在仓库之外并保存内容摘要和最小输入；未提交或未能验证的修复保留候选。完整Agent效果实验还需要运行器约束验收目录为只读，不能仅靠提示词约定。

本机没有npm时，可在临时目录使用npm官方分发包；这不是产品依赖。MIT许可，尚未向npm或GitHub Release发布。

首版选择、反馈更新、数据需求和研究取舍见[方法说明](docs/methods.md)。

## 可选Codex实验执行器

本地Codex CLI复用已有登录，以只读分析、结构化修复、宿主受限写入和外部pytest检查经验闭环。`codex-demo -- --live`显式开启真实模型，最多三次调用；显式续跑另计，默认及CI不调用模型。

历史真实合成案例中，来源与baseline通过；evolve超时、首次续跑格式失败，收紧输出契约后第二次续跑通过。失败及资格修复前的历史两次续跑均保留，预算不等，不能判断经验收益。该阶段GitHub交付未重跑模型；后续T008c新增调用另列，不上传原始模型／学习报告。见[执行说明](docs/codex-runner.md)和[历史验收](docs/development/T006b-acceptance.md)。它不替代真实DSH模型回合。

新增`paired-evaluation -- --live --source-evidence <本地合成来源报告> --source-digest <SHA256>`配方：固定请求模型／推理／CLI版本，每组一次调用、失败不重试。v2记录原子资格、冻结经验库、精确引用及独立验收；温度／seed／服务端权重及token／金额硬限未知，不补造控制。历史首轮没有经验暴露，结果保留；后续同一配方缺少经验时，在调用前停止。检索漏选由[Issue #15](https://github.com/wang1299/dsh-evolve/issues/15)跟进。

`feedback-evaluation`为另行冻结的feedback-v1小实验，v3记录积累应用的真实验收与反馈链、两个新合成转移目标和最多7次新调用。支持0调用prepare-only和明确不算模型的process-fixture模式，live需要显式开启并消费一次性协议资格；v1/v2和历史结果不改写。当前执行/失败/限制见[T008c记录](docs/development/T008c-acceptance.md)，不能从准备或夹具结果宣称Agent收益。
