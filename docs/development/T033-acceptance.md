# T033：DSH-Reforge 首次发行验收

2026-10-23；Issue [#75](https://github.com/wang1299/dsh-evolve/issues/75)，基线 `608ee05e5059d9ac5a43f20ea31e696da274db7b`。ADR035 于实现前提交。用户明确授权包名 dsh-reforge、npm 与 GitHub Release；npm 已由本人登录，实际账号核对为 wang129。仓库仍为 wang1299/dsh-evolve。

## 范围与复现

包/CLI/品牌为 dsh-reforge / DSH-Reforge / 0.1.0-alpha.1；旧 patch 行 ID、工具/内部RPC、配置别名、数据位置和 SQLite v9 保留。公开白名单仅产品编译输出、patch、README、LICENSE、CHANGELOG 和安装指南。tag 工作流只处理本次准确版本，先核验 npm 实际制品，再建草稿/上传/核对/发布 prerelease；不申请长期凭据或修改账户安全设置。

已保留的失败：先修改 bundle 对 module name 的断言，旧实现实际报 `0 !== 1`；完成改名后针对检查通过。独立试装首次移除依赖时给 pnpm remove 传入不支持的 ignore-scripts 参数，退出1；核对 profile 和 SQLite 仍与备份一致后，使用官方正常 remove 命令成功，未重置或删除经验。

可复现检查：

```sh
npm ci --ignore-scripts
npm run check
npm run compat
npm run demo
npm pack --pack-destination .probe-work
node scripts/audit-package.mjs .probe-work/dsh-reforge-0.1.0-alpha.1.tgz
npm run install-probe -- .probe-work/dsh-reforge-0.1.0-alpha.1.tgz
npm run install-probe -- .probe-work/dsh-reforge-0.1.0-alpha.1.tgz --learning
```

## 已执行结果

- 改名/配置别名/manifest/lock/白名单/annotated tag/registry绑定及原生入口针对检查：9/9；后续改动另做必要增量检查。
- 固定官方 DSH 0.2.0-rc.2 兼容：8/8。
- 合成 Git/pytest demo：原始失败1、修复与回归通过；没有模型执行或收益声明。
- 实际 tgz 初次审计：77文件、138546字节；未包含脚本、测试、开发工具、临时材料或私人数据。最终发行会从合并树重新冻结，不能用此初次摘要替代最终制品。
- Windows 完整官方CLI/Web独立profile升级：停止旧进程并备份，remove旧本地包→add新tgz；只加载一个新模块；旧配置变量有效、SQLite v9所有旧表行的摘要一致、配置字节不变；share/automatic均关闭，零模型HTTP。
- 浏览器实际插件页显示 dsh-reforge v0.1.0-alpha.1、组件运行，原生页 DSH-Reforge、旧候选和学习状态可见。仅合成数据；截图本机忽略目录保留，不上传。

## 当前门槛与限制

完整本地检查：类型、静态、构建通过；190项中189通过、0失败，1项因本机Windows缺少符号链接权限跳过。后续仅测试临时目录初始化调整，增量类型/静态及发行针对4/4通过。实际安装组件探针通过；安装包四场景的完成/坏提炼/关闭共享/失败目标均符合预期，正常对话附加演练通过，零evolve工具调用和模型HTTP。两个工作流YAML可解析。稳定代码 `a26a1109f994b47070ca1985381aa4ab15b55202` 相对基线由独立只读 AI Agent 审查，更名兼容、制品白名单、配置、tag/registry/digest绑定、草稿/重复副作用及文档均未发现可复现P0/P1/P2。只读差异/语法及manifest/tag/registry正反校验通过；不构成GitHub正式Review。后续文档增量另行只读核对。

最终头 `d9131239d3a0d186d808e99a476147ff5c6b53cb` 的双平台 CI [39884391300](https://github.com/wang1299/dsh-evolve/actions/runs/39884391300) 成功，规则核对后 [PR #76](https://github.com/wang1299/dsh-evolve/pull/76) 已 squash 合并为 `4bd55a594ac75bdf4cfb331d94944026bbcc1578`。用户试装保全升级及冻结包再次检查通过。

## npm 公开结果与 GitHub 恢复

2026-10-23，由 wang129 通过新电脑本次登录及安全密钥验证，公开发布 `dsh-reforge@0.1.0-alpha.1`，`alpha` 标签正确。上传返回成功后先有后台处理和精确版本 404，随后公开版本可下载；没有重复上传。最终包为77文件、138540字节，SHA256 `c84fc11d789359a65f9e58397883f4d1026d359a0cca71867b1fa567729d8bd3`，SHA1 `77d38e9e5f0e3bf37b730d1da935162b09432e88`，SHA512 与冻结清单、注释标签一致。隔离 profile 从公开 registry 安装准确版本，77个文件逐字节一致；固定 DSH 0.2.0-rc.2 原生接口认证通过、匿名访问拒绝，默认不学习且零模型请求。新电脑完整检查189通过、0失败、1符号链接权限跳过；compat8/8和合成demo通过，私人数据、预算和提炼次数未增加。

注释标签 `v0.1.0-alpha.1` 已推送，远端对象 `5035a5b59e85ca7becdf19aaac0eab18333e4ddd` 指向上述源提交。GitHub 首跑 [39911777719](https://github.com/wang1299/dsh-evolve/actions/runs/39911777719) 在创建草稿或 Release 前因 checkout 的第二次 SHA fetch 覆盖了 runner 本地标签引用而失败。远端标签未改变；原脚本的注释类型断言正确拒绝继续。

按 [ADR036](../decisions/036-first-release-recovery.md) 增加精确标签重新获取和 main 上的无输入手动恢复。合成 Git 回归先真实复现 `commit` 类型以及缺少恢复步骤的失败，再运行工作流实际恢复命令，核对注释对象、源 HEAD 和远端标签均保持；不降低任何发布者、npm摘要、已有 Release 或附件校验。恢复增量的类型/静态/构建检查、5/5发行回归及YAML解析通过。恢复实现仍须稳定 SHA 独立只读评审及当前头双平台 CI 后合并。最终远端恢复与全部附件回读结果追加 [Issue #75](https://github.com/wang1299/dsh-evolve/issues/75)，不得仅凭工作流完成或 CLI 成功提前宣称发行验收通过。

本任务没有新增模型请求、预算、提炼资格或经验收益实验。脚本模型仅验执行路径；兼容只针对固定DSH，未验证Desktop、全版本或普遍收益。公开registry/Release创建前不称已发布。远端结果未知时先查询状态，不自动重放发布命令。
