# T014：真实DSH Agent循环离线演练

Issue [#37](https://github.com/wang1299/dsh-reforge/issues/37)，依赖T010–T013、[ADR017](../decisions/017-agent-loop-rehearsal.md)，父#8/#15及#34继续保留。

目标：在新增付费复测前，用固定脚本适配器和真实AgentLoop验证来源→候选→验证→绑定→后续任务交付→独立验收→反馈。范围/非目标和失败门槛见ADR；不把脚本当模型智能。

验收：报告实际阶段、工具调用和数据库/外部pytest依据；错误引用/无效修复不得继续；零模型网络、旧资格不变、独立评审及当前头CI通过。初始状态：开发中，尚未验证真实模型。

实现和实际验证范围见[T014验收](../development/T014-acceptance.md)；交付门槛在关联PR记录。
