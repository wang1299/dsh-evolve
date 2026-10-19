# T008c：feedback-v1真实模型初步对照

关联[Issue #23](https://github.com/wang1299/dsh-evolve/issues/23)，父#15/#8保持open。实现前`4962f96`固定ADR011、任务、外部验收和最多7次新调用。协议SHA256 `a32c1298a859b02a57fd0520dbce8c46cefce986883c6749439b1a6b0f54dd49`。

## 可复现入口（源码开发）

```sh
npm run feedback-evaluation -- --prepare-only --source-evidence .probe-work/<自己的合成来源>/evidence.json
npm run feedback-evaluation -- --process-fixture --source-evidence .probe-work/<同一合成来源>/evidence.json
npm run feedback-evaluation -- --live --source-evidence .probe-work/<同一合成来源>/evidence.json
```

此固定配方要求ADR011中的历史合成来源摘要，不是任意输入适配器；该原始报告只在本机，未随仓库上传。其他用户需先建立相同来源并另行冻结协议摘要/预算，不能通过删一次性资格冒充新实验。prepare-only验证源证据并创建0调用记录；process-fixture用明确标记的本地固定答案子进程验证宿主闭环，报告kind区分，不是模型或收益数据。只有live调用已登录CLI，并占用本workspace的protocol级一次性资格；新输出目录不能重开资格。

## 控制和方法

1. 原模型来源修复在新Git仓库重放，独立pytest重新验证。积累任务只允许stage.py提案，模型不能写文件或调用工具；宿主写入后外部pytest决定accepted。只有真实通过才记录明确标注“基准独立验收”的反馈，不伪装用户原话。
2. 两个新编写合成目标cart/options的提示/源码/验收/库/环境冻结，各一次baseline/retrieval/evolve，以相反组序执行。普通BM25预期拒绝，feedback-v1必须从已接受应用备用表述选入源经验，否则调用前停止，不改查询追求通过。
3. 全部调用显式gpt-6.1-sol/low、CLI0.163.0-alpha.10.2、HTTPS、重试0、90秒/次、工具0、宿主输入32KiB/输出1MiB。总上限7（积累1＋评价6）；失败不续跑，温度/seed/server revision/token/金额硬限未知。实际usage/耗时与积累成本一起记录。
4. v3包括积累计划/运行/应用/反馈/真实测试证明和源证明，重算源库/反馈库摘要；v1/v2仍可读。报告将计划与实际调用分开，模型调用与固定进程夹具分开，保留原始失败和unknown。原始完整文件在.probe-work，仅公开去敏摘要，不覆盖旧数据。

## 验证与当前结果

新格式4项定向检查通过：未开始/积累失败保持未知且无反馈；仅真实尝试才计经验提供；拒绝伪造验收、版本/任务/摘要漂移和跨代策略；一次性协议资格原子竞争且失败不重开。39项既有检查在首次新增全套运行中仍通过；新增测试的两项无效变异改为实际矛盾状态后4项通过，未放宽验收。零模型预检已重放源失败/修复/回归。

宿主进程夹具全链路已通过：本地.probe-work/feedback-run-3hG4Ug保存7次固定子进程尝试（积累1、评价6），各自外部pytest通过，报告明确process-fixture且modelCalls=0，未消耗workspace级live资格。该夹具验证了跨阶段冻结、反馈、分支、验收和v3记录，不能冒充模型结果。

独立预审在b5277ce发现P2：改变积累修复提交后仍能接受后续阶段，Git证据链不连续。新增阶段提交反例先失败，再强制积累起点等于来源修复提交、全部评价起点等于积累修复提交；4项定向检查、类型/静态/构建通过，既有完整进程夹具在新校验下仍有效。该阻塞修复需复审通过后才消耗真实调用资格。

第二项P2是原失败用例跳过时被误记为未复发。负例先复现false，再将原失败未运行、缺失、跳过、错误或超时保留为null；观察到原失败仍failed才为true，原失败均实际passed才可为false。新增第5项测试覆盖上述状态和部分跳过；5项定向检查及类型/静态/构建通过。

## 真实运行：无验收收益改善

2026-10-19，唯一live运行保存在本机`.probe-work/feedback-run-uHIWac`。执行与独立预审目标为远端`68ae2a6a0a5654dbb3762ba1a6e7d66095abcb51`，对应本地`7c64c46c724eed29ad01b31dec700854e50ae1cb`，同树`1acb0e8680eb92c83ac19ec911bc5aa5f8369f18`；比较基线`d0213a0a113a8b14bfb83e8e7425d8028ba998bc`。两项P2修复后独立只读预审无剩余阻塞，才开始真实调用。未改冻结任务/协议，未重试或补跑，累计7/7次新模型调用。旧来源仅重放，没有另调模型。

来源重放：原失败1项→修复后1项通过，4项回归通过。积累stage：原失败2项→2项通过，1项回归通过，才追加带验证ID、明确标注基准验收的accepted反馈。评价cart/options每次均为原失败3项→3项通过，1项回归通过；外部验收未提供给模型，7次工具调用均为0，无超时/失败。评价任务不再写反馈。

| 阶段/组 | 计划/实际调用 | 验收通过 | 提供经验 | 输入tokens | 输出tokens | 模型进程耗时合计ms |
|---|---:|---:|---:|---:|---:|---:|
| 积累Evolve | 1/1 | 1/1 | 1 | 12015 | 179 | 12580 |
| 评价baseline | 2/2 | 2/2 | 0 | 23902 | 333 | 27843 |
| 评价普通BM25 | 2/2 | 2/2 | 0 | 23902 | 322 | 18527 |
| 评价feedback-v1 | 2/2 | 2/2 | 2 | 24068 | 358 | 16592 |
| 全流程 | 7/7 | 7/7 | 3 | 83887 | 1192 | 75542 |

评价顺序为cart：baseline/retrieval/evolve；options：evolve/retrieval/baseline。普通BM25均拒绝，Evolve均使用同一真实接受积累应用的`fallback_owner_accepted_inference`备用表述；提示确有预定差异。三个评价组验收率均2/2，原失败复发均0/2，**没有观察到验收成功率或复发率改善**。提供不证明模型采用或因果收益，未观察到错误应用不等于已证明没有错误应用。

Evolve评价比baseline增加166输入tokens（每次83），另有积累成本12015输入/179输出tokens；CLI输入usage包含其协议/系统开销，不能当经验文本长度。options/Evolve报告9984 cached input tokens，其他6次为0；耗时只是单次进程观测，受缓存、顺序和服务端波动影响，不得宣称速度提升。7次usage均已知；错误经验应用、人工返工、金额与因果归因未独立测量，仍为null。温度/seed/服务端权重/token及金额硬限仍未知。两题一次重复且作者可见，不能外推普遍效果；父#15/#8保持open。

原始文件只在本地保留，不上传或重写。SHA256：

- experiment.json：`103b3d9b99060e5bd3c59360930b434ecf917370c91690e6ded294666adeaa5e`
- report.json：`3b0ba456c26b9520e80ff78486f365b44b5a233fc3d28906aff113fd2671d513`
- execution.json：`85624edce50da18bfcf9c22ebef5ed074ac0b0bf23093d0def52b0328072c197`

本地完整check 44/44通过。执行头两平台CI run39190227601通过类型/静态/构建、44项测试、固定DSH兼容、演示、打包及实际tgz安装/Loader探针。随后只更新结果文档；最终交付头的增量独立评审、CI及合并门槛另记[PR #24](https://github.com/wang1299/dsh-evolve/pull/24)，AI评审不是GitHub正式批准。

## 限制

两题属于同一故障模式、作者可见且故意测试词汇桥接，只有一次重复；不是盲测、真实开源Bug基准或普遍泛化。经验被提供不证明模型读取或采用，wrongExperienceApplied/人工返工/金额未独立观测保持null。全通过也可能没有成功率改善，失败和回退照实保留。完整DSH会话、正式发布、真实仓库规模收益仍未完成。
