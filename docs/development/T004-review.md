# T004 独立只读评审与修复

评审目标018462f6e7b45045077c6ec91959c42b220c34b4，基线2fd39ced208add4fae27bfdce0104be1dc8e1f7f。AI Agent mvp_independent_review，只读稳定提交及合成复现，不是GitHub批准。

无P0/P1，发现一个P2：panel.ts:85-95在HTTP先查revision，随后disable/restore另读再写，另一个DSH进程可插入新版本，导致旧页面操作覆盖它。

修复：预期版本传入服务，在SQLite事务内比较并写入，冲突统一RevisionConflict并返回409。新增两个Store实例共享同一SQLite的回归测试，验证旧disable/restore不会改动较新版本。原顺序HTTP测试保留。

实际检查：面板2项HTTP/共享DB测试通过，类型、ESLint通过。必要独立复审待新提交。GitHub Issue/PR/CI/合并仍缺少远端。
