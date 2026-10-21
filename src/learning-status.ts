import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { digest, type Experience } from './domain.js';
import type { EvolveService } from './service.js';
import type { AutomaticSegment } from './automatic-store.js';
import type { ExtractionJob } from './extraction-domain.js';

type PhaseState = 'pending' | 'active' | 'done' | 'blocked' | 'unknown' | 'skipped';
export interface LearningProgress {
  id: string; taskId: string | null; title: string; updatedAt: string;
  status: 'recording' | 'verifying' | 'extracting' | 'qualifying' | 'ready' | 'waiting' | 'needs_attention' | 'skipped' | 'unknown';
  summary: string; next: string; candidateId: string | null;
  steps: { label: string; state: PhaseState }[];
}
export interface LearningStatus {
  version: 1; automatic: boolean; checks: { label: string; ready: boolean }[];
  quota: { limit: number; used: number; remaining: number; consistent: boolean } | null;
  tasks: LearningProgress[];
}

const reasons: Record<string, [string, string]> = {
  no_code_change: ['这次请求没有需要学习的代码变化。', '继续正常开发；只在出现可验证的修复时整理经验。'],
  dependencies_changed: ['依赖发生了变化，无法把结果归因于这次修复。', '稳定依赖后，在新的修复请求中积累经验。'],
  multiple_inputs: ['这次请求中加入了其他输入，修正的归属不明确。', '在下一次独立请求中继续，旧记录保留。'],
  concurrent_request: ['同一仓库有交错请求，无法可靠区分修改来源。', '让当前请求结束后，再开始一次独立修复。'],
  manual_task_active: ['这个仓库仍有显式记录的任务。', '先完成已有任务；自动学习不会接管它。'],
  manual_task_started: ['期间开始了显式任务，这次自动记录已停止。', '继续已有的显式任务，下一次请求再自动记录。'],
  capture_unavailable: ['无法完整记录这次代码变化。', '检查文件范围、未跟踪 Python 文件和快照容量；不要重写旧记录。'],
  repository_changed: ['代码在证据整理之后又发生了变化。', '保持修复版本稳定，在新的请求中重新积累证据。'],
  policy_changed: ['当前执行配置与记录时不一致。', '核对本机配置；旧结果不会自动按新配置重跑。'],
  policy_revoked: ['这次提炼的授权配置已失效。', '由你核对本机授权，插件不会自行增加次数。'],
  quota_exhausted: ['已授权的提炼次数用完了。', '如需继续，由你在本机提供新的明确授权；旧占额保留。'],
  model_unavailable: ['修复证据已齐备，正在等待 DSH 模型。', '保持使用相同仓库与配置的 DSH 运行，并检查模型和凭据是否可用。'],
  model_prepare_failed: ['模型请求准备未完成。', '在 DSH 中检查模型配置；旧尝试不会自动重跑。'],
  model_route_changed: ['模型路由与已授权配置不一致。', '核对 DSH 的模型选择和本机提炼策略。'],
  model_credentials_missing: ['提炼所需的模型凭据不可用。', '在 DSH 中检查凭据配置；不要把密钥写入经验或聊天。'],
  model_transport_failed: ['模型连接未完整结束，无法确认结果。', '检查连接；旧占额保留，不会自动重跑。'],
  model_timed_out: ['模型请求超时，结果未能确认。', '旧占额保留，核对后再决定是否单独授权新尝试。'],
  model_cancelled: ['模型请求被中断，结果未能确认。', '旧占额保留，不会自动恢复这次请求。'],
  model_incomplete: ['模型返回内容不完整。', '保留旧记录；核对后再决定是否单独授权新尝试。'],
  invalid_response: ['模型没有返回可校验的经验结构。', '没有创建经验；这次资格已占用，不会自动重试。'],
  model_abstained: ['模型没有找到足够可靠、值得复用的策略。', '本次未新增经验，也不会为同一记录自动重试。'],
  source_not_verified: ['独立测试没有证明原失败已被修复。', '查看测试依据，修好当前问题后继续新的请求。'],
  no_source_verification: ['还没有完整的独立修复验证。', '检查验收目录和执行配置；普通回合结束不能代替验证。'],
  execution_disabled: ['当前只整理材料，没有获准执行验证。', '由你配置受信任的执行与后台验证后，再开始新的修复。'],
  dirty_tree: ['显式任务的修复还没有形成稳定版本。', '显式模式需要提交修复再结束任务；自动模式可使用未提交快照。'],
  no_commit_change: ['显式任务没有记录到修复版本变化。', '先完成修复；没有可验证变化时不提炼。'],
  diff_truncated: ['修复差异超过了可处理范围。', '下一次把修复拆成较小、可以独立验证的请求。'],
  sources_omitted: ['来源材料超出范围，无法完整核对。', '保留旧记录，下一次缩小任务范围。'],
  candidate_changed: ['候选内容或来源已发生变化，自动复核停止。', '核对当前经验版本；不会沿用旧资格自动认定有效。'],
  candidate_not_verified: ['候选没有通过独立来源复核。', '查看经验中的测试和来源，先修正问题。'],
  experience_disabled: ['这条经验目前已停用。', '原始记录保留，可在经验详情查看原因和历史版本。'],
};
function explanation(reason: string): [string, string] {
  const fixed = reason.replace(/^extraction_/, '');
  return reasons[fixed] ?? ['这次学习的材料或结果无法可靠确认。', '查看处理依据；不会自动重跑未知操作或认定修复成功。'];
}
function acceptanceConfigured(service: EvolveService): boolean {
  try {
    const dir = service.policy.acceptanceDir;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    const path = relative(realpathSync(service.root), realpathSync(dir));
    return isAbsolute(path) || path === '..' || path.startsWith('..\\') || path.startsWith('../');
  } catch { return false; }
}
function latestExtraction(service: EvolveService, evidenceJobId: string): ExtractionJob | undefined {
  const jobs = service.store.extraction.jobs().filter(j => j.evidenceJobId === evidenceJobId);
  const superseded = new Set(service.store.extraction.reauthorizations().map(r => r.originalJobId));
  return jobs.filter(j => !superseded.has(j.id)).at(-1);
}

