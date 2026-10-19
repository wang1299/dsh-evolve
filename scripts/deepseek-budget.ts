import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';
import { analyzeMessagesUsage, diagnoseMessagesUsage, snapshotSchema, usageDiagnosticSchema, usageReasons, type UsageReason } from './messages-usage.js';

// Experiment infrastructure, not a plugin setting or a provider billing API.
export const budgetPolicy = Object.freeze({ budgetMicroCny: 5_000_000, maxCalls: 16,
  maxInputTokens: 1_100_000, maxOutputTokens: 4096, inputMicroCny: 2, outputMicroCny: 8,
  reservationMicroCny: 2_232_768, model: 'deepseek-flash', maxRequestBytes: 256 * 1024 });
const usageSchema = z.object({ input: z.number().int().min(0).max(budgetPolicy.maxInputTokens),
  output: z.number().int().min(0).max(budgetPolicy.maxOutputTokens) }).strict();
const callSchema = z.object({ id: z.string().uuid(), chargedMicroCny: z.number().int().min(0),
  usage: usageSchema.nullable(), createdAt: z.string().datetime() }).strict();
const originalStateSchema = z.object({ schemaVersion: z.literal(1), budgetMicroCny: z.literal(5_000_000),
  calls: z.array(callSchema).max(16) }).strict();
const supplementalStateSchema = originalStateSchema.extend({ schemaVersion: z.literal(2), policyId: z.literal('t015-snapshot-high-water-v1') });
const stateSchema = z.union([originalStateSchema, supplementalStateSchema]);
export type BudgetState = z.infer<typeof stateSchema>;
const receiptInputSchema = z.object({ reason: z.enum(usageReasons), httpStatus: z.number().int().min(100).max(599).nullable(),
  responseBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), snapshots: z.array(snapshotSchema).max(64),
  otherEvents: z.number().int().min(0).max(1024 * 1024), usage: usageSchema.nullable() }).strict()
  .refine((r) => (r.reason === 'complete') === (r.usage !== null), 'Only complete usage can be eligible');
const identityShape = { callId: z.string().uuid(), policyId: z.enum(['t011-conservative-v1', 't015-snapshot-high-water-v1']), model: z.literal('deepseek-flash') };
const legacyUsageReceiptSchema = receiptInputSchema.safeExtend({ schemaVersion: z.literal(1), ...identityShape });
const diagnosticReceiptInputSchema = receiptInputSchema.safeExtend({ diagnostic: usageDiagnosticSchema.nullable() })
  .refine(r => (r.reason === 'unsupported_usage') === (r.diagnostic !== null), 'Only unsupported usage has a shape diagnostic');
const diagnosticUsageReceiptSchema = diagnosticReceiptInputSchema.safeExtend({ schemaVersion: z.literal(2), ...identityShape });
export const usageReceiptSchema = z.union([legacyUsageReceiptSchema, diagnosticUsageReceiptSchema]);

export class DeepseekBudget {
  readonly state: BudgetState;
  private readonly lock: number;
  private closed = false;
  private poisoned = false;
  private readonly freshReservations = new Set<string>();
  constructor(readonly path: string, readonly policyId: 't011-conservative-v1' | 't015-snapshot-high-water-v1' = 't011-conservative-v1',
    readonly receiptVersion: 1 | 2 = 1) {
    if (receiptVersion !== 1 && receiptVersion !== 2) throw new Error('Unsupported receipt version');
    mkdirSync(dirname(path), { recursive: true });
    this.lock = openSync(path + '.lock', 'wx');
    try {
      this.state = existsSync(path) ? stateSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        : policyId === 't011-conservative-v1' ? { schemaVersion: 1, budgetMicroCny: 5_000_000, calls: [] }
          : { schemaVersion: 2, policyId, budgetMicroCny: 5_000_000, calls: [] };
      if ((this.state.schemaVersion === 1 ? 't011-conservative-v1' : this.state.policyId) !== policyId) throw new Error('Budget policy mismatch');
      if (this.state.calls.some((c) => c.chargedMicroCny !== (c.usage ? c.usage.input * 2 + c.usage.output * 8 : budgetPolicy.reservationMicroCny))
        || this.spent > budgetPolicy.budgetMicroCny) throw new Error('Invalid budget accounting');
      if (!existsSync(path)) this.persist();
    } catch (error) { closeSync(this.lock); unlinkSync(path + '.lock'); throw error; }
  }
  get spent(): number { return this.state.calls.reduce((sum, call) => sum + call.chargedMicroCny, 0); }
  private persist(): void { this.write(this.path, this.state); }
  private write(path: string, value: unknown): void {
    if (this.closed || this.poisoned) throw new Error('Budget closed or persistence failed');
    try {
      mkdirSync(dirname(path), { recursive: true });
      const temp = path + '.' + randomUUID(); const fd = openSync(temp, 'wx');
      try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, path);
    } catch (error) { this.poisoned = true; throw error; }
  }
  writeReceipt(id: string, input: unknown): void {
    if (!this.state.calls.some((call) => call.id === id)) throw new Error('Unknown budget call');
    if (this.receiptVersion === 2 && !this.freshReservations.has(id)) throw new Error('Diagnostics require a new reservation from this instance');
    const identity = { callId: id, policyId: this.policyId, model: budgetPolicy.model };
    const receipt = this.receiptVersion === 1
      ? legacyUsageReceiptSchema.parse({ ...receiptInputSchema.parse(input), schemaVersion: 1, ...identity })
      : diagnosticUsageReceiptSchema.parse({ ...diagnosticReceiptInputSchema.parse(input), schemaVersion: 2, ...identity });
    this.write(join(this.path + '.receipts', id + '.json'), receipt);
  }
  reserve(): string {
    if (this.closed || this.poisoned) throw new Error('Budget unavailable');
    if (this.state.calls.length >= budgetPolicy.maxCalls || this.spent + budgetPolicy.reservationMicroCny > budgetPolicy.budgetMicroCny) throw new Error('Budget exhausted');
    const id = randomUUID();
    this.state.calls.push({ id, chargedMicroCny: budgetPolicy.reservationMicroCny, usage: null, createdAt: new Date().toISOString() });
    this.persist(); this.freshReservations.add(id); return id;
  }
  settle(id: string, input: unknown): void {
    const usage = usageSchema.parse(input); const call = this.state.calls.find((c) => c.id === id);
    if (!call || call.usage) throw new Error('Unknown or settled budget call');
    const previousCharge = call.chargedMicroCny;
    call.usage = usage; call.chargedMicroCny = usage.input * 2 + usage.output * 8;
    try { this.persist(); }
    catch (error) { call.usage = null; call.chargedMicroCny = previousCharge; throw error; }
  }
  close(): void { if (!this.closed) { this.closed = true; closeSync(this.lock); unlinkSync(this.path + '.lock'); } }
}

