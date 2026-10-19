import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';

// Experiment infrastructure, not a plugin setting or a provider billing API.
export const budgetPolicy = Object.freeze({ budgetMicroCny: 5_000_000, maxCalls: 16,
  maxInputTokens: 1_100_000, maxOutputTokens: 4096, inputMicroCny: 2, outputMicroCny: 8,
  reservationMicroCny: 2_232_768, model: 'deepseek-flash', maxRequestBytes: 256 * 1024 });
const usageSchema = z.object({ input: z.number().int().min(0).max(budgetPolicy.maxInputTokens),
  output: z.number().int().min(0).max(budgetPolicy.maxOutputTokens) }).strict();
const callSchema = z.object({ id: z.string().uuid(), chargedMicroCny: z.number().int().min(0),
  usage: usageSchema.nullable(), createdAt: z.string().datetime() }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), budgetMicroCny: z.literal(5_000_000),
  calls: z.array(callSchema).max(16) }).strict();
export type BudgetState = z.infer<typeof stateSchema>;

export class DeepseekBudget {
  readonly state: BudgetState;
  private readonly lock: number;
  private closed = false;
  private poisoned = false;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.lock = openSync(path + '.lock', 'wx');
    try {
      this.state = existsSync(path) ? stateSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        : { schemaVersion: 1, budgetMicroCny: 5_000_000, calls: [] };
      if (this.state.calls.some((c) => c.chargedMicroCny !== (c.usage ? c.usage.input * 2 + c.usage.output * 8 : budgetPolicy.reservationMicroCny))
        || this.spent > budgetPolicy.budgetMicroCny) throw new Error('Invalid budget accounting');
      if (!existsSync(path)) this.persist();
    } catch (error) { closeSync(this.lock); unlinkSync(path + '.lock'); throw error; }
  }
  get spent(): number { return this.state.calls.reduce((sum, call) => sum + call.chargedMicroCny, 0); }
  private persist(): void {
    if (this.closed || this.poisoned) throw new Error('Budget closed or persistence failed');
    try {
      const temp = this.path + '.' + randomUUID(); const fd = openSync(temp, 'wx');
      try { writeFileSync(fd, JSON.stringify(this.state, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.path);
    } catch (error) { this.poisoned = true; throw error; }
  }
  reserve(): string {
    if (this.closed || this.poisoned) throw new Error('Budget unavailable');
    if (this.state.calls.length >= budgetPolicy.maxCalls || this.spent + budgetPolicy.reservationMicroCny > budgetPolicy.budgetMicroCny) throw new Error('Budget exhausted');
    const id = randomUUID();
    this.state.calls.push({ id, chargedMicroCny: budgetPolicy.reservationMicroCny, usage: null, createdAt: new Date().toISOString() });
    this.persist(); return id;
  }
  settle(id: string, input: unknown): void {
    const usage = usageSchema.parse(input); const call = this.state.calls.find((c) => c.id === id);
    if (!call || call.usage) throw new Error('Unknown or settled budget call');
    call.usage = usage; call.chargedMicroCny = usage.input * 2 + usage.output * 8; this.persist();
  }
  close(): void { if (!this.closed) { this.closed = true; closeSync(this.lock); unlinkSync(this.path + '.lock'); } }
}

export function settledMessagesUsage(body: string): z.infer<typeof usageSchema> | null {
  let started = false; let stopped = false; let final = false; let finalOutput = false; let input: number | undefined; let output: number | undefined;
  let cached = 0; let written = 0;
  try {
    for (const frame of body.replace(/\r\n/g, '\n').split('\n\n')) {
      const lines = frame.split('\n').filter((line) => line.startsWith('data:'));
      if (!lines.length) continue;
      if (stopped) return null;
      const event = JSON.parse(lines.map((line) => line.slice(5).trimStart()).join('\n')) as Record<string, unknown>;
      if (event.type === 'error') return null;
      if (event.type === 'message_start') {
        if (started) return null; started = true;
        const usage = (event.message as { usage?: Record<string, unknown> })?.usage;
        if (!usage || !Number.isSafeInteger(usage.input_tokens) || Number(usage.input_tokens) < 0
          || !Number.isSafeInteger(usage.output_tokens) || Number(usage.output_tokens) < 0 || Number(usage.output_tokens) > budgetPolicy.maxOutputTokens) return null;
        input = Number(usage.input_tokens); output = Number(usage.output_tokens);
        for (const key of ['cache_read_input_tokens', 'cache_creation_input_tokens']) {
          const value = usage[key] ?? 0; if (!Number.isSafeInteger(value) || Number(value) < 0) return null;
          if (key === 'cache_read_input_tokens') cached = Number(value); else written = Number(value);
        }
      } else if (event.type === 'message_delta') {
        if (!started) return null;
        const usage = event.usage as Record<string, unknown> | undefined;
        if (usage) for (const [key, previous] of [['input_tokens', input], ['cache_read_input_tokens', cached], ['cache_creation_input_tokens', written]] as const) {
          if (usage[key] === undefined) continue;
          const next = Number(usage[key]); if (!Number.isSafeInteger(usage[key]) || next < (previous ?? 0)) return null;
          if (key === 'input_tokens') input = next; else if (key === 'cache_read_input_tokens') cached = next; else written = next;
        }
        if (usage?.output_tokens !== undefined) {
          if (!Number.isSafeInteger(usage.output_tokens) || Number(usage.output_tokens) < (output ?? 0)) return null;
          output = Number(usage.output_tokens);
        }
        const delta = event.delta as { stop_reason?: unknown } | undefined;
        if (delta?.stop_reason) { if (final || !['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'].includes(String(delta.stop_reason))) return null; final = true; finalOutput = usage?.output_tokens !== undefined; }
      } else if (event.type === 'message_stop') { if (!started || !final) return null; stopped = true; }
    }
    if (!stopped || !finalOutput || input === undefined || output === undefined) return null;
    return usageSchema.parse({ input: input + cached + written, output });
  } catch { return null; }
}

export async function startBudgetRelay(budget: DeepseekBudget, transport: typeof fetch = fetch): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const path = '/run-' + randomUUID(); let active = false;
  const server = createServer(async (req, res) => {
    const fail = (status: number): void => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"experiment_request_rejected"}'); } else res.destroy(); };
    if (req.method !== 'POST' || req.url !== path + '/v1/messages' || active) { fail(429); return; }
    active = true; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60000);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > budgetPolicy.maxRequestBytes) throw new Error('Request bound'); chunks.push(chunk); }
      const raw = Buffer.concat(chunks); const body = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (body.model !== budgetPolicy.model || body.stream !== true || !Number.isSafeInteger(body.max_tokens)
        || Number(body.max_tokens) < 1 || Number(body.max_tokens) > budgetPolicy.maxOutputTokens || !Array.isArray(body.messages)
        || /"type"\s*:\s*"(?:image|file|document|server_tool_use|web_search[^"\\]*)"/.test(raw.toString())
        || (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some((t: Record<string, unknown>) => t.type !== undefined
          || !['evolve_begin_task', 'evolve_finish_task', 'evolve_record_correction', 'evolve_propose_experience', 'evolve_verify_experience', 'evolve_link_fact_evidence'].includes(String(t.name)))))) throw new Error('Request policy');
      const key = req.headers['x-api-key']; if (typeof key !== 'string' || !key) throw new Error('Missing request credential');
      const id = budget.reserve(); // Commit cost liability before any network call, including failed calls.
      const response = await transport('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          ...(typeof req.headers['anthropic-beta'] === 'string' ? { 'anthropic-beta': req.headers['anthropic-beta'] } : {}) },
        redirect: 'error', signal: controller.signal });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { fail(502); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const result: Buffer[] = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Response bound'); const data = Buffer.from(chunk); result.push(data); res.write(data); }
      const usage = settledMessagesUsage(Buffer.concat(result).toString('utf8'));
      if (usage) budget.settle(id, usage);
      res.end();
    } catch { fail(502); } finally { clearTimeout(timer); active = false; }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Relay address');
  return { baseURL: `http://127.0.0.1:${address.port}${path}`, close: () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
