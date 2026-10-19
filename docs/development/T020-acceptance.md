# T020 自动候选提炼验收

日期：2026-10-19。Issue [#49](https://github.com/wang1299/dsh-evolve/issues/49)，Draft [PR #50](https://github.com/wang1299/dsh-evolve/pull/50)，基线278f58a。设计[ADR023](../decisions/023-automatic-candidate-extraction.md)，范围[任务](../tasks/T020-auto-extraction.md)。最终提交、CI/实际包和独立审查门槛以PR当前头记录为准，本文件不替代这些门槛。

## 交付范围

- 新owner配置extraction默认缺省关闭，独立于共享/执行/后台pytest；grant UUID固定整个策略及逻辑调用次数，重启不清零，同ID改额度/模型拒绝。只为之后显式finish的任务创建资格，不回填历史。
- ready修复包经摘要、归属、最新证明、干净修复HEAD/依赖重检后，生成32KiB内最小模型材料；无完整会话、工具参数/输出、原始报告summary或Key。
- 模型仅生成严格策略、factIds、推断/建议或abstain；宿主事实目录/精确引用/实际改变的Python文件哈希，输出candidate revision1/verificationId=null。坏JSON、假factId、额外status、重复引用、超限、无证据及漂移均不产生候选；候选不自动激活或复用。
- SQLite v5 grant/Job，原子扣额/占用/发布，任务唯一；取消、超时、断电为unknown，不退额不自动重跑，旧token不发布。初始化BEGIN IMMEDIATE避免多进程schema读锁升级冲突；迁移回滚、旧JSON保持。
- 固定官方DSH LlmRuntime.prepareCall/一次性stream，无工具/伪造session或purpose；可选LLM/晚注册provider，卸载取消等待worker再关DB。CLI面板无模型，只运行状态协调/证据整理，等待DSH模型；面板展示任务提炼状态、逻辑占额和候选来源。

## 实际验证与保留的失败

设计8859061在失败用例4c10cae之前；旧代码构建后断言“缺少提炼阶段”实际失败。实现87b8fc0与本地08af557同树；修复29a8e3f与本地f706477同树。

| 检查 | 实际观察 | 限制 |
|---|---|---|
| 第一轮本地check | 132/132通过，类型/静态/构建通过 | 之后又增加边界用例，不能当最终头证明 |
| 扩展134轮 | 一轮133过/1子进程退出；单跑通过；另一轮132过/2子进程异常，含Windows Git初始化状态3221225794 | 失败保留，未放宽断言；并发编译曾共享dist，但未据此认定原退出原因 |
| 首轮CI 39259233068 | Ubuntu 133过/1失败，新增双进程用例抓到初始化database is locked，Windows被矩阵取消 | 根因是deferred schema读锁同时升级写锁；BEGIN IMMEDIATE修复，不靠重跑掩盖 |
| 本地有界并发check | 135/135通过，文件并发4 | 该编译早于最后构造加锁补丁；最终以新头CI为准 |
| 修复头针对检查 | 类型/静态/构建及7项两进程、v2/v4/旧迁移、同步阻塞deadline全部通过 | 本地f706477；保留所有迁移/抢占断言 |
| 官方compat | 6/6通过，真实发行Context/LLM/六工具及卸载/晚注册 | 模型响应是进程内脚本，无网络 |
| 真实合成Git/pytest demo | 原始1失败、修复/回归通过，后续任务提供经验 | 没有模型或收益证明 |
| 浏览器 | 合成包显示原始1失败/修复0/回归0；已生成候选仍待验证，逻辑占用1/1；来源按钮打开候选及逐条引用/条件 | 仅合成材料，本地鉴权URL不提交；未改日常预览profile |

## 方法与当前限制

方法为证据约束的结构化提炼：输入是固定源码变化与验证/纠正事实，输出是有限范围策略建议。反馈包括可执行来源结果、拒绝/坏输出/中断及后续owner反馈；负反馈沿用停用/修订，自动Job不会因为候选停用而另建副本。无需训练数据即可跑通机械闭环，真实策略质量和多少案例有效仍未知。

只证明结构、来源和运行边界。事实目录不接受模型自由事实，仍不能证明自然语言策略被证据蕴含，不能以一次修复推广收益。普通检索、原始Agent及Evolve三组未见任务评价仍待做；#8/#15/#34不因本次关闭。

maxCalls是逻辑调用次数，maxTokens是请求参数，不是物理HTTP或人民币硬预算；DSH provider/middleware有独立行为。成功响应只保存已报告数字usage；未知为null不等于零费用，不保存原始响应/异常正文。此次没有付费模型调用、Key/私人profile/会话读取、历史预算重开、包发布、部署或权限变更。SQLite v5不能混跑或直接降级旧程序。
