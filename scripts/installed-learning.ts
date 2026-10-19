import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { AgentRegistry, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { createUserMessage, LlmAdapter, LlmRuntime, resolveRetryPolicy, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { applicationSchema, experienceSchema, idSchema, verificationSchema, type Verification } from '../src/domain.js';
import { git } from '../src/repository.js';
import { fixture } from '../test/fixture.js';
import { validateRepair } from './dsh-live.js';
import { installedReportSchema, type InstalledReport } from './installed-learning-report.js';

const provider = 'installed-offline'; const model = 'scripted'; const summary = 'database transaction rollback exception';
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => z.record(z.string(), z.unknown()).parse(value);
const toolResult = (options: GenerateOptions, name: string): ObjectValue => {
  const ids = new Set(options.messages.flatMap(m => m.role === 'assistant' ? m.content.flatMap(b => b.type === 'tool-call' && b.name === name ? [b.id] : []) : []));
  const message = options.messages.filter(m => m.role === 'tool' && ids.has(m.toolCallId)).at(-1);
  if (!message || message.role !== 'tool' || message.isError) throw new Error('Missing successful fixture receipt');
  const text = message.content.find(b => b.type === 'text'); return object(JSON.parse(text?.type === 'text' ? text.text : 'null'));
};
class OfflineAdapter extends LlmAdapter {
  agentCalls = 0; extractionCalls = 0; taskId = ''; experienceId = ''; applicationId = ''; revision = 0; returned = false; continued = false;
  private sourceStep = 0; private targetStep = 0;
  constructor(private readonly sourceId: string, private readonly targetId: string, private readonly sourceCode: string, private readonly targetCode: string,
    private readonly scenario: InstalledReport['scenario']) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'installed offline fixture'); }
  private reply(options: GenerateOptions): { name: string; args: object } | { text: string } {
    if (!options.sessionId) {
      if (++this.extractionCalls > 1 || options.tools?.length) throw new Error('Unexpected extraction call');
      const message = options.messages.at(-1); const text = message?.content.find(b => b.type === 'text');
      const material = object(JSON.parse(text?.type === 'text' ? text.text : 'null'));
      const ids = z.array(z.object({ id: z.string() })).parse(material.facts).map(f => f.id);
      assert.ok(ids.includes('verification:fixed'));
      return { text: JSON.stringify({ kind: 'candidate', title: summary, strategy: 'Save original state and restore it before raising after a failed transaction.',
        factIds: this.scenario === 'invalid-extraction' ? ['invented-fact'] : ['verification:base', 'verification:fixed', 'verification:regression'],
        inferences: ['Other stateful transactions may need analogous rollback; this is unverified.'], recommendations: ['Check independent failure-path acceptance.'] }) };
    }
    if (++this.agentCalls > 14) throw new Error('Offline Agent call bound');
    if (options.sessionId === this.sourceId) {
      switch (this.sourceStep++) {
        case 0: return { name: 'evolve_begin_task', args: { summary } };
        case 1: {
          this.taskId = idSchema.parse(toolResult(options, 'evolve_begin_task').taskId);
          const user = options.messages.filter(m => m.role === 'user').at(-1); const text = user?.content.find(b => b.type === 'text');
          const input = z.object({ explicitCorrection: z.string().min(1).max(4000) }).strict().parse(JSON.parse(text?.type === 'text' ? text.text : 'null'));
          return { name: 'evolve_record_correction', args: { taskId: this.taskId, note: input.explicitCorrection } };
        }
        case 2: assert.equal(toolResult(options, 'evolve_record_correction').recorded, true); return { text: JSON.stringify({ code: this.sourceCode }) };
        case 3: return { name: 'evolve_finish_task', args: { taskId: this.taskId } };
        case 4: assert.equal(toolResult(options, 'evolve_finish_task').state, 'closed'); return { text: 'Source capture closed; wait for the background candidate.' };
        case 5: {
          const user = options.messages.filter(m => m.role === 'user').at(-1); const text = user?.content.find(b => b.type === 'text');
          const input = z.object({ reviewedCandidateId: idSchema }).strict().parse(JSON.parse(text?.type === 'text' ? text.text : 'null'));
          assert.equal(input.reviewedCandidateId, this.experienceId);
          return { name: 'evolve_verify_experience', args: { experienceId: input.reviewedCandidateId } };
        }
        case 6: {
          const receipt = toolResult(options, 'evolve_verify_experience'); assert.equal(receipt.status, 'source_verified');
          this.revision = z.number().int().positive().parse(receipt.revision); return { text: 'Source verification receipt observed.' };
        }
      }
    }
    if (options.sessionId === this.targetId) {
      switch (this.targetStep++) {
        case 0: return { name: 'evolve_begin_task', args: { summary: summary + ' stock reservation' } };
        case 1: {
          const receipt = toolResult(options, 'evolve_begin_task');
          if (!receipt.experience) return { text: 'No experience offered; stop the transfer fixture.' };
          const experience = object(receipt.experience); assert.equal(experience.id, this.experienceId); assert.equal(experience.revision, this.revision);
          const app = applicationSchema.parse(receipt.application); assert.equal(app.experienceId, this.experienceId); assert.equal(app.revision, this.revision);
          assert.equal(app.taskId, idSchema.parse(receipt.taskId)); this.applicationId = app.id;
          this.returned = true; this.continued = true; return { text: JSON.stringify({ code: this.targetCode }) };
        }
        case 2: return { name: 'evolve_finish_task', args: { taskId: idSchema.parse(toolResult(options, 'evolve_begin_task').taskId) } };
        case 3: assert.equal(toolResult(options, 'evolve_finish_task').state, 'closed'); return { text: 'Target capture closed; independent acceptance is still required.' };
      }
    }
    throw new Error('Unexpected offline fixture step');
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted();
    if (options.provider !== provider || options.model !== model || options.purpose) throw new Error('Unexpected route');
    const reply = this.reply(options);
    if ('name' in reply) {
      assert.ok(options.tools?.some(t => t.name === reply.name));
      const id = ToolCallId(randomUUID()); const args = JSON.stringify(reply.args);
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: reply.name, argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: reply.name, arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text: reply.text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 80, totalTokens: 180 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}
const briefProof = (p: Verification) => ({ verified: p.verified, baseFailures: p.base.failures, fixedFailures: p.fixed.failures, regressionFailures: p.regression.failures });

/** Synthetic integration with the actually installed plugin; no source service or bindDsh substitution. */
export async function installedLearning(input: {
  profile: string; patches: NonNullable<Parameters<typeof boot>[2]>; packageDir: string; work: string;
  archiveDigest: string; scenario: InstalledReport['scenario'];
}): Promise<InstalledReport> {
  const f = await fixture(); const dataDir = join(input.work, 'learning-' + input.scenario); const targetAcceptance = join(f.home, 'target-acceptance'); await mkdir(targetAcceptance);
  const targetCode = 'def reserve_stock(stock, fail=False):\n    before = stock["remaining"]\n    stock["remaining"] -= 3\n    if fail:\n        raise ValueError("reservation failed")\n    return stock["remaining"]\n';
  await writeFile(join(f.repo, 'cart.py'), targetCode); git(f.repo, ['add', 'cart.py']); git(f.repo, ['commit', '-m', 'add separate target fixture']);
  await writeFile(join(targetAcceptance, 'test_acceptance.py'), 'import pytest\nfrom cart import reserve_stock\ndef test_failure_restores_stock():\n    stock={"remaining":9}\n    with pytest.raises(ValueError): reserve_stock(stock, fail=True)\n    assert stock["remaining"]==9\ndef test_success_reserves_stock():\n    assert reserve_stock({"remaining":9})==6\n');
  const sourceBase = git(f.repo, ['rev-parse', 'HEAD']);
  const sourceCode = (await readFile(join(f.repo, 'ledger.py'), 'utf8')).replace('        raise ValueError', '        state["balance"] = before\n        raise ValueError');
  const targetRepair = input.scenario === 'failed-target' ? targetCode : targetCode.replace('        raise ValueError', '        stock["remaining"] = before\n        raise ValueError');
  const sourceId = SessionId('installed-source-' + randomUUID()); const targetId = SessionId('installed-target-' + randomUUID());
  const adapter = new OfflineAdapter(sourceId, targetId, sourceCode, targetRepair, input.scenario);
  const config = { repoRoot: f.repo, dataDir, executionTrusted: true, backgroundVerification: true, shareWithModel: input.scenario !== 'sharing-off',
    acceptanceDir: f.acceptance, python: process.env.EVOLVE_PYTHON ?? 'python', timeoutMs: 15000,
    extraction: { grantId: randomUUID(), provider, model, maxCalls: 1, maxTokens: 2048, timeoutMs: 30000 } };
  const report: InstalledReport = { schemaVersion: 1, kind: 'installed-scripted-auto-learning', scenario: input.scenario, archiveDigest: input.archiveDigest,
    realModel: false, modelHttpRequests: 0, benefitEvaluated: false, phase: 'partial', reason: 'unexpected_failure', stage: 'initialize',
    sourceTaskId: null, targetTaskId: null, experienceId: null, revision: null, autoCandidateCreated: false, candidateInitiallyInactive: false, sourceVerified: false,
    receiptReturned: false, modelContinued: false, experienceOffered: false, targetAccepted: null, feedbackRecorded: false,
    extractionState: 'missing', logicalExtractions: 0, scriptedAgentCalls: 0, sourceProof: null, targetProof: null, tools: [],
    counts: { tasks: 0, experiences: 0, applications: 0, feedback: 0 } };
  let ctx: Context | undefined; let db: DatabaseSync | undefined; const handles: AgentHandle[] = []; const latestText = new Map<string, string>();
  const read = <T>(table: string, schema: z.ZodType<T>): T[] => db!.prepare(`SELECT body FROM ${table}`).all().map(r => schema.parse(JSON.parse(String(r.body))));
  try {
    ctx = await boot('dsh', join(input.profile, 'cordis.yml'), [...input.patches, { id: 'dsh-evolve', config }], async root => {
      for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await root.plugin(plugin).await();
      await root.plugin(SystemPrompt, {}).await(); await root.plugin(ToolRuntime, { mode: 'native' }).await();
      root.llm.registerAdapter([provider], adapter); await root.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    }, pathToFileURL(join(input.profile, 'package.json')).href);
    const installedModule = await import(pathToFileURL(join(input.packageDir, 'dist/src/dsh.js')).href) as typeof import('../src/dsh.js');
    const entry = [...ctx.loader.entries()].find(e => e.options.name === 'dsh-evolve');
    assert.ok(entry?.fiber); assert.equal((entry.moduleNamespace as typeof import('../src/dsh.js')).apply, installedModule.apply, 'Loader must execute the installed module');
    db = new DatabaseSync(join(dataDir, 'evolve.sqlite'), { readOnly: true });
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return;
      const data = object(event.data); if (data.interrupted === true) return;
      const message = object(data.message); const blocks = z.array(z.unknown()).parse(message.content);
      const text = blocks.flatMap(b => { const block = object(b); return block.type === 'text' ? [z.string().max(8192).parse(block.text)] : []; }).join('');
      if (text) latestText.set(String(session.id), text);
    });
    ctx.on('tools/result', (exec, result) => { assert.ok(report.tools.length < 12); report.tools.push({ name: exec.name, isError: result.isError }); });
    const create = async (sessionId: SessionId): Promise<Agent> => {
      const h = await ctx!.agents.create({ sessionId, meta: { cwd: f.repo }, agentOptions: { provider, model, maxTokens: 4096 } }); handles.push(h); return h.agent;
    };
    const turn = async (agent: Agent, text: string): Promise<string> => {
      latestText.delete(String(agent.id)); agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([agent.whenIdle(), new Promise<never>((_, reject) => { timer = setTimeout(() => { agent.cancel({ kind: 'hook', reason: 'fixture_deadline' }); reject(new Error('Fixture deadline')); }, 60000); })]); }
      finally { clearTimeout(timer); }
      return latestText.get(String(agent.id)) ?? '';
    };
    const codeFrom = (text: string): string => z.object({ code: z.string().max(4096) }).strict().parse(JSON.parse(text)).code;
    report.stage = 'source_repair'; const source = await create(sourceId);
    const repair = codeFrom(await turn(source, JSON.stringify({ explicitCorrection: 'Restore the original balance when a transaction fails.' })));
    validateRepair(repair, 'apply_change'); await writeFile(join(f.repo, 'ledger.py'), repair); git(f.repo, ['add', 'ledger.py']); git(f.repo, ['commit', '-m', 'installed scripted source repair']);
    const sourceFix = git(f.repo, ['rev-parse', 'HEAD']); await turn(source, 'Repair is committed; finish the source task without proposing an experience.');
    report.sourceTaskId = adapter.taskId; report.stage = 'automatic_candidate';
    for (let i = 0; i < 1500; i++) {
      const row = db.prepare('SELECT * FROM extraction_jobs WHERE task_id=?').get(adapter.taskId);
      if (row && row.state !== 'waiting' && row.state !== 'running') { report.extractionState = z.enum(['candidate', 'abstained', 'blocked', 'failed', 'unknown']).parse(row.state); break; }
      await pause(40);
    }
    // Reconstruct only the candidate link/terminal state; no raw task material or model response in report.
    const row = db.prepare('SELECT candidate_id,state FROM extraction_jobs WHERE task_id=?').get(adapter.taskId);
    report.extractionState = row ? z.enum(['waiting', 'running', 'candidate', 'abstained', 'blocked', 'failed', 'unknown']).parse(row.state) : 'missing';
    if (input.scenario === 'invalid-extraction') { assert.equal(report.extractionState, 'failed'); report.reason = 'extraction_invalid'; throw new Error('Expected invalid extraction'); }
    assert.equal(report.extractionState, 'candidate'); const candidateId = idSchema.parse(row!.candidate_id);
    const sourceTask = object(JSON.parse(String(db.prepare('SELECT body FROM tasks WHERE id=?').get(adapter.taskId)!.body)));
    assert.equal(sourceTask.state, 'closed'); assert.equal(sourceTask.sessionId, sourceId);
    let experience = read('experiences', experienceSchema).find(e => e.id === candidateId)!;
    assert.ok(experience); assert.equal(experience.sourceTaskId, adapter.taskId); assert.equal(experience.status, 'candidate'); assert.equal(experience.verificationId, null); assert.equal(experience.revision, 1);
    report.autoCandidateCreated = true; report.candidateInitiallyInactive = true; report.experienceId = experience.id; adapter.experienceId = experience.id;
    assert.equal(db.prepare('SELECT count(*) AS n FROM fact_citations WHERE experience_id=? AND revision=1').get(experience.id)!.n, experience.observedFacts.length);
    report.stage = 'source_verify'; await turn(source, JSON.stringify({ reviewedCandidateId: experience.id }));
    experience = read('experiences', experienceSchema).find(e => e.id === candidateId)!;
    assert.equal(experience.status, 'source_verified'); assert.equal(experience.revision, adapter.revision); assert.equal(experience.revision, 2);
    const sourceProof = read('verifications', verificationSchema).find(p => p.id === experience.verificationId)!;
    assert.equal(sourceProof.baseCommit, sourceBase); assert.equal(sourceProof.fixCommit, sourceFix); assert.equal(sourceProof.sourceTaskId, adapter.taskId); assert.equal(sourceProof.verified, true);
    report.sourceVerified = true; report.revision = experience.revision; report.sourceProof = briefProof(sourceProof);
    report.stage = 'target_delivery'; const target = await create(targetId); const proposedTarget = await turn(target, 'Begin a similar stock rollback repair, inspect the experience and return a bounded repair proposal.');
    report.receiptReturned = adapter.returned; report.modelContinued = adapter.continued;
    const applications = read('applications', applicationSchema);
    const application = applications.find(a => a.id === adapter.applicationId); report.experienceOffered = !!(application && adapter.returned && adapter.continued);
    if (input.scenario === 'sharing-off') { assert.equal(applications.length, 0); report.reason = 'sharing_disabled'; throw new Error('Expected no sharing'); }
    assert.ok(application); assert.equal(application.experienceId, experience.id); assert.equal(application.revision, experience.revision); report.targetTaskId = application.taskId;
    const code = codeFrom(proposedTarget); validateRepair(code, 'reserve_stock'); await writeFile(join(f.repo, 'cart.py'), code); git(f.repo, ['add', 'cart.py']);
    // The failed-target fixture is still a committed change, so commit identity cannot replace acceptance.
    if (input.scenario === 'failed-target') await writeFile(join(f.repo, 'cart.py'), code + '\n# synthetic unsuccessful repair\n');
    git(f.repo, ['add', 'cart.py']); git(f.repo, ['commit', '-m', 'installed scripted target proposal']); await turn(target, 'Target repair is committed; finish task capture.');
    report.stage = 'target_acceptance';
    const { verifyRepair } = await import(pathToFileURL(join(input.packageDir, 'dist/src/verification.js')).href) as typeof import('../src/verification.js');
    const rawTask = db.prepare('SELECT body FROM tasks WHERE id=?').get(application.taskId)!; const targetTask = object(JSON.parse(String(rawTask.body)));
    assert.equal(targetTask.state, 'closed'); assert.equal(targetTask.sessionId, targetId); assert.notEqual(targetTask.id, adapter.taskId);
    const transfer = await verifyRepair(f.repo, application.taskId, z.string().parse(targetTask.baseCommit), git(f.repo, ['rev-parse', 'HEAD']),
      { trusted: true, python: config.python, acceptanceDir: targetAcceptance, regressionPath: 'tests', timeoutMs: 15000 });
    report.targetProof = briefProof(transfer); report.targetAccepted = transfer.verified;
    if (input.scenario === 'failed-target') { assert.equal(transfer.verified, false); report.reason = 'target_rejected'; throw new Error('Expected rejected target'); }
    assert.equal(transfer.verified, true); report.stage = 'feedback';
    const { createService } = await import(pathToFileURL(join(input.packageDir, 'dist/src/config.js')).href) as typeof import('../src/config.js');
    const { startPanel } = await import(pathToFileURL(join(input.packageDir, 'dist/src/panel.js')).href) as typeof import('../src/panel.js');
    const observer = createService(config).service; const panel = await startPanel(observer);
    try {
      const result = await fetch(panel.origin + '/api/feedback', { method: 'POST', headers: { Authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: randomUUID(), applicationId: application.id, outcome: 'accepted', note: 'Host synthetic benchmark acceptance after independent pytest; scripted response, not real owner feedback or benefit evidence.', extraCost: null, humanRework: null }) });
      assert.equal(result.status, 200); const receipt = object(await result.json()); assert.equal(receipt.applicationId, application.id); assert.equal(receipt.outcome, 'accepted'); report.feedbackRecorded = true;
    } finally { await panel.close(); observer.store.close(); }
    report.phase = 'passed'; report.reason = 'completed'; report.stage = 'completed';
  } catch { /* Fixed stage/reason and independent facts retain partial results without arbitrary error text. */ }
  finally {
    for (const handle of handles.reverse()) await handle.dispose(); await ctx?.fiber.dispose();
    report.scriptedAgentCalls = adapter.agentCalls;
    if (db) {
      for (const [key, table] of Object.entries({ tasks: 'tasks', experiences: 'experiences', applications: 'applications', feedback: 'feedback' }) as [keyof InstalledReport['counts'], string][]) {
        report.counts[key] = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
      }
      report.logicalExtractions = Number(db.prepare('SELECT used FROM extraction_grants WHERE id=?').get(config.extraction.grantId)?.used ?? 0); db.close();
    }
  }
  assert.equal(adapter.extractionCalls, report.logicalExtractions); return installedReportSchema.parse(report);
}
