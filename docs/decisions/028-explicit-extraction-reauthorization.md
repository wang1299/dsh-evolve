# ADR-028：未知提炼后的一次显式重新授权

状态：接受；T026 / Issue #61。实现前设计，基线 a6bb09b。

## 决定与边界

凭据或传输异常可能发生在逻辑调用次数占用后。unknown保持未知，旧grant与财务占额不释放。owner可在独立授权后，用新的单次grant为同一份已验证证据追加一次提炼。此操作不新增或重置任何金额上限；财务守卫仍独立拒绝超额请求。

仅owner CLI `reauthorize-extraction --config <file> --task-id <id> --expected-job <id>`提供入口。配置中的新grant是owner对新一次调用的显式授权；命令只排队，不运行测试或模型。不增加模型工具或HTTP授权入口。

前置条件：任务closed且属于当前仓库；原提炼unknown/interrupted_model、已有inputDigest、无candidate；service构造时modelSharingAllowed显式为true（createService来自shareWithModel）；当前证据ready且独立修复证明、来源、依赖、修复提交及干净工作区均有效，重建材料摘要与原inputDigest一致；owner执行信任和模型共享均有效。新旧策略除grantId外完全相同，maxCalls均为1；新grant从未存在。原grant存在且已占用一次。所有检查在任务写锁内进行。

每个原始提炼最多一个直接新尝试，无链。重复命令仅在已存在子记录的策略与当前配置完全一致时返回同一记录（包括终态），不重新排队。禁止候选/失败/弃权/等待/运行等其他状态、旧grant复用及不同新grant覆盖已创建子记录。运行时继续检查材料和当前策略；新尝试失败保留实际状态，不再自动重放。

## SQLite v7

extraction_jobs将evidence_job_id唯一改为(evidence_job_id,grant_id)唯一；普通enqueue在写锁内仍返回该证据最早原始Job，不因改配置自动创建新尝试。新增extraction_reauthorizations(original_job_id主键、new_job_id唯一、created_at)，两列均外键关联Job。旧Job/Bundle/Task JSON和grant计数原样复制。面板只读显示关联，明确它是新授权尝试而非原请求成功。

v6→v7在现有BEGIN IMMEDIATE初始化事务内重建提炼表、重建索引、检查外键、提交再启用外键；任何异常整体回滚。v1–v5先沿用v6迁移再迁移v7。旧程序拒绝v7；升级前停止旧宿主/面板，备份数据库，不混跑或直接降级。

## 验收

真实Git/pytest合成来源后模拟一个unknown；新grant只占用一次，产物仍是未启用候选。跨连接/进程重复、迁移原行保留/失败回滚、变更来源/脏代码/策略撤销/复用grant/链式尝试等负路径均检查。CLI检查不启动模型。发布门槛包括完整检查、官方兼容、实际安装、Windows/Linux CI与独立只读评审。真实体验另记，不能据此宣称未来任务收益。
