import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { applicationSchema, digest, experienceSchema, feedbackSchema, hashSchema, idSchema, taskSchema, verificationSchema } from './domain.js';
import { evaluateFeedbackStructure, feedbackPolicyDigests, pairedExperimentSchema } from './paired-evaluation.js';
import { passes, verifiedCases } from './verification.js';

export const feedbackProtocolDigest = 'a32c1298a859b02a57fd0520dbce8c46cefce986883c6749439b1a6b0f54dd49';
export const feedbackControls = { model: 'gpt-6.1-sol', reasoningEffort: 'low', providerRetries: 0,
  timeoutMs: 90000, maxToolCalls: 0, maxOutputBytes: 1048576 } as const;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const manifest = pairedExperimentSchema.shape.manifest;
export const feedbackExperimentSchema = z.object({
  schemaVersion: z.literal(3), kind: z.literal('codex-feedback-paired'), protocolDigest: z.literal(feedbackProtocolDigest),
  executionSource: z.enum(['agent', 'process-fixture', 'prepare-only']),
  budget: z.object({ maxCalls: z.literal(7), accumulationCalls: z.literal(1), evaluationCalls: z.literal(6) }).strict(),
  status: z.enum(['accumulation', 'evaluation', 'completed', 'failed']), failure: z.string().min(1).max(100).nullable(),
  cliVersion: z.literal('codex-cli 0.163.0-alpha.10.2'), controls: manifest.shape.controls,
  environmentDigest: hashSchema, repoId: hashSchema,
  source: z.object({ artifactDigest: z.literal('36ef1b7891d3f2d976f1fc28c3d690448885cb87f6fdeaa663b547fb50961bee'),
    original: z.object({ taskId: idSchema, experienceId: idSchema, revision: z.number().int().positive() }).strict(),
    experience: experienceSchema, verification: verificationSchema }).strict(),
  accumulation: z.object({ plan: manifest.shape.plans.element, run: pairedExperimentSchema.shape.runs.element,
    taskRecord: taskSchema, application: applicationSchema, feedback: feedbackSchema.nullable() }).strict(),
  evaluation: pairedExperimentSchema.nullable(),
}).strict();
export type FeedbackExperiment = z.infer<typeof feedbackExperimentSchema>;

/** A protocol's only live slot is not released on failure, interruption, or a new output directory. */
export async function reserveFeedbackProtocol(directory: string, output: string): Promise<string> {
  const path = join(directory, '.feedback-live-' + feedbackProtocolDigest + '.json');
  const file = await open(path, 'wx');
  try { await file.writeFile(JSON.stringify({ protocolDigest: feedbackProtocolDigest, output, createdAt: new Date().toISOString() }, null, 2)); }
  finally { await file.close(); }
  return path;
}

