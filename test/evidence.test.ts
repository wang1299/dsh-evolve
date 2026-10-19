import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';
import { citeFact } from './fixture.js';
import { digest, type Evidence } from '../src/domain.js';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const candidate = { title: 'transaction rollback exception', strategy: 'Restore state on exceptions.',
  observedFacts: ['The recorded correction requests restoring state.'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] };
const policy = (acceptance: string, trusted = false) => ({ trusted, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: acceptance, regressionPath: 'tests', timeoutMs: 15000 });

test('explicit correction returns an addressable minimal source instead of an untraceable event', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
  try {
    const task = service.begin('source', 'transaction rollback');
    const evidence = service.correction(task.id, 'Restore the original balance on exceptions.');
    assert.equal(typeof evidence, 'object', 'A correction must return a durable source receipt; the old API returns undefined');
    assert.equal(evidence.kind, 'correction'); assert.equal(evidence.taskId, task.id);
    assert.equal(store.evidence(evidence.id)?.digest, evidence.digest);
    assert.deepEqual(store.events(task.id), [{ kind: 'explicit_correction', evidenceId: evidence.id }]);
    const privateSource = service.correction(task.id, 'token=private person@example.invalid');
    assert.equal(privateSource.kind, 'correction');
    if (privateSource.kind === 'correction') assert.equal(privateSource.note, '[REDACTED] [EMAIL]');
    assert.throws(() => store.putEvidence({ ...privateSource, createdAt: '2020-01-01T00:00:00.000Z' }), /immutable/);
  } finally { store.close(); }
});

test('real repair binds correction and pytest sources, refuses incomplete reuse and retains historical sources after cleanup', { timeout: 60000 }, async () => {
  const f = await fixture(); const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, policy(f.acceptance, true));
  try {
    const task = service.begin('source', 'transaction rollback exception');
    const correction = service.correction(task.id, 'Restore state on transaction exceptions.');
    const unused = service.correction(task.id, 'Unreferenced synthetic note, eligible for ordinary cleanup.');
    await f.fix();
    const input = { ...candidate, observedFacts: [...candidate.observedFacts, 'The independent acceptance failed before the repair and passed after it.'] };
    const proposed = service.propose(task.id, input, [citeFact(correction, input.observedFacts[0]!)]);
    const verified = await service.verify(proposed.id); assert.equal(verified.status, 'source_verified');
    const proof = store.verification(verified.verificationId!)!;
    assert.equal(proof.base.failures, 1); assert.equal(proof.fixed.failures, 0); assert.equal(proof.regression.failures, 0);
    const reportSource = store.evidence(proof.id)!; assert.equal(reportSource.kind, 'verification');
    service.finish(task.id);
    const target = service.begin('target', 'transaction rollback exception');
    const withheld = service.select(target.id); assert.equal(withheld.experience, null);
    assert.match(withheld.reasons.join(' '), /missing_fact_source:1/);
    // Frozen historical policy remains explicit; it does not claim to evaluate evidence-v1.
    const historical = service.select(service.begin('historical', target.summary).id, 'feedback-v1');
    assert.equal(historical.experience?.revision, verified.revision);
    const references = [citeFact(correction, input.observedFacts[0]!), citeFact(reportSource, input.observedFacts[1]!, 1)];
    const linked = service.linkEvidence(verified.id, verified.revision, references);
    assert.equal(linked.revision, verified.revision + 1); assert.equal(linked.verificationId, proof.id);
    assert.equal(linked.status, 'source_verified'); assert.equal(service.provenance(linked).complete, true);
    service.feedback({ id: randomUUID(), applicationId: historical.application!.id, outcome: 'counterexample',
      note: 'Late observation about the previous applied revision.', extraCost: null, humanRework: null });
    assert.equal(store.experience(linked.id)?.status, 'source_verified', 'old application feedback cannot disable the new reference revision');
    const selected = service.select(target.id); assert.equal(selected.experience?.revision, linked.revision);
    assert.match(selected.application!.reason, /evidence-v1:complete_fact_sources/);
    const counts = store.cleanEvidenceWithRetention('9999-12-31T00:00:00.000Z');
    assert.equal(counts.removedUnreferencedSources, 1); assert.equal(store.evidence(unused.id), null);
    assert.equal(store.events(task.id).length, 0);
    assert.ok(store.evidence(correction.id)); assert.ok(store.evidence(reportSource.id));
    const disabled = service.disable(linked.id, 'Owner pauses this experience', linked.revision);
    assert.deepEqual(store.citations(disabled.id, disabled.revision), references);
    const restored = service.restore(linked.id, linked.revision, 'Inspect historical strategy', disabled.revision);
    assert.equal(restored.status, 'candidate'); assert.equal(restored.verificationId, null);
    assert.equal(service.provenance(restored).complete, true);
    const revised = service.revise(linked.id, restored.revision, { ...input, observedFacts: ['A different claim needs its own source.'] }, 'Changed claim');
    assert.equal(service.provenance(revised).complete, false); assert.deepEqual(store.citations(revised.id, revised.revision), []);
    store.cleanEvidenceWithRetention('9999-12-31T00:00:00.000Z');
    assert.ok(store.evidence(reportSource.id), 'history continues to pin sources after the current version drops its citations');
    assert.equal(service.provenance(store.history(linked.id).find((e) => e.revision === linked.revision)!).complete, true);
    assert.equal(store.applications().filter((a) => a.taskId === target.id).length, 1);
  } finally { store.close(); }
});

