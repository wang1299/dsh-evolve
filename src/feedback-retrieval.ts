import { digest, type Experience } from './domain.js';
import { rankText } from './retrieval.js';
import type { Store } from './store.js';

export const feedbackRetrievalPolicy = { version: 'feedback-v1', maxAliases: 8,
  context: 'NFKC/lowercase/collapse-whitespace/v1', fallback: 'only-if-all-original-documents-abstain',
  feedback: 'latest-nonunknown-per-normalized-context/current-revision/same-repo/non-source-task' } as const;
export function contextKey(summary: string): string {
  return digest(summary.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '));
}
export interface ContextEvidence { summary: string; taskId: string; applicationId: string; feedbackId: string }
export interface FeedbackMemory { accepted: ContextEvidence[]; irrelevant: Map<string, ContextEvidence> }

/** Derived from bounded task records already stored locally; append order, not claimed timestamps, wins. */
export function feedbackMemory(store: Store, experiences: Experience[]): Map<string, FeedbackMemory> {
  const current = new Map(experiences.map((e) => [e.id, e]));
  const applications = new Map(store.applications().map((a) => [a.id, a]));
  const tasks = new Map(store.tasks().map((t) => [t.id, t]));
  const contexts = new Map<string, Map<string, { evidence: ContextEvidence; outcome: string }>>();
  for (const f of store.feedback()) {
    if (f.outcome === 'unknown') continue;
    const app = applications.get(f.applicationId); const e = app ? current.get(app.experienceId) : null;
    const task = app ? tasks.get(app.taskId) : null;
    if (!app || !e || !task || app.revision !== e.revision || task.id === e.sourceTaskId || task.scope.repoId !== e.scope.repoId) continue;
    const key = contextKey(task.summary); const byContext = contexts.get(e.id) ?? new Map();
    byContext.delete(key); // Keep the latest observation last even when a context is corrected.
    byContext.set(key, { outcome: f.outcome, evidence: { summary: task.summary, taskId: task.id, applicationId: app.id, feedbackId: f.id } });
    contexts.set(e.id, byContext);
  }
  return new Map(experiences.map((e) => {
    const entries = [...(contexts.get(e.id)?.entries() ?? [])];
    return [e.id, { accepted: entries.filter(([, c]) => c.outcome === 'accepted').map(([, c]) => c.evidence).slice(-feedbackRetrievalPolicy.maxAliases),
      irrelevant: new Map(entries.filter(([, c]) => c.outcome === 'irrelevant').map(([key, c]) => [key, c.evidence])) }];
  }));
}

/** Called only when the original eligible documents all abstain. Each match retains its precise source. */
export function rankFeedback(query: string, experiences: Experience[], memory: Map<string, FeedbackMemory>): {
  id: string; score: number; anchors: number; evidence: ContextEvidence;
}[] {
  const evidence = new Map<string, { id: string; context: ContextEvidence }>();
  const documents = experiences.flatMap((e) => (memory.get(e.id)?.accepted ?? []).map((c) => {
    const id = e.id + ':' + c.applicationId; evidence.set(id, { id: e.id, context: c });
    return { id, title: c.summary, strategy: e.strategy };
  }));
  const matches = new Map<string, { id: string; score: number; anchors: number; evidence: ContextEvidence }>();
  for (const m of rankText(query, documents)) {
    if (m.reason !== null) continue;
    const source = evidence.get(m.id)!;
    if (!matches.has(source.id)) matches.set(source.id, { id: source.id, score: m.score, anchors: m.anchors, evidence: source.context });
  }
  return [...matches.values()];
}
