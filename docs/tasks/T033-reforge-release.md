# T033 更名 dsh-reforge 与首发

Issue [#75](https://github.com/wang1299/dsh-evolve/issues/75)，分支codex/t033-reforge-release，基线608ee05。ADR035先于实现；用户明确授权一次npm/GitHub公开发行。

目标：新包名/CLI/品牌、旧数据与契约兼容、经过验收的0.1.0-alpha.1 alpha包和相同制品的GitHub prerelease。

非目标：稳定质量或收益承诺；改变学习策略、旧预算/资格、账户安全设置、仓库搬迁或私人数据上传。

验收依赖：重命名/配置冲突/内容白名单回归，类型/静态/构建/完整测试/固定官方兼容，实际新包安装/学习演练/原生入口及旧数据保全，独立只读稳定SHA评审、当前头双平台CI和仓库规则后合并；随后核对账号、冻结tgz、npm发布/回读/公开安装、tag绑定完整性、GitHub prerelease/附件回读。

当前：PR #76 已在双平台 CI、独立代码/文档评审和规则核对后合并；发行源固定 `4bd55a5`。2026-10-23 由 wang129 完成本次发布认证，npm `alpha` 已公开、摘要与冻结包一致，公开新装通过且零模型调用。注释标签已推送；GitHub 首跑在创建 Release 前因 checkout 把 runner 内的注释引用替换为提交而失败。按 [ADR036](../decisions/036-first-release-recovery.md) 修复精确标签重新获取，并提供 main 上的无输入显式恢复入口；原标签、制品和保护校验不变。恢复实现另走稳定 SHA 只读评审、双平台 CI 和合并；最终远端运行、附件回读及完成状态追加本 Issue，未实际核验前不关闭。
