# DSH 兼容性

目标：`@deepseek-ai/dsh@0.2.0-rc.2`。本机实际安装 Cordis4.0.5、dsh-agent/session/tools/system-prompt0.2.0-rc.2，lockfile固定依赖和完整性摘要。

## 已验证

`npm run compat` 使用发行包真实Context、SessionStore、ToolRuntime、SystemPrompt，注册五个工具和提示区，执行开始／完成任务、拒绝跨session操作、采集最小工具结果元数据，并验证卸载移除工具和提示区。

Agent仅传入身份fixture，没有运行LLM主循环；不可将此探针描述为真实模型端到端成功。

`npm run install-probe -- <local.tgz>`：实际调用官方plugin-manager共享安装操作，装到新的隔离profile，用app-boot读取/组合bundle并经真实Loader加载安装包，检查五个工具和提示区，执行合成开始任务。peer服务由源码工作区提供，不等于完整DSH发行应用的安装；无模型调用。它已发现并修复原manifest没有insert导致组合为空的问题。

2026-10-19另行完成Windows完整官方DSH CLI/Web试装：独立host安装0.2.0-rc.2、官方CLI创建web模板profile并安装当前tgz；服务解析均来自完整host，实际Web插件详情显示一个组件运行中，停止/重启后仍加载。执行信任/模型共享关闭，没有模型调用。匿名HTTP401是访问保护，浏览器已通过本机令牌进入。见[实际步骤、peer诊断及限制](development/T006d-installation.md)。

## 未验证

- 真实DSH模型会话中的自主调用、候选提取质量和经验收益。
- Desktop发行应用安装器、其他平台完整CLI/Web安装及跨版本兼容；Windows固定CLI/Web的已验证范围如上。
- T005及安装PR #16的15项、Codex PR #17的24项均已通过Ubuntu/Windows CI及对应实际包安装组件／Loader探针；当前三组v2的32项远端结果需单独核对当前头。安装组件通过不等于DSH真实模型回合。

## 本地接入（开发预览）

构建安装包后，通过固定DSH版本将本地tgz装到独立测试profile；本机Windows完整CLI/Web试装已通过，日常模型学习仍待验收。当前包未发布到npm。

源码工作区的可复现安装组件探针（另需pnpm）：

```sh
npm run build
# 先创建本地 .probe-work 目录，然后打包
npm pack --pack-destination .probe-work
npm run install-probe -- .probe-work/dsh-evolve-0.1.0-alpha.0.tgz
```

报告和测试profile保存在`.probe-work/install-probe-*`，不会修改已有用户profile。只读验收运行器与真实Agent实验仍另行实现。

插件读取可选环境变量 `DSH_EVOLVE_CONFIG` 指向本地JSON配置，或由Cordis传入Config。未配置时以进程cwd为单仓库，关闭执行信任和模型共享。

```json
{
  "repoRoot": "/absolute/path/to/target-repository",
  "dataDir": "/private/local/path/evolve-data",
  "executionTrusted": false,
  "shareWithModel": false,
  "acceptanceDir": "/independent/path/acceptance",
  "python": "python",
  "regressionPath": "tests",
  "timeoutMs": 15000
}
```

用户明确接受执行目标仓库代码后，才将executionTrusted设为true。用户明确接受把经验传给当前DSH模型后，才启用shareWithModel。验收目录必须在目标仓库之外。默认数据在用户目录`.dsh/evolve/<repository-hash>/evolve.sqlite`，不写目标仓库。
