import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';

test('finish durably queues one task-evidence job without requiring a candidate', async () => {
  const f = await fixture(); const path = join(f.home, 'jobs.sqlite'); const store = new Store(path);
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  try {
    const task = service.begin('source', 'repair transaction rollback');
    service.correction(task.id, 'Restore the balance after failure.'); await f.fix();
    service.finish(task.id); service.finish(task.id);
    assert.ok('learning' in store, 'A durable evidence queue must be available after task closure');
    const jobs = (store as Store & { learning: { jobs(): { state: string }[] } }).learning.jobs();
    assert.equal(jobs.length, 1); assert.equal(jobs[0]!.state, 'queued'); assert.equal(store.experiences().length, 0);
  } finally { store.close(); }
});
