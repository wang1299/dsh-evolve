import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { digest, type Verification } from './domain.js';
import { evidenceInputSchema, evidenceBundleSchema, learningJobSchema, attemptSchema, LostJobLease,
  type EvidenceInput, type EvidenceBundle, type LearningJob, type LearningAttempt } from './learning-domain.js';

export const learningTablesSql = `
  CREATE TABLE IF NOT EXISTS learning_jobs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
    repo_id TEXT NOT NULL, input_digest TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL,
    attempts INTEGER NOT NULL, token TEXT, lease_until INTEGER, effect_started INTEGER NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS learning_queue ON learning_jobs(repo_id,state,created_at);
  CREATE TABLE IF NOT EXISTS learning_attempts(job_id TEXT NOT NULL REFERENCES learning_jobs(id), number INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE, phase TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, PRIMARY KEY(job_id,number));
  CREATE TABLE IF NOT EXISTS learning_job_sources(job_id TEXT NOT NULL REFERENCES learning_jobs(id),
    evidence_id TEXT NOT NULL REFERENCES evidence(id), PRIMARY KEY(job_id,evidence_id));
  CREATE TABLE IF NOT EXISTS evidence_bundles(job_id TEXT PRIMARY KEY REFERENCES learning_jobs(id), body TEXT NOT NULL);
`;

