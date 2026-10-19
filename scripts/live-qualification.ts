import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../src/domain.js';

type QualifiedPlan = { frozenFiles: Record<string, string> };
export function freezeFiles(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, digest(readFileSync(path))]));
}
export function validateQualification(work: string, plan: QualifiedPlan): void {
  if (digest(JSON.stringify(plan)) !== readFileSync(join(work, 'plan-digest.txt'), 'utf8')) throw new Error('Plan drift');
  if (!Object.keys(plan.frozenFiles).length) throw new Error('Missing frozen installation/configuration evidence');
  for (const [path, hash] of Object.entries(plan.frozenFiles)) {
    if (digest(readFileSync(path)) !== hash) throw new Error('Frozen installation/configuration drift');
  }
}
export function consumeQualification(work: string, plan: QualifiedPlan): void {
  validateQualification(work, plan);
  writeFileSync(join(work, 'live-once.json'), JSON.stringify({ startedAt: new Date().toISOString(),
    planDigest: digest(JSON.stringify(plan)) }), { flag: 'wx' });
}
