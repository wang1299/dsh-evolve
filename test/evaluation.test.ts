import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluateExperiment, type Experiment } from '../src/evaluation.js';

function sample(): Experiment {
  return { schemaVersion: 1, accumulationTaskIds: ['learn-a'], evaluationTaskIds: ['unseen-b'],
    runs: (['baseline', 'retrieval', 'evolve'] as const).map((arm) => ({
      runId: randomUUID(), taskId: 'unseen-b', seed: 1, arm, source: 'synthetic', model: 'fixture-only', temperature: 0,
      budget: { tokens: 1000, toolCalls: 10 }, environmentDigest: 'a'.repeat(64), taskDigest: 'b'.repeat(64), acceptanceDigest: 'c'.repeat(64),
      basePromptDigest: 'd'.repeat(64), agentConfigDigest: 'e'.repeat(64), experienceBankDigest: 'f'.repeat(64), policyDigest: '0'.repeat(64),
      experienceRefs: arm === 'baseline' ? [] : [{ id: randomUUID(), revision: 2, sourceTaskId: 'learn-a' }], accepted: arm === 'baseline' ? false : null,
      sameErrorRecurred: null, wrongExperienceApplied: null, humanRework: null, extraCostUSD: null,
    })) };
}
test('evaluation retains failures and unknowns and marks synthetic comparisons', () => {
  const report = evaluateExperiment(sample()); const raw = JSON.stringify(report);
  assert.match(raw, /synthetic-format-check-only/); assert.match(raw, /"unknown":1/);
  assert.match(raw, /"accepted":false/); assert.match(raw, /"meanOfKnown":null/);
});
test('evaluation rejects incomparable controls, leakage, duplicates and missing arms', () => {
  const controls = sample(); controls.runs[1]!.model = 'other-model'; assert.throws(() => evaluateExperiment(controls), /controls differ/);
  const leakage = sample(); leakage.runs[1]!.experienceRefs[0]!.sourceTaskId = 'unseen-b'; assert.throws(() => evaluateExperiment(leakage), /leaks/);
  const prompt = sample(); prompt.runs[1]!.basePromptDigest = '0'.repeat(64); assert.throws(() => evaluateExperiment(prompt), /controls differ/);
  const config = sample(); config.runs[1]!.agentConfigDigest = '0'.repeat(64); assert.throws(() => evaluateExperiment(config), /controls differ/);
  const overlap = sample(); overlap.accumulationTaskIds.push('unseen-b'); assert.throws(() => evaluateExperiment(overlap), /overlap/);
  const duplicate = sample(); duplicate.runs.push(duplicate.runs[0]!); assert.throws(() => evaluateExperiment(duplicate), /Duplicate/);
  const missing = sample(); missing.runs = missing.runs.filter((r) => r.arm !== 'evolve'); assert.throws(() => evaluateExperiment(missing));
});
