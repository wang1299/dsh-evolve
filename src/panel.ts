import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { EvolveService } from './service.js';
import { idSchema, redact, textSchema, feedbackSchema, RevisionConflict } from './domain.js';
import { factCitationsSchema } from './domain.js';
import { renderPanel } from './panel-view.js';

const revisionBody = z.object({ revision: z.number().int().positive(), reason: textSchema }).strict();
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); size += chunk.length;
    if (size > 32768) throw new Error('Request body exceeds 32 KiB'); chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function startPanel(service: EvolveService): Promise<{ url: string; origin: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString('hex'); let origin = '';
  const server = createServer((request, response) => { void handle(request, response); });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown): void => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.headers.host !== new URL(origin).host) { send(403, { error: 'Invalid local host' }); return; }
      const path = request.url ?? '/';
      if (path === '/' && request.method === 'GET') {
        const nonce = randomBytes(16).toString('hex');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(renderPanel(nonce)); return;
      }
      const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { send(401, { error: 'Local access token required' }); return; }
      if (request.method === 'GET' && path === '/api/state') {
        const experiences = service.store.experiences();
        const histories = Object.fromEntries(experiences.map((e) => [e.id, service.store.history(e.id)]));
        const proofIds = new Set(Object.values(histories).flatMap((items) => items.flatMap((e) => e.verificationId ? [e.verificationId] : [])));
        const evidence = service.store.evidenceRecords();
        for (const e of evidence) if (e.kind === 'verification') proofIds.add(e.verificationId);
        const provenance = Object.fromEntries(Object.entries(histories).map(([id, versions]) => [id,
          Object.fromEntries(versions.map((e) => [e.revision, { ...service.provenance(e), facts: service.facts(e) }]))]));
        const learningJobs = service.store.learning.jobs();
        send(200, { experiences, tasks: service.store.tasks(), applications: service.store.applications(), feedback: service.store.feedback(),
          automaticEnabled: service.automatic.enabled, automaticSegments: service.store.automatic.rows(),
          learningJobs, learningRecoveries: service.store.learning.recoveries(), evidenceBundles: service.store.learning.bundles(), learningAttempts: Object.fromEntries(learningJobs.map(j => [j.id, service.store.learning.attempts(j.id)])),
          extractionJobs: service.store.extraction.jobs(), extractionReauthorizations: service.store.extraction.reauthorizations(), extractionGrants: service.store.extraction.grants(),
          histories, evidence, provenance, verifications: Object.fromEntries([...proofIds].map((id) => [id, service.store.verification(id)])) }); return;
      }
      if (request.method === 'GET' && path === '/api/candidates') { send(200, service.pendingCandidates()); return; }
      if (request.method !== 'POST') { send(404, { error: 'Not found' }); return; }
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') { send(403, { error: 'Same-origin JSON required' }); return; }
      const value = await body(request);
      if (path === '/api/feedback') {
        const parsed = feedbackSchema.omit({ createdAt: true }).parse(value);
        send(200, service.feedback(parsed)); return;
      }
      if (path === '/api/cleanup') {
        z.object({}).strict().parse(value);
        send(200, service.store.cleanEvidenceWithRetention(new Date(Date.now() - 30 * 86400000).toISOString())); return;
      }
      const match = path.match(/^\/api\/experience\/([^/]+)\/(revise|disable|restore|evidence)$/);
      if (!match) { send(404, { error: 'Not found' }); return; }
      const id = idSchema.parse(match[1]); const current = service.requireExperience(id);
      const revision = z.object({ revision: z.number().int().positive() }).passthrough().parse(value).revision;
      if (revision !== current.revision) { send(409, { error: 'Experience changed; refresh before editing' }); return; }
      if (match[2] === 'revise') {
        const input = revisionBody.extend({ candidate: z.unknown(), citations: factCitationsSchema.optional() }).parse(value);
        send(200, service.revise(id, input.revision, input.candidate, input.reason, input.citations ?? []));
      } else if (match[2] === 'evidence') {
        const input = z.object({ revision: z.number().int().positive(), citations: factCitationsSchema }).strict().parse(value);
        send(200, service.linkEvidence(id, input.revision, input.citations));
      } else if (match[2] === 'restore') {
        const input = revisionBody.extend({ targetRevision: z.number().int().positive() }).parse(value);
        send(200, service.restore(id, input.targetRevision, input.reason, input.revision));
      } else {
        const input = revisionBody.parse(value); send(200, service.disable(id, input.reason, input.revision));
      }
    } catch (error) { send(error instanceof RevisionConflict ? 409 : 400, { error: redact(error instanceof Error ? error.message : 'Invalid request', 1000) }); }
  }
  await new Promise<void>((resolveStart, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveStart); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local address');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, token, url: origin + '/#token=' + token,
    close: () => new Promise<void>((resolveClose, reject) => { server.close((error) => error ? reject(error) : resolveClose()); server.closeAllConnections(); }) };
}
