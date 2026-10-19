import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { DeepseekBudget, budgetPolicy, usageReceiptSchema } from '../scripts/deepseek-budget.js';
import { prepareSample, probeSample, readSamplePlan, runSample, sampleBody, sampleBudgetPath, sampleWork } from '../scripts/messages-sample.js';
import { projectRoot } from '../scripts/dsh-live.js';

function prepared() {
  const root = mkdtempSync(join(tmpdir(), 'evolve-messages-sample-')); const work = join(root, 'sample');
  const file = join(root, 'synthetic-source.txt'); writeFileSync(file, 'synthetic source');
  prepareSample(work, join(root, 'fake-host'), join(root, 'fake-home'), [file]);
  return { root, work, file, budget: join(root, 'budget.json') };
}
const sse = (extra: object = {}) => [
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, ...extra } } },
  { type: 'content_block_delta', delta: { text: 'private-response-body' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('');

test('minimal sample issues exactly the fixed request, discards response text and cannot run twice', async () => {
  const f = prepared(); let credentials = 0; let requests = 0;
  const key = async () => { credentials++; return 'private-fake-key'; };
  const transport: typeof fetch = async (url, init) => {
    requests++; assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages'); assert.equal(init?.redirect, 'error');
    assert.equal(Buffer.from(init!.body as Uint8Array).toString(), sampleBody);
    const state = JSON.parse(readFileSync(f.budget, 'utf8'));
    assert.equal(state.schemaVersion, 3); assert.equal(state.budgetMicroCny, 3_000_000); assert.equal(state.calls.length, 1);
    return new Response(sse(), { headers: { 'content-type': 'text/event-stream' } });
  };
  const report = await runSample(f.work, f.budget, key, transport, false) as { phase: string; conservativeMicroCny: number; realModel: boolean };
  assert.equal(report.phase, 'response_sampled'); assert.equal(report.conservativeMicroCny, 36); assert.equal(report.realModel, false);
  assert.ok(!JSON.stringify(report).includes('private'));
  assert.deepEqual(readdirSync(f.work).sort(), ['live-once.json', 'plan-digest.txt', 'plan.json', 'report.json']);
  await assert.rejects(runSample(f.work, f.budget, key, transport, false), /already exists|EEXIST/);
  assert.equal(credentials, 1); assert.equal(requests, 1);
});

test('unknown usage still produces a v2 structural sample with full liability and no repeat after restart', async () => {
  const f = prepared();
  await runSample(f.work, f.budget, async () => 'fake', async () => new Response(sse({ private_field_name: 'private-value' }),
    { headers: { 'content-type': 'text/event-stream' } }), false);
  const report = JSON.parse(readFileSync(join(f.work, 'report.json'), 'utf8'));
  assert.equal(report.phase, 'response_sampled'); assert.equal(report.requests, 1); assert.equal(report.forwarded, 1);
  assert.equal(report.conservativeMicroCny, budgetPolicy.reservationMicroCny);
  const receipt = usageReceiptSchema.parse(report.receipt); assert.equal(receipt.schemaVersion, 2);
  if (receipt.schemaVersion === 2) assert.equal(receipt.diagnostic?.location, 'start_message_usage');
  assert.ok(!JSON.stringify(report).includes('private'));
  const reopened = new DeepseekBudget(f.budget, 't015-snapshot-high-water-v1', 2, 3_000_000);
  try { assert.throws(() => reopened.reserve(), /exhausted/); } finally { reopened.close(); }
});

test('source or request-plan drift rejects before credentials, qualification or network', async () => {
  const f = prepared(); let touched = false;
  writeFileSync(f.file, 'drift');
  await assert.rejects(runSample(f.work, f.budget, async () => { touched = true; return 'fake'; },
    async () => { touched = true; return new Response(); }, false), /drift/);
  assert.equal(touched, false); assert.equal(existsSync(f.budget), false); assert.equal(existsSync(join(f.work, 'live-once.json')), false);
  assert.throws(() => prepareSample(f.work, 'fake', 'fake', [f.file]), /already prepared/);
});

test('expired plan is rejected and the probe only describes credentials without consuming any request', async () => {
  const f = prepared(); let describes = 0;
  assert.deepEqual(await probeSample(f.work, async () => { describes++; return true; }), { configured: true, requests: 0 });
  assert.equal(describes, 1); assert.equal(existsSync(f.budget), false); assert.equal(existsSync(join(f.work, 'live-once.json')), false);
  const plan = JSON.parse(readFileSync(join(f.work, 'plan.json'), 'utf8'));
  plan.preparedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  plan.expiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  writeFileSync(join(f.work, 'plan.json'), JSON.stringify(plan)); writeFileSync(join(f.work, 'plan-digest.txt'), digest(JSON.stringify(plan)));
  assert.throws(() => readSamplePlan(f.work), /expired/);
});

test('provider rejection and transport exceptions preserve one unknown request without logging errors', async () => {
  for (const kind of ['http', 'transport'] as const) {
    const f = prepared();
    const report = await runSample(f.work, f.budget, async () => 'private-key', async () => {
      if (kind === 'transport') throw new Error('private-provider-error');
      return new Response('private-error-body', { status: 402 });
    }, false) as { phase: string; conservativeMicroCny: number };
    assert.equal(report.phase, 'sample_failed'); assert.equal(report.conservativeMicroCny, budgetPolicy.reservationMicroCny);
    assert.ok(!JSON.stringify(report).includes('private'));
  }
});

test('the actual CLI paths remain project anchored when launched from another directory', () => {
  const old = process.cwd();
  try {
    process.chdir(tmpdir()); assert.equal(sampleWork, join(projectRoot, '.probe-work/t017-sample'));
    assert.equal(sampleBudgetPath, join(projectRoot, '.probe-work/t017-budget.json'));
  } finally { process.chdir(old); }
});
