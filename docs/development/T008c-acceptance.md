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

宿主进程夹具全链路已通过：本地.probe-work/feedback-run-3hG4Ug保存7次固定子进程尝试（积累1、评价6），各自外部pytest通过，报告明确process-fixture且modelCalls=0，未消耗workspace级live资格。该夹具验证了跨阶段冻结、反馈、分支、验收和v3记录，不能冒充模型结果。当前独立预审、真实调用、CI和最终审查将在本任务PR与下续记录中登记。

独立预审在b5277ce发现P2：改变积累修复提交后仍能接受后续阶段，Git证据链不连续。新增阶段提交反例先失败，再强制积累起点等于来源修复提交、全部评价起点等于积累修复提交；4项定向检查、类型/静态/构建通过，既有完整进程夹具在新校验下仍有效。该阻塞修复需复审通过后才消耗真实调用资格。

## 限制

两题属于同一故障模式、作者可见且故意测试词汇桥接，只有一次重复；不是盲测、真实开源Bug基准或普遍泛化。经验被提供不证明模型读取或采用，wrongExperienceApplied/人工返工/金额未独立观测保持null。全通过也可能没有成功率改善，失败和回退照实保留。完整DSH会话、正式发布、真实仓库规模收益仍未完成。