export function settledMessagesUsage(body: string): z.infer<typeof usageSchema> | null {
  return analyzeMessagesUsage(body, budgetPolicy).usage;
}

export async function startBudgetRelay(budget: DeepseekBudget, transport: typeof fetch = fetch,
  beforeForward: () => Promise<void> = async () => {}): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const path = '/run-' + randomUUID(); let active = false;
  const server = createServer(async (req, res) => {
    const fail = (status: number): void => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"experiment_request_rejected"}'); } else res.destroy(); };
    if (req.method !== 'POST' || req.url !== path + '/v1/messages' || active) { fail(429); return; }
    active = true; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60000);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let id: string | undefined; let httpStatus: number | null = null; let responseBytes = 0;
    const result: Buffer[] = []; let failure: UsageReason = 'transport_error'; let terminalReceipt = false;
    const receipt = (reason?: UsageReason): z.infer<typeof usageSchema> | null => {
      const body = Buffer.concat(result).toString('utf8');
      const analysis = budget.receiptVersion === 2 ? diagnoseMessagesUsage(body, budgetPolicy, budget.policyId)
        : analyzeMessagesUsage(body, budgetPolicy, budget.policyId);
      const usage = reason ? null : analysis.usage;
      budget.writeReceipt(id!, { ...analysis, ...(reason ? { reason, ...('diagnostic' in analysis ? { diagnostic: null } : {}) } : {}), usage, httpStatus, responseBytes });
      terminalReceipt = reason !== 'awaiting_response';
      return usage;
    };
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
      await beforeForward(); // Recheck frozen acceptance before each reservation and paid HTTP.
      id = budget.reserve(); // Commit cost liability before any network call, including failed calls.
      receipt('awaiting_response'); // A failed diagnostic write must prevent forwarding.
      const response = await transport('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          ...(typeof req.headers['anthropic-beta'] === 'string' ? { 'anthropic-beta': req.headers['anthropic-beta'] } : {}) },
        redirect: 'error', signal: controller.signal });
      httpStatus = response.status;
      if (!response.ok) { receipt('http_rejected'); await response.body?.cancel(); fail(502); return; }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { receipt('missing_sse'); await response.body?.cancel(); fail(502); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      for await (const chunk of response.body) {
        responseBytes += chunk.length;
        if (responseBytes > 1024 * 1024) { failure = 'response_bound'; throw new Error('Response bound'); }
        const data = Buffer.from(chunk); result.push(data); res.write(data);
      }
      if (controller.signal.aborted) throw new Error('Interrupted stream');
      const usage = receipt();
      if (usage) budget.settle(id, usage);
      res.end();
    } catch {
      if (id && !terminalReceipt) { try { receipt(failure); } catch { /* Liability is already durable; a poisoned writer cannot reopen budget. */ } }
      fail(502);
    } finally { clearTimeout(timer); active = false; }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Relay address');
  return { baseURL: `http://127.0.0.1:${address.port}${path}`, close: () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
