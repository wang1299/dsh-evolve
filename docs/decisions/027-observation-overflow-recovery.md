# ADR-027：诊断事件截断与显式证据恢复

状态：接受；T025 / Issue #59。实现前设计，基线 e1827bb。

## 问题与决定

真实合成体验积累170条工具元数据，固定输入保留128条、计数遗漏42条。现行规则把诊断轨迹的截断视为来源不完整，既不运行独立pytest，也阻塞提炼。诊断元数据不是用户纠正、修复版本或测试证明；增加上限不能解决长任务问题。

保留128条及遗漏计数、128KiB输入界限，不把 omittedObservations 单独列为阻塞原因。原始失败、修复与回归仍必须通过独立可执行验证；来源遗漏、截断diff、脏仓库、策略/版本变化及不完整证明继续阻塞。截断诊断信息不能用于补造未观察事实。

## 一次显式恢复

仅owner CLI `recover-evidence --config <file> --task-id <id> --expected-job <id>`提供入口，不增加模型工具或HTTP提权入口。它追加一次新的证据Job与恢复关联，再以原策略/原grant追加提炼Job；不覆写原Job、Bundle、提炼状态、来源或grant用量。命令只排队，不启动worker/pytest/模型。

前置条件：原任务closed、原证据Job succeeded且effectStarted=false；Bundle仅含events_omitted和no_source_verification、无verification；确实有遗漏诊断事件且没有其他不完整项；原提炼blocked/evidence_incomplete、inputDigest/usage/candidate均空；相同任务/仓库/冻结版本、完整来源与策略摘要；当前owner信任与后台验证授权均有效；原grant仍有未使用额度。未知/已开始验证、任何已占用模型调用或其他失败状态不允许恢复。

每个原始Job最多一个直接恢复，无恢复链。跨连接写锁与唯一恢复关联保证幂等；重复命令返回同一恢复Job，不再次入队。恢复执行仍用原冻结输入，完整重新核对授权/版本/来源，失败保留实际结果，不自动重放。

## SQLite v6

learning_jobs移除task_id唯一约束；普通enqueue仍在写锁内按task幂等返回最早原始Job。新增learning_recoveries(original_job_id主键、recovery_job_id唯一、created_at)，均外键引用Job。extraction_jobs保留evidence_job_id唯一、移除task_id唯一，使恢复Job有独立提炼记录，仍共享既有grant。Job/Bundle/Task JSON与来源ID不改。

迁移在BEGIN IMMEDIATE中重建两张表、逐列/原字节复制所有记录，重建索引，检查外键再提交；初始化期间按[SQLite官方重建表流程](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)暂时关闭外键执行，提交后开启，构造完成前不向调用者暴露连接。异常整体回滚。旧程序拒绝v6；安装升级前停止旧宿主/面板并备份，不混跑或直接降级。

面板显示每个Job的诊断事件遗漏数量与恢复关联；ready不是完整会话证明，也不提升候选。来源验证和未来收益继续分别评价。

## 验收与边界

以真实Git/pytest、170条合成元数据验证边界，保留缺来源/版本漂移/unknown/已开始调用拒绝；恢复幂等、双连接/重启、原始JSON保留和迁移回滚有针对检查。真实体验数据不进入Git或CI，不增加付费调用验收代码。此任务不解决Windows Git权限，不宣称真实模型完整学习或收益。
