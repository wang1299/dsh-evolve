# DSH-Evolve development rules

- Product requirements live in `docs/product.md`. Run2Skill is a workflow reference only; do not copy its product or implementation.
- Keep all work inside this repository. Never stage the parent repository or sibling directories.
- Use `codex/` task branches. Changes to public interfaces, evidence storage, or lifecycle require an ADR before implementation.
- Keep source verification distinct from evidence that using an experience improves future tasks.
- Never treat session idle, normal turn completion, tool transport success, or model self-report as task acceptance.
- Do not collect full conversations, credentials, or arbitrary tool output. Persist bounded structured evidence locally. Learning data and temporary checkouts are ignored by Git.
- Run targeted tests, type checking, lint, build, and compatibility checks appropriate to the changed boundary. Record actual results and missing checks.
- Review stable commit SHAs with an independent read-only agent when available. AI findings are not a GitHub approval.
- Never merge until acceptance, required CI, review, documentation, and branch protection are satisfied. Missing remote means remote steps are pending, not completed.
- Publishing packages, releases, deployments, changing account/security settings, or uploading private data needs separate explicit authorization.
