# 路线与实际状态

| 任务 | 依赖 | 状态 | 分支 |
|---|---|---|---|
| T001 需求、架构、ADR、验收和开发基线 | 无 | 已合并PR #2，Issue #1关闭 | codex/t001-baseline |
| T002 数据、来源验证、经验选择和生命周期 | T001 | 首轮Ubuntu通过，Windows别名故障已复现修复；9项测试待新提交CI与必要复审，Issue #3 | codex/t002-core |
| T003 DSH 固定版本工具与正常会话兼容探针 | T002 | 计划 | codex/dsh-adapter |
| T004 最小面板及完整合成开发案例 | T002,T003 | 计划 | codex/mvp-panel |
| T005 三组评价驱动与结果完整性检查 | T002 | 计划 | 待创建 |
| T006 真实 Agent 实验、安装包与发布候选验证 | T003,T004,T005 | 计划 | 待创建 |

远端：公开仓库wang1299/dsh-evolve已建立。Issue #1、#3-#8已创建；PR #2已squash合并。当前核心PR需等待Windows/Linux CI。发布：无。

没有配置真实模型执行器与未见任务集，真实Agent效果实验未运行。GitHub main当前无保护及ruleset，未修改权限，也没有伪造正式Review；仍按验收、必要CI与AI独立评审的流程条件合并。
