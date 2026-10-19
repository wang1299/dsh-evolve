# T017：单次真实Messages采样

Issue [#43](https://github.com/wang1299/dsh-evolve/issues/43)，[PR #44](https://github.com/wang1299/dsh-evolve/pull/44)，设计先于实现见[ADR020](../decisions/020-single-messages-sample.md)。用户明确新增最多3元，只允许本轮1个真实响应；本轮已经执行一次，结果和限制如下。

## 实现与固定边界

新增`scripts/messages-sample.ts`，固定项目根的新`.probe-work/t017-sample`和`t017-budget.json`。方案含准确3元、1请求、v2回执、固定body摘要、代码/凭据插件/旧预算摘要，1小时有效；计划/单次资格/报告wx，不覆盖/自动重跑。Key仅由固定官方本地凭据服务在内存resolve，probe只describe；采样不启动AgentLoop或原生SessionStore，不保存文本响应/完整SSE/错误或任意HTTP头。

预算新schema3显式金额/maxCalls=1/receiptVersion=2/policyId。构造须显式第四参数；旧/默认构造、不同金额/回执格式、把旧库改为单次预算均拒绝。最低金额覆盖原2232768微元最坏预留，上限保持5000000微元；本轮固定3000000微元。即使第一次结算仅少量费用，或进程重启，也不能预留第二次；旧schema1/2默认行为与历史文件不变。不是费用账单接口，不回填旧unknown。

固定官方Anthropic Messages endpoint，deepseek-flash、非思考、16输出token、一条合成短提示`Reply only OK.`，无system/历史/tools/文件。relay wrapper再次要求字节完全相同和最多1个真实transport；每次预留前核对方案/源码。整体报告只含有限原因、状态、字节、预算及v2结构回执。`response_sampled`只指已收到响应并保存诊断，不等于用量已结算或学习成功；失败为sample_failed/exit1。

## 使用和验证

源码构建后，仅在已确认本轮3元授权及新环境时：

```sh
node dist/scripts/messages-sample.js --prepare <official-host-root> <dsh-home>
node dist/scripts/messages-sample.js --probe
node dist/scripts/messages-sample.js --live
```

prepare/probe均0模型HTTP；live仅一次，不能调用旧T011/T015入口来续跑。CLI仅打印有限汇总，完整结构化报告/回执与本机路径不上传。

- 设计9321a9f先提交，单次预算接口红用例基线构建因缺第四参数失败，提交79f931f保留。
- 实现后单次预算/入口8项针对回归通过：准确金额/重启/第二请求拒绝，金额下限/超限/旧库不改，固定请求/丢弃响应/无重复，未知结构全额保留，源码漂移在凭据/网络前拒绝，probe零请求/不消费资格，过期拒绝，HTTP402/传输异常不保存秘密，cwd锚定。
- 既有数值/终结/持久化预算回归19项通过。类型/构建/静态检查、完整check的92项及compat的2项通过；35文档/58需求/58追踪/15场景与diff检查通过。采样前比对字典固定在ADR020，prepare同时冻结该设计文档摘要。
- 付费前独立只读AI评审：稳定远端`cae8c0694952ae13dbd1f46fcf2c7b3fe4e34744`，基线`bf9508ce71ee7aec94ecdf81dd1272d23f922048`，树`54c13af2f7a98be6af8fef2c891eb759fe86780f`与本机执行源码树一致；独立29项针对回归通过，55个编译JS一致，无阻塞P0/P1/P2。此时尚无真实样本，评审不替代下面结果核对。
- 付费前当前源码头CI [39238510882](https://github.com/wang1299/dsh-evolve/actions/runs/39238510882)的Windows/Ubuntu均成功。真实结果文档的最终提交仍须核对独立评审、当前头CI及仓库合并条件，实际状态以PR为准；AI评审不伪装GitHub正式批准。

## 实际结果

2026-10-19 10:38 UTC，在上述门槛通过后建立新计划，prepare/probe均0模型请求且官方凭据配置检查通过。只执行一次live：1个真实HTTP，状态200，响应987字节，汇总为`response_sampled`、回执原因`unsupported_usage`。没有重试、第二请求、AgentLoop或原生SessionStore；未保存响应文本/完整SSE/错误/Key。

v2回执诊断为`start_message_usage` / `unknown_fields` / `object`，未知字段数1、省略0；保存的唯一字段指纹为`9eeb656e7cbd78e63f1986403cfd16a79c294cd7c237883c8eefa81edaec8206`。与冻结ADR020的6个名称按`SHA256(UTF8("dsh-evolve/usage-field/v1\0" + fieldName))`比对（`\0`表示单个NUL字节），唯一匹配`service_tier`，无未匹配或被省略指纹。由此只确认**当前最小响应**usage对象多出该字段，严格四计数器策略因它拒绝；字段的实际值/类型没有保存，不能推断档位或计费语义，也不能认定T011/T015的历史拒绝相同。匹配输出仅保存名称白名单的比对结果及摘要。

回执仅解析到message_start数值input=8/output=0/cacheRead=0/cacheWrite=0；最终用量未知。新schema3账本准确上限3元、maxCalls=1，调用`50798744-52e2-4653-886a-74a2714d54b4`保留2232768微元（2.232768元）最坏占额，usage=null；这不是账单或已知扣费。不用这几个起始计数估算实际总费用，不释放未知占额；即使账本名义余0.767232元，本轮一次资格也已消费，不允许重跑。

协议兼容需另立设计/回归，保持冻结旧策略、旧预算和本轮样本不变。此结果没有证明经验提炼/应用、正常DSH学习闭环或Agent收益。

## 本机有限证据摘要

原始材料仅在ignored目录保留；公开以下文件名/去敏数值/摘要，不上传完整报告或私人路径。方案逻辑摘要为`978019651bb7e4b79c50a5bce0d176f280f5ef2c511496f799ac97a62c4d8c4f`。文件SHA256：

| 证据 | SHA256 |
|---|---|
| plan.json | `57eff154a95bd119340c78f03c174eceecbab221897ba36657b95f9176fa7b06` |
| plan-digest.txt | `91228cbc6978d9cbe5478936deffcf14fd170f283b676b492928be203d0e1607` |
| probe.json | `cb8ab7b9bf9536c2f72ef872f77c809459f8787e8edc994012f06bb84ce9b320` |
| live-once.json | `4cfcd0a71df9e78089907a37a4635fe1fe79744b422b8d054bfde6d77bec9f8b` |
| report.json | `366ce84b14c3eeccb9c0e5205f341c37310f9fdd11dab812900a14b06c0bbd12` |
| t017-budget.json | `66f847524bbf4758b60f64413b1bdb974dc1b87499bd0640af1ce714096232aa` |
| field-comparison.json | `16e098a25975305c1ebd70b8003a3ea83432be5eb23ba6931e7974f0a0c67e88` |

旧T011预算SHA256应保持`d72138c863196251ea5dcaff42bbc7164002227520cb4de55a836e354969fe75`，T015保持`3a04eb6cc5270982de5c93fb0589e15ce442a8502600d5b7e30b011767cfd228`。#34协议兼容/后续采样、#8/#15完整学习和收益仍未完成；无发布、部署、账单/权限更改或私人原始材料上传。
