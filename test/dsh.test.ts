import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { execFileSync } from 'node:child_process';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { bindDsh } from '../src/dsh.js';
import { fixture } from './fixture.js';

test('official DSH 0.2.0-rc.2 services register, execute, isolate sessions and unload', async () => {
  const f = await fixture(); const ctx = new Context();
  await ctx.plugin(SystemPrompt, {}).await();
  await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
  await ctx.plugin(SessionStore).await();
  const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  const plugin = ctx.plugin({ name: 'evolve-probe', inject: ['tools', 'systemPrompt', 'sessions'], apply: (child: Context) => bindDsh(child, service, false) });
  await plugin.await();
  // Real SessionStore and ToolRuntime; the agent identity is a fixture, not a running LLM loop.
  const session = ctx.sessions.create(SessionId('compat-session'), { meta: { cwd: f.repo } });
  const identity = { id: session.id } as Agent;
  const run = (name: string, args: object, agent = identity) => ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name, arguments: args, agent, signal: new AbortController().signal });
  const assembly = await ctx.systemPrompt.assemble();
  assert.ok(assembly.sections.some((s) => s.name === 'dsh-evolve:workflow'));
  assert.equal(assembly.tools.filter((t) => t.name.startsWith('evolve_')).length, 5);
  const result = await run('evolve_begin_task', { summary: 'database rollback' });
  assert.equal(result.isError, false, JSON.stringify(result));
  const task = service.store.tasks()[0]!;
  assert.equal(task.sessionId, session.id);
  const other = ctx.sessions.create(SessionId('compat-other'), { meta: { cwd: f.repo } });
  const rejected = await run('evolve_finish_task', { taskId: task.id }, { id: other.id } as Agent);
  assert.equal(rejected.isError, true);
  const observed = store.events(task.id);
  assert.ok(observed.length > 0);
  assert.ok(!JSON.stringify(observed).includes('database rollback'));
  const finished = await run('evolve_finish_task', { taskId: task.id });
  assert.equal(finished.isError, false);
  if (process.platform === 'win32') {
    const alias = execFileSync(process.env.EVOLVE_PYTHON ?? 'python', ['-c',
      'import ctypes,sys; b=ctypes.create_unicode_buffer(32768); n=ctypes.windll.kernel32.GetShortPathNameW(sys.argv[1],b,len(b)); assert n>0; print(b.value)', f.repo],
    { encoding: 'utf8', windowsHide: true }).trim();
    const aliasSession = ctx.sessions.create(SessionId('compat-alias'), { meta: { cwd: alias } });
    assert.equal((await run('evolve_begin_task', { summary: 'same repository alias' }, { id: aliasSession.id } as Agent)).isError, false);
  }
  const outside = ctx.sessions.create(SessionId('compat-outside'), { meta: { cwd: f.home } });
  assert.equal((await run('evolve_begin_task', { summary: 'outside repository' }, { id: outside.id } as Agent)).isError, true);
  await plugin.dispose();
  const after = await ctx.systemPrompt.assemble();
  assert.ok(!after.sections.some((s) => s.name === 'dsh-evolve:workflow'));
  assert.equal(after.tools.filter((t) => t.name.startsWith('evolve_')).length, 0);
});
