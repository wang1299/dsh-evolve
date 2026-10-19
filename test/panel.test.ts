import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { startPanel } from '../src/panel.js';
import { citeFact, fixture } from './fixture.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';

test('local panel authenticates data, rejects cross-site writes and preserves experience revisions', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  const task = service.begin('panel', 'transaction rollback');
  const experience = service.propose(task.id, { title: '<script>alert(1)</script>', strategy: 'Rollback transaction', observedFacts: ['Failure left state'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
  const panel = await startPanel(service);
  try {
    const page = await fetch(panel.origin); const html = await page.text();
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.ok(!html.includes(panel.token)); assert.ok(!html.includes(experience.title));
    assert.match(html, /此任务不相关：保留经验/); assert.match(html, /策略无效：停用版本/);
    assert.doesNotThrow(() => new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!));
    assert.equal((await fetch(panel.origin + '/api/state')).status, 401);
    const headers = { Authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' };
    const state = await fetch(panel.origin + '/api/state', { headers }); assert.equal(state.status, 200);
    assert.ok((await state.text()).includes(experience.id));
    const app = { id: randomUUID(), taskId: task.id, experienceId: experience.id, revision: 1, reason: 'Synthetic panel association, not a real Agent application', createdAt: new Date().toISOString() };
    store.putApplication(app);
    const feedback = { id: randomUUID(), applicationId: app.id, outcome: 'irrelevant', note: 'Wrong context, no strategy counterexample.', extraCost: null, humanRework: 0 };
    assert.equal((await fetch(panel.origin + '/api/feedback', { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid' }, body: JSON.stringify(feedback) })).status, 403);
    assert.equal((await fetch(panel.origin + '/api/feedback', { method: 'POST', headers, body: JSON.stringify(feedback) })).status, 200);
    assert.equal(service.requireExperience(experience.id).status, 'candidate'); assert.equal(service.requireExperience(experience.id).revision, 1);
    assert.equal(store.feedback()[0]!.outcome, 'irrelevant');
    const url = panel.origin + '/api/experience/' + experience.id + '/disable';
    const data = JSON.stringify({ revision: 1, reason: 'Owner rejected this experience' });
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid' }, body: data })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers, body: data })).status, 200);
    assert.equal(service.requireExperience(experience.id).status, 'disabled');
    assert.equal((await fetch(url, { method: 'POST', headers, body: data })).status, 409);
    assert.equal((await fetch(panel.origin + '/api/experience/' + experience.id + '/restore', { method: 'POST', headers, body: JSON.stringify({ revision: 2, targetRevision: 1, reason: 'Restore as a candidate' }) })).status, 200);
    assert.equal(service.requireExperience(experience.id).status, 'candidate');
    assert.equal((await fetch(panel.origin + '/api/cleanup', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.ok(store.task(task.id)); assert.equal(store.history(experience.id).length, 3);
  } finally { await panel.close(); store.close(); }
});

test('shared database stale disable and restore cannot affect a newer revision', async () => {
  const f = await fixture(); const path = join(f.home, 'shared.sqlite');
  const first = new Store(path); const second = new Store(path);
  const policy = { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 };
  const a = new EvolveService(first, f.repo, policy); const b = new EvolveService(second, f.repo, policy);
  try {
    const task = a.begin('owner', 'rollback');
    const exp = a.propose(task.id, { title: 'rollback', strategy: 'restore balance', observedFacts: ['state changed'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
    const observedRevision = exp.revision;
    b.disable(exp.id, 'Concurrent owner update', observedRevision);
    assert.throws(() => a.disable(exp.id, 'Stale panel action', observedRevision), /Stale/);
    assert.throws(() => a.restore(exp.id, 1, 'Stale restore', observedRevision), /Stale/);
    assert.equal(first.experience(exp.id)?.revision, 2);
  } finally { first.close(); second.close(); }
});

test('panel source editing authenticates, validates digests and exposes immutable revision provenance', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  const task = service.begin('panel-source', 'transaction rollback');
  const source = service.correction(task.id, 'Explicit fixture correction <script>untrusted</script>');
  const input = { title: 'rollback', strategy: 'restore state', observedFacts: ['A recorded correction asks for a fix.'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] };
  const exp = service.propose(task.id, input); const panel = await startPanel(service);
  try {
    const headers = { Authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' };
    const url = panel.origin + '/api/experience/' + exp.id + '/evidence';
    const citations = [citeFact(source, input.observedFacts[0]!)]; const body = JSON.stringify({ revision: 1, citations });
    assert.equal((await fetch(url, { method: 'POST', headers: { Origin: panel.origin, 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid' }, body })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ revision: 1, citations: [{ ...citations[0], evidenceDigest: '0'.repeat(64) }] }) })).status, 400);
    assert.equal(store.history(exp.id).length, 1);
    assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 409);
    const state = await (await fetch(panel.origin + '/api/state', { headers })).json() as {
      evidence: { id: string }[]; provenance: Record<string, Record<string, { complete: boolean; citations: unknown[] }>>;
    };
    assert.ok(state.evidence.some((e) => e.id === source.id));
    assert.equal(state.provenance[exp.id]!['1']!.complete, false); assert.equal(state.provenance[exp.id]!['2']!.complete, true);
    const revise = await fetch(panel.origin + '/api/experience/' + exp.id + '/revise', { method: 'POST', headers,
      body: JSON.stringify({ revision: 2, reason: 'Change strategy; keep exact fact references', candidate: input, citations }) });
    assert.equal(revise.status, 200); assert.equal(service.provenance(store.experience(exp.id)!).complete, true);
    assert.equal((await fetch(panel.origin)).status, 200);
    const cleanup = await (await fetch(panel.origin + '/api/cleanup', { method: 'POST', headers, body: '{}' })).json() as Record<string, unknown>;
    assert.equal(typeof cleanup.removedUnreferencedSources, 'number');
  } finally { await panel.close(); store.close(); }
});
