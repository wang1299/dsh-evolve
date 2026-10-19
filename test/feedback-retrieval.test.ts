import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { feedbackMemory, contextKey, rankFeedback } from '../src/feedback-retrieval.js';
import type { Experience, Feedback, Task } from '../src/domain.js';
import { experienceBankDigest, selectComparisonExperience } from '../src/paired-evaluation.js';
import { EvolveService } from '../src/service.js';
import { Store } from '../src/store.js';
import { citeFact, fixture } from './fixture.js';

const scenarios = JSON.parse(await readFile(new URL('../../test/fixtures/feedback-cases.json', import.meta.url), 'utf8'));
const scenario = (id: string): { seed: string; query: string } => scenarios.cases.find((c: { id: string }) => c.id === id);

test('feedback contexts deduplicate, honor append order and reject old, foreign, missing and source-task associations', () => {
  const store = new Store(':memory:'); const at = new Date().toISOString();
  const scope = { repoId: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64), requiredFiles: {} };
  const source: Task = { schemaVersion: 1, id: randomUUID(), sessionId: 'synthetic-source', summary: 'synthetic source', scope, baseCommit: 'c'.repeat(40), state: 'closed', createdAt: at };
  const e: Experience = { schemaVersion: 1, id: randomUUID(), revision: 1, sourceTaskId: source.id, title: 'transaction rollback', strategy: 'restore balance', observedFacts: ['Synthetic memory fixture only'], inferences: [], recommendations: [], scope, status: 'candidate', reason: 'Pure derivation fixture, not verified repair evidence', verificationId: null, createdAt: at };
  store.putTask(source); store.putExperience(e);
  const add = (summary: string, outcome: Feedback['outcome'], revision = 1, repoId = scope.repoId, taskId: string = randomUUID()) => {
    const task = { ...source, id: taskId, summary, scope: { ...scope, repoId } }; store.putTask(task);
    const app = { id: randomUUID(), taskId: task.id, experienceId: e.id, revision, reason: 'Synthetic application association', createdAt: at }; store.putApplication(app);
    const feedback = { id: randomUUID(), applicationId: app.id, outcome, note: 'Synthetic owner label', extraCost: null, humanRework: null, createdAt: at }; store.putFeedback(feedback);
    return { app, feedback, task };
  };
  try {
    add(scenario('unknown').seed, 'unknown');
    assert.equal(feedbackMemory(store, [e]).get(e.id)!.accepted.length, 0);
    const first = add('Novel payment totals', 'accepted');
    store.putFeedback({ ...first.feedback, id: randomUUID(), outcome: 'unknown' });
    assert.equal(feedbackMemory(store, [e]).get(e.id)!.accepted.length, 1);
    const negative = add('  NOVEL payment totals  ', 'irrelevant');
    let memory = feedbackMemory(store, [e]).get(e.id)!;
    assert.equal(memory.accepted.length, 0); assert.equal(memory.irrelevant.get(contextKey('Novel payment totals'))!.feedbackId, negative.feedback.id);
    const correction = { ...first.feedback, id: randomUUID(), outcome: 'accepted' as const }; store.putFeedback(correction);
    add('old version alias', 'accepted', 2); add('foreign repository alias', 'accepted', 1, 'd'.repeat(64));
    store.putApplication({ ...first.app, id: randomUUID(), taskId: randomUUID() });
    const missing = store.applications().at(-1)!;
    store.putFeedback({ ...first.feedback, id: randomUUID(), applicationId: missing.id });
    add('source self association', 'accepted', 1, scope.repoId, source.id);
    memory = feedbackMemory(store, [e]).get(e.id)!;
    assert.equal(memory.accepted.length, 1); assert.equal(memory.irrelevant.size, 0); assert.equal(memory.accepted[0]!.feedbackId, correction.id);
    assert.equal(feedbackMemory(store, [{ ...e, revision: 3 }]).get(e.id)!.accepted.length, 0);
    assert.equal(rankFeedback('novel payment totals', [e], feedbackMemory(store, [e]))[0]!.evidence.feedbackId, correction.id);
    for (let i = 0; i < 11; i++) add('distinct accepted wording ' + i, 'accepted');
    const aliases = feedbackMemory(store, [e]).get(e.id)!.accepted;
    assert.equal(aliases.length, 8); assert.ok(aliases[0]!.summary.endsWith('3')); assert.ok(aliases[7]!.summary.endsWith('10'));
  } finally { store.close(); }
});

