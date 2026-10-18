import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { startPanel } from '../src/panel.js';
import { fixture } from './fixture.js';
import { join } from 'node:path';

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
    assert.equal((await fetch(panel.origin + '/api/state')).status, 401);
    const headers = { Authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' };
    const state = await fetch(panel.origin + '/api/state', { headers }); assert.equal(state.status, 200);
    assert.ok((await state.text()).includes(experience.id));
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
