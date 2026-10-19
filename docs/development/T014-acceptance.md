# T014：真实Agent循环的脚本演练

Issue [#37](https://github.com/wang1299/dsh-evolve/issues/37)，设计先于实现见[ADR017](../decisions/017-agent-loop-rehearsal.md)。这是一项零付费开发回归，**不是实际模型、自动提炼或收益评价**。

## 实际运行边界

固定DSH0.2.0-rc.2原生AgentLoop、AgentRegistry、SessionStore、LLM运行时、SystemPrompt和ToolRuntime；注册唯一进程内脚本适配器，不加载DeepSeek网络适配器或凭据服务。脚本只发出固定响应，参数通过真实模型请求读取实际工具返回的ID/revision/fact/evidence。不用直接写Store来制造候选、引用或应用。

成功路径使用11次脚本适配器调用、8次工具调用、两个session及同一全新合成Git仓库。第一轮来源任务begin/纠正/代码提案，宿主AST限制后写入并commit；第二轮propose/verify/link/finish。来源原始测试失败、修复和回归通过、精确base/fix、一条同任务纠正引用和closed均成立后，才开始新session。新begin的callId对应成功结果和精确application/experience/revision，且后续assistant事件存在才记交付。目标代码再经独立外置pytest验证，宿主反馈注明合成基准来源；没有证明脚本理解或依赖经验。

没有调用原T011实验/预算/资格或已安装SDK/Web profile，不读取Key。新增的AgentLoop、LLM、session projection仅是固定开发依赖，包的files/peer/SQLite格式/六工具不变。持久化仅全新合成仓库/学习库及有限报告，完整session/请求只在内存、不写会话日志；不自动删除旧数据。报告含生成的本机路径，仅用于本地，不能直接作为公开去敏报告上传。

## 使用

源码安装依赖后运行：

```sh
npm run dsh-rehearsal
```

默认报告在`.probe-work/agent-rehearsal-*/report.json`，打印路径；所有响应固定，`realModel=false`、`benefitEvaluated=false`、kind带scripted。每次生成新合成数据，可以重复回归，不是新模型实验；脚本最多12次适配器调用、每Agent轮60秒等待上限，验证的pytest单次15秒。没有为目标仓库提供通用安全沙箱。

故障回归：

```sh
npm run dsh-rehearsal -- --scenario bad-citation
npm run dsh-rehearsal -- --scenario failed-proof
npm run dsh-rehearsal -- --scenario sharing-off
```

三个故障场景预期exit1/partial，不为通过测试而报告成功。可指定`--report <new-local-path>`，已有文件不会被覆盖。

## 验收证据

设计及失败用例先提交：原基线没有演练入口，测试因MODULE_NOT_FOUND失败。实现后4项针对回归通过：

| 场景 | 数据与实际验收 | 结论 |
|---|---|---|
| happy | 来源1失败→修复/回归0失败；经验v3/纠正引用完整；新session实际交付；目标pytest通过；反馈accepted | scripted_loop_passed，只是编排成功 |
| bad-citation | T011错误receipt直接作为引用；真实Agent执行提案被拒绝；0候选/应用/反馈 | partial，来源未关闭，不进入transfer |
| failed-proof | 固定响应给无效修复并自称验证成功；外部pytest仍失败，经验candidate且未闭合 | partial，不能由自称成功或idle接受 |
| sharing-off | 来源已验证/引用完整，owner共享关闭；新session无应用，目标未执行 | partial，没有伪造交付/反馈 |

测试独立打开CLI生成的SQLite核对事实摘要/来源、verification base/fix/失败及回归、精确revision应用、不同session与反馈依据；没有只断言最终报告布尔值。本地check通过69项（含类型/静态/构建）、compat2项通过，26文档/58需求/58追踪/15场景映射通过。实际独立运行开发命令得到scripted_loop_passed/11次脚本调用，T011原账本SHA256仍d72138c863196251ea5dcaff42bbc7164002227520cb4de55a836e354969fe75。两平台当前头CI、实际tgz组件兼容和稳定SHA独立只读评审在关联PR追加，满足门槛才合并。真实DeepSeek计数兼容/模型闭环仍未验证，#8/#15/#34保持open；T011首次失败与历史无改善保留。
