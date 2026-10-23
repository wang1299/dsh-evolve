# T033 更名 dsh-reforge 与首发

Issue [#75](https://github.com/wang1299/dsh-evolve/issues/75)，分支codex/t033-reforge-release，基线608ee05。ADR035先于实现；用户明确授权一次npm/GitHub公开发行。

目标：新包名/CLI/品牌、旧数据与契约兼容、经过验收的0.1.0-alpha.1 alpha包和相同制品的GitHub prerelease。

非目标：稳定质量或收益承诺；改变学习策略、旧预算/资格、账户安全设置、仓库搬迁或私人数据上传。

验收依赖：重命名/配置冲突/内容白名单回归，类型/静态/构建/完整测试/固定官方兼容，实际新包安装/学习演练/原生入口及旧数据保全，独立只读稳定SHA评审、当前头双平台CI和仓库规则后合并；随后核对账号、冻结tgz、npm发布/回读/公开安装、tag绑定完整性、GitHub prerelease/附件回读。

当前：实现、本地检查与独立代码评审已完成，PR #76等待最终头CI和合并。npm已由用户本人登录并核对为wang129；登录脚本仅本机忽略目录，凭据由用户本人处理。没有发布或创建tag/Release。具体结果追加验收文档与本Issue，不能提前关闭本Issue。
