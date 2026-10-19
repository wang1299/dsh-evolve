import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EvolveService } from '../src/service.js';
import { Store } from '../src/store.js';
import { citeFact, fixture } from './fixture.js';
import { rankText, retrievalTokens } from '../src/retrieval.js';

test('frozen diagnostic reproduces every selection on both splits while retaining wrong and missed results', async () => {
  for (const split of ['development', 'holdout']) {
    const actual = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/retrieval-benchmark.js', import.meta.url)), split], { encoding: 'utf8', windowsHide: true }));
    const frozen = JSON.parse(await readFile(new URL(`../../docs/evaluation/retrieval-v1-${split}.json`, import.meta.url), 'utf8'));
    assert.equal(actual.dataDigest, frozen.dataDigest); assert.equal(actual.policyDigest, frozen.policyDigest);
    for (const key of Object.keys(frozen.groups)) {
      const a = actual.groups[key]; const b = frozen.groups[key];
      assert.deepEqual(a.rows, b.rows, 'rerun selections must match the preserved report');
      assert.equal(a.correct + a.wrong + a.abstained, a.queries);
      assert.ok(a.wrong > 0, 'known intent errors cannot be dropped from the report');
      assert.equal(a.cost.modelCalls, 0);
      for (const field of ['queries', 'positives', 'negatives', 'correct', 'wrong', 'abstained', 'positiveRecall', 'wrongInjectionRate', 'negativeInjectionRate', 'abstentionRate']) assert.equal(a[field], b[field]);
      assert.equal(a.cost.scoredPairs, b.cost.scoredPairs); assert.equal(a.cost.offeredBytes, b.cost.offeredBytes);
    }
  }
});

test('BM25 ignores nonmatching query suffixes and repetitions, bounds scores and abstains on weak anchors', () => {
  const bank = [{ id: 'rollback', title: 'transaction rollback exception', strategy: 'Restore the balance before raising an exception.' },
    { id: 'image', title: 'image rendering colors', strategy: 'Preserve alpha channels.' }];
  const short = rankText('transaction rollback exception', bank);
  assert.deepEqual(rankText('transaction rollback exception please check typography pagination accessibility deployment', bank), short);
  assert.deepEqual(rankText('transaction rollback exception transaction transaction', bank), short);
  assert.equal(short[0]!.reason, null); assert.ok(short[0]!.score > 0 && short[0]!.score < 1);
  assert.equal(rankText('transaction', bank)[0]!.reason, 'insufficient_anchors');
  assert.equal(rankText('restore balance', bank).find((m) => m.id === 'rollback')!.reason, 'no_title_anchor');
  assert.deepEqual(rankText('anything', []), []);
  assert.ok(rankText('anything', [{ id: 'empty', title: 'the', strategy: 'and' }]).every((m) => m.score === 0));
  assert.throws(() => rankText('transaction', [bank[0]!, bank[0]!]), /Duplicate/);
  const tied = rankText('transaction rollback', [{ ...bank[0]!, id: 'b' }, { ...bank[0]!, id: 'a' }]);
  assert.deepEqual(tied.map((m) => m.id), ['a', 'b']);
});

test('identifier normalization and Chinese bigrams preserve discriminating anchors without claiming semantic understanding', () => {
  assert.deepEqual(retrievalTokens('cacheKey cache_key ＣＡＣＨＥ'), ['cache', 'key', 'cache', 'key', 'cache']);
  const chinese = [{ id: 'zh', title: '事务回滚异常', strategy: '恢复原始状态再抛出异常' }];
  assert.equal(rankText('修复事务回滚异常，增加独立验收检查', chinese)[0]!.reason, null);
  assert.equal(rankText('更改界面颜色', chinese)[0]!.reason, 'insufficient_anchors');
  assert.equal(rankText('regional clocks offsets', [{ id: 'utc', title: 'timezone aware UTC conversion', strategy: 'Convert timestamp to UTC.' }])[0]!.reason, 'insufficient_anchors');
});

test('long task retains a verified match while evidence, scope, ambiguity and negative feedback still gate selection', { timeout: 60000 }, async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
  const longTask = 'Repair transaction rollback when an exception interrupts the operation. '
    + 'Keep public interfaces compatible, preserve unrelated dictionary entries, add independent assertions around rejected operations, '
    + 'document reproduction steps, inspect changed files carefully, avoid introducing packages, retain successful behavior, '
    + 'record platform versions, run focused checks in a temporary checkout, explain the smallest patch and summarize outstanding limitations.';
  try {
    const source = service.begin('source', 'transaction rollback exception'); await f.fix();
    const correction = service.correction(source.id, 'Fixture correction: failure changed the balance; restore it.');
    const candidate = service.propose(source.id, { title: 'transaction rollback exception', strategy: 'Restore the original balance before raising the failed transaction exception.', observedFacts: ['Failure changed the balance'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] }, [citeFact(correction, 'Failure changed the balance')]);
    const verified = await service.verify(candidate.id); service.finish(source.id);
    assert.equal(verified.status, 'source_verified');
    const next = service.begin('long', longTask);
    const result = service.select(next.id);
    assert.equal(result.experience?.id, verified.id, 'irrelevant task instructions must not dilute a verified lexical match');
    assert.ok(result.application);
    const ambiguous = service.begin('ambiguous', 'transaction');
    assert.equal(service.select(ambiguous.id).experience, null, 'a single generic anchor is insufficient');
    const unrelated = service.begin('unrelated', 'image layout contrast');
    assert.equal(service.select(unrelated.id).experience, null);
    const missing = { ...verified, id: randomUUID(), revision: 1, verificationId: null };
    store.putExperience(missing);
    const evidenceTask = service.begin('proof-check', longTask);
    const checked = service.select(evidenceTask.id);
    assert.equal(checked.experience?.id, verified.id);
    assert.equal(store.applications().some((a) => a.experienceId === missing.id), false);
    await writeFile(join(f.repo, 'contract.py'), 'TRANSACTION_POLICY = "changed"\n');
    assert.equal(service.select(service.begin('code-change', longTask).id).experience, null);
    await writeFile(join(f.repo, 'contract.py'), 'TRANSACTION_POLICY = "rollback-on-exception"\n');
    await writeFile(join(f.repo, 'requirements.txt'), 'dependency==2\n');
    assert.equal(service.select(service.begin('dependency-change', longTask).id).experience, null);
    await writeFile(join(f.repo, 'requirements.txt'), '# standard-library-only fixture\n');
    service.feedback({ id: randomUUID(), applicationId: result.application.id, outcome: 'counterexample', note: 'This strategy was wrong for the applied task.', extraCost: null, humanRework: 1 });
    assert.equal(store.experience(verified.id)?.status, 'disabled');
    assert.equal(service.select(service.begin('after-negative', longTask).id).experience, null);
  } finally { store.close(); }
});
