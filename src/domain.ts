import { z } from 'zod';
import { createHash } from 'node:crypto';

export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const idSchema = z.string().uuid();
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const textSchema = z.string().trim().min(1).max(4000);
export const relativePath = z.string().min(1).max(240).refine(
  (p) => !p.startsWith('/') && !/[:\\\x00-\x1f]/.test(p) && p.split('/').every((s) => s !== '..' && s !== '' && s !== '.'),
  'Expected a safe repository-relative path',
);
export function redact(value: string, limit = 4000): string {
  return value
    .replace(/\b(?:sk-|gh[pousr]_)[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(?:api[_-]?key|password|secret|token|authorization)\s*[=:]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^\s"'<>]+/g, '[LOCAL_PATH]')
    .slice(0, limit);
}
export const scopeSchema = z.object({
  repoId: hashSchema,
  dependencyDigest: hashSchema,
  requiredFiles: z.record(relativePath, hashSchema).refine((v) => Object.keys(v).length <= 20),
}).strict();
export type Scope = z.infer<typeof scopeSchema>;
export const taskSchema = z.object({
  schemaVersion: z.literal(1), id: idSchema, sessionId: z.string().min(1).max(128),
  summary: textSchema, scope: scopeSchema, baseCommit: shaSchema,
  state: z.enum(['open', 'closed']), createdAt: z.string().datetime(),
}).strict();
export type Task = z.infer<typeof taskSchema>;
export const candidateSchema = z.object({
  title: z.string().trim().min(1).max(160), strategy: textSchema,
  observedFacts: z.array(textSchema).min(1).max(12),
  inferences: z.array(textSchema).max(12), recommendations: z.array(textSchema).max(12),
  requiredFiles: z.array(relativePath).min(1).max(20),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const experienceSchema = z.object({
  schemaVersion: z.literal(1), id: idSchema, revision: z.number().int().positive(),
  sourceTaskId: idSchema, title: z.string().min(1).max(160), strategy: textSchema,
  observedFacts: z.array(textSchema).min(1).max(12), inferences: z.array(textSchema).max(12),
  recommendations: z.array(textSchema).max(12), scope: scopeSchema,
  status: z.enum(['candidate', 'source_verified', 'disabled']), reason: textSchema,
  verificationId: idSchema.nullable(), createdAt: z.string().datetime(),
}).strict();
export type Experience = z.infer<typeof experienceSchema>;
export const runSchema = z.object({
  exitCode: z.number().int().nullable(), tests: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(), errors: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(), durationMs: z.number().nonnegative(),
  timedOut: z.boolean(), summary: z.string().max(2000),
  cases: z.array(z.object({ id: z.string().min(1).max(2000), status: z.enum(['passed', 'failed', 'error', 'skipped']) }).strict()).max(10000),
}).strict();
export type TestRun = z.infer<typeof runSchema>;
export const verificationSchema = z.object({
  schemaVersion: z.literal(2), id: idSchema, sourceTaskId: idSchema, repoId: hashSchema,
  baseCommit: shaSchema, fixCommit: shaSchema, acceptanceDigest: hashSchema,
  acceptanceFiles: z.array(z.object({ path: relativePath, content: z.string().max(65536) }).strict()).min(1).max(100),
  environment: z.record(z.string(), z.string()), commands: z.array(z.array(z.string())),
  base: runSchema, fixed: runSchema, regression: runSchema,
  verified: z.boolean(), reason: textSchema, diff: z.string().max(8000), createdAt: z.string().datetime(),
}).strict();
export type Verification = z.infer<typeof verificationSchema>;
export const applicationSchema = z.object({
  id: idSchema, taskId: idSchema, experienceId: idSchema, revision: z.number().int().positive(),
  reason: textSchema, createdAt: z.string().datetime(),
}).strict();
export type Application = z.infer<typeof applicationSchema>;
export const feedbackSchema = z.object({
  id: idSchema, applicationId: idSchema, outcome: z.enum(['accepted', 'rejected', 'counterexample', 'unknown']),
  note: textSchema, extraCost: z.number().finite().nonnegative().nullable(),
  humanRework: z.number().int().nonnegative().nullable(), createdAt: z.string().datetime(),
}).strict();
export type Feedback = z.infer<typeof feedbackSchema>;
