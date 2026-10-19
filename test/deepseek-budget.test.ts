import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepseekBudget } from '../scripts/deepseek-budget.js';

test('request reservation survives restart and unknown calls cannot reopen paid budget', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'evolve-budget-')), 'budget.json');
  const first = new DeepseekBudget(path);
  first.reserve(); first.close();
  const resumed = new DeepseekBudget(path);
  try {
    assert.equal(resumed.state.calls.length, 1);
    assert.equal(resumed.state.calls[0]!.chargedMicroCny, 2232768);
    resumed.reserve();
    assert.throws(() => resumed.reserve(), /budget/i);
    assert.equal(resumed.state.calls.length, 2);
  } finally { resumed.close(); }
});
