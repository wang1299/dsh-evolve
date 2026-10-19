# T018：standard服务档位的显式用量策略

Issue [#45](https://github.com/wang1299/dsh-evolve/issues/45)，依赖T017 / PR #44，设计[ADR021](../decisions/021-standard-service-tier.md)。

## 问题、范围与非目标

最小真实采样定位service_tier字段名，但值未知。实现显式t018-standard-tier-v1，只接受文档standard分支及缺省，继承T015高水位/最终输出；预算/回执身份保持一致，未知档位/其他未知usage保守拒绝，默认旧策略不变。只做离线合成回归，不新建付费计划、读真实凭据或调用模型；不修改旧预算/资格，不证明真实兼容、学习或收益。

## 验收与必要验证

1. 实现前ADR/失败用例入库；standard流在旧代码失败证据保留。
2. 缺省或standard的新策略完整流可结算，输入高水位和累计最终输出正确；旧两策略仍拒绝service_tier。
3. 错误档位/类型、未知字段/位置、缺输出/终结、超界和流/HTTP异常不结算，不保存值/响应文本；已接受service_tier不混入其他未知字段的指纹。
4. 新policyId贯穿新账本、回执、relay和重启；旧账本混开、未知策略和新策略v1拒绝且文件不改，新原因不能伪装旧策略。
5. 当前头类型/静态/构建、必要测试和两平台CI/实际包兼容通过，稳定SHA独立只读AI评审无阻塞、仓库合并条件满足后squash。

## 状态

设计/红用例后实现，本地100项check及31项针对回归、compat2项通过；当前头CI/独立评审/关联PR与限制见[T018验收](../development/T018-acceptance.md)。父#34/#8/#15仍open，未发布。
