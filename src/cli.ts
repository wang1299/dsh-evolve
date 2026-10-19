#!/usr/bin/env node
import { resolve } from 'node:path';
import { createService, loadConfig } from './config.js';
import { startPanel } from './panel.js';
import { readFile } from 'node:fs/promises';
import { evaluateExperiment } from './evaluation.js';

const [command, flag, configPath] = process.argv.slice(2);
if (command === 'evaluate' && flag === '--input' && configPath) {
  const report = evaluateExperiment(JSON.parse(await readFile(resolve(configPath), 'utf8')));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else if (command === 'panel' && flag === '--config' && configPath) {
  const { service } = createService(loadConfig(resolve(configPath)));
  const stopWorker = service.jobs.start();
  const panel = await startPanel(service);
  process.stdout.write(`DSH-Evolve local panel: ${panel.url}\nKeep this URL private. Learning data stays on this computer.\n`);
  const stop = (): void => { void panel.close().then(stopWorker).then(() => { service.store.close(); process.exitCode = 0; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} else {
  process.stderr.write('Usage: dsh-evolve panel --config <local-config.json> | evaluate --input <results.json>\n'); process.exitCode = 1;
}
