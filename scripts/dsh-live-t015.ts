import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fixture } from '../test/fixture.js';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { createService } from '../src/config.js';
import { acceptanceDigest, verifyRepair } from '../src/verification.js';
import { DeepseekBudget, startBudgetRelay } from './deepseek-budget.js';

import { deliveryEvidence, projectRoot, validateRepair } from './dsh-live.js';
import { freezeFiles, validateQualification, validateAcceptance, consumeQualification } from './live-qualification.js';

export const supplementalWork = join(projectRoot, '.probe-work/t015-live');
export const supplementalBudgetPath = join(projectRoot, '.probe-work/t015-budget.json');
const work = supplementalWork;
const python = process.env.EVOLVE_PYTHON ?? 'python';
const repairSchema = z.object({ code: z.string().min(1).max(4096) }).strict();
function proposal(text: string): string { return repairSchema.parse(JSON.parse(text.trim().replace(/^\`\`\`(?:json)?\s*/, '').replace(/\s*\`\`\`$/, ''))).code; }
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object'); return value as RecordValue; }
interface Rpc {
  start(): void; close(): void;
  request(method: string, params: object, signal?: AbortSignal): Promise<unknown>;
  onNotification(handler: (method: string, params: RecordValue) => void): void;
}
type Plan = { schemaVersion: 1; experiment: 't015'; addedBudgetMicroCny: 5_000_000; frozenFiles: Record<string, string>; acceptanceDigests: Record<string, string>; hostRoot: string; dshHome: string; profile: string; repo: string; acceptance: string; targetAcceptance: string;
  sourceBase: string; configPath: string; archiveDigest: string; sourceCode: string; targetCode: string; prompts: { source: string; learn: string; transfer: string } };
const readPlan = async (): Promise<Plan> => {
  const plan = JSON.parse(readFileSync(join(work, 'plan.json'), 'utf8')) as Plan;
  if (plan.experiment !== 't015' || plan.addedBudgetMicroCny !== 5_000_000 || plan.profile !== 'evolve-t015' || plan.configPath !== join(work, 'evolve-config.json')) throw new Error('Plan belongs to another project');
  await validateQualification(work, plan);
  return plan;
};
function environment(home: string, config: string): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext|appdata|localappdata|userprofile|home)$/i.test(key))),
    DSH_HOME: home, DSH_REFORGE_CONFIG: config, DSH_TELEMETRY: 'false', DSH_MAX_TOKENS_AS_SUCCESS: 'false' };
}
function basePatch(plan: Plan): RecordValue[] {
  return [ ...['persistent-bash', 'persistent-pwsh', 'session-log-deepseek', 'plugin-package-inventory-deepseek', 'deepseek-llm-api-extensions', 'llm-retry']
    .map((id) => ({ id, disabled: true })),
  { id: 'sessions', config: { root: join(work, 'sessions'), compression: 'none' } },
  { insert: [{ id: 'credentials', name: '@deepseek-ai/dsh-credentials-local', config: { path: join(plan.dshHome, '.credentials.yaml'), watch: false } }] } ];
}
async function prepare(hostRoot: string, dshHome: string, archive: string): Promise<void> {
  if (existsSync(join(work, 'plan.json'))) throw new Error('Plan already exists; do not regenerate an observed experiment');
  mkdirSync(work, { recursive: true }); const f = await fixture();
  const targetCode = 'def reserve_stock(stock, fail=False):\n    before = stock["remaining"]\n    stock["remaining"] -= 3\n    if fail:\n        raise ValueError("reservation failed")\n    return stock["remaining"]\n';
  writeFileSync(join(f.repo, 'cart.py'), targetCode); git(f.repo, ['add', 'cart.py']); git(f.repo, ['commit', '-m', 'add synthetic transfer target']);
  const targetAcceptance = join(f.home, 'target-acceptance'); mkdirSync(targetAcceptance);
  writeFileSync(join(targetAcceptance, 'test_acceptance.py'), 'import pytest\nfrom cart import reserve_stock\ndef test_failure_restores_stock():\n    stock={"remaining":9}\n    with pytest.raises(ValueError): reserve_stock(stock, fail=True)\n    assert stock["remaining"]==9\ndef test_success_reserves_stock():\n    assert reserve_stock({"remaining":9})==6\n');
  const sourceCode = readFileSync(join(f.repo, 'ledger.py'), 'utf8'); const configPath = join(work, 'evolve-config.json');
  const plan: Plan = { schemaVersion: 1, hostRoot, dshHome, profile: 'evolve-t015', experiment: 't015', addedBudgetMicroCny: 5_000_000, frozenFiles: {},
    acceptanceDigests: { [f.acceptance]: await acceptanceDigest(f.acceptance), [targetAcceptance]: await acceptanceDigest(targetAcceptance) }, repo: f.repo, acceptance: f.acceptance,
    targetAcceptance, sourceBase: git(f.repo, ['rev-parse', 'HEAD']), configPath, archiveDigest: digest(readFileSync(archive)), sourceCode, targetCode,
    prompts: {
      source: 'This is an explicitly guided synthetic integration experiment. First call evolve_begin_task with summary "database transaction rollback exception". Then record this explicit user correction with evolve_record_correction: "Restore the original balance when a transaction fails." Do not propose or verify an experience yet. Repair ledger.py below. You have no shell or file tools. End with only JSON {"code":"the entire corrected Python file"}; the host will validate and commit your proposal. Do not claim tests passed.\n' + sourceCode,
      learn: 'The host has validated and committed your source repair proposal. In this same task, propose exactly one experience with title "database transaction rollback exception", requiredFiles ["contract.py"], exactly one observedFact describing the explicit recorded correction, and a scoped strategy derived from the repair. Call evolve_propose_experience with candidate fields title/strategy/observedFacts/inferences/recommendations/requiredFiles; OMIT citations at proposal time. Then evolve_verify_experience exactly once. Only after a successful repair proof, bind that fact to the correction receipt using the returned fact digest and correction evidence id/digest via evolve_link_fact_evidence at the exact latest revision. You may add the verification receipt as a second source for that same fact if supported. For evolve_link_fact_evidence, copy experienceId and exact latest revision plus citations [{factIndex,factDigest,evidenceId,evidenceDigest}]; no kind field. Use facts returned at verification and the original correction receipt; copy every digest verbatim. Do not fabricate hashes, claim semantic verification or write owner feedback. Finish the source task with evolve_finish_task. Report any failure; do not retry verification or create duplicate experiences.',
      transfer: 'This is a new, explicitly guided synthetic task in the same repository. First call evolve_begin_task with summary "database transaction rollback exception stock reservation". Examine any returned experience and its applicability. Repair cart.py below; no shell or file tools are available. Finish your task using evolve_finish_task, then end with only JSON {"code":"the entire corrected Python file"}. The host will independently validate and test the proposal; do not claim tests passed.\n' + targetCode,
    } };
  writeFileSync(configPath, JSON.stringify({ repoRoot: f.repo, dataDir: join(work, 'learning'), executionTrusted: true, shareWithModel: true,
    acceptanceDir: f.acceptance, python, regressionPath: 'tests', timeoutMs: 15000 }, null, 2));
  const bin = join(hostRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'); const env = environment(dshHome, configPath);
  const version = execFileSync(process.execPath, [bin, '--version'], { env, cwd: f.repo, windowsHide: true, encoding: 'utf8' }).trim();
  if (!version.includes('0.2.0-rc.2')) throw new Error('Unexpected DSH version');
  const initialized = execFileSync(process.execPath, [bin, '--profile', plan.profile, '--from-default-profile', 'sdk-minimal', '--dump-config'], { env, cwd: f.repo, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  writeFileSync(join(work, 'initial-profile.yml'), initialized);
  const install = execFileSync(process.execPath, [bin, 'plugin', '--profile', plan.profile, 'add', archive, '--ignore-scripts'], { env, cwd: f.repo, windowsHide: true, maxBuffer: 1024 * 1024 });
  writeFileSync(join(work, 'installation.log'), install);
  writeFileSync(join(dshHome, 'profiles', plan.profile, 'cordis.patch.yml'), JSON.stringify(basePatch(plan), null, 2));
  const profileDir = join(dshHome, 'profiles', plan.profile);
  const installed = join(profileDir, 'node_modules/dsh-reforge/dist/src');
  const files = [configPath, archive, join(profileDir, 'cordis.yml'), join(profileDir, 'cordis.patch.yml'),
    join(profileDir, 'package.json'), join(profileDir, 'pnpm-lock.yaml'), bin,
    join(hostRoot, 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js'),
    join(f.repo, 'ledger.py'), join(f.repo, 'cart.py'), join(f.repo, 'contract.py'),
    ...readdirSync(f.acceptance).map((name) => join(f.acceptance, name)),
    ...readdirSync(targetAcceptance).map((name) => join(targetAcceptance, name)),
    ...readdirSync(installed).filter((name) => name.endsWith('.js')).map((name) => join(installed, name)),
    join(projectRoot, 'dist/scripts/dsh-live-t015.js'), join(projectRoot, 'dist/scripts/deepseek-budget.js'),
    join(projectRoot, 'dist/scripts/messages-usage.js'), join(projectRoot, 'dist/scripts/live-qualification.js'),
    join(projectRoot, 'dist/scripts/dsh-live.js'), join(projectRoot, '.probe-work/t011-budget.json')];
  plan.frozenFiles = freezeFiles(files);
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  writeFileSync(join(work, 'plan-digest.txt'), digest(JSON.stringify(plan)));
  process.stdout.write('Prepared isolated official SDK profile and synthetic tasks; zero model calls.\n');
}
async function run(live: boolean): Promise<void> {
  const plan = await readPlan(); if (digest(JSON.stringify(plan)) !== readFileSync(join(work, 'plan-digest.txt'), 'utf8')) throw new Error('Plan drift');
  if (git(plan.repo, ['rev-parse', 'HEAD']) !== plan.sourceBase || git(plan.repo, ['status', '--porcelain'])) throw new Error('Expected untouched synthetic source');
  if (live) await consumeQualification(work, plan);
  const budget = new DeepseekBudget(supplementalBudgetPath, 't015-snapshot-high-water-v1');
  const relay = await startBudgetRelay(budget, live ? fetch : async () => { throw new Error('Offline handshake attempted a model call'); }, () => validateAcceptance(plan));
  const overlay = join(work, 'request-overlay.json');
  writeFileSync(overlay, JSON.stringify([{ id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: relay.baseURL,
    reasoningEffort: 'off', thinking: 'disabled', maxTokens: 4096, streamIdleTimeoutMs: 60000,
    retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'deepseek-flash', name: 'Flash', contextWindow: 1_000_000, maxTokens: 4096 }] } }], null, 2));
  const bin = join(plan.hostRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  const child = spawn(process.execPath, [bin, '--profile', plan.profile, '--patch', overlay], { env: environment(plan.dshHome, plan.configPath), cwd: plan.repo, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const runtime = await import(pathToFileURL(join(plan.hostRoot, 'node_modules/@deepseek-ai/dsh-sdk-protocol/lib/index.js')).href) as {
    JsonRpcLineTransport: new (input: Readable, output: Writable) => Rpc };
  const rpc = new runtime.JsonRpcLineTransport(child.stdout, child.stdin); rpc.start();
  let stderr = ''; child.stderr.on('data', (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-32000); });
  const allEvents: RecordValue[] = []; let notify: ((method: string, params: RecordValue) => void) | undefined;
  rpc.onNotification((method, params) => { if (method === 'session.event') allEvents.push(params); notify?.(method, params); });
  const report: RecordValue = { kind: live ? 'guided-real-dsh-integration' : 'offline-sdk-handshake', model: 'deepseek-flash',
    experiment: 't015', addedBudgetMicroCny: 5_000_000, officialVersionAtPreparation: 'DeepSeek-V4.1-Flash-1017', requestedRuntime: '0.2.0-rc.2', sourceAccepted: null, transferAccepted: null, experienceOffered: false, benefitEvaluated: false, phase: 'initialize' };
  const turn = async (sessionId: string, text: string): Promise<string> => {
    const events: RecordValue[] = []; let running = false; let finished!: () => void;
    const idle = new Promise<void>((resolve) => { finished = resolve; });
    notify = (method, params) => { if (params.sessionId !== sessionId) return;
      if (method === 'session.event') events.push(object(params.event));
      if (method === 'session.status') { if (params.status === 'running') running = true; else if (running && params.status === 'idle') finished(); }
    };
    await rpc.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text }] }, AbortSignal.timeout(10000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([idle, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Turn deadline')), 240000); })]); }
    finally { clearTimeout(timer); notify = undefined; }
    const last = events.filter((e) => e.type === 'assistant/message').at(-1);
    if (!last || object(last.data).interrupted === true) throw new Error('Missing or interrupted assistant message');
    const data = object(last.data); const message = object(data.message); const blocks = message.content as RecordValue[];
    return blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join('');
  };
  try {
    report.server = await rpc.request('initialize', { cwd: plan.repo, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 4096 }, AbortSignal.timeout(30000));
    if (!live) { if (budget.state.calls.length) throw new Error('Handshake must not call model'); report.phase = 'handshake_passed'; return; }
    const sourceSession = 't015-source-' + randomUUID(); report.phase = 'source_proposal';
    const sourceCode = proposal(await turn(sourceSession, plan.prompts.source)); validateRepair(sourceCode, 'apply_change');
    writeFileSync(join(plan.repo, 'ledger.py'), sourceCode); git(plan.repo, ['add', 'ledger.py']); git(plan.repo, ['commit', '-m', 'real DSH source repair proposal']);
    report.phase = 'source_learning'; await turn(sourceSession, plan.prompts.learn);
    const opened = createService(JSON.parse(readFileSync(plan.configPath, 'utf8'))); const service = opened.service;
    try {
      const source = service.store.tasks().find((t) => t.sessionId === sourceSession); const exp = service.store.experiences().find((e) => e.sourceTaskId === source?.id);
      const provenance = exp ? service.provenance(exp) : null;
      const sourceProof = exp?.verificationId ? service.store.verification(exp.verificationId) : null;
      const correctionCited = provenance?.citations.some((c) => {
        const evidence = service.store.evidence(c.evidenceId);
        return evidence?.kind === 'correction' && evidence.taskId === source?.id && evidence.note === 'Restore the original balance when a transaction fails.';
      }) ?? false;
      report.sourceTaskId = source?.id; report.experience = exp; report.sourceBoundaryClosed = source?.state === 'closed'; report.correctionCited = correctionCited;
      await validateAcceptance(plan);
      report.sourceRepairVerified = sourceProof?.verified === true && sourceProof.baseCommit === plan.sourceBase && sourceProof.fixCommit === git(plan.repo, ['rev-parse', 'HEAD'])
        && sourceProof.acceptanceDigest === plan.acceptanceDigests[plan.acceptance];
      report.sourceAccepted = exp?.status === 'source_verified' && provenance?.complete && report.sourceBoundaryClosed && correctionCited && report.sourceRepairVerified;
      if (!report.sourceAccepted || !exp || !source) throw new Error('Source learning incomplete');
      const transferSession = 't015-transfer-' + randomUUID(); report.phase = 'transfer_proposal';
      const transferCode = proposal(await turn(transferSession, plan.prompts.transfer)); validateRepair(transferCode, 'reserve_stock');
      const task = service.store.tasks().find((t) => t.sessionId === transferSession); if (!task) throw new Error('Missing transfer task');
      const app = service.store.applications().find((a) => a.taskId === task.id); report.application = app;
      report.experienceRecorded = app?.experienceId === exp.id && app?.revision === exp.revision;
      const delivery = app ? deliveryEvidence(allEvents, transferSession, app) : { returned: false, continued: false };
      report.delivery = delivery; report.experienceOffered = report.experienceRecorded && delivery.returned && delivery.continued;
      writeFileSync(join(plan.repo, 'cart.py'), transferCode); git(plan.repo, ['add', 'cart.py']); git(plan.repo, ['commit', '-m', 'real DSH transfer repair proposal']);
      report.phase = 'transfer_acceptance';
      await validateAcceptance(plan);
      const proof = await verifyRepair(plan.repo, task.id, task.baseCommit, git(plan.repo, ['rev-parse', 'HEAD']), { trusted: true, python,
        acceptanceDir: plan.targetAcceptance, regressionPath: 'tests', timeoutMs: 15000 });
      await validateAcceptance(plan);
      if (proof.acceptanceDigest !== plan.acceptanceDigests[plan.targetAcceptance]) throw new Error('Target acceptance changed');
      report.transferProof = proof; report.transferBoundaryClosed = task.state === 'closed'; report.transferAccepted = proof.verified && task.state === 'closed';
      if (app) service.feedback({ id: randomUUID(), applicationId: app.id, outcome: proof.verified ? 'accepted' : 'counterexample',
        note: 'Host synthetic benchmark feedback from independent pytest; guided integration, not a benefit comparison.', extraCost: null, humanRework: null });
      report.phase = report.transferAccepted && report.experienceOffered ? 'guided_loop_passed' : 'partial';
      if (report.phase === 'partial') process.exitCode = 1;
    } finally { service.store.close(); }
  } catch { report.failure = 'runtime_or_acceptance_failure'; report.phaseAtFailure = report.phase; report.phase = 'partial'; process.exitCode = 1; }
  finally {
    try { await rpc.request('shutdown', {}, AbortSignal.timeout(5000)); } catch { child.kill(); }
    rpc.close(); await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 2000))]); if (child.exitCode === null) child.kill();
    await relay.close(); report.budget = budget.state; report.conservativeMicroCny = budget.spent; budget.close();
    writeFileSync(join(work, live ? 'live-report.json' : 'handshake.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(work, live ? 'event-summary.json' : 'handshake-event-summary.json'), JSON.stringify({ eventCount: allEvents.length, stderrBytes: Buffer.byteLength(stderr) }));
    process.stdout.write(JSON.stringify({ phase: report.phase, requests: budget.state.calls.length, conservativeCny: budget.spent / 1e6 }) + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === '--prepare') await prepare(resolve(process.argv[3]!), resolve(process.argv[4]!), resolve(process.argv[5]!));
  else if (mode === '--probe' || mode === '--live') await run(mode === '--live');
  else throw new Error('Use --prepare <host-root> <dsh-home> <archive>, --probe (no model), or --live (paid, once)');
}
