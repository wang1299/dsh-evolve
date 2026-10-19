# T023：新版完整DSH独立试装与候选发现

日期2026-10-20（Asia/Shanghai），Issue [#55](https://github.com/wang1299/dsh-evolve/issues/55)。实施范围先由28ebecb形成，产品基线6742214（T022 / PR #54已合并，#53关闭）。本任务不改产品代码、公开接口或SQLite v5。

## 安装与宿主

复用只读完整官方Windows `@deepseek-ai/dsh@0.2.0-rc.2` host，Node24.19.0；新的home/profile `evolve-discovery-test`、合成Git、仓库外pytest、学习库及空npm配置。没有复制旧DSH_HOME、Key、预算或私人会话。旧T021测试服务/数据和T022种子UI演练保留，不用它们作为本次原生自动学习证据。

实际安装T022最终tgz，SHA256 `a09f476b1ae2e8f0177db5f6731208d123f1828f41e8a7920c268a4142e7c179`。24个安装产品JS与6742214构建逐字节相同；官方profile组合base/web-app/dsh-evolve、无skipped bundle。Cordis、agent、llm、session、tools、system-prompt六项解析均来自完整host，没有从源码node_modules借宿主服务。完整运行时实际注册七个evolve工具；真实Web插件详情显示一个组件运行中。

## 完整宿主内实际离线链路

通过官方CLI的临时`--patch`加载本机测试驱动器。驱动器从完整host导入官方LlmAdapter/Agent API，注册固定`native-offline/scripted`路由、retry0，明确选择该路由；不使用HTTP provider、真实密钥或mock产品service。只有新合成仓库配置执行/后台验证/共享及一次提炼资格。驱动器不写学习DB，用只读SQLite观察结果。

1. 真正AgentLoop调用begin、从实际合成user输入取得明确纠正，再调用correction。固定文本响应只表示驱动器可准备限定修复，不作为成功证明。
2. 宿主修改fixture的ledger.py中唯一失败分支、Git提交。下一轮Agent显式finish，不调用propose/link补候选。
3. 实际安装插件后台运行外部pytest：原始验收1测试/1失败/exit1；修复验收1/0/exit0；回归1/0/exit0。ready包关联本次报告，执行环境/最小来源在同库保留。
4. 官方LLM端口只经固定Adapter输出候选策略和现有fact IDs；宿主构造原样事实/引用。仅1次逻辑提炼，产生唯一revision1、status=candidate、verificationId=null；修复报告通过不自动激活候选。
5. 再发普通“查看候选”user请求。**实际交给Adapter的provider消息**包含本session的数量提醒；随后Agent调用list，从真实工具回执取得同一候选ID/revision/来源task。不是只调用assemble或让驱动器私下传入ID。
6. 7次脚本Agent调用、1次提炼，模型HTTP0；任务1/经验1/应用0/反馈0。没有验证经验、复用目标、owner接受或效果评价。

使用的合成任务来自已有[test/fixture.ts](../../test/fixture.ts)；没有手写候选DB、伪造应用或accepted反馈。本轮证明完整固定宿主内的机械流程，不能替代真实模型理解/提炼质量。

## 保留失败与修正

- 首次临时插件导入失败：测试脚本把相对host路径按合成仓库cwd解析。改为按脚本自身import.meta.url定位；没有放宽宿主版本/兼容策略。
- 随后的试装出现Agent错误、source未正常finish，没有候选。临时Adapter错误地把最后一条user-role消息当成用户纠正；完整宿主还有`Current runtime context`快照，所以JSON解析失败。另一个诊断尝试记录到相同错误，并在终态形成前主动停止，不能记为完整失败或成功。
- 驱动器改为从真实user-role消息中严格匹配唯一的固定合成输入；每轮同时检查模型确实前进且无agent/error，不能以whenIdle返回自证执行成功。最终新profile完整通过。失败的profile、报告或中断日志原样保留；它们不重试真实模型，也未消费任何旧预算。

以上修改仅发生在本机临时驱动器，产品代码没有变化。

## 重启与同库面板

确认本轮PID、命令行及测试路径后停止进程，旧端口不再监听。保留新库，撤掉临时提炼授权、关闭executionTrusted/backgroundVerification，移除临时overlay，以正常官方CLI重新启动；共享保留开启，仅涉及这份合成数据。没有把提炼grant重新置零，没有第二次提炼。

重启后匿名Web请求401，已认证的Web插件详情仍显示dsh-evolve一个组件运行中；24个JS仍匹配。使用**实际安装包CLI**和同一个config/dataDir启动独立loopback面板，没有复制或seed学习库。面板显示1条自动候选，点击显示revision1、完整策略/三个测试事实来源/限定ledger.py；重启后仍candidate且没有应用/反馈。DSH Web与经验面板是两个页面，不声称已嵌入DSH原生面板。两者仅本机运行，完整鉴权URL不写入公开文档。

最终证据保留在本机ignored测试目录：native-probe-evidence.json、installation-evidence.json、最小学习库、前后配置、实际包/host锁、初次与重启截图。页面作为本机体验入口保留；新配置没有模型Key，不能直接进行真实模型对话。

## 复现边界与交付门槛

完整host安装、全新profile、官方plugin add、最小环境、Web启动及鉴权步骤沿用[T006d安装流程](T006d-installation.md)，将profile名和当前tgz替换为本轮值。脚本模型链路按上述六步、固定公共fixture与官方API执行；完整原生驱动器目前仍是本机临时文件，**尚无公开的一键重建入口**。固定运行时不保证将来重新解析所有传递依赖逐字相同。公开重建资产及未见任务收益仍属G06，不能用本机安装日志替代。

本轮仅文档/实际安装验证，产品文件与6742214相同；无需重跑付费实验。必要文档检查、稳定SHA独立只读评审、当前头两平台CI及合并状态见关联PR。AI只读评审不是GitHub正式批准。未发布npm/Release或部署，真实模型学习/收益、Desktop及其他完整应用平台仍未验证。
