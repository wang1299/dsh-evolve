# T029 自动学习验收

Issue [#67](https://github.com/wang1299/dsh-evolve/issues/67)，Draft [PR #68](https://github.com/wang1299/dsh-evolve/pull/68)；基线c0da5fa。设计ADR031先提交09aa481，两个新增核心用例文件先记录缺失接口失败43b261b/2e37d0a，再实施。当前未发布，真实配置/体验库/预算/Key未改，零真实模型HTTP。

## 已执行的证据

- 受限私有快照的真实pytest重放：原始失败1、未提交修复通过、回归通过；用户HEAD/index及原始修复文件不被学习修改。漂移/未跟踪Python/未覆盖变更/忽略私有文件有拒绝检查。Windows符号链接创建因权限不足跳过1项，该项不能宣称本机通过。
- 自动核心3项初轮通过：候选先candidate、独立再验后source_verified、下一请求提供且无变化跳过；重复/并发/手动任务；明确纠正去敏及额外输入阻断。补充反序显式任务、默认关闭、失败证明不消耗提炼、死进程恢复unknown不重放、冻结元数据篡改，连同快照最终针对共10通过1跳过。
- 官方0.2.0-rc.2真实AgentLoop＋固定脚本模型，源修复/自动验证/原生单次提炼/候选独立再验/目标首次输入实际收到经验/目标外置pytest通过；全部普通工具仅fixture_fix，evolve工具调用0，用户Git不变，无合成用户反馈。不是实际模型质量或收益评价。
- 首次原生案例失败：固定DSH先assemble/render动态context再pre-step，目标首请求没有收到经验。改为官方MessageSourceMap扩展的已接纳消息，来源标记为dsh-evolve-experience，不冒充用户、不唤醒新回合。真实案例随后通过，后续追加plugin/subagent负路径随最终检查核对。
- 面板客户端新增普通语言自动进度和unknown不冒充已学习；连同原客户端与真实v8→v9保留旧记录/unknown/已用grant检查7项通过。旧迁移测试只更新最新schema版本断言，原数据保留/拒绝条件不放宽。

## 独立评审与修复

独立只读Agent初审6399ad5b3fe62590a86a70866a75e9bd9ca269ef vs c0da5fa758527cc9ec409f3a211c756a73447597，发现1项P2：自动片段已open后另一会话显式begin仍可成功，自动片段继续open。评审通过纯内存执行真实begin方法复现；主代理以ebf207f新增用例得到open != blocked，再在2cf7fc7让两个入口共用持久repo锁/锁内重查，阻断旧自动捕获。针对用例通过，最终稳定增量复审另记。非阻塞容量建议已在设计/README明确为128MiB写前水位，单次最多8MiB加Git元数据，不承诺写后硬限。

完整check/compat、最终安装包和当前头CI、最终独立复审及合并结果见PR开发记录；未满足不得合并。后续实际安装仅在满足门槛后进行。真实自动模式默认关闭，没有自动迁移旧任务或重开旧提炼授权。
