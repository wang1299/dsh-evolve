import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { citeFact, fixture } from '../test/fixture.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';

const target = await fixture();
const outputDir = resolve('.probe-work', 'demo-' + Date.now()); await mkdir(outputDir, { recursive: true });
const dataDir = join(outputDir, 'data'); const store = new Store(join(dataDir, 'evolve.sqlite'));
const service = new EvolveService(store, target.repo, {
  trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: target.acceptance, regressionPath: 'tests', timeoutMs: 15000,
});
try {
  const source = service.begin('synthetic-source', 'database transaction rollback on exception');
  const correction = service.correction(source.id, 'Restore the original balance when a transaction fails.');
  const fixCommit = await target.fix();
  const candidate = service.propose(source.id, {
    title: 'database transaction rollback on exception',
    strategy: 'Capture prior state, restore it on exceptions, then re-raise. Verify error and success paths.',
    observedFacts: ['The recorded correction asks to restore the original balance when a transaction fails.'],
    inferences: ['A similar mutation may need equivalent rollback.'], recommendations: ['Check transaction error paths with independent acceptance tests.'],
    requiredFiles: ['contract.py'],
  }, [citeFact(correction, 'The recorded correction asks to restore the original balance when a transaction fails.')]);
  const verified = await service.verify(candidate.id);
  if (verified.status !== 'source_verified') throw new Error('Synthetic repair did not verify');
  service.finish(source.id);
  const similar = service.begin('synthetic-next', 'database transaction rollback exception');
  const selection = service.select(similar.id);
  if (!selection.application || selection.experience?.id !== verified.id) throw new Error('Scoped experience was not provided');
  service.feedback({ id: randomUUID(), applicationId: selection.application.id, outcome: 'unknown', note: 'Context offered; no Agent outcome claimed.', extraCost: null, humanRework: null });
  const disabled = service.disable(verified.id, 'Synthetic owner counterexample demonstrates stopping reuse');
  service.finish(similar.id);
  const report = store.verification(verified.verificationId!);
  await writeFile(join(outputDir, 'evidence.json'), JSON.stringify({
    kind: 'synthetic-integration-only', actualAgentBenefit: 'not_evaluated',
    sourceTaskId: source.id, nextTaskId: similar.id, experienceId: verified.id,
    baseCommit: source.baseCommit, fixCommit, verification: report,
    application: selection.application, feedback: store.feedback(), finalStatus: disabled.status,
  }, null, 2));
  await writeFile(join(outputDir, 'config.json'), JSON.stringify({
    repoRoot: target.repo, dataDir, executionTrusted: true, shareWithModel: false,
    acceptanceDir: target.acceptance, python: process.env.EVOLVE_PYTHON ?? 'python', regressionPath: 'tests', timeoutMs: 15000,
  }, null, 2));
  process.stdout.write(`Synthetic Git/pytest integration passed: base ${report?.base.failures} failure, fixed and regression passed.\n`);
  process.stdout.write(`Context was offered to a second task; no model executed and no benefit is claimed.\nEvidence and panel config: ${outputDir}\n`);
} finally { store.close(); }
