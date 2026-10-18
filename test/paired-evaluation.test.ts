import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, type Verification } from '../src/domain.js';
import { evaluateExperiment } from '../src/evaluation.js';
import { arms, evaluatePairedExperiment, experienceBankDigest, policyDigests, requireExperienceExposure, reservePairedRun,
  selectComparisonExperience, type PairedExperiment } from '../src/paired-evaluation.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';

const hash = (x: string): string => digest(x);
const acceptanceDigest = hash('test_acceptance.py:' + hash('# fixture\n'));
const environment = { node: 'fixture', python: 'fixture', pytest: 'fixture', platform: 'fixture', dependencyDigest: hash('dependencies') };
function sample(): PairedExperiment {
  const source = randomUUID(); const taskId = randomUUID(); const exp = randomUUID();
  const task = { id: taskId, taskDigest: hash('task'), sourceDigest: hash('source'), baseCommit: 'a'.repeat(40),
    basePromptDigest: hash('base-prompt'), acceptanceDigest };
  const controls = { model: 'gpt-6.1-sol', reasoningEffort: 'low' as const, providerRetries: 0 as const, timeoutMs: 90000, maxToolCalls: 0 as const, maxOutputBytes: 1048576 };
  const plans = arms.map((arm) => ({ runId: randomUUID(), taskId, replicate: 0, arm, promptDigest: arm === 'baseline' ? task.basePromptDigest : hash(arm),
    experienceRefs: arm === 'baseline' ? [] : [{ id: exp, revision: 2, sourceTaskId: source }], policyDigest: policyDigests[arm], selectionReasons: ['fixture'] }));
  return { schemaVersion: 2, kind: 'codex-synthetic-paired', manifest: { id: randomUUID(), controls, cliVersion: 'fixture-only',
    temperature: null, samplingSeed: null, serverModelRevision: null, tokenHardLimit: null, costHardLimitUSD: null, inputByteLimit: 32768,
    limitations: ['Test schema fixture, not live model evidence.'], environmentDigest: hash(JSON.stringify(environment)), experienceBankDigest: hash('bank'), repoId: hash('repo'),
    accumulationTaskIds: [source], tasks: [task], bank: [{ id: exp, revision: 2, sourceTaskId: source, contextDigest: hash('context') }],
    source: { artifactDigest: hash('artifact'), originalTaskId: randomUUID(), originalExperienceId: randomUUID(), originalRevision: 2,
      replayTaskId: source, replayVerificationId: randomUUID() }, plans },
    runs: plans.map((p) => ({ runId: p.runId, status: 'failed', callStarted: true,
      runtime: { status: 'failed', reason: 'timeout', controls, transport: 'https', toolCalls: 0, durationMs: 90000, usage: null },
      cliVersion: 'fixture-only', environmentDigest: hash(JSON.stringify(environment)), experienceBankDigest: hash('bank'), task, promptDigest: p.promptDigest,
      experienceRefs: p.experienceRefs, verification: null, accepted: null, failure: 'codex_timeout',
      sameErrorRecurred: null, wrongExperienceApplied: null, humanRework: null, extraCostUSD: null })) };
}
function completed(input: PairedExperiment): void {
  const r = input.runs[0]!;
  const run = { exitCode: 0, tests: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, timedOut: false, summary: 'fixture', cases: [{ id: 'acceptance.case', status: 'passed' as const }] };
  const proof: Verification = { schemaVersion: 2, id: randomUUID(), sourceTaskId: r.task.id, repoId: input.manifest.repoId,
    baseCommit: r.task.baseCommit, fixCommit: 'b'.repeat(40), acceptanceDigest: r.task.acceptanceDigest,
    acceptanceFiles: [{ path: 'test_acceptance.py', content: '# fixture\n' }], environment, commands: [['fixture']],
    base: { ...run, exitCode: 1, failures: 1, cases: [{ id: 'acceptance.case', status: 'failed' }] }, fixed: run, regression: run,
    verified: true, reason: 'fixture', diff: 'fixture', createdAt: new Date().toISOString() };
  r.status = 'completed'; r.runtime = { ...r.runtime!, status: 'completed', reason: null }; r.failure = null;
  r.verification = proof; r.accepted = true;
}

