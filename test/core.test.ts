import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redact, relativePath } from '../src/domain.js';
import { applicability, snapshot } from '../src/repository.js';
import { EvolveService, similarity } from '../src/service.js';
import { Store } from '../src/store.js';
import { parsePytest, passes, reproduces, verifiedCases } from '../src/verification.js';
import { citeFact, fixture } from './fixture.js';

test('pytest failure must be a real failing test; infrastructure, no collection and skips do not verify', () => {
  const xml = '<testsuites><testsuite tests="1" failures="1" errors="0" skipped="0"><testcase classname="acceptance" name="broken"><failure/></testcase></testsuite></testsuites>';
  assert.equal(reproduces(parsePytest(1, xml, 1, false, '')), true);
  for (const code of [0, 2, 3, 4, 5, null]) assert.equal(reproduces(parsePytest(code, xml, 1, false, '')), false);
  assert.equal(reproduces(parsePytest(1, xml, 1, true, '')), false);
  assert.equal(passes(parsePytest(0, '', 1, false, '')), false);
  assert.equal(passes(parsePytest(0, '<testsuite tests="1" skipped="1" failures="0" errors="0">', 1, false, '')), false);
});

test('skipping or removing the originally failing acceptance test cannot verify a repair', () => {
  const baseline = parsePytest(1, '<testsuite tests="2" failures="1" errors="0" skipped="0"><testcase name="bug"><failure/></testcase><testcase name="smoke"/></testsuite>', 1, false, '');
  const skipped = parsePytest(0, '<testsuite tests="2" failures="0" errors="0" skipped="1"><testcase name="bug"><skipped/></testcase><testcase name="smoke"/></testsuite>', 1, false, '');
  const removed = parsePytest(0, '<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase name="smoke"/></testsuite>', 1, false, '');
  assert.equal(passes(skipped), true);
  assert.equal(verifiedCases(baseline, skipped), false); assert.equal(verifiedCases(baseline, removed), false);
});

test('privacy minimization, path validation and low-similarity abstention', () => {
  assert.equal(redact('token=private me@private.test C:\\Users\\me\\secret.txt'), '[REDACTED] [EMAIL] [LOCAL_PATH]');
  for (const p of ['../outside', '/tmp/file', 'C:\\secret', 'a/../../x', 'a\nb']) assert.equal(relativePath.safeParse(p).success, false);
  assert.equal(similarity('database rollback', 'database rollback on exception'), 1);
  assert.equal(similarity('image rendering', 'database rollback'), 0);
});

