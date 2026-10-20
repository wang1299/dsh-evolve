import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { digest, hashSchema, idSchema } from './domain.js';
import { workspaceVersionSchema } from './workspace-snapshots.js';

export const segmentSchema = z.object({
  id: idSchema, repoId: hashSchema, sessionId: z.string().min(1).max(128), turn: z.number().int().positive(),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(8), messageKey: hashSchema,
  taskId: idSchema.nullable(), base: workspaceVersionSchema.nullable(), fixed: workspaceVersionSchema.nullable(),
  policyDigest: hashSchema, owner: idSchema, ownerPid: z.number().int().positive(),
  state: z.enum(['capturing', 'open', 'queued', 'qualifying', 'learned', 'skipped', 'blocked', 'unknown']),
  reason: z.string().min(1).max(120), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type AutomaticSegment = z.infer<typeof segmentSchema>;
export const automaticProofDigest = (s: AutomaticSegment): string => digest(JSON.stringify({ repoId: s.repoId, taskId: s.taskId, messageIds: s.messageIds, base: s.base, fixed: s.fixed, policyDigest: s.policyDigest }));
export const automaticTablesSql = `
CREATE TABLE IF NOT EXISTS automatic_locks(repo_id TEXT PRIMARY KEY, generation INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS automatic_segments(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, session_id TEXT NOT NULL,
 turn INTEGER NOT NULL, message_key TEXT NOT NULL, task_id TEXT UNIQUE REFERENCES tasks(id), state TEXT NOT NULL, body TEXT NOT NULL,
 UNIQUE(repo_id,session_id,turn), UNIQUE(repo_id,message_key));
CREATE INDEX IF NOT EXISTS automatic_state ON automatic_segments(repo_id,state);
`;
export class AutomaticStore {
  readonly snapshotDirectory: string | null;
  constructor(private readonly db: DatabaseSync, path: string, private readonly transaction: <T>(fn: () => T) => T) {
    this.snapshotDirectory = path === ':memory:' ? null : join(dirname(path), 'private-snapshots.git');
  }
  rows(): AutomaticSegment[] { return this.db.prepare('SELECT body FROM automatic_segments ORDER BY rowid').all().map(r => segmentSchema.parse(JSON.parse(String(r.body)))); }
  get(id: string): AutomaticSegment | null { return this.rows().find(s => s.id === id) ?? null; }
  forTask(id: string): AutomaticSegment | null { return this.rows().find(s => s.taskId === id) ?? null; }
  write(segment: AutomaticSegment): void {
    const s = segmentSchema.parse(segment);
    this.db.prepare(`INSERT INTO automatic_segments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id,state=excluded.state,body=excluded.body`)
      .run(s.id, s.repoId, s.sessionId, s.turn, s.messageKey, s.taskId, s.state, JSON.stringify(s));
  }
  lock(repoId: string): void { this.db.prepare('INSERT INTO automatic_locks VALUES(?,1) ON CONFLICT(repo_id) DO UPDATE SET generation=generation+1').run(repoId); }
  reserve(input: Pick<AutomaticSegment, 'repoId' | 'sessionId' | 'turn' | 'messageIds' | 'messageKey' | 'policyDigest' | 'owner'>): { segment: AutomaticSegment; fresh: boolean } {
    return this.transaction(() => {
      this.lock(input.repoId);
      const existing = this.rows().find(s => s.repoId === input.repoId && ((s.sessionId === input.sessionId && s.turn === input.turn) || s.messageKey === input.messageKey));
      if (existing) return { segment: existing, fresh: false };
      const active = this.rows().filter(s => s.repoId === input.repoId && ['capturing', 'open'].includes(s.state));
      const now = new Date().toISOString();
      for (const old of active) this.write({ ...old, state: 'blocked', reason: 'concurrent_request', updatedAt: now });
      const s: AutomaticSegment = { ...input, id: randomUUID(), taskId: null, base: null, fixed: null, ownerPid: process.pid,
        state: active.length ? 'blocked' : 'capturing', reason: active.length ? 'concurrent_request' : 'capturing_baseline', createdAt: now, updatedAt: now };
      this.write(s); return { segment: s, fresh: true };
    });
  }
  transition(id: string, from: AutomaticSegment['state'], patch: Partial<AutomaticSegment>): AutomaticSegment | null {
    return this.transaction(() => {
      if (!this.db.prepare('UPDATE automatic_segments SET state=state WHERE id=? AND state=?').run(id, from).changes) return null;
      const old = this.get(id)!; const next = { ...old, ...patch, updatedAt: new Date().toISOString() }; this.write(next); return next;
    });
  }
}
