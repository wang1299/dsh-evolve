/** Opt-in live experiment. Sends only authored synthetic source; raw evidence stays local. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { applyCodexRepair, prepareCodexTask, repairProposalSchema, runCodex, type PreparedCodexTask } from '../src/codex-runner.js';
import { digest, idSchema, relativePath, verificationSchema } from '../src/domain.js';
import { evaluateFeedbackExperiment, feedbackControls, feedbackProtocolDigest, observedFeedbackRecurrence, reserveFeedbackProtocol, type FeedbackExperiment } from '../src/feedback-experiment.js';
import { evaluateFeedbackStructure, experienceBankDigest, feedbackPolicyDigests, reservePairedRun, selectComparisonExperience, type Arm, type PairedExperiment, type PairedPlan, type PairedRun } from '../src/paired-evaluation.js';
import { git, snapshot } from '../src/repository.js';
import { EvolveService } from '../src/service.js';
import { Store } from '../src/store.js';
import { acceptanceDigest, verifyRepair } from '../src/verification.js';

const caseSchema = z.object({ id: z.string().regex(/^[a-z]+$/), file: relativePath, query: z.string().min(1).max(4000),
  code: z.string(), acceptance: z.string(), regression: z.string(), order: z.array(z.enum(['baseline', 'retrieval', 'evolve'])).optional() }).strict();
const protocolSchema = z.object({ id: z.literal('feedback-transfer-v1'), maxCalls: z.literal(7), model: z.literal('gpt-6.1-sol'),
  reasoningEffort: z.literal('low'), timeoutMs: z.literal(90000), cliVersion: z.literal('codex-cli 0.163.0-alpha.10.2'),
  sourceDigest: z.literal('36ef1b7891d3f2d976f1fc28c3d690448885cb87f6fdeaa663b547fb50961bee'),
  accumulation: caseSchema, targets: z.array(caseSchema).length(2) }).strict();
const args = process.argv.slice(2); const input = args[args.indexOf('--source-evidence') + 1];
const live = args.includes('--live'); const prepareOnly = args.includes('--prepare-only');
const fixture = args.includes('--process-fixture');
if (Number(live) + Number(prepareOnly) + Number(fixture) !== 1 || !args.includes('--source-evidence') || !input) {
  process.stderr.write('Usage: npm run feedback-evaluation -- --prepare-only|--process-fixture|--live --source-evidence <local synthetic source report>\nOnly live calls a model and consumes one nonrenewable seven-call protocol slot.\n');
  process.exitCode = 1;
} else {
  const bytes = await readFile(new URL('../../test/fixtures/feedback-protocol.json', import.meta.url));
  if (digest(bytes) !== feedbackProtocolDigest) throw new Error('Frozen protocol changed');
  const protocol = protocolSchema.parse(JSON.parse(bytes.toString('utf8')));
  const probe = await realpath(resolve('.probe-work')); const sourcePath = await realpath(resolve(input)); const rel = relative(probe, sourcePath);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || (await stat(sourcePath)).size > 1048576) throw new Error('Source must be a bounded local probe artifact');
  const sourceBytes = await readFile(sourcePath); if (digest(sourceBytes) !== protocol.sourceDigest) throw new Error('Source digest differs');
  const parent = z.object({ schemaVersion: z.literal(1), kind: z.literal('live-codex-synthetic-smoke'), sourceTaskId: idSchema,
    sourceVerification: verificationSchema, experience: z.object({ id: idSchema, revision: z.number().int().positive() }).passthrough(),
    modelRuns: z.array(z.object({ phase: z.string(), result: z.object({ status: z.string(), proposal: repairProposalSchema.nullable() }).passthrough() }).passthrough()).min(1),
  }).passthrough().parse(JSON.parse(sourceBytes.toString('utf8')));
  const original = parent.modelRuns[0]!;
  if (original.phase !== 'source' || original.result.status !== 'completed' || !original.result.proposal?.candidate
    || !parent.sourceVerification.verified || parent.sourceVerification.sourceTaskId !== parent.sourceTaskId
    || JSON.stringify(original.result.proposal.candidate.requiredFiles) !== JSON.stringify(['contract.py'])) throw new Error('Invalid synthetic source');
  const output = await mkdtemp(join(probe, 'feedback-run-')); const home = await mkdtemp(join(tmpdir(), 'evolve-feedback-'));
  const root = join(home, 'repository'); await mkdir(root); await mkdir(join(root, 'tests'));
  const acceptance = new Map<string, string>();
  for (const c of [protocol.accumulation, ...protocol.targets]) {
    await writeFile(join(root, c.file), c.code); await writeFile(join(root, 'tests', 'test_' + c.id + '.py'), c.regression);
    const dir = join(home, 'acceptance-' + c.id); await mkdir(dir); await writeFile(join(dir, 'test_acceptance.py'), c.acceptance); acceptance.set(c.id, dir);
  }
  const sourceAcceptance = join(home, 'acceptance-source'); await mkdir(sourceAcceptance);
  for (const f of parent.sourceVerification.acceptanceFiles) { await mkdir(dirname(join(sourceAcceptance, f.path)), { recursive: true }); await writeFile(join(sourceAcceptance, f.path), f.content); }
  await writeFile(join(root, 'ledger.py'), 'def apply_change(state, fail=False):\n    state["balance"] += 1\n    if fail:\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
  await writeFile(join(root, 'contract.py'), 'TRANSACTION_POLICY = "rollback-on-exception"\n');
  await writeFile(join(root, 'requirements.txt'), '# synthetic standard-library-only feedback experiment\n');
  await writeFile(join(root, 'tests', 'test_source.py'), 'from ledger import apply_change\ndef test_success():\n    assert apply_change({"balance": 5}) == 6\n');
  execFileSync('git', ['init', '-b', 'main', root], { windowsHide: true, stdio: 'ignore' });
  git(root, ['config', 'user.name', 'Synthetic Feedback Experiment']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']); git(root, ['add', '.']); git(root, ['commit', '-m', 'frozen synthetic feedback tasks']);
  const store = new Store(join(output, 'evolve.sqlite')); const python = process.env.EVOLVE_PYTHON ?? 'python';
  const service = new EvolveService(store, root, { trusted: true, python, acceptanceDir: sourceAcceptance, regressionPath: 'tests', timeoutMs: 15000 });
  const cliVersion = (): string => fixture ? protocol.cliVersion : execFileSync(process.env.EVOLVE_CODEX_BINARY ?? 'codex', ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
  const environment = (): object => ({ node: process.version, python: execFileSync(python, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
    pytest: execFileSync(python, ['-m', 'pytest', '--version'], { encoding: 'utf8', windowsHide: true }).trim(), platform: process.platform, dependencyDigest: snapshot(root).scope.dependencyDigest });
  let experiment: FeedbackExperiment | null = null;
  const details: Record<string, unknown> = { kind: 'feedback-execution-details', status: 'preparing', mode: live ? 'live' : fixture ? 'process-fixture' : 'prepare-only', invocations: 0, modelCalls: 0,
    protocolDigest: feedbackProtocolDigest, scriptDigest: digest(await readFile(new URL('./feedback-evaluation.js', import.meta.url))),
    executorDigest: digest(await readFile(new URL('../src/codex-runner.js', import.meta.url))), repository: root, runs: {} };
  const atomic = async (name: string, value: unknown): Promise<void> => { await writeFile(join(output, name + '.next'), JSON.stringify(value, null, 2)); await rename(join(output, name + '.next'), join(output, name)); };
  const save = async (): Promise<void> => { await atomic('execution.json', details); if (experiment) { await atomic('experiment.json', experiment); await atomic('report.json', evaluateFeedbackExperiment(experiment)); } };
  try {
    await save(); if (cliVersion() !== protocol.cliVersion) throw new Error('unexpected_cli_version');
    if (await acceptanceDigest(sourceAcceptance) !== parent.sourceVerification.acceptanceDigest) throw new Error('source_acceptance_changed');
    const sourceTask = service.begin('source-replay', 'transaction rollback exception');
    const sourceInput = await prepareCodexTask(root, 'Replay previously observed source repair', ['ledger.py']);
    await applyCodexRepair(root, sourceInput, original.result.proposal); git(root, ['add', '--', 'ledger.py']); git(root, ['commit', '-m', 'replay historical model source repair']);
    const candidate = service.propose(sourceTask.id, original.result.proposal.candidate); const verified = await service.verify(candidate.id); service.finish(sourceTask.id);
    if (verified.status !== 'source_verified') throw new Error('source_not_verified');
    const sourceExperience = store.experience(verified.id)!; const sourceVerification = store.verification(verified.verificationId!)!;
    const envDigest = digest(JSON.stringify(environment())); const caseA = protocol.accumulation; const taskA = service.begin('accumulation', caseA.query);
    const selected = service.select(taskA.id); if (!selected.application || selected.experience?.id !== verified.id) throw new Error('accumulation_experience_missing');
    const context = { id: verified.id, revision: verified.revision, sourceTaskId: verified.sourceTaskId, title: verified.title, strategy: verified.strategy };
    const preparedA = await prepareCodexTask(root, caseA.query, [caseA.file], context, { candidate: 'none' });
    const makeTask = async (id: string, c: z.infer<typeof caseSchema>, prepared: PreparedCodexTask) => ({ id, taskDigest: prepared.taskDigest,
      sourceDigest: digest(JSON.stringify(prepared.before)), baseCommit: snapshot(root).commit, basePromptDigest: prepared.basePromptDigest, acceptanceDigest: await acceptanceDigest(acceptance.get(c.id)!) });
    const makeRun = (plan: PairedPlan, task: PairedRun['task'], bank: string): PairedRun => ({ runId: plan.runId, status: 'not_started', callStarted: false,
      runtime: null, cliVersion: protocol.cliVersion, environmentDigest: envDigest, experienceBankDigest: bank, task, promptDigest: plan.promptDigest,
      experienceRefs: plan.experienceRefs, verification: null, accepted: null, failure: null, sameErrorRecurred: null, wrongExperienceApplied: null, humanRework: null, extraCostUSD: null });
    const planA: PairedPlan = { runId: randomUUID(), taskId: taskA.id, replicate: 0, arm: 'evolve', promptDigest: preparedA.promptDigest,
      experienceRefs: [{ id: context.id, revision: context.revision, sourceTaskId: context.sourceTaskId }], policyDigest: feedbackPolicyDigests.evolve, selectionReasons: selected.reasons };
    experiment = { schemaVersion: 3, kind: 'codex-feedback-paired', protocolDigest: feedbackProtocolDigest, executionSource: live ? 'agent' : fixture ? 'process-fixture' : 'prepare-only',
      budget: { maxCalls: 7, accumulationCalls: 1, evaluationCalls: 6 }, status: 'accumulation', failure: null, cliVersion: protocol.cliVersion,
      controls: { ...feedbackControls }, repoId: snapshot(root).scope.repoId, environmentDigest: envDigest,
      source: { artifactDigest: protocol.sourceDigest, original: { taskId: parent.sourceTaskId, experienceId: parent.experience.id, revision: parent.experience.revision }, experience: sourceExperience, verification: sourceVerification },
      accumulation: { plan: planA, run: makeRun(planA, await makeTask(taskA.id, caseA, preparedA), experienceBankDigest(store)), taskRecord: store.task(taskA.id)!, application: selected.application, feedback: null }, evaluation: null };
    await save(); if (prepareOnly) { details.status = 'prepared'; process.stdout.write('Prepared and verified synthetic source; model calls=0\n'); }
    else {
      await reserveFeedbackProtocol(live ? probe : output, output);
      const execute = async (plan: PairedPlan, run: PairedRun, c: z.infer<typeof caseSchema>, prepared: PreparedCodexTask): Promise<void> => {
        try {
          git(root, ['switch', '-c', 'run-' + plan.runId, run.task.baseCommit]);
          if (git(root, ['status', '--porcelain', '--untracked-files=no']) || cliVersion() !== protocol.cliVersion
            || digest(JSON.stringify(environment())) !== envDigest || experienceBankDigest(store) !== run.experienceBankDigest
            || await acceptanceDigest(acceptance.get(c.id)!) !== run.task.acceptanceDigest) throw new Error('frozen_input_changed');
          const current = await prepareCodexTask(root, c.query, [c.file], prepared.experience, { candidate: 'none' });
          if (current.promptDigest !== plan.promptDigest || current.taskDigest !== run.task.taskDigest) throw new Error('prepared_input_changed');
          await reservePairedRun(output, plan); run.status = 'running'; await save();
          if (Number(details.invocations) >= protocol.maxCalls) throw new Error('call_budget_exceeded');
          run.callStarted = true; details.invocations = Number(details.invocations) + 1; if (live) details.modelCalls = Number(details.modelCalls) + 1; await save();
          process.stdout.write('Starting bounded ' + (fixture ? 'process fixture' : 'Codex') + ' attempt ' + details.invocations + '/7: ' + c.id + '/' + plan.arm + '\n');
          const result = await runCodex(root, current, { ...feedbackControls, transport: 'https',
            ...(fixture ? { binary: process.execPath, launcherArgs: [fileURLToPath(new URL('../test/feedback-process-fixture.js', import.meta.url))] } : {}) });
          (details.runs as Record<string, unknown>)[plan.runId] = result;
          run.runtime = { status: result.status, reason: result.reason, controls: { ...feedbackControls, ...result.controls } as typeof feedbackControls,
            transport: 'https', toolCalls: result.toolCalls, durationMs: result.durationMs, usage: result.usage }; await atomic('execution.json', details);
          if (result.status !== 'completed') throw new Error('codex_' + result.reason);
          if (result.toolCalls !== 0 || !result.proposal || result.proposal.candidate !== null) throw new Error('evaluation_protocol_violation');
          if (await acceptanceDigest(acceptance.get(c.id)!) !== run.task.acceptanceDigest || experienceBankDigest(store) !== run.experienceBankDigest) throw new Error('frozen_input_changed');
          await applyCodexRepair(root, current, result.proposal); git(root, ['add', '--', c.file]); git(root, ['commit', '-m', 'synthetic model proposal ' + c.id + ' ' + plan.arm]);
          const proof = await verifyRepair(root, run.task.id, run.task.baseCommit, snapshot(root).commit, { ...service.policy, acceptanceDir: acceptance.get(c.id)!, regressionPath: 'tests/test_' + c.id + '.py' });
          if (proof.acceptanceDigest !== run.task.acceptanceDigest || digest(JSON.stringify(proof.environment)) !== envDigest) throw new Error('verification_input_changed');
          run.verification = proof; run.accepted = proof.verified; run.status = 'completed';
          run.sameErrorRecurred = observedFeedbackRecurrence(proof.base, proof.fixed);
        } catch (error) { run.status = 'failed'; const code = error instanceof Error ? error.message : ''; run.failure = /^[a-z_]{1,100}$/.test(code) ? code : 'host_execution_failed'; }
        finally { git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', c.file]); await save(); }
      };
      await execute(planA, experiment.accumulation.run, caseA, preparedA); service.finish(taskA.id); experiment.accumulation.taskRecord = store.task(taskA.id)!;
      if (experiment.accumulation.run.accepted !== true) throw new Error('accumulation_not_accepted');
      const proofA = experiment.accumulation.run.verification!; store.putVerification(proofA);
      experiment.accumulation.feedback = service.feedback({ id: randomUUID(), applicationId: selected.application.id, outcome: 'accepted',
        note: 'Synthetic benchmark independent pytest verification=' + proofA.id + '; not a user utterance or causal benefit claim.', extraCost: null, humanRework: null });
      const bank = experienceBankDigest(store); const starting = snapshot(root); const tasks: PairedExperiment['manifest']['tasks'] = [];
      const plans: PairedPlan[] = []; const prepared = new Map<string, { context: PreparedCodexTask; c: z.infer<typeof caseSchema> }>();
      for (const c of protocol.targets) {
        const logicalId = randomUUID(); let task: PairedRun['task'] | null = null;
        for (const arm of c.order as Arm[]) {
          const selectTask = service.begin(c.id + '-' + arm, c.query);
          const selection = arm === 'evolve' ? (() => { const s = service.select(selectTask.id); return { context: s.experience ? context : null, reasons: s.reasons }; })()
            : selectComparisonExperience(service, selectTask.id, arm);
          if ((arm === 'evolve' && (!selection.context || !selection.reasons.join(' ').includes('fallback_owner_accepted_inference')))
            || (arm !== 'evolve' && selection.context)) throw new Error('preflight_no_feedback_contrast');
          const input = await prepareCodexTask(root, c.query, [c.file], selection.context, { candidate: 'none' });
          task ??= await makeTask(logicalId, c, input);
          if (task.basePromptDigest !== input.basePromptDigest || task.taskDigest !== input.taskDigest) throw new Error('common_task_changed');
          const plan: PairedPlan = { runId: randomUUID(), taskId: logicalId, replicate: 0, arm, promptDigest: input.promptDigest,
            experienceRefs: selection.context ? [{ id: context.id, revision: context.revision, sourceTaskId: context.sourceTaskId }] : [], policyDigest: feedbackPolicyDigests[arm], selectionReasons: selection.reasons };
          plans.push(plan); prepared.set(plan.runId, { context: input, c }); service.finish(selectTask.id);
        }
        tasks.push(task!);
      }
      const evaluation: PairedExperiment = { schemaVersion: 2, kind: 'codex-synthetic-paired', manifest: { id: randomUUID(), controls: { ...feedbackControls }, cliVersion: protocol.cliVersion,
        temperature: null, samplingSeed: null, serverModelRevision: null, tokenHardLimit: null, costHardLimitUSD: null, inputByteLimit: 32768,
        limitations: ['Two authored synthetic transfer tasks, one replicate, opposing group order; not a blind or real-world benchmark.',
          'Requested model and CLI controls fixed, server weights/temperature/seed/token or money hard cap unobserved.',
          'Owner-style benchmark feedback is linked to independent pytest, not fabricated user speech. No evaluation feedback is learned.',
          'Zero accepted tool events, host applies proposals; not a DSH model loop or adversarial sandbox.'],
        environmentDigest: envDigest, experienceBankDigest: bank, repoId: starting.scope.repoId, accumulationTaskIds: [sourceTask.id, taskA.id], tasks,
        bank: [{ id: context.id, revision: context.revision, sourceTaskId: context.sourceTaskId, contextDigest: digest(JSON.stringify(context)) }],
        source: { artifactDigest: protocol.sourceDigest, originalTaskId: parent.sourceTaskId, originalExperienceId: parent.experience.id, originalRevision: parent.experience.revision,
          replayTaskId: sourceTask.id, replayVerificationId: sourceVerification.id }, plans },
        runs: plans.map((p) => makeRun(p, tasks.find((t) => t.id === p.taskId)!, bank)) };
      evaluateFeedbackStructure(evaluation); experiment.evaluation = evaluation; experiment.status = 'evaluation'; await save();
      for (const plan of plans) { const p = prepared.get(plan.runId)!; await execute(plan, evaluation.runs.find((r) => r.runId === plan.runId)!, p.c, p.context); }
      if (experienceBankDigest(store) !== bank) throw new Error('final_bank_changed');
      experiment.status = 'completed'; details.status = 'completed';
      process.stdout.write('Feedback paired outcomes: ' + evaluation.runs.map((r, i) => plans[i]!.arm + '=' + (r.accepted ?? r.status)).join(', ') + '\n');
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''; const failure = /^[a-z_]{1,100}$/.test(code) ? code : 'host_preparation_failed';
    details.status = 'failed'; details.failure = failure; if (experiment) { experiment.status = 'failed'; experiment.failure = failure; }
    process.exitCode = 1; process.stderr.write('Feedback experiment stopped; inspect bounded local evidence.\n');
  } finally { await save(); store.close(); process.stdout.write('Local feedback evidence: ' + output + '\n'); }
}
