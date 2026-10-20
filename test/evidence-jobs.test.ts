import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as pause } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';
import { EvidenceJobs } from '../src/evidence-jobs.js';
import { verificationEvidence } from '../src/evidence.js';
import { digest } from '../src/domain.js';
import type { EvidenceBundle, LearningJob } from '../src/learning-domain.js';
import { startPanel } from '../src/panel.js';

test('finish durably queues one task-evidence job without requiring a candidate', async () => {
  const f = await fixture(); const path = join(f.home, 'jobs.sqlite'); const store = new Store(path);
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  try {
    const task = service.begin('source', 'repair transaction rollback');
    service.correction(task.id, 'Restore the balance after failure.'); await f.fix();
    service.finish(task.id); service.finish(task.id);
    assert.ok('learning' in store, 'A durable evidence queue must be available after task closure');
    const jobs = store.learning.jobs();
    assert.equal(jobs.length, 1); assert.equal(jobs[0]!.state, 'queued'); assert.equal(store.experiences().length, 0);
  } finally { store.close(); }
});

const policyFor = (acceptanceDir: string, trusted = false) => ({ trusted, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir, regressionPath: 'tests', timeoutMs: 10000 });
const incomplete = (job: LearningJob): EvidenceBundle => ({ schemaVersion: 1, id: job.id, inputDigest: job.inputDigest,
  verificationId: null, verificationDigest: null, status: 'incomplete', reasons: ['no_source_verification'], createdAt: new Date().toISOString() });

test('a queued task resumes after restart and default assembly never executes or creates experience', async () => {
  const f = await fixture(); const path = join(f.home, 'restart.sqlite'); let store = new Store(path);
  const service = new EvolveService(store, f.repo, policyFor(f.acceptance, true));
  const task = service.begin('restart', 'restore transaction'); service.correction(task.id, 'Undo state after failure.');
  await f.fix(); service.finish(task.id); const id = store.learning.jobs()[0]!.id; store.close();
  store = new Store(path); let calls = 0;
  try {
    const worker = new EvidenceJobs(store, f.repo, policyFor(f.acceptance, true), false, async () => { calls++; throw new Error('must not run'); });
    assert.equal(await worker.runNext(), true); assert.equal(calls, 0);
    assert.equal(store.learning.job(id)?.state, 'succeeded'); const bundle = store.learning.bundle(id)!;
    assert.equal(bundle.status, 'incomplete'); assert.ok(bundle.reasons.includes('execution_disabled'));
    assert.equal(await worker.runNext(), false); assert.equal(store.learning.attempts(id).length, 1); assert.equal(store.experiences().length, 0);
  } finally { store.close(); }
});

test('authorized background pytest builds a traceable ready repair bundle without a candidate or invented correction', async () => {
  const f = await fixture(); const path = join(f.home, 'verified.sqlite'); let store = new Store(path);
  const service = new EvolveService(store, f.repo, policyFor(f.acceptance, true), true);
  const task = service.begin('verified', 'restore transaction balance');
  service.observe('verified', 'tool-failure', 'tool_transport_error', 'pytest'); await f.fix(); service.finish(task.id); store.close();
  store = new Store(path);
  try {
    const resumed = new EvolveService(store, f.repo, policyFor(f.acceptance, true), true); await resumed.jobs.runNext();
    const job = store.learning.jobs()[0]!; const bundle = store.learning.bundle(job.id)!;
    assert.equal(bundle.status, 'ready'); assert.deepEqual(bundle.reasons, []); assert.equal(job.effectStarted, true);
    const proof = store.verification(bundle.verificationId!)!;
    assert.equal(proof.verified, true); assert.equal(proof.base.failures, 1); assert.equal(proof.fixed.failures, 0); assert.equal(proof.regression.failures, 0);
    assert.equal(bundle.verificationDigest, digest(JSON.stringify(proof))); assert.equal(proof.sourceTaskId, task.id);
    assert.equal(job.input.baseCommit, f.base); assert.equal(job.input.fixCommit, proof.fixCommit); assert.match(job.input.diff, /before/);
    assert.equal(store.evidenceRecords().filter(e => e.kind === 'correction').length, 0);
    assert.equal(store.experiences().length, 0); assert.equal(await resumed.jobs.runNext(), false);
    const cleared = store.cleanEvidenceWithRetention('2100-01-01T00:00:00.000Z'); assert.equal(cleared.removedUnreferencedSources, 0);
    assert.ok(store.evidence(proof.id)); assert.ok(store.learning.bundle(job.id));
  } finally { store.close(); }
});

