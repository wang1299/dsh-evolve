import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareCodexTask, runCodex, applyCodexRepair, reserveCodexContinuation, type CodexOptions } from '../src/codex-runner.js';
import { acceptanceDigest } from '../src/verification.js';

async function setup(): Promise<{ root: string; prepared: Awaited<ReturnType<typeof prepareCodexTask>> }> {
  const root = await mkdtemp(join(tmpdir(), 'evolve-codex-test-'));
  await writeFile(join(root, 'module.py'), 'x = 1\n');
  return { root, prepared: await prepareCodexTask(root, 'Fix x', ['module.py']) };
}
const options = (mode: string): CodexOptions => ({ binary: process.execPath,
  launcherArgs: [fileURLToPath(new URL('./codex-process-fixture.js', import.meta.url)), mode], timeoutMs: 5000 });

test('Codex subprocess protocol accepts structured completion, retaining only bounded metadata', async () => {
  const { root, prepared } = await setup();
  const run = await runCodex(root, prepared, options('success'));
  assert.equal(run.status, 'completed', run.reason ?? '');
  assert.equal(run.transport, 'https');
  assert.deepEqual(run.usage, { inputTokens: 123, cachedInputTokens: 100, outputTokens: 45 });
  assert.equal(run.promptDigest, prepared.promptDigest);
  assert.ok(!JSON.stringify(run).includes('PRIVATE'));
  const invalid = await runCodex(root, prepared, options('bad-candidate'));
  assert.equal(invalid.reason, 'invalid_final_proposal');
  assert.deepEqual(invalid.validationIssues, [{ path: 'candidate.observedFacts', code: 'too_small' }]);
  assert.ok(!JSON.stringify(invalid).includes('PRIVATE'));
  assert.equal((await runCodex(root, prepared, options('no-final-newline'))).status, 'completed');
  assert.deepEqual(await applyCodexRepair(root, prepared, run.proposal), ['module.py']);
  assert.equal(await readFile(join(root, 'module.py'), 'utf8'), 'x = 2\n');
});

test('Codex failures, self-reported final output and missing completion cannot authorize a repair', async () => {
  const { root, prepared } = await setup();
  for (const [mode, reason] of [['nonzero', 'cli_exit_nonzero'], ['turn-failed', 'cli_turn_failed'],
    ['missing-completion', 'missing_turn_completion'], ['bad-final', 'invalid_final_proposal'], ['invalid-jsonl', 'invalid_jsonl'],
    ['trailing-garbage', 'invalid_jsonl'], ['trailing-unknown', 'unsupported_event']]) {
    const run = await runCodex(root, prepared, options(mode!));
    assert.equal(run.status, 'failed', mode); assert.equal(run.reason, reason, mode); assert.equal(run.proposal, null);
  }
  assert.equal(await readFile(join(root, 'module.py'), 'utf8'), 'x = 1\n');
});

test('Codex timeout, cancellation, output and tool budgets terminate the child process', async () => {
  const { root, prepared } = await setup();
  assert.equal((await runCodex(root, prepared, { ...options('hang'), timeoutMs: 150 })).reason, 'timeout');
  assert.equal((await runCodex(root, prepared, { ...options('hang'), signal: AbortSignal.timeout(150) })).reason, 'cancelled');
  assert.equal((await runCodex(root, prepared, { ...options('tool-limit'), maxToolCalls: 1 })).reason, 'tool_limit');
  assert.equal((await runCodex(root, prepared, { ...options('output-limit'), maxOutputBytes: 1024 })).reason, 'output_limit');
  assert.equal((await runCodex(root, prepared, options('line-limit'))).reason, 'line_limit');
  assert.equal((await runCodex(root, prepared, { binary: join(root, 'missing-executable') })).reason, 'launch_failed');
});

test('Remembered experience enters the prompt with an exact revision; diagnostics retain no endpoint text', async () => {
  const { root } = await setup();
  const experience = { id: 'experience', revision: 2, sourceTaskId: 'source', title: 'rollback', strategy: 'Restore before re-raising' };
  const prepared = await prepareCodexTask(root, 'Fix x', ['module.py'], experience);
  assert.ok(prepared.prompt.includes('Restore before re-raising'));
  experience.revision = 3;
  assert.equal(prepared.experience?.revision, 2);
  const run = await runCodex(root, prepared, options('network'));
  assert.equal(run.diagnostic, 'network'); assert.equal(run.status, 'failed');
  assert.ok(!JSON.stringify(run).includes('PRIVATE'));
});

