import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Store } from '../src/store.js';
import { digest } from '../src/domain.js';

const reportSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('scripted-native-agent-rehearsal'),
  realModel: z.literal(false), benefitEvaluated: z.literal(false), phase: z.enum(['scripted_loop_passed', 'partial']),
  sourceAccepted: z.boolean(), experienceOffered: z.boolean(), transferAccepted: z.boolean().nullable(), feedbackOutcome: z.string().nullable(),
  dbPath: z.string(), scriptedCalls: z.number().int().max(12), captureOverflow: z.boolean(), sourceClosed: z.boolean(),
  sourceBase: z.string(), sourceFix: z.string().nullable(), provenanceComplete: z.boolean(),
  counts: z.object({ tasks: z.number(), experiences: z.number(), applications: z.number(), feedback: z.number() }),
  tools: z.array(z.object({ name: z.string(), isError: z.boolean() })),
  sourceProof: z.object({ verified: z.boolean(), base: z.number(), fixed: z.number(), regression: z.number() }).nullable(),
});
function runFixture(scenario: string, expectedExit: number) {
  const out = join(mkdtempSync(join(tmpdir(), 'evolve-rehearsal-')), 'report.json');
  const run = spawnSync(process.execPath, ['dist/scripts/agent-rehearsal.js', '--scenario', scenario, '--report', out],
    { encoding: 'utf8', windowsHide: true, timeout: 150000 });
  assert.equal(run.status, expectedExit, run.stderr);
  const bytes = readFileSync(out, 'utf8');
  assert.ok(!bytes.includes('"messages"') && !bytes.includes('"content"') && !bytes.includes('"code"'), 'no full model conversation in the report');
  return reportSchema.parse(JSON.parse(bytes));
}

test('actual AgentLoop rehearses source proof, exact fact receipts and new-session delivery without a real model', () => {
  const report = runFixture('happy', 0);
  assert.equal(report.realModel, false); assert.equal(report.benefitEvaluated, false);
  assert.equal(report.phase, 'scripted_loop_passed');
  assert.equal(report.sourceAccepted, true); assert.equal(report.experienceOffered, true);
  assert.equal(report.transferAccepted, true); assert.equal(report.feedbackOutcome, 'accepted');
  assert.deepEqual(report.counts, { tasks: 2, experiences: 1, applications: 1, feedback: 1 });
  assert.equal(report.scriptedCalls, 11); assert.equal(report.captureOverflow, false);
  assert.deepEqual(report.tools.map((tool) => tool.name), ['evolve_begin_task', 'evolve_record_correction', 'evolve_propose_experience',
    'evolve_verify_experience', 'evolve_link_fact_evidence', 'evolve_finish_task', 'evolve_begin_task', 'evolve_finish_task']);
  assert.ok(report.tools.every((tool) => !tool.isError));
  const store = new Store(report.dbPath);
  try {
    const experience = store.experiences()[0]!; const proof = store.verification(experience.verificationId!)!;
    assert.equal(experience.status, 'source_verified'); assert.equal(experience.revision, 3);
    assert.equal(proof.verified, true); assert.equal(proof.baseCommit, report.sourceBase); assert.equal(proof.fixCommit, report.sourceFix);
    assert.equal(proof.base.failures, 1); assert.equal(proof.fixed.exitCode, 0); assert.equal(proof.regression.exitCode, 0);
    const citations = store.citations(experience.id, experience.revision);
    assert.equal(citations.length, 1); assert.equal(citations[0]!.factDigest, digest(experience.observedFacts[0]!));
    const evidence = store.evidence(citations[0]!.evidenceId)!;
    assert.equal(evidence.kind, 'correction'); assert.equal(evidence.taskId, experience.sourceTaskId);
    if (evidence.kind === 'correction') assert.equal(evidence.note, 'Restore the original balance when a transaction fails.');
    assert.equal(citations[0]!.evidenceDigest, evidence.digest);
    const app = store.applications()[0]!; const target = store.task(app.taskId)!;
    assert.equal(app.experienceId, experience.id); assert.equal(app.revision, experience.revision);
    assert.notEqual(target.sessionId, store.task(experience.sourceTaskId)!.sessionId);
    assert.ok(store.tasks().every((task) => task.state === 'closed'));
    assert.equal(store.feedback()[0]!.applicationId, app.id);
    assert.match(store.feedback()[0]!.note, /Host synthetic benchmark acceptance/);
  } finally { store.close(); }
});

test('the T011 malformed receipt cannot create a candidate or reach transfer through an actual Agent', () => {
  const report = runFixture('bad-citation', 1);
  assert.equal(report.phase, 'partial'); assert.equal(report.sourceAccepted, false);
  assert.equal(report.sourceClosed, false); assert.equal(report.sourceProof, null);
  assert.deepEqual(report.counts, { tasks: 1, experiences: 0, applications: 0, feedback: 0 });
  assert.equal(report.tools.at(-1)!.name, 'evolve_propose_experience'); assert.equal(report.tools.at(-1)!.isError, true);
  assert.equal(report.transferAccepted, null); assert.equal(report.experienceOffered, false);
});

test('a scripted self-report or idle cannot override failing external source acceptance', () => {
  const report = runFixture('failed-proof', 1);
  assert.equal(report.phase, 'partial'); assert.equal(report.sourceAccepted, false);
  assert.equal(report.sourceProof!.verified, false); assert.equal(report.sourceProof!.fixed, 1);
  assert.equal(report.sourceClosed, false); assert.equal(report.provenanceComplete, false);
  assert.deepEqual(report.counts, { tasks: 1, experiences: 1, applications: 0, feedback: 0 });
  assert.equal(report.transferAccepted, null); assert.equal(report.feedbackOutcome, null);
});

test('a source-verified record with sharing disabled cannot be reported as delivered or accepted transfer', () => {
  const report = runFixture('sharing-off', 1);
  assert.equal(report.sourceAccepted, true); assert.equal(report.phase, 'partial');
  assert.equal(report.experienceOffered, false); assert.equal(report.transferAccepted, null); assert.equal(report.feedbackOutcome, null);
  assert.deepEqual(report.counts, { tasks: 2, experiences: 1, applications: 0, feedback: 0 });
});

test('missing explicit user correction cannot be invented from the scripted adapter constants', () => {
  const report = runFixture('missing-correction', 1);
  assert.equal(report.phase, 'partial'); assert.equal(report.sourceAccepted, false); assert.equal(report.sourceProof, null);
  assert.equal(report.sourceFix, null); assert.equal(report.sourceClosed, false); assert.equal(report.feedbackOutcome, null);
  assert.deepEqual(report.counts, { tasks: 1, experiences: 0, applications: 0, feedback: 0 });
  assert.deepEqual(report.tools.map((tool) => tool.name), ['evolve_begin_task']);
  const store = new Store(report.dbPath);
  try { assert.equal(store.evidenceRecords().length, 0); } finally { store.close(); }
});
