import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('actual AgentLoop rehearses source proof, exact fact receipts and new-session delivery without a real model', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'evolve-rehearsal-')), 'report.json');
  const run = spawnSync(process.execPath, ['dist/scripts/agent-rehearsal.js', '--report', out], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.realModel, false); assert.equal(report.benefitEvaluated, false);
  assert.equal(report.phase, 'scripted_loop_passed');
  assert.equal(report.sourceAccepted, true); assert.equal(report.experienceOffered, true);
  assert.equal(report.transferAccepted, true); assert.equal(report.feedbackOutcome, 'accepted');
});
