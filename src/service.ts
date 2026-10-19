import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { applicability, snapshot } from './repository.js';
import { candidateSchema, digest, feedbackSchema, idSchema, redact, textSchema, RevisionConflict,
  type Application, type Candidate, type Evidence, type Experience, type Feedback, type Scope, type Task } from './domain.js';
import { verifyRepair, type VerificationPolicy } from './verification.js';
import { rankText, retrievalPolicy } from './retrieval.js';
import { contextKey, feedbackMemory, rankFeedback, type ContextEvidence } from './feedback-retrieval.js';
import { correctionEvidence, factProvenance, validateCitations, verificationEvidence } from './evidence.js';
import { EvidenceJobs } from './evidence-jobs.js';

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
  readonly jobs: EvidenceJobs;
  private readonly repoId: string;
  constructor(readonly store: Store, readonly root: string, readonly policy: VerificationPolicy, backgroundVerification = false) {
    this.jobs = new EvidenceJobs(store, root, policy, backgroundVerification);
    this.repoId = snapshot(root).scope.repoId;
  }
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
    const task = this.requireTask(id); if (task.state === 'closed') return task;
    const closed = { ...task, state: 'closed' as const };
    return this.store.transaction(() => { this.store.putTask(closed); this.jobs.enqueue(closed); return closed; });
  }
  observe(sessionId: string, eventId: string, kind: string, name?: string): void {
    const tasks = this.store.tasks().filter((t) => t.sessionId === sessionId && t.state === 'open');
    if (tasks.length !== 1) return; const task = tasks[0]!;
    if (task.scope.repoId !== this.repoId) return;
    this.store.event(redact(eventId, 200), task.id, new Date().toISOString(), {
      kind: redact(kind, 60), ...(name ? { tool: redact(name, 100) } : {}),
    });
  }
  correction(taskId: string, note: string): Evidence {
    const task = this.requireTask(taskId); if (task.state !== 'open') throw new Error('Task is closed');
    const evidence = correctionEvidence(task, redact(textSchema.parse(note)));
    this.store.transaction(() => {
      this.store.putEvidence(evidence);
      this.store.event(evidence.id, task.id, evidence.createdAt, { kind: 'explicit_correction', evidenceId: evidence.id });
    });
    return evidence;
  }
  propose(taskId: string, input: unknown, inputCitations: unknown = []): Experience {
    const task = this.requireTask(taskId); const item = cleanCandidate(input);
    const current = snapshot(this.root, item.requiredFiles);
    const result: Experience = {
      schemaVersion: 1, id: randomUUID(), revision: 1, sourceTaskId: task.id,
      title: item.title, strategy: item.strategy, observedFacts: item.observedFacts,
      inferences: item.inferences, recommendations: item.recommendations, scope: current.scope,
      status: 'candidate', verificationId: null, reason: 'Proposed; source evidence not verified', createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => this.store.putExperience(result, validateCitations(this.store, result, inputCitations)));
    return result;
  }
  facts(experience: Experience): { factIndex: number; factDigest: string }[] {
    return experience.observedFacts.map((fact, factIndex) => ({ factIndex, factDigest: digest(fact) }));
  }
  provenance(experience: Experience): ReturnType<typeof factProvenance> { return factProvenance(this.store, experience); }
  linkEvidence(id: string, expectedRevision: number, input: unknown): Experience {
    return this.store.transaction(() => {
      const old = this.requireExperience(id);
      if (old.revision !== expectedRevision) throw new RevisionConflict();
      const citations = validateCitations(this.store, old, input);
      const normalized = (items: typeof citations): string => JSON.stringify([...items].sort((a, b) => a.factIndex - b.factIndex || a.evidenceId.localeCompare(b.evidenceId)));
      if (normalized(citations) === normalized(this.store.citations(id, old.revision))) return old;
      if (old.status === 'source_verified' && this.provenance(old).complete) {
        throw new Error('Sources are locked for a verified experience with complete provenance; the owner must explicitly revise before changing sources');
      }
      const next: Experience = { ...old, revision: old.revision + 1,
        reason: 'Source references updated; citations do not certify claim semantics', createdAt: new Date().toISOString() };
      this.store.putExperience(next, citations); return next;
    });
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
      const citations = validateCitations(this.store, experience, this.store.citations(experienceId, revision));
      this.store.putVerification(report);
      this.store.putEvidence(verificationEvidence(report));
      const result: Experience = { ...experience, revision: revision + 1, verificationId: report.id,
        status: report.verified ? 'source_verified' : 'candidate', reason: report.reason, createdAt: new Date().toISOString() };
      this.store.putExperience(result, citations); return result;
    });
  }
  requireExperience(id: string): Experience {
    const value = this.store.experience(idSchema.parse(id)); if (!value) throw new Error('Unknown experience'); return value;
  }
  select(taskId: string, mode: 'evidence-v1' | 'feedback-v1' | 'bm25-v1' = 'evidence-v1'): { application: Application | null; experience: Experience | null; reasons: string[] } {
    z.enum(['evidence-v1', 'feedback-v1', 'bm25-v1']).parse(mode);
    const task = this.requireTask(taskId); if (task.state !== 'open') throw new Error('Task is closed');
    if (this.store.applications().some((a) => a.taskId === task.id)) return { application: null, experience: null, reasons: ['already_applied_one_experience'] };
    const reasons: string[] = [];
    const eligible = new Map<string, { experience: Experience; scope: Scope }>();
    const ranked: { experience: Experience; score: number; textScore: number; utility: number; anchors: number; scope: Scope; evidence?: ContextEvidence }[] = [];
    for (const experience of this.store.experiences()) {
      if (experience.sourceTaskId === task.id) { reasons.push(experience.id + ':source_task'); continue; }
      if (experience.status !== 'source_verified') { reasons.push(experience.id + ':' + experience.status); continue; }
      const proof = experience.verificationId ? this.store.verification(experience.verificationId) : null;
      if (!proof?.verified || proof.sourceTaskId !== experience.sourceTaskId || proof.repoId !== experience.scope.repoId) {
        reasons.push(experience.id + ':missing_or_invalid_source_evidence'); continue;
      }
      if (mode === 'evidence-v1') {
        const provenance = this.provenance(experience);
        if (!provenance.complete) { reasons.push(experience.id + ':incomplete_fact_sources:' + provenance.reasons.join(',')); continue; }
      }
      let current;
      try { current = snapshot(this.root, Object.keys(experience.scope.requiredFiles)); }
      catch { reasons.push(experience.id + ':missing_code_condition'); continue; }
      const mismatch = applicability(experience.scope, current.scope);
      if (mismatch) { reasons.push(experience.id + ':' + mismatch); continue; }
      eligible.set(experience.id, { experience, scope: current.scope });
    }
    const memory = mode !== 'bm25-v1' ? feedbackMemory(this.store, [...eligible.values()].map((e) => e.experience)) : new Map();
    for (const [id] of eligible) {
      const negative = memory.get(id)?.irrelevant.get(contextKey(task.summary));
      if (negative) { eligible.delete(id); reasons.push(`${id}:owner_irrelevant_context; feedback=${negative.feedbackId}; application=${negative.applicationId}; task=${negative.taskId}`); }
    }
    const experiences = [...eligible.values()].map((e) => e.experience);
    const original = rankText(task.summary, experiences);
    for (const m of original) if (m.reason) reasons.push(m.id + ':' + m.reason);
    const originalMatches = original.filter((m) => m.reason === null);
    const matches: { id: string; score: number; anchors: number; evidence?: ContextEvidence }[] = originalMatches.length || mode === 'bm25-v1'
      ? originalMatches : rankFeedback(task.summary, experiences, memory);
    for (const match of matches) {
      const { experience, scope } = eligible.get(match.id)!;
      const uses = new Set(this.store.applications().filter((a) => a.experienceId === experience.id && a.revision === experience.revision).map((a) => a.id));
      const latest = new Map<string, Feedback>();
      for (const feedback of this.store.feedback()) if (uses.has(feedback.applicationId) && feedback.outcome !== 'unknown') latest.set(feedback.applicationId, feedback);
      const feedback = [...latest.values()].filter((f) => f.outcome !== 'irrelevant');
      const utility = (feedback.filter((f) => f.outcome === 'accepted').length + 1) / (feedback.length + 2);
      ranked.push({ experience, score: 0.7 * match.score + 0.3 * utility, textScore: match.score, utility, anchors: match.anchors, scope,
        ...(match.evidence ? { evidence: match.evidence } : {}) });
    }
    ranked.sort((a, b) => b.score - a.score || a.experience.id.localeCompare(b.experience.id));
    const selected = ranked[0];
    if (!selected) return { application: null, experience: null, reasons: reasons.length ? reasons : ['no_experiences'] };
    const application: Application = { id: randomUUID(), taskId: task.id, experienceId: selected.experience.id,
      revision: selected.experience.revision, reason: `Applicable code/dependency scope; ${mode}${mode === 'evidence-v1' ? ':complete_fact_sources; feedback-v1' : ''}; text=${retrievalPolicy.version}:${selected.textScore.toFixed(3)}; utility=${selected.utility.toFixed(3)}; anchors=${selected.anchors}; combined=${selected.score.toFixed(3)}`
        + (selected.evidence ? `; fallback_owner_accepted_inference; feedback=${selected.evidence.feedbackId}; application=${selected.evidence.applicationId}; task=${selected.evidence.taskId}` : '; original_text'), createdAt: new Date().toISOString() };
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
  revise(id: string, expectedRevision: number, input: unknown, reason: string, inputCitations: unknown = []): Experience {
    const previous = this.requireExperience(id);
    if (previous.revision !== expectedRevision) throw new RevisionConflict();
    const item = cleanCandidate(input);
    const current = snapshot(this.root, item.requiredFiles);
    const result: Experience = { ...previous, ...item, scope: current.scope,
      revision: previous.revision + 1, status: 'candidate', verificationId: null,
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    // Candidate input's requiredFiles is an input selector, not an extra persisted experience property.
    const { requiredFiles: _selectors, ...persisted } = result as Experience & { requiredFiles?: string[] };
    this.store.transaction(() => this.store.putExperience(persisted, validateCitations(this.store, persisted, inputCitations)));
    return persisted;
  }
  disable(id: string, reason: string, expectedRevision?: number): Experience {
    return this.store.transaction(() => {
    const previous = this.requireExperience(id);
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw new RevisionConflict();
    const next: Experience = { ...previous, revision: previous.revision + 1, status: 'disabled',
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    this.store.putExperience(next, this.store.citations(id, previous.revision)); return next;
    });
  }
  restore(id: string, revision: number, reason: string, expectedRevision?: number): Experience {
    return this.store.transaction(() => {
    const previous = this.requireExperience(id); const old = this.store.history(id).find((r) => r.revision === revision);
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw new RevisionConflict();
    if (!old) throw new Error('Unknown historical revision');
    const next: Experience = { ...old, revision: previous.revision + 1, status: 'candidate', verificationId: null,
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    this.store.putExperience(next, validateCitations(this.store, next, this.store.citations(id, old.revision))); return next;
    });
  }
}
