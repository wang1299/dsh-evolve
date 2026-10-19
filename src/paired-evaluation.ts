import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { codexControlSchema, type ExperienceContext } from './codex-runner.js';
import { digest, hashSchema, idSchema, shaSchema, verificationSchema } from './domain.js';
import type { EvolveService } from './service.js';
import type { Store } from './store.js';
import { passes, verifiedCases } from './verification.js';
import { rankText, retrievalPolicyDigest } from './retrieval.js';

export const arms = ['baseline', 'retrieval', 'evolve'] as const;
export type Arm = typeof arms[number];
const armSchema = z.enum(arms);
const refSchema = z.object({ id: idSchema, revision: z.number().int().positive(), sourceTaskId: idSchema }).strict();
const controlsSchema = codexControlSchema.extend({
  model: codexControlSchema.shape.model.unwrap(), reasoningEffort: codexControlSchema.shape.reasoningEffort.unwrap(),
  providerRetries: z.literal(0), maxToolCalls: z.literal(0),
}).strict();
const taskSchema = z.object({ id: idSchema, taskDigest: hashSchema, sourceDigest: hashSchema, baseCommit: shaSchema,
  basePromptDigest: hashSchema, acceptanceDigest: hashSchema }).strict();
const planSchema = z.object({ runId: idSchema, taskId: idSchema, replicate: z.number().int().nonnegative(), arm: armSchema,
  promptDigest: hashSchema, experienceRefs: z.array(refSchema).max(1), policyDigest: hashSchema,
  selectionReasons: z.array(z.string().min(1).max(4000)).max(100) }).strict();
