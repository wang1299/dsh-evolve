import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeMessagesUsage, diagnoseMessagesUsage } from '../scripts/messages-usage.js';
import { budgetPolicy, DeepseekBudget, startBudgetRelay, usageReceiptSchema } from '../scripts/deepseek-budget.js';

const policy = 't018-standard-tier-v1';
const limits = { maxInputTokens: 1_100_000, maxOutputTokens: 4096 };
const start = { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20, service_tier: 'standard' } } };
const delta = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, cache_read_input_tokens: 110, output_tokens: 8, service_tier: 'standard' } };
const stop = { type: 'message_stop' };
const wire = (...events: object[]) => events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('');

test('explicit standard-tier policy accepts the documented metadata while preserving input high water', () => {
  const result = analyzeMessagesUsage(wire(start, delta, stop), limits, policy);
  assert.equal(result.reason, 'complete');
  assert.deepEqual(result.usage, { input: 120, output: 8 });
  assert.deepEqual(analyzeMessagesUsage(wire(start, { type: 'message_delta', usage: { input_tokens: 200, output_tokens: 4 } },
    delta, stop), limits, policy).usage, { input: 220, output: 8 });
});

test('missing tier stays supported and historical policies still reject standard metadata', () => {
  const bare = wire({ ...start, message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20 } } },
    { ...delta, usage: { output_tokens: 8 } }, stop);
  for (const old of ['t011-conservative-v1', 't015-snapshot-high-water-v1'] as const) {
    assert.equal(analyzeMessagesUsage(wire(start, delta, stop), limits, old).reason, 'unsupported_usage');
    assert.deepEqual(analyzeMessagesUsage(bare, limits, policy), analyzeMessagesUsage(bare, limits, old));
  }
  assert.equal(analyzeMessagesUsage(wire(start, delta, stop), limits).reason, 'unsupported_usage');
});

test('unsupported tiers at either allowed location retain liability without disclosing values', () => {
  for (const service_tier of [null, 'priority', '', 'Standard', 0, true, [], { private: 'fixture-private-value' }]) {
    for (const body of [wire({ ...start, message: { usage: { ...start.message.usage, service_tier } } }, delta, stop),
      wire(start, { ...delta, usage: { ...delta.usage, service_tier } }, stop)]) {
      const result = diagnoseMessagesUsage(body, limits, policy);
      assert.equal(result.reason, 'unsupported_service_tier'); assert.equal(result.usage, null); assert.equal(result.diagnostic, null);
      assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('"service_tier":'));
    }
  }
});

test('accepted metadata is excluded from unknown-field diagnostics but never enables usage elsewhere', () => {
  const hash = createHash('sha256').update('dsh-evolve/usage-field/v1\0private_extra').digest('hex');
  for (const body of [wire({ ...start, message: { usage: { ...start.message.usage, private_extra: 'fixture-private' } } }, delta, stop),
    wire(start, { ...delta, usage: { ...delta.usage, private_extra: 'fixture-private' } }, stop)]) {
    const result = diagnoseMessagesUsage(body, limits, policy);
    assert.equal(result.reason, 'unsupported_usage'); assert.equal(result.diagnostic?.unknownFieldCount, 1);
    assert.deepEqual(result.diagnostic?.fieldFingerprints, [hash]); assert.ok(!JSON.stringify(result).includes('private'));
  }
  for (const body of [wire({ ...start, usage: { service_tier: 'standard' } }, delta, stop),
    wire(start, delta, { ...stop, usage: { service_tier: 'standard' } }),
    wire(start, { type: 'ping', usage: { service_tier: 'standard' } }, delta, stop)]) {
    assert.equal(diagnoseMessagesUsage(body, limits, policy).diagnostic?.violation, 'unsupported_location');
  }
});

test('tier support does not relax counter bounds or complete-stream requirements', () => {
  const cases = [
    [wire(start, { ...delta, usage: { service_tier: 'standard' } }, stop), 'missing_final_output'],
    [wire(start, delta), 'missing_stop'],
    [wire(start, delta, stop).trimEnd(), 'incomplete_frame'],
    [wire(start, delta, stop, stop), 'event_after_stop'],
    [wire(start, { type: 'message_delta', usage: { output_tokens: 9 } }, delta, stop), 'counter_decreased'],
    [wire(start, { ...delta, usage: { output_tokens: -1, service_tier: 'standard' } }, stop), 'invalid_delta_usage'],
    [wire(start, { ...delta, usage: { output_tokens: 4097, service_tier: 'standard' } }, stop), 'usage_bounds'],
    [wire({ ...start, message: { usage: { ...start.message.usage, input_tokens: 1_100_000 } } }, delta, stop), 'usage_bounds'],
  ] as const;
  for (const [body, reason] of cases) {
    const result = analyzeMessagesUsage(body, limits, policy); assert.equal(result.reason, reason); assert.equal(result.usage, null);
  }
});

