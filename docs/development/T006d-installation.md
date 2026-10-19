# T006d：完整DSH CLI/Web独立试装

2026-10-19，[Issue #25](https://github.com/wang1299/dsh-evolve/issues/25)，父#8保持open。方案先在`78afcdb522a5c997d6a8b5f2ffb9118fff5fcee8`提交后才安装。插件运行代码与主分支`7e115bd`一致，本任务只补安装方案、实际记录和兼容说明。

## 实际结果

Windows、Node24.19.0，独立host实际安装官方`@deepseek-ai/dsh@0.2.0-rc.2`（538个包，忽略依赖安装脚本）；不全局安装。新的`DSH_HOME`与`evolve-test` profile均在本项目ignored `.probe-work/dsh-preview-UJB4Dv`，没有使用用户已有profile或模型凭据。

通过发行CLI从web模板创建新profile，再用官方`dsh plugin ... add <tgz>`安装本地`dsh-evolve@0.1.0-alpha.0`。组合依次包含官方base、官方web-app、dsh-evolve。六项宿主解析（dsh、Cordis、agent、session、tools、system-prompt）实际路径均在独立host内；DSH服务0.2.0-rc.2、Cordis4.0.5，不从项目源码node_modules借服务。经验库由实际插件创建在隔离learning目录。

真实Web绑定`127.0.0.1:58440`，内置浏览器通过本机启动令牌进入。官方插件管理详情显示版本`v0.1.0-alpha.0`、开关开启、**共1个组件/1运行中**。不是仅凭manifest选择判断已加载。匿名HTTP访问返回401，属于该发行版的访问保护，不能误报为HTTP200或加载失败。

实际执行有进程身份保护的本机停止脚本，确认端口不再监听；再用本机启动脚本重新启动、刷新浏览器，插件仍显示运行中。测试数据保留，当前页面作为体验入口留给用户。本机辅助脚本及原始图像/配置/lock/证据只在ignored目录，不进入发布包或GitHub。

## 复现安装流程

需要Node24.10+、npm、pnpm（本轮11.25.0）和Git。先创建全新测试目录及其中的host、home、artifacts、合成Git工作区、learning、仓库外acceptance；遇到已有目录时换新名字，不覆盖。下面的`<...>`均替换为这些目录的绝对路径；使用未配置模型密钥的隔离子进程环境执行，不复制既有DSH_HOME。除PATH/Windows系统与临时目录等运行必需变量外，本轮没有继承其他环境变量。

1. 在host创建`{"private":true,"type":"module"}` package.json，使用空的独立npm user/global配置及本地cache，然后安装固定官方运行时：

   ```sh
   npm install --prefix <host> --ignore-scripts --no-audit --no-fund --save-exact @deepseek-ai/dsh@0.2.0-rc.2
   ```

2. 在本项目源码目录构建并打包：

   ```sh
   npm pack --pack-destination <artifacts>
   ```

3. 配置`DSH_HOME=<home>`；`DSH_EVOLVE_CONFIG`指向本地JSON，字段参考[兼容性](../compatibility.md)，repoRoot为合成Git工作区、dataDir为独立learning、acceptanceDir在仓库外、executionTrusted/shareWithModel均false。所有CLI命令的cwd均为合成工作区。通过独立host里的实际入口执行：

   ```sh
   node <host>/node_modules/@deepseek-ai/dsh/lib/bin.js --version
   node <host>/node_modules/@deepseek-ai/dsh/lib/bin.js --profile evolve-test --from-default-profile web --dump-config
   node <host>/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile evolve-test add <artifacts>/dsh-evolve-0.1.0-alpha.0.tgz --ignore-scripts
   node <host>/node_modules/@deepseek-ai/dsh/lib/bin.js --profile evolve-test --dump-config
   node <host>/node_modules/@deepseek-ai/dsh/lib/bin.js --profile evolve-test --host 127.0.0.1 --port 0 --no-open
   ```

   `--from-default-profile`仅用于新profile首次创建；重启时省略。端口0会选空闲端口；本机已准备环境使用58440。打开启动器打印的本机地址，不把其中的授权令牌放到公开Issue/日志。预览说明继续，模型密钥选“稍后配置”，到“插件”查看实际运行状态。启动终端按Ctrl+C停止；本机另外提供只针对所记录测试进程的停止脚本。

本轮在profile单独执行`pnpm peers check`会报告缺少五项DSH/Cordis peer并返回非零；这项诊断保留，不宣称通过。profile依赖仅有插件，单例服务由完整发行宿主提供，版本及宿主解析路径已逐项核对，真实Loader/UI已运行。不能通过安装重复宿主服务或增加版本豁免来掩盖加载失败。

安装固定的是运行时版本；本轮完整host lock只保留本机，不能承诺未来重新解析的全部传递依赖逐字相同。另一个平台/版本需重新检查实际启动。

## 本机证据摘要

- 官方host lock SHA256：`05181cd487a3d36a1d9babb2e1ba9e7a40983f4dca3f7f364eb801cfbfd491f5`
- 实际安装tgz SHA256：`6733a6b0d972ffe12af8bcf4c5c9a1afb98624135a00e5f0303e0e10fd133196`
- 首次运行界面图 SHA256：`5ea937d7623a58369bf214774e5bfa7409aba417eb1030d4e398110f44766a75`
- 原始`installation-evidence.json`、host/profile lock、前后配置、运行/重启截图及启动/停止辅助文件均在该ignored测试目录。源码包未发布，测试服务只绑定本机，不是线上部署。

## 验收边界

已验证的是**Windows完整官方CLI/Web安装、加载与重启**；此前Ubuntu/Windows组件探针的结论继续单独保留。未验证Desktop、其他版本/平台完整应用、真实DSH模型自主调用、提取质量或经验收益。本轮未添加模型密钥、发送消息或调用模型；执行信任和经验共享保持关闭，实际对话及正常学习需后续配置与独立验收。当前可以浏览插件状态，不能据此宣称日常自动学习已经稳定可用。

本任务没有产品行为或公开接口变化；本机实际安装/界面/停止重启为主要证据，文档检查、最终头CI及独立只读评审以关联PR为准，不复跑模型实验。父#8/#15继续open。
