import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import type { Evidence, Experience, TestRun, Verification } from '../src/domain.js';
import { experiencePresentation, type ExperiencePresentationState } from '../src/experience-presentation.js';

function fixture() {
  const run = (failure = false): TestRun => ({ exitCode: failure ? 1 : 0, tests: 1, failures: failure ? 1 : 0, errors: 0, skipped: 0,
    durationMs: 1, timedOut: false, summary: '', cases: [{ id: 'test_balance', status: failure ? 'failed' : 'passed' }] });
  const experience: Experience = { schemaVersion: 1, id: 'experience', revision: 2, sourceTaskId: 'source', title: 'Rollback transaction state',
    strategy: 'Restore the prior state on failure.', observedFacts: ['A failed transaction changed the balance.'], inferences: [], recommendations: [],
    scope: { repoId: 'repo', dependencyDigest: 'dependencies', requiredFiles: { 'ledger.py': 'hash' } }, status: 'source_verified', reason: 'verified', verificationId: 'proof', createdAt: '2026-10-23T00:00:00Z' };
  const proof: Verification = { schemaVersion: 2, id: 'proof', sourceTaskId: 'source', repoId: 'repo', baseCommit: 'base', fixCommit: 'fixed', acceptanceDigest: 'acceptance',
    acceptanceFiles: [{ path: 'test_balance.py', content: '' }], environment: {}, commands: [], base: run(true), fixed: run(), regression: run(), verified: true, reason: 'verified', diff: '', createdAt: experience.createdAt };
  const correction: Evidence = { schemaVersion: 1, id: 'correction', taskId: 'source', repoId: 'repo', digest: 'correction-digest', kind: 'correction', note: '转账失败时必须恢复原有余额。', createdAt: experience.createdAt };
  const state: ExperiencePresentationState = { tasks: [{ id: 'source', summary: '修复转账失败后余额不恢复的问题' }, { id: 'target', summary: '库存异常后数量不正确' }],
    applications: [{ id: 'application', taskId: 'target', experienceId: experience.id, revision: 1, createdAt: experience.createdAt }], feedback: [], evidence: [correction],
    provenance: { [experience.id]: { [experience.revision]: { facts: [{ factIndex: 0, factDigest: 'fact' }], citations: [{ factIndex: 0, factDigest: 'fact', evidenceId: correction.id, evidenceDigest: correction.digest }] } } }, verifications: { proof } };
  return { experience, state, proof, correction };
}

test('missing, foreign and unreferenced corrections never become a Chinese reminder', () => {
  const f = fixture();
  f.state.provenance = {};
  let view = experiencePresentation(f.state, f.experience);
  assert.equal(view.reminder, null); assert.equal(view.reminderSource, 'unavailable'); assert.equal(view.reminderLabel, '尚无中文概述');
  assert.equal(view.original.strategy, f.experience.strategy);
  f.experience.strategy = '异常发生时恢复修改前的状态。';
  view = experiencePresentation(f.state, f.experience); assert.equal(view.reminder, f.experience.strategy); assert.equal(view.reminderSource, 'strategy');
  f.state.provenance = { [f.experience.id]: { [f.experience.revision]: { facts: [{ factIndex: 0, factDigest: 'fact' }], citations: [{ factIndex: 0, factDigest: 'fact', evidenceId: f.correction.id, evidenceDigest: f.correction.digest }] } } };
  f.correction.taskId = 'other-task';
  assert.equal(experiencePresentation(f.state, f.experience).reminderSource, 'strategy');
  f.correction.taskId = 'source'; f.correction.repoId = 'other-repository';
  assert.equal(experiencePresentation(f.state, f.experience).reminderSource, 'strategy');
  f.correction.repoId = 'repo'; f.correction.digest = 'changed';
  assert.equal(experiencePresentation(f.state, f.experience).reminderSource, 'strategy');
});

