# ADR021：显式standard服务档位解析策略

日期：2026-10-19，设计先于实现；Issue #45，依赖T017 / PR #44。目标是解除#34的一个协议边界，不改变产品学习目标，不新增付费资格。

## 事实、依据与限制

T017唯一真实样本在start_message_usage处因未知字段拒绝，冻结字典唯一匹配service_tier；没有保存字段值/类型或完整SSE。[官方Anthropic响应示例](https://platform.claude.com/docs/en/api/messages/create)包含`service_tier="standard"`；[DeepSeek兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)的service_tier ignored描述请求字段，不能用来证明响应值。两文档于2026-10-19核对。

因此只实现文档支持的严格standard分支，不能称其为T017实际值重放或真实根因修复；null、priority、空字符串、其他类型/值均保守拒绝。未来发现其他真实值时须有依据和新设计，不把未知档位直接按现价结算。

## 输入、输出和选择

新增明确身份`t018-standard-tier-v1`，输入仍是有界SSE和输入/输出上限，输出仍为有限原因、数值快照/用量及可选v2诊断。默认T011、显式T015逐项规则保持；没有自动切换策略。

新策略继承T015的输入/缓存分项快照高水位及单调累计输出；只在message_start.message.usage、message_delta.usage接受缺省或严格字符串standard的service_tier。它不是token计数，不进入快照、字段指纹或费用公式。其他直接未知usage字段继续unsupported_usage，诊断只指纹真正未知字段；其他位置的usage继续拒绝。

已知字段service_tier的不支持值返回新有限原因`unsupported_service_tier`、usage=null、diagnostic=null；不序列化值/类型/提供商文本。未知字段优先保持原unknown_fields诊断。终结、帧完整性、输入/输出边界和HTTP/流异常检查不放宽。

## 持久化和兼容

策略身份贯穿预算、回执和relay。扩展现有schema2/3的policyId枚举支持新身份：schema2仍5元/原调用上限，schema3仍显式金额/1请求/回执2；每个原policyId含义不改，不修改已有文件，不新建实际实验账本。新策略构造必须显式选择并使用receiptVersion=2，未知策略在创建目录/锁/账本之前拒绝。

回执v1只允许旧两策略/旧原因；v2增加新策略身份和有限原因，但unsupported_service_tier只允许新身份，且没有诊断值。旧程序会拒绝不认识的新身份/原因，不能混跑或直接降级打开新策略账本；不存在自动迁移、补造回执或旧unknown重算。读取旧v1/v2及原schema1/2/3的现有含义保持。

这不是新增预算授权或live入口；新策略的默认5元实验格式只是已有schema2的静态上限，任何后续真实运行必须另行固定用户授权金额、方案、凭据接口、版本和独立预审。本轮只用假transport/假Key和临时合成账本，不读取真实凭据/旧会话，不改T011/T015/T017入口、资格或证据。

## 验收与后续

先保留standard流旧代码实际失败，再覆盖：缺省/standard通过、输入高水位/最终输出、两旧策略仍拒绝、不支持档位/未知字段/错误位置/终结/边界保守拒绝；新策略回执身份/重启/混开/v1拒绝及失败全额占额，持久化无响应文本/字段值。必要类型/静态/构建、完整检查/兼容、当前头两平台CI及实际tgz安装、稳定SHA独立只读审查后合并。

合成测试只能证明这个协议分支的行为。真实响应是否适用、正常DSH学习闭环和未见任务收益仍未完成，#34/#8/#15保留；后续真实验证不复用T017单次资格或释放历史未知占额。
