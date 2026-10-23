# T037：统一项目与仓库身份

2026-10-23，Issue #85，分支 `codex/t037-project-identity`。基线 cf1aa3a，依赖前一首页 PR #84 的最终结果。设计见 [ADR037](../decisions/037-project-identity.md)，先于实现提交。

目标：同一 GitHub 仓库改名，新旧公开地址核对；当前源码、文档、元数据、原生入口与 profile 行 ID 统一新名。旧配置与不可变历史格式集中兼容，SQLite/经验/来源/预算及授权保持。公开发行版本不因当前源码更名而重新上传。

验收：针对与完整检查、兼容、实际打包/安装与零模型学习、自定义 profile 的同库保全升级；独立稳定 SHA 审查、当前头双平台 CI 和规则后合并；新地址、旧跳转、同仓库 ID、素材/Issue/Release 及 origin 回读。目录申请使用原 Issue 更新地址。实际结果记录于 Issue #85，不提前宣称完成。
