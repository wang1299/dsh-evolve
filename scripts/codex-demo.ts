import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareCodexTask, runCodex, applyCodexRepair, type CodexRun, type ExperienceContext } from '../src/codex-runner.js';
import { git } from '../src/repository.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { verifyRepair, type VerificationPolicy } from '../src/verification.js';
import { digest } from '../src/domain.js';

if (!process.argv.includes('--live')) {
  process.stderr.write('Opt-in live model calls: npm run codex-demo -- --live\nOnly generated synthetic code is sent. Uses existing Codex login; up to 3 calls, 90s each.\n');
  process.exitCode = 1;
} else {
  const home = await mkdtemp(join(tmpdir(), 'evolve-codex-demo-'));
  const root = join(home, 'repository'); const acceptanceA = join(home, 'acceptance-a'); const acceptanceB = join(home, 'acceptance-b');
  const output = resolve('.probe-work', 'codex-demo-' + Date.now()); await mkdir(output, { recursive: true });
  await mkdir(root); await mkdir(join(root, 'tests')); await mkdir(acceptanceA); await mkdir(acceptanceB);
  execFileSync('git', ['init', '-b', 'main', root], { windowsHide: true, stdio: 'ignore' });
  git(root, ['config', 'user.name', 'Synthetic Codex Experiment']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(root, 'requirements.txt'), '# standard-library-only synthetic experiment\n');
  await writeFile(join(root, 'contract.py'), 'TRANSACTION_POLICY = "rollback-on-exception"\n');
  await writeFile(join(root, 'ledger.py'), 'def apply_change(state, fail=False):\n    state["balance"] += 1\n    if fail:\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
  await writeFile(join(root, 'fees.py'), 'def apply_fee(state, amount, fail=False):\n    state["balance"] -= amount\n    if fail:\n        raise ValueError("fee rejected")\n    return state["balance"]\n');
  await writeFile(join(root, 'tests', 'test_regression.py'), 'from ledger import apply_change\nfrom fees import apply_fee\ndef test_success():\n    assert apply_change({"balance": 5}) == 6\n    assert apply_fee({"balance": 5}, 2) == 3\n');
  await writeFile(join(acceptanceA, 'test_acceptance.py'), 'import pytest\nfrom ledger import apply_change\ndef test_exception_rolls_back():\n    state = {"balance": 5}\n    with pytest.raises(ValueError):\n        apply_change(state, fail=True)\n    assert state["balance"] == 5\n');
  await writeFile(join(acceptanceB, 'test_acceptance.py'), 'import pytest\nfrom fees import apply_fee\n@pytest.mark.parametrize("balance,amount", [(5, 2), (0, 3), (8, -2)])\ndef test_fee_exception_rolls_back(balance, amount):\n    state = {"balance": balance}\n    with pytest.raises(ValueError):\n        apply_fee(state, amount, fail=True)\n    assert state["balance"] == balance\n');
  git(root, ['add', '.']); git(root, ['commit', '-m', 'synthetic rollback bugs']);
  const store = new Store(join(output, 'data', 'evolve.sqlite'));
  const policy: VerificationPolicy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: acceptanceA, regressionPath: 'tests', timeoutMs: 15000 };
  const service = new EvolveService(store, root, policy);
  await writeFile(join(output, 'config.json'), JSON.stringify({ repoRoot: root, dataDir: join(output, 'data'), executionTrusted: true,
    shareWithModel: false, acceptanceDir: acceptanceA, python: policy.python, regressionPath: 'tests', timeoutMs: 15000 }, null, 2));
  const runs: { phase: string; result: CodexRun }[] = [];
  const comparisons: { arm: string; taskId: string; baseCommit: string; fixCommit: string; accepted: boolean; verification: unknown }[] = [];
  const evidence: Record<string, unknown> = { schemaVersion: 1, kind: 'live-codex-synthetic-smoke', preliminary: true,
    status: 'running', runtime: 'codex-cli', requestedModel: 'CLI default with user config ignored', actualModel: null,
    executorDigest: digest(await readFile(new URL('../src/codex-runner.js', import.meta.url))),
    scenarioDigest: digest(await readFile(new URL('./codex-demo.js', import.meta.url))),
    runtimeVersion: null, modelRuns: runs, comparisons, costUSD: null,
    limits: { maxModelCalls: 3, timeoutMsPerCall: 90000, tokenHardLimit: null },
    limitations: ['Synthetic tasks, one pair and two arms only; no general benefit claim.',
      'Default underlying model and temperature not frozen; not an evaluateExperiment input.',
      'Codex read-only proposals plus host-applied allowlisted edits; not a DSH model session or full application installation.'] };
  const save = async (): Promise<void> => { await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); };
  const call = async (phase: string, task: string, files: string[], experience: ExperienceContext | null = null): Promise<Awaited<ReturnType<typeof prepareCodexTask>>> => {
    if (runs.length >= 3) throw new Error('model_call_limit');
    const prepared = await prepareCodexTask(root, task, files, experience);
    process.stdout.write(`Running Codex phase: ${phase}\n`);
    const result = await runCodex(root, prepared); runs.push({ phase, result }); await save();
    if (result.status !== 'completed') throw new Error('codex_' + result.reason);
    await applyCodexRepair(root, prepared, result.proposal);
    git(root, ['add', '--', ...files]); git(root, ['commit', '-m', 'synthetic model proposal: ' + phase]);
    return prepared;
  };
  try {
    evidence.runtimeVersion = execFileSync(process.env.EVOLVE_CODEX_BINARY ?? 'codex', ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    const source = service.begin('codex-source', 'transaction rollback exception balance');
    service.correction(source.id, 'Benchmark-provided correction: a failed transaction must leave balance unchanged. This is a scripted benchmark instruction, not observed private user feedback.');
    evidence.sourceTaskId = source.id;
    await call('source', 'Fix apply_change in ledger.py: raising ValueError currently leaves state["balance"] modified. Preserve success behavior and restore prior balance on failure. '
      + 'A stable source condition is contract.py with TRANSACTION_POLICY="rollback-on-exception". Use contract.py as requiredFiles for the experience candidate. '
      + 'The bug and this correction are provided by the synthetic benchmark. Do not fix fees.py yet.', ['ledger.py']);
    const candidate = runs[0]!.result.proposal?.candidate;
    if (!candidate) throw new Error('missing_candidate');
    const proposed = service.propose(source.id, candidate);
    const verified = await service.verify(proposed.id);
    evidence.sourceVerification = store.verification(verified.verificationId!);
    evidence.experience = { id: verified.id, revision: verified.revision, status: verified.status };
    await save();
    if (verified.status !== 'source_verified') throw new Error('source_repair_not_verified');
    service.finish(source.id);
    const startingCommit = git(root, ['rev-parse', 'HEAD']);
    const taskText = 'transaction rollback exception balance: fix apply_fee in fees.py so a rejected fee leaves the balance unchanged, while successful fees still subtract amount. Preserve ValueError behavior.';
    for (const arm of ['baseline', 'evolve']) {
      git(root, ['switch', '-c', 'codex-' + arm, startingCommit]);
      const task = service.begin('codex-' + arm, taskText);
      const selection = arm === 'evolve' ? service.select(task.id, 'feedback-v1') : { experience: null, application: null };
      if (arm === 'evolve' && !selection.experience) throw new Error('no_applicable_experience');
      const exp = selection.experience;
      const context: ExperienceContext | null = exp ? { id: exp.id, revision: exp.revision, sourceTaskId: exp.sourceTaskId, title: exp.title, strategy: exp.strategy } : null;
      const acceptanceBefore = await readFile(join(acceptanceB, 'test_acceptance.py'), 'utf8');
      await call(arm, taskText, ['fees.py'], context);
      const fixCommit = git(root, ['rev-parse', 'HEAD']);
      if (await readFile(join(acceptanceB, 'test_acceptance.py'), 'utf8') !== acceptanceBefore) throw new Error('acceptance_changed');
      const verification = await verifyRepair(root, task.id, startingCommit, fixCommit, { ...policy, acceptanceDir: acceptanceB });
      comparisons.push({ arm, taskId: task.id, baseCommit: startingCommit, fixCommit, accepted: verification.verified, verification });
      if (selection.application) service.feedback({ id: randomUUID(), applicationId: selection.application.id,
        outcome: verification.verified ? 'accepted' : 'unknown', note: 'Independent synthetic task acceptance; no causal attribution to the offered experience.', extraCost: null, humanRework: null });
      service.finish(task.id); await save();
    }
    evidence.status = 'completed';
    evidence.conclusion = 'Observe paired acceptance and usage; one synthetic pair cannot establish experience benefit.';
    process.stdout.write(`Live Codex smoke finished. Outcomes: ${comparisons.map((run) => run.arm + '=' + run.accepted).join(', ')}\n`);
  } catch (error) {
    evidence.status = 'failed'; evidence.failure = error instanceof Error ? error.message : 'unknown_failure'; process.exitCode = 1;
    process.stderr.write('Live Codex smoke did not complete; inspect local evidence for the failed phase.\n');
  } finally { await save(); store.close(); process.stdout.write(`Local evidence: ${output}\n`); }
}
