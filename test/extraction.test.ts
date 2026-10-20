import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ExtractionJobs, extractionMaterial } from '../src/extraction.js';
import { extractionPolicySchema, type ExtractionPolicy, type ExtractionPort } from '../src/extraction-domain.js';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { verificationEvidence } from '../src/evidence.js';
import { correctionEvidence } from '../src/evidence.js';
import { startPanel } from '../src/panel.js';

const grant = (maxCalls = 1): ExtractionPolicy => ({ grantId: randomUUID(), provider: 'offline-fixture', model: 'scripted', maxCalls, maxTokens: 2048, timeoutMs: 30000 });
const verification = (acceptanceDir: string) => ({ trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir, regressionPath: 'tests', timeoutMs: 10000 });
const response = (changes: object = {}) => ({ text: JSON.stringify({ kind: 'candidate', title: 'Restore state after failed transaction',
  strategy: 'For this transaction, save and restore the previous balance before raising.', factIds: ['verification:base', 'verification:fixed', 'verification:regression'],
  inferences: ['The rollback may prevent state leakage in similar transactions.'], recommendations: ['Re-run independent acceptance tests.'], ...changes }),
  usage: { inputTokens: 100, outputTokens: 80, totalTokens: 180 } });
async function ready(policy = grant()) {
  const f = await fixture(); const path = join(f.home, 'extract.sqlite'); const store = new Store(path);
  const service = new EvolveService(store, f.repo, verification(f.acceptance), true, policy);
  const task = service.begin('private-session-never-send', 'repair transaction rollback');
  service.correction(task.id, 'Restore balance; never copy sk-fixtureSECRET123456 into output.');
  await f.fix(); service.finish(task.id); await service.jobs.runNext();
  assert.equal(store.learning.bundles()[0]!.status, 'ready');
  return { f, store, service, task: store.task(task.id)!, path, policy, job: store.extraction.jobs()[0]! };
}

test('automatic extraction is available but never enabled by default', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  try {
    const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
    const task = service.begin('default', 'repair'); service.finish(task.id);
    assert.ok('extraction' in service, 'A durable, explicitly authorized candidate extraction stage is missing');
    assert.equal(store.extraction.jobs().length, 0);
    assert.equal(await service.extraction.runNext(() => { throw new Error('Must not call'); }), false);
    assert.equal(store.experiences().length, 0);
  } finally { store.close(); }
});

test('real repair evidence automatically produces one bounded grounded candidate, never a verified experience', async () => {
  const r = await ready(); let calls = 0;
  try {
    const port: ExtractionPort = async request => {
      calls++; assert.ok(Buffer.byteLength(request.material) <= 32768);
      assert.ok(!request.material.includes('private-session-never-send')); assert.ok(!request.material.includes('sk-fixtureSECRET'));
      assert.ok(!request.material.includes(r.f.home)); assert.ok(!request.material.includes('summary":'));
      const material = JSON.parse(request.material) as { facts: { id: string; text: string }[] };
      assert.equal(material.facts.length, 4); assert.match(material.facts[0]!.text, /1 failures/);
      return response();
    };
    assert.equal(await r.service.extraction.runNext(port), true); r.service.finish(r.task.id);
    assert.equal(await r.service.extraction.runNext(port), false); assert.equal(calls, 1);
    const job = r.store.extraction.job(r.job.id)!; const candidate = r.store.experience(job.candidateId!)!;
    assert.equal(job.state, 'candidate'); assert.equal(candidate.status, 'candidate'); assert.equal(candidate.verificationId, null);
    assert.equal(candidate.revision, 1); assert.deepEqual(Object.keys(candidate.scope.requiredFiles), ['ledger.py']);
    assert.equal(candidate.sourceTaskId, r.task.id); assert.equal(r.service.provenance(candidate).complete, true);
    assert.equal(r.store.citations(candidate.id, 1).length, 3); assert.equal(r.store.experiences().length, 1);
    assert.equal(r.store.extraction.grants()[0]!.used, 1); assert.deepEqual(job.usage, response().usage);
    assert.equal(r.service.select(r.service.begin('later', 'transaction rollback').id).experience, null, 'Auto candidate cannot bypass verification');
    r.service.disable(candidate.id, 'A counterexample invalidated it.');
    assert.equal(await r.service.extraction.runNext(port), false); assert.equal(r.store.experiences().length, 1);
  } finally { r.store.close(); }
});