test('revoked authorization, dirty code and changed policy prevent background execution', async () => {
  const f = await fixture(); const policy = policyFor(f.acceptance, true); const stores = [new Store(':memory:'), new Store(':memory:'), new Store(':memory:'), new Store(':memory:')];
  try {
    const services = stores.map((s, i) => new EvolveService(s, f.repo, i === 3 ? policyFor(f.acceptance) : policy, i !== 0));
    const tasks = services.map((s, i) => s.begin('owner-' + i, 'restore transaction'));
    await f.fix(); services[0]!.finish(tasks[0]!.id); services[1]!.finish(tasks[1]!.id); services[3]!.finish(tasks[3]!.id);
    await writeFile(join(f.repo, 'ledger.py'), '# uncommitted repair\n'); services[2]!.finish(tasks[2]!.id);
    let calls = 0; const never = async () => { calls++; throw new Error('must not execute'); };
    await new EvidenceJobs(stores[0]!, f.repo, policy, false, never).runNext();
    await new EvidenceJobs(stores[1]!, f.repo, policy, false, never).runNext();
    await new EvidenceJobs(stores[2]!, f.repo, policy, true, never).runNext();
    await new EvidenceJobs(stores[3]!, f.repo, policyFor(f.acceptance), true, never).runNext();
    assert.equal(calls, 0);
    assert.ok(stores[0]!.learning.bundles()[0]!.reasons.includes('execution_disabled'));
    assert.ok(stores[1]!.learning.bundles()[0]!.reasons.includes('policy_changed'));
    assert.ok(stores[2]!.learning.bundles()[0]!.reasons.includes('dirty_tree'));
    assert.equal(stores[3]!.learning.jobs()[0]!.input.mode, 'collect'); assert.ok(stores[3]!.learning.bundles()[0]!.reasons.includes('execution_disabled'));
  } finally { for (const store of stores) store.close(); }
});

test('expired local claims recover with a new token and stale publication cannot commit any proof', async () => {
  const f = await fixture(); const path = join(f.home, 'leases.sqlite'); const a = new Store(path); const b = new Store(path);
  try {
    const service = new EvolveService(a, f.repo, policyFor(f.acceptance)); const task = service.begin('lease', 'repair'); service.finish(task.id);
    const now = Date.now(); const first = a.learning.claim(task.scope.repoId, now, 100)!;
    assert.equal(b.learning.claim(task.scope.repoId, now + 50, 100), null);
    const second = b.learning.claim(task.scope.repoId, now + 101, 100)!;
    assert.notEqual(second.token, first.token); assert.equal(second.attempts, 2);
    assert.equal(a.learning.renew(first.id, first.token!, now + 102, 100), false);
    assert.throws(() => a.learning.beginVerification(first.id, first.token!, now + 102), /lease/i);
    let published = 0;
    assert.throws(() => a.learning.complete(first.id, first.token!, now + 102, incomplete(first), () => { published++; return null; }), /lease/i);
    assert.equal(published, 0); assert.equal(a.learning.bundle(first.id), null);
    b.learning.complete(second.id, second.token!, now + 102, incomplete(second), () => null);
    assert.equal(a.learning.job(first.id)?.state, 'succeeded'); assert.deepEqual(a.learning.attempts(first.id).map(x => x.phase), ['abandoned', 'published']);
  } finally { a.close(); b.close(); }
});

