import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { ExtractionPolicy } from '../src/extraction-domain.js';

test('bounded diagnostic observations do not replace or prevent independent repair verification', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  try {
    const service = new EvolveService(store, f.repo, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python',
      acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 }, true);
    const task = service.begin('long-source', 'restore transaction balance');
    service.correction(task.id, 'Restore balance when the transaction fails.');
    // Recording the correction also emits one bounded metadata event.
    for (let i = 0; i < 169; i++) service.observe('long-source', 'diagnostic-' + i, 'tool_result', 'synthetic-diagnostic');
    await f.fix(); service.finish(task.id); await service.jobs.runNext();
    const job = store.learning.forTask(task.id)!; const bundle = store.learning.bundle(job.id)!;
    assert.equal(job.input.observations.length, 128); assert.equal(job.input.omittedObservations, 42);
    assert.equal(bundle.status, 'ready'); const proof = store.verification(bundle.verificationId!)!;
    assert.equal(proof.verified, true); assert.equal(proof.base.failures, 1);
    assert.equal(proof.fixed.failures, 0); assert.equal(proof.regression.failures, 0);
    assert.equal(store.experiences().length, 0);
  } finally { store.close(); }
});

async function legacyBlocked() {
  const f = await fixture(); const path = join(f.home, 'recovery.sqlite'); const store = new Store(path);
  const policy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 };
  const extraction: ExtractionPolicy = { grantId: randomUUID(), provider: 'offline-fixture', model: 'scripted', maxCalls: 1, maxTokens: 2048, timeoutMs: 30000 };
  const service = new EvolveService(store, f.repo, policy, true, extraction);
  const task = service.begin('legacy-source', 'restore transaction balance'); service.correction(task.id, 'Restore balance on failure.');
  for (let i = 0; i < 169; i++) service.observe(task.sessionId, 'diagnostic-' + i, 'tool_result', 'synthetic-diagnostic');
  await f.fix(); service.finish(task.id);
  // Reconstruct the persisted pre-fix outcome, without invoking a model or fabricating proof.
  const job = store.learning.claim(task.scope.repoId, Date.now(), 10000)!;
  store.learning.complete(job.id, job.token!, Date.now(), { schemaVersion: 1, id: job.id, inputDigest: job.inputDigest,
    verificationId: null, verificationDigest: null, status: 'incomplete', reasons: ['events_omitted', 'no_source_verification'], createdAt: new Date().toISOString() }, () => null);
  store.extraction.block(store.extraction.jobs()[0]!.id, 'evidence_incomplete');
  return { f, path, store, service, task, job: store.learning.job(job.id)!, policy, extraction };
}

test('explicit recovery appends once, preserves original history and shares the unused model grant', async () => {
  const r = await legacyBlocked(); const other = new Store(r.path);
  try {
    const originalJob = JSON.stringify(r.store.learning.job(r.job.id));
    const originalBundle = JSON.stringify(r.store.learning.bundle(r.job.id));
    const originalExtraction = JSON.stringify(r.store.extraction.jobs()[0]);
    const recovered = r.service.recoverEvidence(r.task.id, r.job.id);
    const second = new EvolveService(other, r.f.repo, r.policy, true, r.extraction);
    assert.equal(second.recoverEvidence(r.task.id, r.job.id).id, recovered.id);
    assert.equal(recovered.state, 'queued'); assert.equal(recovered.inputDigest, r.job.inputDigest);
    assert.equal(r.store.learning.jobs().length, 2); assert.equal(r.store.extraction.jobs().length, 2);
    assert.equal(r.store.learning.recoveries()[0]!.originalJobId, r.job.id);
    assert.equal(r.store.extraction.grants()[0]!.used, 0);
    assert.equal(r.store.learning.job(recovered.id)!.effectStarted, false);
    await second.jobs.runNext(); const bundle = other.learning.bundle(recovered.id)!;
    assert.equal(bundle.status, 'ready'); assert.equal(other.verification(bundle.verificationId!)!.verified, true);
    let calls = 0;
    await second.extraction.runNext(async () => { calls++; return { text: JSON.stringify({ kind: 'candidate', title: 'Restore prior state',
      strategy: 'For this transaction restore the previous balance on failure.', factIds: ['verification:base', 'verification:fixed'], inferences: [], recommendations: [] }), usage: null }; });
    assert.equal(calls, 1); assert.equal(other.experiences()[0]!.status, 'candidate');
    assert.equal(other.extraction.grants()[0]!.used, 1);
    assert.equal(second.recoverEvidence(r.task.id, r.job.id).id, recovered.id);
    assert.equal(await second.extraction.runNext(async () => { calls++; throw new Error('must not replay'); }), false);
    assert.equal(calls, 1); assert.throws(() => second.recoverEvidence(r.task.id, recovered.id), /chain/i);
    assert.equal(JSON.stringify(r.store.learning.job(r.job.id)), originalJob);
    assert.equal(JSON.stringify(r.store.learning.bundle(r.job.id)), originalBundle);
    assert.equal(JSON.stringify(r.store.extraction.jobs().find(j => j.evidenceJobId === r.job.id)), originalExtraction);
  } finally { other.close(); r.store.close(); }
});

