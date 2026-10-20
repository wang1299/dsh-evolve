import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixture.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';

test('v8 to v9 migration preserves legacy experience, unknown extraction and consumed authorization', async () => {
  const f = await fixture(); const path = join(f.home, 'v8.sqlite'); const old = new Store(path);
  const service = new EvolveService(old, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 }, false,
    { grantId: crypto.randomUUID(), provider: 'offline', model: 'fixture', maxCalls: 1, maxTokens: 256, timeoutMs: 1000 });
  const task = service.begin('legacy', 'Legacy fixture task'); const correction = service.correction(task.id, 'Explicit synthetic correction');
  service.propose(task.id, { title: 'Legacy candidate', strategy: 'restore prior value', observedFacts: ['A correction exists'], inferences: [], recommendations: [], requiredFiles: ['ledger.py'] });
  service.finish(task.id); const extraction = old.extraction.jobs()[0]!;
  const claimed = old.extraction.claim(extraction.id, 'a'.repeat(64), Date.now())!;
  old.extraction.complete(claimed, Date.now(), 'unknown', 'interrupted_model', null); old.close();
  const previous = new DatabaseSync(path); previous.exec('DROP TABLE automatic_segments; DROP TABLE automatic_locks; PRAGMA user_version=8');
  const names = previous.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => String(r.name));
  const rows = names.map(n => previous.prepare('SELECT * FROM ' + n).all()); previous.close();
  const upgraded = new Store(path);
  try {
    const raw = new DatabaseSync(path); assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version, 9);
    assert.deepEqual(names.map(n => raw.prepare('SELECT * FROM ' + n).all()), rows); raw.close();
    assert.equal(upgraded.automatic.rows().length, 0); assert.equal(upgraded.extraction.job(extraction.id)!.state, 'unknown');
    assert.equal(upgraded.extraction.grants()[0]!.used, 1); assert.equal(upgraded.evidence(correction.id)!.digest, correction.digest);
    assert.equal(upgraded.history(upgraded.experiences()[0]!.id).length, 1);
  } finally { upgraded.close(); }
});
