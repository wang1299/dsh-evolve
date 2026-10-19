import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';

test('automatic extraction is available but never enabled by default', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  try {
    const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
    const task = service.begin('default', 'repair'); service.finish(task.id);
    assert.ok('extraction' in service, 'A durable, explicitly authorized candidate extraction stage is missing');
    assert.equal(store.experiences().length, 0);
  } finally { store.close(); }
});