test('a stale fact digest, wrong index or missing current facts cannot provide the Chinese correction', () => {
  for (const mutate of [
    (provenance: NonNullable<ExperiencePresentationState['provenance']>[string][number]) => { provenance.citations[0]!.factDigest = 'previous-fact'; },
    (provenance: NonNullable<ExperiencePresentationState['provenance']>[string][number]) => { provenance.citations[0]!.factIndex = 1; },
    (provenance: NonNullable<ExperiencePresentationState['provenance']>[string][number]) => { delete provenance.facts; },
    (provenance: NonNullable<ExperiencePresentationState['provenance']>[string][number]) => { provenance.facts = []; },
  ]) {
    const f = fixture(); const provenance = f.state.provenance![f.experience.id]![f.experience.revision]!;
    mutate(provenance);
    let view = experiencePresentation(f.state, f.experience);
    assert.equal(view.reminder, null); assert.equal(view.reminderSource, 'unavailable');
    f.experience.strategy = '异常发生时恢复修改前的状态。';
    view = experiencePresentation(f.state, f.experience);
    assert.equal(view.reminderSource, 'strategy'); assert.equal(view.reminder, f.experience.strategy);
  }
});

test('an individually valid citation can supply a correction even when another fact has no source', () => {
  const f = fixture(); f.experience.observedFacts.push('Another observation has no citation.');
  const provenance = f.state.provenance![f.experience.id]![f.experience.revision]!;
  provenance.complete = false; provenance.facts!.push({ factIndex: 1, factDigest: 'unreferenced-fact' });
  const view = experiencePresentation(f.state, f.experience);
  assert.equal(view.reminderSource, 'correction'); assert.equal(view.reminder, f.correction.kind === 'correction' ? f.correction.note : '');
});

test('a cited Chinese correction is presented as an original correction, without invented examples', () => {
  const f = fixture(); const view = experiencePresentation(f.state, f.experience);
  assert.equal(view.problem, f.state.tasks[0]!.summary); assert.equal(view.reminder, f.correction.kind === 'correction' ? f.correction.note : '');
  assert.equal(view.reminderSource, 'correction'); assert.equal(view.reminderLabel, '当时的明确纠正');
  assert.doesNotMatch(JSON.stringify(view), /余额\s*100|节省|避免再次/);
  assert.equal(view.proof.sourceVerified, true);
});

test('only an explicit plain English search suffix is removed, retaining its full original', () => {
  const f = fixture(); f.state.tasks[0]!.summary = '转账失败时恢复余额（检索词：rollback atomicity）';
  let view = experiencePresentation(f.state, f.experience);
  assert.equal(view.problem, '转账失败时恢复余额'); assert.equal(view.problemOriginal, f.state.tasks[0]!.summary); assert.equal(view.problemShortened, true);
  for (const summary of ['修复 ledger.py 中的 rollback', '修复余额（检索词：ledger.py）', '修复余额（检索词：restore_balance）', 'Fix rollback atomicity']) {
    f.state.tasks[0]!.summary = summary; view = experiencePresentation(f.state, f.experience);
    assert.equal(view.problem, summary); assert.equal(view.problemShortened, false);
  }
});

test('missing source, missing report and mismatched report never produce source success', () => {
  const f = fixture(); f.state.tasks = f.state.tasks.filter(task => task.id !== 'source');
  let view = experiencePresentation(f.state, f.experience);
  assert.equal(view.problem, '来源问题记录已不可用'); assert.equal(view.proof.sourceVerified, false);
  assert.ok(view.proof.stages.every(stage => stage.status === 'unknown'));
  f.state.tasks.push({ id: 'source', summary: 'source' }); f.proof.repoId = 'foreign';
  view = experiencePresentation(f.state, f.experience); assert.equal(view.proof.sourceVerified, false); assert.match(view.proof.summary, /归属待核对/);
  delete f.state.verifications.proof;
  view = experiencePresentation(f.state, f.experience); assert.equal(view.proof.available, false); assert.equal(view.proof.sourceVerified, false);
  assert.ok(view.proof.stages.every(stage => stage.status === 'missing'));
});

test('candidate and disabled experience retain historical test facts without becoming verified or enabled', () => {
  const f = fixture(); f.experience.status = 'candidate';
  let view = experiencePresentation(f.state, f.experience);
  assert.equal(view.proof.sourceVerified, false); assert.match(view.proof.summary, /仍待来源验证/);
  f.experience.status = 'disabled'; view = experiencePresentation(f.state, f.experience);
  assert.equal(view.proof.sourceVerified, false); assert.match(view.proof.summary, /已停用/);
  assert.match(view.proof.summary, /不会重新启用/);
});

