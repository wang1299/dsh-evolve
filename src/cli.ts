#!/usr/bin/env node
import { resolve } from 'node:path';
import { createService, loadConfig } from './config.js';
import { startPanel } from './panel.js';

const [command, flag, configPath] = process.argv.slice(2);
if (command !== 'panel' || flag !== '--config' || !configPath) {
  process.stderr.write('Usage: dsh-evolve panel --config <local-config.json>\n'); process.exitCode = 1;
} else {
  const { service } = createService(loadConfig(resolve(configPath)));
  const panel = await startPanel(service);
  process.stdout.write(`DSH-Evolve local panel: ${panel.url}\nKeep this URL private. Learning data stays on this computer.\n`);
  const stop = (): void => { void panel.close().then(() => { service.store.close(); process.exitCode = 0; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