test('missing model waits without consuming grant; quota survives database restart and policy cannot silently renew it', async () => {
  const r = await ready(); let store = r.store;
  try {
    assert.equal(await r.service.extraction.runNext(null), false); assert.equal(store.extraction.job(r.job.id)?.reason, 'model_unavailable');
    assert.equal(store.extraction.grants()[0]!.used, 0);
    await r.service.extraction.runNext(async () => response()); store.close(); store = new Store(r.path);
    const service = new EvolveService(store, r.f.repo, verification(r.f.acceptance), true, r.policy);
    assert.equal(await service.extraction.runNext(async () => { throw new Error('No repeat'); }), false);
    assert.equal(store.extraction.grants()[0]!.used, 1);
    const task = service.begin('second', 'another repair'); service.finish(task.id);
    // Claim tests quota independently of evidence quality; a quota miss cannot enter running.
    const second = store.extraction.jobs().find(j => j.taskId === task.id)!;
    assert.equal(store.extraction.claim(second.id, digest('bounded input'), Date.now()), null);
    assert.equal(store.extraction.job(second.id)?.reason, 'quota_exhausted');
    const changed = new EvolveService(store, r.f.repo, verification(r.f.acceptance), true, { ...r.policy, maxCalls: 2 });
    const third = changed.begin('third', 'repair');
    assert.throws(() => changed.finish(third.id), /immutable/); assert.equal(store.task(third.id)?.state, 'open');
    assert.equal(store.learning.forTask(third.id), null, 'Finish and authorization must roll back together');
  } finally { store.close(); }
});

test('disabled authorization, incomplete evidence and code drift never call the model', async () => {
  const r = await ready(); let calls = 0; const never: ExtractionPort = async () => { calls++; return response(); };
  try {
    const revoked = new ExtractionJobs(r.store, r.f.repo); await revoked.runNext(never);
    assert.equal(r.store.extraction.job(r.job.id)?.reason, 'policy_revoked');
    const nextGrant = grant(); const second = new EvolveService(r.store, r.f.repo, verification(r.f.acceptance), false, nextGrant);
    const task = second.begin('no-fix', 'repair without evidence'); second.finish(task.id); await second.jobs.runNext(); await second.extraction.runNext(never);
    assert.equal(r.store.extraction.jobs().find(j => j.taskId === task.id)?.reason, 'evidence_incomplete');
    const other = await ready();
    try {
      await writeFile(join(other.f.repo, 'ledger.py'), '# dirty code\n'); await other.service.extraction.runNext(never);
      assert.equal(other.store.extraction.job(other.job.id)?.reason, 'invalid_material');
      assert.equal(other.store.extraction.grants()[0]!.used, 0);
    } finally { other.store.close(); }
    assert.equal(calls, 0); assert.equal(r.store.experiences().length, 0);
  } finally { r.store.close(); }
});