test('an accepted applied task supplies a traceable fallback for a later wording without title overlap', { timeout: 60000 }, async () => {
  const f = await fixture(); const path = join(f.home, 'feedback.sqlite'); let store = new Store(path);
  const service = new EvolveService(store, f.repo, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
  try {
    const source = service.begin('source', 'transaction rollback exception'); await f.fix();
    const correction = service.correction(source.id, 'Fixture correction: a failure changed the balance; restore it.');
    const candidate = service.propose(source.id, { title: 'transaction rollback exception', strategy: 'Restore the original balance before raising the failed transaction exception.', observedFacts: ['A failure changed the balance'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] }, [citeFact(correction, 'A failure changed the balance')]);
    const verified = await service.verify(candidate.id); service.finish(source.id);
    assert.equal(verified.status, 'source_verified');
    const query = scenario('bridge').query;
    assert.equal(service.select(service.begin('before-feedback', query).id).experience, null);
    const seed = service.begin('accepted-wording', scenario('bridge').seed);
    const applied = service.select(seed.id); assert.ok(applied.application);
    const feedbackId = randomUUID();
    service.feedback({ id: feedbackId, applicationId: applied.application.id, outcome: 'accepted', note: 'Owner reports this application accepted; not a causal benefit claim.', extraCost: null, humanRework: null });
    const reused = service.select(service.begin('after-feedback', query).id);
    assert.equal(reused.experience?.id, verified.id, 'accepted wording should bridge this known lexical gap');
    assert.ok(reused.application);
    assert.match(reused.application.reason, /feedback-v1/);
    assert.ok(reused.application.reason.includes(feedbackId));
    assert.ok(reused.application.reason.includes(applied.application.id));
    assert.ok(reused.application.reason.includes(seed.id));
    assert.equal(service.select(service.begin('frozen-v2', query).id, 'bm25-v1').experience, null);
    const frozenQuery = service.begin('paired-v2', query);
    assert.equal(selectComparisonExperience(service, frozenQuery.id, 'evolve').context, null);
    const bank = experienceBankDigest(store);
    store.putTask({ ...seed, summary: seed.summary + ' corrected terminology' });
    assert.notEqual(experienceBankDigest(store), bank, 'feedback task wording is an input to retrieval');
    store.putTask(seed);
    const doc = service.begin('doc-task', scenario('exact-negative').seed);
    const docApp = service.select(doc.id); assert.ok(docApp.application);
    service.feedback({ id: randomUUID(), applicationId: docApp.application.id, outcome: 'irrelevant', note: 'This task only changes documentation.', extraCost: null, humanRework: 0 });
    assert.equal(store.experience(verified.id)!.status, 'source_verified');
    const again = service.select(service.begin('same-doc', scenario('exact-negative').query).id);
    assert.equal(again.experience, null); assert.match(again.reasons.join(' '), /owner_irrelevant_context/);
    const original = service.select(service.begin('still-repair', 'transaction rollback exception').id);
    assert.equal(original.experience?.id, verified.id); assert.match(original.application!.reason, /original_text/);
    assert.match(original.application!.reason, /utility=0.667/);
    assert.equal(service.select(service.begin('different-doc', scenario('different-intent-wording').query).id).experience?.id, verified.id, 'new wording remains a known limitation, not an inferred intent rule');
    assert.throws(() => selectComparisonExperience(service, service.begin('frozen-new-feedback', query).id, 'evolve'), /does not support irrelevant/);
    service.feedback({ id: randomUUID(), applicationId: docApp.application.id, outcome: 'accepted', note: 'Owner corrects the earlier relevance label.', extraCost: null, humanRework: null });
    assert.equal(service.select(service.begin('corrected-context', doc.summary).id).experience?.id, verified.id);
    store.close(); store = new Store(path);
    const reopened = new EvolveService(store, f.repo, service.policy);
    assert.equal(reopened.select(reopened.begin('reopened-memory', query).id).experience?.id, verified.id);
    await writeFile(join(f.repo, 'requirements.txt'), 'new-dependency==1\n');
    assert.equal(reopened.select(reopened.begin('dependency-changed', query).id).experience, null);
    await writeFile(join(f.repo, 'requirements.txt'), '# standard-library-only fixture\n');
    const revised = reopened.revise(verified.id, verified.revision, { title: verified.title, strategy: verified.strategy, observedFacts: verified.observedFacts, inferences: [], recommendations: [], requiredFiles: ['contract.py'] }, 'New revision must not inherit feedback aliases');
    assert.equal(reopened.select(reopened.begin('unverified-revision', query).id).experience, null);
    assert.equal((await reopened.verify(revised.id)).status, 'source_verified');
    assert.equal(reopened.select(reopened.begin('new-revision-without-feedback', query).id).experience, null);
  } finally { store.close(); }
});