/** A read-only projection. It neither starts work nor resolves credentials. */
export function learningStatus(service: EvolveService): LearningStatus {
  const policy = service.extraction.policy;
  const grant = policy ? service.store.extraction.grants().find(g => g.id === policy.grantId) : undefined;
  const consistent = !grant || !!policy && grant.policyDigest === digest(JSON.stringify(policy)) && grant.maxCalls === policy.maxCalls;
  const repo = service.repositoryId;
  const tasks = service.store.tasks().filter(t => t.scope.repoId === repo);
  const segments = service.store.automatic.rows().filter(s => s.repoId === repo);
  const output: LearningProgress[] = [];
  const project = (segment: AutomaticSegment | undefined, taskId: string | null): void => {
    const task = tasks.find(t => t.id === taskId);
    const original = taskId ? service.store.learning.forTask(taskId) : null;
    const recovery = original ? service.store.learning.recoveries().find(r => r.originalJobId === original.id) : undefined;
    // Recovery appends a new job; forTask intentionally retains the original.
    const job = recovery ? service.store.learning.job(recovery.recoveryJobId) : original;
    const bundle = job ? service.store.learning.bundle(job.id) : null;
    const extraction = job ? latestExtraction(service, job.id) : undefined;
    const candidate: Experience | null = extraction?.candidateId ? service.store.experience(extraction.candidateId) : null;
    const row: LearningProgress = { id: segment?.id ?? taskId!, taskId, title: task?.summary ?? '一次开发请求',
      updatedAt: [task?.createdAt, segment?.updatedAt, job?.updatedAt, extraction?.updatedAt].filter((v): v is string => !!v).sort().at(-1)!,
      status: 'waiting', summary: '等待本次请求的修复证据。', next: '正常开发即可；插件会按已授权的配置处理。', candidateId: candidate?.id ?? null,
      steps: ['记录变化', '验证修复', '提炼经验', '独立复核'].map(label => ({ label, state: 'pending' })) };
    const set = (i: number, state: PhaseState): void => { row.steps[i]!.state = state; };
    if (task) set(0, task.state === 'open' ? 'active' : 'done');
    if (job) set(1, job.state === 'running' ? 'active' : job.state === 'unknown' ? 'unknown' : job.state === 'failed' || bundle?.status === 'incomplete' ? 'blocked' : bundle?.status === 'ready' ? 'done' : 'pending');
    if (extraction) set(2, extraction.state === 'running' ? 'active' : extraction.state === 'candidate' ? 'done' : extraction.state === 'abstained' ? 'skipped' : extraction.state === 'unknown' ? 'unknown' : ['failed', 'blocked'].includes(extraction.state) ? 'blocked' : 'pending');
    if (candidate?.status === 'source_verified') set(3, 'done');
    else if (candidate?.status === 'disabled') set(3, 'blocked');
    else if (segment?.state === 'qualifying') set(3, 'active');
    const paused = (reason: string, unknown = false): void => {
      row.status = unknown ? 'unknown' : 'needs_attention'; [row.summary, row.next] = explanation(reason);
      if (unknown) { row.summary = (reasons[reason.replace(/^extraction_/, '')]?.[0] ?? '处理结果尚不确定。') + '旧记录与占额已保留。'; row.next = '不会自动重跑；核对处理记录后，再决定是否单独授权新的尝试。'; }
    };
    if (segment?.state === 'unknown') { paused(segment.reason, true); set(segment.reason === 'qualification_interrupted' ? 3 : segment.reason.startsWith('extraction_') ? 2 : 0, 'unknown'); }
    else if (job?.state === 'unknown' || extraction?.state === 'unknown') paused(extraction?.state === 'unknown' ? extraction.reason : job!.reason, true);
    else if (candidate?.status === 'disabled') paused('experience_disabled');
    else if (segment?.state === 'blocked') paused(segment.reason === 'source_incomplete' ? bundle?.reasons[0] ?? job?.reason ?? segment.reason : segment.reason);
    else if (job?.state === 'failed' || bundle?.status === 'incomplete') paused(bundle?.reasons[0] ?? job?.reason ?? 'invalid_source');
    else if (extraction && ['failed', 'blocked'].includes(extraction.state)) paused(extraction.reason);
    else if (segment?.state === 'skipped' || extraction?.state === 'abstained') { row.status = 'skipped'; [row.summary, row.next] = explanation(segment?.state === 'skipped' ? segment.reason : extraction!.reason); for (let i = segment?.state === 'skipped' ? 1 : 3; i < 4; i++) set(i, 'skipped'); }
    else if (candidate?.status === 'source_verified') { row.status = 'ready'; row.summary = '已保存，来源修复通过了独立验证。'; row.next = '后续任务仍需检查适用条件和实际结果，这不代表已证明收益。'; }
    else if (segment?.state === 'qualifying') { row.status = 'qualifying'; row.summary = '正在独立复核新经验的来源。'; row.next = '复核通过后才会提供给相似任务。'; }
    else if (candidate) { row.summary = '已提炼出一条候选经验，等待来源复核。'; row.next = segment?.state === 'queued' && service.automatic.enabled ? '保持已授权的 DSH 或本机面板运行，后台将独立复核。' : '当前不会自动验证这条候选，请查看经验来源并完成验证。'; }
    else if (extraction?.state === 'running') { row.status = 'extracting'; row.summary = '正在从已验证修复中提炼经验。'; row.next = '候选仍需独立来源复核，不会直接用于后续任务。'; }
    else if (extraction?.reason === 'model_unavailable') [row.summary, row.next] = explanation('model_unavailable');
    else if (job?.state === 'running') { row.status = 'verifying'; row.summary = '正在复现原始失败并检查修复与回归测试。'; row.next = '独立测试通过后再提炼，Agent 自称完成不作为验收。'; }
    else if (task?.state === 'open' || segment?.state === 'capturing') { row.status = 'recording'; row.summary = '正在记录这次请求的变化。'; row.next = segment ? '照常开发；回合结束后后台检查证据。' : '当前使用显式任务记录，由 Agent 结束任务后整理证据。'; }
    if (segment?.state === 'learned' && candidate?.status === 'candidate') paused('candidate_changed');
    if (row.status === 'needs_attention' && !row.steps.some(s => s.state === 'blocked')) { const phase = row.steps.find(s => s.state === 'active') ?? row.steps.find(s => s.state === 'pending'); if (phase) phase.state = 'blocked'; }
    output.push(row);
  };
  for (const task of tasks) project(segments.find(s => s.taskId === task.id), task.id);
  for (const segment of segments.filter(s => !s.taskId)) project(segment, null);
  return { version: 1, automatic: service.automatic.enabled,
    checks: [{ label: '允许在本机执行验证', ready: service.policy.trusted }, { label: '允许后台验证修复', ready: service.jobs.verificationEnabled },
      { label: '已配置仓库外验收目录', ready: acceptanceConfigured(service) }, { label: '允许提供经验给模型', ready: service.sharingEnabled }, { label: '已配置提炼授权', ready: !!policy && consistent }],
    quota: policy ? { limit: policy.maxCalls, used: grant?.used ?? 0, remaining: consistent ? Math.max(0, policy.maxCalls - (grant?.used ?? 0)) : 0, consistent } : null,
    tasks: output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, 12) };
}