test('a crashed verification qualification becomes terminal unknown, while local recovery is bounded', async () => {
  const f = await fixture(); const path = join(f.home, 'unknown.sqlite'); let store = new Store(path);
  try {
    const service = new EvolveService(store, f.repo, policyFor(f.acceptance)); const task = service.begin('unknown', 'repair'); service.finish(task.id);
    const now = Date.now(); const first = store.learning.claim(task.scope.repoId, now, 100)!;
    store.learning.beginVerification(first.id, first.token!, now + 1);
    store.close(); store = new Store(path); const resumed = new EvolveService(store, f.repo, policyFor(f.acceptance));
    assert.equal(store.learning.claim(task.scope.repoId, now + 101, 100), null);
    assert.equal(store.learning.job(first.id)?.state, 'unknown'); assert.equal(store.learning.bundle(first.id), null);
    assert.equal(await resumed.jobs.runNext(), false);
    const local = resumed.begin('local', 'repair'); resumed.finish(local.id);
    for (let i = 0; i < 3; i++) { const job = store.learning.claim(local.scope.repoId, now + 200 + i * 10, 100)!;
      store.learning.fail(job.id, job.token!, now + 201 + i * 10, 'cancelled_local'); }
    assert.equal(store.learning.forTask(local.id)?.state, 'failed'); assert.equal(store.learning.forTask(local.id)?.reason, 'recovery_limit');
  } finally { store.close(); }
});

test('two actual Node processes can only claim one durable task', async () => {
  const f = await fixture(); const path = join(f.home, 'processes.sqlite'); const store = new Store(path);
  const service = new EvolveService(store, f.repo, policyFor(f.acceptance)); const task = service.begin('race', 'repair'); service.finish(task.id); store.close();
  const barrier = join(f.home, 'start');
  const launch = () => new Promise<{ id: string | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./evidence-job-process-fixture.js', import.meta.url)), path, task.scope.repoId, barrier], { windowsHide: true });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Queue fixture timeout')); }, 30000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); }); child.stderr.resume();
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Queue fixture exit')); else { try { resolve(JSON.parse(output)); } catch (e) { reject(e); } } });
  });
  const runs = [launch(), launch()]; await writeFile(barrier, 'go'); const claims = await Promise.all(runs);
  assert.equal(claims.filter(x => x.id !== null).length, 1);
  const reopened = new Store(path); try { assert.equal(reopened.learning.jobs()[0]!.attempts, 1); } finally { reopened.close(); }
});

test('cancelling an active worker preserves unknown and does not automatically repeat verification', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const policy = policyFor(f.acceptance, true);
  try {
    const service = new EvolveService(store, f.repo, policy, true); const task = service.begin('cancel', 'repair'); await f.fix(); service.finish(task.id);
    let calls = 0;
    const worker = new EvidenceJobs(store, f.repo, policy, true, async (_root, _task, _base, _fix, _policy, signal) => {
      calls++; await new Promise<void>((_resolve, reject) => { signal!.addEventListener('abort', () => reject(new Error('fixture-private-error')), { once: true }); });
      throw new Error('unreachable');
    });
    const stop = worker.start();
    for (let i = 0; i < 100 && !store.learning.jobs()[0]!.effectStarted; i++) await pause(10);
    assert.equal(store.learning.jobs()[0]!.effectStarted, true); await stop();
    const job = store.learning.jobs()[0]!; assert.equal(job.state, 'unknown'); assert.equal(calls, 1);
    assert.equal(await worker.runNext(), false); assert.ok(!JSON.stringify(store.learning.attempts(job.id)).includes('private'));
  } finally { store.close(); }
});