test('recovery rejects started work, changed sources, revoked policy and dirty repositories without resetting grant', async () => {
  for (const kind of ['started-verification', 'unknown', 'started-model', 'used-grant', 'new-source', 'revoked-policy', 'changed-grant', 'dirty-code']) {
    const r = await legacyBlocked(); const raw = new DatabaseSync(r.path);
    try {
      if (kind === 'started-verification') raw.prepare('UPDATE learning_jobs SET effect_started=1 WHERE id=?').run(r.job.id);
      if (kind === 'unknown') raw.prepare("UPDATE learning_jobs SET state='unknown' WHERE id=?").run(r.job.id);
      if (kind === 'started-model') raw.prepare("UPDATE extraction_jobs SET state='unknown',input_digest=? WHERE evidence_job_id=?").run('a'.repeat(64), r.job.id);
      if (kind === 'used-grant') raw.prepare('UPDATE extraction_grants SET used=1').run();
      if (kind === 'new-source') r.store.putEvidence({ ...r.store.evidenceRecords()[0]!, id: randomUUID() });
      if (kind === 'dirty-code') await writeFile(join(r.f.repo, 'ledger.py'), '# changed\n');
      const service = kind === 'revoked-policy' ? new EvolveService(r.store, r.f.repo, r.policy, false, r.extraction)
        : kind === 'changed-grant' ? new EvolveService(r.store, r.f.repo, r.policy, true, { ...r.extraction, grantId: randomUUID() }) : r.service;
      assert.throws(() => service.recoverEvidence(r.task.id, r.job.id), /recovery|authorization|version|source|started/i, kind);
      assert.equal(r.store.learning.recoveries().length, 0); assert.equal(r.store.learning.jobs().length, 1);
      assert.equal(r.store.extraction.jobs().length, 1); assert.equal(r.store.extraction.grants()[0]!.used, kind === 'used-grant' ? 1 : 0);
    } finally { raw.close(); r.store.close(); }
  }
});

test('v5 migration keeps frozen JSON, links and grant usage while enforcing foreign keys after return', async () => {
  const r = await legacyBlocked(); r.store.close();
  const raw = new DatabaseSync(r.path);
  raw.exec(`DROP TABLE learning_recoveries;
    CREATE UNIQUE INDEX legacy_learning_task ON learning_jobs(task_id);
    CREATE UNIQUE INDEX legacy_extraction_task ON extraction_jobs(task_id);
    PRAGMA user_version=5;`);
  const beforeJob = raw.prepare('SELECT * FROM learning_jobs').get(); const beforeExtraction = raw.prepare('SELECT * FROM extraction_jobs').get();
  const beforeBundle = raw.prepare('SELECT body FROM evidence_bundles').get(); const beforeGrant = raw.prepare('SELECT * FROM extraction_grants').get();
  raw.close(); const migrated = new Store(r.path);
  try {
    const check = new DatabaseSync(r.path);
    try {
      assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 7);
      assert.deepEqual(check.prepare('SELECT * FROM learning_jobs').get(), beforeJob);
      assert.deepEqual(check.prepare('SELECT * FROM extraction_jobs').get(), beforeExtraction);
      assert.deepEqual(check.prepare('SELECT body FROM evidence_bundles').get(), beforeBundle);
      assert.deepEqual(check.prepare('SELECT * FROM extraction_grants').get(), beforeGrant);
      assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { check.close(); }
    const service = new EvolveService(migrated, r.f.repo, r.policy, true, r.extraction);
    service.recoverEvidence(r.task.id, r.job.id);
    assert.equal(migrated.learning.jobs().length, 2);
    assert.throws(() => migrated.learning.enqueue({ ...r.job.input, taskId: randomUUID() }), /FOREIGN KEY/i);
  } finally { migrated.close(); }
});

test('failed v6 initialization rolls back schema and owner CLI only queues explicit recovery', async () => {
  const r = await legacyBlocked(); r.store.close(); const raw = new DatabaseSync(r.path);
  raw.exec('DROP TABLE learning_recoveries; PRAGMA user_version=5; CREATE TABLE learning_jobs_v6(blocker TEXT)');
  const before = raw.prepare('SELECT * FROM learning_jobs').get(); raw.close();
  assert.throws(() => new Store(r.path)); const failed = new DatabaseSync(r.path);
  assert.equal(failed.prepare('PRAGMA user_version').get()!.user_version, 5);
  assert.deepEqual(failed.prepare('SELECT * FROM learning_jobs').get(), before);
  assert.equal(failed.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='learning_recoveries'").get()!.n, 0);
  failed.exec('DROP TABLE learning_jobs_v6'); failed.close();
  const configPath = join(r.f.home, 'config.json');
  await writeFile(configPath, JSON.stringify({ repoRoot: r.f.repo, dataDir: r.f.home, executionTrusted: true, backgroundVerification: true,
    acceptanceDir: r.f.acceptance, python: r.policy.python, timeoutMs: r.policy.timeoutMs, extraction: r.extraction }));
  // createService uses evolve.sqlite; this fixture uses recovery.sqlite instead.
  const { copyFile } = await import('node:fs/promises'); await copyFile(r.path, join(r.f.home, 'evolve.sqlite'));
  const args = [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'recover-evidence', '--config', configPath,
    '--task-id', r.task.id, '--expected-job', r.job.id];
  const run = () => promisify(execFile)(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const outputs = await Promise.all([run(), run()]);
  const result = JSON.parse(outputs[0]!.stdout); assert.equal(JSON.parse(outputs[1]!.stdout).recoveryJobId, result.recoveryJobId);
  assert.equal(result.executed, false); assert.equal(result.state, 'queued');
  const reopened = new Store(join(r.f.home, 'evolve.sqlite'));
  try { assert.equal(reopened.learning.job(result.recoveryJobId)!.effectStarted, false); assert.equal(reopened.extraction.grants()[0]!.used, 0);
    assert.equal(reopened.learning.recoveries().length, 1); assert.equal(reopened.learning.jobs().length, 2); }
  finally { reopened.close(); }
});
