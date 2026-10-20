import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { ExtractionModelFailure, type ExtractionPolicy } from '../src/extraction-domain.js';
import { fixture } from './fixture.js';

test('bounded model failures persist, never replay, and retain explicit single-attempt reauthorization', async () => {
  const f = await fixture(); const path = join(f.home, 'prepared.sqlite'); const seed = new Store(path);
  const proofPolicy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 };
  const extraction: ExtractionPolicy = { grantId: randomUUID(), provider: 'offline', model: 'scripted', maxCalls: 1, maxTokens: 2048, timeoutMs: 30000 };
  const initial = new EvolveService(seed, f.repo, proofPolicy, true, extraction);
  const task = initial.begin('source', 'restore prior balance'); await f.fix(); initial.finish(task.id); await initial.jobs.runNext();
  const originalJob = seed.extraction.jobs()[0]!; seed.close();
  const legacy = new DatabaseSync(path); legacy.exec('PRAGMA user_version=7');
  const before = ['tasks', 'learning_jobs', 'evidence_bundles', 'extraction_jobs', 'extraction_grants'].map(t => legacy.prepare('SELECT * FROM ' + t).all()); legacy.close();
  for (const reason of ['model_credentials_missing', 'model_transport_failed', 'model_prepare_failed'] as const) {
    const target = join(f.home, reason + '.sqlite'); await copyFile(path, target);
    let store = new Store(target);
    try {
      const raw = new DatabaseSync(target);
      assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version, 9);
      assert.deepEqual(['tasks', 'learning_jobs', 'evidence_bundles', 'extraction_jobs', 'extraction_grants'].map(t => raw.prepare('SELECT * FROM ' + t).all()), before); raw.close();
      const service = new EvolveService(store, f.repo, proofPolicy, true, extraction);
      let calls = 0;
      await service.extraction.runNext(async () => { calls++; throw new ExtractionModelFailure(reason); });
      assert.equal(calls, 1); assert.equal(store.extraction.job(originalJob.id)!.state, 'unknown'); assert.equal(store.extraction.job(originalJob.id)!.reason, reason);
      assert.equal(store.extraction.grants()[0]!.used, 1); assert.equal(store.experiences().length, 0);
      store.close(); store = new Store(target);
      const restarted = new EvolveService(store, f.repo, proofPolicy, true, extraction);
      assert.equal(await restarted.extraction.runNext(async () => { throw new Error('Must not replay'); }), false);
      const old = JSON.stringify(store.extraction.job(originalJob.id));
      const fresh = { ...extraction, grantId: randomUUID() };
      const owner = new EvolveService(store, f.repo, proofPolicy, true, fresh, true);
      const next = owner.reauthorizeExtraction(task.id, originalJob.id);
      assert.equal(next.state, 'waiting'); assert.equal(store.extraction.grants().find(g => g.id === fresh.grantId)!.used, 0);
      assert.equal(JSON.stringify(store.extraction.job(originalJob.id)), old);
    } finally { store.close(); }
  }
});
