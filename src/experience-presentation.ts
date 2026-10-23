import type { Application, Evidence, Experience, FactCitation, Feedback, Task, TestRun, Verification } from './domain.js';

export interface ExperiencePresentationState {
  tasks: Pick<Task, 'id' | 'summary'>[];
  applications: Pick<Application, 'id' | 'taskId' | 'experienceId' | 'revision' | 'createdAt'>[];
  feedback: Pick<Feedback, 'applicationId' | 'outcome' | 'note' | 'createdAt'>[];
  evidence?: Evidence[];
  provenance?: Record<string, Record<number, { citations: FactCitation[]; facts?: Pick<FactCitation, 'factIndex' | 'factDigest'>[]; complete?: boolean }>>;
  verifications: Record<string, Verification | null | undefined>;
}

export interface ExperiencePresentation {
  problem: string;
  problemOriginal: string;
  problemShortened: boolean;
  reminder: string | null;
  reminderSource: 'correction' | 'strategy' | 'unavailable';
  reminderLabel: string;
  original: { title: string; strategy: string };
  proof: {
    available: boolean;
    sourceVerified: boolean;
    summary: string;
    stages: { key: 'base' | 'fixed' | 'regression'; label: string; status: 'passed' | 'failed' | 'unknown' | 'missing'; text: string; detail: string }[];
  };
  usage: {
    count: number;
    summary: string;
    items: {
      id: string; taskId: string; title: string; revision: number; currentRevision: boolean;
      status: Feedback['outcome'] | 'unconfirmed'; label: string; detail: string;
    }[];
  };
}

