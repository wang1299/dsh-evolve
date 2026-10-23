# DSH-Reforge

[中文](../README.md) · [English](README.en.md) · [Installation guide (Chinese)](installation.md) · [Compatibility (Chinese)](compatibility.md)

[![npm alpha](https://img.shields.io/npm/v/dsh-reforge/alpha?label=npm%20alpha)](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.1)
[![CI](https://github.com/wang1299/dsh-evolve/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/wang1299/dsh-evolve/actions/workflows/check.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](../LICENSE)

**DSH-Reforge (`dsh-reforge` on npm) is a community plugin for DeepSeek Harness. It builds traceable experience from test-verified Python bug fixes and selects applicable experience as context for later tasks.**

**Experimental alpha: `dsh-reforge@0.1.0-alpha.1`.** Published on October 23, 2026. Public npm download and installation were checked; the [GitHub Release](https://github.com/wang1299/dsh-evolve/releases/tag/v0.1.0-alpha.1) assets and digests were verified. See [Issue #75](https://github.com/wang1299/dsh-evolve/issues/75) for the results. The source repository retains its original address, `wang1299/dsh-evolve`. This independent community project is not officially reviewed, endorsed, or security certified by DeepSeek.

## What it does

- **Records bounded evidence:** once the repository owner enables learning, direct user requests create execution segments with short summaries and limited Python code snapshots.
- **Verifies the source repair:** replays the original failure, independent acceptance tests for the fix, and regression tests in temporary workspaces. A completed turn triggers checking; it does not establish correctness.
- **Extracts candidates:** uses an explicitly configured model registered with DSH to extract candidates with source references and applicability conditions, then independently checks their source evidence.
- **Selects relevant experience:** checks repository, code, dependencies, and relevance before supplying a small amount of context. It may provide none when evidence is insufficient or inapplicable.
- **Supports inspection and correction:** the DSH plugin page shows learning progress, experience, sources, history, and usage records, with feedback, revisions, deactivation, and restoration.

Source verification establishes that a repair passed its checks at that time. **It does not prove that the experience improves future tasks.** Earlier small controlled comparisons did not show an improvement in acceptance success rates; see the [evaluation record (Chinese)](development/T008c-acceptance.md).

## Install and open

Requires **Node.js ≥24.10 and DSH 0.2.0-rc.2**. Repair verification also requires Git, Python ≥3.10, and pytest; CI pins pytest 9.1.1. Compatibility is limited to that DSH version. The plugin does not run in the DeepSeek chat website.

Install the exact version in your DSH environment:

```sh
dsh plugin --profile web add dsh-reforge@0.1.0-alpha.1
```

Before starting DSH, set `DSH_REFORGE_CONFIG` to the absolute path of a private JSON configuration file. A minimal read-only configuration is:

```json
{
  "repoRoot": "/absolute/path/to/your/repository"
}
```

For example, in PowerShell:

```powershell
$env:DSH_REFORGE_CONFIG = 'D:\my-local-config\reforge.json'
```

Stop the previous DSH process and start Web with the same profile:

```sh
dsh web --profile web
```

Open the full authentication URL printed by DSH. Do not share that URL. In the left sidebar, open **Plugins → dsh-reforge → plugin detail page**. The experience button at the top of an existing conversation also opens the page. Opening the page does not call a model.

Learning is off by default. To enable it, the owner must configure independent acceptance tests outside the target repository, execution trust, model sharing, and an extraction allowance. See the [installation and migration guide (Chinese)](installation.md). The legacy `DSH_EVOLVE_CONFIG` variable remains supported; when both variables are set, they must resolve to the same file. Configure provider credentials through DSH, never in the plugin JSON file.

## From a repair to an experience

1. The repository owner configures independent acceptance tests, execution trust, model sharing, and extraction calls, then enables learning.
2. Make a normal Python bug-fix request in DSH and give explicit corrections when needed.
3. The plugin checks the original failure, fixed code, and regression tests in temporary workspaces. With the required evidence and authorization, it extracts a candidate and independently checks it.
4. Inspect the experience, scope, and source in the plugin page. A later applicable request may receive it as context; users can give feedback or deactivate it.

This describes the current workflow. Source checks and subsequent usage records do not establish task improvement. Reusable [Chinese and English project introductions](public-introduction.md) are maintained separately.

## Current limits

- The first release focuses on **Python + pytest repairs within one repository**. Each direct request is a separate execution segment; there is no semantic merging across turns. New Python files, symlinks, interleaved requests, version drift, or unsupported changes may prevent learning.
- Automatic learning requires explicit execution trust, model sharing, independent acceptance tests, and an extraction allowance. `maxCalls` limits extraction calls; **it is not a monetary cap for the full DSH session**. Calls with an unknown outcome are not automatically retried or credited back.
- Local verification executes repository code and **does not provide a strong sandbox**. Enable it only for repositories you trust. The plugin does not automatically roll back or commit your code.
- The default data location remains `~/.dsh/evolve/<repoId>/evolve.sqlite`, currently SQLite v9. Renaming preserves old history, `evolve_` tools, and internal identifiers; it does not move experience data or reset grants.
- The plugin does not store full conversations, attachments, or arbitrary tool output. Automatic mode stores bounded summaries, a few explicit corrections, source identifiers, and limited code snapshots. Automatic complete erasure is not currently implemented. When model sharing is enabled, bounded repair material is sent to the selected provider.
- Windows full Web checks, core CI on Windows and Linux, and installation exercises have been run. Scripted models verify execution paths; they do not establish real-model quality, Desktop support, compatibility with other versions, or task improvement.

## Develop from source

```sh
npm ci --ignore-scripts
npm run check
npm run compat
npm run demo
```

The demo uses synthetic cases only. Follow its configuration path and run `node dist/src/cli.js panel --config <config.json>` to open the standalone panel. Its full URL includes a local access token; do not share it. Development and installation checks use isolated profiles.

[Product requirements (Chinese)](product.md) · [Architecture (Chinese)](architecture.md) · [Roadmap (Chinese)](roadmap.md) · [Contributing (Chinese)](../CONTRIBUTING.md) · [Changelog (Chinese)](../CHANGELOG.md)

Run2Skill is a reference for development organization and documentation granularity only. This repository implements its own data, verification, selection, and update mechanisms. MIT License.
