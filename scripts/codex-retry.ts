/** Explicit, single-phase continuation of our generated synthetic smoke, not a general session resumer. */
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prepareCodexTask, runCodex, applyCodexRepair, reserveCodexContinuation, type ExperienceContext } from '../src/codex-runner.js';
import { digest, hashSchema, idSchema, shaSchema, verificationSchema } from '../src/domain.js';
import { git, snapshot } from '../src/repository.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { verifyRepair, acceptanceDigest } from '../src/verification.js';

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const inputPath = value('--evidence'); const requestedRoot = value('--repo');
if (!args.includes('--live') || !inputPath || !requestedRoot) {
  process.stderr.write('Usage: npm run codex-retry -- --live --evidence <failed-smoke.json> --repo <generated-repository>\nOne additional model call; preserves the original failure and does not create an equal-budget comparison.\n');
  process.exitCode = 1;
} else {
  const input = await realpath(resolve(inputPath)); const probeRoot = await realpath(resolve('.probe-work')); const rel = relative(probeRoot, input);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Expected evidence inside this workspace .probe-work');
  if ((await stat(input)).size > 1024 * 1024) throw new Error('Evidence too large');
  const raw = await readFile(input); const parent = z.object({
    schemaVersion: z.literal(1), kind: z.literal('live-codex-synthetic-smoke'), status: z.literal('failed'), sourceTaskId: idSchema,
    sourceVerification: verificationSchema,
    modelRuns: z.array(z.object({ phase: z.enum(['source', 'baseline', 'evolve']), result: z.object({
      status: z.enum(['completed', 'failed']), promptDigest: hashSchema,
      experience: z.object({ id: idSchema, revision: z.number().int().positive(), sourceTaskId: idSchema, title: z.string(), strategy: z.string() }).strict().nullable(),
    }).passthrough() }).strict()).length(3),
    comparisons: z.array(z.object({ arm: z.literal('baseline'), taskId: idSchema, baseCommit: shaSchema, fixCommit: shaSchema,
      accepted: z.boolean(), verification: verificationSchema }).strict()).length(1),
  }).passthrough().parse(JSON.parse(raw.toString('utf8')));
  const previous = parent.modelRuns[2]!; const baseline = parent.comparisons[0]!;
  if (parent.modelRuns[0]!.phase !== 'source' || parent.modelRuns[0]!.result.status !== 'completed'
    || parent.modelRuns[1]!.phase !== 'baseline' || parent.modelRuns[1]!.result.status !== 'completed'
    || previous.phase !== 'evolve' || previous.result.status !== 'failed' || !previous.result.experience || !parent.sourceVerification.verified) {
    throw new Error('Only a failed evolve phase after verified source and completed baseline can be continued');
  }
  const root = await realpath(resolve(requestedRoot));
  if (basename(root) !== 'repository' || !basename(dirname(root)).startsWith('evolve-codex-demo-')) throw new Error('Expected this demo generated repository');
  if (snapshot(root).scope.repoId !== parent.sourceVerification.repoId || git(root, ['rev-parse', 'HEAD']) !== baseline.baseCommit
    || git(root, ['status', '--porcelain'])) throw new Error('Repository identity, clean state or starting commit differs');
  const acceptanceDir = join(dirname(root), 'acceptance-b');
  if (await acceptanceDigest(acceptanceDir) !== baseline.verification.acceptanceDigest) throw new Error('Acceptance changed');
  const dataDir = join(dirname(input), 'data'); await stat(join(dataDir, 'evolve.sqlite'));
  const store = new Store(join(dataDir, 'evolve.sqlite'));
  const output = resolve('.probe-work', 'codex-retry-' + Date.now()); await mkdir(output);
  const report: Record<string, unknown> = { schemaVersion: 1, kind: 'live-codex-synthetic-continuation', status: 'running', preliminary: true,
    parentEvidenceDigest: digest(raw), parentEvidence: input, sourceTaskId: parent.sourceTaskId,
    originalBaselineAccepted: baseline.accepted, comparableBudget: false, maxAdditionalModelCalls: 1,
    executorDigest: digest(await readFile(new URL('../src/codex-runner.js', import.meta.url))),
    limitations: ['Explicit retry adds an extra evolve call; no equal-budget or general improvement claim.',
      'Original timeout and missing token usage remain unknown and retained in parent evidence.',
      'Synthetic Codex proposal workflow, not a DSH model session.'] };
  try {
    const service = new EvolveService(store, root, { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir, regressionPath: 'tests', timeoutMs: 15000 });
    const exp: ExperienceContext = previous.result.experience;
    const current = service.requireExperience(exp.id);
    if (current.revision !== exp.revision || current.sourceTaskId !== exp.sourceTaskId || current.sourceTaskId !== parent.sourceTaskId
      || current.status !== 'source_verified' || current.title !== exp.title || current.strategy !== exp.strategy) throw new Error('Experience changed');
    const application = store.applications().find((item) => item.experienceId === exp.id && item.revision === exp.revision && item.taskId !== parent.sourceTaskId);
    if (!application) throw new Error('Missing original application');
    const task = service.requireTask(application.taskId);
    if (task.state !== 'open' || task.sessionId !== 'codex-evolve' || task.baseCommit !== baseline.baseCommit) throw new Error('Original task is no longer resumable');
    const prepared = await prepareCodexTask(root, task.summary, ['fees.py'], exp);
    if (prepared.promptDigest !== previous.result.promptDigest) throw new Error('Original prompt or source changed');
    report.taskId = task.id; report.application = application;
    report.reservation = await reserveCodexContinuation(input, digest(raw), join(output, 'evidence.json'));
    service.feedback({ id: randomUUID(), applicationId: application.id, outcome: 'unknown',
      note: 'Original evolve invocation did not yield an accepted repair; one continuation has been explicitly reserved.', extraCost: null, humanRework: null });
    await writeFile(join(output, 'evidence.json'), JSON.stringify(report, null, 2));
    process.stdout.write('Running one explicit continuation of the timed-out evolve phase\n');
    const result = await runCodex(root, prepared); report.modelRun = result;
    if (result.status !== 'completed') throw new Error('codex_' + result.reason);
    await applyCodexRepair(root, prepared, result.proposal);
    git(root, ['add', '--', 'fees.py']); git(root, ['commit', '-m', 'synthetic evolve continuation']);
    const verification = await verifyRepair(root, task.id, baseline.baseCommit, git(root, ['rev-parse', 'HEAD']), service.policy);
    report.verification = verification;
    if (verification.acceptanceDigest !== baseline.verification.acceptanceDigest) throw new Error('Acceptance digest differs from original paired task');
    service.feedback({ id: randomUUID(), applicationId: application.id, outcome: verification.verified ? 'accepted' : 'unknown',
      note: 'Independent synthetic acceptance after explicit retry; original timeout retained; no causal attribution.', extraCost: null, humanRework: null });
    service.finish(task.id); report.status = 'completed'; report.accepted = verification.verified;
    process.stdout.write(`Continuation acceptance: ${verification.verified}\n`);
  } catch (error) {
    report.status = 'failed'; report.failure = error instanceof Error ? error.message : 'unknown_failure'; process.exitCode = 1;
    process.stderr.write('Continuation did not complete; inspect local evidence.\n');
  } finally { store.close(); await writeFile(join(output, 'evidence.json'), JSON.stringify(report, null, 2)); process.stdout.write(`Local continuation evidence: ${output}\n`); }
}
