import { z } from 'zod';
import { hashSchema, idSchema } from '../src/domain.js';

export const installedScenarios = ['happy', 'invalid-extraction', 'sharing-off', 'failed-target'] as const;
const proof = z.object({ verified: z.boolean(), baseFailures: z.number().int().nonnegative(), fixedFailures: z.number().int().nonnegative(), regressionFailures: z.number().int().nonnegative() }).strict();
export const installedReportSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('installed-scripted-auto-learning'), scenario: z.enum(installedScenarios),
  archiveDigest: hashSchema, realModel: z.literal(false), modelHttpRequests: z.literal(0), benefitEvaluated: z.literal(false),
  phase: z.enum(['passed', 'partial']), reason: z.enum(['completed', 'extraction_invalid', 'sharing_disabled', 'target_rejected', 'unexpected_failure']),
  stage: z.enum(['initialize', 'source_repair', 'automatic_candidate', 'source_verify', 'target_delivery', 'target_acceptance', 'feedback', 'completed']),
  sourceTaskId: idSchema.nullable(), targetTaskId: idSchema.nullable(), experienceId: idSchema.nullable(), revision: z.number().int().positive().nullable(),
  autoCandidateCreated: z.boolean(), candidateInitiallyInactive: z.boolean(), sourceVerified: z.boolean(),
  receiptReturned: z.boolean(), modelContinued: z.boolean(), experienceOffered: z.boolean(), targetAccepted: z.boolean().nullable(), feedbackRecorded: z.boolean(),
  extractionState: z.enum(['missing', 'waiting', 'running', 'candidate', 'abstained', 'blocked', 'failed', 'unknown']),
  logicalExtractions: z.number().int().min(0).max(1), scriptedAgentCalls: z.number().int().min(0).max(14),
  sourceProof: proof.nullable(), targetProof: proof.nullable(),
  tools: z.array(z.object({ name: z.string().max(100), isError: z.boolean() }).strict()).max(12),
  counts: z.object({ tasks: z.number().int().min(0).max(2), experiences: z.number().int().min(0).max(1), applications: z.number().int().min(0).max(1), feedback: z.number().int().min(0).max(1) }).strict(),
}).strict().superRefine((r, ctx) => {
  const fail = (message: string): void => ctx.addIssue({ code: 'custom', message });
  if (r.experienceOffered && (!r.sourceVerified || !r.receiptReturned || !r.modelContinued || r.counts.applications !== 1)) fail('Selection alone does not prove delivery');
  if (r.feedbackRecorded && (!r.targetAccepted || !r.targetProof?.verified || !r.experienceOffered || r.counts.feedback !== 1)) fail('Feedback requires independent target acceptance and actual delivery');
  if (r.targetAccepted === true && !r.targetProof?.verified) fail('No self-reported target acceptance');
  if (r.sourceVerified && (!r.autoCandidateCreated || !r.candidateInitiallyInactive || !r.sourceProof?.verified)) fail('Automatic candidate and independent source proof required');
  if (r.tools.some(t => t.name === 'evolve_propose_experience' || t.name === 'evolve_link_fact_evidence')) fail('Manual candidates cannot establish the automatic path');
  if (r.phase === 'passed' && (r.scenario !== 'happy' || r.reason !== 'completed' || r.stage !== 'completed' || !r.autoCandidateCreated || !r.candidateInitiallyInactive
    || !r.sourceVerified || !r.experienceOffered || r.targetAccepted !== true || !r.feedbackRecorded || r.extractionState !== 'candidate'
    || r.logicalExtractions !== 1 || !r.sourceTaskId || !r.targetTaskId || !r.experienceId || r.revision !== 2
    || r.counts.tasks !== 2 || r.counts.experiences !== 1 || r.counts.applications !== 1 || r.counts.feedback !== 1)) fail('Incomplete automatic learning cannot pass');
});
export type InstalledReport = z.infer<typeof installedReportSchema>;
