# DSH-Reforge 中英文介绍

适用版本：`dsh-reforge@0.1.0-alpha.1`，2026-10-23。以下文案可用于仓库介绍和后续社区投稿；本文件的建立不代表已经向社区或目录投稿。详细行为以[安装指南](installation.md)、[产品需求](product.md)和实际验收为准。

## GitHub About

简介（中英文共用）：

> DSH-Reforge (dsh-reforge) — DeepSeek Harness plugin for traceable experience from test-verified Python bug fixes. 从有测试依据的 Python 修复中积累可追溯经验。Experimental alpha · DSH 0.2.0-rc.2.

主题标签：`dsh-reforge`、`deepseek`、`deepseek-harness`、`dsh-plugin`、`experience-learning`、`agent-memory`、`bug-fix`、`python`、`pytest`、`verification`、`typescript`。

## 中文短介绍

DSH-Reforge（npm：`dsh-reforge`）是 DeepSeek Harness 的社区插件，从有测试依据的 Python Bug 修复中积累可追溯经验，记录适用条件、来源和使用历史，并在后续相似任务中选择适用经验作为参考。当前为实验性 alpha，仅支持 DSH 0.2.0-rc.2；学习默认关闭。

## 中文完整介绍

DSH-Reforge 面向使用 DeepSeek Harness 修复 Python 仓库的开发者。用户上次的纠正可能只留在旧会话里；插件将有限的请求摘要、明确纠正和受限代码快照与修复测试关联，形成可以查看来源、限制适用范围并停用的经验。

仓库所有者显式配置执行信任、模型共享、独立验收和提炼次数后，正常直接请求会形成执行片段。插件在临时工作区重放原始失败、修复验收及回归测试；材料与授权齐备后，使用 DSH 已注册的指定模型提炼候选，再独立复核来源。后续请求按仓库、代码、依赖条件与相关度选择少量经验。使用者可在 DSH 插件页查看学习进度、来源和应用记录，提供反馈、修订或停用经验。

首个公开版本是 `dsh-reforge@0.1.0-alpha.1`，固定 DSH 0.2.0-rc.2，主要聚焦单仓库 Python + pytest 修复。学习默认关闭；开启后会执行受信任仓库代码，并向选定模型发送有限修复材料。本地工作区隔离不是强安全沙箱，提炼次数也不是整个 DSH 会话的金额上限。来源检查通过不代表未来任务收益，已有小规模对照未观察到验收成功率改善。本项目由社区独立开发，不代表 DeepSeek 官方审核、推荐或安全认证。

## English short introduction

DSH-Reforge (`dsh-reforge` on npm) is a community plugin for DeepSeek Harness. It builds traceable experience from test-verified Python bug fixes, records applicability conditions, sources, and usage history, and selects relevant experience as context for later tasks. This experimental alpha supports DSH 0.2.0-rc.2 only. Learning is off by default.

## English full introduction

DSH-Reforge is for developers using DeepSeek Harness to repair Python repositories. Corrections from an earlier task may remain buried in an old conversation. The plugin links bounded request summaries, explicit corrections, and limited code snapshots to repair tests, producing experience whose source and applicability can be inspected and whose use can be disabled.

After the repository owner explicitly configures execution trust, model sharing, independent acceptance tests, and an extraction allowance, normal direct requests create execution segments. The plugin replays the original failure, acceptance tests for the fix, and regression tests in temporary workspaces. With the required evidence and authorization, it uses a specified model registered with DSH to extract a candidate, then independently checks its source evidence. Later requests receive a small amount of applicable experience based on repository, code, dependencies, and relevance. The DSH plugin page supports progress and source inspection, usage records, feedback, revisions, and deactivation.

The first public release is `dsh-reforge@0.1.0-alpha.1`, pinned to DSH 0.2.0-rc.2 and focused on Python + pytest repairs within one repository. Learning is off by default. Enabling it allows trusted repository code to execute and bounded repair material to be sent to the selected model. Workspace isolation is not a strong security sandbox, and the extraction allowance is not a monetary cap for the full DSH session. Source verification does not establish future task improvement; earlier small controlled comparisons did not show an increase in acceptance success rates. This independent community project is not officially reviewed, endorsed, or security certified by DeepSeek.

## 安装 / Install

需要 / Requires: Node.js ≥24.10、DSH 0.2.0-rc.2。来源修复验证另需 / Repair verification additionally requires: Git、Python ≥3.10、pytest（CI: 9.1.1）。

```sh
dsh plugin --profile web add dsh-reforge@0.1.0-alpha.1
```

使用同一 profile 重启 Web，从「插件 → dsh-reforge」打开；首次配置见[安装指南](installation.md)。Restart Web with the same profile, then open Plugins → dsh-reforge. See the [English README](../README.en.md) for initial setup.

## 公开链接 / Public links

- [GitHub](https://github.com/wang1299/dsh-evolve)
- [npm 0.1.0-alpha.1](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.1)
- [GitHub Release](https://github.com/wang1299/dsh-evolve/releases/tag/v0.1.0-alpha.1)
- [Issues](https://github.com/wang1299/dsh-evolve/issues)

## 文案维护边界

不要写成“DeepSeek 官方插件”“自动提升正确率”“无限学习”“零模型费用”“适用所有语言/DSH 版本”或“自动生成原生 Skill”。当前产品积累结构化修复经验，不是 Run2Skill 的 Skill 发布流程。后续截图、动图或视频只使用重新生成的合成案例，并标注版本和演示范围；不得公开真实会话、凭据、认证地址、私人路径或经验库。
