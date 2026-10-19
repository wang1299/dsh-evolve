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
| T006d 完整CLI/Web独立试装 | T006a,T008c | Windows完整官方0.2.0-rc.2安装、Web组件运行及停止重启通过；PR #26经两平台CI/独立评审合并，Issue #25关闭 | codex/t006d-dsh-preview |
| T006 真实Agent实验与完整应用安装 | T003,T004,T005,T006a,T006b | Codex合成接入及Windows完整CLI/Web试装已有；真实任务收益、DSH模型回合、Desktop/其他平台完整应用仍未完成 | Issue #8 |
| T007 开发工具依赖更新 | 当前功能PR | PR #13已squash合并，13项两平台CI及独立只读评审通过，Issue #12关闭 | codex/t007-tooling |
| T008 检索覆盖与有效经验对照 | T006c | T008a/b已交付；T008c两题三组有经验差异但无验收收益改善，更多真实任务和重复仍未完成 | Issue #15 |
| T008a 长任务检索与离线消融 | T006c | PR #20已合并，37项两平台CI/实际安装/独立评审通过；误选和退步保留 | codex/t008-retrieval，Issue #19关闭 |
| T008b 有来源的反馈检索记忆 | T008a | PR #22已合并，39项两平台CI/实际安装/独立评审通过，不属于收益实验 | codex/t008b-feedback-retrieval，Issue #21关闭 |
| T008c feedback-v1真实模型初步对照 | T008b,T006c | 7/7次真实调用，积累通过、两题三组均2/2，Evolve提供经验但无验收改善；PR #24经44项两平台CI/实际安装/独立评审合并，Issue #23关闭 | codex/t008c-feedback-evaluation |
| T009 详细需求与架构基线 | T001及当前实现/验证 | PR #28经当前头两平台CI与独立评审合并，Issue #27关闭；58项需求、15场景与G01–G10追踪 | codex/t009-design-baseline |
| T010 事实来源与历史保留 | T009，G01/G07切片 | SQLite v3最小证据/逐条引用、evidence-v1默认资格、六工具与面板；本地53项及界面通过；来源相同幂等，完整已验证来源锁定；当前头CI/包安装/独立评审见关联PR | 已合并PR #30，Issue #29关闭 |
| T011 有预算真实DSH验证 | T010、独立宿主、用户Key/5元 | 实际4请求、源码事后pytest通过；候选引用失败，预算unknown保留，partial；59项两平台代码CI通过，最终门槛见PR | codex/t011-dsh-live-validation，Issue #31 / PR #32 |
| T012 模型可见引用契约 | T010/T011 | 原生嵌套schema、引用顺序和错误重放；59项两平台CI/独立评审通过，已合并PR #35；不声明模型修复效果 | codex/t012-tool-input-contract，Issue #33关闭 |
| T013 数值用量回执 | T011/T012 | 已合并PR #36，65项两平台CI/必要增量独立复审；数值回执离线完成，真实采样待做；不回填旧unknown | codex/t013-numeric-receipts，Issue #34保持open |
| T014 原生Agent脚本演练 | T010–T013 | 已合并PR #38，Issue #37关闭；5场景、70项两平台CI及必要独立复审，零付费，不是模型或收益证据 | codex/t014-agent-rehearsal |
| T017 最小单次真实采样 | T016、用户新增最多3元 | Issue #43 / PR #44；一次HTTP200/987字节，唯一未知字段指纹匹配service_tier，值/历史原因未知；2.232768元未知占额，未重跑；证据与最终门槛见[T017验收](development/T017-acceptance.md) | codex/t017-messages-sample |
| T016 未知usage结构诊断 | T013/T015、Issue #41 | 可选v2回执/固定拒绝位置/有限字段指纹，离线检查及最终CI/评审门槛见关联PR；没有新付费或真实字段认定 | codex/t016-usage-diagnostics |
| T015 追加预算真实学习回归 | T012–T014、用户另授权5元 | PR #40 / Issue #39；一次live共2个HTTP，start usage未兼容、来源仍open/经验0，partial；代码77项两平台检查、付费前及结果独立核对通过，当前提交CI/合并门槛见PR | codex/t015-live-learning |

远端：公开仓库wang1299/dsh-evolve。T015真实学习回归（PR #40）和T016结构诊断（PR #42）已合并，T017单次真实采样（Issue #43 / PR #44）定位当前响应service_tier字段但未兼容其值；最终CI／评审／合并见[PR列表](https://github.com/wang1299/dsh-evolve/pulls?q=is%3Apr)。T011/T015真实学习仍partial，发布：无。

后续实现从[架构缺口G01–G10](architecture.md#16-缺口与实施依赖)拆出独立任务。T010仅完成G01/G07显式来源切片，自动错误尝试归并/提炼、耐久协调、彻底遗忘仍未完成；继续G03/G02、G04、G05，G06独立重建/收益评价，G08/G09/G10按风险推进。优先跟进真实失败#33（引用契约，离线实现见[T012](development/T012-acceptance.md)）/#34（[用量数值回执](development/T013-acceptance.md)，离线实现），用户已在原预算之外明确新增最多5元，设计[ADR018](decisions/018-supplemental-live-validation.md)、执行与限制见[T015验收](development/T015-acceptance.md)；旧实验/未知预留不改。本轮实际2请求后保守停止，结果partial，结构诊断切片已另立[T016](development/T016-acceptance.md)，协议兼容/新采样仍在#34，不自动追加预算。父Issue #8/#15保持open。

已有Codex真实合成接入；未见真实任务集的收益实验仍未完成，历史两组预算不等，不能据此判断收益。GitHub main当前无保护及ruleset，未修改权限或伪造正式Review；仍按验收、必要CI与AI独立评审条件合并。
