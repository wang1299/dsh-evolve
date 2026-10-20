import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rehearseAutomatic } from '../scripts/automatic-rehearsal.js';

test('official normal AgentLoop learns and reuses an uncommitted repair with zero evolve tool calls', { timeout: 180000 }, async () => {
  const report = await rehearseAutomatic(); assert.equal(report.passed, true); assert.equal(report.modelHttpRequests, 0);
  assert.equal(report.evolveToolCalls, 0); assert.equal(report.extractionCalls, 1); assert.equal(report.targetReceivedContext, true);
});