test('strict extraction output rejects invented facts, status, duplicate references and raw non-JSON', async () => {
  const r = await ready(grant(10));
  try {
    for (const bad of [response({ factIds: ['imaginary'] }), response({ status: 'source_verified' }), response({ factIds: ['verification:base', 'verification:base'] }),
      { text: '```json\n{}\n```', usage: null }, { text: 'x'.repeat(32769), usage: null }]) {
      const fresh = new Store(':memory:');
      try {
        // Copy synthetic source records to give each malformed output its own unique authorization.
        fresh.putTask(r.task); fresh.putVerification(r.store.verification(r.store.learning.bundles()[0]!.verificationId!)!);
        for (const e of r.store.evidenceRecords()) fresh.putEvidence(e);
        const input = r.store.learning.jobs()[0]!.input; const source = fresh.learning.enqueue(input);
        const claimed = fresh.learning.claim(r.task.scope.repoId, Date.now(), 30000)!;
        fresh.learning.complete(source.id, claimed.token!, Date.now(), { ...r.store.learning.bundles()[0]!, id: source.id }, () => r.store.verification(r.store.learning.bundles()[0]!.verificationId!));
        const worker = new ExtractionJobs(fresh, r.f.repo, r.policy); worker.enqueue(r.task, source.id);
        await worker.runNext(async () => bad);
        assert.equal(fresh.extraction.jobs()[0]!.state, 'failed'); assert.equal(fresh.extraction.jobs()[0]!.reason, 'invalid_response');
        assert.equal(fresh.experiences().length, 0); assert.equal(fresh.extraction.grants()[0]!.used, 1);
      } finally { fresh.close(); }
    }
    await r.service.extraction.runNext(async () => ({ text: '{"kind":"abstain"}', usage: null }));
    assert.equal(r.store.extraction.job(r.job.id)?.state, 'abstained'); assert.equal(r.store.experiences().length, 0);
  } finally { r.store.close(); }
});

test('two database workers cannot double consume or publish; late results after cancellation remain unknown', async () => {
  const r = await ready(); const other = new Store(r.path); const controller = new AbortController(); let calls = 0;
  let resolve!: (value: ReturnType<typeof response>) => void;
  try {
    const first = r.service.extraction.runNext(async () => { calls++; return new Promise<ReturnType<typeof response>>(r => { resolve = r; }); }, controller.signal);
    await pause(5); const second = new ExtractionJobs(other, r.f.repo, r.policy);
    assert.equal(await second.runNext(async () => { calls++; return response(); }), false);
    controller.abort(); await first;
    assert.equal(r.store.extraction.job(r.job.id)?.state, 'unknown'); assert.equal(r.store.extraction.grants()[0]!.used, 1);
    resolve(response()); await pause(5); assert.equal(r.store.experiences().length, 0);
    assert.equal(await second.runNext(async () => { calls++; return response(); }), false); assert.equal(calls, 1);
  } finally { other.close(); r.store.close(); }
});

test('expired model qualification remains unknown after restart and stale token publication is fenced', async () => {
  const r = await ready(); let store = r.store;
  try {
    const material = extractionMaterial(store, r.f.repo, r.job); const now = Date.now();
    const running = store.extraction.claim(r.job.id, digest(material.text), now)!;
    store.close(); store = new Store(r.path); store.extraction.recover(r.task.scope.repoId, now + r.policy.timeoutMs + 5001);
    assert.equal(store.extraction.job(r.job.id)?.state, 'unknown'); let published = 0;
    assert.equal(store.extraction.complete(running, now + 10, 'abstained', 'model_abstained', null, () => { published++; return null; }), false);
    assert.equal(published, 0); assert.equal(store.extraction.grants()[0]!.used, 1);
  } finally { store.close(); }
});

