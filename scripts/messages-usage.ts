import { z } from 'zod';

const stopReasons = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'] as const;
export const usageReasons = ['awaiting_response', 'complete', 'http_rejected', 'missing_sse', 'transport_error', 'response_bound',
  'invalid_json', 'incomplete_frame', 'event_after_stop', 'duplicate_start', 'delta_before_start', 'invalid_start_usage',
  'invalid_delta_usage', 'counter_decreased', 'invalid_final', 'stop_before_final', 'missing_stop', 'missing_final_output',
  'usage_bounds', 'receipt_limit', 'unsupported_usage', 'provider_error'] as const;
const counter = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable();
export const snapshotSchema = z.object({ type: z.enum(['message_start', 'message_delta', 'message_stop', 'error']),
  input: counter, output: counter, cacheRead: counter, cacheWrite: counter,
  stopReason: z.enum([...stopReasons, 'unknown']).nullable() }).strict();
export type UsageSnapshot = z.infer<typeof snapshotSchema>;
export type UsageReason = typeof usageReasons[number];
export type UsageAnalysis = { reason: UsageReason; usage: { input: number; output: number } | null;
  snapshots: UsageSnapshot[]; otherEvents: number };
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const numeric = (value: unknown): number | null => Number.isSafeInteger(value) ? Number(value) : null;
const fields = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;

/** Usage diagnostics only: no provider text, arbitrary field names or identifiers escape. */
export function analyzeMessagesUsage(body: string, limits: { maxInputTokens: number; maxOutputTokens: number },
  policy: 't011-conservative-v1' | 't015-snapshot-high-water-v1' = 't011-conservative-v1'): UsageAnalysis {
  const snapshots: UsageSnapshot[] = []; let otherEvents = 0;
  const result = (reason: UsageReason, usage: UsageAnalysis['usage'] = null): UsageAnalysis => ({ reason, usage, snapshots, otherEvents });
  if (Buffer.byteLength(body) > 1024 * 1024) return result('response_bound');
  let started = false; let stopped = false; let final = false; let finalOutput = false;
  let input = 0; let output = 0; let cached = 0; let written = 0; let inputHighWater = 0;
  const normalized = body.replace(/\r\n|\r/g, '\n'); const frames = normalized.split('\n\n');
  const tail = frames.pop()!;
  try {
    for (const frame of frames) {
      const lines = frame.split('\n').filter((line) => line.startsWith('data:'));
      if (!lines.length) continue;
      if (stopped) return result('event_after_stop');
      const event = object(JSON.parse(lines.map((line) => line.slice(5).trimStart()).join('\n')));
      if (!event) return result('invalid_json');
      const kind = event.type;
      if (kind !== 'message_start' && kind !== 'message_delta' && kind !== 'message_stop' && kind !== 'error') {
        otherEvents++; if (event.usage !== undefined) return result('unsupported_usage'); continue;
      }
      if (snapshots.length === 64) return result('receipt_limit');
      const usage = object(kind === 'message_start' ? object(event.message)?.usage : event.usage);
      const stop = object(event.delta)?.stop_reason;
      snapshots.push({ type: kind, input: numeric(usage?.input_tokens), output: numeric(usage?.output_tokens),
        cacheRead: numeric(usage?.cache_read_input_tokens), cacheWrite: numeric(usage?.cache_creation_input_tokens),
        stopReason: stop == null ? null : stopReasons.includes(stop as typeof stopReasons[number]) ? stop as typeof stopReasons[number] : 'unknown' });
      if (kind === 'error') return result('provider_error');
      if ((kind === 'message_start' || kind === 'message_stop') && event.usage !== undefined) return result('unsupported_usage');
      if (usage && Object.keys(usage).some((key) => !fields.includes(key as typeof fields[number]))) return result('unsupported_usage');
      if (kind === 'message_start') {
        if (started) return result('duplicate_start'); started = true;
        if (!usage || !Number.isSafeInteger(usage.input_tokens) || Number(usage.input_tokens) < 0
          || !Number.isSafeInteger(usage.output_tokens) || Number(usage.output_tokens) < 0 || Number(usage.output_tokens) > limits.maxOutputTokens) return result('invalid_start_usage');
        input = Number(usage.input_tokens); output = Number(usage.output_tokens);
        for (const key of ['cache_read_input_tokens', 'cache_creation_input_tokens']) {
          const value = usage[key] === undefined ? 0 : usage[key]; if (!Number.isSafeInteger(value) || Number(value) < 0) return result('invalid_start_usage');
          if (key === 'cache_read_input_tokens') cached = Number(value); else written = Number(value);
        }
      } else if (kind === 'message_delta') {
        if (!started) return result('delta_before_start');
        if (event.usage !== undefined && !usage) return result('invalid_delta_usage');
        if (usage) for (const [key, previous] of [['input_tokens', input], ['output_tokens', output], ['cache_read_input_tokens', cached], ['cache_creation_input_tokens', written]] as const) {
          if (usage[key] === undefined) continue;
          const next = numeric(usage[key]); if (next === null || next < 0) return result('invalid_delta_usage');
          if (next < previous && (policy === 't011-conservative-v1' || key === 'output_tokens')) return result('counter_decreased');
          if (key === 'input_tokens') input = next; else if (key === 'output_tokens') output = next;
          else if (key === 'cache_read_input_tokens') cached = next; else written = next;
        }
        if (stop != null) {
          if (final || !stopReasons.includes(stop as typeof stopReasons[number])) return result('invalid_final');
          final = true; finalOutput = usage?.output_tokens !== undefined;
        }
      } else if (kind === 'message_stop') {
        if (!started || !final) return result('stop_before_final'); stopped = true;
      }
      if (input + cached + written > limits.maxInputTokens || output > limits.maxOutputTokens) return result('usage_bounds');
      inputHighWater = Math.max(inputHighWater, input + cached + written);
    }
    if (tail.split('\n').some((line) => line.startsWith('data:'))) return result('incomplete_frame');
    if (!stopped) return result('missing_stop');
    if (!finalOutput) return result('missing_final_output');
    return result('complete', { input: inputHighWater, output });
  } catch { return result('invalid_json'); }
}
