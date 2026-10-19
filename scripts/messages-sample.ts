import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { digest } from '../src/domain.js';
import { projectRoot } from './dsh-live.js';
import { freezeFiles } from './live-qualification.js';
import { DeepseekBudget, startBudgetRelay, usageReceiptSchema } from './deepseek-budget.js';

export const sampleWork = join(projectRoot, '.probe-work/t017-sample');
export const sampleBudgetPath = join(projectRoot, '.probe-work/t017-budget.json');
export const sampleBody = JSON.stringify({ model: 'deepseek-flash', stream: true, thinking: { type: 'disabled' },
  max_tokens: 16, messages: [{ role: 'user', content: 'Reply only OK.' }] });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const planSchema = z.object({ schemaVersion: z.literal(1), experiment: z.literal('t017-single-messages-sample'),
  budgetMicroCny: z.literal(3_000_000), maxHttpRequests: z.literal(1), receiptVersion: z.literal(2),
  hostRoot: z.string().min(1), dshHome: z.string().min(1), bodyDigest: hash,
  preparedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  frozenFiles: z.record(z.string().min(1), hash).refine(v => Object.keys(v).length > 0),
}).strict();
type SamplePlan = z.infer<typeof planSchema>;

export function prepareSample(work: string, hostRoot: string, dshHome: string, files: string[]): SamplePlan {
  if (existsSync(join(work, 'plan.json')) || existsSync(join(work, 'live-once.json'))) throw new Error('Sample already prepared');
  mkdirSync(work, { recursive: true });
  const now = Date.now();
  const plan = planSchema.parse({ schemaVersion: 1, experiment: 't017-single-messages-sample', budgetMicroCny: 3_000_000,
    maxHttpRequests: 1, receiptVersion: 2, hostRoot, dshHome, bodyDigest: digest(sampleBody),
    preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60 * 60 * 1000).toISOString(), frozenFiles: freezeFiles(files) });
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  writeFileSync(join(work, 'plan-digest.txt'), digest(JSON.stringify(plan)), { flag: 'wx' });
  return plan;
}

export function readSamplePlan(work: string): SamplePlan {
  const plan = planSchema.parse(JSON.parse(readFileSync(join(work, 'plan.json'), 'utf8')));
  if (plan.bodyDigest !== digest(sampleBody) || digest(JSON.stringify(plan)) !== readFileSync(join(work, 'plan-digest.txt'), 'utf8')) throw new Error('Sample plan drift');
  if (Date.now() > Date.parse(plan.expiresAt) || Date.parse(plan.expiresAt) - Date.parse(plan.preparedAt) !== 60 * 60 * 1000) throw new Error('Sample plan expired');
  for (const [path, expected] of Object.entries(plan.frozenFiles)) if (digest(readFileSync(path)) !== expected) throw new Error('Sample source drift');
  return plan;
}

export async function probeSample(work: string, describe: (plan: SamplePlan) => Promise<boolean>): Promise<{ configured: boolean; requests: number }> {
  const plan = readSamplePlan(work); const configured = await describe(plan);
  const result = { configured, requests: 0 };
  writeFileSync(join(work, 'probe.json'), JSON.stringify(result), { flag: 'wx' });
  return result;
}