const fresh = (single?: number) => new DeepseekBudget(join(mkdtempSync(join(tmpdir(), 'evolve-tier-')), 'budget.json'), policy, 2, single);
const receipt = (budget: DeepseekBudget) => usageReceiptSchema.parse(JSON.parse(readFileSync(budget.path + '.receipts/' + budget.state.calls.at(-1)!.id + '.json', 'utf8')));
const send = (baseURL: string) => fetch(baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fixture-private-key' },
  body: JSON.stringify({ model: 'deepseek-flash', stream: true, max_tokens: 4096, messages: [] }) });

test('policy identity survives both new ledger formats and refuses mixed or unsupported opens', () => {
  for (const cap of [undefined, 3_000_000]) {
    const budget = fresh(cap); const id = budget.reserve(); budget.settle(id, { input: 12, output: 8 }); budget.close();
    const original = readFileSync(budget.path);
    assert.throws(() => new DeepseekBudget(budget.path, policy), /receipt version 2/i);
    for (const old of ['t011-conservative-v1', 't015-snapshot-high-water-v1'] as const)
      assert.throws(() => new DeepseekBudget(budget.path, old, 2, cap), /policy/i);
    const reopened = new DeepseekBudget(budget.path, policy, 2, cap);
    try {
      assert.equal(reopened.spent, 88); assert.equal(reopened.state.schemaVersion, cap === undefined ? 2 : 3);
      if (cap !== undefined) assert.throws(() => reopened.reserve(), /exhausted/i);
    } finally { reopened.close(); }
    assert.deepEqual(readFileSync(budget.path), original);
  }
  for (const old of ['t011-conservative-v1', 't015-snapshot-high-water-v1'] as const) {
    const path = join(mkdtempSync(join(tmpdir(), 'evolve-old-tier-')), 'budget.json');
    new DeepseekBudget(path, old).close(); const bytes = readFileSync(path);
    assert.throws(() => new DeepseekBudget(path, policy, 2), /policy/i); assert.deepEqual(readFileSync(path), bytes);
  }
  const path = join(mkdtempSync(join(tmpdir(), 'evolve-invalid-tier-')), 'absent', 'budget.json');
  assert.throws(() => new DeepseekBudget(path, 'fixture-unknown-policy' as never, 2), /Unsupported budget policy/);
  assert.equal(existsSync(join(path, '..')), false);
});

test('relay settles only under the explicit v2 identity and keeps tier metadata out of persisted receipts', async () => {
  const budget = fresh(); const body = wire(start, delta, stop);
  const relay = await startBudgetRelay(budget, async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  try {
    assert.equal(await (await send(relay.baseURL)).text(), body);
    const result = receipt(budget); assert.equal(result.policyId, policy); assert.equal(result.schemaVersion, 2);
    assert.equal(result.reason, 'complete'); assert.deepEqual(result.usage, { input: 120, output: 8 });
    assert.equal(budget.spent, 304); assert.ok(!JSON.stringify(result).includes('service_tier'));
    assert.ok(!JSON.stringify(result).includes('fixture-private'));
    assert.equal(usageReceiptSchema.safeParse({ ...result, schemaVersion: 1, diagnostic: undefined }).success, false);
    for (const policyId of ['t011-conservative-v1', 't015-snapshot-high-water-v1'])
      assert.equal(usageReceiptSchema.safeParse({ ...result, policyId, reason: 'unsupported_service_tier', usage: null }).success, false);
  } finally { await relay.close(); budget.close(); }
});

test('tier, unknown-field, incomplete and transport failures persist new identity with full unknown reservation', async () => {
  for (const kind of ['tier', 'extra', 'missing', 'http', 'stream'] as const) {
    const budget = fresh(); let pushed = false;
    const relay = await startBudgetRelay(budget, async () => {
      if (kind === 'http') return new Response('fixture-private-http-error', { status: 402 });
      if (kind === 'stream') return new Response(new ReadableStream({ pull(c) {
        if (!pushed) { pushed = true; c.enqueue(Buffer.from(wire(start))); } else c.error(new Error('fixture-private-stream-error'));
      } }), { headers: { 'content-type': 'text/event-stream' } });
      const body = kind === 'tier' ? wire(start, { ...delta, usage: { ...delta.usage, service_tier: 'fixture-private-tier' } }, stop)
        : kind === 'extra' ? wire(start, { ...delta, usage: { ...delta.usage, private_extra: 'fixture-private-value' } }, stop)
          : wire(start, delta);
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    try {
      try { await (await send(relay.baseURL)).text(); } catch { /* Interrupted loopback response is expected. */ }
      const result = receipt(budget); assert.equal(result.policyId, policy);
      assert.equal(result.reason, { tier: 'unsupported_service_tier', extra: 'unsupported_usage', missing: 'missing_stop', http: 'http_rejected', stream: 'transport_error' }[kind]);
      assert.equal(result.usage, null); assert.equal(budget.spent, budgetPolicy.reservationMicroCny);
      assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('"service_tier":'));
    } finally { await relay.close(); budget.close(); }
    const reopened = new DeepseekBudget(budget.path, policy, 2);
    try { assert.equal(reopened.spent, budgetPolicy.reservationMicroCny); assert.equal(reopened.state.calls[0]!.usage, null); }
    finally { reopened.close(); }
  }
});
