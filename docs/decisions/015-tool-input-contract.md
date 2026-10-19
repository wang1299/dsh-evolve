# ADR-015：模型可见的候选与事实引用契约

2026-10-19，T012 / Issue #33，基线bb4dd9d。T011的真实模型把来源receipt直接当作FactCitation，缺factIndex/factDigest且多kind；候选被拒绝。本轮只做离线修正，不重新调用模型。

## 决定（先于实现）

- 固定DSH 0.2.0-rc.2。用其公开ObjectValueSchemaSpec/ArrayValueSchemaSpec替代candidate/citations的任意JSON节点，逐项标明必填字段、类型及封闭嵌套对象。revision采用integer。没有新增工具、数据迁移或宿主升级。
- Candidate保持title、strategy、observedFacts、inferences、recommendations、requiredFiles。每项语义、长度/数量限制和相对路径规则向模型说明；官方DSL不能表达的边界仍由原Zod和服务验证，不能声称DSL验证了全部约束。
- FactCitation只能含factIndex、factDigest、evidenceId、evidenceDigest。来源receipt的kind只用于解释证据类型，不传入引用；摘要必须复制工具回执，不能由模型猜测。引用不认证文字真值。
- 首选顺序：begin → 明确纠正及代码修复 → propose不带citations → verify（已有修复commit、owner信任）→ 用最新revision及facts和同任务evidence receipt调用link → finish。verify之前只支持纠正来源时也可以先link；后续verify改变revision后必须使用新回执。已知精确摘要的调用方仍可在propose传citations。
- 不自动补字段/猜hash/删除额外kind。不改变同任务归属、摘要校验、精确版本、完整来源锁定、负反馈和owner权限。错误输入必须继续拒绝且不产生候选。

## 验证与限制

先断言真实SystemPrompt组装后的工具JSON Schema可见全部字段，再离线重放T011错误；正确路径只使用实际输出facts和纠正receipt绑定，并验证旧版本/错误hash拒绝。运行类型/静态/单元/固定DSH兼容、实际tgz安装组件及两平台CI；稳定SHA独立只读审查。模型是否因此正确调用仍未验证；同一已见案例也不能作为未见收益。
