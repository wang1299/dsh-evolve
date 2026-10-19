# ADR020：3元内单次真实Messages采样

日期：2026-10-19，设计先于实现。用户明确新增最多3元且只采集1个真实响应；原T011/T015账本和unknown保持。依赖ADR019结构诊断，目标是#34当前协议定位，不是学习或收益实验。

## 预算与资格

新增预算账本schema3，显式记录授权预算、maxCalls=1、receiptVersion=2、原policyId和调用。DeepseekBudget只有显式第四参数单次预算才创建/打开此格式；v1/v2账本及默认构造行为不变，旧程序/默认构造不能混开schema3，不能变更限额或伪造第二次请求。金额为整数微元，在原5元保护上限内，且须覆盖原最坏预留2232768微元。本轮准确固定3000000微元，虽输出仅16仍保留既有4096输出最坏预留，不依靠近似token估计缩减。

新方案`.probe-work/t017-sample`、账本`.probe-work/t017-budget.json`均固定项目根，计划wx/逻辑摘要/执行脚本与凭据插件代码摘要；一次live资格wx在任何请求前消费。预算自身只准一个预留，即使结算很低或重启也不能开启第二请求。无自动重试或根据结果改计划。旧两个账本摘要在新计划中固定并在执行前/后核对，不回填或释放。

## 请求与凭据

固定`https://api.deepseek.com/anthropic/v1/messages`、model=deepseek-flash、stream=true、thinking.disabled、max_tokens=16、一条作者编写的短合成提示，无system/tools/附件/历史。只使用T016 relay及v2回执；官方本地凭据服务通过固定引用在内存resolve，Key不落盘/输出/复制到计划，错误仅有限固定分类。probe只describe是否配置，不发HTTP；rehearse使用fake key+合成transport，绝不加载真实凭据。

2026-10-19重新核对[官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)仍为Flash高峰输入未命中2元/百万、输出8元/百万（缓存也按未命中），别名当时对应DeepSeek-V4.1-Flash-1017。[兼容文档](https://api-docs.deepseek.com/guides/anthropic_api/)支持stream/max_tokens/thinking。固定官方DSH0.2.0-rc.2凭据插件用于解析；本轮绕过AgentLoop直接采最小HTTP，不能说已验证正常DSH Agent会话或修复学习。

## 采样、保留与判定

最多1MiB响应只在内存转交/丢弃；不启动DSH会话、不保存文本/完整SSE/任意头或错误。保留固定方案、单次资格、预算/v2回执及有限汇总（HTTP状态/字节/原因/字段指纹/数值计数）。这些都在本机ignored；公开只有去敏结论与摘要。无法结算就保持全额未知；诊断成功不等于预算已结算。

字段指纹可与事先明确的官方协议字段名列表同域计算比对。匹配最多只能证明当前采样位置存在同名字段，不能从未保存的值/类型推断计费语义，不能认定历史T015也是该字段；无匹配或被截断时明确未知。协议兼容修复另立聚焦任务，不能直接忽略未知usage或在本轮追加调用。

## 实施门槛

先红用例，再实现单次预算/入口；离线验证金额/格式身份、重启/第二请求拒绝、计划及源码漂移、单次资格、0调用probe/假的rehearsal、HTTP失败保留全额/隐私。付费前稳定提交独立只读评审，随后新固定计划及零调用检查，一次live后保存失败/结果；必要完整check/兼容、当前头两平台CI/实际tgz兼容及最终只读证据核对后才合并。无发布、部署、账单或权限修改。
