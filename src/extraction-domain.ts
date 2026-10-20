import { z } from 'zod';
import { hashSchema, idSchema, textSchema } from './domain.js';

export const extractionPolicySchema = z.object({
  grantId: idSchema,
  provider: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/),
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/),
  maxCalls: z.number().int().min(1).max(100),
  maxTokens: z.number().int().min(128).max(4096).default(2048),
  timeoutMs: z.number().int().min(100).max(120000).default(30000),
}).strict();
export type ExtractionPolicy = z.output<typeof extractionPolicySchema>;
export const extractionUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().safe(), outputTokens: z.number().int().nonnegative().safe(),
  totalTokens: z.number().int().nonnegative().safe().optional(),
  cacheReadTokens: z.number().int().nonnegative().safe().optional(),
  cacheWriteTokens: z.number().int().nonnegative().safe().optional(),
  reasoningTokens: z.number().int().nonnegative().safe().optional(),
}).strict();
export type ExtractionUsage = z.infer<typeof extractionUsageSchema>;
export const extractionOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('abstain') }).strict(),
  z.object({ kind: z.literal('candidate'), title: z.string().trim().min(1).max(160), strategy: textSchema,
    factIds: z.array(z.string().min(1).max(100)).min(1).max(12).refine(v => new Set(v).size === v.length),
    inferences: z.array(textSchema).max(12), recommendations: z.array(textSchema).max(12),
  }).strict(),
]);
export const extractionStateSchema = z.enum(['waiting', 'running', 'candidate', 'abstained', 'blocked', 'failed', 'unknown']);
export const modelFailureReasons = ['model_prepare_failed', 'model_route_changed', 'model_credentials_missing', 'model_transport_failed',
  'model_timed_out', 'model_cancelled', 'model_incomplete', 'interrupted_model'] as const;
export type ModelFailureReason = typeof modelFailureReasons[number];
export const extractionReasonSchema = z.enum(['evidence_pending', 'model_unavailable', 'model_started', 'extracted', 'model_abstained',
  'evidence_incomplete', 'evidence_failed', 'policy_revoked', 'quota_exhausted', 'invalid_material', 'repository_changed',
  'invalid_response', ...modelFailureReasons]);
export type ExtractionReason = z.infer<typeof extractionReasonSchema>;
export const extractionJobSchema = z.object({
  id: idSchema, taskId: idSchema, repoId: hashSchema, evidenceJobId: idSchema,
  policy: extractionPolicySchema, policyDigest: hashSchema,
  state: extractionStateSchema, reason: extractionReasonSchema,
  inputDigest: hashSchema.nullable(), token: idSchema.nullable(), leaseUntil: z.number().int().nonnegative().nullable(),
  candidateId: idSchema.nullable(), usage: extractionUsageSchema.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().refine(v => v.state === 'running' ? v.token !== null && v.leaseUntil !== null && v.inputDigest !== null : v.token === null && v.leaseUntil === null)
  .refine(v => (v.state === 'candidate') === (v.candidateId !== null));
export type ExtractionJob = z.infer<typeof extractionJobSchema>;
export interface ExtractionRequest { policy: ExtractionPolicy; material: string; signal: AbortSignal }
export interface ExtractionResult { text: string; usage: ExtractionUsage | null }
export type ExtractionPort = (request: ExtractionRequest) => Promise<ExtractionResult>;
export class InvalidExtractionResponse extends Error { constructor() { super('Invalid bounded extraction response'); } }
/** Carries only a host-owned category; never retains provider error text or cause. */
export class ExtractionModelFailure extends Error {
  readonly reason: ModelFailureReason;
  constructor(reason: ModelFailureReason) {
    const safe = modelFailureReasons.includes(reason) ? reason : 'interrupted_model';
    super('Extraction failed: ' + safe); this.reason = safe;
  }
}
