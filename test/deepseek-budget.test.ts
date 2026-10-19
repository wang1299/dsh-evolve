import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepseekBudget, settledMessagesUsage, startBudgetRelay } from '../scripts/deepseek-budget.js';

test('request reservation survives restart and unknown calls cannot reopen paid budget', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'evolve-budget-')), 'budget.json');
  const first = new DeepseekBudget(path);
  first.reserve(); first.close();
  const resumed = new DeepseekBudget(path);
  try {
    assert.equal(resumed.state.calls.length, 1);
    assert.equal(resumed.state.calls[0]!.chargedMicroCny, 2232768);
    resumed.reserve();
    assert.throws(() => resumed.reserve(), /budget/i);
    assert.equal(resumed.state.calls.length, 2);
  } finally { resumed.close(); }
});

const sse = (input = 12, output = 8): string => [
  { type: 'message_start', message: { usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: 20 } } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: output } },
  { type: 'message_stop' },
].map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
const ledger = (): DeepseekBudget => new DeepseekBudget(join(mkdtempSync(join(tmpdir(), 'evolve-budget-')), 'budget.json'));
const request = { model: 'deepseek-flash', stream: true, max_tokens: 4096, messages: [{ role: 'user', content: 'synthetic fixture' }] };
test('relay checks actual wire requests, charges cache conservatively and never persists secrets or payloads', async () => {
  const budget = ledger(); let forwarded = 0;
  const relay = await startBudgetRelay(budget, async (url, init) => {
    forwarded++; assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages'); assert.equal(init?.redirect, 'error');
    assert.equal(budget.state.calls.length, 1, 'Reservation must exist before the network begins');
    return new Response(sse(), { headers: { 'content-type': 'text/event-stream' } });
  });
  const send = (body: object) => fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fixture-secret-never-real' }, body: JSON.stringify(body) });
  try {
    for (const bad of [{ ...request, model: 'deepseek-v4-pro' }, { ...request, max_tokens: 4097 }, { ...request, stream: false },
      { ...request, tools: [{ type: 'web_search', name: 'evolve_search' }] }]) assert.equal((await send(bad)).status, 502);
    assert.equal(budget.state.calls.length, 0); assert.equal(forwarded, 0);
    assert.equal(await (await send(request)).text(), sse()); assert.equal(forwarded, 1);
    assert.equal(budget.spent, 32 * 2 + 8 * 8);
    const receipt = JSON.parse(readFileSync(budget.path + '.receipts/' + budget.state.calls[0]!.id + '.json', 'utf8'));
    assert.equal(receipt.callId, budget.state.calls[0]!.id);
    assert.equal(receipt.reason, 'complete');
    assert.equal(receipt.httpStatus, 200);
    assert.deepEqual(receipt.usage, { input: 32, output: 8 });
    assert.ok(!JSON.stringify(budget.state).includes('fixture-secret')); assert.ok(!JSON.stringify(budget.state).includes('synthetic fixture'));
    assert.throws(() => new DeepseekBudget(budget.path), /EEXIST/);
  } finally { await relay.close(); budget.close(); }
});
test('overlapping requests are rejected and incomplete HTTP/SSE never refunds a reservation', async () => {
  const budget = ledger(); let release!: () => void;
  const relay = await startBudgetRelay(budget, async () => { await new Promise<void>((resolve) => { release = resolve; }); return new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }); });
  const send = () => fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fake' }, body: JSON.stringify(request) });
  try {
    const first = send();
    for (let i = 0; !release && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(release); assert.equal((await send()).status, 429); release(); await (await first).text();
    assert.equal(budget.state.calls.length, 1); assert.equal(budget.spent, 2232768);
  } finally { await relay.close(); budget.close(); }
});
test('settlement requires complete cumulative usage and valid bounds; settled cost permits subsequent bounded calls', () => {
  assert.deepEqual(settledMessagesUsage(sse()), { input: 32, output: 8 });
  assert.deepEqual(settledMessagesUsage(sse().replace('"usage":{"output_tokens":8}', '"usage":{"input_tokens":25,"cache_read_input_tokens":40,"output_tokens":8}')), { input: 65, output: 8 });
  for (const bad of [sse().replace('message_stop', 'other'), sse().replace('"output_tokens":8', '"other":8'),
    sse().replace('"output_tokens":0', '"output_tokens":5000'), sse().replace('"output_tokens":0', '"output_tokens":100'),
    sse().replace('"output_tokens":0', '"output_tokens":-1'),
    sse(-1), sse(1_100_001), sse(12, 4097), sse() + 'data: {"type":"error"}\n\n']) assert.equal(settledMessagesUsage(bad), null);
  const budget = ledger();
  try {
    for (let i = 0; i < 16; i++) { const id = budget.reserve(); budget.settle(id, { input: 100, output: 10 }); }
    assert.throws(() => budget.reserve(), /Budget/); assert.equal(budget.state.calls.length, 16);
    assert.throws(() => budget.settle(budget.state.calls[0]!.id, { input: 0, output: 0 }), /settled/);
  } finally { budget.close(); }
});