const runtimeSchema = z.object({ status: z.enum(['completed', 'failed']), reason: z.string().min(1).max(200).nullable(),
  controls: controlsSchema, transport: z.literal('https'), toolCalls: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(), usage: z.object({ inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict().nullable(),
}).strict();
const runSchema = z.object({
  runId: idSchema, status: z.enum(['not_started', 'running', 'completed', 'failed', 'unknown']),
  callStarted: z.boolean(),
  runtime: runtimeSchema.nullable(), cliVersion: z.string().min(1).max(100),
  environmentDigest: hashSchema, experienceBankDigest: hashSchema, task: taskSchema,
  promptDigest: hashSchema, experienceRefs: z.array(refSchema).max(1),
  verification: verificationSchema.nullable(), accepted: z.boolean().nullable(),
  failure: z.string().min(1).max(200).nullable(), sameErrorRecurred: z.boolean().nullable(),
  wrongExperienceApplied: z.boolean().nullable(), humanRework: z.number().int().nonnegative().nullable(),
  extraCostUSD: z.number().finite().nonnegative().nullable(),
}).strict();
export const pairedExperimentSchema = z.object({
  schemaVersion: z.literal(2), kind: z.literal('codex-synthetic-paired'),
  manifest: z.object({ id: idSchema, controls: controlsSchema, cliVersion: z.string().min(1).max(100),
    temperature: z.null(), samplingSeed: z.null(), serverModelRevision: z.null(), tokenHardLimit: z.null(), costHardLimitUSD: z.null(), inputByteLimit: z.literal(32768),
    limitations: z.array(z.string().min(1).max(2000)).min(1).max(20),
    environmentDigest: hashSchema, experienceBankDigest: hashSchema, repoId: hashSchema,
    accumulationTaskIds: z.array(idSchema).min(1).max(1000), tasks: z.array(taskSchema).min(1).max(1000),
    bank: z.array(refSchema.extend({ contextDigest: hashSchema }).strict()).max(1000),
    source: z.object({ artifactDigest: hashSchema, originalTaskId: idSchema, originalExperienceId: idSchema,
      originalRevision: z.number().int().positive(), replayTaskId: idSchema, replayVerificationId: idSchema }).strict(),
    plans: z.array(planSchema).min(3).max(10000),
  }).strict(), runs: z.array(runSchema).min(3).max(10000),
}).strict();
export type PairedExperiment = z.infer<typeof pairedExperimentSchema>;
export type PairedRun = PairedExperiment['runs'][number];
export type PairedPlan = PairedExperiment['manifest']['plans'][number];
const same = (a: unknown, b: unknown): boolean => digest(JSON.stringify(a)) === digest(JSON.stringify(b));

/** This recipe intends to offer experience; ordinary product abstention remains valid. */
export function requireExperienceExposure(plans: PairedPlan[]): void {
  if (plans.some((p) => p.arm !== 'baseline' && p.experienceRefs.length === 0)) throw new Error('experience_exposure_missing');
}

export const legacyPolicyDigests: Record<Arm, string> = {
  baseline: digest('baseline/v1: no experience'),
  retrieval: digest('retrieval/v1: lexical coverage >= 0.15; top 1; ID tie break; no source/scope/utility filter'),
  evolve: digest('evolve/v1: EvolveService.select; verified source + scope + 0.7 similarity + 0.3 smoothed feedback; top 1'),
};
export const policyDigests: Record<Arm, string> = {
  baseline: legacyPolicyDigests.baseline,
  retrieval: digest('retrieval/v2: ' + retrievalPolicyDigest + '; top 1; ID tie break; no source/scope/utility filter'),
  evolve: digest('evolve/v2: ' + retrievalPolicyDigest + '; verified source + scope before indexing + 0.7 text + 0.3 smoothed feedback; top 1'),
};

/** Freeze all inputs affecting selection, excluding new applications that have no feedback. */
export function experienceBankDigest(store: Store): string {
  const experiences = store.experiences(); const feedback = store.feedback();
  const usedApplications = new Set(feedback.map((f) => f.applicationId));
  return digest(JSON.stringify({ experiences, proofs: experiences.map((e) => e.verificationId ? store.verification(e.verificationId) : null),
    feedback, applications: store.applications().filter((a) => usedApplications.has(a.id)).sort((a, b) => a.id.localeCompare(b.id)),
    feedbackTasks: [...new Set(store.applications().filter((a) => usedApplications.has(a.id)).map((a) => a.taskId))].sort()
      .map((id) => { const t = store.task(id); return t ? { id: t.id, summary: t.summary, scope: t.scope } : { id, missing: true }; }) }));
}

export function selectComparisonExperience(service: EvolveService, taskId: string, arm: Arm): {
  context: ExperienceContext | null; reasons: string[];
} {
  const task = service.requireTask(taskId);
  if (task.state !== 'open') throw new Error('Task is closed');
  if (service.store.feedback().some((f) => f.outcome === 'irrelevant')) throw new Error('Frozen bm25-v1 recipe does not support irrelevant feedback');
  if (arm === 'baseline') return { context: null, reasons: ['baseline_no_experience'] };
  let selected;
  let reasons: string[];
  if (arm === 'evolve') {
    const result = service.select(taskId, 'bm25-v1'); selected = result.experience; reasons = result.reasons;
  } else {
    const experiences = service.store.experiences();
    const ranked = rankText(task.summary, experiences).filter((r) => r.reason === null);
    selected = experiences.find((e) => e.id === ranked[0]?.id);
    reasons = [selected ? 'bm25-v1:text_only=' + ranked[0]!.score.toFixed(3) : 'no_text_match'];
  }
  return { context: selected ? { id: selected.id, revision: selected.revision, sourceTaskId: selected.sourceTaskId,
    title: selected.title, strategy: selected.strategy } : null, reasons };
}

/** A durable per-plan slot is never released. Interrupted runs remain consumed and unknown. */
export async function reservePairedRun(directory: string, plan: PairedPlan): Promise<string> {
  const value = planSchema.parse(plan); const path = join(directory, '.run-' + value.runId + '.json');
  const file = await open(path, 'wx');
  try { await file.writeFile(JSON.stringify({ plan: value, reservedAt: new Date().toISOString() }, null, 2)); }
  finally { await file.close(); }
  return path;
}

export function evaluatePairedExperiment(input: unknown): object {
  const experiment = pairedExperimentSchema.parse(input); const m = experiment.manifest;
  const accumulation = new Set(m.accumulationTaskIds); const tasks = new Map(m.tasks.map((t) => [t.id, t]));
  if (accumulation.size !== m.accumulationTaskIds.length || tasks.size !== m.tasks.length) throw new Error('Duplicate task identifiers');
  if ([...tasks.keys()].some((id) => accumulation.has(id))) throw new Error('Accumulation and evaluation tasks overlap');
  if (!accumulation.has(m.source.replayTaskId)) throw new Error('Replay source is outside accumulation tasks');
  const bank = new Map(m.bank.map((r) => [r.id + ':' + r.revision, r]));
  if (bank.size !== m.bank.length || m.bank.some((r) => !accumulation.has(r.sourceTaskId))) throw new Error('Bank duplicates or evaluation leakage');
  const plans = new Map<string, PairedPlan>(); const groups = new Map<string, Set<Arm>>();
  const armPolicies = new Map<Arm, string>();
  for (const p of m.plans) {
    if (plans.has(p.runId)) throw new Error('Duplicate planned runId'); plans.set(p.runId, p);
    if (!tasks.has(p.taskId)) throw new Error('Plan uses unknown task');
    if (![policyDigests[p.arm], legacyPolicyDigests[p.arm]].includes(p.policyDigest)) throw new Error('Unrecognized arm policy');
    if (armPolicies.has(p.arm) && armPolicies.get(p.arm) !== p.policyDigest) throw new Error('Mixed policies within an arm');
    armPolicies.set(p.arm, p.policyDigest);
    if (p.arm === 'baseline' && p.experienceRefs.length) throw new Error('Baseline must not receive experience');
    const basePrompt = tasks.get(p.taskId)!.basePromptDigest;
    if ((p.experienceRefs.length === 0) !== (p.promptDigest === basePrompt)) throw new Error('Prompt exposure contradicts experience references');
    for (const ref of p.experienceRefs) {
      const stored = bank.get(ref.id + ':' + ref.revision);
      if (!stored || stored.sourceTaskId !== ref.sourceTaskId) throw new Error('Experience source leaks evaluation or unknown bank');
    }
    const key = p.taskId + ':' + p.replicate; const group = groups.get(key) ?? new Set<Arm>();
    if (group.has(p.arm)) throw new Error('Duplicate task/replicate/arm'); group.add(p.arm); groups.set(key, group);
  }
  if ([...tasks.keys()].some((id) => !m.plans.some((p) => p.taskId === id)) || [...groups.values()].some((g) => g.size !== 3)) throw new Error('Missing comparison arm');
  if ((armPolicies.get('retrieval') === legacyPolicyDigests.retrieval)
    !== (armPolicies.get('evolve') === legacyPolicyDigests.evolve)) throw new Error('Mixed retrieval generations across arms');
  const ids = new Set<string>();
  for (const r of experiment.runs) {
    if (ids.has(r.runId)) throw new Error('Duplicate actual runId'); ids.add(r.runId);
    const plan = plans.get(r.runId); if (!plan) throw new Error('Unknown run reference');
    if (r.cliVersion !== m.cliVersion || r.environmentDigest !== m.environmentDigest || r.experienceBankDigest !== m.experienceBankDigest
      || !same(r.task, tasks.get(plan.taskId)) || r.promptDigest !== plan.promptDigest || !same(r.experienceRefs, plan.experienceRefs)) throw new Error('Frozen controls/task/bank/prompt differ');
    if (r.runtime && (!same(r.runtime.controls, m.controls) || r.runtime.transport !== 'https')) throw new Error('Runtime controls differ');
    if (r.runtime && !r.callStarted) throw new Error('Runtime requires a started invocation');
    if (r.status === 'not_started' && r.callStarted) throw new Error('Not-started run cannot claim an invocation');
    if (r.status === 'completed' && (r.runtime?.status !== 'completed' || r.runtime.reason !== null || r.runtime.toolCalls !== 0 || r.failure !== null || !r.verification)) throw new Error('Completed run lacks zero-tool runtime and verification');
    if (r.runtime?.status === 'failed' && r.runtime.reason === null) throw new Error('Failed runtime must retain a reason');
    if (r.accepted !== null && (r.status !== 'completed' || !r.verification || r.accepted !== r.verification.verified)) throw new Error('Acceptance must come from completed independent verification');
    if (r.verification) {
      const v = r.verification;
      if (r.status !== 'completed' || v.baseCommit !== r.task.baseCommit || v.fixCommit === v.baseCommit || v.acceptanceDigest !== r.task.acceptanceDigest || v.repoId !== m.repoId
        || v.sourceTaskId !== plan.taskId || r.accepted === null || digest(JSON.stringify(v.environment)) !== m.environmentDigest) throw new Error('Verification does not belong to frozen task/environment');
      const files = [...v.acceptanceFiles].sort((a, b) => a.path.localeCompare(b.path));
      if (new Set(files.map((f) => f.path)).size !== files.length || digest(files.map((f) => `${f.path}:${digest(f.content)}`).join('\n')) !== v.acceptanceDigest) throw new Error('Verification acceptance inputs differ from their digest');
      // A serialized boolean alone cannot bypass the independent test identities and exit statuses.
      if (v.verified !== (verifiedCases(v.base, v.fixed) && passes(v.regression))) throw new Error('Verification pass lacks independent failing-to-passing evidence');
    }
    if (['not_started', 'running', 'unknown'].includes(r.status) && (r.runtime !== null || r.verification !== null || r.accepted !== null)) throw new Error('Unfinished run must keep results unknown');
    if (r.status !== 'completed' && [r.sameErrorRecurred, r.wrongExperienceApplied, r.humanRework, r.extraCostUSD].some((v) => v !== null)) throw new Error('Unfinished outcome metrics must remain unknown');
  }
  if (ids.size !== plans.size) throw new Error('Missing planned run record');
  const metrics = ['accepted', 'sameErrorRecurred', 'wrongExperienceApplied', 'humanRework', 'extraCostUSD'] as const;
  const groupsReport = Object.fromEntries(arms.map((arm) => {
    const runs = experiment.runs.filter((r) => plans.get(r.runId)!.arm === arm);
    const started = runs.filter((r) => r.callStarted);
    const accepted = runs.filter((r) => r.accepted === true).length;
    return [arm, { planned: runs.length, attempts: started.length, accepted,
      experienceOfferedAttempts: started.filter((r) => plans.get(r.runId)!.experienceRefs.length > 0).length,
      notCompleted: runs.filter((r) => r.status !== 'completed').length,
      acceptedPerAttempt: started.length ? accepted / started.length : null,
      metrics: Object.fromEntries(metrics.map((metric) => {
        const values = runs.map((r) => r[metric]).filter((v) => v !== null).map(Number);
        return [metric, { known: values.length, unknown: runs.length - values.length,
          meanOfKnown: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
      })),
      usage: { known: runs.filter((r) => r.runtime?.usage).length, unknown: runs.filter((r) => !r.runtime?.usage).length,
        totalObservedInputTokens: runs.reduce((n, r) => n + (r.runtime?.usage?.inputTokens ?? 0), 0),
        totalObservedOutputTokens: runs.reduce((n, r) => n + (r.runtime?.usage?.outputTokens ?? 0), 0) },
    }];
  }));
  const treatmentPlans = m.plans.filter((p) => p.arm !== 'baseline');
  const treatmentAttempts = experiment.runs.filter((r) => r.callStarted && plans.get(r.runId)!.arm !== 'baseline');
  const exposed = treatmentAttempts.filter((r) => plans.get(r.runId)!.experienceRefs.length > 0).length;
  return { schemaVersion: 2, preliminary: true, evidenceKind: 'live-model-synthetic-paired', pairs: groups.size,
    plannedExperienceGroups: treatmentPlans.filter((p) => p.experienceRefs.length > 0).length,
    experienceComparison: treatmentAttempts.length === 0 ? 'no_treatment_attempts' : exposed === 0 ? 'no_experience_exposure'
      : exposed < treatmentPlans.length ? 'partial_experience_exposure' : 'experience_offered_benefit_unproven',
    limitations: m.limitations, groups: groupsReport, rawRuns: experiment.runs };
}
