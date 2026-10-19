import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepseekBudget, budgetPolicy } from '../scripts/deepseek-budget.js';

test('single-sample ledger records the actual 3 yuan cap and cannot reopen a second call after settlement or restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'evolve-single-')), 'budget.json');
  const budget = new DeepseekBudget(path, 't015-snapshot-high-water-v1', 2, 3_000_000);
  const id = budget.reserve(); budget.settle(id, { input: 10, output: 1 });
  assert.equal(budget.state.budgetMicroCny, 3_000_000); assert.equal(budget.state.schemaVersion, 3);
  assert.throws(() => budget.reserve(), /exhausted/i); budget.close();
  const bytes = readFileSync(path);
  assert.throws(() => new DeepseekBudget(path), /policy|single|budget/i);
  assert.throws(() => new DeepseekBudget(path, 't015-snapshot-high-water-v1', 2, 5_000_000), /single|budget/i);
  const resumed = new DeepseekBudget(path, 't015-snapshot-high-water-v1', 2, 3_000_000);
  try { assert.equal(resumed.spent, 28); assert.throws(() => resumed.reserve(), /exhausted/i); }
  finally { resumed.close(); }
  assert.deepEqual(readFileSync(path), bytes);
});

test('single-sample cap must cover the full reservation and cannot reinterpret an old ledger', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'evolve-single-cap-')), 'budget.json');
  for (const cap of [0, budgetPolicy.reservationMicroCny - 1, 5_000_001, 3_000_000.1]) {
    assert.throws(() => new DeepseekBudget(path, 't015-snapshot-high-water-v1', 2, cap), /budget/i);
  }
  assert.throws(() => new DeepseekBudget(path, 't015-snapshot-high-water-v1', 1, 3_000_000), /receipt/i);
  const original = new DeepseekBudget(path); original.reserve(); original.close(); const bytes = readFileSync(path);
  assert.throws(() => new DeepseekBudget(path, 't011-conservative-v1', 2, 3_000_000), /single|budget/i);
  assert.deepEqual(readFileSync(path), bytes);
});
