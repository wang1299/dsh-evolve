import { z } from 'zod';
import { hashSchema, idSchema, shaSchema } from './domain.js';

export const sourceRefSchema = z.object({ id: idSchema, digest: hashSchema, kind: z.enum(['correction', 'verification']) }).strict();
export const observationSchema = z.object({ id: z.string().min(1).max(200), createdAt: z.string().datetime(),
  kind: z.string().min(1).max(60), tool: z.string().max(100).optional() }).strict();
export const evidenceInputSchema = z.object({
  schemaVersion: z.literal(1), taskId: idSchema, repoId: hashSchema, taskDigest: hashSchema,
  baseCommit: shaSchema, fixCommit: shaSchema, dependencyDigest: hashSchema,
  mode: z.enum(['collect', 'verify']), policyDigest: hashSchema,
  repositoryState: z.enum(['clean', 'dirty', 'unavailable']), diff: z.string().max(8000), diffTruncated: z.boolean(),
  sources: z.array(sourceRefSchema).max(32), omittedSources: z.number().int().nonnegative(),
  observations: z.array(observationSchema).max(128), omittedObservations: z.number().int().nonnegative(),
}).strict().refine(v => Buffer.byteLength(JSON.stringify(v)) <= 128 * 1024, 'Evidence input exceeds 128 KiB');
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export const jobReasons = ['queued', 'claimed', 'completed', 'recovered_local', 'interrupted_verification', 'recovery_limit',
  'invalid_input', 'invalid_source', 'verification_error', 'cancelled_local'] as const;
export const learningJobSchema = z.object({
  id: idSchema, input: evidenceInputSchema, inputDigest: hashSchema,
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'unknown']),
  attempts: z.number().int().min(0).max(3), token: idSchema.nullable(), leaseUntil: z.number().int().nonnegative().nullable(),
  effectStarted: z.boolean(), reason: z.enum(jobReasons), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().refine(j => j.state === 'running' ? j.token !== null && j.leaseUntil !== null : j.token === null && j.leaseUntil === null);
export type LearningJob = z.infer<typeof learningJobSchema>;
export const attemptSchema = z.object({ jobId: idSchema, number: z.number().int().min(1).max(3), token: idSchema,
  phase: z.enum(['local', 'verification_started', 'published', 'failed', 'abandoned', 'unknown']),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable() }).strict();
export type LearningAttempt = z.infer<typeof attemptSchema>;
export const bundleReasons = ['no_source_verification', 'source_not_verified', 'no_commit_change',
  'dirty_tree', 'capture_unavailable', 'sources_omitted', 'events_omitted', 'diff_truncated', 'execution_disabled', 'policy_changed', 'repository_changed'] as const;
export const evidenceBundleSchema = z.object({ schemaVersion: z.literal(1), id: idSchema, inputDigest: hashSchema,
  verificationId: idSchema.nullable(), verificationDigest: hashSchema.nullable(), status: z.enum(['ready', 'incomplete']),
  reasons: z.array(z.enum(bundleReasons)).max(bundleReasons.length), createdAt: z.string().datetime(),
}).strict().refine(b => (b.status === 'ready') === (b.reasons.length === 0)
  && (b.verificationId === null) === (b.verificationDigest === null));
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
export class LostJobLease extends Error { constructor() { super('Evidence job lease lost'); } }