test('candidate publication and job outcome are atomic, and evidence tampering is detected before any model call', async () => {
  const r = await ready();
  try {
    const running = r.store.extraction.claim(r.job.id, digest('material'), Date.now())!;
    const candidate = r.service.propose(r.task.id, { title: 'Fixture', strategy: 'Restore balance.', observedFacts: ['A fixture correction exists.'],
      inferences: [], recommendations: [], requiredFiles: ['ledger.py'] });
    assert.throws(() => r.store.extraction.complete(running, Date.now(), 'candidate', 'extracted', null, () => {
      r.store.putExperience({ ...candidate, revision: 2, title: 'Must roll back' }); throw new Error('Synthetic publication fault');
    }), /Synthetic publication fault/);
    assert.equal(r.store.experience(candidate.id)?.revision, 1); assert.equal(r.store.extraction.job(r.job.id)?.state, 'running');
  } finally { r.store.close(); }
  const tampered = await ready();
  try {
    const raw = new DatabaseSync(tampered.path); const e = tampered.store.evidenceRecords().find(e => e.kind === 'correction')!;
    raw.prepare('UPDATE evidence SET body=? WHERE id=?').run(JSON.stringify({ ...e, note: 'Tampered private instructions' }), e.id); raw.close();
    let calls = 0; await tampered.service.extraction.runNext(async () => { calls++; return response(); });
    assert.equal(calls, 0); assert.equal(tampered.store.extraction.job(tampered.job.id)?.reason, 'invalid_material');
  } finally { tampered.store.close(); }
});

test('a newer failing source proof cannot be masked by an old ready bundle', async () => {
  const r = await ready();
  try {
    const original = r.store.verification(r.store.learning.bundles()[0]!.verificationId!)!;
    const failed = { ...original, id: randomUUID(), createdAt: '2000-01-01T00:00:00.000Z', verified: false, reason: 'Synthetic counterexample' };
    r.store.putVerification(failed); r.store.putEvidence(verificationEvidence(failed)); let calls = 0;
    await r.service.extraction.runNext(async () => { calls++; return response(); });
    assert.equal(calls, 0); assert.equal(r.store.extraction.job(r.job.id)?.reason, 'invalid_material');
  } finally { r.store.close(); }
});

test('version drift during a completed call cannot publish the suggested experience', async () => {
  const r = await ready();
  try {
    await r.service.extraction.runNext(async () => {
      await writeFile(join(r.f.repo, 'contract.py'), 'TRANSACTION_POLICY = "new-policy"\n'); git(r.f.repo, ['add', '.']); git(r.f.repo, ['commit', '-m', 'synthetic version drift']); return response();
    });
    assert.equal(r.store.experiences().length, 0); assert.notEqual(r.store.extraction.job(r.job.id)?.state, 'candidate');
    assert.equal(r.store.extraction.grants()[0]!.used, 1);
  } finally { r.store.close(); }
});

test('v4 migration preserves source JSON and rolls back partial v5 tables on failure', async () => {
  const f = await fixture(); const path = join(f.home, 'migrate.sqlite'); let store = new Store(path);
  const service = new EvolveService(store, f.repo, verification(f.acceptance)); const task = service.begin('old', 'legacy fixture'); store.close();
  const raw = new DatabaseSync(path); raw.exec('DROP TABLE extraction_jobs; DROP TABLE extraction_grants; PRAGMA user_version=4');
  const before = raw.prepare('SELECT body FROM tasks WHERE id=?').get(task.id)!.body;
  raw.exec('CREATE VIEW extraction_jobs AS SELECT id FROM tasks'); raw.close(); assert.throws(() => new Store(path));
  const failed = new DatabaseSync(path); assert.equal(failed.prepare('PRAGMA user_version').get()!.user_version, 4);
  assert.equal(failed.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='extraction_grants'").get()!.n, 0);
  failed.exec('DROP VIEW extraction_jobs'); failed.close(); store = new Store(path); store.close();
  const checked = new DatabaseSync(path); assert.equal(checked.prepare('PRAGMA user_version').get()!.user_version, 8);
  assert.equal(checked.prepare('SELECT body FROM tasks WHERE id=?').get(task.id)!.body, before); checked.close();
});

test('only newly finished authorized tasks are eligible, and the authenticated panel exposes outcomes without a grant endpoint', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, verification(f.acceptance));
  const old = service.begin('old', 'no historical upload'); service.finish(old.id);
  const authorized = new EvolveService(store, f.repo, verification(f.acceptance), false, grant()); authorized.finish(old.id);
  assert.equal(store.extraction.jobs().length, 0);
  const task = authorized.begin('new', 'new authorized task'); authorized.finish(task.id);
  const panel = await startPanel(authorized);
  try {
    assert.equal((await fetch(panel.origin + '/api/state')).status, 401);
    const headers = { authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' };
    const response = await fetch(panel.origin + '/api/state', { headers });
    const state = await response.json() as { extractionJobs: { taskId: string }[]; extractionGrants: { used: number }[] };
    assert.equal(state.extractionJobs[0]!.taskId, task.id); assert.equal(state.extractionGrants[0]!.used, 0);
    assert.equal((await fetch(panel.origin + '/api/extraction/authorize', { method: 'POST', headers, body: '{}' })).status, 404);
  } finally { await panel.close(); store.close(); }
});

