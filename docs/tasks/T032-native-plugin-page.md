# T032 插件详情入口与宿主样式

Issue [#73](https://github.com/wang1299/dsh-evolve/issues/73)，依赖 T031，分支 codex/t032-native-plugin-page，设计 ADR034。

目标：从左侧插件列表进入 DSH-Evolve 操作页，内嵌紧凑布局跟随宿主主题。保留经验内容、来源验证、使用记录与反馈，主题变化不丢草稿。单仓库；不新增模型/授权/预算/数据迁移或发布。

必要验证：官方 keyed slot 精确包名、构建与主题有限消息、原生安全/草稿回归、实际 tgz/固定完整 Web 的插件入口、明暗主题及窄屏。独立只读评审及最终双平台 CI 满足后合并，再保全升级已有试装。

已实现，官方完整Web实际tgz的插件页、明暗主题/草稿保留/保存和窄屏已验；完整检查、独立评审、最终CI和交付见[验收](../development/T032-acceptance.md)及Issue关联PR，未发布。
