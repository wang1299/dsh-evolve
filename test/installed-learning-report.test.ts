import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { installedReportSchema, type InstalledReport } from '../scripts/installed-learning-report.js';

const complete = (): InstalledReport => ({ schemaVersion: 1, kind: 'installed-scripted-auto-learning', scenario: 'happy', archiveDigest: 'a'.repeat(64),
  realModel: false, modelHttpRequests: 0, benefitEvaluated: false, phase: 'passed', reason: 'completed', stage: 'completed',
  sourceTaskId: randomUUID(), targetTaskId: randomUUID(), experienceId: randomUUID(), revision: 2,
  autoCandidateCreated: true, candidateInitiallyInactive: true, sourceVerified: true, receiptReturned: true, modelContinued: true, experienceOffered: true,
  targetAccepted: true, feedbackRecorded: true, extractionState: 'candidate', logicalExtractions: 1, scriptedAgentCalls: 11,
  sourceProof: { verified: true, baseFailures: 1, fixedFailures: 0, regressionFailures: 0 },
  targetProof: { verified: true, baseFailures: 1, fixedFailures: 0, regressionFailures: 0 },
  tools: [{ name: 'evolve_begin_task', isError: false }], counts: { tasks: 2, experiences: 1, applications: 1, feedback: 1 } });

test('installed learning cannot pass from DB selection without an actual receipt and continued model call', () => {
  const value = complete(); assert.ok(installedReportSchema.safeParse(value).success);
  assert.equal(installedReportSchema.safeParse({ ...value, receiptReturned: false }).success, false);
  assert.equal(installedReportSchema.safeParse({ ...value, modelContinued: false }).success, false);
});
test('source success cannot stand in for target acceptance or allow benchmark feedback', () => {
  const value = complete();
  for (const change of [{ targetAccepted: null }, { targetProof: null }, { targetProof: { ...value.targetProof, verified: false } }]) {
    assert.equal(installedReportSchema.safeParse({ ...value, ...change }).success, false);
  }
});
test('manual proposal, activation or provider claims cannot be reported as an installed automatic offline loop', () => {
  const value = complete();
  for (const change of [{ candidateInitiallyInactive: false }, { realModel: true }, { modelHttpRequests: 1 }, { benefitEvaluated: true },
    { tools: [{ name: 'evolve_propose_experience', isError: false }] }, { rawResponse: 'private' }]) {
    assert.equal(installedReportSchema.safeParse({ ...value, ...change }).success, false);
  }
});
