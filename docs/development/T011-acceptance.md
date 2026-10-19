# T011：真实DSH首次闭环验证（partial）

2026-10-19，Issue [#31](https://github.com/wang1299/dsh-evolve/issues/31)，[PR #32](https://github.com/wang1299/dsh-evolve/pull/32)，基线52ed030。设计[ADR014](../decisions/014-dsh-live-budget.md)／[任务](../tasks/T011-dsh-live.md)先于实现提交c78290b。用户指定DeepSeek官方及本轮累计5元，Key由用户在本机DSH设置页配置。

## 实际结果

完整独立发行宿主DSH 0.2.0-rc.2、Windows/Node24.19.0，官方sdk-minimal新profile＋实际tgz，宿主服务未借源码workspace。真正官方Agent loop调用deepseek-official / deepseek-flash、off、每请求输出4096；wire握手身份deepseek-harness-sdk-runtime及协议版本0.0.1，与宿主包版本分别记录。不是组件fixture或直接调用裸LLM冒充Agent。

| 环节 | 观察结果 |
|---|---|
| API与真实Agent | 一次live，共4次实际HTTP，4条提交的助手消息含用量与正常finish |
| 开始与纠正 | Agent实际调用begin、record_correction，得到同任务纠正凭据 |
| 代码修复提案 | Agent返回JSON，AST校验后宿主只写ledger.py并commit |
| 候选经验 | propose传citations时缺factIndex/factDigest且多kind，被严格模式拒绝；经验0条 |
| 验证/关联/关闭 | Agent未执行verify/link/finish；来源任务仍open，不补造完成 |
| 新任务复用/反馈 | 没有启动；应用0条、反馈未创建，不能宣称已跑通闭环 |
| 事后独立pytest | 0模型调用，原始1失败、修复0失败、回归0失败，证明本次模型源码修复有效；不把事后证明伪装成Agent已完成的经验验证 |

结论为**有人工提示及宿主协助的真实DSH部分集成**。Key与模型连接成功，begin/correction及修复提案有效，但候选提炼/引用/复用未完成。不是自动经验提炼、普通Web全工具自主开发、强隔离或三组收益实验，没有新的经验收益结论。

## 成本与停止

官方当日Flash高峰价输入2元/百万、输出8元/百万。代理每次实际HTTP前持久预留2,232,768微元，唯一账本固定项目根；前两次按原策略结算，后两次不能确认完整SSE用量而保持unknown全额预留。下一请求在网络前预算拒绝，运行停止于source_learning，未补跑或另建资格。

| 请求 | SDK输入（含缓存） | 输出 | 代理账本微元 |
|---|---:|---:|---:|
| begin | 1133 | 44 | 2618 |
| correction | 1236 | 90 | 3192 |
| 源码提案 | 1413 | 71 | 2232768（unknown预留） |
| 候选提案 | 1657 | 356 | 2232768（unknown预留） |

累计SDK输入5439、输出561。把缓存也全部按未命中高峰价计算，SDK用量的保守估算为**0.015366元**；这不是服务商账单，也不是原代理策略已完成的结算。原账本保守占额为**4.471346元**，剩余0.528654元不足下一次最坏预留，始终未超过5元。

两次unknown的原始HTTP SSE未保留，无法从现有最终聚合记录断言具体根因；不能把缓存重分配等推测写成事实。历史账本不释放或重算。数值回执/协议兼容跟进[#34](https://github.com/wang1299/dsh-evolve/issues/34)，模型可见的引用契约跟进[#33](https://github.com/wang1299/dsh-evolve/issues/33)。两个任务均未实现，新的付费复测需另定方案与预算，不改写本次失败。

## 检查、评审及安装

- 初始58项本地check通过，修复后6项针对/类型/静态通过。代码头839c163的Windows/Ubuntu CI39212800322全部通过59项、compat/demo/pack/实际tgz组件安装；最终文档头CI与合并状态以PR记录为准。
- 付费前独立只读AI首审a71c2f4对52ed030发现3项P2：cwd重置账本、Application误作交付、起始输出用量不校验。先补负路径后修复；dd29491对a71c2f4增量复审通过，6项离线/4个编译文件一致，确认0请求后才live。实际交付判定须同session成功工具结果＋精确版本＋后续助手继续；来源也核对精确纠正、关闭及证明commit。AI不是GitHub正式Review。
- 保留首轮CI39212374162失败：跨cwd用例依赖本机已有ignored目录，clean checkout不存在；改为自行创建临时cwd，原断言保留。未修改预算或付费代码，后续两平台通过。
- 实际SDK prepare/probe握手均0请求，跨cwd探针也0请求。状态检查仅describe configured=true/source=file；代理只在本机内存中处理转发所需认证头，不输出或落盘Key。模型无shell/文件工具；AST受限提案/宿主写入/外置pytest与人工引导均明示。
- Web预览另行更新当前插件并重启，原Key/数据/执行信任与共享设置保留；安装初次因pnpm store不一致失败，显式沿用既有本地store后成功，未改全局配置。16个安装后的src编译文件与当前源码构建相同，本机loopback服务已恢复。此前peer缺失诊断仍保留，不宣称新完整Web模型闭环。

## 本机证据与复现

原始计划、事件、报告、账本、配置与凭据均仅本机ignored目录；没有上传私人会话、Key或原始模型报告。提交的脚本固定生成合成代码和外部测试，SHA只用于核对本次记录，不保证服务端模型revision或未来采样逐字一致。

| 本机文件 | SHA256 |
|---|---|
| SDK实装tgz（准备时） | 6be921c139b089651da454994eddcb3514aa572d441e83abb5a905215fa77448 |
| t011-live/plan.json | 7650cad2deb88d768a2562945a25762926f162892ccb8e8c236e2f4127b14d26 |
| t011-live/live-once.json | 9bb11f64fd1c8d6102300a6b4b62d6f4f2fbf0bfa7bfc221f0170569581ccec8 |
| t011-live/events.json | ca4f741c64dfd48c6e27e910abf15165c43452a6887f3bdf95fdc5c8b0e0f606 |
| t011-live/live-report.json | f419917d3d1a3c5c6f891b659ace90d580be7e7a2dab758774611e37d7061f01 |
| t011-live/postmortem.json | 8b8b4ca5ca753ce46773d6ad036f4ac2f52e4e86f0b87794a6a8a048c5ea8813 |
| t011-budget.json | d72138c863196251ea5dcaff42bbc7164002227520cb4de55a836e354969fe75 |
| t011-preview-update/dsh-evolve-0.1.0-alpha.0.tgz | 26eee009e8990f7f4ba128b1210e006548d63249c05d681646ad467fd5bdced3 |

以上路径均相对.probe-work。计划紧凑JSON另有协议摘要1bfd91f03d20eb49f331b11d3c3152c0f4f78b01c84cc8134b4aeecd95feebb3，区别于文件字节SHA。

新操作者在自己的全新项目工作区/独立DSH_HOME配置Key后，可构建打包并运行`node dist/scripts/dsh-live.js --prepare <固定DSH宿主根> <独立DSH_HOME> <tgz>`，随后`--probe`只握手，`--live`会消费唯一资格并产生付费。既有本次计划/账本/资格不能删除、覆盖或换输出目录重开；不是允许重跑本次已见案例的指令。prepare的插件安装沿用其profile实际pnpm store，需保证包管理器可用。本机本次结果固定partial。

G05正常DSH完整闭环、G02自动提炼、G03恢复和更广收益均未完成，父#8/#15保持open；无发布、部署、权限或账单变更。
