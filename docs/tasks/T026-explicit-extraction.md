# T026：未知提炼后的一次显式重新授权

Issue [#61](https://github.com/wang1299/dsh-evolve/issues/61)，依赖T020/T025；设计[ADR028](../decisions/028-explicit-extraction-reauthorization.md)。

问题：原提炼在发送前已占用次数，unknown不可自动重放。目标：owner用新单次grant显式追加一次可追溯尝试，保留全部旧状态与财务占额。

范围：owner CLI/service、SQLite v7迁移、一次父子关联和面板只读展示。非目标：自动重试、链式续费、金额授权、候选自动启用、Windows权限修复、收益声明。

验收：详见ADR028；必须覆盖真实来源、并发幂等、旧数据不变、拒绝不适用状态、迁移回滚、CLI仅排队，相关检查及CI/独立评审通过。

当前：已设计，待失败用例与实现。真实调用单独受用户当前明确授权和既有财务上限约束。
