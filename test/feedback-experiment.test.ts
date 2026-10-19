/** Schema fixtures, not model runs or repair evidence. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, experienceSchema, taskSchema, verificationSchema, applicationSchema, feedbackSchema } from '../src/domain.js';
import { feedbackControls, feedbackExperimentSchema, feedbackProtocolDigest, evaluateFeedbackExperiment, reserveFeedbackProtocol, type FeedbackExperiment } from '../src/feedback-experiment.js';
import { arms, feedbackPolicyDigests, type PairedExperiment } from '../src/paired-evaluation.js';
import { evaluateExperiment } from '../src/evaluation.js';

const env = { node: 'fixture', python: 'fixture', pytest: 'fixture', platform: 'fixture', dependencyDigest: 'b'.repeat(64) };
const at = '2026-10-19T00:00:00.000Z'; const acceptance = digest('test_acceptance.py:' + digest('# schema fixture\n'));
function proof(taskId: string) {
  const run = { exitCode: 0, tests: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, timedOut: false, summary: 'schema fixture', cases: [{ id: 'fixture::case', status: 'passed' }] };
  return verificationSchema.parse({ schemaVersion: 2, id: randomUUID(), sourceTaskId: taskId, repoId: 'a'.repeat(64), baseCommit: 'a'.repeat(40), fixCommit: 'b'.repeat(40),
    acceptanceDigest: acceptance, acceptanceFiles: [{ path: 'test_acceptance.py', content: '# schema fixture\n' }], environment: env, commands: [['fixture']],
    base: { ...run, exitCode: 1, failures: 1, cases: [{ id: 'fixture::case', status: 'failed' }] }, fixed: run, regression: run, verified: true, reason: 'Schema fixture, not actual verification', diff: '', createdAt: at });
}
function sample(): FeedbackExperiment {
  const source = randomUUID(); const sourceProof = proof(source);
  const experience = experienceSchema.parse({ schemaVersion: 1, id: randomUUID(), revision: 2, sourceTaskId: source, title: 'transaction rollback', strategy: 'restore original mapping',
    observedFacts: ['Schema fixture only'], inferences: [], recommendations: [], scope: { repoId: 'a'.repeat(64), dependencyDigest: env.dependencyDigest, requiredFiles: {} },
    status: 'source_verified', reason: 'Schema fixture only', verificationId: sourceProof.id, createdAt: at });
  const task = taskSchema.parse({ schemaVersion: 1, id: randomUUID(), sessionId: 'fixture', summary: 'transaction rollback: novel payment wording', scope: experience.scope, baseCommit: sourceProof.fixCommit, state: 'open', createdAt: at });
  const ref = { id: experience.id, revision: experience.revision, sourceTaskId: source };
  const plan = { runId: randomUUID(), taskId: task.id, replicate: 0, arm: 'evolve' as const, promptDigest: digest('offered'), experienceRefs: [ref], policyDigest: feedbackPolicyDigests.evolve, selectionReasons: ['fixture'] };
  const sourceBank = digest(JSON.stringify({ experiences: [experience], proofs: [sourceProof], feedback: [], applications: [], feedbackTasks: [] }));
  return feedbackExperimentSchema.parse({ schemaVersion: 3, kind: 'codex-feedback-paired', protocolDigest: feedbackProtocolDigest, executionSource: 'process-fixture',
    budget: { maxCalls: 7, accumulationCalls: 1, evaluationCalls: 6 }, status: 'accumulation', failure: null, cliVersion: 'codex-cli 0.163.0-alpha.10.2', controls: feedbackControls,
    environmentDigest: digest(JSON.stringify(env)), repoId: 'a'.repeat(64), source: { artifactDigest: '36ef1b7891d3f2d976f1fc28c3d690448885cb87f6fdeaa663b547fb50961bee',
      original: { taskId: randomUUID(), experienceId: randomUUID(), revision: 2 }, experience, verification: sourceProof },
    accumulation: { plan, taskRecord: task, application: applicationSchema.parse({ id: randomUUID(), taskId: task.id, experienceId: experience.id, revision: 2, reason: 'fixture', createdAt: at }), feedback: null,
      run: { runId: plan.runId, status: 'not_started', callStarted: false, runtime: null, cliVersion: 'codex-cli 0.163.0-alpha.10.2', environmentDigest: digest(JSON.stringify(env)),
        experienceBankDigest: sourceBank, task: { id: task.id, taskDigest: digest('task'), sourceDigest: digest('code'), baseCommit: task.baseCommit, basePromptDigest: digest('base'), acceptanceDigest: acceptance },
        promptDigest: plan.promptDigest, experienceRefs: [ref], verification: null, accepted: null, failure: null, sameErrorRecurred: null, wrongExperienceApplied: null, humanRework: null, extraCostUSD: null } }, evaluation: null });
}
function accumulated(e: FeedbackExperiment): void {
  const a = e.accumulation; a.run.status = 'completed'; a.run.callStarted = true;
  a.run.runtime = { status: 'completed', reason: null, controls: { ...feedbackControls }, transport: 'https', toolCalls: 0, durationMs: 10, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 } };
  a.run.verification = { ...proof(a.run.task.id), baseCommit: a.run.task.baseCommit, fixCommit: 'c'.repeat(40) }; a.run.accepted = true; a.taskRecord.state = 'closed';
  a.feedback = feedbackSchema.parse({ id: randomUUID(), applicationId: a.application.id, outcome: 'accepted', note: 'Schema fixture with verification reference', extraCost: null, humanRework: null, createdAt: at });
}
function evaluation(e: FeedbackExperiment): void {
  accumulated(e); const a = e.accumulation; const s = e.source; const ref = { id: s.experience.id, revision: s.experience.revision, sourceTaskId: s.experience.sourceTaskId };
  const tasks = [0, 1].map((n) => ({ ...a.run.task, baseCommit: a.run.verification!.fixCommit, id: randomUUID(), taskDigest: digest('target' + n) }));
  const bank = digest(JSON.stringify({ experiences: [s.experience], proofs: [s.verification], feedback: [a.feedback], applications: [a.application], feedbackTasks: [{ id: a.taskRecord.id, summary: a.taskRecord.summary, scope: a.taskRecord.scope }] }));
  const plans = tasks.flatMap((t) => arms.map((arm) => ({ runId: randomUUID(), taskId: t.id, replicate: 0, arm, promptDigest: arm === 'evolve' ? digest('offered') : t.basePromptDigest,
    experienceRefs: arm === 'evolve' ? [ref] : [], policyDigest: feedbackPolicyDigests[arm], selectionReasons: ['fixture'] })));
  const inner: PairedExperiment = { schemaVersion: 2, kind: 'codex-synthetic-paired', manifest: { id: randomUUID(), controls: { ...feedbackControls }, cliVersion: e.cliVersion,
    temperature: null, samplingSeed: null, serverModelRevision: null, tokenHardLimit: null, costHardLimitUSD: null, inputByteLimit: 32768, limitations: ['Schema fixture, not a model run.'],
    environmentDigest: e.environmentDigest, experienceBankDigest: bank, repoId: e.repoId, accumulationTaskIds: [ref.sourceTaskId, a.taskRecord.id], tasks,
    bank: [{ ...ref, contextDigest: digest(JSON.stringify({ ...ref, title: s.experience.title, strategy: s.experience.strategy })) }],
    source: { artifactDigest: s.artifactDigest, originalTaskId: s.original.taskId, originalExperienceId: s.original.experienceId, originalRevision: s.original.revision,
      replayTaskId: ref.sourceTaskId, replayVerificationId: s.verification.id }, plans },
    runs: plans.map((p) => ({ ...a.run, runId: p.runId, status: 'not_started', callStarted: false, runtime: null, verification: null, accepted: null, experienceBankDigest: bank,
      task: tasks.find((t) => t.id === p.taskId)!, promptDigest: p.promptDigest, experienceRefs: p.experienceRefs })) };
  e.evaluation = inner; e.status = 'evaluation';
}

test('v3 keeps accumulation cost, unstarted evaluation and failures without creating feedback', () => {
  const e = sample(); let report = JSON.parse(JSON.stringify(evaluateExperiment(e)));
  assert.equal(report.calls.total, 0); assert.equal(report.evaluation, null); assert.equal(report.accumulation.feedbackCreated, false);
  assert.equal(report.evidenceKind, 'process-fixture-feedback-transfer'); assert.equal(report.calls.modelCalls, 0);
  e.accumulation.run.status = 'failed'; e.accumulation.run.callStarted = true; e.accumulation.run.failure = 'network'; e.status = 'failed'; e.failure = 'accumulation_not_accepted';
  report = JSON.parse(JSON.stringify(evaluateFeedbackExperiment(e))); assert.equal(report.calls.total, 1); assert.equal(report.accumulation.accepted, null); assert.equal(report.evaluation, null);
});
test('v3 exposes the planned feedback contrast only after actual attempts and preserves unknown outcomes', () => {
  const e = sample(); evaluation(e); let report = JSON.parse(JSON.stringify(evaluateFeedbackExperiment(e)));
  assert.equal(report.calls.total, 1); assert.equal(report.totalObservedUsage.inputTokens, 100); assert.equal(report.evaluation.experienceComparison, 'no_feedback_attempts');
  for (const r of e.evaluation!.runs) { r.callStarted = true; r.status = 'failed'; r.failure = 'network'; }
  report = JSON.parse(JSON.stringify(evaluateFeedbackExperiment(e)));
  assert.equal(report.calls.total, 7); assert.equal(report.evaluation.groups.evolve.experienceOfferedAttempts, 2);
  assert.equal(report.evaluation.experienceComparison, 'planned_feedback_contrast_observed_benefit_unproven');
  assert.equal(report.evaluation.groups.evolve.metrics.accepted.unknown, 2);
});
test('v3 refuses fabricated acceptance, drift, leakage, extra calls and changed feedback provenance', () => {
  const changes: ((e: FeedbackExperiment) => void)[] = [
    (e) => { e.accumulation.run.accepted = false; }, (e) => { e.accumulation.run.status = 'failed'; },
    (e) => { e.accumulation.feedback!.applicationId = randomUUID(); }, (e) => { e.accumulation.application.revision++; },
    (e) => { e.accumulation.run.verification!.fixed.cases = []; }, (e) => { e.source.verification.verified = false; },
    (e) => { e.accumulation.taskRecord.summary = 'changed accepted language'; }, (e) => { e.accumulation.taskRecord.scope.repoId = 'c'.repeat(64); },
    (e) => { e.evaluation!.manifest.tasks[0]!.id = e.accumulation.taskRecord.id; }, (e) => { e.evaluation!.manifest.controls.model = 'other'; },
    (e) => { e.evaluation!.manifest.plans[2]!.policyDigest = digest('old-method'); }, (e) => { e.evaluation!.manifest.source.originalTaskId = randomUUID(); },
    (e) => { e.evaluation!.runs.push({ ...e.evaluation!.runs[0]! }); }, (e) => { e.evaluation!.manifest.plans[0]!.experienceRefs = e.evaluation!.manifest.plans[2]!.experienceRefs; },
    (e) => { e.status = 'completed'; }, (e) => { e.accumulation.run.runtime!.toolCalls = 1; },
    (e) => { e.executionSource = 'prepare-only'; }, (e) => { e.controls.timeoutMs = 1000; },
    (e) => { e.evaluation!.manifest.bank[0]!.contextDigest = digest('changed content'); },
    (e) => { e.accumulation.run.verification!.fixCommit = 'f'.repeat(40); },
    (e) => { e.evaluation!.manifest.tasks[0]!.baseCommit = 'f'.repeat(40); },
    (e) => { e.source.verification.fixCommit = 'f'.repeat(40); },
    (e) => { e.accumulation.run.task.baseCommit = 'f'.repeat(40); e.accumulation.taskRecord.baseCommit = 'f'.repeat(40); e.accumulation.run.verification!.baseCommit = 'f'.repeat(40); },
  ];
  for (const [i, change] of changes.entries()) { const e = sample(); evaluation(e); change(e); assert.throws(() => evaluateFeedbackExperiment(e), 'invalid mutation ' + i); }
});
test('live protocol reservation has one atomic winner and a new output path cannot renew it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'feedback-slot-'));
  const results = await Promise.allSettled([reserveFeedbackProtocol(dir, 'one'), reserveFeedbackProtocol(dir, 'two')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const winner = results.find((r) => r.status === 'fulfilled')!; if (winner.status !== 'fulfilled') throw new Error('No winner');
  const bytes = await readFile(winner.value, 'utf8'); await assert.rejects(reserveFeedbackProtocol(dir, 'new-directory'), /EEXIST/);
  assert.equal(await readFile(winner.value, 'utf8'), bytes);
});
