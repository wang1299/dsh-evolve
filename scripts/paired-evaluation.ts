/** Small opt-in live comparison. Only this script's generated synthetic code is sent to Codex. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { applyCodexRepair, prepareCodexTask, repairProposalSchema, runCodex, type CodexOptions, type PreparedCodexTask } from '../src/codex-runner.js';
import { digest, hashSchema, idSchema, verificationSchema } from '../src/domain.js';
import { arms, evaluatePairedExperiment, experienceBankDigest, policyDigests, requireExperienceExposure, reservePairedRun, selectComparisonExperience,
  type PairedExperiment, type PairedRun } from '../src/paired-evaluation.js';
import { git, snapshot } from '../src/repository.js';
import { EvolveService } from '../src/service.js';
import { Store } from '../src/store.js';
import { acceptanceDigest, verifyRepair } from '../src/verification.js';

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const input = value('--source-evidence'); const expectedDigest = value('--source-digest');
if (!args.includes('--live') || !input || !expectedDigest) {
  process.stderr.write('Usage: npm run paired-evaluation -- --live --source-evidence <local-synthetic-smoke.json> --source-digest <sha256>\n'
    + 'Replays a trusted synthetic source, then runs 3 calls total, once per arm, 90s each, with no automatic retries.\n');
  process.exitCode = 1;
} else {
  hashSchema.parse(expectedDigest);
  const inputPath = await realpath(resolve(input)); const probeRoot = await realpath(resolve('.probe-work'));
  const rel = relative(probeRoot, inputPath);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Source evidence must be in this workspace .probe-work');
  if ((await stat(inputPath)).size > 1024 * 1024) throw new Error('Source evidence exceeds limit');
  const sourceBytes = await readFile(inputPath);
  if (digest(sourceBytes) !== expectedDigest) throw new Error('Source evidence digest differs');
  const parent = z.object({ schemaVersion: z.literal(1), kind: z.literal('live-codex-synthetic-smoke'),
    sourceTaskId: idSchema, sourceVerification: verificationSchema,
    experience: z.object({ id: idSchema, revision: z.number().int().positive(), status: z.literal('source_verified') }).strict(),
    modelRuns: z.array(z.object({ phase: z.string(), result: z.object({ status: z.string(), proposal: repairProposalSchema.nullable() }).passthrough() }).strict()).min(1).max(3),
  }).passthrough().parse(JSON.parse(sourceBytes.toString('utf8')));
  const original = parent.modelRuns[0]!;
  if (original.phase !== 'source' || original.result.status !== 'completed' || !original.result.proposal?.candidate
    || !parent.sourceVerification.verified || parent.sourceVerification.sourceTaskId !== parent.sourceTaskId
    || JSON.stringify(original.result.proposal.candidate.requiredFiles) !== JSON.stringify(['contract.py'])) throw new Error('Expected verified synthetic source with stable contract condition');
  const sourceCode = 'def apply_change(state, fail=False):\n    state["balance"] += 1\n    if fail:\n        raise ValueError("transaction failed")\n    return state["balance"]\n';
  const sourceAcceptance = 'import pytest\nfrom ledger import apply_change\ndef test_exception_rolls_back():\n    state = {"balance": 5}\n    with pytest.raises(ValueError):\n        apply_change(state, fail=True)\n    assert state["balance"] == 5\n';
  const home = await mkdtemp(join(tmpdir(), 'evolve-paired-')); const root = join(home, 'repository');
  const acceptanceA = join(home, 'acceptance-source'); const acceptanceB = join(home, 'acceptance-target');
  const output = await mkdtemp(join(probeRoot, 'paired-'));
  await mkdir(root); await mkdir(join(root, 'tests')); await mkdir(acceptanceA); await mkdir(acceptanceB);
  await writeFile(join(acceptanceA, 'test_acceptance.py'), sourceAcceptance);
  if (await acceptanceDigest(acceptanceA) !== parent.sourceVerification.acceptanceDigest) throw new Error('Source acceptance differs from original evidence');
  await writeFile(join(acceptanceB, 'test_acceptance.py'), 'import pytest\nfrom inventory import reserve\n'
    + '@pytest.mark.parametrize("available,amount", [(5, 2), (0, 3), (8, -2)])\n'
    + 'def test_rejected_reservation_rolls_back(available, amount):\n    state = {"available": available}\n'
    + '    with pytest.raises(ValueError):\n        reserve(state, amount, fail=True)\n    assert state["available"] == available\n'
    + 'def test_unrelated_state_survives():\n    state = {"available": 8, "label": "keep"}\n'
    + '    with pytest.raises(ValueError):\n        reserve(state, 2, fail=True)\n    assert state == {"available": 8, "label": "keep"}\n');
  await writeFile(join(root, 'requirements.txt'), '# standard-library-only synthetic experiment\n');
  await writeFile(join(root, 'contract.py'), 'TRANSACTION_POLICY = "rollback-on-exception"\n');
  await writeFile(join(root, 'ledger.py'), sourceCode);
  await writeFile(join(root, 'inventory.py'), 'def reserve(state, amount, fail=False):\n    state["available"] -= amount\n'
    + '    if fail:\n        raise ValueError("reservation rejected")\n    return state["available"]\n');
  await writeFile(join(root, 'tests', 'test_regression.py'), 'from ledger import apply_change\nfrom inventory import reserve\n'
    + 'def test_success():\n    assert apply_change({"balance": 5}) == 6\n'
    + '    state = {"available": 9, "label": "keep"}\n    assert reserve(state, 3) == 6\n    assert state == {"available": 6, "label": "keep"}\n');
  execFileSync('git', ['init', '-b', 'main', root], { windowsHide: true, stdio: 'ignore' });
  git(root, ['config', 'user.name', 'Synthetic Paired Experiment']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']); git(root, ['add', '.']); git(root, ['commit', '-m', 'synthetic source and target failures']);
  const store = new Store(join(output, 'data', 'evolve.sqlite'));
  const python = process.env.EVOLVE_PYTHON ?? 'python';
  const service = new EvolveService(store, root, { trusted: true, python, acceptanceDir: acceptanceA, regressionPath: 'tests', timeoutMs: 15000 });
  const details: Record<string, unknown> = { kind: 'paired-execution-details', preliminary: true, status: 'preparing', repository: root,
    sourceArtifactDigest: expectedDigest, modelCalls: 0, runs: {},
    executorDigest: digest(await readFile(new URL('../src/codex-runner.js', import.meta.url))),
    scenarioDigest: digest(await readFile(new URL('./paired-evaluation.js', import.meta.url))) };
  const atomicSave = async (path: string, body: unknown): Promise<void> => {
    await writeFile(path + '.next', JSON.stringify(body, null, 2)); await rename(path + '.next', path);
  };
  let experiment: PairedExperiment | null = null;
  const save = async (): Promise<void> => {
    await atomicSave(join(output, 'execution.json'), details);
    if (experiment) await atomicSave(join(output, 'experiment.json'), experiment);
  };
  try {
    await save();
    const sourceTask = service.begin('paired-source-replay', 'transaction rollback exception balance');
    service.correction(sourceTask.id, 'Replayed synthetic benchmark correction: failure must preserve the original balance. See source artifact digest; not private user feedback.');
    const preparedSource = await prepareCodexTask(root, 'Replay source repair', ['ledger.py']);
    await applyCodexRepair(root, preparedSource, original.result.proposal);
    git(root, ['add', '--', 'ledger.py']); git(root, ['commit', '-m', 'replay previous model source repair']);
    const proposed = service.propose(sourceTask.id, original.result.proposal.candidate);
    const verified = await service.verify(proposed.id); service.finish(sourceTask.id);
    details.sourceVerification = store.verification(verified.verificationId!);
    if (verified.status !== 'source_verified') throw new Error('source_replay_not_verified');
    const bankDigest = experienceBankDigest(store); const starting = snapshot(root);
    const environment = (): Record<string, string> => ({ node: process.version,
      python: execFileSync(python, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
      pytest: execFileSync(python, ['-m', 'pytest', '--version'], { encoding: 'utf8', windowsHide: true }).trim(),
      platform: process.platform, dependencyDigest: snapshot(root).scope.dependencyDigest });
    const cliVersion = (): string => execFileSync(process.env.EVOLVE_CODEX_BINARY ?? 'codex', ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    const version = cliVersion();
    if (version !== 'codex-cli 0.163.0-alpha.10.2') throw new Error('unexpected_cli_version');
    const controls = { model: 'gpt-6.1-sol', reasoningEffort: 'low' as const, providerRetries: 0 as const,
      timeoutMs: 90000, maxToolCalls: 0 as const, maxOutputBytes: 1024 * 1024 };
    const options: CodexOptions = { ...controls, transport: 'https' };
    const taskText = 'transaction rollback exception: fix reserve in inventory.py so a rejected reservation leaves available stock unchanged, while success subtracts amount. Preserve ValueError behavior and unrelated state keys.';
    const logicalTaskId = randomUUID(); const envDigest = digest(JSON.stringify(environment()));
    const acceptance = await acceptanceDigest(acceptanceB);
    const prepared = new Map<typeof arms[number], PreparedCodexTask>(); const plans: PairedExperiment['manifest']['plans'] = [];
    for (const arm of arms) {
      const task = service.begin('paired-' + arm, taskText);
      const selection = selectComparisonExperience(service, task.id, arm);
      const context = await prepareCodexTask(root, taskText, ['inventory.py'], selection.context, { candidate: 'none' });
      prepared.set(arm, context);
      plans.push({ runId: randomUUID(), taskId: logicalTaskId, replicate: 0, arm, promptDigest: context.promptDigest,
        experienceRefs: selection.context ? [{ id: selection.context.id, revision: selection.context.revision, sourceTaskId: selection.context.sourceTaskId }] : [],
        policyDigest: policyDigests[arm], selectionReasons: selection.reasons });
      service.finish(task.id);
    }
    const common = prepared.get('baseline')!;
    const task = { id: logicalTaskId, taskDigest: common.taskDigest, sourceDigest: digest(JSON.stringify(common.before)),
      baseCommit: starting.commit, basePromptDigest: common.basePromptDigest, acceptanceDigest: acceptance };
    experiment = { schemaVersion: 2, kind: 'codex-synthetic-paired', manifest: {
      id: randomUUID(), controls, cliVersion: version, temperature: null, samplingSeed: null, serverModelRevision: null, tokenHardLimit: null, costHardLimitUSD: null, inputByteLimit: 32768,
      limitations: ['One hand-written synthetic task, one replicate, fixed arm order: preliminary integration evidence only; no general benefit claim.',
        'Requested model name is pinned; server weights, temperature and sampling seed are unobserved and uncontrolled.',
        'Equal call/time/tool/input/output policies, not equal actual tokens or money; missing usage/cost stays unknown.',
        'Read-only Codex proposals with zero accepted tool events; host applies edits and runs external tests. Not a DSH model session or adversarial sandbox.',
        'Historical source is replayed and verified in a fresh repository; source verification does not demonstrate experience benefit.'],
      environmentDigest: envDigest, experienceBankDigest: bankDigest, repoId: starting.scope.repoId, accumulationTaskIds: [sourceTask.id], tasks: [task],
      bank: store.experiences().map((e) => ({ id: e.id, revision: e.revision, sourceTaskId: e.sourceTaskId,
        contextDigest: digest(JSON.stringify({ id: e.id, revision: e.revision, sourceTaskId: e.sourceTaskId, title: e.title, strategy: e.strategy })) })),
      source: { artifactDigest: expectedDigest, originalTaskId: parent.sourceTaskId, originalExperienceId: parent.experience.id, originalRevision: parent.experience.revision,
        replayTaskId: sourceTask.id, replayVerificationId: verified.verificationId! }, plans },
      runs: plans.map((p) => ({ runId: p.runId, status: 'not_started', callStarted: false, runtime: null, cliVersion: version, environmentDigest: envDigest,
        experienceBankDigest: bankDigest, task, promptDigest: p.promptDigest, experienceRefs: p.experienceRefs,
        verification: null, accepted: null, failure: null, sameErrorRecurred: null, wrongExperienceApplied: null, humanRework: null, extraCostUSD: null })) };
    evaluatePairedExperiment(experiment); await save();
    requireExperienceExposure(plans);
    details.status = 'running'; await save();
    for (const plan of plans) {
      const record: PairedRun = experiment.runs.find((r) => r.runId === plan.runId)!;
      try {
        git(root, ['switch', '-c', 'paired-' + plan.arm, starting.commit]);
        if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('dirty_start');
        if (cliVersion() !== version || digest(JSON.stringify(environment())) !== envDigest || experienceBankDigest(store) !== bankDigest
          || await acceptanceDigest(acceptanceB) !== acceptance) throw new Error('frozen_input_changed');
        const current = await prepareCodexTask(root, taskText, ['inventory.py'], prepared.get(plan.arm)!.experience, { candidate: 'none' });
        if (current.promptDigest !== plan.promptDigest || current.taskDigest !== task.taskDigest || current.basePromptDigest !== task.basePromptDigest) throw new Error('prepared_input_changed');
        await reservePairedRun(output, plan); record.status = 'running'; await save();
        process.stdout.write('Running one paired Codex call: ' + plan.arm + '\n');
        details.modelCalls = Number(details.modelCalls) + 1;
        record.callStarted = true; await save();
        const result = await runCodex(root, current, options);
        (details.runs as Record<string, unknown>)[plan.arm] = result;
        record.runtime = { status: result.status, reason: result.reason, transport: result.transport as 'https', controls: { ...controls, ...result.controls } as typeof controls,
          toolCalls: result.toolCalls, durationMs: result.durationMs, usage: result.usage };
        await atomicSave(join(output, 'execution.json'), details);
        if (result.status !== 'completed') throw new Error('codex_' + result.reason);
        if (result.toolCalls !== 0 || result.proposal?.candidate !== null) throw new Error('evaluation_protocol_violation');
        if (await acceptanceDigest(acceptanceB) !== acceptance || experienceBankDigest(store) !== bankDigest) throw new Error('frozen_input_changed');
        await applyCodexRepair(root, current, result.proposal);
        git(root, ['add', '--', 'inventory.py']); git(root, ['commit', '-m', 'synthetic model proposal: ' + plan.arm]);
        const verification = await verifyRepair(root, logicalTaskId, starting.commit, git(root, ['rev-parse', 'HEAD']), { ...service.policy, acceptanceDir: acceptanceB });
        if (verification.acceptanceDigest !== acceptance || digest(JSON.stringify(verification.environment)) !== envDigest) throw new Error('verification_input_changed');
        record.verification = verification; record.accepted = verification.verified; record.status = 'completed';
      } catch (error) {
        record.status = 'failed';
        // Persist codes, never arbitrary exception messages containing paths, endpoints or model content.
        const code = error instanceof Error ? error.message : '';
        record.failure = /^[a-z_]{1,100}$/.test(code) ? code : 'host_execution_failed';
      } finally {
        // Only our generated allowlisted target is restored if a host write failed before committing.
        git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'inventory.py']);
        evaluatePairedExperiment(experiment); await save();
      }
    }
    if (experienceBankDigest(store) !== bankDigest || await acceptanceDigest(acceptanceB) !== acceptance) throw new Error('final_frozen_input_changed');
    const report = evaluatePairedExperiment(experiment);
    await atomicSave(join(output, 'report.json'), report); details.status = 'completed';
    process.stdout.write('Paired outcomes: ' + experiment.runs.map((r, i) => plans[i]!.arm + '=' + (r.accepted ?? r.status)).join(', ') + '\n');
  } catch (error) {
    details.status = 'failed'; const code = error instanceof Error ? error.message : '';
    details.failure = /^[a-z_]{1,100}$/.test(code) ? code : 'host_preparation_failed'; process.exitCode = 1;
    process.stderr.write('Comparison setup or evidence validation failed; inspect local execution evidence.\n');
  } finally { await save(); store.close(); process.stdout.write('Local paired evidence: ' + output + '\n'); }
}