test('Malformed or unknown item events cannot bypass a zero-tool budget', async () => {
  const { root, prepared } = await setup();
  for (const [mode, reason] of [['missing-item-id', 'invalid_item_event'], ['unknown-item', 'unsupported_item_event'], ['unknown-event', 'unsupported_event']]) {
    const run = await runCodex(root, prepared, { ...options(mode!), maxToolCalls: 0 });
    assert.equal(run.status, 'failed'); assert.equal(run.reason, reason); assert.equal(run.proposal, null);
  }
});

test('Paired runtime pins requested model/reasoning and provider retries; common prompt excludes injected experience', async () => {
  const { root } = await setup();
  const base = await prepareCodexTask(root, 'Fix x', ['module.py'], null, { candidate: 'none' });
  const augmented = await prepareCodexTask(root, 'Fix x', ['module.py'], { id: 'x', revision: 1, sourceTaskId: 'y', title: 'x', strategy: 'use 2' }, { candidate: 'none' });
  assert.equal(base.basePromptDigest, augmented.basePromptDigest); assert.equal(base.taskDigest, augmented.taskDigest);
  assert.notEqual(base.promptDigest, augmented.promptDigest);
  const run = await runCodex(root, base, { ...options('controls'), model: 'gpt-6.1-sol', reasoningEffort: 'low', providerRetries: 0, maxToolCalls: 0 });
  assert.equal(run.status, 'completed'); assert.equal(run.controls.model, 'gpt-6.1-sol'); assert.equal(run.controls.providerRetries, 0);
  assert.equal((await runCodex(root, base, { ...options('tool-limit'), maxToolCalls: 0 })).reason, 'tool_limit');
  await assert.rejects(runCodex(root, base, { ...options('success'), model: 'invalid\nmodel' }));
  await assert.rejects(runCodex(root, base, { transport: 'default', providerRetries: 0 }));
});

test('A parent exit with inherited descendant pipes cannot extend the deadline indefinitely', async () => {
  const { root, prepared } = await setup(); const start = Date.now();
  const run = await runCodex(root, prepared, { ...options('exit-with-open-pipe'), timeoutMs: 200 });
  assert.equal(run.reason, 'timeout');
  assert.ok(Date.now() - start < 1200, `deadline was extended to ${Date.now() - start}ms`);
});

test('Only one concurrent continuation can consume an evidence slot and failure does not reopen it', async () => {
  const { root } = await setup(); const hash = 'a'.repeat(64); const evidence = join(root, 'evidence.json');
  const results = await Promise.allSettled([reserveCodexContinuation(evidence, hash, 'report-a'), reserveCodexContinuation(evidence, hash, 'report-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const receipt = results.find((result) => result.status === 'fulfilled')!;
  if (receipt.status !== 'fulfilled') throw new Error('No receipt');
  const before = await readFile(receipt.value, 'utf8');
  await assert.rejects(reserveCodexContinuation(evidence, hash, 'report-c'), /EEXIST/);
  assert.equal(await readFile(receipt.value, 'utf8'), before);
});

test('Acceptance preflight fingerprints the whole Python file set including conftest', async () => {
  const { root } = await setup();
  const before = await acceptanceDigest(root);
  await writeFile(join(root, 'notes.txt'), 'not an acceptance input');
  assert.equal(await acceptanceDigest(root), before);
  await writeFile(join(root, 'conftest.py'), 'def pytest_collection_modifyitems(items):\n    items.clear()\n');
  assert.notEqual(await acceptanceDigest(root), before);
});

test('Context and source application reject oversized, unauthorized, symlink and stale inputs', async () => {
  const { root, prepared } = await setup();
  const run = await runCodex(root, prepared, options('success')); const proposal = run.proposal!;
  await assert.rejects(prepareCodexTask(root, 'Fix x', ['../module.py']));
  await assert.rejects(prepareCodexTask(root, 'Fix x', ['module.py'], { id: 'experience', revision: 1, sourceTaskId: 'source', title: 'x', strategy: 'x'.repeat(9000) }), /context limit/);
  await writeFile(join(root, 'large.py'), 'x'.repeat(40000));
  await assert.rejects(prepareCodexTask(root, 'Fix large', ['large.py']), /byte budget/);
  await assert.rejects(applyCodexRepair(root, prepared, { ...proposal, changes: [...proposal.changes, { ...proposal.changes[0], path: 'other.py' }] }), /Unapproved/);
  assert.equal(await readFile(join(root, 'module.py'), 'utf8'), 'x = 1\n');
  await writeFile(join(root, 'module.py'), 'x = 3\n');
  await assert.rejects(applyCodexRepair(root, prepared, proposal), /Source changed/);
  // Directory symlinks are covered where creation is supported without extra Windows privileges.
  if (process.platform !== 'win32') {
    await symlink(join(root, 'module.py'), join(root, 'alias.py'));
    await assert.rejects(prepareCodexTask(root, 'Fix x', ['alias.py']), /symlink/);
  }
});
