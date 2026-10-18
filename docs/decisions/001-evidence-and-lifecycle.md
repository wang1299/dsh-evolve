# ADR-001：本地证据与经验生命周期

状态：接受用于首版实现，2026-10-18。

## 选择

采用本地 SQLite，schemaVersion=1。任务、经验版本、应用、反馈、验证报告分别存储。当前条目引用版本，修订保留旧内容。任务 id、session id、repo id 和 Git commit 是证据链，事件 id 幂等。

经验内容包含：title、conditions（必要相对代码路径及摘要、仓库指纹、依赖摘要）、observedFacts、inferences、recommendations、strategy、verificationId、sourceTaskId、revision/reason。状态为 candidate、source_verified、disabled；代码条件不匹配通过选择理由呈现为不适用。source_verified 不代表已证明有未来任务收益。

一次来源验证只提升到 source_verified。用户否决或可复现反例停用。恢复旧经验内容产生新 candidate 版本，需要重新验证，不能恢复负反馈前的效用统计并假装重新有效。

应用记录绑定任务和经验版本。未知反馈不计为成功；重复反馈 id 幂等。首版使用已知结果的平滑成功比例，数据少时保留先验；成功关联不等于因果贡献。每任务最多注入一条以降低归因混杂。

## 证据边界

验证由指定两个 commit、固定外部验收测试、回归命令和环境指纹组成。验收测试来自独立目录，不从 Agent 修改的树取回。必须确认失败版本是 pytest 测试失败（退出1且存在有效测试结果），退出2/3/4/5和超时／基础设施错误不算复现。修复 commit 需是失败 commit 的后继；仓库必须匹配来源。回归同样必须发现并通过测试。

日志只保存退出码、测试计数、耗时和截断脱敏摘要，不保存完整对话。报告带输入和验收内容摘要，不能由调用者直接声明成功。

## 替代方案

直接写 Markdown 难以保持应用反馈、版本与验证报告原子一致；首版仅把 Skill 导出作为后续可选交换能力。训练底模／复杂RL不适合首版反馈规模。
