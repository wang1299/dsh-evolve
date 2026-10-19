import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryEvidence, liveBudgetPath, projectRoot, validateRepair } from '../scripts/dsh-live.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('synthetic repair proposals cannot add host IO, imports, decorators or dynamic execution', () => {
  assert.doesNotThrow(() => validateRepair('def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("failed")\n    return state["balance"]\n', 'apply_change'));
  for (const code of ['import os\ndef apply_change(state): return state',
    'def apply_change(state): return open("secret").read()',
    '@print("executed")\ndef apply_change(state): return state',
    'def apply_change(state=print("executed")): return state',
    'def apply_change(state): return state.__class__',
    'def apply_change(state): return eval("1")']) assert.throws(() => validateRepair(code, 'apply_change'));
});

test('one project budget survives invocation-directory changes and DB selection alone does not prove delivery', () => {
  const initial = process.cwd();
  try { process.chdir(mkdtempSync(join(tmpdir(), 'evolve-other-cwd-'))); assert.equal(liveBudgetPath, join(projectRoot, '.probe-work/t011-budget.json')); }
  finally { process.chdir(initial); }
  const app = { id: 'app', taskId: 'task', experienceId: 'experience', revision: 3 };
  const wrap = (type: string, message: object) => ({ sessionId: 'transfer', event: { type, data: { message } } });
  const call = wrap('assistant/message', { content: [{ type: 'tool-call', id: 'call', name: 'evolve_begin_task' }] });
  const result = wrap('tool/result', { toolCallId: 'call', content: [{ type: 'text', text: JSON.stringify({ taskId: 'task', application: app, experience: { id: 'experience', revision: 3 } }) }] });
  const continuation = wrap('assistant/message', { content: [{ type: 'text', text: 'A proposal follows.' }] });
  assert.deepEqual(deliveryEvidence([], 'transfer', app), { returned: false, continued: false });
  assert.deepEqual(deliveryEvidence([call, result], 'transfer', app), { returned: true, continued: false });
  assert.deepEqual(deliveryEvidence([call, result, continuation], 'transfer', app), { returned: true, continued: true });
  assert.deepEqual(deliveryEvidence([call, result, continuation], 'other-session', app), { returned: false, continued: false });
  assert.deepEqual(deliveryEvidence([call, result, continuation], 'transfer', { ...app, revision: 4 }), { returned: false, continued: false });
});