test('v2 counts all invocations, failed attempts and unknown outcomes; unfinished runs remain explicit', () => {
  const input = sample(); completed(input);
  input.runs[1]!.status = 'running'; input.runs[1]!.runtime = null;
  const report = JSON.parse(JSON.stringify(evaluateExperiment(input)));
  assert.equal(report.preliminary, true); assert.equal(report.pairs, 1);
  assert.equal(report.experienceComparison, 'experience_offered_benefit_unproven');
  assert.equal(report.groups.baseline.acceptedPerAttempt, 1);
  assert.equal(report.groups.evolve.attempts, 1); assert.equal(report.groups.evolve.acceptedPerAttempt, 0);
  assert.equal(report.groups.evolve.metrics.accepted.unknown, 1); assert.equal(report.groups.evolve.usage.unknown, 1);
  assert.equal(report.groups.retrieval.notCompleted, 1);
  const hostFailure = sample(); hostFailure.runs[0]!.runtime = null; hostFailure.runs[0]!.callStarted = false;
  const hostReport = JSON.parse(JSON.stringify(evaluatePairedExperiment(hostFailure)));
  assert.equal(hostReport.groups.baseline.attempts, 0); assert.equal(hostReport.groups.baseline.acceptedPerAttempt, null);
});

test('a comparison with abstention is labeled honestly and the live recipe refuses it before any model call', () => {
  const input = sample(); requireExperienceExposure(input.manifest.plans);
  for (const plan of input.manifest.plans) {
    plan.experienceRefs = []; plan.promptDigest = input.manifest.tasks[0]!.basePromptDigest;
    const run = input.runs.find((r) => r.runId === plan.runId)!;
    run.experienceRefs = []; run.promptDigest = plan.promptDigest;
  }
  const report = JSON.parse(JSON.stringify(evaluatePairedExperiment(input)));
  assert.equal(report.experienceComparison, 'no_experience_exposure');
  assert.equal(report.groups.evolve.experienceOfferedAttempts, 0);
  assert.throws(() => requireExperienceExposure(input.manifest.plans), /experience_exposure_missing/);
  input.manifest.plans[1]!.promptDigest = hash('injection-without-reference');
  assert.throws(() => evaluatePairedExperiment(input), /exposure contradicts/);
});

test('planned experience is not reported as offered before an invocation, and partial starts remain partial', () => {
  const input = sample();
  for (const run of input.runs) { run.status = 'not_started'; run.callStarted = false; run.runtime = null; run.failure = null; }
  let report = JSON.parse(JSON.stringify(evaluatePairedExperiment(input)));
  assert.equal(report.experienceComparison, 'no_treatment_attempts');
  assert.equal(report.plannedExperienceGroups, 2);
  input.runs[1]!.status = 'running'; input.runs[1]!.callStarted = true;
  report = JSON.parse(JSON.stringify(evaluatePairedExperiment(input)));
  assert.equal(report.experienceComparison, 'partial_experience_exposure');
  assert.equal(report.groups.evolve.experienceOfferedAttempts, 0);
});

test('v2 rejects control drift, changed task/bank, missing and duplicate arms, and evaluation leakage', () => {
  const changes: ((x: PairedExperiment) => void)[] = [
    (x) => { x.runs[1]!.runtime!.controls = { ...x.runs[1]!.runtime!.controls, model: 'other' }; },
    (x) => { x.runs[1]!.task = { ...x.runs[1]!.task, sourceDigest: hash('changed') }; },
    (x) => { x.runs[1]!.experienceBankDigest = hash('changed'); },
    (x) => { x.manifest.plans.pop(); x.runs.pop(); },
    (x) => { x.manifest.plans.push({ ...x.manifest.plans[0]!, runId: randomUUID() }); },
    (x) => { x.runs.push(x.runs[0]!); },
    (x) => { x.runs[0]!.runId = randomUUID(); },
    (x) => { x.manifest.accumulationTaskIds.push(x.manifest.tasks[0]!.id); },
    (x) => { x.manifest.bank[0]!.sourceTaskId = x.manifest.tasks[0]!.id; },
    (x) => { x.manifest.plans[0]!.experienceRefs = x.manifest.plans[1]!.experienceRefs; },
    (x) => { x.manifest.plans[1]!.experienceRefs = [{ ...x.manifest.plans[1]!.experienceRefs[0]!, revision: 3 }]; },
    (x) => { x.manifest.plans[1]!.policyDigest = hash('new-policy'); },
  ];
  for (const change of changes) { const input = sample(); change(input); assert.throws(() => evaluatePairedExperiment(input)); }
});