/** Read-only wording: self-contained so the shared panel can inline its source. */
export function experiencePresentation(state: ExperiencePresentationState, experience: Experience): ExperiencePresentation {
  const hasChinese = (value: string): boolean => /[\u3400-\u9fff]/.test(value);
  const sourceTask = state.tasks.find(task => task.id === experience.sourceTaskId);
  const problemOriginal = sourceTask?.summary ?? '';
  // Only an explicitly labelled search suffix is decoration. Paths and code remain intact.
  const problem = hasChinese(problemOriginal)
    ? problemOriginal.replace(/\s*[（(](?:检索词|搜索词|关键词)[：:]\s*[A-Za-z]+(?:[ -][A-Za-z]+)*[）)]\s*$/, '').trim()
    : problemOriginal;
  const provenance = state.provenance?.[experience.id]?.[experience.revision];
  const references = provenance?.citations ?? [];
  const facts = provenance?.facts ?? [];
  const correction = (state.evidence ?? []).find(evidence => evidence.kind === 'correction'
    && evidence.taskId === experience.sourceTaskId && evidence.repoId === experience.scope.repoId
    && hasChinese(evidence.note) && references.some(reference => reference.evidenceId === evidence.id && reference.evidenceDigest === evidence.digest
      && reference.factIndex >= 0 && reference.factIndex < experience.observedFacts.length
      && facts.some(fact => fact.factIndex === reference.factIndex && fact.factDigest === reference.factDigest)));
  const reminder = correction?.kind === 'correction' ? correction.note : hasChinese(experience.strategy) ? experience.strategy : null;
  const reminderSource = correction ? 'correction' : reminder ? 'strategy' : 'unavailable';
  const reminderLabel = reminderSource === 'correction' ? '当时的明确纠正' : reminderSource === 'strategy' ? '记录的处理方法' : '尚无中文概述';

  const report = experience.verificationId ? state.verifications[experience.verificationId] : null;
  const matched = !!report && !!sourceTask && report.id === experience.verificationId
    && report.sourceTaskId === experience.sourceTaskId && report.repoId === experience.scope.repoId;
  const complete = (run: TestRun): boolean => run.tests > run.skipped && run.cases.length === run.tests
    && new Set(run.cases.map(test => test.id)).size === run.cases.length
    && run.cases.filter(test => test.status === 'failed').length === run.failures
    && run.cases.filter(test => test.status === 'error').length === run.errors
    && run.cases.filter(test => test.status === 'skipped').length === run.skipped;
  const passes = (run: TestRun): boolean => !run.timedOut && run.exitCode === 0 && complete(run) && run.failures === 0 && run.errors === 0;
  const reproduced = (run: TestRun): boolean => !run.timedOut && run.exitCode === 1 && complete(run) && run.failures > 0 && run.errors === 0;
  const fixedCases = report ? new Map(report.fixed.cases.map(test => [test.id, test.status])) : new Map<string, string>();
  const repaired = !!report && reproduced(report.base) && passes(report.fixed)
    && report.base.cases.length === report.fixed.cases.length
    && report.base.cases.every(test => fixedCases.has(test.id) && (test.status !== 'failed' || fixedCases.get(test.id) === 'passed'));
  const stages: ExperiencePresentation['proof']['stages'] = (['base', 'fixed', 'regression'] as const).map(key => {
    const label = key === 'base' ? '修复前' : key === 'fixed' ? '修复后' : '回归检查';
    if (!report) return { key, label, status: 'missing', text: '暂无测试记录', detail: '未找到这条经验关联的测试报告。' };
    const run = report[key];
    const detail = run.tests + ' 项测试，' + run.failures + ' 项失败，' + run.errors + ' 项错误，' + run.skipped + ' 项跳过。';
    if (!matched) return { key, label, status: 'unknown', text: '来源待核对', detail: detail + '来源任务缺失或报告归属不匹配。' };
    if (run.timedOut) return { key, label, status: 'unknown', text: '执行超时，结果未知', detail };
    if (run.exitCode === null) return { key, label, status: 'unknown', text: '执行未完成，结果未知', detail };
    if (run.tests <= run.skipped) return { key, label, status: 'unknown', text: run.tests ? '测试均被跳过' : '没有可用测试', detail };
    if (!complete(run)) return { key, label, status: 'unknown', text: '测试记录不完整', detail };
    const success = key === 'base' ? reproduced(run) : key === 'fixed' ? repaired : passes(run);
    if (success) {
      const text = key === 'base' ? '原问题已复现' : key === 'fixed' ? '原失败用例已通过' : '已执行的回归测试通过';
      return { key, label, status: 'passed', text: text + (run.skipped ? '（另有跳过项）' : ''), detail };
    }
    const text = key === 'base' && passes(run) ? '未复现原问题' : key === 'fixed' && passes(run) ? '原失败用例尚未对应确认' : '测试未通过';
    return { key, label, status: 'failed', text, detail };
  });
  const sourceVerified = experience.status === 'source_verified' && matched && !!report?.verified && stages.every(stage => stage.status === 'passed');
  let proofSummary = !report ? '尚无来源修复的测试依据。' : !matched ? '来源任务或测试报告归属待核对。'
    : sourceVerified ? '当时的修复通过了来源验证；后续任务仍需各自验收。' : '现有记录尚不能确认这条经验已通过来源验证。';
  if (experience.status === 'candidate') proofSummary = '这条经验仍待来源验证，暂不用于后续任务。' + (report ? '下方仅展示已有测试记录。' : '目前没有关联的测试报告。');
  if (experience.status === 'disabled') proofSummary = '这条经验已停用；已有测试只说明当时的修复，不会重新启用经验。';

  const usageItems: ExperiencePresentation['usage']['items'] = state.applications.filter(application => application.experienceId === experience.id)
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(application => {
      const feedback = state.feedback.filter(item => item.applicationId === application.id)
        .map((item, index) => ({ item, index })).sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt) || a.index - b.index).at(-1)?.item;
      const status = feedback?.outcome ?? 'unconfirmed';
      const label = status === 'accepted' ? '你记录了本次任务通过验收' : status === 'irrelevant' ? '你标记了本次任务不相关'
        : status === 'rejected' ? '你记录了所用版本策略无效' : status === 'counterexample' ? '你记录了一个反例'
          : status === 'unknown' ? '这次参考的结果尚未确认' : '已提供参考，任务结果未确认';
      return { id: application.id, taskId: application.taskId, title: state.tasks.find(task => task.id === application.taskId)?.summary ?? '后续任务记录已不可用',
        revision: application.revision, currentRevision: application.revision === experience.revision, status, label,
        detail: feedback?.note ?? '记录仅表示这条经验已提供给 Agent，不代表已采用或因它成功。' };
    });
  return {
    problem: problem || '来源问题记录已不可用', problemOriginal, problemShortened: problem !== problemOriginal,
    reminder, reminderSource, reminderLabel, original: { title: experience.title, strategy: experience.strategy },
    proof: { available: !!report, sourceVerified, summary: proofSummary, stages },
    usage: { count: usageItems.length, summary: usageItems.length ? '已向 ' + usageItems.length + ' 项后续任务提供参考，实际结果分别记录。' : '还没有向后续任务提供这条经验。', items: usageItems },
  };
}
