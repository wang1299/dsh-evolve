import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';

test('explicit correction returns an addressable minimal source instead of an untraceable event', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
  try {
    const task = service.begin('source', 'transaction rollback');
    const evidence = service.correction(task.id, 'Restore the original balance on exceptions.');
    assert.equal(typeof evidence, 'object', 'A correction must return a durable source receipt; the old API returns undefined');
  } finally { store.close(); }
});
