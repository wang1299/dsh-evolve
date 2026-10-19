import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { dshExtractionPort } from '../src/dsh-extraction.js';
import { InvalidExtractionResponse, type ExtractionPolicy } from '../src/extraction-domain.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { bindDsh } from '../src/dsh.js';
import { fixture } from './fixture.js';

const policy = (): ExtractionPolicy => ({ grantId: randomUUID(), provider: 'fixture', model: 'scripted', maxCalls: 1, maxTokens: 1024, timeoutMs: 30000 });
class Adapter extends LlmAdapter {
  calls: GenerateOptions[] = [];
  constructor(private readonly chunks: StreamChunk[]) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'offline extraction fixture'); }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { this.calls.push(options); for (const chunk of this.chunks) yield chunk; }
}
const textChunks = (text: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } }, { type: 'finish', reason: { kind: 'stop' } },
];

test('pinned official DSH prepared LLM receives only bounded evidence and returns one text result with numeric usage', async () => {
  const ctx = new Context(); await ctx.plugin(LlmRuntime).await();
  try {
    const adapter = new Adapter(textChunks('{"kind":"abstain"}')); ctx.llm.registerAdapter(['fixture'], adapter);
    const result = await dshExtractionPort(ctx.llm)({ policy: policy(), material: '{"facts":[]}', signal: new AbortController().signal });
    assert.equal(result.text, '{"kind":"abstain"}'); assert.equal(result.usage?.totalTokens, 20); assert.equal(adapter.calls.length, 1);
    const call = adapter.calls[0]!; assert.equal(call.provider, 'fixture'); assert.equal(call.model, 'scripted'); assert.equal(call.maxTokens, 1024);
    assert.equal(call.sessionId, undefined); assert.equal(call.purpose, undefined); assert.equal(call.tools, undefined); assert.equal(call.messages.length, 1);
    assert.match(call.system!, /untrusted evidence/); assert.equal(call.messages[0]!.role, 'user');
    assert.equal('source' in call.messages[0]!, false, 'Do not fabricate a durable user/session identity');
  } finally { await ctx.fiber.dispose(); }
});

test('native extraction rejects tools, truncated, malformed, oversized and trailing stream events', async () => {
  const ctx = new Context(); await ctx.plugin(LlmRuntime).await();
  const cases: StreamChunk[][] = [
    [{ type: 'block-start', index: 0, blockType: 'tool-call' }],
    [{ type: 'finish', reason: { kind: 'max-tokens' } }],
    [{ type: 'text-delta', index: 0, text: '{}' }],
    textChunks('界'.repeat(12000)),
    [...textChunks('{}'), { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }],
    [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '{}' }, { type: 'block-end', index: 0, block: { type: 'text', text: '{"changed":1}' } }],
  ];
  try {
    for (const chunks of cases) {
      const adapter = new Adapter(chunks); const dispose = ctx.llm.registerAdapter(['fixture'], adapter);
      await assert.rejects(dshExtractionPort(ctx.llm)({ policy: policy(), material: '{}', signal: new AbortController().signal }));
      assert.equal(adapter.calls.length, 1); dispose();
    }
    const reasoning: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' }, { type: 'block-end', index: 0, block: { type: 'reasoning', text: '界'.repeat(11000) } },
      ...textChunks('{"kind":"abstain"}').map(chunk => 'index' in chunk ? { ...chunk, index: 1 } : chunk),
    ];
    ctx.llm.registerAdapter(['fixture'], new Adapter(reasoning));
    await assert.rejects(dshExtractionPort(ctx.llm)({ policy: policy(), material: '{}', signal: new AbortController().signal }), InvalidExtractionResponse);
  } finally { await ctx.fiber.dispose(); }
});

test('normal DSH binding discovers a late LLM adapter and automatically extracts a candidate after ready repair evidence', { timeout: 60000 }, async () => {
  const f = await fixture(); const ctx = new Context();
  await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
  await ctx.plugin(SessionStore).await(); await ctx.plugin(LlmRuntime).await();
  const store = new Store(':memory:'); const grant = policy();
  const service = new EvolveService(store, f.repo, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 }, true, grant);
  const task = service.begin('native', 'rollback on exception'); await f.fix(); service.finish(task.id); await service.jobs.runNext();
  const plugin = ctx.plugin({ name: 'extract-binding', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, false) }); await plugin.await();
  try {
    await pause(300); assert.equal(store.extraction.grants()[0]!.used, 0, 'No registered adapter must not consume a grant');
    const text = JSON.stringify({ kind: 'candidate', title: 'Rollback transaction', strategy: 'Restore previous state on exception.', factIds: ['verification:fixed'], inferences: [], recommendations: [] });
    const adapter = new Adapter(textChunks(text)); ctx.llm.registerAdapter(['fixture'], adapter);
    for (let i = 0; i < 100 && store.extraction.jobs()[0]!.state === 'waiting'; i++) await pause(30);
    assert.equal(store.extraction.jobs()[0]!.state, 'candidate'); assert.equal(adapter.calls.length, 1); assert.equal(store.experiences()[0]!.status, 'candidate');
    assert.equal((await ctx.systemPrompt.assemble()).tools.filter(t => t.name.startsWith('evolve_')).length, 6);
  } finally { await ctx.fiber.dispose(); }
});

test('unloading native DSH cancels an in-flight extraction and settles worker before closing the database', { timeout: 60000 }, async () => {
  const f = await fixture(); const ctx = new Context();
  await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await(); await ctx.plugin(SessionStore).await(); await ctx.plugin(LlmRuntime).await();
  const store = new Store(':memory:'); const service = new EvolveService(store, f.repo,
    { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 }, true, policy());
  const task = service.begin(String(SessionId('cancel-native')), 'rollback'); await f.fix(); service.finish(task.id); await service.jobs.runNext();
  let signal: AbortSignal | undefined;
  class Hanging extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      signal = options.signal;
      await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['fixture'], new Hanging());
  await ctx.plugin({ name: 'extract-unload', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, false) }).await();
  for (let i = 0; i < 100 && !signal; i++) await pause(20);
  assert.ok(signal); assert.equal(store.extraction.jobs()[0]!.state, 'running');
  await ctx.fiber.dispose(); assert.equal(signal.aborted, true); assert.throws(() => store.extraction.jobs(), /closed|open/i);
});