export function evaluateFeedbackExperiment(input: unknown): object {
  const e = feedbackExperimentSchema.parse(input); const a = e.accumulation; const s = e.source;
  if (!same(e.controls, feedbackControls) || !same(a.run.runtime?.controls ?? e.controls, e.controls)) throw new Error('Feedback controls differ');
  const verifyProof = (v: z.infer<typeof verificationSchema>): void => {
    const files = [...v.acceptanceFiles].sort((x, y) => x.path.localeCompare(y.path));
    if (v.repoId !== e.repoId || digest(JSON.stringify(v.environment)) !== e.environmentDigest || v.baseCommit === v.fixCommit
      || v.verified !== (verifiedCases(v.base, v.fixed) && passes(v.regression))
      || new Set(files.map((f) => f.path)).size !== files.length
      || digest(files.map((f) => `${f.path}:${digest(f.content)}`).join('\n')) !== v.acceptanceDigest) throw new Error('Invalid feedback repair evidence');
  };
  verifyProof(s.verification);
  if (!s.verification.verified || s.experience.status !== 'source_verified' || s.experience.verificationId !== s.verification.id
    || s.experience.sourceTaskId !== s.verification.sourceTaskId || s.experience.scope.repoId !== e.repoId) throw new Error('Source experience does not match its proof');
  const ref = { id: s.experience.id, revision: s.experience.revision, sourceTaskId: s.experience.sourceTaskId };
  const r = a.run; const p = a.plan;
  if (r.task.baseCommit !== s.verification.fixCommit) throw new Error('Accumulation does not start from verified source repair');
  const sourceBank = { experiences: [s.experience], proofs: [s.verification], feedback: [], applications: [], feedbackTasks: [] };
  if (r.runId !== p.runId || r.task.id !== p.taskId || p.arm !== 'evolve' || p.replicate !== 0
    || p.policyDigest !== feedbackPolicyDigests.evolve || !same(p.experienceRefs, [ref]) || !same(r.experienceRefs, p.experienceRefs)
    || r.promptDigest !== p.promptDigest || r.promptDigest === r.task.basePromptDigest
    || r.cliVersion !== e.cliVersion || r.environmentDigest !== e.environmentDigest || r.experienceBankDigest !== digest(JSON.stringify(sourceBank))) throw new Error('Accumulation plan/run mismatch');
  if (a.application.taskId !== r.task.id || a.application.experienceId !== ref.id || a.application.revision !== ref.revision
    || r.task.id === ref.sourceTaskId || a.taskRecord.id !== r.task.id || a.taskRecord.baseCommit !== r.task.baseCommit
    || a.taskRecord.scope.repoId !== e.repoId || a.taskRecord.scope.dependencyDigest !== s.experience.scope.dependencyDigest) throw new Error('Accumulation application mismatch');
  if (r.runtime && (!r.callStarted || r.runtime.transport !== 'https')) throw new Error('Accumulation runtime lacks invocation');
  if (r.runtime?.status === 'failed' && r.runtime.reason === null) throw new Error('Failed accumulation lacks reason');
  if (r.status === 'not_started' && r.callStarted) throw new Error('Not-started accumulation claims invocation');
  if (['not_started', 'running', 'unknown'].includes(r.status) && (r.runtime || r.verification || r.accepted !== null)) throw new Error('Unfinished accumulation claims results');
  if (r.status !== 'completed' && (r.accepted !== null || r.verification !== null)) throw new Error('Incomplete accumulation claims verification');
  if (r.status !== 'completed' && [r.sameErrorRecurred, r.wrongExperienceApplied, r.humanRework, r.extraCostUSD].some((v) => v !== null)) throw new Error('Incomplete accumulation claims outcome metrics');
  if (r.status === 'completed') {
    if (r.runtime?.status !== 'completed' || r.runtime.reason !== null || r.runtime.toolCalls !== 0 || r.failure !== null || !r.verification) throw new Error('Accumulation completion lacks evidence');
    verifyProof(r.verification);
    if (r.verification.sourceTaskId !== r.task.id || r.verification.baseCommit !== r.task.baseCommit
      || r.verification.acceptanceDigest !== r.task.acceptanceDigest || r.accepted !== r.verification.verified) throw new Error('Accumulation proof belongs to another task');
  }
  if (a.feedback && (a.feedback.applicationId !== a.application.id || a.feedback.outcome !== 'accepted'
    || r.status !== 'completed' || r.accepted !== true || !r.verification?.verified || a.taskRecord.state !== 'closed')) throw new Error('Accepted feedback lacks successful application proof');
  let evaluationReport: object | null = null;
  if (e.evaluation) {
    const m = e.evaluation.manifest;
    const bankDigest = digest(JSON.stringify({ ...sourceBank, feedback: [a.feedback], applications: [a.application],
      feedbackTasks: [{ id: a.taskRecord.id, summary: a.taskRecord.summary, scope: a.taskRecord.scope }] }));
    if (!a.feedback || !r.verification || m.tasks.some((task) => task.baseCommit !== r.verification!.fixCommit)
      || !same(m.controls, e.controls) || m.repoId !== e.repoId || m.cliVersion !== e.cliVersion || m.environmentDigest !== e.environmentDigest
      || !same([...m.accumulationTaskIds].sort(), [ref.sourceTaskId, r.task.id].sort()) || m.tasks.length !== 2 || m.plans.length !== 6
      || m.plans.some((x) => x.replicate !== 0 || !same(x.experienceRefs, x.arm === 'evolve' ? [ref] : []))
      || m.experienceBankDigest !== bankDigest || m.bank.length !== 1 || !same({ id: m.bank[0]!.id, revision: m.bank[0]!.revision, sourceTaskId: m.bank[0]!.sourceTaskId }, ref)
      || m.bank[0]!.contextDigest !== digest(JSON.stringify({ ...ref, title: s.experience.title, strategy: s.experience.strategy }))
      || m.source.artifactDigest !== s.artifactDigest || m.source.replayTaskId !== ref.sourceTaskId || m.source.replayVerificationId !== s.verification.id
      || m.source.originalTaskId !== s.original.taskId || m.source.originalExperienceId !== s.original.experienceId || m.source.originalRevision !== s.original.revision) throw new Error('Evaluation lacks frozen accumulation linkage');
    const structural = evaluateFeedbackStructure(e.evaluation);
    const intended = m.plans.filter((x) => x.experienceRefs.length > 0);
    const offered = e.evaluation.runs.filter((x) => x.callStarted && intended.some((p) => p.runId === x.runId)).length;
    evaluationReport = { ...structural, experienceComparison: offered === 0 ? 'no_feedback_attempts'
      : offered < intended.length ? 'partial_planned_feedback_attempts' : 'planned_feedback_contrast_observed_benefit_unproven' };
  }
  const evaluationCalls = e.evaluation?.runs.filter((x) => x.callStarted).length ?? 0;
  const accumulationCalls = Number(r.callStarted);
  if (e.executionSource === 'prepare-only' && accumulationCalls + evaluationCalls > 0) throw new Error('Prepare-only record claims invocations');
  if (accumulationCalls + evaluationCalls > e.budget.maxCalls) throw new Error('Feedback call budget exceeded');
  if (e.status === 'completed' && (!e.evaluation || e.evaluation.runs.some((x) => !['completed', 'failed'].includes(x.status)))) throw new Error('Completed experiment has unfinished plans');
  const all = [r, ...(e.evaluation?.runs ?? [])];
  return { schemaVersion: 3, preliminary: true, evidenceKind: e.executionSource === 'agent' ? 'live-model-synthetic-feedback-transfer' : e.executionSource + '-feedback-transfer',
    status: e.status, failure: e.failure, protocolDigest: e.protocolDigest,
    calls: { maximum: 7, plannedAccumulation: 1, plannedEvaluation: 6, evaluationNotStarted: 6 - evaluationCalls,
      accumulation: accumulationCalls, evaluation: evaluationCalls, total: accumulationCalls + evaluationCalls,
      modelCalls: e.executionSource === 'agent' ? accumulationCalls + evaluationCalls : 0 },
    accumulation: { status: r.status, accepted: r.accepted, feedbackCreated: a.feedback !== null, runtime: r.runtime, failure: r.failure },
    evaluation: evaluationReport, totalObservedUsage: { known: all.filter((x) => x.runtime?.usage).length,
      unknown: all.filter((x) => !x.runtime?.usage).length + (e.evaluation ? 0 : 6),
      inputTokens: all.reduce((n, x) => n + (x.runtime?.usage?.inputTokens ?? 0), 0), outputTokens: all.reduce((n, x) => n + (x.runtime?.usage?.outputTokens ?? 0), 0) },
    limitation: 'Two authored synthetic transfer tasks, one replicate; not blind or real-world generalization. Offering context does not prove use or benefit. Accumulation cost is retained; money, manual rework and causality remain unknown.' };
}
