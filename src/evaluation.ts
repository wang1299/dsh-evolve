import { z } from 'zod';
import { hashSchema, idSchema } from './domain.js';

const name = z.string().min(1).max(200);
const nullableBoolean = z.boolean().nullable();
export const experimentSchema = z.object({
  schemaVersion: z.literal(1),
  accumulationTaskIds: z.array(name).min(1), evaluationTaskIds: z.array(name).min(1),
  runs: z.array(z.object({
    runId: idSchema, taskId: name, seed: z.number().int().nonnegative(),
    arm: z.enum(['baseline', 'retrieval', 'evolve']), source: z.enum(['agent', 'synthetic']),
    model: name, temperature: z.number().min(0).max(2),
    budget: z.object({ tokens: z.number().int().positive(), toolCalls: z.number().int().positive() }).strict(),
    environmentDigest: hashSchema, taskDigest: hashSchema, acceptanceDigest: hashSchema,
    basePromptDigest: hashSchema, agentConfigDigest: hashSchema, experienceBankDigest: hashSchema, policyDigest: hashSchema,
    experienceRefs: z.array(z.object({ id: idSchema, revision: z.number().int().positive(), sourceTaskId: name }).strict()).max(20), accepted: nullableBoolean,
    sameErrorRecurred: nullableBoolean, wrongExperienceApplied: nullableBoolean,
    humanRework: z.number().int().nonnegative().nullable(), extraCostUSD: z.number().finite().nonnegative().nullable(),
  }).strict()).min(3).max(100000),
}).strict();
export type Experiment = z.infer<typeof experimentSchema>;
export function evaluateExperiment(input: unknown): object {
  const experiment = experimentSchema.parse(input);
  const accumulation = new Set(experiment.accumulationTaskIds); const evaluation = new Set(experiment.evaluationTaskIds);
  if (accumulation.size !== experiment.accumulationTaskIds.length || evaluation.size !== experiment.evaluationTaskIds.length) throw new Error('Duplicate task identifiers');
  if ([...evaluation].some((id) => accumulation.has(id))) throw new Error('Accumulation and evaluation tasks overlap');
  const runIds = new Set<string>(); const conditions = new Map<string, Map<string, Experiment['runs'][number]>>();
  const policies = new Map<string, string>();
  const frozenControls = (run: Experiment['runs'][number]): string => JSON.stringify({ model: run.model, temperature: run.temperature,
    budget: run.budget, environment: run.environmentDigest, basePrompt: run.basePromptDigest, agentConfig: run.agentConfigDigest,
    experienceBank: run.experienceBankDigest, source: run.source });
  for (const run of experiment.runs) {
    if (!evaluation.has(run.taskId)) throw new Error('Run is outside frozen evaluation tasks');
    if (runIds.has(run.runId)) throw new Error('Duplicate runId'); runIds.add(run.runId);
    if (run.experienceRefs.some((ref) => !accumulation.has(ref.sourceTaskId))) throw new Error('Experience source leaks evaluation or unknown tasks');
    if (run.arm === 'baseline' && run.experienceRefs.length) throw new Error('Baseline must not receive experience');
    if (frozenControls(run) !== frozenControls(experiment.runs[0]!)) throw new Error('Frozen model/config/prompt/environment controls differ');
    if (policies.has(run.arm) && policies.get(run.arm) !== run.policyDigest) throw new Error('Arm policy changed during frozen evaluation');
    policies.set(run.arm, run.policyDigest);
    const key = JSON.stringify([run.taskId, run.seed]); const group = conditions.get(key) ?? new Map();
    if (group.has(run.arm)) throw new Error('Duplicate task/seed/arm'); group.set(run.arm, run); conditions.set(key, group);
  }
  for (const id of evaluation) if (![...conditions.values()].some((group) => group.get('baseline')?.taskId === id)) throw new Error('Evaluation task has no complete paired runs');
  for (const group of conditions.values()) {
    if (group.size !== 3) throw new Error('Missing comparison arm');
    const runs = [...group.values()];
    const controls = (run: Experiment['runs'][number]): string => JSON.stringify({ model: run.model, temperature: run.temperature, budget: run.budget,
      environment: run.environmentDigest, task: run.taskDigest, acceptance: run.acceptanceDigest, source: run.source,
      basePrompt: run.basePromptDigest, agentConfig: run.agentConfigDigest, experienceBank: run.experienceBankDigest });
    if (runs.some((run) => controls(run) !== controls(runs[0]!))) throw new Error('Comparison controls differ across arms');
  }
  const metrics = ['accepted', 'sameErrorRecurred', 'humanRework', 'wrongExperienceApplied', 'extraCostUSD'] as const;
  const groups = Object.fromEntries(['baseline', 'retrieval', 'evolve'].map((arm) => {
    const runs = experiment.runs.filter((run) => run.arm === arm);
    return [arm, { samples: runs.length, metrics: Object.fromEntries(metrics.map((metric) => {
      const values = runs.map((run) => run[metric]).filter((value) => value !== null).map(Number);
      return [metric, { known: values.length, unknown: runs.length - values.length,
        meanOfKnown: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
    })) }];
  }));
  const synthetic = experiment.runs.some((run) => run.source === 'synthetic');
  return { schemaVersion: 1, preliminary: true, evidenceKind: synthetic ? 'synthetic-format-check-only' : 'paired-agent-runs',
    limitation: synthetic ? 'Synthetic records do not demonstrate Agent improvement.' : 'No general improvement claim; inspect sample size, missing outcomes, raw failures and repeated seeds.',
    pairs: conditions.size, groups, rawRuns: experiment.runs };
}
