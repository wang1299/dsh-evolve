# T012：明确模型工具输入契约

Issue [#33](https://github.com/wang1299/dsh-evolve/issues/33)，依赖T010/T011。[ADR015](../decisions/015-tool-input-contract.md)先于实现。

范围：原生嵌套Candidate/FactCitation schema、receipt与引用的区别、提案后绑定顺序、错误重放和正确映射。非目标：自动提炼、放宽来源验证、迁移、模型复测或收益评价。

验收：实际组装schema有所有必填字段/封闭嵌套对象，错误receipt输入仍拒绝且无候选；正确回执映射兼容；既有归属/摘要/版本/锁定测试保持。检查、实际包探针、当前头CI及独立评审通过后合并。当前进入开发，未声明模型效果。
