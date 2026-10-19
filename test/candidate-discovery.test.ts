import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { bindDsh } from '../src/dsh.js';
import { startPanel } from '../src/panel.js';
import { fixture } from './fixture.js';

const candidate = { title: '<script>untrusted title</script>', strategy: 'S'.repeat(600), observedFacts: ['Synthetic correction'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] };
interface Inbox { total: number; more: boolean; items: { experienceId: string; revision: number; title: string; strategy: string; strategyTruncated: boolean; taskId: string }[] }
function publish(service: EvolveService, session: string) {
  const task = service.begin(session, 'Synthetic source'); service.finish(task.id);
  const job = service.store.extraction.jobs().find(j => j.taskId === task.id)!;
  const claimed = service.store.extraction.claim(job.id, '0'.repeat(64), Date.now())!;
  const exp = service.propose(task.id, candidate);
  assert.equal(service.store.extraction.complete(claimed, Date.now(), 'candidate', 'extracted', null, () => exp.id), true);
  return { task, exp };
}
const makeService = (store: Store, repo: string, acceptance: string) => new EvolveService(store, repo,
  { trusted: false, python: 'python', acceptanceDir: acceptance, regressionPath: 'tests', timeoutMs: 1000 }, false,
  { grantId: randomUUID(), provider: 'offline', model: 'scripted', maxCalls: 100, maxTokens: 128, timeoutMs: 1000 });

test('candidate inbox authenticates and reads only current automatic candidates without mutating state', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = makeService(store, f.repo, f.acceptance);
  const { exp, task } = publish(service, 'owner'); service.propose(task.id, candidate); // manual candidate is excluded
  const panel = await startPanel(service); const headers = { Authorization: 'Bearer ' + panel.token };
  const inbox = async () => { const r = await fetch(panel.origin + '/api/candidates', { headers }); assert.equal(r.status, 200); return await r.json() as Inbox; };
  try {
    assert.equal((await fetch(panel.origin + '/api/candidates')).status, 401);
    let view = await inbox(); assert.equal(view.total, 1); assert.equal(view.more, false); assert.equal(view.items[0]!.experienceId, exp.id);
    assert.equal(view.items[0]!.title, candidate.title); assert.equal(view.items[0]!.strategy.length, 512); assert.equal(view.items[0]!.strategyTruncated, true);
    assert.equal(store.history(exp.id).length, 1); assert.equal(store.applications().length, 0); assert.equal(store.feedback().length, 0);
    service.disable(exp.id, 'Owner rejected candidate', 1); assert.equal((await inbox()).total, 0);
    service.restore(exp.id, 1, 'Owner requests a new review', 2); view = await inbox(); assert.equal(view.items[0]!.revision, 3);
    assert.equal(store.history(exp.id).length, 3); // read cannot acknowledge or create another version
    assert.equal((await fetch(panel.origin + '/api/candidates', { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { await panel.close(); store.close(); }
});

test('official DSH candidate tool and next-step reminder respect sharing, session, cwd and unload', async () => {
  const f = await fixture();
  for (const sharing of [true, false]) {
    const ctx = new Context(); await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await(); await ctx.plugin(SessionStore).await();
    const store = new Store(':memory:'); const service = makeService(store, f.repo, f.acceptance); const own = publish(service, 'own'); const foreign = publish(service, 'other');
    const handle = ctx.plugin({ name: 'candidate-test', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, sharing) }); await handle.await();
    const ownSession = ctx.sessions.create(SessionId('own'), { meta: { cwd: f.repo } });
    const otherSession = ctx.sessions.create(SessionId('other'), { meta: { cwd: f.repo } });
    const outside = ctx.sessions.create(SessionId('outside'), { meta: { cwd: f.home } });
    const identity = { id: ownSession.id } as Agent;
    const run = (args: object, agent: Agent | undefined = identity) => ctx.tools.execute({ callId: ToolCallId(randomUUID()), name: 'evolve_list_candidates', arguments: args, agent, signal: AbortSignal.timeout(3000) });
    try {
      const result = await run({}); assert.equal(result.isError, false);
      const raw = result.content.find(c => c.type === 'text')!.text;
      const view = JSON.parse(raw) as Inbox;
      if (sharing) {
        assert.equal(view.total, 1); assert.equal(view.items[0]!.experienceId, own.exp.id); assert.ok(!raw.includes(foreign.exp.id));
        assert.equal((await run({ taskId: foreign.task.id })).isError, true);
        const otherRaw = JSON.stringify(await run({}, { id: otherSession.id } as Agent)); assert.ok(otherRaw.includes(foreign.exp.id)); assert.ok(!otherRaw.includes(own.exp.id));
      } else { assert.deepEqual(JSON.parse(raw), { reason: 'sharing_disabled_by_owner' }); }
      assert.equal((await run({}, { id: outside.id } as Agent)).isError, true);
      const noAgent = await ctx.tools.execute({ callId: ToolCallId(randomUUID()), name: 'evolve_list_candidates', arguments: {}, signal: AbortSignal.timeout(3000) }); assert.equal(noAgent.isError, true);
      const reminder = (await ctx.systemPrompt.assemble(assembleContextFor(identity))).contexts.find(c => c.name === 'dsh-evolve:candidates');
      if (sharing) { assert.ok(reminder); assert.match(reminder.text, /1/); assert.ok(!reminder.text.includes(own.exp.id)); assert.ok(!reminder.text.includes(candidate.title)); }
      else assert.ok(!reminder?.text);
      for (const agent of [undefined, { id: outside.id } as Agent]) {
        const assembly = await ctx.systemPrompt.assemble(agent ? assembleContextFor(agent) : {}); assert.ok(!assembly.contexts.find(c => c.name === 'dsh-evolve:candidates')?.text);
      }
      assert.equal(store.applications().length, 0); assert.equal(store.feedback().length, 0);
    } finally { await handle.dispose(); }
    const after = await ctx.systemPrompt.assemble(); assert.ok(!after.contexts.some(c => c.name === 'dsh-evolve:candidates')); assert.ok(!after.tools.some(t => t.name === 'evolve_list_candidates')); await ctx.fiber.dispose();
  }
});

test('candidate projection is bounded, deterministic, session-filtered and repository-isolated', async () => {
  const f = await fixture(); const other = await fixture(); const store = new Store(':memory:'); const a = makeService(store, f.repo, f.acceptance); const b = makeService(store, other.repo, other.acceptance);
  for (let i = 0; i < 12; i++) publish(a, 'own'); const hidden = publish(b, 'own');
  const panel = await startPanel(a);
  try {
    const get = async () => await (await fetch(panel.origin + '/api/candidates', { headers: { Authorization: 'Bearer ' + panel.token } })).json() as Inbox;
    const first = await get(); assert.equal(first.total, 12); assert.equal(first.items.length, 10); assert.equal(first.more, true); assert.deepEqual(await get(), first); assert.ok(!JSON.stringify(first).includes(hidden.exp.id));
  } finally { await panel.close(); store.close(); }
});
