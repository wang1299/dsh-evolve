import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { acceptanceDigest } from '../src/verification.js';

type QualifiedPlan = { frozenFiles: Record<string, string>; acceptanceDigests: Record<string, string> };
export function freezeFiles(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, digest(readFileSync(path))]));
}
export async function validateAcceptance(plan: Pick<QualifiedPlan, 'acceptanceDigests'>): Promise<void> {
  if (!Object.keys(plan.acceptanceDigests).length) throw new Error('Missing frozen acceptance evidence');
  for (const [root, hash] of Object.entries(plan.acceptanceDigests)) {
    if (await acceptanceDigest(root) !== hash) throw new Error('Acceptance file-set drift');
  }
}
export async function validateQualification(work: string, plan: QualifiedPlan): Promise<void> {
  if (digest(JSON.stringify(plan)) !== readFileSync(join(work, 'plan-digest.txt'), 'utf8')) throw new Error('Plan drift');
  if (!Object.keys(plan.frozenFiles).length) throw new Error('Missing frozen installation/configuration evidence');
  for (const [path, hash] of Object.entries(plan.frozenFiles)) {
    if (digest(readFileSync(path)) !== hash) throw new Error('Frozen installation/configuration drift');
  }
  await validateAcceptance(plan);
}
export async function consumeQualification(work: string, plan: QualifiedPlan): Promise<void> {
  await validateQualification(work, plan);
  writeFileSync(join(work, 'live-once.json'), JSON.stringify({ startedAt: new Date().toISOString(),
    planDigest: digest(JSON.stringify(plan)) }), { flag: 'wx' });
}
