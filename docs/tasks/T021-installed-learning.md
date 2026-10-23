# T021：安装包自动学习演练与独立试装

Issue [#51](https://github.com/wang1299/dsh-reforge/issues/51)，基线bd7d7fa；设计[ADR024](../decisions/024-installed-automatic-learning-rehearsal.md)。依赖T020；本次零真实模型调用。

## 范围与验收

- 安装当前tgz、逐文件核对编译JS，经官方Loader/AgentLoop驱动source finish→自动candidate→显式verify→新会话实际交付→目标独立pytest→宿主合成反馈；不调用propose/link来替代自动链路。
- 精确核对候选非激活、来源/引用/版本、一次提炼资格及实际回执/后续模型调用；不能从DB记录推断交付。报告有界/明确scripted，无对话正文/凭据/原始响应。
- 坏提炼、关闭共享和无效目标修复保留失败、不生成虚假反馈；默认安装探针不变，CI显式执行学习模式，必要类型/静态/单元/包验收通过。
- Windows全新独立DSH profile安装最新版，核对官方固定host、组件加载及重启，不改原profile/旧数据。全发行加载与组件离线学习分开记录。
- 稳定SHA独立只读评审、当前两平台CI和仓库规则满足后合并；真实付费验证须后续新预算。

## 基线复现缺口

旧npm run install-probe报告仅有安装/工具注册，缺少自动candidate、应用回执、独立目标验收和反馈。旧dsh-rehearsal工具序列含propose/link，因此不能满足上述自动链路验收。T021不能仅复跑旧命令后声称通过。

## 非目标

真实模型质量/正常完整学习、经验收益、发布部署、改Key/账户/旧预算均不包含。实际结果见[验收记录](../development/T021-acceptance.md)与关联PR。
