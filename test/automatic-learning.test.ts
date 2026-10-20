import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { git } from '../src/repository.js';

const policy = () => ({ grantId: crypto.randomUUID(), provider: 'scripted-offline', model: 'fixture', maxCalls: 1, maxTokens: 256, timeoutMs: 5000 });
async function setup() {
  const f = await fixture(); const store = new Store(join(f.home, 'learning.sqlite'));
  const verification = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 };
  const extraction = policy(); const service = new EvolveService(store, f.repo, verification, true, extraction, true, true);
  return { f, store, service, verification, extraction };
}

test('normal-request segments learn an uncommitted repair, independently qualify it and provide it to a later request', async () => {
  const { f, store, service } = await setup();
  try {
    const task = service.automatic.begin('source', 1, [{ id: 'user-one', text: '修复 transaction rollback failure restore balance' }]); assert.ok(task);
    await writeFile(join(f.repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
    service.automatic.finish('source', 1);
    assert.equal(await service.jobs.runNext(), true); assert.equal(store.learning.bundles()[0]!.status, 'ready');
    assert.equal(await service.extraction.runNext(async () => ({ text: JSON.stringify({ kind: 'candidate', title: 'transaction rollback restore balance', strategy: 'Save the prior balance and restore it before raising on failure.', factIds: ['verification:base', 'verification:fixed', 'verification:regression'], inferences: [], recommendations: [] }), usage: null })), true);
    assert.equal(store.experiences()[0]!.status, 'candidate');
    assert.equal(await service.automatic.runNext(), true);
    const learned = store.experiences()[0]!; assert.equal(learned.status, 'source_verified'); assert.equal(learned.revision, 2);
    assert.equal(store.automatic.rows()[0]!.state, 'learned'); assert.equal(store.verification(learned.verificationId!)!.verified, true);
    const later = service.automatic.begin('target', 1, [{ id: 'user-two', text: 'transaction rollback failure restore balance' }]); assert.ok(later);
    const context = service.automatic.context('target'); assert.match(context, /Save the prior balance/); assert.equal(store.applications().length, 1);
    assert.equal(service.automatic.context('target'), context); assert.equal(store.applications().length, 1);
    service.automatic.finish('target', 1); assert.equal(store.automatic.rows().at(-1)!.state, 'skipped');
    assert.equal(git(f.repo, ['rev-parse', 'HEAD']), f.base); assert.match(git(f.repo, ['status', '--short']), /ledger.py/);
    assert.equal(store.extraction.grants()[0]!.used, 1); assert.equal(store.feedback().length, 0);
  } finally { store.close(); }
});

test('duplicate requests, concurrent sessions and explicit manual tasks cannot silently merge or replay', async () => {
  const { store, service } = await setup();
  try {
    const first = service.automatic.begin('one', 1, [{ id: 'one-message', text: 'Fix rollback' }]); assert.ok(first);
    assert.equal(service.automatic.begin('one', 1, [{ id: 'one-message', text: 'Fix rollback' }])?.id, first.id);
    assert.equal(service.automatic.begin('two', 1, [{ id: 'two-message', text: 'Fix something else' }]), null);
    service.automatic.finish('one', 1); assert.equal(store.learning.jobs().length, 0); assert.ok(store.automatic.rows().every(s => s.state === 'blocked'));
    const manual = service.begin('manual', 'Explicit repair'); assert.ok(manual);
    assert.equal(service.automatic.begin('manual', 2, [{ id: 'manual-message', text: 'Continue' }]), null);
    assert.equal(store.task(manual.id)!.state, 'open'); assert.equal(store.extraction.jobs().length, 0);
  } finally { store.close(); }
});

test('only narrowly explicit corrections become facts and extra steering blocks ambiguous capture', async () => {
  const { store, service } = await setup();
  try {
    service.automatic.begin('one', 1, [{ id: 'one', text: '纠正：失败后恢复原值，token=private-value' }]);
    assert.equal(store.evidenceRecords().length, 1); assert.ok(!JSON.stringify(store.evidenceRecords()).includes('private-value'));
    service.automatic.invalidate('one', 1, 'multiple_inputs'); service.automatic.finish('one', 1);
    assert.equal(store.learning.jobs().length, 0); assert.equal(store.automatic.rows()[0]!.state, 'blocked');
    service.automatic.begin('one', 2, [{ id: 'two', text: 'Please inspect this code' }]);
    assert.equal(store.evidenceRecords().length, 1);
  } finally { store.close(); }
});

test('a manual task starting after automatic capture blocks the earlier segment', async () => {
  const { store, service } = await setup();
  try {
    const automatic = service.automatic.begin('automatic', 1, [{ id: 'earlier', text: 'Fix rollback' }]); assert.ok(automatic);
    const manual = service.begin('manual-later', 'A different explicit task');
    assert.equal(store.automatic.rows()[0]!.state, 'blocked'); assert.equal(store.task(automatic.id)!.state, 'closed');
    service.automatic.finish('automatic', 1); assert.equal(store.learning.jobs().length, 0);
    assert.equal(store.task(manual.id)!.state, 'open');
  } finally { store.close(); }
});
