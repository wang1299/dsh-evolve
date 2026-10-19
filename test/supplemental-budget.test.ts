import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepseekBudget, startBudgetRelay, usageReceiptSchema } from '../scripts/deepseek-budget.js';
import { analyzeMessagesUsage } from '../scripts/messages-usage.js';

const policy = 't015-snapshot-high-water-v1' as const;
const limits = { maxInputTokens: 1_100_000, maxOutputTokens: 4096 };
const stream = (deltas: object[]) => [
  { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20 } } },
  ...deltas.map((usage, i) => ({ type: 'message_delta', usage, ...(i === deltas.length - 1 ? { delta: { stop_reason: 'end_turn' } } : {}) })),
  { type: 'message_stop' },
].map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('');

test('supplemental policy permits cache repartition but never charges below an observed total', () => {
  const body = stream([{ input_tokens: 10, cache_read_input_tokens: 110, output_tokens: 8 }]);
  assert.equal(analyzeMessagesUsage(body, limits).reason, 'counter_decreased');
  assert.deepEqual(analyzeMessagesUsage(body, limits, policy).usage, { input: 120, output: 8 });
  assert.deepEqual(analyzeMessagesUsage(stream([{ input_tokens: 200, output_tokens: 4 },
    { input_tokens: 10, cache_read_input_tokens: 110, output_tokens: 8 }]), limits, policy).usage, { input: 220, output: 8 });
  for (const [deltas, reason] of [
    [[{ output_tokens: 8 }, { output_tokens: 7 }], 'counter_decreased'],
    [[{ input_tokens: -1, output_tokens: 8 }], 'invalid_delta_usage'],
    [[{ input_tokens: 1_100_000, output_tokens: 8 }], 'usage_bounds'],
    [[{ output_tokens: 4097 }], 'usage_bounds'],
    [[{ output_tokens: 8, unknown_tokens: 1 }], 'unsupported_usage'],
  ] as const) assert.equal(analyzeMessagesUsage(stream([...deltas]), limits, policy).reason, reason);
  assert.equal(analyzeMessagesUsage(body.replace('{"type":"message_stop"}', '{"type":"message_stop","usage":{}}'), limits, policy).reason, 'unsupported_usage');
  assert.equal(analyzeMessagesUsage(body.trimEnd(), limits, policy).reason, 'incomplete_frame');
});

test('supplemental ledger identity survives restart and cannot reopen original or mismatched policy', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'evolve-supplemental-')), 'budget.json');
  const budget = new DeepseekBudget(path, policy); budget.reserve(); budget.close();
  const original = readFileSync(path, 'utf8');
  assert.throws(() => new DeepseekBudget(path), /policy|literal|Invalid/i);
  assert.equal(readFileSync(path, 'utf8'), original);
  const reopened = new DeepseekBudget(path, policy);
  try { assert.equal(reopened.state.schemaVersion, 2); reopened.reserve(); assert.throws(() => reopened.reserve(), /exhausted/); }
  finally { reopened.close(); }
});

test('new HTTP relay persists the named numeric policy and conservative cache settlement', async () => {
  const budget = new DeepseekBudget(join(mkdtempSync(join(tmpdir(), 'evolve-supplemental-')), 'budget.json'), policy);
  const relay = await startBudgetRelay(budget, async () => new Response(stream([
    { input_tokens: 10, cache_read_input_tokens: 110, output_tokens: 8 },
  ]), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    await (await fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fake-secret' },
      body: JSON.stringify({ model: 'deepseek-flash', stream: true, max_tokens: 4096, messages: [] }) })).text();
    assert.equal(budget.spent, 304);
    const receipt = usageReceiptSchema.parse(JSON.parse(readFileSync(budget.path + '.receipts/' + budget.state.calls[0]!.id + '.json', 'utf8')));
    assert.equal(receipt.policyId, policy); assert.deepEqual(receipt.usage, { input: 120, output: 8 });
    assert.ok(!JSON.stringify(receipt).includes('secret'));
  } finally { await relay.close(); budget.close(); }
});