/** Shared by a fake offline transport and the one explicitly authorized real request. */
export async function runSample(work: string, budgetPath: string, credential: () => Promise<string>, transport: typeof fetch, realModel: boolean) {
  const plan = readSamplePlan(work);
  if (existsSync(join(work, 'report.json'))) throw new Error('Sample report already exists');
  writeFileSync(join(work, 'live-once.json'), JSON.stringify({ startedAt: new Date().toISOString(),
    planDigest: digest(JSON.stringify(plan)), realModel }), { flag: 'wx' });
  const budget = new DeepseekBudget(budgetPath, 't015-snapshot-high-water-v1', 2, plan.budgetMicroCny);
  let relay: Awaited<ReturnType<typeof startBudgetRelay>> | undefined;
  let forwarded = 0; let responseStatus: number | null = null; let receivedBytes = 0;
  let phase: 'response_sampled' | 'sample_failed' = 'sample_failed';
  try {
    const key = await credential();
    if (!key) throw new Error('Credential not configured');
    relay = await startBudgetRelay(budget, async (url, init) => {
      if (url !== 'https://api.deepseek.com/anthropic/v1/messages' || init?.method !== 'POST'
        || Buffer.from(init.body as Uint8Array).toString('utf8') !== sampleBody || ++forwarded !== 1) throw new Error('Sample request drift');
      return transport(url, init);
    }, async () => { readSamplePlan(work); });
    const response = await fetch(relay.baseURL + '/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key }, body: sampleBody, signal: AbortSignal.timeout(65000) });
    responseStatus = response.status;
    if (response.body) for await (const chunk of response.body) {
      receivedBytes += chunk.length; if (receivedBytes > 1024 * 1024) throw new Error('Sample response bound');
    }
    readSamplePlan(work);
    if (response.ok && forwarded === 1) phase = 'response_sampled';
  } catch { /* Never serialize a provider error, request credential or response body. */ }
  finally { await relay?.close(); budget.close(); }
  const call = budget.state.calls[0];
  let receipt: z.infer<typeof usageReceiptSchema> | null = null;
  if (call) {
    try { receipt = usageReceiptSchema.parse(JSON.parse(readFileSync(join(budgetPath + '.receipts', call.id + '.json'), 'utf8'))); }
    catch { phase = 'sample_failed'; }
  }
  if (!receipt || receipt.reason === 'awaiting_response') phase = 'sample_failed';
  const report = { kind: 'single-messages-protocol-sample', realModel, agentLoopUsed: false, benefitEvaluated: false,
    phase, budgetMicroCny: plan.budgetMicroCny, maxHttpRequests: plan.maxHttpRequests, requests: budget.state.calls.length,
    forwarded, responseStatus, receivedBytes, conservativeMicroCny: budget.spent, receipt };
  writeFileSync(join(work, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}

interface CredentialContext {
  plugin(plugin: unknown, options: object): { await(): Promise<void>; dispose(): Promise<void> };
  credentials: { describe(ref: unknown): Promise<{ configured: boolean }>;
    resolve(ref: unknown): Promise<{ value: string } | undefined> };
}
async function officialCredential(plan: SamplePlan, probe: boolean): Promise<string | boolean> {
  const modulePath = (name: string) => pathToFileURL(join(plan.hostRoot, 'node_modules/@deepseek-ai', name, 'lib/index.js')).href;
  const { Context } = await import(modulePath('cordis')) as { Context: new () => CredentialContext };
  const { default: CredentialStore } = await import(modulePath('dsh-credentials-local')) as { default: unknown };
  const { credentialRef } = await import(modulePath('dsh-credentials')) as { credentialRef(name: string): unknown };
  const ctx = new Context();
  const fork = ctx.plugin(CredentialStore, { path: join(plan.dshHome, '.credentials.yaml'), watch: false });
  try {
    await fork.await(); const ref = credentialRef('DEEPSEEK_API_KEY');
    if (probe) return (await ctx.credentials.describe(ref)).configured;
    const result = await ctx.credentials.resolve(ref); if (!result?.value) throw new Error('Credential not configured');
    return result.value;
  } finally { await fork.dispose(); }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === '--prepare') {
    const hostRoot = resolve(process.argv[3]!); const home = resolve(process.argv[4]!);
    const pkg = join(hostRoot, 'node_modules/@deepseek-ai/dsh/package.json');
    if (JSON.parse(readFileSync(pkg, 'utf8')).version !== '0.2.0-rc.2') throw new Error('Unexpected DSH version');
    if (existsSync(sampleBudgetPath)) throw new Error('Sample budget already exists');
    prepareSample(sampleWork, hostRoot, home, [pkg,
      ...['cordis', 'dsh-credentials', 'dsh-credentials-local'].map(name => join(hostRoot, 'node_modules/@deepseek-ai', name, 'lib/index.js')),
      ...['messages-sample', 'deepseek-budget', 'messages-usage', 'live-qualification', 'dsh-live'].map(name => join(projectRoot, 'dist/scripts', name + '.js')),
      join(projectRoot, 'dist/src/domain.js'), join(projectRoot, 'docs/decisions/020-single-messages-sample.md'),
      join(projectRoot, '.probe-work/t011-budget.json'), join(projectRoot, '.probe-work/t015-budget.json')]);
    process.stdout.write('{"phase":"prepared","requests":0,"budgetMicroCny":3000000}\n');
  } else if (mode === '--probe') {
    const result = await probeSample(sampleWork, async plan => Boolean(await officialCredential(plan, true)));
    process.stdout.write(JSON.stringify(result) + '\n'); if (!result.configured) process.exitCode = 1;
  } else if (mode === '--live') {
    const plan = readSamplePlan(sampleWork);
    const report = await runSample(sampleWork, sampleBudgetPath, async () => String(await officialCredential(plan, false)), fetch, true);
    process.stdout.write(JSON.stringify({ phase: report.phase, requests: report.requests, reason: report.receipt?.reason,
      conservativeCny: report.conservativeMicroCny / 1e6 }) + '\n');
    if (report.phase !== 'response_sampled') process.exitCode = 1;
  } else throw new Error('Use --prepare <official-host-root> <dsh-home>, --probe or --live');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { process.stderr.write('Sample command failed; no automatic retry.\n'); process.exitCode = 1; }
}
