import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fixture } from '../test/fixture.js';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { createService } from '../src/config.js';
import { verifyRepair } from '../src/verification.js';
import { DeepseekBudget, startBudgetRelay } from './deepseek-budget.js';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).name !== 'dsh-reforge') throw new Error('Expected compiled runner in DSH-Reforge project');
const work = join(projectRoot, '.probe-work/t011-live');
export const liveBudgetPath = join(projectRoot, '.probe-work/t011-budget.json');
const python = process.env.EVOLVE_PYTHON ?? 'python';
export function validateRepair(code: string, functionName: 'apply_change' | 'reserve_stock'): void {
  if (Buffer.byteLength(code) > 4096) throw new Error('Repair too large');
  // A deliberately small experiment proposal language; the model has no file/shell tools.
  execFileSync(python, ['-I', '-S', '-c', `import ast,sys
t=ast.parse(sys.stdin.read()); allowed={'Module','FunctionDef','arguments','arg','Constant','Assign','AugAssign','Name','Load','Store','Subscript','Add','Sub','BinOp','If','Raise','Call','Return','Compare','Eq','NotEq','Lt','Gt','LtE','GtE','UnaryOp','Not'}
assert len(t.body)==1 and isinstance(t.body[0],ast.FunctionDef) and t.body[0].name=='${functionName}'
nodes=list(ast.walk(t)); assert len(nodes)<200
for n in nodes:
 assert type(n).__name__ in allowed
 if isinstance(n,ast.Name): assert n.id in {'state','stock','fail','before','ValueError'}
 if isinstance(n,ast.arg): assert n.arg in {'state','stock','fail'} and n.annotation is None
 if isinstance(n,ast.Call): assert isinstance(n.func,ast.Name) and n.func.id=='ValueError' and len(n.args)<=1 and not n.keywords and all(isinstance(a,ast.Constant) and isinstance(a.value,str) for a in n.args)
 if isinstance(n,ast.Constant): assert (isinstance(n.value,(int,bool)) and abs(n.value)<=100) or (isinstance(n.value,str) and len(n.value)<100)
assert t.body[0].decorator_list==[] and t.body[0].returns is None
`], { input: code, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
}
const repairSchema = z.object({ code: z.string().min(1).max(4096) }).strict();
function proposal(text: string): string { return repairSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))).code; }
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object'); return value as RecordValue; }
export function deliveryEvidence(events: RecordValue[], sessionId: string, app: { id: string; taskId: string; experienceId: string; revision: number }): { returned: boolean; continued: boolean } {
  const calls = new Set<string>(); let returned = false; let continued = false;
  for (const params of events) {
    if (params.sessionId !== sessionId) continue;
    try {
      const event = object(params.event); const data = object(event.data); const message = object(data.message);
      const blocks = message.content as RecordValue[];
      if (event.type === 'assistant/message') {
        if (returned && data.interrupted !== true) continued = true;
        for (const b of blocks) if (b.type === 'tool-call' && b.name === 'evolve_begin_task') calls.add(String(b.id));
      }
      if (event.type !== 'tool/result' || message.isError === true || !calls.has(String(message.toolCallId))) continue;
      for (const block of blocks) if (block.type === 'text') {
        const value = object(JSON.parse(String(block.text))); const exp = object(value.experience); const application = object(value.application);
        if (value.taskId === app.taskId && application.id === app.id && exp.id === app.experienceId && exp.revision === app.revision) returned = true;
      }
    } catch { /* An unrelated or malformed event cannot establish delivery. */ }
  }
  return { returned, continued };
}
interface Rpc {
  start(): void; close(): void;
  request(method: string, params: object, signal?: AbortSignal): Promise<unknown>;
  onNotification(handler: (method: string, params: RecordValue) => void): void;
}
type Plan = { schemaVersion: 1; hostRoot: string; dshHome: string; profile: string; repo: string; acceptance: string; targetAcceptance: string;
  sourceBase: string; configPath: string; archiveDigest: string; sourceCode: string; targetCode: string; prompts: { source: string; learn: string; transfer: string } };
