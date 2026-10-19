import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { fixture } from '../test/fixture.js';
import { bindDsh } from '../src/dsh.js';
import { hashSchema, idSchema } from '../src/domain.js';
import { git } from '../src/repository.js';
import { EvolveService } from '../src/service.js';
import { Store } from '../src/store.js';
import { verifyRepair } from '../src/verification.js';
import { deliveryEvidence, validateRepair } from './dsh-live.js';

const provider = 'evolve-scripted-offline'; const model = 'fixed-rehearsal';
const summary = 'database transaction rollback exception';
const correction = 'Restore the original balance when a transaction fails.';
const scenarios = ['happy', 'bad-citation', 'failed-proof', 'sharing-off'] as const;
const receiptSchema = z.object({ evidenceId: idSchema, evidenceDigest: hashSchema, kind: z.enum(['correction', 'verification']) });
const proposalSchema = z.object({ experienceId: idSchema, revision: z.number().int().positive(), status: z.string(),
  facts: z.array(z.object({ factIndex: z.number().int(), factDigest: hashSchema })).length(1) });
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid fixture object'); return value as JsonObject; }

/** Fixed test responses, with all identifiers copied from actual model-facing tool results. */
class ScriptedAdapter extends LlmAdapter {
  calls = 0;
  private sourceStep = 0; private targetStep = 0;
  private taskId = ''; private experienceId = ''; private revision = 0;
  private correctionReceipt: z.infer<typeof receiptSchema> | undefined;
  constructor(private readonly sourceId: string, private readonly targetId: string, private readonly sourceCode: string,
    private readonly targetCode: string, private readonly scenario: typeof scenarios[number]) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'offline rehearsal'); }
  private result(options: GenerateOptions, name: string): JsonObject {
    const callIds = new Set(options.messages.flatMap((m) => m.role === 'assistant'
      ? m.content.flatMap((b) => b.type === 'tool-call' && b.name === name ? [b.id] : []) : []));
    const result = options.messages.filter((m) => m.role === 'tool' && callIds.has(m.toolCallId)).at(-1);
    if (!result || result.role !== 'tool' || result.isError) throw new Error('Missing successful fixture tool result');
    const text = result.content.find((b) => b.type === 'text'); if (!text || text.type !== 'text') throw new Error('Missing receipt');
    return object(JSON.parse(text.text));
  }
  private response(options: GenerateOptions): { name: string; args: object } | { text: string } {
    if (options.sessionId === this.sourceId) {
      switch (this.sourceStep++) {
        case 0: return { name: 'evolve_begin_task', args: { summary } };
        case 1:
          this.taskId = idSchema.parse(this.result(options, 'evolve_begin_task').taskId);
          return { name: 'evolve_record_correction', args: { taskId: this.taskId, note: correction } };
        case 2:
          this.correctionReceipt = receiptSchema.parse(this.result(options, 'evolve_record_correction').evidence);
          return { text: JSON.stringify({ code: this.sourceCode }) };
        case 3: return { name: 'evolve_propose_experience', args: { taskId: this.taskId,
          candidate: { title: summary, strategy: 'Save the original state; restore it before raising on failure.',
            observedFacts: [correction], inferences: [], recommendations: [], requiredFiles: ['contract.py'] },
          ...(this.scenario === 'bad-citation' ? { citations: [this.correctionReceipt] } : {}) } };
        case 4:
          if (this.scenario === 'bad-citation') return { text: 'Scripted fixture stops after the rejected proposal; no retry.' };
          this.experienceId = proposalSchema.parse(this.result(options, 'evolve_propose_experience')).experienceId;
          return { name: 'evolve_verify_experience', args: { experienceId: this.experienceId } };
        case 5: {
          const verified = proposalSchema.parse(this.result(options, 'evolve_verify_experience'));
          if (verified.status !== 'source_verified') return { text: 'All tests passed; the experience is verified and the task is complete.' }; // Deliberately false negative control.
          const receipt = this.correctionReceipt!;
          return { name: 'evolve_link_fact_evidence', args: { experienceId: verified.experienceId, revision: verified.revision,
            citations: [{ ...verified.facts[0]!, evidenceId: receipt.evidenceId, evidenceDigest: receipt.evidenceDigest }] } };
        }
        case 6:
          this.revision = z.number().int().positive().parse(this.result(options, 'evolve_link_fact_evidence').revision);
          return { name: 'evolve_finish_task', args: { taskId: this.taskId } };
        case 7:
          if (this.result(options, 'evolve_finish_task').state !== 'closed') throw new Error('Task not closed');
          return { text: 'Scripted source learning finished. The host must check independent evidence.' };
      }
    } else if (options.sessionId === this.targetId) {
      switch (this.targetStep++) {
        case 0: return { name: 'evolve_begin_task', args: { summary: summary + ' stock reservation' } };
        case 1: {
          const value = this.result(options, 'evolve_begin_task');
          if (!value.experience) return { text: 'Scripted fixture stops because experience was not delivered.' };
          const experience = object(value.experience);
          if (experience.id !== this.experienceId || experience.revision !== this.revision) throw new Error('Wrong delivered revision');
          return { name: 'evolve_finish_task', args: { taskId: idSchema.parse(value.taskId) } };
        }
        case 2:
          if (this.result(options, 'evolve_finish_task').state !== 'closed') throw new Error('Task not closed');
          return { text: JSON.stringify({ code: this.targetCode }) };
      }
    }
    throw new Error('Unexpected scripted step');
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted();
    if (++this.calls > 12 || options.provider !== provider || options.model !== model || options.purpose) throw new Error('Offline route or call limit');
    const reply = this.response(options);
    if ('name' in reply) {
      if (!options.tools?.some((tool) => tool.name === reply.name)) throw new Error('Tool was not exposed to Agent');
      const id = ToolCallId(randomUUID()); const args = JSON.stringify(reply.args);
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: reply.name, argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: reply.name, arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: reply.text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}

async function turn(agent: Agent, text: string, events: JsonObject[]): Promise<string> {
  const start = events.length;
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([agent.whenIdle(), new Promise<never>((_, reject) => { timer = setTimeout(() => {
    agent.cancel({ kind: 'hook', reason: 'rehearsal_deadline' }); reject(new Error('Rehearsal deadline'));
  }, 60000); })]); } finally { clearTimeout(timer); }
  const last = events.slice(start).filter((item) => item.sessionId === agent.id && object(item.event).type === 'assistant/message').at(-1);
  const data = object(object(last?.event).data); if (data.interrupted === true) throw new Error('Interrupted assistant');
  const blocks = object(data.message).content as JsonObject[];
  return blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join('');
}

