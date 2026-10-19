import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';

test('v1 database preserves history, migrates feedback and invalidates aggregate-only verification', async () => {
  const f = await fixture(); const path = join(f.home, 'legacy.sqlite');
  const original = new Store(path);
  const service = new EvolveService(original, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  const task = service.begin('legacy', 'rollback');
  const candidate = service.propose(task.id, { title: 'rollback', strategy: 'restore state', observedFacts: ['state changed'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
  const verificationId = randomUUID();
  original.putExperience({ ...candidate, revision: 2, status: 'source_verified', verificationId });
  const app = { id: randomUUID(), taskId: task.id, experienceId: candidate.id, revision: 2, reason: 'legacy application', createdAt: new Date().toISOString() };
  original.putApplication(app); original.close();
  const raw = new DatabaseSync(path);
  raw.exec('DROP TABLE feedback; CREATE TABLE feedback(id TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL); PRAGMA user_version=1;');
  const run = { exitCode: 0, tests: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, timedOut: false, summary: '' };
  const oldReport = { schemaVersion: 1, id: verificationId, sourceTaskId: task.id, repoId: task.scope.repoId,
    baseCommit: task.baseCommit, fixCommit: task.baseCommit, acceptanceDigest: 'a'.repeat(64), acceptanceFiles: [{ path: 'test_old.py', content: 'def test_old(): pass' }],
    environment: {}, commands: [], base: { ...run, exitCode: 1, failures: 1 }, fixed: run, regression: run,
    verified: true, reason: 'legacy aggregate-only verification', diff: '', createdAt: new Date().toISOString() };
  raw.prepare('INSERT INTO verifications VALUES(?,?)').run(verificationId, JSON.stringify(oldReport));
  const oldFeedback = { id: randomUUID(), applicationId: app.id, outcome: 'unknown', note: 'not yet evaluated', extraCost: null, humanRework: null, createdAt: new Date().toISOString() };
  raw.prepare('INSERT INTO feedback VALUES(?,?,?)').run(oldFeedback.id, app.id, JSON.stringify(oldFeedback)); raw.close();
  const migrated = new Store(path);
  try {
    assert.equal(migrated.feedback().length, 1);
    assert.equal(migrated.experience(candidate.id)?.status, 'candidate');
    assert.equal(migrated.history(candidate.id).length, 3);
    assert.equal(migrated.history(candidate.id)[1]?.status, 'source_verified');
    assert.equal(migrated.verification(verificationId)?.verified, false);
    assert.equal(migrated.verification(verificationId)?.schemaVersion, 2);
    migrated.putFeedback({ ...oldFeedback, id: randomUUID(), outcome: 'counterexample', note: 'later independent failure' });
    assert.equal(migrated.feedback().length, 2);
  } finally { migrated.close(); }
  const reopened = new Store(path);
  assert.equal(reopened.history(candidate.id).length, 3); reopened.close();
});

test('failed legacy migration rolls back format and tables; unknown versions are left untouched', async () => {
  const f = await fixture(); const path = join(f.home, 'failed-migration.sqlite'); const original = new Store(path); original.close();
  const raw = new DatabaseSync(path);
  raw.exec('DROP TABLE fact_citations; DROP TABLE evidence; DROP TABLE feedback; CREATE TABLE feedback(id TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL); PRAGMA user_version=1');
  raw.prepare('INSERT INTO verifications VALUES(?,?)').run(randomUUID(), JSON.stringify({ malformed: 'synthetic old report' }));
  const previous = raw.prepare("SELECT sql FROM sqlite_master WHERE name='feedback'").get()!.sql; raw.close();
  assert.throws(() => new Store(path));
  const checked = new DatabaseSync(path);
  assert.equal(checked.prepare('PRAGMA user_version').get()!.user_version, 1);
  assert.equal(checked.prepare("SELECT sql FROM sqlite_master WHERE name='feedback'").get()!.sql, previous);
  assert.equal(checked.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('evidence','fact_citations')").get()!.n, 0);
  checked.exec('PRAGMA user_version=99'); checked.close();
  assert.throws(() => new Store(path), /Unsupported/);
  const unchanged = new DatabaseSync(path); assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 99); unchanged.close();
});
