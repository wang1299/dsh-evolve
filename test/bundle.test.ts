import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';
import { createService } from '../src/config.js';
import { legacyProfileId } from '../src/legacy.js';
import { fixture } from './fixture.js';

test('shipped bundle inserts its plugin into the official empty profile composition', () => {
  const patches = loadOverlayPatches('dsh', resolve('cordis.patch.yml'));
  const entries = composeEntries([patches]);
  assert.equal(entries.filter((entry) => entry.id === 'dsh-reforge' && entry.name === 'dsh-reforge').length, 1);
});

test('custom profile ID upgrade keeps the same v9 records and exhausted unknown extraction', async () => {
  const f = await fixture();
  const config = { repoRoot: f.repo, dataDir: join(f.home, 'learning'), extraction: {
    grantId: randomUUID(), provider: 'synthetic', model: 'offline', maxCalls: 1, maxTokens: 128, timeoutMs: 100,
  } };
  const { service: old } = createService(config);
  const task = old.begin('migration', 'synthetic migration preservation');
  const experience = old.propose(task.id, { title: 'synthetic', strategy: 'retain records', observedFacts: ['Synthetic fixture only.'],
    inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
  old.store.putApplication({ id: randomUUID(), taskId: task.id, experienceId: experience.id, revision: experience.revision,
    reason: 'Synthetic retained application', createdAt: new Date().toISOString() });
  const job = old.store.learning.enqueue({ schemaVersion: 1, taskId: task.id, repoId: task.scope.repoId, taskDigest: 'a'.repeat(64),
    baseCommit: f.base, fixCommit: f.base, dependencyDigest: task.scope.dependencyDigest, mode: 'collect', policyDigest: 'b'.repeat(64),
    repositoryState: 'clean', diff: '', diffTruncated: false, sources: [], omittedSources: 0, observations: [], omittedObservations: 0 });
  const extraction = old.store.extraction.enqueue(task.id, task.scope.repoId, job.id, config.extraction);
  const now = Date.now();
  assert.ok(old.store.extraction.claim(extraction.id, 'c'.repeat(64), now));
  old.store.extraction.recover(task.scope.repoId, now + 10000);
  assert.equal(old.store.extraction.job(extraction.id)!.state, 'unknown');
  old.store.close();
  const database = join(config.dataDir, 'evolve.sqlite');
  const snapshot = () => {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
      return { version: db.prepare('PRAGMA user_version').get(), tables: tables.map(row => {
        const name = String(row.name); assert.match(name, /^[a-z_]+$/);
        return [name, db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()];
      }) };
    } finally { db.close(); }
  };
  const before = snapshot();
  const shipped = loadOverlayPatches('dsh', resolve('cordis.patch.yml'));
  const legacyOverlay = { id: legacyProfileId, config };
  // Follow the documented owner migration: change only the custom row's ID.
  const entries = composeEntries([shipped, [{ ...legacyOverlay, id: 'dsh-reforge' }]]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.name, 'dsh-reforge');
  assert.deepEqual(entries[0]!.config, config);
  const { service: upgraded } = createService(entries[0]!.config as typeof config);
  try {
    assert.equal(upgraded.store.experiences().length, 1);
    assert.equal(upgraded.store.applications().length, 1);
    assert.equal(upgraded.store.feedback().length, 0);
    assert.equal(upgraded.store.extraction.grants()[0]!.used, 1);
    let calls = 0;
    assert.equal(await upgraded.extraction.runNext(async () => { calls++; throw new Error('Must not replay'); }, new AbortController().signal), false);
    assert.equal(calls, 0);
  } finally { upgraded.store.close(); }
  assert.deepEqual(snapshot(), before, 'Every persisted v9 row, including the unknown reservation, must remain unchanged');
});
