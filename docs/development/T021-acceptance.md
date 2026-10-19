# T021 安装包自动学习演练与独立试装

日期：2026-10-19，Issue [#51](https://github.com/wang1299/dsh-evolve/issues/51)，基线bd7d7fa。设计[ADR024](../decisions/024-installed-automatic-learning-rehearsal.md)先于实现，范围[任务](../tasks/T021-installed-learning.md)。最终头检查/独立评审/CI/合并记录以关联PR为准。

## 安装包离线自动链路

新增显式 `npm run install-probe -- <tgz> --learning`，默认安装模式保留。先安装tgz、逐文件比较24个产品编译JS，再由官方Loader加载并核对实际模块apply身份。服务单例来自项目固定官方DSH依赖；AgentLoop为真实发行组件，LLM是进程内固定脚本，未注册真实模型适配器。报告不含完整对话/代码提案/原始响应。

happy实际经过begin→明确纠正→宿主检查合成代码/commit→Agent finish→后台验证/自动候选→owner模拟用户消息提供reviewedCandidateId→Agent显式verify→新会话begin及模型实际收到工具回执→目标提案/commit/finish→另一份外部pytest→安装包面板API追加合成基准反馈。全程没有propose/link来手工补候选。候选revision1、未激活；verify后revision2，来源/引用和代码条件保留。

| 场景 | 实际结果 | 任务/经验/应用/反馈 | 来源测试 | 目标独立测试 |
|---|---|---|---|---|
| happy | passed/completed；实际经验回执及后续模型调用均观察到 | 2/1/1/1 | 原1失败→修复0失败/回归0 | 原1失败→修复0失败/回归0 |
| invalid-extraction | partial/extraction_invalid，未知factId拒绝 | 1/0/0/0 | 保留任务证据，不编造经验验证 | 未执行 |
| sharing-off | partial/sharing_disabled，来源已验证仍不提供经验 | 2/1/0/0 | 原1失败→修复0失败/回归0 | 未执行 |
| failed-target | partial/target_rejected，来源通过不能替代目标验收 | 2/1/1/0 | 原1失败→修复0失败/回归0 | 原1失败→修复仍1失败，不写accepted反馈 |

各场景逻辑提炼占用1；happy/失败目标/关闭共享/坏提炼分别11/11/9/5次脚本Agent调用。模型HTTP均0；没有真实模型质量或因果收益证据。完整本地四场景结果位于ignored `.probe-work/install-probe-7EWS3p`，公开只保留上述合成摘要。

## 保留的失败与修复

初次新演练将Loader解析根误设为host而非profile，插件无法导入，报告停在initialize，未提炼。改用profile解析根并比较实际安装模块身份。随后模块namespace包含Symbol，不能当JSON record校验；改为比较已知模块apply引用。隔离去掉用户home后，原Python缺typing_extensions，后台证据不完整/提炼blocked，未创建候选；新建项目内独立Python3.10虚拟环境并从公开PyPI安装pytest9.1.1及依赖后，四场景通过。原失败日志/报告保留，无付费重试或关键断言放宽。

## Windows完整发行应用试装

在ignored `.probe-work/t021-dsh-ZutFsM`创建新的home、evolve-auto-test profile、合成仓库和独立学习目录；只读复用T006d固定官方host，不改旧profile或凭据。实际CLI 0.2.0-rc.2通过官方plugin命令安装当前tgz，组合为官方base/web-app/dsh-evolve，skippedBundles为空。24个产品JS与当前构建逐字一致。

首次启动、身份保护的停止及重启后，实际Web插件详情均显示 v0.1.0-alpha.0、共1组件/1运行中；匿名根HTTP401，认证启动地址有效。当前loopback测试端口59081，bootstrap令牌只保留本机；新浏览器/服务重启需使用启动器输出的认证地址，不能直接复制裸根地址作为认证入口。跳过API Key设置，没有发送模型消息；执行/共享/后台验证/提炼默认关闭。该完整应用仅验证安装/加载/重启，自动学习结果来自上面的组件演练，两者不合并冒充真实完整模型体验。

本轮试装tgz SHA256为`007f6eb6352a2571dfcc7d5a4b9ca62b2dfff0f4e5b1e9c55e552747dcf6bb84`。其产品JS对应bd7d7fa，本任务只改开发脚本/测试/文档；后续CI打包可能因文档变化得到不同tgz摘要，须仍逐文件检查JS。独立host锁及传递依赖沿用T006d本机固定安装，未承诺跨机器逐字重建。

## 检查与限制

新增3项报告风险检查：不能用落库代替回执/后续调用，不能用来源成功代替目标验收/反馈，不能用手工候选、真实模型/收益声明或额外隐私字段伪造离线通过。实际四场景包演练已通过；最终类型/静态/全量检查、默认包模式、两平台学习包模式与稳定SHA独立只读评审见关联PR。

本次不改产品格式/接口、旧预算/未知占额/资格、原用户数据或日常profile；无包发布、部署或账户权限变化。新环境不含真实Key，真实DeepSeek连通与自动提炼质量须另有新预算和冻结方案；后台候选的主动发现/通知、三组未见收益仍待实现/评价。父#8/#15/#34保持open。
