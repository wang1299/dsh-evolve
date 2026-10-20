# T029 自动学习验收

Issue [#67](https://github.com/wang1299/dsh-evolve/issues/67)，Draft [PR #68](https://github.com/wang1299/dsh-evolve/pull/68)；基线c0da5fa。设计ADR031先提交09aa481，两个新增核心用例文件先记录缺失接口失败43b261b/2e37d0a，再实施。当前未发布，真实配置/体验库/预算/Key未改，零真实模型HTTP。

## 已执行的证据

- 受限私有快照的真实pytest重放：原始失败1、未提交修复通过、回归通过；用户HEAD/index及原始修复文件不被学习修改。漂移/未跟踪Python/未覆盖变更/忽略私有文件有拒绝检查。Windows符号链接创建因权限不足跳过1项，该项不能宣称本机通过。
- 自动核心3项初轮通过：候选先candidate、独立再验后source_verified、下一请求提供且无变化跳过；重复/并发/手动任务；明确纠正去敏及额外输入阻断。补充反序显式任务、默认关闭、失败证明不消耗提炼、死进程恢复unknown不重放、冻结元数据篡改，连同快照最终针对共10通过1跳过。
- 官方0.2.0-rc.2真实AgentLoop＋固定脚本模型，源修复/自动验证/原生单次提炼/候选独立再验/目标首次输入实际收到经验/目标外置pytest通过；全部普通工具仅fixture_fix，evolve工具调用0，用户Git不变，无合成用户反馈。不是实际模型质量或收益评价。
- 首次原生案例失败：固定DSH先assemble/render动态context再pre-step，目标首请求没有收到经验。改为官方MessageSourceMap扩展的已接纳消息，来源标记为dsh-evolve-experience，不冒充用户、不唤醒新回合。真实案例随后通过；最终完整检查包括plugin来源及subagent输入均不创建任务的负路径。
- 面板客户端新增普通语言自动进度和unknown不冒充已学习；连同原客户端与真实v8→v9保留旧记录/unknown/已用grant检查7项通过。旧迁移测试只更新最新schema版本断言，原数据保留/拒绝条件不放宽。

## 独立评审与修复

独立只读Agent初审6399ad5b3fe62590a86a70866a75e9bd9ca269ef vs c0da5fa758527cc9ec409f3a211c756a73447597，发现1项P2：自动片段已open后另一会话显式begin仍可成功，自动片段继续open。评审通过纯内存执行真实begin方法复现；主代理以ebf207f新增用例得到open != blocked，再在2cf7fc7让两个入口共用持久repo锁/锁内重查，阻断旧自动捕获。针对用例通过，最终稳定增量复审另记。非阻塞容量建议已在设计/README明确为128MiB写前水位，单次最多8MiB加Git元数据，不承诺写后硬限。

最终独立只读增量复审d0688853ac9cb4b67df9473b3f5fb39880f21058（总基线c0da5fa，增量6399ad5）确认两个入口的持久锁及锁内重查修复了归属问题；评审者执行真实begin复现和6项面板客户端检查，无剩余P0/P1或阻塞P2。迁移、UI和文档增量也已检查。该评审为AI来源，不是GitHub正式批准。

## 完整检查

- d068885本地typecheck、lint、build和完整check通过：173项，172通过、1项Windows符号链接权限跳过、0失败；官方兼容8/8，真实Git/pytest demo通过。
- d068885的GitHub Actions run 39455732520在Ubuntu与Windows全部通过，包括check、compat、demo、打包、实际包安装和学习演练。最终交付头仍需相同门槛，见PR开发记录。
- 本机实际tgz由官方plugin-manager安装，profile composition/Loader/七工具通过；28个产品JS逐一与构建产物相同。四个原场景保留happy完成、坏提炼/关闭共享/无效目标partial结果；新增普通对话案例绑定安装模块、真实AgentLoop与脚本模型，7次脚本响应、1次提炼、0个evolve工具、0真实模型HTTP，目标首次输入实际收到经验、独立目标pytest通过，用户HEAD/index不变，无伪造用户反馈。合成证据目录仅本机ignored保留。
- 本机浏览器验证实际普通对话案例的学习主页与按需展开进展：1条来源已验证、1次后续提供；停止宿主后的目标片段仍显示处理中/材料不足，不宣称目标被学习或用户验收。界面截图只本机ignored保存，不上传用户数据。该检查不运行worker或模型，不等价于完整应用真实模型验证。

最终文档头CI与合并结果见[PR #68](https://github.com/wang1299/dsh-evolve/pull/68)；未满足不得合并。真实自动模式默认关闭，没有自动迁移旧任务或重开旧提炼授权。本机既有体验安装若升级，另保存停机备份、v8→v9旧行逐项比较和原预算/配置哈希，不能以合成用例代替。