const readPlan = (): Plan => {
  const plan = JSON.parse(readFileSync(join(work, 'plan.json'), 'utf8')) as Plan;
  if (plan.configPath !== join(work, 'evolve-config.json')) throw new Error('Plan belongs to another project');
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
  const plan: Plan = { schemaVersion: 1, hostRoot, dshHome, profile: 'evolve-t011', repo: f.repo, acceptance: f.acceptance,
    targetAcceptance, sourceBase: git(f.repo, ['rev-parse', 'HEAD']), configPath, archiveDigest: digest(readFileSync(archive)), sourceCode, targetCode,
    prompts: {
      source: 'This is an explicitly guided synthetic integration experiment. First call evolve_begin_task with summary "database transaction rollback exception". Then record this explicit user correction with evolve_record_correction: "Restore the original balance when a transaction fails." Do not propose or verify an experience yet. Repair ledger.py below. You have no shell or file tools. End with only JSON {"code":"the entire corrected Python file"}; the host will validate and commit your proposal. Do not claim tests passed.\n' + sourceCode,
      learn: 'The host has validated and committed your source repair proposal. In this same task, propose exactly one experience with title "database transaction rollback exception", requiredFiles ["contract.py"], exactly one observedFact describing the explicit recorded correction, and a scoped strategy derived from the repair. Use evolve_propose_experience, then evolve_verify_experience exactly once. Only after a successful repair proof, bind that fact to the correction receipt using the returned fact digest and correction evidence id/digest via evolve_link_fact_evidence at the exact latest revision. You may add the verification receipt as a second source for that same fact if supported. Do not fabricate hashes, claim semantic verification or write owner feedback. Finish the source task with evolve_finish_task. Report any failure; do not retry verification or create duplicate experiences.',
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
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  writeFileSync(join(work, 'plan-digest.txt'), digest(JSON.stringify(plan)));
  process.stdout.write('Prepared isolated official SDK profile and synthetic tasks; zero model calls.\n');
}
async function run(live: boolean): Promise<void> {
  const plan = readPlan(); if (digest(JSON.stringify(plan)) !== readFileSync(join(work, 'plan-digest.txt'), 'utf8')) throw new Error('Plan drift');
  if (git(plan.repo, ['rev-parse', 'HEAD']) !== plan.sourceBase || git(plan.repo, ['status', '--porcelain'])) throw new Error('Expected untouched synthetic source');
  if (live) writeFileSync(join(work, 'live-once.json'), JSON.stringify({ startedAt: new Date().toISOString(), planDigest: digest(JSON.stringify(plan)) }), { flag: 'wx' });
  const budget = new DeepseekBudget(liveBudgetPath);
  const relay = await startBudgetRelay(budget, live ? fetch : async () => { throw new Error('Offline handshake attempted a model call'); });
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
    requestedRuntime: '0.2.0-rc.2', sourceAccepted: null, transferAccepted: null, experienceOffered: false, benefitEvaluated: false, phase: 'initialize' };
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
    if (!last) throw new Error('No assistant message');
    const data = object(last.data); const message = object(data.message); const blocks = message.content as RecordValue[];
    return blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join('');
  };
  try {
    report.server = await rpc.request('initialize', { cwd: plan.repo, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 4096 }, AbortSignal.timeout(30000));
    if (!live) { if (budget.state.calls.length) throw new Error('Handshake must not call model'); report.phase = 'handshake_passed'; return; }
    const sourceSession = 't011-source-' + randomUUID(); report.phase = 'source_proposal';
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
      report.sourceRepairVerified = sourceProof?.verified === true && sourceProof.baseCommit === plan.sourceBase && sourceProof.fixCommit === git(plan.repo, ['rev-parse', 'HEAD']);
      report.sourceAccepted = exp?.status === 'source_verified' && provenance?.complete && report.sourceBoundaryClosed && correctionCited && report.sourceRepairVerified;
      if (!report.sourceAccepted || !exp || !source) throw new Error('Source learning incomplete');
      const transferSession = 't011-transfer-' + randomUUID(); report.phase = 'transfer_proposal';
      const transferCode = proposal(await turn(transferSession, plan.prompts.transfer)); validateRepair(transferCode, 'reserve_stock');
      const task = service.store.tasks().find((t) => t.sessionId === transferSession); if (!task) throw new Error('Missing transfer task');
      const app = service.store.applications().find((a) => a.taskId === task.id); report.application = app;
      report.experienceRecorded = app?.experienceId === exp.id && app?.revision === exp.revision;
      const delivery = app ? deliveryEvidence(allEvents, transferSession, app) : { returned: false, continued: false };
      report.delivery = delivery; report.experienceOffered = report.experienceRecorded && delivery.returned && delivery.continued;
      writeFileSync(join(plan.repo, 'cart.py'), transferCode); git(plan.repo, ['add', 'cart.py']); git(plan.repo, ['commit', '-m', 'real DSH transfer repair proposal']);
      report.phase = 'transfer_acceptance';
      const proof = await verifyRepair(plan.repo, task.id, task.baseCommit, git(plan.repo, ['rev-parse', 'HEAD']), { trusted: true, python,
        acceptanceDir: plan.targetAcceptance, regressionPath: 'tests', timeoutMs: 15000 });
      report.transferProof = proof; report.transferAccepted = proof.verified;
      if (app) service.feedback({ id: randomUUID(), applicationId: app.id, outcome: proof.verified ? 'accepted' : 'counterexample',
        note: 'Host synthetic benchmark feedback from independent pytest; guided integration, not a benefit comparison.', extraCost: null, humanRework: null });
      report.phase = proof.verified && report.experienceOffered ? 'guided_loop_passed' : 'partial';
    } finally { service.store.close(); }
  } catch { report.failure = 'runtime_or_acceptance_failure'; report.phaseAtFailure = report.phase; report.phase = 'partial'; process.exitCode = 1; }
  finally {
    try { await rpc.request('shutdown', {}, AbortSignal.timeout(5000)); } catch { child.kill(); }
    rpc.close(); await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 2000))]); if (child.exitCode === null) child.kill();
    await relay.close(); report.budget = budget.state; report.conservativeMicroCny = budget.spent; budget.close();
    writeFileSync(join(work, live ? 'live-report.json' : 'handshake.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(work, live ? 'events.json' : 'handshake-events.json'), JSON.stringify(allEvents)); writeFileSync(join(work, 'runtime-stderr.log'), stderr);
    process.stdout.write(JSON.stringify({ phase: report.phase, requests: budget.state.calls.length, conservativeCny: budget.spent / 1e6 }) + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === '--prepare') await prepare(resolve(process.argv[3]!), resolve(process.argv[4]!), resolve(process.argv[5]!));
  else if (mode === '--probe' || mode === '--live') await run(mode === '--live');
  else throw new Error('Use --prepare <host-root> <dsh-home> <archive>, --probe (no model), or --live (paid, once)');
}