test('invalid source associations, digests and fact indexes cannot create partial versions', async () => {
  const f = await fixture(); const other = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, policy(f.acceptance)); const foreign = new EvolveService(store, other.repo, policy(other.acceptance));
  try {
    const task = service.begin('source', 'transaction rollback'); const source = service.correction(task.id, 'Restore state.');
    const unrelated = service.begin('other-task', 'another source'); const otherSource = service.correction(unrelated.id, 'Other task.');
    const foreignTask = foreign.begin('foreign', 'foreign repository'); const foreignSource = foreign.correction(foreignTask.id, 'Foreign task.');
    const ref = citeFact(source, candidate.observedFacts[0]!);
    const invalid = [
      [{ ...ref, evidenceId: randomUUID() }], [citeFact(otherSource, candidate.observedFacts[0]!)], [citeFact(foreignSource, candidate.observedFacts[0]!)],
      [{ ...ref, factDigest: '0'.repeat(64) }], [{ ...ref, evidenceDigest: '0'.repeat(64) }], [{ ...ref, factIndex: 1 }],
      [ref, ref], [{ ...ref, factIndex: 12 }], [{ ...ref, unexpected: true }],
      [ref, ...[1, 2, 3].map((i) => citeFact(service.correction(task.id, 'Additional source ' + i), candidate.observedFacts[0]!))],
    ];
    for (const refs of invalid) { assert.throws(() => service.propose(task.id, candidate, refs)); assert.equal(store.experiences().length, 0); }
    const exp = service.propose(task.id, candidate, [ref]);
    for (const refs of invalid) { assert.throws(() => service.linkEvidence(exp.id, exp.revision, refs)); assert.equal(store.history(exp.id).length, 1); }
    assert.throws(() => service.linkEvidence(exp.id, exp.revision + 1, [ref]), /Stale/);
    assert.throws(() => service.propose(task.id, { ...candidate, observedFacts: ['token=private'] }, [citeFact(source, 'token=private')]));
    assert.equal(store.experiences().length, 1);
    const redacted = service.propose(task.id, { ...candidate, observedFacts: ['token=private'] });
    assert.deepEqual(service.facts(redacted), [{ factIndex: 0, factDigest: digest('[REDACTED]') }]);
  } finally { store.close(); }
});

test('two database connections cannot clean pinned sources or leave a version after a failed reference write', async () => {
  const f = await fixture(); const path = join(f.home, 'shared-evidence.sqlite');
  const a = new Store(path); const b = new Store(path); const service = new EvolveService(a, f.repo, policy(f.acceptance));
  try {
    const task = service.begin('source', 'transaction rollback'); const deleted = service.correction(task.id, 'Unlinked note.');
    assert.equal(b.cleanEvidenceWithRetention('9999-12-31T00:00:00.000Z').removedUnreferencedSources, 1);
    assert.throws(() => service.propose(task.id, candidate, [citeFact(deleted, candidate.observedFacts[0]!)]), /missing/);
    assert.equal(a.experiences().length, 0);
    const source = service.correction(task.id, 'Pinned note.'); const exp = service.propose(task.id, candidate, [citeFact(source, candidate.observedFacts[0]!)]);
    b.cleanEvidenceWithRetention('9999-12-31T00:00:00.000Z'); assert.ok(b.evidence(source.id));
    const missing = { ...citeFact(source, candidate.observedFacts[0]!), evidenceId: randomUUID() };
    assert.throws(() => a.putExperience({ ...exp, revision: 2 }, [missing]), /FOREIGN KEY/);
    assert.equal(a.experience(exp.id)?.revision, 1); assert.equal(a.history(exp.id).length, 1);
    const raw = new DatabaseSync(path);
    try { raw.exec('PRAGMA foreign_keys=ON'); assert.throws(() => raw.prepare('DELETE FROM evidence WHERE id=?').run(source.id), /FOREIGN KEY/); }
    finally { raw.close(); }
  } finally { a.close(); b.close(); }
});

