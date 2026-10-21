import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { git } from '../src/repository.js';
import { fixture } from './fixture.js';
import { learningStatus } from '../src/learning-status.js';

async function candidate() {
  const f = await fixture(); const dataDir = join(f.home, 'panel-learning'); const path = join(dataDir, 'evolve.sqlite');
  const store = new Store(path);
  const extraction = { grantId: randomUUID(), provider: 'offline-only', model: 'fixture', maxCalls: 1, maxTokens: 256, timeoutMs: 5000 };
  const config = { repoRoot: f.repo, dataDir, executionTrusted: true, shareWithModel: true, backgroundVerification: true, automaticLearning: true,
    acceptanceDir: f.acceptance, python: process.env.EVOLVE_PYTHON ?? 'python', timeoutMs: 15000, extraction };
  const service = new EvolveService(store, f.repo, { trusted: true, python: config.python, acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 }, true, extraction, true, true);
  try {
    service.automatic.begin('panel-source', 1, [{ id: 'direct-user', text: 'Restore balance after failed transaction' }]);
    await writeFile(join(f.repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
    service.automatic.finish('panel-source', 1);
    await service.jobs.runNext(); assert.equal(store.learning.bundles()[0]!.status, 'ready');
    let modelCalls = 0;
    await service.extraction.runNext(async () => { modelCalls++; return { text: JSON.stringify({ kind: 'candidate', title: 'Restore original balance', strategy: 'Restore the captured balance on failure.', factIds: ['verification:base', 'verification:fixed', 'verification:regression'], inferences: [], recommendations: [] }), usage: null }; });
    assert.equal(modelCalls, 1); assert.equal(store.experiences()[0]!.status, 'candidate');
    assert.equal(learningStatus(service).tasks[0]!.status, 'waiting');
    return { f, config, path, id: store.experiences()[0]!.id, segmentId: store.automatic.rows()[0]!.id };
  } finally { store.close(); }
}
async function panel(config: object, home: string) {
  const file = join(home, 'panel-config.json'); await writeFile(file, JSON.stringify(config));
  const child = spawn(process.execPath, [resolve('dist/src/cli.js'), 'panel', '--config', file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; child.stdout.on('data', (part: Buffer) => { output += part.toString(); }); child.stderr.resume();
  let spawnError: Error | null = null; child.on('error', error => { spawnError = error; });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  const close = async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; };
  try {
    const deadline = Date.now() + 10000;
    while (!output.includes('DSH-Evolve local panel:')) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('CLI panel did not become ready');
      await new Promise(done => setTimeout(done, 100));
    }
    return { close };
  } catch (error) { await close(); throw error; }
}
const indexDigest = async (repo: string) => createHash('sha256').update(await readFile(join(repo, '.git/index'))).digest('hex');

test('CLI panel independently qualifies an existing automatic candidate without a model port or Git writes', async () => {
  const seeded = await candidate(); const before = await indexDigest(seeded.f.repo);
  const cli = await panel(seeded.config, seeded.f.home); const store = new Store(seeded.path);
  try {
    // Three independently bounded pytest runs plus queue and filesystem work.
    const deadline = Date.now() + seeded.config.timeoutMs * 3 + 20000;
    while (store.experience(seeded.id)!.status === 'candidate' && Date.now() < deadline) await new Promise(done => setTimeout(done, 100));
    assert.equal(store.experience(seeded.id)!.status, 'source_verified');
    assert.equal(store.automatic.get(seeded.segmentId)!.state, 'learned');
    assert.equal(store.extraction.grants()[0]!.used, 1); assert.equal(store.extraction.jobs().length, 1); assert.equal(store.feedback().length, 0);
    assert.equal(git(seeded.f.repo, ['rev-parse', 'HEAD']), seeded.f.base); assert.equal(await indexDigest(seeded.f.repo), before);
  } finally { await cli.close(); store.close(); }
});

test('CLI panel does not qualify when automatic learning is off and never replays an unknown segment', async () => {
  const seeded = await candidate();
  for (const mode of ['off', 'unknown'] as const) {
    const store = new Store(seeded.path);
    if (mode === 'unknown') store.automatic.transition(seeded.segmentId, 'queued', { state: 'unknown', reason: 'interrupted_process' });
    const cli = await panel({ ...seeded.config, automaticLearning: mode !== 'off' }, seeded.f.home);
    try {
      await new Promise(done => setTimeout(done, 600));
      assert.equal(store.experience(seeded.id)!.status, 'candidate'); assert.equal(store.extraction.grants()[0]!.used, 1);
      assert.equal(store.automatic.get(seeded.segmentId)!.state, mode === 'off' ? 'queued' : 'unknown');
    } finally { await cli.close(); store.close(); }
  }
});
