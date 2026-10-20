#!/usr/bin/env node
import { resolve } from 'node:path';
import { createService, loadConfig } from './config.js';
import { startPanel } from './panel.js';
import { readFile } from 'node:fs/promises';
import { evaluateExperiment } from './evaluation.js';
import { idSchema } from './domain.js';

const [command, flag, configPath] = process.argv.slice(2);
if (command === 'evaluate' && flag === '--input' && configPath) {
  const report = evaluateExperiment(JSON.parse(await readFile(resolve(configPath), 'utf8')));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else if (command === 'recover-evidence' && flag === '--config' && configPath) {
  const [taskFlag, taskId, jobFlag, jobId, ...extra] = process.argv.slice(5);
  if (taskFlag !== '--task-id' || jobFlag !== '--expected-job' || extra.length) throw new Error('Explicit task and expected job are required');
  const task = idSchema.parse(taskId); const job = idSchema.parse(jobId);
  const { service } = createService(loadConfig(resolve(configPath)));
  try {
    const recovered = service.recoverEvidence(task, job);
    process.stdout.write(JSON.stringify({ taskId: task, originalJobId: job, recoveryJobId: recovered.id, state: recovered.state, executed: false }) + '\n');
  }
  finally { service.store.close(); }
} else if (command === 'panel' && flag === '--config' && configPath) {
  const { service } = createService(loadConfig(resolve(configPath)));
  const stopWorker = service.jobs.start();
  const stopExtraction = service.extraction.start(() => null);
  const panel = await startPanel(service);
  process.stdout.write(`DSH-Evolve local panel: ${panel.url}\nKeep this URL private. Learning data stays on this computer.\n`);
  const stop = (): void => { void panel.close().then(() => Promise.all([stopWorker(), stopExtraction()])).then(() => { service.store.close(); process.exitCode = 0; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} else {
  process.stderr.write('Usage: dsh-evolve panel --config <local-config.json> | evaluate --input <results.json> | recover-evidence --config <local-config.json> --task-id <id> --expected-job <id>\n'); process.exitCode = 1;
}