test('v2 rejects failed or unknown runs claiming success and false verification claims', () => {
  const changes: ((x: PairedExperiment) => void)[] = [
    (x) => { x.runs[0]!.accepted = true; },
    (x) => { x.runs[0]!.status = 'completed'; },
    (x) => { x.runs[0]!.status = 'unknown'; },
    (x) => { x.runs[0]!.callStarted = false; },
    (x) => { completed(x); x.runs[0]!.runtime!.toolCalls = 1; },
    (x) => { completed(x); x.runs[0]!.verification!.fixed.cases = []; },
    (x) => { completed(x); x.runs[0]!.verification!.fixed.timedOut = true; },
    (x) => { completed(x); x.runs[0]!.verification!.environment = { changed: 'yes' }; },
    (x) => { completed(x); x.runs[0]!.verification!.acceptanceDigest = hash('changed'); },
    (x) => { completed(x); x.runs[0]!.verification!.acceptanceFiles[0]!.content = '# replaced\n'; },
    (x) => { completed(x); x.runs[0]!.verification!.sourceTaskId = randomUUID(); },
    (x) => { completed(x); x.runs[0]!.verification!.fixCommit = x.runs[0]!.verification!.baseCommit; },
    (x) => { completed(x); x.runs[0]!.verification!.verified = false; x.runs[0]!.accepted = false; },
  ];
  for (const change of changes) { const input = sample(); change(input); assert.throws(() => evaluatePairedExperiment(input)); }
});

test('per-plan reservation has a single atomic winner and cannot be reopened after interruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evolve-paired-reservation-')); const plan = sample().manifest.plans[0]!;
  const results = await Promise.allSettled([reservePairedRun(directory, plan), reservePairedRun(directory, plan)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const success = results.find((r) => r.status === 'fulfilled')!; assert.equal(success.status, 'fulfilled');
  if (success.status !== 'fulfilled') throw new Error('No reservation');
  const original = await readFile(success.value, 'utf8');
  await assert.rejects(reservePairedRun(directory, plan), /EEXIST/);
  assert.equal(await readFile(success.value, 'utf8'), original);
});

test('retrieval uses only text while evolve requires verified source; evaluation feedback cannot silently alter frozen bank', { timeout: 60000 }, async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
  try {
    const source = service.begin('source', 'rollback'); await f.fix();
    const known = service.propose(source.id, { title: 'rollback', strategy: 'restore state on exception', observedFacts: ['state changed before error'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
    const verified = await service.verify(known.id); service.finish(source.id);
    const unsupported = service.propose(source.id, { title: 'rollback transaction', strategy: 'transaction', observedFacts: ['not yet verified'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
    const task = service.begin('target', 'rollback transaction'); const frozen = experienceBankDigest(store);
    assert.equal(selectComparisonExperience(service, task.id, 'baseline').context, null);
    assert.equal(selectComparisonExperience(service, task.id, 'retrieval').context?.id, unsupported.id);
    assert.equal(selectComparisonExperience(service, task.id, 'evolve').context?.id, verified.id);
    assert.equal(experienceBankDigest(store), frozen, 'an application without feedback cannot change utility');
    service.feedback({ id: randomUUID(), applicationId: store.applications()[0]!.id, outcome: 'accepted', note: 'fixture', extraCost: null, humanRework: null });
    assert.notEqual(experienceBankDigest(store), frozen, 'a new feedback observation must invalidate the freeze');
  } finally { store.close(); }
});
