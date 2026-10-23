# T010：事实来源与保留验收

日期：2026-10-19。Issue [#29](https://github.com/wang1299/dsh-reforge/issues/29)，基线`bdf778cd0fc8172e3a2da976f72b17df6eb2ad4f`。设计与失败用例先提交`cace0f1`，见[ADR013](../decisions/013-fact-evidence.md)与[任务](../tasks/T010-evidence-provenance.md)。

## 实现

- SQLite v3新增evidence/fact_citations，Task/Experience/Verification及旧评价格式不改；v1/v2事务迁移、失败回滚、未知版本拒绝，旧程序不能混跑/直接降级。
- 显式纠正最小文本、宿主验证报告凭据、事实index/hash/来源digest及task/repo校验；只随新revision写引用。新默认evidence-v1要求每事实完整来源，再用原feedback-v1；v2旧数据保留repair状态，v1沿用报告降级并追加候选的重验迁移；缺引用时默认拒绝复用。
- 纠正/propose/verify返回可复制凭据/事实摘要，新增第六工具evolve_link_fact_evidence；面板查看/关联当前和历史事实来源，修订/停用/恢复保持正确版本。
- 清理事务删除过期事件和无任何历史引用的过期最小来源；引用外键保护。来源关联不证明文字主张被来源蕴含，真实用户原话未自动核验。

## 实际本地验证

1. 实现前构建通过，新增correction receipt用例失败：实际undefined而应有可引用记录。旧core已有清理后events归零证据；本轮将最小来源与可清事件分离。
2. 初始52项check及评审修复后53项check通过，含类型/静态/构建。evidence.test真实Git/pytest：旧失败1，修复/回归0失败；两事实部分引用拒绝，关联纠正与报告后另一任务提供精确新revision；清理后历史引用仍可查。
3. 负路径覆盖缺失/异task/异repo/事实hash/证据digest/索引/重复/超额/stale，非法引用不产生半个版本；报告有效JSON被改也拒绝默认复用。显式冻结feedback-v1行为保留。
4. 两连接交错验证清理先赢则引用失败且无版本，引用先赢则来源保留；外键删除/缺失引用失败回滚。不是生产Job或全局exactly-once。
5. v1历史迁移、v2逐表旧记录保留/重开、失败迁移rollback与未知版不改写。修订默认清引用，验证/停用复制，恢复旧引用但candidate；owner显式内容修订后的新版不被旧应用反例自动停用。来源相同幂等及完整已验证来源锁定，另见评审修复。
6. 官方DSH六工具注册及begin/finish/correction/propose/link/stale/跨session/未授权verify/卸载移除通过；Agent身份是fixture，未运行真实DSH模型、pending取消或实际pytest超时专项。
7. 面板HTTP鉴权/同源/摘要/stale/历史完整性及脚本语法通过。实际浏览器：两个事实分别选纠正/测试，保存v2；查看前后commit和失败→通过、旧v1来源缺失；服务重启后仍有引用。长文本横向溢出已修正，原始JSON默认折叠。没有实际发送>32KiB请求专项。
8. demo通过真实合成Git/pytest及evidence-v1第二任务提供。所有模型执行均未开启；旧实验/报告不改写，不宣称新策略收益。

本机截图`.probe-work/T010-panel.png`及demo合成库/报告留在忽略目录，仅本机，不提交token/配置或原始报告。临时测试页/服务已关闭，既有DSH完整Web预览未更新。截图摘要与包安装/最终稳定SHA/当前头CI/独立只读评审结果在PR记录。

实际tgz已本机打包并通过官方plugin-manager/app-boot/Loader安装组件探针：六工具/prompt注册、合成begin成功。完整probe记录在忽略目录，peer服务由源码宿主提供，不能当完整发行Web/Desktop或模型回合。本地最终53项check通过，UI折叠/限宽变更后另作面板三项及真实浏览器核验。评审修复后浏览器再次保存相同来源，仍为v2，未重置历史。

初始本机包SHA256：`37166e657b27fba6163d699bae1f27a397d5e1d80b4d9561373d1feecbe4b7a1`；最终截图SHA256：`b2113e7ac177a0b8b2f1921a79f81167116a8040d9518af3d0db9220c7943920`。包验证后只追加本段等文档结果，最终头CI会重新打包/安装。14文档相对链接/锚点、58需求完整追踪、15场景及A1–A8检查通过，git diff --check通过。

## 独立评审与修复

独立只读Agent审查初始稳定远端17dcca1（本地6ba32cc，内容树一致），基线bdf778c，发现两个P2：来源元数据新revision可使不相关/晚到反例失效；README将v1误写为不改写旧报告。首项新增真实Git/pytest回归在旧实现失败（3≠2），修复后通过：相同引用集合幂等、完整已验证来源拒绝变化、晚到反例仍停用同版、停用经验编辑不激活。DSH和HTTP共用该服务校验；面板锁定并解释owner显式修订路径。原来源pytest重验不能反证后续任务反例。第二项明确v1降级重验与v2原记录保留。

修复后53项check及新的实际tgz组件安装探针通过，证据为本机忽略目录install-probe-WtYwtm/evidence.json；该次实测包SHA256为`f47060824088865ac1341ea7e0a10429b89fada628168f5ddbde97e8403eacbb`（之后只更新文档结果，当前头CI重新打包）。新包与截图摘要、稳定提交的必要增量复审、当前头两平台CI及合并结果在[PR #30](https://github.com/wang1299/dsh-reforge/pull/30)记录。AI审查不是GitHub正式Review，不伪造批准。

## 待最终交付门槛与限制

当前提交仍须Windows/Ubuntu CI和独立只读评审，阻塞修复后必要复审；不能借旧44项或中间52项结果代替新头。最终状态以关联PR为准。AI审查不构成正式GitHub批准，不改保护/权限。

G01/G07部分实现，仍缺自动失败轨迹归并、语义核对、自动提炼、Job/Attempt/恢复、总上下文预算、完全遗忘与更广收益。没有新的模型调用/发布/部署/私人数据上传，父#8/#15保持open。
