# ADR022：任务证据包与可恢复本地后台任务

日期：2026-10-19，实施前设计。用户确认自动整理失败/修复证据并补最小后台任务，依赖main30ed213；G01/G03切片，G02模型提炼另行实现。

## 边界、触发与授权

沿用显式begin/finish，不从idle或Agent自评猜测任务和成功。finish在一个SQLite事务中关闭任务并为该task创建唯一assemble-evidence-v1 Job；重复finish返回原任务/任务资格，不重新快照。只归并此前同task/repo已采集的纠正与验证来源、最多128条事件元数据、两个commit/依赖及最多8000字符去敏Python diff；纠正/验证来源最多32条，省略数明确保留。多open任务的会话不猜测事件归属。不读取历史聊天正文、任意工具参数/输出、Key或模型接口。

默认仅整理已有报告。新增owner配置backgroundVerification=false；只有它和executionTrusted均true才允许在缺少匹配报告时后台调用既有verifyRepair，无须先创建经验。入队固定模式/策略摘要；worker不能靠模型/HTTP提高授权，重启后当前配置也必须仍允许。执行前核对repo、HEAD、干净的tracked工作树和策略，验收文件由现验证器复制/摘要并存入实际报告。等待期间版本变化就标明缺口，不切换HEAD、不回滚用户代码。文件隔离仍不是安全沙箱。

## SQLite v4与对象

v1/2/3→v4同一事务增加learning_jobs、learning_attempts、evidence_bundles、learning_job_sources，原v3历史/JSON保持；v1沿用原报告降级迁移。旧程序拒绝v4，禁止混跑/直接降级。SQLite busy_timeout及条件写入用于同机多进程协调，不声称跨主机。

Job持久化：唯一task、repo、严格有界输入/摘要、queued/running/succeeded/failed/unknown、attempt计数、随机占用token、lease截止、effectStarted、固定原因、时间和输出引用。输入包含关闭任务摘要、明确版本、来源ID/digest/kind、事件最小元数据及省略数；输出不复制完整报告/纠正文案。Attempt追加每次token、起止时间和local/verification_started/published/failed/abandoned/unknown阶段，无原始异常。

EvidenceBundle v1不可变，包含Job/输入摘要、任务/版本/依赖、最小来源引用/事件/Python diff、所选验证ID/内容摘要、ready或incomplete及有限缺失原因。ready仅表示当前有限材料满足下一步提炼输入条件，不是已学习/语义正确/经验可用或收益。匹配同task/repo/base/fix/依赖的最新报告优先，失败报告不能被旧成功遮盖；每个来源重新核对digest。没有明确纠正、缺报告/未通过、省略/材料不可用等保留incomplete；外部中断为Job unknown，不补造成功。

存储采用规范化引用：材料只保留在不可变Job输入，Bundle存Job/输入摘要、验证引用、状态/原因；读取时关联形成逻辑证据包，不重复存正文。包不直接成为FactCitation来源或提升经验状态，后续提炼须引用已有最小Evidence。

## 占用、恢复与发布

原子条件写入只准一个worker领取queued；每次token/lease与Attempt持久化。lease过期且未开始外部验证的本地工作可重新排队，最多3次attempt；已设置effectStarted的工作转unknown且不自动重开。该标记在调用verifyRepair前落库，即使恰在标记后、启动前断电也保守unknown。无模型调用或费用资格。

worker续租并在丢失资格时取消；发布前同时检查token、running、未到期、输入摘要及任务/来源完整性。报告、最小验证来源、保留引用、包和succeeded/Attempt终态同事务提交；失败回滚，旧worker不能发布。卸载/关闭停止定时器并等待当前工作，已开始验证的取消保留unknown，尚未开始可恢复。后台不向Agent发送包正文。

DSH bind及CLI panel负责启动/停止worker；核心API没有隐式常驻定时器，可显式runNext。正常finish仅返回原Task格式，六工具不增加；后台故障用固定原因进入状态，不阻塞其他Agent任务。

## 保留、观察与限制

Job入队立即通过外键侧表固定所引用最小来源；已发布包及历史attempt与Job保留。清理仍删除旧事件摘要/未引用来源，但不能删除Job或任何经验历史引用的来源；包内有限元数据与引用有意保留，面板说明。不新增彻底遗忘/导出功能，不更改旧实验预算/资格。

鉴权本地面板只读显示Job、attempt、证据包、缺失原因及引用的完整既有验证。无HTTP重试、提权或改验收接口。测试覆盖真实Git/pytest闭环、零执行默认、重复/歧义/跨任务、真实两进程竞争、lease/中断/陈旧发布、迁移/回滚/清理、官方DSH和面板；稳定SHA独立审查、当前头CI/实际包通过后合并。不代表自动提炼/正常真实模型学习/收益，不能据此关闭父#8/#15。
