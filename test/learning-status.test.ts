import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { learningStatus } from '../src/learning-status.js';

test('learning status is read-only, distinguishes configuration from runtime and excludes other repositories', async () => {
  const f = await fixture(); const store = new Store(join(f.home, 'status.sqlite'));
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'not-executed', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 5000 });
  try {
    const task = service.begin('local', 'Check current repair');
    store.putTask({ ...task, id: randomUUID(), sessionId: 'other-repository', summary: 'PRIVATE OTHER REPOSITORY', scope: { ...task.scope, repoId: '0'.repeat(64) } });
    const before = JSON.stringify({ tasks: store.tasks(), jobs: store.learning.jobs(), grants: store.extraction.grants() });
    const status = learningStatus(service);
    assert.equal(status.automatic, false); assert.equal(status.quota, null); assert.equal(status.tasks.length, 1);
    assert.equal(status.checks.find(c => c.label.includes('仓库外'))!.ready, true);
    assert.equal(status.checks.filter(c => c.ready).length, 1);
    assert.equal(status.tasks[0]!.status, 'recording'); assert.match(status.tasks[0]!.next, /显式任务/);
    assert.equal(JSON.stringify(status).includes('PRIVATE OTHER'), false); assert.equal(JSON.stringify(status).includes(f.acceptance), false);
    assert.equal(JSON.stringify({ tasks: store.tasks(), jobs: store.learning.jobs(), grants: store.extraction.grants() }), before);
  } finally { store.close(); }
});

test('unknown history remains unknown without polluting a newer request or leaking raw diagnostic reasons', async () => {
  const f = await fixture(); const store = new Store(join(f.home, 'status.sqlite'));
  const policy = { grantId: randomUUID(), provider: 'offline', model: 'fixture', maxCalls: 1, maxTokens: 256, timeoutMs: 5000 };
  const service = new EvolveService(store, f.repo, { trusted: true, python: 'not-executed', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 5000 }, true, policy, true, true);
  try {
    const old = service.automatic.begin('earlier', 1, [{ id: 'earlier-user', text: 'Earlier request' }])!;
    const segment = store.automatic.forTask(old.id)!;
    store.automatic.transition(segment.id, 'open', { state: 'unknown', reason: 'token=PRIVATE-ERROR-TEXT' });
    store.putTask({ ...old, state: 'closed' });
    const current = service.automatic.begin('current', 1, [{ id: 'current-user', text: 'Current repair request' }])!;
    const status = learningStatus(service);
    assert.equal(status.tasks.find(t => t.taskId === old.id)!.status, 'unknown');
    assert.equal(status.tasks.find(t => t.taskId === current.id)!.status, 'recording');
    assert.match(status.tasks.find(t => t.taskId === old.id)!.next, /不会自动重跑/);
    assert.equal(JSON.stringify(status).includes('PRIVATE-ERROR'), false); assert.equal(JSON.stringify(status).includes(policy.grantId), false);
    assert.deepEqual(status.quota, { limit: 1, used: 0, remaining: 1, consistent: true });
    assert.equal(store.extraction.grants().length, 0);
  } finally { store.close(); }
});

test('current extraction follows explicit reauthorization edges instead of an older unknown job', async () => {
  const f = await fixture(); const store = new Store(join(f.home, 'status.sqlite'));
  const policy = { grantId: randomUUID(), provider: 'offline', model: 'fixture', maxCalls: 1, maxTokens: 256, timeoutMs: 5000 };
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'not-executed', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 5000 }, false, policy, true);
  try {
    const task = service.begin('manual', 'Repair summary'); service.finish(task.id);
    const first = store.extraction.jobs()[0]!;
    const claimed = store.extraction.claim(first.id, 'a'.repeat(64), Date.now())!;
    store.extraction.complete(claimed, Date.now(), 'unknown', 'model_transport_failed', null);
    const next = store.extraction.appendReauthorization(store.extraction.job(first.id)!, { ...policy, grantId: randomUUID() });
    store.extraction.wait(next.id, 'model_unavailable');
    const before = store.extraction.grants();
    const status = learningStatus(service); assert.equal(status.tasks[0]!.status, 'waiting');
    assert.match(status.tasks[0]!.summary, /等待 DSH 模型/); assert.equal(status.quota!.remaining, 0);
    assert.deepEqual(store.extraction.grants(), before); assert.equal(store.extraction.job(first.id)!.state, 'unknown');
  } finally { store.close(); }
});
