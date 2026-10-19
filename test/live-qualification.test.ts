import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { consumeQualification, freezeFiles, validateQualification } from '../scripts/live-qualification.js';
import { supplementalBudgetPath, supplementalWork } from '../scripts/dsh-live-t015.js';
import { liveBudgetPath, projectRoot } from '../scripts/dsh-live.js';

test('new live qualification rejects plan/config/install drift before consumption and cannot repeat', () => {
  const work = mkdtempSync(join(tmpdir(), 'evolve-qualification-')); const file = join(work, 'synthetic-config.json');
  writeFileSync(file, '{"synthetic":true}'); const plan = { frozenFiles: freezeFiles([file]) };
  writeFileSync(join(work, 'plan-digest.txt'), digest(JSON.stringify(plan)));
  assert.doesNotThrow(() => validateQualification(work, plan));
  writeFileSync(file, '{}'); assert.throws(() => consumeQualification(work, plan), /drift/);
  writeFileSync(file, '{"synthetic":true}');
  const changed = { ...plan, changed: true };
  assert.throws(() => consumeQualification(work, changed), /drift/);
  consumeQualification(work, plan); const first = readFileSync(join(work, 'live-once.json'), 'utf8');
  assert.throws(() => consumeQualification(work, plan), /EEXIST/);
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