test('bounded task ownership, duplicate metadata and retention never mix sessions or invent test evidence', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, policyFor(f.acceptance));
  try {
    const task = service.begin('owner', 'repair'); const other = service.begin('other', 'other repair');
    service.correction(other.id, 'Other task correction.');
    for (let i = 0; i < 140; i++) service.observe('owner', 'event-' + i, 'tool_transport_error', 'fixture-tool');
    service.observe('owner', 'event-0', 'tool_transport_error', 'fixture-tool');
    for (let i = 0; i < 40; i++) service.correction(task.id, 'Restore state. token=fixture-private-token ' + i);
    store.putTask({ ...other, id: randomUUID(), sessionId: 'ambiguous' }); const ambiguous = service.begin('new', 'third');
    store.putTask({ ...ambiguous, sessionId: 'ambiguous' }); service.observe('ambiguous', 'must-not-bind', 'tool_transport_error');
    assert.equal(store.events(ambiguous.id).length, 0);
    await f.fix(); service.finish(task.id); const job = store.learning.jobs()[0]!;
    assert.equal(job.input.sources.length, 32); assert.equal(job.input.omittedSources, 8); assert.equal(job.input.observations.length, 128);
    assert.equal(job.input.omittedObservations, 52); assert.ok(job.input.sources.every(ref => store.evidence(ref.id)?.taskId === task.id));
    assert.ok(!JSON.stringify(job).includes('fixture-private-token')); assert.equal(store.cleanEvidenceWithRetention('2100-01-01T00:00:00.000Z').removedUnreferencedSources, 9);
    await service.jobs.runNext(); const bundle = store.learning.bundle(job.id)!;
    assert.equal(bundle.status, 'incomplete'); assert.equal(bundle.verificationId, null); assert.ok(bundle.reasons.includes('sources_omitted'));
    assert.equal(store.learning.job(job.id)!.input.observations.length, 128);
  } finally { store.close(); }
});

test('changed source digests fail closed and atomic publication rolls back a failing proof write', async () => {
  const f = await fixture(); const path = join(f.home, 'corrupt.sqlite'); const store = new Store(path);
  try {
    const service = new EvolveService(store, f.repo, policyFor(f.acceptance)); const task = service.begin('corrupt', 'repair');
    const source = service.correction(task.id, 'Restore balance.'); service.finish(task.id);
    const raw = new DatabaseSync(path); raw.prepare("UPDATE evidence SET body=json_set(body,'$.note','tampered fixture') WHERE id=?").run(source.id); raw.close();
    await service.jobs.runNext(); const job = store.learning.jobs()[0]!;
    assert.equal(job.state, 'failed'); assert.equal(job.reason, 'invalid_source'); assert.equal(store.learning.bundle(job.id), null);
    const next = service.begin('rollback', 'repair'); service.finish(next.id); const claim = store.learning.claim(next.scope.repoId, Date.now(), 10000)!;
    assert.throws(() => store.learning.complete(claim.id, claim.token!, Date.now(), incomplete(claim), () => { throw new Error('failed publication'); }));
    assert.equal(store.learning.job(claim.id)?.state, 'running'); assert.equal(store.learning.bundle(claim.id), null);
    assert.equal(store.learning.attempts(claim.id)[0]!.phase, 'local');
  } finally { store.close(); }
});

test('newer failed source reports are retained instead of selecting an older successful report', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const policy = policyFor(f.acceptance, true);
  try {
    const service = new EvolveService(store, f.repo, policy, true); const task = service.begin('latest', 'repair'); await f.fix();
    const exp = await service.verify(service.propose(task.id, { title: 'rollback', strategy: 'restore balance', observedFacts: ['restores balance'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] }).id);
    const success = store.verification(exp.verificationId!)!;
    const failure = { ...success, id: randomUUID(), verified: false, reason: 'Synthetic later failed source report after clock rollback', createdAt: '2000-01-01T00:00:00.000Z' };
    store.putVerification(failure); store.putEvidence(verificationEvidence(failure)); service.finish(task.id);
    let calls = 0; await new EvidenceJobs(store, f.repo, policy, true, async () => { calls++; throw new Error('must not replace recorded failure'); }).runNext();
    const bundle = store.learning.bundles()[0]!; assert.equal(bundle.verificationId, failure.id); assert.equal(bundle.status, 'incomplete'); assert.ok(bundle.reasons.includes('source_not_verified')); assert.equal(calls, 0);
  } finally { store.close(); }
});