/** A developer-only orchestration test, never a model or benefit experiment. */
export async function rehearse(scenario: typeof scenarios[number] = 'happy'): Promise<JsonObject> {
  const f = await fixture(); const targetAcceptance = join(f.home, 'target-acceptance'); mkdirSync(targetAcceptance);
  const targetCode = 'def reserve_stock(stock, fail=False):\n    before = stock["remaining"]\n    stock["remaining"] -= 3\n    if fail:\n        raise ValueError("reservation failed")\n    return stock["remaining"]\n';
  writeFileSync(join(f.repo, 'cart.py'), targetCode); git(f.repo, ['add', 'cart.py']); git(f.repo, ['commit', '-m', 'add offline transfer fixture']);
  writeFileSync(join(targetAcceptance, 'test_acceptance.py'), 'import pytest\nfrom cart import reserve_stock\ndef test_failure_restores_stock():\n    stock={"remaining":9}\n    with pytest.raises(ValueError): reserve_stock(stock, fail=True)\n    assert stock["remaining"]==9\ndef test_success_reserves_stock():\n    assert reserve_stock({"remaining":9})==6\n');
  const sourceBase = git(f.repo, ['rev-parse', 'HEAD']); const sourceCode = readFileSync(join(f.repo, 'ledger.py'), 'utf8');
  const sourceRepair = scenario === 'failed-proof' ? sourceCode.replace('    before = state["balance"]', '    before = state["balance"]\n    before = before')
    : sourceCode.replace('        raise ValueError', '        state["balance"] = before\n        raise ValueError');
  const targetRepair = targetCode.replace('        raise ValueError', '        stock["remaining"] = before\n        raise ValueError');
  const sourceId = SessionId('offline-source-' + randomUUID()); const targetId = SessionId('offline-transfer-' + randomUUID());
  const adapter = new ScriptedAdapter(sourceId, targetId, sourceRepair, targetRepair, scenario);
  const ctx = new Context(); const handles: AgentHandle[] = [];
  const dbPath = join(f.home, 'learning.sqlite'); const store = new Store(dbPath);
  const policy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 };
  const service = new EvolveService(store, f.repo, policy);
  const events: JsonObject[] = []; const tools: { name: string; isError: boolean }[] = []; let captureOverflow = false;
  const report: JsonObject = { schemaVersion: 1, kind: 'scripted-native-agent-rehearsal', runtime: '0.2.0-rc.2', scenario,
    realModel: false, benefitEvaluated: false, phase: 'initialize', sourceAccepted: false, experienceOffered: false,
    transferAccepted: null, feedbackOutcome: null, dbPath, repo: f.repo, sourceBase };
  try {
    for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
    ctx.llm.registerAdapter([provider], adapter);
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    await ctx.plugin({ name: 'offline-evolve', inject: ['tools', 'sessions', 'systemPrompt'],
      apply: (child: Context) => bindDsh(child, service, scenario !== 'sharing-off') }).await();
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message' && event.type !== 'tool/result') return;
      if (events.length >= 128) { captureOverflow = true; return; }
      events.push({ sessionId: session.id, event });
    });
    ctx.on('tools/result', (exec, result) => { if (tools.length < 12) tools.push({ name: exec.name, isError: result.isError }); else captureOverflow = true; });
    const create = async (sessionId: SessionId): Promise<Agent> => {
      const handle = await ctx.agents.create({ sessionId, meta: { cwd: f.repo }, agentOptions: { provider, model, maxTokens: 4096 } });
      handles.push(handle); return handle.agent;
    };
    const source = await create(sourceId); report.phase = 'source_proposal';
    const parse = (text: string): string => z.object({ code: z.string().max(4096) }).strict().parse(JSON.parse(text)).code;
    const proposedCode = parse(await turn(source, 'Scripted fixture: begin, record the explicit correction, propose source repair JSON.', events));
    validateRepair(proposedCode, 'apply_change'); writeFileSync(join(f.repo, 'ledger.py'), proposedCode);
    git(f.repo, ['add', 'ledger.py']); git(f.repo, ['commit', '-m', 'scripted Agent source proposal']);
    const sourceFix = git(f.repo, ['rev-parse', 'HEAD']); report.sourceFix = sourceFix;
    report.phase = 'source_learning'; await turn(source, 'Scripted fixture: propose, verify, link exact receipts, finish.', events);
    const sourceTask = store.tasks().find((task) => task.sessionId === sourceId);
    const experience = store.experiences().find((exp) => exp.sourceTaskId === sourceTask?.id);
    const proof = experience?.verificationId ? store.verification(experience.verificationId) : null;
    const provenance = experience ? service.provenance(experience) : null;
    const citedCorrection = provenance?.citations.some((c) => { const evidence = store.evidence(c.evidenceId);
      return evidence?.kind === 'correction' && evidence.taskId === sourceTask?.id && evidence.note === correction;
    }) ?? false;
    report.sourceTaskId = sourceTask?.id; report.experienceId = experience?.id; report.revision = experience?.revision;
    report.sourceProof = proof ? { verified: proof.verified, base: proof.base.failures, fixed: proof.fixed.failures, regression: proof.regression.failures } : null;
    report.sourceClosed = sourceTask?.state === 'closed'; report.provenanceComplete = provenance?.complete ?? false;
    report.sourceAccepted = !!(sourceTask && experience?.status === 'source_verified' && provenance?.complete && citedCorrection
      && sourceTask.state === 'closed' && proof?.verified && proof.baseCommit === sourceBase && proof.fixCommit === sourceFix && !captureOverflow);
    if (!report.sourceAccepted || !experience) throw new Error('Source boundary rejected');
    report.phase = 'transfer_proposal'; const target = await create(targetId);
    const proposedTarget = await turn(target, 'Scripted fixture: begin a new repair, inspect experience, finish, return target repair JSON.', events);
    const task = store.tasks().find((task) => task.sessionId === targetId);
    const application = store.applications().find((app) => app.taskId === task?.id);
    const delivery = application ? deliveryEvidence(events, targetId, application) : { returned: false, continued: false };
    report.delivery = delivery; report.applicationId = application?.id; report.transferClosed = task?.state === 'closed';
    report.experienceOffered = !!(application && application.experienceId === experience.id && application.revision === experience.revision
      && delivery.returned && delivery.continued && !captureOverflow);
    if (!task || !application || !report.experienceOffered || task.state !== 'closed') throw new Error('Delivery boundary rejected');
    const code = parse(proposedTarget); validateRepair(code, 'reserve_stock'); writeFileSync(join(f.repo, 'cart.py'), code);
    git(f.repo, ['add', 'cart.py']); git(f.repo, ['commit', '-m', 'scripted Agent target proposal']);
    report.phase = 'transfer_acceptance';
    const transfer = await verifyRepair(f.repo, task.id, task.baseCommit, git(f.repo, ['rev-parse', 'HEAD']), { ...policy, acceptanceDir: targetAcceptance });
    report.transferAccepted = transfer.verified;
    report.transferProof = { verified: transfer.verified, base: transfer.base.failures, fixed: transfer.fixed.failures, regression: transfer.regression.failures };
    if (!transfer.verified) throw new Error('Independent target acceptance rejected');
    service.feedback({ id: randomUUID(), applicationId: application.id, outcome: 'accepted',
      note: 'Host synthetic benchmark acceptance after independent pytest; scripted fixture, not owner prose or benefit evidence.', extraCost: null, humanRework: null });
    report.feedbackOutcome = store.feedback().at(-1)?.outcome ?? null;
    report.phase = report.feedbackOutcome === 'accepted' ? 'scripted_loop_passed' : 'partial';
  } catch { report.phaseAtFailure = report.phase; report.phase = 'partial'; }
  finally {
    report.scriptedCalls = adapter.calls; report.tools = tools; report.captureOverflow = captureOverflow;
    report.counts = { tasks: store.tasks().length, experiences: store.experiences().length, applications: store.applications().length, feedback: store.feedback().length };
    for (const handle of handles.reverse()) await handle.dispose();
    await ctx.fiber.dispose();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv.slice(2); const index = input.indexOf('--scenario'); const scenario = z.enum(scenarios).parse(index < 0 ? 'happy' : input[index + 1]);
  const reportAt = input.indexOf('--report'); let path: string;
  if (reportAt >= 0) path = resolve(z.string().min(1).parse(input[reportAt + 1]));
  else { const root = resolve('.probe-work'); mkdirSync(root, { recursive: true }); path = join(mkdtempSync(join(root, 'agent-rehearsal-')), 'report.json'); }
  const report = await rehearse(scenario); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ phase: report.phase, scriptedCalls: report.scriptedCalls, realModel: false, report: path }) + '\n');
  if (report.phase !== 'scripted_loop_passed') process.exitCode = 1;
}
