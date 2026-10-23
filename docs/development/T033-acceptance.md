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

完整本地检查和安装包四场景/正常对话演练仍执行中。独立评审、当前头双平台 CI、规则核对、PR合并、用户原试装的保全升级及冻结制品后 npm/Release 实际远端验证仍待完成。最终结果追加本文件、PR及Issue；不提前关闭发行Issue。

本任务没有新增模型请求、预算、提炼资格或经验收益实验。脚本模型仅验执行路径；兼容只针对固定DSH，未验证Desktop、全版本或普遍收益。公开registry/Release创建前不称已发布。远端结果未知时先查询状态，不自动重放发布命令。
