import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRepair } from '../scripts/dsh-live.js';

test('synthetic repair proposals cannot add host IO, imports, decorators or dynamic execution', () => {
  assert.doesNotThrow(() => validateRepair('def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("failed")\n    return state["balance"]\n', 'apply_change'));
  for (const code of ['import os\ndef apply_change(state): return state',
    'def apply_change(state): return open("secret").read()',
    '@print("executed")\ndef apply_change(state): return state',
    'def apply_change(state=print("executed")): return state',
    'def apply_change(state): return state.__class__',
    'def apply_change(state): return eval("1")']) assert.throws(() => validateRepair(code, 'apply_change'));
});