/** Internal same-host queue. Conditional writes fence every attempt, including local recovery. */
export class LearningStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T) {}
  private parse(row: Record<string, unknown>): LearningJob {
    return learningJobSchema.parse({ id: row.id, input: JSON.parse(String(row.input)), inputDigest: row.input_digest,
      state: row.state, attempts: row.attempts, token: row.token, leaseUntil: row.lease_until,
      effectStarted: row.effect_started === 1, reason: row.reason, createdAt: row.created_at, updatedAt: row.updated_at });
  }
  job(id: string): LearningJob | null {
    const row = this.db.prepare('SELECT * FROM learning_jobs WHERE id=?').get(id); return row ? this.parse(row) : null;
  }
  forTask(taskId: string): LearningJob | null {
    const row = this.db.prepare('SELECT * FROM learning_jobs WHERE task_id=?').get(taskId); return row ? this.parse(row) : null;
  }
  jobs(): LearningJob[] { return this.db.prepare('SELECT * FROM learning_jobs ORDER BY created_at,id').all().map(r => this.parse(r)); }
  attempts(id: string): LearningAttempt[] {
    return this.db.prepare('SELECT * FROM learning_attempts WHERE job_id=? ORDER BY number').all(id).map(r => attemptSchema.parse({
      jobId: r.job_id, number: r.number, token: r.token, phase: r.phase, startedAt: r.started_at, finishedAt: r.finished_at }));
  }
  bundle(id: string): EvidenceBundle | null {
    const row = this.db.prepare('SELECT body FROM evidence_bundles WHERE job_id=?').get(id);
    return row ? evidenceBundleSchema.parse(JSON.parse(String(row.body))) : null;
  }
  bundles(): EvidenceBundle[] { return this.db.prepare('SELECT body FROM evidence_bundles ORDER BY job_id').all().map(r => evidenceBundleSchema.parse(JSON.parse(String(r.body)))); }
  enqueue(value: EvidenceInput): LearningJob {
    const input = evidenceInputSchema.parse(value); const body = JSON.stringify(input); const now = new Date().toISOString();
    return this.transaction(() => {
      const id = randomUUID();
      const inserted = this.db.prepare(`INSERT INTO learning_jobs VALUES(?,?,?,?,?,'queued',0,NULL,NULL,0,'queued',?,?)
        ON CONFLICT(task_id) DO NOTHING`).run(id, input.taskId, input.repoId, digest(body), body, now, now);
      if (inserted.changes) for (const ref of input.sources) this.db.prepare('INSERT INTO learning_job_sources VALUES(?,?)').run(id, ref.id);
      return this.forTask(input.taskId)!;
    });
  }
  claim(repoId: string, now: number, leaseMs: number): LearningJob | null {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 600000) throw new Error('Invalid job clock or lease');
    const stamp = new Date(now).toISOString();
    return this.transaction(() => {
      // First operation is a write: serialize recovery and claiming across SQLite connections.
      const expired = this.db.prepare(`UPDATE learning_jobs SET
        state=CASE WHEN effect_started=1 THEN 'unknown' WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
        reason=CASE WHEN effect_started=1 THEN 'interrupted_verification' WHEN attempts>=3 THEN 'recovery_limit' ELSE 'recovered_local' END,
        token=NULL,lease_until=NULL,updated_at=? WHERE repo_id=? AND state='running' AND lease_until<=? RETURNING id,attempts,effect_started`).all(stamp, repoId, now);
      for (const row of expired) this.db.prepare('UPDATE learning_attempts SET phase=?,finished_at=? WHERE job_id=? AND number=?')
        .run(row.effect_started === 1 ? 'unknown' : 'abandoned', stamp, String(row.id), Number(row.attempts));
      const token = randomUUID();
      const row = this.db.prepare(`UPDATE learning_jobs SET state='running',attempts=attempts+1,token=?,lease_until=?,effect_started=0,
        reason='claimed',updated_at=? WHERE id=(SELECT id FROM learning_jobs WHERE repo_id=? AND state='queued' AND attempts<3 ORDER BY created_at,id LIMIT 1)
        AND state='queued' RETURNING *`).get(token, now + leaseMs, stamp, repoId);
      if (!row) return null;
      const job = this.parse(row);
      this.db.prepare("INSERT INTO learning_attempts VALUES(?,?,?,'local',?,NULL)").run(job.id, job.attempts, token, stamp);
      return job;
    });
  }
  renew(id: string, token: string, now: number, leaseMs: number): boolean {
    return this.db.prepare("UPDATE learning_jobs SET lease_until=? WHERE id=? AND token=? AND state='running' AND lease_until>?")
      .run(now + leaseMs, id, token, now).changes === 1;
  }
  beginVerification(id: string, token: string, now: number): void {
    this.transaction(() => {
      if (this.db.prepare("UPDATE learning_jobs SET effect_started=1 WHERE id=? AND token=? AND state='running' AND lease_until>? AND effect_started=0")
        .run(id, token, now).changes !== 1) throw new LostJobLease();
      this.db.prepare("UPDATE learning_attempts SET phase='verification_started' WHERE job_id=? AND token=?").run(id, token);
    });
  }
  complete(id: string, token: string, now: number, value: EvidenceBundle, publishProof: () => Verification | null): void {
    const bundle = evidenceBundleSchema.parse(value);
    this.transaction(() => {
      const row = this.db.prepare(`UPDATE learning_jobs SET state='succeeded',token=NULL,lease_until=NULL,reason='completed',updated_at=?
        WHERE id=? AND token=? AND state='running' AND lease_until>? AND input_digest=? RETURNING *`)
        .get(new Date(now).toISOString(), id, token, now, bundle.inputDigest);
      if (!row || bundle.id !== id) throw new LostJobLease();
      const proof = publishProof();
      if (proof) this.db.prepare('INSERT OR IGNORE INTO learning_job_sources VALUES(?,?)').run(id, proof.id);
      this.db.prepare('INSERT INTO evidence_bundles VALUES(?,?)').run(id, JSON.stringify(bundle));
      this.db.prepare("UPDATE learning_attempts SET phase='published',finished_at=? WHERE job_id=? AND token=?")
        .run(new Date(now).toISOString(), id, token);
    });
  }
  fail(id: string, token: string, now: number, reason: 'invalid_input' | 'invalid_source' | 'verification_error' | 'cancelled_local'): void {
    this.transaction(() => {
      const stamp = new Date(now).toISOString();
      const row = this.db.prepare(`UPDATE learning_jobs SET state=CASE WHEN effect_started=1 THEN 'unknown' WHEN ?='cancelled_local' AND attempts<3 THEN 'queued' ELSE 'failed' END,
        reason=CASE WHEN effect_started=1 THEN 'interrupted_verification' WHEN ?='cancelled_local' AND attempts>=3 THEN 'recovery_limit' ELSE ? END,token=NULL,lease_until=NULL,updated_at=?
        WHERE id=? AND token=? AND state='running' AND lease_until>? RETURNING state`).get(reason, reason, reason, stamp, id, token, now);
      if (row) this.db.prepare('UPDATE learning_attempts SET phase=?,finished_at=? WHERE job_id=? AND token=?')
        .run(row.state === 'unknown' ? 'unknown' : row.state === 'queued' ? 'abandoned' : 'failed', stamp, id, token);
    });
  }
}
