import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { applicability, snapshot } from './repository.js';
import { candidateSchema, feedbackSchema, idSchema, redact, textSchema,
  type Application, type Candidate, type Experience, type Feedback, type Scope, type Task } from './domain.js';
import { verifyRepair, type VerificationPolicy } from './verification.js';

function cleanCandidate(value: unknown): Candidate {
  const item = candidateSchema.parse(value);
  return { ...item, title: redact(item.title, 160), strategy: redact(item.strategy),
    observedFacts: item.observedFacts.map((s) => redact(s)), inferences: item.inferences.map((s) => redact(s)),
    recommendations: item.recommendations.map((s) => redact(s)) };
}
export function similarity(query: string, text: string): number {
  const tokens = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) ?? []);
  const q = tokens(query); const t = tokens(text);
  if (!q.size) return 0;
  return [...q].filter((word) => t.has(word)).length / q.size;
}
export class EvolveService {
  constructor(readonly store: Store, readonly root: string, readonly policy: VerificationPolicy) {}
  begin(sessionId: string, summary: string): Task {
    z.string().min(1).max(128).parse(sessionId); textSchema.parse(summary);
    if (this.store.tasks().some((t) => t.sessionId === sessionId && t.state === 'open')) throw new Error('Session already has an open task');
    const current = snapshot(this.root);
    const task: Task = { schemaVersion: 1, id: randomUUID(), sessionId, summary: redact(summary),
      scope: current.scope, baseCommit: current.commit, state: 'open', createdAt: new Date().toISOString() };
    this.store.putTask(task); return task;
  }
  requireTask(id: string, sessionId?: string): Task {
    const task = this.store.task(idSchema.parse(id));
    if (!task) throw new Error('Unknown task');
    if (sessionId !== undefined && task.sessionId !== sessionId) throw new Error('Task belongs to a different session');
    if (task.scope.repoId !== snapshot(this.root).scope.repoId) throw new Error('Task belongs to a different repository');
    return task;
  }
  finish(id: string): Task {
    const task = this.requireTask(id); const closed = { ...task, state: 'closed' as const };
    this.store.putTask(closed); return closed;
  }
  observe(sessionId: string, eventId: string, kind: string, name?: string): void {
    const task = this.store.tasks().find((t) => t.sessionId === sessionId && t.state === 'open');
    if (!task) return;
    this.store.event(redact(eventId, 200), task.id, new Date().toISOString(), {
      kind: redact(kind, 60), ...(name ? { tool: redact(name, 100) } : {}),
    });
  }
  correction(taskId: string, note: string): void {
    const task = this.requireTask(taskId); if (task.state !== 'open') throw new Error('Task is closed');
    this.store.event(randomUUID(), task.id, new Date().toISOString(), { kind: 'explicit_correction', note: redact(textSchema.parse(note)) });
  }
  propose(taskId: string, input: unknown): Experience {
    const task = this.requireTask(taskId); const item = cleanCandidate(input);
    const current = snapshot(this.root, item.requiredFiles);
    const result: Experience = {
      schemaVersion: 1, id: randomUUID(), revision: 1, sourceTaskId: task.id,
      title: item.title, strategy: item.strategy, observedFacts: item.observedFacts,
      inferences: item.inferences, recommendations: item.recommendations, scope: current.scope,
      status: 'candidate', verificationId: null, reason: 'Proposed; source evidence not verified', createdAt: new Date().toISOString(),
    };
    this.store.putExperience(result); return result;
  }
  async verify(experienceId: string, signal?: AbortSignal): Promise<Experience> {
    const experience = this.requireExperience(experienceId); const revision = experience.revision;
    const task = this.requireTask(experience.sourceTaskId);
    if (experience.status === 'disabled') throw new Error('Disabled experience must be revised before verification');
    const current = snapshot(this.root, Object.keys(experience.scope.requiredFiles));
    if (applicability(experience.scope, current.scope)) throw new Error('Candidate scope changed; revise before verification');
    const report = await verifyRepair(this.root, task.id, task.baseCommit, current.commit, this.policy, signal);
    return this.store.transaction(() => {
      if (this.requireExperience(experienceId).revision !== revision) throw new Error('Experience changed during verification');
      this.store.putVerification(report);
      const result: Experience = { ...experience, revision: revision + 1, verificationId: report.id,
        status: report.verified ? 'source_verified' : 'candidate', reason: report.reason, createdAt: new Date().toISOString() };
      this.store.putExperience(result); return result;
    });
  }
  requireExperience(id: string): Experience {
    const value = this.store.experience(idSchema.parse(id)); if (!value) throw new Error('Unknown experience'); return value;
  }
  select(taskId: string): { application: Application | null; experience: Experience | null; reasons: string[] } {
    const task = this.requireTask(taskId); if (task.state !== 'open') throw new Error('Task is closed');
    if (this.store.applications().some((a) => a.taskId === task.id)) return { application: null, experience: null, reasons: ['already_applied_one_experience'] };
    const reasons: string[] = [];
    const ranked: { experience: Experience; score: number; scope: Scope }[] = [];
    for (const experience of this.store.experiences()) {
      if (experience.sourceTaskId === task.id) { reasons.push(experience.id + ':source_task'); continue; }
      if (experience.status !== 'source_verified') { reasons.push(experience.id + ':' + experience.status); continue; }
      let current;
      try { current = snapshot(this.root, Object.keys(experience.scope.requiredFiles)); }
      catch { reasons.push(experience.id + ':missing_code_condition'); continue; }
      const mismatch = applicability(experience.scope, current.scope);
      if (mismatch) { reasons.push(experience.id + ':' + mismatch); continue; }
      const match = similarity(task.summary, experience.title + ' ' + experience.strategy);
      if (match < 0.15) { reasons.push(experience.id + ':low_similarity'); continue; }
      const uses = new Set(this.store.applications().filter((a) => a.experienceId === experience.id && a.revision === experience.revision).map((a) => a.id));
      const latest = new Map<string, Feedback>();
      for (const feedback of this.store.feedback()) if (uses.has(feedback.applicationId) && feedback.outcome !== 'unknown') latest.set(feedback.applicationId, feedback);
      const feedback = [...latest.values()];
      const utility = (feedback.filter((f) => f.outcome === 'accepted').length + 1) / (feedback.length + 2);
      ranked.push({ experience, score: 0.7 * match + 0.3 * utility, scope: current.scope });
    }
    ranked.sort((a, b) => b.score - a.score || a.experience.id.localeCompare(b.experience.id));
    const selected = ranked[0];
    if (!selected) return { application: null, experience: null, reasons: reasons.length ? reasons : ['no_experiences'] };
    const application: Application = { id: randomUUID(), taskId: task.id, experienceId: selected.experience.id,
      revision: selected.experience.revision, reason: `Applicable code/dependency scope; similarity/utility score=${selected.score.toFixed(3)}`, createdAt: new Date().toISOString() };
    this.store.putApplication(application);
    return { application, experience: selected.experience, reasons: [application.reason] };
  }
  feedback(input: Omit<Feedback, 'createdAt'>): Feedback {
    const existing = this.store.feedback().find((f) => f.id === input.id);
    const value = feedbackSchema.parse({ ...input, note: redact(input.note), createdAt: existing?.createdAt ?? new Date().toISOString() });
    const application = this.store.application(value.applicationId); if (!application) throw new Error('Unknown application');
    this.requireTask(application.taskId);
    return this.store.transaction(() => {
      const inserted = this.store.putFeedback(value);
      const current = this.requireExperience(application.experienceId);
      if (inserted && application.revision === current.revision && (value.outcome === 'rejected' || value.outcome === 'counterexample')) this.disable(application.experienceId, value.note);
      return value;
    });
  }
  revise(id: string, expectedRevision: number, input: unknown, reason: string): Experience {
    const previous = this.requireExperience(id);
    if (previous.revision !== expectedRevision) throw new Error('Stale experience revision');
    const item = cleanCandidate(input);
    const current = snapshot(this.root, item.requiredFiles);
    const result: Experience = { ...previous, ...item, scope: current.scope,
      revision: previous.revision + 1, status: 'candidate', verificationId: null,
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    // Candidate input's requiredFiles is an input selector, not an extra persisted experience property.
    const { requiredFiles: _selectors, ...persisted } = result as Experience & { requiredFiles?: string[] };
    this.store.putExperience(persisted); return persisted;
  }
  disable(id: string, reason: string): Experience {
    const previous = this.requireExperience(id);
    const next: Experience = { ...previous, revision: previous.revision + 1, status: 'disabled',
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    this.store.putExperience(next); return next;
  }
  restore(id: string, revision: number, reason: string): Experience {
    const previous = this.requireExperience(id); const old = this.store.history(id).find((r) => r.revision === revision);
    if (!old) throw new Error('Unknown historical revision');
    const next: Experience = { ...old, revision: previous.revision + 1, status: 'candidate', verificationId: null,
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    this.store.putExperience(next); return next;
  }
}