test('timeouts, unknown exits, empty, skipped and incomplete tests are not shown as passing', () => {
  for (const mutate of [
    (run: TestRun) => { run.timedOut = true; },
    (run: TestRun) => { run.exitCode = null; },
    (run: TestRun) => { run.tests = 0; run.cases = []; },
    (run: TestRun) => { run.skipped = 1; run.cases[0]!.status = 'skipped'; },
    (run: TestRun) => { run.cases = []; },
    (run: TestRun) => { run.tests = 2; run.cases = [run.cases[0]!, run.cases[0]!]; },
  ]) {
    const f = fixture(); mutate(f.proof.fixed); const view = experiencePresentation(f.state, f.experience);
    assert.equal(view.proof.sourceVerified, false); assert.equal(view.proof.stages.find(stage => stage.key === 'fixed')!.status, 'unknown');
  }
});

test('failure, unreproduced problem and replaced failed case never look like a proven repair', () => {
  let f = fixture(); f.proof.regression.exitCode = 1; f.proof.regression.failures = 1;
  assert.equal(experiencePresentation(f.state, f.experience).proof.sourceVerified, false);
  f = fixture(); f.proof.base = structuredClone(f.proof.fixed);
  let view = experiencePresentation(f.state, f.experience); assert.equal(view.proof.sourceVerified, false); assert.equal(view.proof.stages[0]!.text, '未复现原问题');
  f = fixture(); f.proof.fixed.cases[0]!.id = 'replacement_test'; view = experiencePresentation(f.state, f.experience);
  assert.equal(view.proof.sourceVerified, false); assert.match(view.proof.stages[1]!.text, /尚未对应确认/);
  f = fixture(); f.proof.verified = false;
  assert.equal(experiencePresentation(f.state, f.experience).proof.sourceVerified, false);
  f = fixture(); f.proof.base.cases[0]!.status = 'passed';
  view = experiencePresentation(f.state, f.experience);
  assert.equal(view.proof.sourceVerified, false); assert.equal(view.proof.stages[0]!.status, 'unknown');
});

test('partial skips remain visible and do not claim that all tests ran', () => {
  const f = fixture(); f.proof.regression.tests = 2; f.proof.regression.skipped = 1; f.proof.regression.cases.push({ id: 'other', status: 'skipped' });
  const view = experiencePresentation(f.state, f.experience);
  assert.equal(view.proof.sourceVerified, true); assert.match(view.proof.stages[2]!.text, /另有跳过项/); assert.match(view.proof.stages[2]!.detail, /1 项跳过/);
});

test('a provided reference is unconfirmed, accepted remains owner-reported acceptance, later unknown overrides it', () => {
  const f = fixture(); let view = experiencePresentation(f.state, f.experience);
  assert.equal(view.usage.count, 1); assert.equal(view.usage.items[0]!.status, 'unconfirmed'); assert.match(view.usage.items[0]!.detail, /不代表已采用/);
  f.state.feedback.push({ applicationId: 'application', outcome: 'accepted', note: '独立验收通过', createdAt: '2026-10-23T01:00:00Z' });
  view = experiencePresentation(f.state, f.experience); assert.equal(view.usage.items[0]!.label, '你记录了本次任务通过验收');
  assert.equal(view.usage.items[0]!.currentRevision, false);
  f.state.feedback.unshift({ applicationId: 'application', outcome: 'unknown', note: '结果需要核对', createdAt: '2026-10-23T02:00:00Z' });
  view = experiencePresentation(f.state, f.experience); assert.equal(view.usage.items[0]!.status, 'unknown'); assert.match(view.usage.items[0]!.label, /尚未确认/);
  assert.doesNotMatch(view.usage.summary, /成功|提高|有帮助/);
});

test('negative feedback refers to the used version and never claims a newer version was disabled', () => {
  for (const outcome of ['irrelevant', 'rejected', 'counterexample'] as const) {
    const f = fixture(); f.state.feedback.push({ applicationId: 'application', outcome, note: '仅针对所用旧版', createdAt: '2026-10-23T01:00:00Z' });
    const view = experiencePresentation(f.state, f.experience); assert.equal(view.usage.items[0]!.status, outcome);
    assert.equal(view.usage.items[0]!.currentRevision, false); assert.doesNotMatch(view.usage.items[0]!.label, /已停用|新版/);
  }
});

test('presentation is immutable and can execute from toString without imports or runtime dependencies', () => {
  const f = fixture(); const snapshot = structuredClone(f); const expected = experiencePresentation(f.state, f.experience);
  const context = createContext({ state: f.state, experience: f.experience });
  const actual = new Script('(' + experiencePresentation.toString() + ')(state, experience)').runInContext(context) as unknown;
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected); assert.deepEqual(f, snapshot);
});
