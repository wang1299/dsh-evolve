import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetPolicy, DeepseekBudget, settledMessagesUsage, startBudgetRelay, usageReceiptSchema } from '../scripts/deepseek-budget.js';
import { analyzeMessagesUsage } from '../scripts/messages-usage.js';

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
    assert.equal(readReceipt(budget).reason, 'awaiting_response', 'Numeric receipt must also precede forwarding');
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
    assert.ok(!JSON.stringify(receipt).includes('fixture-secret')); assert.ok(!JSON.stringify(receipt).includes('synthetic fixture'));
    assert.ok(!JSON.stringify(budget.state).includes('fixture-secret')); assert.ok(!JSON.stringify(budget.state).includes('synthetic fixture'));
    assert.throws(() => new DeepseekBudget(budget.path), /EEXIST/);
  } finally { await relay.close(); budget.close(); }
});

function readReceipt(budget: DeepseekBudget) {
  return usageReceiptSchema.parse(JSON.parse(readFileSync(budget.path + '.receipts/' + budget.state.calls.at(-1)!.id + '.json', 'utf8')));
}
const analyze = (body: string) => analyzeMessagesUsage(body, budgetPolicy);
test('numeric replay explains conservative cache repartition rejection and malformed or incomplete usage', () => {
  const changed = sse(100).replace('"usage":{"output_tokens":8}', '"usage":{"input_tokens":10,"cache_read_input_tokens":110,"output_tokens":8}');
  assert.equal(analyze(changed).reason, 'counter_decreased');
  assert.equal(analyze(changed).snapshots[0]!.input, 100);
  assert.equal(analyze(changed).snapshots[1]!.input, 10);
  assert.equal(analyze(changed).snapshots[1]!.cacheRead, 110);
  const cases = [
    [sse().replace('message_stop', 'other'), 'missing_stop'],
    [sse().trimEnd(), 'incomplete_frame'],
    [sse().replace('"output_tokens":8', '"other":8'), 'unsupported_usage'],
    [sse().replace('"output_tokens":8', '"output_tokens":"private-string"'), 'invalid_delta_usage'],
    [sse().replace('"cache_read_input_tokens":20', '"cache_read_input_tokens":null'), 'invalid_start_usage'],
    [sse().replace('"output_tokens":0', '"output_tokens":100'), 'counter_decreased'],
    [sse(1_100_001), 'usage_bounds'], [sse(12, 4097), 'usage_bounds'],
    [sse() + 'data: {}\n\n', 'event_after_stop'], ['data: not-json\n\n', 'invalid_json'],
    ['data: {"type":"error","error":{"message":"provider-private"}}\n\n', 'provider_error'],
  ] as const;
  for (const [body, reason] of cases) {
    const result = analyze(body); assert.equal(result.reason, reason); assert.equal(result.usage, null);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
  const delta = 'data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n';
  assert.equal(analyze(sse().replace('data: {"type":"message_delta"', delta.repeat(64) + 'data: {"type":"message_delta"')).reason, 'receipt_limit');
  assert.deepEqual(analyze(sse().replace(/\n/g, '\r')).usage, { input: 32, output: 8 });
});

test('usage on unsupported start or stop fields must retain the full reservation', async () => {
  const variants = [null, {}, { input_tokens: 1_100_000, output_tokens: 4096 }, { output_tokens: -1 }];
  const bodies = variants.map((usage) => sse().replace('{"type":"message_stop"}', JSON.stringify({ type: 'message_stop', usage })));
  bodies.push(sse().replace('{"type":"message_start",', '{"type":"message_start","usage":{"output_tokens":4096},'));
  for (const body of bodies) {
    assert.equal(analyze(body).reason, 'unsupported_usage'); assert.equal(settledMessagesUsage(body), null);
    const budget = ledger();
    const relay = await startBudgetRelay(budget, async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    try {
      await (await fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fake' }, body: JSON.stringify(request) })).text();
      assert.equal(readReceipt(budget).reason, 'unsupported_usage'); assert.equal(budget.state.calls[0]!.usage, null);
      assert.equal(budget.spent, budgetPolicy.reservationMicroCny);
    } finally { await relay.close(); budget.close(); }
  }
});

test('split SSE chunks retain only numeric snapshots, never response text or arbitrary stop reasons', async () => {
  const budget = ledger();
  const content = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"response-private-code"}}\n\n';
  const body = sse().replace('data: {"type":"message_delta"', content + 'data: {"type":"message_delta"');
  const relay = await startBudgetRelay(budget, async () => new Response(new ReadableStream({ start(controller) {
    const wire = Buffer.from(body); for (let i = 0; i < wire.length; i += 3) controller.enqueue(wire.subarray(i, i + 3)); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    const response = await fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fixture-private-key' }, body: JSON.stringify(request) });
    assert.equal(await response.text(), body);
    const receipt = readReceipt(budget);
    assert.equal(receipt.reason, 'complete'); assert.equal(receipt.responseBytes, Buffer.byteLength(body));
    assert.equal(receipt.otherEvents, 1); assert.equal(receipt.snapshots.length, 3);
    assert.ok(!JSON.stringify(receipt).includes('private'));
    const id = budget.state.calls[0]!.id;
    const input = { reason: receipt.reason, httpStatus: receipt.httpStatus, responseBytes: receipt.responseBytes,
      snapshots: receipt.snapshots, otherEvents: receipt.otherEvents, usage: receipt.usage };
    assert.throws(() => budget.writeReceipt(id, { ...input, prompt: 'private' }));
    assert.throws(() => budget.writeReceipt(id, { ...input, snapshots: [{ ...receipt.snapshots[0], text: 'private' }] }));
    assert.equal(readReceipt(budget).reason, 'complete');
  } finally { await relay.close(); budget.close(); }
  assert.equal(analyze(sse().replace('end_turn', 'private-stop-reason')).snapshots[1]!.stopReason, 'unknown');
});

test('HTTP, content-type, stream failure and response limits retain linked unknown reservations', async () => {
  for (const kind of ['http', 'type', 'stream', 'bound'] as const) {
    const budget = ledger();
    const relay = await startBudgetRelay(budget, async () => {
      if (kind === 'http') return new Response('private-error', { status: 402 });
      if (kind === 'type') return new Response('private-body');
      if (kind === 'bound') return new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'text/event-stream' } });
      let first = true;
      return new Response(new ReadableStream({ pull(controller) {
        if (first) { first = false; controller.enqueue(Buffer.from(sse().split('\n\n')[0]! + '\n\n')); }
        else controller.error(new Error('private-transport-error'));
      } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    try {
      try { await (await fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fake' }, body: JSON.stringify(request) })).text(); } catch { /* Interrupted HTTP is expected. */ }
      const receipt = readReceipt(budget);
      assert.equal(receipt.reason, { http: 'http_rejected', type: 'missing_sse', stream: 'transport_error', bound: 'response_bound' }[kind]);
      assert.equal(receipt.usage, null); assert.equal(budget.spent, budgetPolicy.reservationMicroCny);
      assert.ok(!JSON.stringify(receipt).includes('private'));
      if (kind === 'stream') assert.equal(receipt.snapshots[0]!.type, 'message_start');
      if (kind === 'bound') assert.ok(receipt.responseBytes > 1024 * 1024);
    } finally { await relay.close(); budget.close(); }
    const reopened = new DeepseekBudget(budget.path);
    try { assert.equal(reopened.spent, budgetPolicy.reservationMicroCny); } finally { reopened.close(); }
  }
});

test('receipt persistence failure blocks forwarding or settlement without refunding liability', async () => {
  for (const stage of ['before', 'after', 'ledger'] as const) {
    const budget = ledger(); let forwarded = 0;
    if (stage === 'before') writeFileSync(budget.path + '.receipts', 'synthetic obstruction');
    const relay = await startBudgetRelay(budget, async () => {
      forwarded++;
      const path = stage === 'ledger' ? budget.path : budget.path + '.receipts/' + budget.state.calls[0]!.id + '.json';
      renameSync(path, path + '.reserved'); mkdirSync(path); // Synthetic rename failure after the durable pending receipt.
      return new Response(sse(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const send = () => fetch(relay.baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fake' }, body: JSON.stringify(request) });
    try {
      try { await (await send()).text(); } catch { /* May fail after SSE headers. */ }
      assert.equal(forwarded, stage === 'before' ? 0 : 1);
      assert.equal(budget.spent, budgetPolicy.reservationMicroCny); assert.equal(budget.state.calls[0]!.usage, null);
      if (stage === 'ledger') assert.equal(readReceipt(budget).reason, 'complete', 'Eligibility cannot pretend the failed ledger write settled');
      assert.equal((await send()).status, 502); assert.equal(budget.state.calls.length, 1, 'Poisoned writer cannot start another call');
    } finally { await relay.close(); budget.close(); }
    const reopened = new DeepseekBudget(stage === 'ledger' ? budget.path + '.reserved' : budget.path);
    try { assert.equal(reopened.spent, budgetPolicy.reservationMicroCny); } finally { reopened.close(); }
  }
});

test('old ledgers are never backfilled and eligible diagnostics cannot settle a reservation after restart', () => {
  const budget = ledger(); const id = budget.reserve(); budget.close();
  const oldBytes = readFileSync(budget.path);
  const reopened = new DeepseekBudget(budget.path);
  try {
    assert.equal(existsSync(budget.path + '.receipts'), false);
    reopened.writeReceipt(id, { ...analyze(sse()), httpStatus: 200, responseBytes: Buffer.byteLength(sse()) });
  } finally { reopened.close(); }
  const again = new DeepseekBudget(budget.path);
  try {
    assert.equal(readReceipt(again).reason, 'complete'); assert.equal(again.state.calls[0]!.usage, null);
    assert.equal(again.spent, budgetPolicy.reservationMicroCny); assert.deepEqual(readFileSync(budget.path), oldBytes);
  } finally { again.close(); }
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
