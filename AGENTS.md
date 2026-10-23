# DSH-Reforge development rules

- Product requirements live in `docs/product.md`.
- Keep all work inside this repository. Never stage the parent repository or sibling directories.
- The user resumed GitHub development for `wang1299/dsh-reforge`. Task branches, Issues, Draft PRs, development comments, and squash merges are authorized when the documented acceptance, CI, review, and repository rules are satisfied.
- Mini Claude Code (`scipenai/mini-claude-code`) is a technical reference only. Do not establish an upstream contribution or collaboration relationship: no forks, remotes, branches, pushes, Issues, PRs, comments, or messages in or to that project.
- Use `codex/` task branches. Changes to public interfaces, evidence storage, or lifecycle require an ADR before implementation.
- Keep source verification distinct from evidence that using an experience improves future tasks.
- Never treat session idle, normal turn completion, tool transport success, or model self-report as task acceptance.
- Do not collect full conversations, credentials, or arbitrary tool output. Persist bounded structured evidence locally. Learning data and temporary checkouts are ignored by Git.
- Run targeted tests, type checking, lint, build, and compatibility checks appropriate to the changed boundary. Record actual results and missing checks.
- Review stable commit SHAs with an independent read-only agent when available. AI findings are not a GitHub approval.
- Never merge until acceptance, required CI, review, documentation, and branch protection are satisfied. Missing remote means remote steps are pending, not completed.
- Publishing packages, releases, deployments, changing account/security settings, or uploading private data needs separate explicit authorization.
