import { existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { Store } from '../src/store.js';

const [path, repoId, barrier] = process.argv.slice(2) as [string, string, string];
const store = new Store(path);
try {
  const deadline = Date.now() + 10000;
  while (!existsSync(barrier)) { if (Date.now() > deadline) throw new Error('Fixture barrier timeout'); await setTimeout(10); }
  const job = store.learning.claim(repoId, Date.now(), 30000);
  process.stdout.write(JSON.stringify({ id: job?.id ?? null }) + '\n');
} finally { store.close(); }
