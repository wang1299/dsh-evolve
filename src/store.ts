import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { applicationSchema, experienceSchema, feedbackSchema, taskSchema, verificationSchema,
  type Application, type Experience, type Feedback, type Task, type Verification } from './domain.js';

export class Store {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('Unsupported database schema version'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS experiences(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, revision));
      CREATE TABLE IF NOT EXISTS verifications(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, application_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  private parse<T>(schema: z.ZodType<T>, row: Record<string, unknown> | undefined): T | null {
    return row ? schema.parse(JSON.parse(String(row.body))) : null;
  }
  task(id: string): Task | null { return this.parse(taskSchema, this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id)); }
  tasks(): Task[] { return this.db.prepare('SELECT body FROM tasks').all().map((r) => taskSchema.parse(JSON.parse(String(r.body)))); }
  putTask(task: Task): void {
    this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, JSON.stringify(taskSchema.parse(task)));
  }
  experience(id: string): Experience | null { return this.parse(experienceSchema, this.db.prepare('SELECT body FROM experiences WHERE id=?').get(id)); }
  experiences(): Experience[] { return this.db.prepare('SELECT body FROM experiences ORDER BY id').all().map((r) => experienceSchema.parse(JSON.parse(String(r.body)))); }
  history(id: string): Experience[] { return this.db.prepare('SELECT body FROM revisions WHERE id=? ORDER BY revision').all(id).map((r) => experienceSchema.parse(JSON.parse(String(r.body)))); }
  putExperience(experience: Experience): void {
    const item = experienceSchema.parse(experience);
    this.transaction(() => {
      const current = this.experience(item.id);
      if (item.revision !== (current?.revision ?? 0) + 1) throw new Error('Stale experience revision');
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(item.id, item.revision, JSON.stringify(item));
      this.db.prepare('INSERT INTO experiences VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body')
        .run(item.id, item.revision, JSON.stringify(item));
    });
  }
  putVerification(v: Verification): void { this.db.prepare('INSERT INTO verifications VALUES(?,?)').run(v.id, JSON.stringify(verificationSchema.parse(v))); }
  verification(id: string): Verification | null { return this.parse(verificationSchema, this.db.prepare('SELECT body FROM verifications WHERE id=?').get(id)); }
  putApplication(v: Application): void { this.db.prepare('INSERT INTO applications VALUES(?,?)').run(v.id, JSON.stringify(applicationSchema.parse(v))); }
  application(id: string): Application | null { return this.parse(applicationSchema, this.db.prepare('SELECT body FROM applications WHERE id=?').get(id)); }
  applications(): Application[] { return this.db.prepare('SELECT body FROM applications').all().map((r) => applicationSchema.parse(JSON.parse(String(r.body)))); }
  feedback(): Feedback[] { return this.db.prepare('SELECT body FROM feedback ORDER BY rowid').all().map((r) => feedbackSchema.parse(JSON.parse(String(r.body)))); }
  putFeedback(v: Feedback): boolean {
    const previous = this.parse(feedbackSchema, this.db.prepare('SELECT body FROM feedback WHERE id=?').get(v.id));
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(v)) return false;
      throw new Error('Feedback already recorded; append evidence through a revision');
    }
    this.db.prepare('INSERT INTO feedback VALUES(?,?,?)').run(v.id, v.applicationId, JSON.stringify(feedbackSchema.parse(v)));
    return true;
  }
  event(id: string, taskId: string, createdAt: string, body: object): void {
    this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?)').run(id, taskId, createdAt, JSON.stringify(body));
  }
  events(taskId: string): unknown[] { return this.db.prepare('SELECT body FROM events WHERE task_id=? ORDER BY created_at').all(taskId).map((r) => JSON.parse(String(r.body)) as unknown); }
  cleanEvidence(before: string): number { return Number(this.db.prepare('DELETE FROM events WHERE created_at < ?').run(before).changes); }
  transaction<T>(fn: () => T): T {
    this.db.exec('SAVEPOINT evolve_transaction');
    try { const result = fn(); this.db.exec('RELEASE evolve_transaction'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO evolve_transaction; RELEASE evolve_transaction'); throw error; }
  }
  close(): void { this.db.close(); }
}
