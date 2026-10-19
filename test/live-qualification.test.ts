import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { consumeQualification, freezeFiles, validateQualification } from '../scripts/live-qualification.js';
import { supplementalBudgetPath, supplementalWork } from '../scripts/dsh-live-t015.js';
import { liveBudgetPath, projectRoot } from '../scripts/dsh-live.js';
import { acceptanceDigest } from '../src/verification.js';

test('qualification rejects new nested Python acceptance files absent from the frozen file map', async () => {
  const work = mkdtempSync(join(tmpdir(), 'evolve-acceptance-drift-'));
  const file = join(work, 'test_acceptance.py'); writeFileSync(file, 'def test_ok(): assert True\n');
  const plan = { frozenFiles: freezeFiles([file]), acceptanceDigests: { [work]: await acceptanceDigest(work) } };
  writeFileSync(join(work, 'plan-digest.txt'), digest(JSON.stringify(plan)));
  await validateQualification(work, plan);
  mkdirSync(join(work, 'nested')); writeFileSync(join(work, 'nested', 'conftest.py'), '# new executable acceptance input\n');
  await assert.rejects(async () => validateQualification(work, plan), /Acceptance.*drift/);
});

test('new live qualification rejects plan/config/install drift before consumption and cannot repeat', async () => {
  const work = mkdtempSync(join(tmpdir(), 'evolve-qualification-')); const file = join(work, 'synthetic-config.json');
  writeFileSync(file, '{"synthetic":true}'); const plan = { frozenFiles: freezeFiles([file]), acceptanceDigests: { [work]: await acceptanceDigest(work) } };
  writeFileSync(join(work, 'plan-digest.txt'), digest(JSON.stringify(plan)));
  await validateQualification(work, plan);
  writeFileSync(file, '{}'); await assert.rejects(consumeQualification(work, plan), /drift/);
  writeFileSync(file, '{"synthetic":true}');
  const changed = { ...plan, changed: true };
  await assert.rejects(consumeQualification(work, changed), /drift/);
  await consumeQualification(work, plan); const first = readFileSync(join(work, 'live-once.json'), 'utf8');
  await assert.rejects(consumeQualification(work, plan), /EEXIST/);
  assert.equal(readFileSync(join(work, 'live-once.json'), 'utf8'), first);
});

test('supplemental experiment and budget stay project anchored and separate from the old experiment', () => {
  const old = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.equal(supplementalWork, join(projectRoot, '.probe-work/t015-live'));
    assert.equal(supplementalBudgetPath, join(projectRoot, '.probe-work/t015-budget.json'));
    assert.notEqual(supplementalBudgetPath, liveBudgetPath);
  } finally { process.chdir(old); }
});
