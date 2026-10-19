# 路线与实际状态

| 任务 | 依赖 | 状态 | 分支 |
|---|---|---|---|
| T001 需求、架构、ADR、验收和开发基线 | 无 | 已合并PR #2，Issue #1关闭 | codex/t001-baseline |
| T002 数据、来源验证、经验选择和生命周期 | T001 | 9项测试两平台CI和必要复审通过，已合并PR #9，Issue #3关闭 | codex/t002-core |
| T003 DSH 固定版本工具与正常会话兼容探针 | T002 | 11项两平台CI和独立评审通过，PR #10已合并 | codex/t003-dsh |
| T004 最小面板及完整合成开发案例 | T002,T003 | 两平台13项及独立映射通过，PR #11已合并 | codex/t004-panel |
| T005 三组评价记录与完整性检查 | T002,T004 CLI | PR #14已合并，15项两平台CI及独立映射通过，Issue #6关闭 | codex/t005-remote |
| T006a 实际tgz安装组件探针 | T003,T004,T005 | PR #16已合并；修复首轮YAML失败后，15项及实际安装／Loader两平台CI、必要复审通过，Issue #7关闭 | codex/t006a-install-probe |
| T006b Codex CLI执行器 | T002,T005 | PR #17已合并，24项两平台CI及实际安装／独立映射通过；历史预算不等，不判断收益 | codex/t006b-remote，Issue #8部分进展 |
| T006c 三组执行与诚实证据 | T006b,T005 | PR #18已合并，32项两平台CI、实际安装及独立评审通过；有效经验对照未完成 | codex/t006c-remote，Issue #8部分进展 |
| T006 真实Agent实验与完整应用安装 | T003,T004,T005,T006a,T006b | Codex合成接入已有；真实任务收益、DSH模型回合和完整应用安装仍未完成 | Issue #8 |
| T007 开发工具依赖更新 | 当前功能PR | PR #13已squash合并，13项两平台CI及独立只读评审通过，Issue #12关闭 | codex/t007-tooling |
| T008 检索覆盖与有效经验对照 | T006c | T008a的BM25及冻结离线诊断已实现、待PR验收；有效模型对照仍未完成 | Issue #15 |
| T008a 长任务检索与离线消融 | T006c | PR #20已合并，37项两平台CI/实际安装/独立评审通过；误选和退步保留 | codex/t008-retrieval，Issue #19关闭 |
| T008b 有来源的反馈检索记忆 | T008a | 已实现accepted备用表述/irrelevant精确拒绝，39项本地检查；当前CI/评审/合并见关联PR，不属于收益实验 | codex/t008b-feedback-retrieval，Issue #21 |

远端：公开仓库wang1299/dsh-evolve。用户已恢复GitHub开发，PR #2/#9/#10/#11/#13/#14/#16/#17/#18已squash合并。当前交付T008a检索诊断，实际CI／评审／合并结果见[PR列表](https://github.com/wang1299/dsh-evolve/pulls?q=is%3Apr)，不以历史检查代替当前头。发布：无。

已有Codex真实合成接入；未见真实任务集的收益实验仍未完成，历史两组预算不等，不能据此判断收益。GitHub main当前无保护及ruleset，未修改权限或伪造正式Review；仍按验收、必要CI与AI独立评审条件合并。
