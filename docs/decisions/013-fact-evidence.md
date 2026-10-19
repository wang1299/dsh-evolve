# ADR-013：事实来源引用、保留和默认资格

日期：2026-10-19。T010 / Issue #29。实现前基线`bdf778cd0fc8172e3a2da976f72b17df6eb2ad4f`。落实G01/G07的显式证据切片；不实现自动轨迹归并、语义真值判断、LLM提炼或后台Job。

## 决定与替代方案

1. SQLite升user_version=3，新增不可变evidence与按经验revision绑定的fact_citations。Task/Experience v1、Verification v2和评价v1/v2/v3保持，不把新字段加入历史经验JSON／库摘要。对比改写observedFacts为对象，侧表能保留现有记录和冻结实验格式；缺失不伪造补齐。
2. Evidence v1由服务构造：共同id/taskId/repoId/createdAt/kind/digest；correction额外note，verification额外verificationId。纠正记录是“显式工具提交的纠正”，不能凭此认证真实用户原话；报告来源必须是宿主验证器。摘要绑定全部最小字段；verification还绑定完整既有报告。证据不复制会话、工具原始输出或整份报告。
3. FactCitation严格输入为factIndex(0–11)、factDigest、evidenceId、evidenceDigest；一版最多36项，每事实最多3项，重复／越界拒绝。事实hash绑定脱敏后持久化文本；校验记录存在、来源task/repo和内容摘要，不能把任意“相关”文本引用等同文字主张已证实。自然语言的蕴含核对仍为G02。
4. propose可选第三参数citations，Candidate原模式不变；有引用时与新经验同事务提交。linkEvidence(id,expectedRevision,citations)先比较规范化引用集：相同引用幂等返回原revision，保留原应用反馈。已source_verified且来源完整时，拒绝任何来源变化；owner须检查历史反馈并显式revise为candidate后再编辑。其余真实变化追加相同文字的新revision并保留当前状态/修复报告；候选/停用不提权。来源不完整的已验证经验此前不具生产复用资格，允许首次补齐。不能仅靠重新运行来源pytest消除后续任务反例。
5. verify/disable复制本版引用，restore复制目标历史版引用并重新校验但仍candidate/verificationId=null；revise默认清空引用，显式提供且文本/来源匹配才接纳。所有历史引用保留。陈旧链接及写入失败不得留下半个经验版本。新的引用表对revisions/evidence声明外键；既有表不冒称有外键。
6. source_verified仍仅表示修复运行验证。新生产默认evidence-v1在feedback-v1之前要求每条事实至少一个有效引用，否则拒绝整条经验自动复用。v2老库状态/报告/历史不改写，只显示来源不完整；v1沿用第10项降级重验迁移；引用和修复验证两种资格分开。原bm25-v1/feedback-v1保留为显式历史实验策略；脚本原来的隐式默认改为显式固定，不偷换新策略或宣称新收益。未来评价evidence-v1须另冻结包含侧表的库摘要和协议。
7. correction返回证据receipt；propose返回事实hash；verify提供报告证据receipt。新增第六个DSH工具evolve_link_fact_evidence，参数experienceId/revision/citations，按官方既有注册方式及同session/repo检查。Agent不能写任意证据、验证声明或owner反馈。模型得到receipt只证明记录/引用，不证明实际采纳经验。
8. 面板GET state附带证据、每版引用及当前完整性；受保护POST /api/experience/:id/evidence接受revision/citations。展示来源种类、纠正最小文本／报告、历史引用和缺失原因，明确“来源引用不认证文字语义”；现标题/策略修订保留未变事实的有效引用，手工引用编辑必须通过服务校验，完整已验证来源只读，展示先检查反馈/人工修订的路径。
9. 普通30天清理在事务内删除过期events及未被任何历史revision引用的过期evidence。引用中的最小纠正可比事件保留更久，面板解释理由；不删除task、报告/验收、应用/反馈/历史。引用写入和清理串行化，外键防止出现已写引用却删除证据的裂缝。该规则不是彻底遗忘或自动过期worker。
10. v0新库/v1/v2→v3在事务中创建侧表；v1沿用既有报告降级迁移，v2不改写旧内容。迁移失败回滚，重开幂等，未知版拒绝。旧程序只认≤2，不能混跑/降级；不删除真实用户数据，不自动升级本机现有预览安装。Node/DSH/Cordis及npm源码包版本不变，尚未发布。

## 独立评审后的决定修正

初始稳定提交17dcca1的第4项允许相同来源也创建新版本。独立只读评审实际复现：不相关反馈和晚到反例会因版本变化失效。先加入真实Git/pytest回归，用例在旧实现失败（revision 3而应为2），再实施幂等和完整已验证来源锁定。锁定在共享服务实现，覆盖DSH与HTTP；不增加反馈谱系或改写历史。原来源重验只证明当时修复，不能反证后续反馈。owner显式内容修订/恢复及新UUID重复候选仍受既有规则限制，跨经验去重/负知识属E05后续范围。

## 验收与限制

先复现correction无receipt及清理丢来源，再用真实合成Git/pytest检验来源、引用、复用、清理、版本和负路径；覆盖缺失/跨任务/跨repo/摘要/索引/重复/陈旧版本、原子失败、跨连接清理、v1/v2迁移、正常DSH六工具与面板认证。运行check/compat/demo/实际tgz安装及当前头两平台CI，稳定提交独立只读审查后按规则合并。

仍不证明引用文字语义正确、真实DSH自主调用、自动提炼、恶意代码隔离或Agent收益。无模型新调用、发布或私人报告上传。G01/G07仅部分完成，父#8/#15保持open。
