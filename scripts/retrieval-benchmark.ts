/** Offline authored fixtures only. Does not call a model, inspect user repositories or change a bank. */
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { digest } from '../src/domain.js';
import { rankText, retrievalPolicyDigest } from '../src/retrieval.js';
import { similarity } from '../src/service.js';

const split = z.enum(['development', 'holdout']).parse(process.argv[2]);
const splitSchema = z.enum(['development', 'holdout']);
const data = z.object({ schemaVersion: z.literal(1), kind: z.literal('author-written-synthetic-retrieval'),
  experiences: z.array(z.object({ id: z.string(), split: splitSchema, family: z.string(), title: z.string(), strategy: z.string() }).strict()),
  queries: z.array(z.object({ id: z.string(), split: splitSchema, family: z.string(), kind: z.string(), text: z.string(), relevantIds: z.array(z.string()), ineligibleIds: z.array(z.string()) }).strict()),
}).strict();
const bytes = await readFile(new URL('../../test/fixtures/retrieval-cases.json', import.meta.url));
const dataDigest = digest(bytes);
if (dataDigest !== '15ecfe0010f398c7f1233937fa49adea8a4a6b4af060477faea9f33cebe5e763') throw new Error('Frozen retrieval corpus changed; create a new evaluation version');
const corpus = data.parse(JSON.parse(bytes.toString('utf8')));
const ids = new Set(corpus.experiences.map((e) => e.id));
if (ids.size !== corpus.experiences.length || new Set(corpus.queries.map((q) => q.id)).size !== corpus.queries.length) throw new Error('Duplicate fixture IDs');
for (const family of new Set(corpus.experiences.map((e) => e.family))) {
  if (new Set([...corpus.experiences, ...corpus.queries].filter((r) => r.family === family).map((r) => r.split)).size !== 1) throw new Error('Family split leakage');
}
for (const q of corpus.queries) {
  if (!corpus.experiences.some((e) => e.family === q.family && e.split === q.split)) throw new Error('Query family has no source bank');
  for (const id of [...q.relevantIds, ...q.ineligibleIds]) {
    if (!corpus.experiences.some((e) => e.id === id && e.split === q.split)) throw new Error('Cross-split or unknown label');
  }
  if (q.relevantIds.some((id) => q.ineligibleIds.includes(id))) throw new Error('Positive label is inapplicable');
}
const bank = corpus.experiences.filter((e) => e.split === split); const queries = corpus.queries.filter((q) => q.split === split);
const policies = ['legacy_text', 'bm25_text', 'scoped_legacy', 'scoped_bm25'] as const;
const groups = Object.fromEntries(policies.map((policy) => {
  let elapsedMs = 0; let scoredPairs = 0; let offeredBytes = 0;
  const rows = queries.map((q) => {
    // These are declared fixture constraints, not executable evidence or Agent outcomes.
    const eligible = policy.startsWith('scoped_') ? bank.filter((e) => !q.ineligibleIds.includes(e.id)) : bank;
    const start = performance.now(); scoredPairs += eligible.length;
    const ranked = policy.includes('bm25') ? rankText(q.text, eligible).filter((m) => m.reason === null)
      : eligible.map((e) => ({ id: e.id, score: similarity(q.text, e.title + ' ' + e.strategy) }))
        .filter((m) => m.score >= 0.15).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    elapsedMs += performance.now() - start;
    const selected = ranked[0]?.id ?? null; const experience = bank.find((e) => e.id === selected);
    if (experience) offeredBytes += Buffer.byteLength(experience.title + '\n' + experience.strategy);
    return { id: q.id, family: q.family, kind: q.kind, relevantIds: q.relevantIds, selected,
      correct: selected !== null && q.relevantIds.includes(selected), wrong: selected !== null && !q.relevantIds.includes(selected) };
  });
  const positives = rows.filter((r) => r.relevantIds.length > 0); const negatives = rows.filter((r) => r.relevantIds.length === 0);
  const correct = positives.filter((r) => r.correct).length; const wrong = rows.filter((r) => r.wrong).length;
  const negativeSelections = negatives.filter((r) => r.selected !== null).length; const abstained = rows.filter((r) => r.selected === null).length;
  return [policy, { queries: rows.length, positives: positives.length, negatives: negatives.length, correct, wrong, negativeSelections, abstained,
    positiveRecall: correct / positives.length, wrongInjectionRate: wrong / rows.length,
    negativeInjectionRate: negativeSelections / negatives.length, abstentionRate: abstained / rows.length,
    cost: { modelCalls: 0, scoredPairs, offeredBytes, scoringMs: Number(elapsedMs.toFixed(3)) }, rows }];
}));
process.stdout.write(JSON.stringify({ kind: 'synthetic-retrieval-diagnostic', schemaVersion: 1, split,
  dataDigest, policyDigest: retrievalPolicyDigest, legacyPolicy: 'query token coverage >= 0.15; ID tie break; top 1',
  environment: { node: process.version, platform: process.platform },
  limitations: ['Author-written fixtures, visible to the developer; not a blinded or real-world held-out evaluation.',
    'Scope eligibility is a synthetic declaration; no source repair or Agent success is measured.',
    'All utility is neutral; no learned feedback or online update is simulated.',
    'Timing is one local pass, not a performance benchmark; output bytes exclude prompt framing and model context.',
    'Negation, synonyms and cross-language meaning remain unsupported.'], groups }, null, 2) + '\n');
