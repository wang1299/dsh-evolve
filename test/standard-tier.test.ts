import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessagesUsage } from '../scripts/messages-usage.js';

const policy = 't018-standard-tier-v1' as Parameters<typeof analyzeMessagesUsage>[2];
const limits = { maxInputTokens: 1_100_000, maxOutputTokens: 4096 };
const start = { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20, service_tier: 'standard' } } };
const delta = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, cache_read_input_tokens: 110, output_tokens: 8, service_tier: 'standard' } };
const stop = { type: 'message_stop' };
const wire = (...events: object[]) => events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('');

test('explicit standard-tier policy accepts the documented metadata while preserving input high water', () => {
  const result = analyzeMessagesUsage(wire(start, delta, stop), limits, policy);
  assert.equal(result.reason, 'complete');
  assert.deepEqual(result.usage, { input: 120, output: 8 });
});