test('extraction policy rejects missing grant, unbounded routes and invented config fields', () => {
  const policy = grant(); assert.ok(extractionPolicySchema.safeParse(policy).success);
  for (const bad of [{ ...policy, grantId: 'reset' }, { ...policy, maxCalls: 101 }, { ...policy, maxTokens: 4097 }, { ...policy, model: 'user@example.com' }, { ...policy, uploadAllHistory: true }]) {
    assert.equal(extractionPolicySchema.safeParse(bad).success, false);
  }
});

test('actual independent Node processes cannot both consume the same extraction qualification', async () => {
  const r = await ready(); const barrier = join(r.f.home, 'start-extract'); r.store.close();
  const launch = () => new Promise<{ id: string | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./extraction-process-fixture.js', import.meta.url)), r.path, r.job.id, barrier], { windowsHide: true });
    let output = ''; let errorOutput = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Extraction process fixture timeout')); }, 30000);
    child.stdout.on('data', (b: Buffer) => { output += b.toString(); }); child.stderr.on('data', (b: Buffer) => { errorOutput = (errorOutput + b.toString()).slice(-2000); }); child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Synthetic extraction process fixture exit ' + code + ': ' + errorOutput)); else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } } });
  });
  const runs = [launch(), launch()]; await writeFile(barrier, 'go'); const results = await Promise.all(runs);
  assert.equal(results.filter(r => r.id !== null).length, 1);
  const store = new Store(r.path); try { assert.equal(store.extraction.grants()[0]!.used, 1); assert.equal(store.extraction.job(r.job.id)?.state, 'running'); } finally { store.close(); }
});

test('oversized UTF-8 evidence is rejected before qualification without partial truncation or disclosure', async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, verification(f.acceptance), true, grant());
  try {
    const task = service.begin('large', 'repair');
    for (let i = 0; i < 10; i++) store.putEvidence(correctionEvidence(task, '界'.repeat(2000)));
    await f.fix(); service.finish(task.id); await service.jobs.runNext(); assert.equal(store.learning.bundles()[0]!.status, 'ready');
    let calls = 0; await service.extraction.runNext(async () => { calls++; return response(); });
    assert.equal(calls, 0); assert.equal(store.extraction.jobs()[0]!.reason, 'invalid_material'); assert.equal(store.extraction.grants()[0]!.used, 0);
  } finally { store.close(); }
});

test('synchronous event-loop blocking cannot let a completed response publish after its absolute deadline', async () => {
  const r = await ready({ ...grant(), timeoutMs: 100 }); let calls = 0;
  try {
    await r.service.extraction.runNext(async () => {
      calls++; const until = Date.now() + 150; while (Date.now() < until) { /* Delay the timer itself, not just its async callback. */ }
      return response();
    });
    assert.equal(calls, 1); assert.equal(r.store.extraction.job(r.job.id)?.state, 'unknown'); assert.equal(r.store.experiences().length, 0);
    assert.equal(r.store.extraction.grants()[0]!.used, 1);
  } finally { r.store.close(); }
});
