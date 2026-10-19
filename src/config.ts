import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { snapshot } from './repository.js';
import { Store } from './store.js';
import { EvolveService } from './service.js';
import { extractionPolicySchema } from './extraction-domain.js';

export const configSchema = z.object({
  repoRoot: z.string().min(1), dataDir: z.string().min(1).optional(),
  executionTrusted: z.boolean().default(false), shareWithModel: z.boolean().default(false),
  backgroundVerification: z.boolean().default(false),
  extraction: extractionPolicySchema.optional(),
  acceptanceDir: z.string().min(1).optional(), python: z.string().min(1).default('python'),
  regressionPath: z.string().min(1).default('tests'), timeoutMs: z.number().int().min(100).max(120000).default(15000),
}).strict();
export type Config = z.input<typeof configSchema>;
export function loadConfig(path: string): Config { return configSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
export function createService(input: Config): { service: EvolveService; config: z.output<typeof configSchema> } {
  const config = configSchema.parse(input); const repoRoot = resolve(config.repoRoot);
  const current = snapshot(repoRoot);
  const dataDir = config.dataDir ? resolve(config.dataDir) : join(homedir(), '.dsh', 'evolve', current.scope.repoId);
  const store = new Store(join(dataDir, 'evolve.sqlite'));
  const service = new EvolveService(store, repoRoot, {
    trusted: config.executionTrusted, python: config.python,
    acceptanceDir: config.acceptanceDir ? resolve(config.acceptanceDir) : join(dataDir, 'acceptance-not-configured'),
    regressionPath: config.regressionPath, timeoutMs: config.timeoutMs,
  }, config.backgroundVerification, config.extraction);
  return { service, config };
}