test('v2 upgrade preserves exact legacy records and withholds uncited experience without rewriting its repair status', { timeout: 60000 }, async () => {
  const f = await fixture(); const path = join(f.home, 'v2.sqlite'); const original = new Store(path);
  const service = new EvolveService(original, f.repo, policy(f.acceptance, true));
  const task = service.begin('source', 'transaction rollback exception'); await f.fix();
  const exp = await service.verify(service.propose(task.id, candidate).id); service.finish(task.id);
  const app = service.select(service.begin('old-target', candidate.title).id, 'feedback-v1').application!;
  service.feedback({ id: randomUUID(), applicationId: app.id, outcome: 'unknown', note: 'Historical result is unknown.', extraCost: null, humanRework: null });
  original.close();
  const raw = new DatabaseSync(path); raw.exec('DROP TABLE fact_citations; DROP TABLE evidence; PRAGMA user_version=2');
  const tables = ['tasks', 'experiences', 'revisions', 'verifications', 'applications', 'feedback', 'events'];
  const before = tables.map((table) => raw.prepare('SELECT * FROM ' + table).all()); raw.close();
  const upgraded = new Store(path);
  try {
    assert.equal(upgraded.experience(exp.id)?.status, 'source_verified'); assert.equal(upgraded.history(exp.id).length, 2);
    assert.equal(upgraded.evidenceRecords().length, 0);
    const current = new EvolveService(upgraded, f.repo, policy(f.acceptance, true));
    assert.equal(current.select(current.begin('new-target', candidate.title).id).experience, null);
    assert.equal(upgraded.feedback().length, 1); assert.equal(current.provenance(upgraded.experience(exp.id)!).complete, false);
  } finally { upgraded.close(); }
  const checked = new DatabaseSync(path);
  try {
    assert.equal(checked.prepare('PRAGMA user_version').get()!.user_version, 3);
    // Only the explicit new-target task was added after migration.
    assert.deepEqual(tables.slice(1).map((table) => checked.prepare('SELECT * FROM ' + table).all()), before.slice(1));
  } finally { checked.close(); }
  const reopened = new Store(path); assert.equal(reopened.history(exp.id).length, 2); reopened.close();
});

test('altered verification material invalidates cited facts and default reuse', { timeout: 60000 }, async () => {
  const f = await fixture(); const path = join(f.home, 'integrity.sqlite'); const store = new Store(path);
  const service = new EvolveService(store, f.repo, policy(f.acceptance, true));
  try {
    const task = service.begin('source', candidate.title); await f.fix();
    const verified = await service.verify(service.propose(task.id, candidate).id);
    const source = store.evidence(verified.verificationId!) as Evidence;
    const linked = service.linkEvidence(verified.id, verified.revision, [citeFact(source, candidate.observedFacts[0]!)]);
    assert.equal(service.provenance(linked).complete, true);
    const raw = new DatabaseSync(path);
    try {
      const proof = store.verification(verified.verificationId!)!;
      raw.prepare('UPDATE verifications SET body=? WHERE id=?').run(JSON.stringify({ ...proof, reason: 'Externally altered synthetic report' }), proof.id);
    } finally { raw.close(); }
    assert.equal(service.provenance(linked).complete, false);
    const result = service.select(service.begin('target', candidate.title).id); assert.equal(result.experience, null);
    assert.match(result.reasons.join(' '), /invalid_fact_sources/);
    assert.equal(store.experience(linked.id)?.revision, linked.revision);
  } finally { store.close(); }
});
