# T019：自动归并证据与最小后台任务

设计：[ADR022](../decisions/022-task-evidence-jobs.md)。范围为G01/G03的本地证据包，基线30ed213；无模型调用、自动提炼或收益结论。

## 目标与验收

1. 显式finish原子入队/按task去重，固定版本/输入/最小来源；事件无正文/参数/输出，歧义不混绑。
2. 默认只整理；backgroundVerification默认false且需executionTrusted。授权开启后无候选前置也能跑真实Git/pytest来源验证，生成可追溯ready包；缺口保持incomplete。
3. SQLite v4 Job/Attempt、两进程单占用、lease/fencing/原子发布，本地中断恢复最多3次；验证开始后unknown不重跑；成功重启不重复处理。
4. 原历史不改、迁移原子/回滚/幂等；queued与历史包固定来源，清理保留出处；鉴权面板可查看任务、包、原因与attempt。
5. 官方固定DSH正常工具/卸载与CLI生命周期、针对/类型/静态/构建、当前头两平台CI/实际包、稳定SHA独立只读审查通过后合并。

## 开发顺序

设计与失败用例 → 持久化/原子恢复 → 归并与授权验证 → DSH/面板 → 集成/负路径 → Draft PR/独立审查/修复/CI → squash。实际结果见验收记录和关联Issue/PR。
