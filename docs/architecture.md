# 架构 v0.1

## 数据流

DSH 会话／工具事件 → 最小化采集 → 任务记录 → 隔离验证 → 候选经验 → 条件过滤与排序 → DSH 上下文 → 使用记录与反馈 → 新版本／停用。

TypeScript/Node.js 实现插件和核心，Python＋pytest 只作为目标仓库及验证场景。核心与 DSH 薄适配层分离。Node 24 的 SQLite 存储本地数据，事务维护当前版本与不可变历史。任务／经验格式 `schemaVersion: 1`，验证报告与 SQLite user_version 为2，迁移见 ADR-003。

## 模块

- domain：任务、经验、验证、应用及反馈的严格输入验证。
- store：SQLite、事务、版本、清理、历史；数据库不在 Git 跟踪内。
- verification：固定 Git 快照、外部验收测试、子进程取消／超时／退出码、报告。
- selection：作用域过滤、文本相似度、经验效用与拒绝应用；不进行模型训练。
- dsh：官方工具、事件观察、prompt section；所有事件按 session/task 显式绑定，工具结果仅观察。
- panel：本地面板；绑定 loopback，凭据保护写操作、检查来源，不开放任意命令或文件读取。
- evaluation：基线、普通检索、完整机制三组结果格式，冻结评价任务、模型和预算，报告原始结果。
- codex-runner：可选只读CLI模型实验、最小JSONL元数据、受限结构化修复、宿主路径／摘要校验及独立pytest；见ADR-007。它复用经验核心，不替代DSH入口或正式收益评价。

## 关键约束

修复验证和收益评价分开。正常 turn/end 不等于正确；测试退出码不能用工具 isError 替代。回放运行项目代码，必须先显式信任仓库和固定验证命令；临时工作目录提供文件隔离，不声称提供恶意代码安全沙箱。

DSH 版本以 `docs/decisions/002-dsh-boundary.md` 为准。当前 master 文档不是发行包兼容证明，最终以固定发行包类型和运行探针为准。
