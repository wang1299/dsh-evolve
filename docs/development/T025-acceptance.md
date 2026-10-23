# T025：诊断摘要与显式恢复验收

Issue [#59](https://github.com/wang1299/dsh-reforge/issues/59)，基线 e1827bb，设计ADR027先于实现提交7abb80c。

## 复现与实现

20b2702保留失败用例：170条合成工具元数据固定保留128条/遗漏42条，旧程序生成incomplete而非ready。测试先纠正了把一条correction元数据漏算的fixture问题，再确认真正失败点为bundle.status。

诊断摘要截断现在保留计数并与必需来源区分，仍需独立原始失败、修复和回归证明。历史恢复通过owner CLI显式追加一个同任务Job及关联提炼Job，保留原始incomplete/blocked和原grant。CLI不运行worker/pytest/模型，不给模型或HTTP恢复权限，不重放unknown或已开始执行。

SQLite v6移除两张Job表的task唯一约束，普通入队在写锁内保持幂等；恢复关系和evidence_job_id维持唯一。按官方流程事务重建，保留旧JSON/字段/ID，外键检查后提交并启用外键；失败回滚。实例返回前不暴露禁用外键的连接。

## 本地验证记录

- 初始实现完整check：147/147通过，包含类型/静态/构建。随后补了恢复事务第一步写锁及CLI双进程检查；最终增量检查和CI另记，不用这轮结果冒充后续提交验证。
- 原始溢出用例修复后真实Git/pytest通过；自动提炼使用离线端口，候选保持candidate。
- 恢复历史、幂等、未使用grant、禁止恢复链、已开始/unknown/额度使用/来源变化/授权撤销/版本变化拒绝、迁移原JSON保留/回滚与owner CLI零执行均有针对用例。
- 无真实模型、Key或真实学习库参与代码验收。原体验仍保持旧版阻塞状态，不能宣称候选生成或完整学习成功。

最终增量：类型检查、静态检查、构建与5项针对检查通过，包含两个实际Node CLI进程并发恢复同一任务、只追加一次且不执行验证/模型。固定官方DSH兼容6/6通过。实际tgz/Loader/AgentLoop离线自动学习happy通过，invalid-extraction、sharing-off及failed-target保留预期partial负结果，model HTTP=0。

另用实际安装包CLI在本机旧合成库的SQLite一致副本执行恢复：v5→v6、只追加排队、不启动worker，原incomplete/blocked与原grant使用量0保留；原体验库仍v5、单一原始Job未变，model HTTP=0。该副本不是原任务已恢复，也不是付费提炼成功。

## 独立只读评审与交付

源码目标a2cedffe07a5eda90f295010828a22390e2518a0，远端稳定映射b97734da3df94836aa7f05fc0782d61365c8c68a；同树62c42ef17f28d9e77111a9cf152a79def3beef92，基线e1827bbd1cdf10f102d81f544742328fcf049bdb。独立Agent核对迁移、写锁、幂等/历史、grant/unknown、验证门槛与测试，无成立的P0/P1/P2阻塞。未重复全量测试、访问网络、模型或真实预算/凭据/学习库。后续仅验收文档变化需必要增量复审；最终CI/正式Review/保护/合并见[PR #60](https://github.com/wang1299/dsh-reforge/pull/60)的实际记录。AI评审不等于GitHub批准；门槛完成前不得合并或升级原体验库。源码包仍未发布。