test('real source verification, reuse in another task, feedback, cleanup and revision lifecycle', { timeout: 60000 }, async () => {
  const f = await fixture();
  const store = new Store(join(f.home, 'data', 'evolve.sqlite'));
  const service = new EvolveService(store, f.repo, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
  try {
    const source = service.begin('session-one', 'database rollback on transaction exception');
    assert.throws(() => service.begin('session-one', 'another task'), /open task/);
    assert.throws(() => service.requireTask(source.id, 'another-session'), /different session/);
    service.observe(source.sessionId, 'event-a', 'tool/result', 'pytest');
    service.observe(source.sessionId, 'event-a', 'tool/result', 'pytest');
    const correction = service.correction(source.id, 'Rollback the transaction on exceptions.');
    assert.equal(store.events(source.id).length, 2);
    await f.fix();
    const input = { title: 'database transaction rollback', strategy: 'Restore the balance before raising a transaction exception.', observedFacts: ['An exception left the balance incremented.'], inferences: ['Similar transactions may share the failure mode.'], recommendations: ['Check exception paths and run independent rollback acceptance tests.'], requiredFiles: ['contract.py'] };
    const candidate = service.propose(source.id, input, [citeFact(correction, input.observedFacts[0]!)]);
    assert.equal(candidate.status, 'candidate');
    const verified = await service.verify(candidate.id);
    assert.equal(verified.status, 'source_verified');
    const report = store.verification(verified.verificationId!);
    assert.equal(report?.base.failures, 1);
    assert.equal(report?.fixed.exitCode, 0);
    assert.equal(report?.regression.tests, 1);
    assert.equal(report?.verified, true);
    assert.ok(report && 'acceptanceFiles' in report, 'Replay report must preserve independent acceptance inputs');
    service.finish(source.id);
    const next = service.begin('session-two', 'database transaction rollback exception');
    const selection = service.select(next.id);
    assert.equal(selection.experience?.id, candidate.id);
    assert.ok(selection.application);
    assert.equal(service.select(next.id).application, null);
    const feedback = { id: randomUUID(), applicationId: selection.application.id, outcome: 'counterexample' as const, note: 'A distinct transaction path breaks this strategy.', extraCost: 0.1, humanRework: 1 };
    service.feedback(feedback); service.feedback(feedback);
    assert.equal(store.feedback().length, 1);
    assert.equal(store.experience(candidate.id)?.status, 'disabled');
    const restored = service.restore(candidate.id, 2, 'Inspect prior content after counterexample');
    assert.equal(restored.status, 'candidate'); assert.equal(restored.verificationId, null);
    const revised = service.revise(candidate.id, restored.revision, input, 'Narrow scope before revalidation');
    assert.equal(revised.status, 'candidate');
    assert.throws(() => service.revise(candidate.id, restored.revision, input, 'stale edit'), /Stale/);
    assert.equal(store.history(candidate.id).length, 5);
    store.cleanEvidence('9999-12-31T00:00:00.000Z');
    assert.equal(store.events(source.id).length, 0);
    assert.ok(store.task(source.id)); assert.ok(store.verification(verified.verificationId!));
    assert.equal(store.applications().length, 1);
  } finally { store.close(); }
});

test('dependency and code scope changes invalidate an experience', async () => {
  const f = await fixture();
  const old = snapshot(f.repo, ['contract.py']).scope;
  await writeFile(join(f.repo, 'contract.py'), 'TRANSACTION_POLICY = "new"\n');
  assert.match(applicability(old, snapshot(f.repo, ['contract.py']).scope)!, /code_condition_changed/);
  await writeFile(join(f.repo, 'requirements.txt'), 'some-dependency==2\n');
  assert.equal(applicability(old, snapshot(f.repo, ['contract.py']).scope), 'dependencies_changed');
  assert.equal(applicability(old, { ...old, repoId: '0'.repeat(64) }), 'different_repository');
});

test('untrusted execution is rejected; unverified candidates cannot be selected', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  try {
    const task = service.begin('origin', 'database transaction rollback'); await f.fix();
    const candidate = service.propose(task.id, { title: 'database transaction rollback', strategy: 'Rollback on exception', observedFacts: ['A failing transaction changed state'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
    await assert.rejects(service.verify(candidate.id), /trust/);
    const other = service.begin('other', 'database transaction rollback');
    assert.equal(service.select(other.id).application, null);
    assert.throws(() => service.feedback({ id: randomUUID(), applicationId: randomUUID(), outcome: 'accepted', note: 'unbound', extraCost: null, humanRework: null }), /Unknown application/);
  } finally { store.close(); }
});

test('feedback can append new evidence and remains bound to the applied experience revision', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  try {
    const task = service.begin('origin', 'rollback');
    const input = { title: 'rollback', strategy: 'Rollback the balance', observedFacts: ['State changed'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] };
    const exp = service.propose(task.id, input);
    const app = { id: randomUUID(), taskId: task.id, experienceId: exp.id, revision: exp.revision, reason: 'Historical application fixture', createdAt: new Date().toISOString() };
    store.putApplication(app);
    service.feedback({ id: randomUUID(), applicationId: app.id, outcome: 'unknown', note: 'Awaiting acceptance', extraCost: null, humanRework: null });
    const revised = service.revise(exp.id, 1, { ...input, strategy: 'A revised transaction strategy' }, 'New evidence');
    service.feedback({ id: randomUUID(), applicationId: app.id, outcome: 'counterexample', note: 'A late counterexample for old revision', extraCost: null, humanRework: 1 });
    assert.equal(store.feedback().length, 2);
    assert.equal(store.experience(exp.id)?.revision, revised.revision);
    assert.equal(store.experience(exp.id)?.status, 'candidate');
  } finally { store.close(); }
});
