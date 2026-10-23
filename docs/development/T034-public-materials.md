# T034：公开仓库材料对照与介绍验收

2026-10-23，Issue [#78](https://github.com/wang1299/dsh-evolve/issues/78)。本仓库比较基线 `f48dfdc4a9960e03cb5a1d62b33302045abd5277`；Run2Skill 只读快照 [`40e7fb7c39d2f69fee9becf694ad8e12290229d3`](https://github.com/qkycir-123/dsh-run2skill/tree/40e7fb7c39d2f69fee9becf694ad8e12290229d3)。核对其完整 Git 文件树、中文/英文 README、About、第三方许可和数据说明；没有复制代码、文案或图片，也没有向该仓库发送内容。

## 逐项对照

“本仓库原状”指上述比较基线中的公开跟踪文件；本机忽略目录里的验收截图不计作已公开材料。这里比较公开呈现和文档组织，不把两个产品的不同功能当作必须补齐的组件。

| 材料 | Run2Skill 快照 | 本仓库原状 | 本轮结果或后续缺口 |
|---|---|---|---|
| 仓库 About | 简介含产品用途；10 个 topics | 简介不含新包名；topics 为空 | 本轮更新中英文简介和 11 个相关标签，并回读 |
| 中文首页 | `README.md`，安装、用法、设置与帮助 | 已有，另含证据和收益边界 | 本轮补明确产品身份、文字流程和导航 |
| 英文首页 | `README.en.md`，与中文首页互链 | 无 | 本轮新增英文首页，保留支持范围与限制 |
| npm / CI / 许可徽章 | 首页已有；另有 DSH 版本徽章 | 无 | 本轮补 npm alpha、main CI、MIT 徽章；DSH 精确版本保留为明确文字 |
| 独立 logo | `assets/run2skill-logo.png`、`.webp` | 无公开品牌资产 | 缺少；后续独立设计，不使用参考资产 |
| 首页主视觉 | `docs/assets/run2skill-hero.png` | 无 | 缺少；后续使用本产品自己的形象和文案 |
| 操作截图 | `01-proposal-inbox.png`、`02-review-details.png`、`03-saved-activity.png` | 无公开截图 | 缺少；可用合成案例展示学习动态、经验来源和应用记录 |
| GIF 演示 | `docs/assets/run2skill-demo.gif`，首页标注为 main 示例草稿 | 无 | 缺少；后续应标注合成案例、版本及模型演示范围 |
| 独立视频 | 文件树无 MP4/WebM/MOV；两份 README 无视频平台或附件视频链接 | 无 | 两者均未发现；不能把 GIF 称为已存在的独立视频，也不推断其他站点没有视频 |
| 安装、更新与卸载 | 首页有操作，另有数据升级说明 | `docs/installation.md` 有安装与旧预览升级；卸载说明较分散 | 安装已具备，后续可集中普通更新/卸载 FAQ |
| 数据存储与升级专页 | `docs/storage-and-upgrades.md` | 信息分布于安装、架构、兼容性与 ADR；无独立用户专页 | 内容已有，但新用户入口可改善；不能借用参考产品的 Storage/清理语义 |
| 兼容性说明 | `docs/compatibility.md`、架构兼容与专项设计 | `docs/compatibility.md`、安装与任务验收 | 已具备；历史阶段较多，后续可增加简明版本表。对方未发布候选不扩展本产品支持范围 |
| 产品需求与架构 | `docs/product/prd.md`、`docs/architecture/baseline.md` | `docs/product.md`、`docs/architecture.md` | 已具备，不是缺少项 |
| 设计与验证材料 | `docs/design/`、`probes/README.md` | `docs/decisions/`、`docs/tasks/`、`docs/development/`，兼容和评价文档 | 已具备；组织不同，不按文件数判断成熟度 |
| 更新记录、贡献、许可 | `CHANGELOG.md`、`CONTRIBUTING.md`、`LICENSE` | 同类三项均已有 | 已具备 |
| 第三方许可清单 | `THIRD_PARTY_NOTICES.md` 明列其客户端内含的 Zod 许可 | 无单独同名文件 | 需按本产品实际发行内容审计依赖许可，不能直接复制其版本/版权清单；本轮不作合规完成结论 |
| 可复用中英文介绍 | 双语首页已能提供项目概述 | 无独立介绍材料 | 本轮新增 `docs/public-introduction.md`，供后续投稿准备 |

参考入口：[中文首页](https://github.com/qkycir-123/dsh-run2skill/blob/40e7fb7c39d2f69fee9becf694ad8e12290229d3/README.md)、[英文首页](https://github.com/qkycir-123/dsh-run2skill/blob/40e7fb7c39d2f69fee9becf694ad8e12290229d3/README.en.md)、[品牌资产](https://github.com/qkycir-123/dsh-run2skill/tree/40e7fb7c39d2f69fee9becf694ad8e12290229d3/assets)、[演示资产](https://github.com/qkycir-123/dsh-run2skill/tree/40e7fb7c39d2f69fee9becf694ad8e12290229d3/docs/assets)、[数据说明](https://github.com/qkycir-123/dsh-run2skill/blob/40e7fb7c39d2f69fee9becf694ad8e12290229d3/docs/storage-and-upgrades.md)、[第三方许可](https://github.com/qkycir-123/dsh-run2skill/blob/40e7fb7c39d2f69fee9becf694ad8e12290229d3/THIRD_PARTY_NOTICES.md)。以上为材料定位，不构成对参考项目功能、安全或收益的验证。

## 本轮范围

只修改公开文档与已授权的仓库 About/topics。产品名、仓库地址、安装版本和 DSH 范围保持准确；不改包或运行代码、默认开关、SQLite、授权或预算，也不重发 npm/Release。中英文均明确社区身份、默认关闭、来源验证不代表收益及执行/共享边界。

本轮没有制作 logo、截图、GIF 或视频，没有把私人验收图片上传，也没有向社区或第三方目录投稿。下一批最直接的公开材料是合成案例截图和短 GIF；第三方许可审计、数据与卸载 FAQ 可另立范围。收录和搜索排名不由这些文档变更保证。

## 验证与远端结果

本地检查：6 份本轮文档可读、代码块闭合，61 个相对文件链接的目标存在且不越出仓库；中英文首页和介绍的准确安装命令、DSH 范围与默认状态检查通过，Git 差异空白检查通过。变更仅限这 6 份公开文档，没有运行代码或包元数据变更。

远端 About 中英文简介和 11 个 topics 已用所有者现有 Git 登录更新，并通过独立 GitHub 连接器再次回读一致；保留原仓库地址和 homepage，没有修改账户、安全或权限设置。中英文准确文案见[介绍材料](../public-introduction.md)。

独立稳定 SHA 评审、当前头双平台 CI 与合并结果记录在 [Issue #78](https://github.com/wang1299/dsh-evolve/issues/78) 和关联 PR。没有执行就不计通过；独立 AI 评审不构成 GitHub 正式批准。纯文档不新增镜像测试或重跑模型、私人学习环境；仓库规定的完整 CI 仍须满足。
