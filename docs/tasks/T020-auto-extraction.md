# T020：自动提炼候选经验

Issue [#49](https://github.com/wang1299/dsh-evolve/issues/49)，基线278f58a；设计[ADR023](../decisions/023-automatic-candidate-extraction.md)。G02/G03切片，依赖T019。

## 范围与验收

1. 默认不发送；owner独立配置并仅对随后显式finish任务授予资格，无历史回填，LLM缺失不扣额。
2. ready证据重新核对后，经固定官方DSH LLM接口自动生成最多一条candidate；宿主事实／引用／scope，不接受模型编造事实或状态。
3. 输入32KiB、输出有界、严格JSON与abstain；不完整、篡改、版本漂移、失效策略/额度不产生候选。
4. SQLite v5原子迁移／授权额度／单次占用／发布与去重；重启不退额，中断unknown不自动重跑，陈旧结果不发布。
5. 面板可看状态、来源和候选；DSH可选LLM、卸载与实际包兼容；针对测试、全量检查、两平台CI、稳定SHA独立只读评审通过后squash。

## 非目标

本次无付费调用、真实Key操作、自动激活、后续收益结论、历史批量上传、新Agent循环、发布或上游贡献。#8/#15/#34保持独立。

## 开发顺序

设计 → 必要失败用例 → 持久化／固定材料／模型端口 → 自动调度与面板 → 针对／完整验证 → Draft PR／独立评审／修复／CI → 合并。实际证据见[验收记录](../development/T020-acceptance.md)与[PR #50](https://github.com/wang1299/dsh-evolve/pull/50)。
