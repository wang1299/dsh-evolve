# T017：单次真实Messages采样

Issue [#43](https://github.com/wang1299/dsh-evolve/issues/43)，设计先于实现见[ADR020](../decisions/020-single-messages-sample.md)。用户明确新增最多3元，只允许本轮1个真实响应。以下实现/离线检查不代表已运行真实采样，实际结果在后文及关联PR记录。

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
- 既有数值/终结/持久化预算回归19项通过。类型/构建/静态检查通过；完整check、compat、实际当前头CI和付费前独立只读结果在PR追加，满足门槛后才真实采样。
- 本地完整check已通过92项（类型/静态/构建及核心/集成），35文档/58需求/58追踪/15场景与diff检查通过；实际当前头两平台CI/独立审查另按门槛记录。采样前比对字典固定在ADR020，prepare同时冻结该设计文档摘要。

## 实际结果

尚未执行真实HTTP。须先稳定提交独立只读评审，再创建不可覆盖计划、0请求配置检查和一次live；不根据结果改题重跑。样本只用于当前最小请求的结构事实，不能认定旧T015相同字段或未保存的值/计费语义，不验证DSH Agent学习或收益。

旧T011预算SHA256应保持`d72138c863196251ea5dcaff42bbc7164002227520cb4de55a836e354969fe75`，T015保持`3a04eb6cc5270982de5c93fb0589e15ce442a8502600d5b7e30b011767cfd228`。#34协议兼容/后续采样、#8/#15完整学习和收益仍未完成；无发布、部署、账单/权限更改或私人原始材料上传。
