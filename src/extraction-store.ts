import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { digest } from './domain.js';
import { extractionJobSchema, extractionPolicySchema, extractionUsageSchema,
  type ExtractionJob, type ExtractionPolicy, type ExtractionReason, type ExtractionUsage } from './extraction-domain.js';

export const extractionTablesSql = `
  CREATE TABLE IF NOT EXISTS extraction_grants(id TEXT PRIMARY KEY, policy_digest TEXT NOT NULL, max_calls INTEGER NOT NULL, used INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS extraction_jobs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
    repo_id TEXT NOT NULL, evidence_job_id TEXT NOT NULL REFERENCES learning_jobs(id), grant_id TEXT NOT NULL REFERENCES extraction_grants(id),
    policy TEXT NOT NULL, policy_digest TEXT NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL,
    input_digest TEXT, token TEXT, lease_until INTEGER, candidate_id TEXT REFERENCES experiences(id), usage TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(evidence_job_id,grant_id));
  CREATE INDEX IF NOT EXISTS extraction_queue ON extraction_jobs(repo_id,state,created_at);
  CREATE TABLE IF NOT EXISTS extraction_reauthorizations(original_job_id TEXT PRIMARY KEY REFERENCES extraction_jobs(id),
    new_job_id TEXT NOT NULL UNIQUE REFERENCES extraction_jobs(id), created_at TEXT NOT NULL);
`;
export class ExtractionStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T) {}
  private parse(r: Record<string, unknown>): ExtractionJob {
    return extractionJobSchema.parse({ id: r.id, taskId: r.task_id, repoId: r.repo_id, evidenceJobId: r.evidence_job_id,
      policy: JSON.parse(String(r.policy)), policyDigest: r.policy_digest, state: r.state, reason: r.reason,
      inputDigest: r.input_digest, token: r.token, leaseUntil: r.lease_until, candidateId: r.candidate_id,
      usage: r.usage === null ? null : JSON.parse(String(r.usage)), createdAt: r.created_at, updatedAt: r.updated_at });
  }
  job(id: string): ExtractionJob | null { const r = this.db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(id); return r ? this.parse(r) : null; }
  jobs(): ExtractionJob[] { return this.db.prepare('SELECT * FROM extraction_jobs ORDER BY created_at,id').all().map(r => this.parse(r)); }
  reauthorizations(): { originalJobId: string; newJobId: string; createdAt: string }[] {
    return this.db.prepare('SELECT * FROM extraction_reauthorizations ORDER BY created_at,original_job_id').all()
      .map(r => ({ originalJobId: String(r.original_job_id), newJobId: String(r.new_job_id), createdAt: String(r.created_at) }));
  }
  grants(): { id: string; policyDigest: string; maxCalls: number; used: number }[] {
    return this.db.prepare('SELECT * FROM extraction_grants ORDER BY id').all().map(r => ({ id: String(r.id), policyDigest: String(r.policy_digest), maxCalls: Number(r.max_calls), used: Number(r.used) }));
  }
  enqueue(taskId: string, repoId: string, evidenceJobId: string, inputPolicy: ExtractionPolicy): ExtractionJob {
    return this.transaction(() => {
      this.db.prepare('UPDATE tasks SET body=body WHERE id=?').run(taskId);
      const old = this.db.prepare(`SELECT * FROM extraction_jobs j WHERE evidence_job_id=?
        AND NOT EXISTS(SELECT 1 FROM extraction_reauthorizations r WHERE r.new_job_id=j.id) ORDER BY created_at,id LIMIT 1`).get(evidenceJobId);
      if (!old) return this.insert(taskId, repoId, evidenceJobId, inputPolicy);
      const parsed = this.parse(old); const policy = extractionPolicySchema.parse(inputPolicy);
      if (policy.grantId === parsed.policy.grantId && digest(JSON.stringify(policy)) !== parsed.policyDigest) throw new Error('Extraction grant configuration is immutable');
      return parsed;
    });
  }
  /** Called only after the owner's validation under the task write lock. */
  appendReauthorization(original: ExtractionJob, policy: ExtractionPolicy): ExtractionJob {
    return this.transaction(() => {
      const next = this.insert(original.taskId, original.repoId, original.evidenceJobId, policy);
      this.db.prepare('INSERT INTO extraction_reauthorizations VALUES(?,?,?)').run(original.id, next.id, new Date().toISOString());
      return next;
    });
  }
  private insert(taskId: string, repoId: string, evidenceJobId: string, inputPolicy: ExtractionPolicy): ExtractionJob {
    const policy = extractionPolicySchema.parse(inputPolicy); const body = JSON.stringify(policy); const hash = digest(body);
    return this.transaction(() => {
      // This write locks before checking immutable grant configuration across connections.
      this.db.prepare('INSERT INTO extraction_grants VALUES(?,?,?,0) ON CONFLICT(id) DO NOTHING').run(policy.grantId, hash, policy.maxCalls);
      const grant = this.db.prepare('SELECT * FROM extraction_grants WHERE id=?').get(policy.grantId)!;
      if (grant.policy_digest !== hash || grant.max_calls !== policy.maxCalls) throw new Error('Extraction grant configuration is immutable; use a new explicitly authorized grant ID');
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO extraction_jobs VALUES(?,?,?,?,?,?,?,'waiting','evidence_pending',NULL,NULL,NULL,NULL,NULL,?,?)`)
        .run(randomUUID(), taskId, repoId, evidenceJobId, policy.grantId, body, hash, now, now);
      return this.parse(this.db.prepare('SELECT * FROM extraction_jobs WHERE evidence_job_id=? AND grant_id=?').get(evidenceJobId, policy.grantId)!);
    });
  }
  recover(repoId: string, now: number): void {
    this.db.prepare(`UPDATE extraction_jobs SET state='unknown',reason='interrupted_model',token=NULL,lease_until=NULL,updated_at=?
      WHERE repo_id=? AND state='running' AND lease_until<=?`).run(new Date(now).toISOString(), repoId, now);
  }
  wait(id: string, reason: 'evidence_pending' | 'model_unavailable'): void {
    this.db.prepare("UPDATE extraction_jobs SET reason=?,updated_at=? WHERE id=? AND state='waiting' AND reason<>?")
      .run(reason, new Date().toISOString(), id, reason);
  }
  block(id: string, reason: ExtractionReason): void {
    this.db.prepare("UPDATE extraction_jobs SET state='blocked',reason=?,updated_at=? WHERE id=? AND state='waiting'")
      .run(reason, new Date().toISOString(), id);
  }
  claim(id: string, inputDigest: string, now: number, validate: () => void = () => {}): ExtractionJob | null {
    return this.transaction(() => {
      this.db.prepare("UPDATE extraction_jobs SET updated_at=updated_at WHERE id=? AND state='waiting'").run(id);
      const job = this.job(id); if (job?.state !== 'waiting') return null;
      validate();
      const count = this.db.prepare('UPDATE extraction_grants SET used=used+1 WHERE id=? AND policy_digest=? AND used<max_calls')
        .run(job.policy.grantId, job.policyDigest);
      if (!count.changes) { this.block(id, 'quota_exhausted'); return null; }
      const token = randomUUID();
      this.db.prepare(`UPDATE extraction_jobs SET state='running',reason='model_started',input_digest=?,token=?,lease_until=?,updated_at=? WHERE id=?`)
        .run(inputDigest, token, now + job.policy.timeoutMs + 5000, new Date(now).toISOString(), id);
      return this.job(id)!;
    });
  }
  complete(job: ExtractionJob, now: number, state: 'candidate' | 'abstained' | 'failed' | 'unknown', reason: ExtractionReason,
    usage: ExtractionUsage | null, publish: () => string | null = () => null): boolean {
    const checkedUsage = usage === null ? null : extractionUsageSchema.parse(usage);
    return this.transaction(() => {
      // Keep running until the callback succeeds: state and candidate are one atomic publication.
      const lock = this.db.prepare(`UPDATE extraction_jobs SET updated_at=updated_at WHERE id=? AND token=? AND state='running' AND lease_until>? AND input_digest=?`)
        .run(job.id, job.token, now, job.inputDigest);
      if (!lock.changes) return false;
      const candidateId = publish();
      if ((state === 'candidate') !== (candidateId !== null)) throw new Error('Extraction publication mismatch');
      this.db.prepare(`UPDATE extraction_jobs SET state=?,reason=?,token=NULL,lease_until=NULL,candidate_id=?,usage=?,updated_at=? WHERE id=?`)
        .run(state, reason, candidateId, checkedUsage === null ? null : JSON.stringify(checkedUsage), new Date(now).toISOString(), job.id);
      return true;
    });
  }
}