test('v3 migration preserves historical JSON and failures roll back the v4 schema boundary', async () => {
  const f = await fixture(); const path = join(f.home, 'legacy-v3.sqlite'); let store = new Store(path);
  const service = new EvolveService(store, f.repo, policyFor(f.acceptance)); const task = service.begin('legacy', 'repair'); const source = service.correction(task.id, 'Restore balance.'); store.close();
  const raw = new DatabaseSync(path); const drop = 'DROP TABLE extraction_jobs; DROP TABLE extraction_grants; DROP TABLE learning_job_sources; DROP TABLE evidence_bundles; DROP TABLE learning_attempts; DROP TABLE learning_jobs;';
  raw.exec(drop + ' PRAGMA user_version=3'); const original = raw.prepare('SELECT body FROM evidence WHERE id=?').get(source.id)!.body;
  raw.exec('CREATE VIEW learning_jobs AS SELECT id FROM tasks'); raw.close();
  assert.throws(() => new Store(path));
  const failed = new DatabaseSync(path); assert.equal(failed.prepare('PRAGMA user_version').get()!.user_version, 3);
  assert.equal(failed.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='learning_attempts'").get()!.n, 0);
  failed.exec('DROP VIEW learning_jobs'); failed.close();
  store = new Store(path); try { assert.ok(store.task(task.id)); assert.equal(store.learning.jobs().length, 0); } finally { store.close(); }
  const checked = new DatabaseSync(path); assert.equal(checked.prepare('PRAGMA user_version').get()!.user_version, 8);
  assert.equal(checked.prepare('SELECT body FROM evidence WHERE id=?').get(source.id)!.body, original); checked.close();
});

test('the authenticated panel shows jobs, attempts and incomplete bundles without granting retry or execution', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, policyFor(f.acceptance));
  const task = service.begin('panel-job', 'repair evidence'); service.finish(task.id); await service.jobs.runNext(); const panel = await startPanel(service);
  try {
    assert.equal((await fetch(panel.origin + '/api/state')).status, 401);
    const headers = { Authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' };
    const state = await (await fetch(panel.origin + '/api/state', { headers })).json() as { learningJobs: LearningJob[]; evidenceBundles: EvidenceBundle[]; learningAttempts: Record<string, unknown[]> };
    assert.equal(state.learningJobs.length, 1); assert.equal(state.evidenceBundles[0]!.status, 'incomplete');
    assert.equal(state.learningAttempts[state.learningJobs[0]!.id]!.length, 1);
    assert.equal((await fetch(panel.origin + '/api/jobs/retry', { method: 'POST', headers, body: '{}' })).status, 404);
    assert.match(await (await fetch(panel.origin)).text(), /任务证据与后台处理/);
  } finally { await panel.close(); store.close(); }
});

test('UTF-8 observation limits trim whole records and leave an explicit incomplete package', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, policyFor(f.acceptance));
  try {
    const task = service.begin('unicode', 'repair');
    for (let i = 0; i < 128; i++) service.observe('unicode', String(i) + '界'.repeat(197), '界'.repeat(60), '界'.repeat(100));
    service.finish(task.id); const job = store.learning.jobs()[0]!;
    assert.ok(Buffer.byteLength(JSON.stringify(job.input)) <= 128 * 1024); assert.ok(job.input.omittedObservations > 0);
    assert.equal(job.input.observations.length + job.input.omittedObservations, 128);
    await service.jobs.runNext(); const bundle = store.learning.bundle(job.id)!;
    assert.equal(bundle.status, 'incomplete'); assert.ok(bundle.reasons.includes('no_source_verification'));
    assert.ok(!bundle.reasons.includes('events_omitted')); assert.equal(bundle.verificationId, null);
  } finally { store.close(); }
});

test('legacy malformed event payloads are omitted without blocking task closure or retaining arbitrary output', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, policyFor(f.acceptance));
  try {
    const task = service.begin('legacy-event', 'repair');
    store.event('bad', task.id, new Date().toISOString(), { output: 'fixture-private-tool-output' });
    service.finish(task.id); const job = store.learning.jobs()[0]!;
    assert.equal(job.input.observations.length, 0); assert.equal(job.input.omittedObservations, 1);
    assert.ok(!JSON.stringify(job).includes('private')); await service.jobs.runNext();
    const bundle = store.learning.bundle(job.id)!;
    assert.equal(bundle.status, 'incomplete'); assert.ok(bundle.reasons.includes('no_source_verification'));
    assert.ok(!bundle.reasons.includes('events_omitted')); assert.equal(bundle.verificationId, null);
  } finally { store.close(); }
});
