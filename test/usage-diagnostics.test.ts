import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeMessagesUsage, diagnoseMessagesUsage, usageDiagnosticSchema } from '../scripts/messages-usage.js';
import { budgetPolicy, DeepseekBudget, startBudgetRelay, usageReceiptSchema } from '../scripts/deepseek-budget.js';

const start = { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } };
const delta = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } };
const stop = { type: 'message_stop' };
const wire = (...events: object[]) => events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('');
const request = { model: 'deepseek-flash', stream: true, max_tokens: 4096, messages: [] };
const send = (baseURL: string) => fetch(baseURL + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'fixture-secret-key' }, body: JSON.stringify(request) });
const receipt = (budget: DeepseekBudget) => usageReceiptSchema.parse(JSON.parse(readFileSync(budget.path + '.receipts/' + budget.state.calls.at(-1)!.id + '.json', 'utf8')));
const fingerprint = (key: string) => createHash('sha256').update('dsh-evolve/usage-field/v1\0' + key).digest('hex');
const fresh = (version: 1 | 2) => new DeepseekBudget(join(mkdtempSync(join(tmpdir(), 'evolve-shape-')), 'budget.json'), 't015-snapshot-high-water-v1', version);

test('the same unsupported_usage reason identifies five fixed rejection locations', () => {
  const cases = [
    [wire({ ...start, usage: null }), 'start_top_level', 'unsupported_location', 'null'],
    [wire({ ...start, message: { usage: { ...start.message.usage, private_field_name: 'private-value' } } }), 'start_message_usage', 'unknown_fields', 'object'],
    [wire(start, { ...delta, usage: { output_tokens: 8, private_field_name: 'private-value' } }), 'delta_usage', 'unknown_fields', 'object'],
    [wire(start, delta, { ...stop, usage: {} }), 'stop_usage', 'unsupported_location', 'object'],
    [wire({ type: 'private-event-name', usage: [] }), 'other_event_usage', 'unsupported_location', 'array'],
  ] as const;
  for (const [body, location, violation, usageType] of cases) {
    const result = diagnoseMessagesUsage(body, budgetPolicy);
    assert.equal(result.reason, 'unsupported_usage'); assert.equal(result.usage, null);
    assert.equal(result.diagnostic?.location, location); assert.equal(result.diagnostic?.violation, violation);
    assert.equal(result.diagnostic?.usageType, usageType);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

test('unknown field fingerprints are bounded, ordered and independent of field values or insertion order', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ['private-field-' + i, { secret: 'private-value-' + i }] as const);
  const analyze = (items: typeof entries) => diagnoseMessagesUsage(wire({ ...start,
    message: { usage: { ...start.message.usage, ...Object.fromEntries(items) } } }), budgetPolicy);
  const first = analyze(entries); const reversed = analyze([...entries].reverse());
  assert.deepEqual(first.diagnostic, reversed.diagnostic);
  assert.equal(first.diagnostic?.unknownFieldCount, 12); assert.equal(first.diagnostic?.omittedFieldCount, 4);
  assert.deepEqual(first.diagnostic?.fieldFingerprints, entries.map(([k]) => fingerprint(k)).sort().slice(0, 8));
  assert.ok(!JSON.stringify(first).includes('private'));
  assert.equal(usageDiagnosticSchema.safeParse({ ...first.diagnostic, fieldFingerprints: Array(9).fill('0'.repeat(64)) }).success, false);
  assert.equal(usageDiagnosticSchema.safeParse({ ...first.diagnostic, fieldName: 'private' }).success, false);
  assert.equal(usageDiagnosticSchema.safeParse({ ...first.diagnostic, omittedFieldCount: 0 }).success, false);
});

test('legacy analysis shape and both counting policies keep the same acceptance and charges', () => {
  const bodies = [wire(start, delta, stop), wire(start, { ...delta, usage: { output_tokens: -1 } }, stop),
    wire({ ...start, usage: {} }), wire(start, delta), wire(start, delta, stop).trimEnd()];
  for (const policy of ['t011-conservative-v1', 't015-snapshot-high-water-v1'] as const) for (const body of bodies) {
    const old = analyzeMessagesUsage(body, budgetPolicy, policy); const current = diagnoseMessagesUsage(body, budgetPolicy, policy);
    assert.deepEqual(Object.keys(old).sort(), ['otherEvents', 'reason', 'snapshots', 'usage']);
    assert.deepEqual({ reason: current.reason, usage: current.usage, snapshots: current.snapshots, otherEvents: current.otherEvents }, old);
    assert.equal(current.diagnostic !== null, current.reason === 'unsupported_usage');
  }
});

test('explicit v2 relay persists only bounded shape details and retains unknown liability', async () => {
  const budget = fresh(2);
  const body = wire({ ...start, message: { usage: { ...start.message.usage, private_field_name: 'private-response' } } }, delta, stop);
  const relay = await startBudgetRelay(budget, async () => {
    const pending = receipt(budget); assert.equal(pending.schemaVersion, 2);
    if (pending.schemaVersion === 2) assert.equal(pending.diagnostic, null);
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  try {
    assert.equal(await (await send(relay.baseURL)).text(), body);
    const result = receipt(budget); assert.equal(result.schemaVersion, 2); assert.equal(result.callId, budget.state.calls[0]!.id);
    assert.equal(result.reason, 'unsupported_usage'); assert.equal(budget.spent, budgetPolicy.reservationMicroCny);
    if (result.schemaVersion === 2) assert.deepEqual(result.diagnostic?.fieldFingerprints, [fingerprint('private_field_name')]);
    assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    assert.equal(usageReceiptSchema.safeParse({ ...result, schemaVersion: 1 }).success, false);
    assert.equal(usageReceiptSchema.safeParse({ ...result, diagnostic: null }).success, false);
  } finally { await relay.close(); budget.close(); }
});

test('v1 remains default and v2 cannot add diagnostics to reservations from an earlier instance', () => {
  const budget = new DeepseekBudget(join(mkdtempSync(join(tmpdir(), 'evolve-default-')), 'budget.json'), 't015-snapshot-high-water-v1');
  const id = budget.reserve();
  const analysis = analyzeMessagesUsage(wire(start, delta, stop), budgetPolicy);
  const input = { ...analysis, httpStatus: 200, responseBytes: 99 };
  budget.writeReceipt(id, input); assert.equal(receipt(budget).schemaVersion, 1); budget.close();
  const path = budget.path + '.receipts/' + id + '.json'; const previous = readFileSync(path);
  const ledger = readFileSync(budget.path);
  const reopened = new DeepseekBudget(budget.path, 't015-snapshot-high-water-v1', 2);
  try { assert.throws(() => reopened.writeReceipt(id, { ...input, diagnostic: null }), /new reservation/i); }
  finally { reopened.close(); }
  assert.deepEqual(readFileSync(path), previous); assert.deepEqual(readFileSync(budget.path), ledger);
  assert.equal(usageReceiptSchema.parse(JSON.parse(previous.toString())).schemaVersion, 1);
});

test('v2 complete receipts settle normally but opening them cannot settle an earlier unknown call', async () => {
  const budget = fresh(2);
  const relay = await startBudgetRelay(budget, async () => new Response(wire(start, delta, stop), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    await (await send(relay.baseURL)).text();
    const result = receipt(budget); assert.equal(result.schemaVersion, 2); assert.equal(result.reason, 'complete');
    if (result.schemaVersion === 2) assert.equal(result.diagnostic, null);
    assert.equal(budget.spent, 12 * 2 + 8 * 8);
    const unknown = budget.reserve();
    budget.writeReceipt(unknown, { ...diagnoseMessagesUsage(wire(start, delta, stop), budgetPolicy), httpStatus: 200, responseBytes: 99 });
  } finally { await relay.close(); budget.close(); }
  const bytes = readFileSync(budget.path);
  const resumed = new DeepseekBudget(budget.path, 't015-snapshot-high-water-v1', 2);
  try { assert.equal(resumed.spent, 88 + budgetPolicy.reservationMicroCny); assert.equal(resumed.state.calls[1]!.usage, null); }
  finally { resumed.close(); }
  assert.deepEqual(readFileSync(budget.path), bytes);
});

test('transport failure overrides partial shape findings and never refunds the reservation', async () => {
  const budget = fresh(2); let pushed = false;
  const relay = await startBudgetRelay(budget, async () => new Response(new ReadableStream({ pull(c) {
    if (!pushed) { pushed = true; c.enqueue(Buffer.from(wire({ ...start, usage: {} }))); }
    else c.error(new Error('private-error-text'));
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    try { await (await send(relay.baseURL)).text(); } catch { /* Expected interrupted HTTP. */ }
    const result = receipt(budget); assert.equal(result.schemaVersion, 2); assert.equal(result.reason, 'transport_error');
    if (result.schemaVersion === 2) assert.equal(result.diagnostic, null);
    assert.equal(budget.spent, budgetPolicy.reservationMicroCny);
    assert.ok(!JSON.stringify(result).includes('private'));
  } finally { await relay.close(); budget.close(); }
});
