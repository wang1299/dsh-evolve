# T027：原生后台提炼提前于凭据就绪

Issue [#63](https://github.com/wang1299/dsh-evolve/issues/63)，依赖T020/T026；设计[ADR029](../decisions/029-native-extraction-readiness.md)。

目标：修复完整DSH启动时预排队提炼早于managed凭据服务就绪的问题，并提供不泄露秘密的固定失败类别。

范围：原生port发现、固定失败reason、v8读取契约与面板提示、实际安装启动复现。非目标：读取Key、自动重放unknown、增加授权/金额、候选自动启用或收益评价。

验收：见ADR029；加载中与缺失服务不占用grant；active后一次候选；分类隐私负路径与旧数据保留；完整官方host实际tgz managed/env两路径离线验证；类型/静态/测试/兼容/构建/安装及两平台CI和独立只读评审通过。

当前：已实现；本地完整154项、兼容8项、demo、实际包四场景与完整官方CLI managed/env预排队两路径通过，实际安装模块迁移副本及旧读者拒绝v8通过。稳定源码独立只读AI评审无阻塞，详见[验收](../development/T027-acceptance.md)。最终当前头CI/文档增量评审/合并以[PR #64](https://github.com/wang1299/dsh-evolve/pull/64)为准；旧用户记录与预算未重试或清零。
