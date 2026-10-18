# 开发组织参考核验

2026-10-18只读研究Run2Skill的开发组织；没有clone/fork或复制产品实现。

- [贡献指南](https://github.com/qkycir-123/dsh-run2skill/blob/main/CONTRIBUTING.md)：行为变化配测试，公开接口先讨论，兼容探针按影响边界运行，不提交会话和临时数据。
- [Issue161](https://github.com/qkycir-123/dsh-run2skill/issues/161)：写明背景、目标、非目标和专项触发验证，来源是前一PR评审中的后续项。
- [PR160](https://github.com/qkycir-123/dsh-run2skill/pull/160)：关联Issue159和任务分支，正文区分改动、实际验证与Windows未通过的上游构建条件；记录Ready状态。它最终关闭并被后续适配取代，不能当作已合并案例。页面没有正式Review，不能因此假定参考仓库的每个PR都有人类批准。

本项目流程以用户当前明确要求为准：独立AI评审与正式GitHubReview分开，满足验收/CI/评审/保护后才能squash merge。缺少远端时本地PR提案不冒称GitHubPR。
