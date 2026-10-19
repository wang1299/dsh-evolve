import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, composeEntries, getDshRuntimeVersion, initProfile, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot';
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { fixture } from '../test/fixture.js';

// Explicit, optional package verification. Uses synthetic data and never opens an owner's DSH profile.
const archive = resolve(process.argv[2] ?? '.probe-work/dsh-evolve-0.1.0-alpha.0.tgz');
const archiveDigest = createHash('sha256').update(await readFile(archive)).digest('hex');
const workRoot = resolve('.probe-work'); await mkdir(workRoot, { recursive: true });
const work = await mkdtemp(join(workRoot, 'install-probe-'));
const host = join(work, 'host'); await mkdir(host);
const anchor = join(host, 'package.json');
await writeFile(anchor, JSON.stringify({ name: 'evolve-install-probe-host', version: '0.0.0', type: 'module' }));
const profile = join(work, 'profile');
initProfile(profile, []);
assert.equal(getDshRuntimeVersion(), '0.2.0-rc.2');
const result = await runPluginCommand({ profile: 'evolve-install-probe', dir: profile, home: work, installAnchor: anchor, cwd: work },
  ['add', archive, '--ignore-scripts', '--reporter=append-only', `--store-dir=${join(work, 'store')}`],
  { execution: 'service', outputBytes: 8000, idleTimeoutMs: 45000, signal: AbortSignal.timeout(120000) });
assert.equal(result.exitCode, 0, JSON.stringify(result));
const loaded = loadProfileDirectory('dsh', profile, anchor);
assert.deepEqual(loaded.skippedBundles, []);
assert.equal(loaded.layers.length, 1);
assert.equal(loaded.layers[0]!.packageName, 'dsh-evolve');
assert.equal(await realpath(loaded.layers[0]!.packageDir), await realpath(join(profile, 'node_modules', 'dsh-evolve')));
const patches = [...loaded.layers.flatMap((layer) => layer.patches), ...loaded.patches];
const entries = composeEntries([patches]);
assert.equal(entries.filter((entry) => entry.id === 'dsh-evolve' && entry.name === 'dsh-evolve').length, 1);

const f = await fixture();
await writeFile(join(profile, 'cordis.yml'), '[]\n');
patches.push({ id: 'dsh-evolve', config: { repoRoot: f.repo, dataDir: join(work, 'learning'), executionTrusted: false, shareWithModel: false } });
const ctx = await boot('dsh', join(profile, 'cordis.yml'), patches, async (root) => {
  await root.plugin(SystemPrompt, {}).await();
  await root.plugin(ToolRuntime, { mode: 'native' }).await();
  await root.plugin(SessionStore).await();
}, pathToFileURL(join(profile, 'package.json')).href);
try {
  const assembled = await ctx.systemPrompt.assemble();
  assert.equal(assembled.tools.filter((tool) => tool.name.startsWith('evolve_')).length, 6);
  assert.ok(assembled.sections.some((section) => section.name === 'dsh-evolve:workflow'));
  const propose = assembled.tools.find((tool) => tool.name === 'evolve_propose_experience')!;
  const properties = propose.parameters.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.candidate!.type, 'object', 'installed package must publish Candidate fields');
  assert.equal(properties.candidate!.additionalProperties, false);
  assert.deepEqual(new Set((properties.citations!.items as Record<string, unknown>).required as string[]),
    new Set(['factIndex', 'factDigest', 'evidenceId', 'evidenceDigest']));
  const session = ctx.sessions.create(SessionId('installed-package-probe'), { meta: { cwd: f.repo } });
  const output = await ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name: 'evolve_begin_task',
    arguments: { summary: 'synthetic installed-package task' }, agent: { id: session.id } as Agent, signal: AbortSignal.timeout(10000) });
  assert.equal(output.isError, false, JSON.stringify(output));
  await writeFile(join(work, 'evidence.json'), JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(),
    runtimeVersion: getDshRuntimeVersion(), archiveDigest, profile, entries, toolCount: 6,
    installation: 'official shared plugin-manager operation and app-boot loader',
    limitations: ['Peer services supplied by source checkout; no full Web/Desktop application, actual Agent loop or benefit experiment'] }, null, 2));
  console.log('Installed tgz, official profile composition, loader and six tools passed. Evidence:', join(work, 'evidence.json'));
} finally { await ctx.fiber.dispose(); }
