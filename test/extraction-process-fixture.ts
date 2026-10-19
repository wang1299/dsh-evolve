import { existsSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { digest } from '../src/domain.js';

const [path, jobId, barrier] = process.argv.slice(2) as [string, string, string];
const store = new Store(path);
try {
  for (let i = 0; !existsSync(barrier); i++) { if (i >= 3000) throw new Error('Fixture barrier timeout'); await pause(5); }
  const job = store.extraction.claim(jobId, digest('synthetic extraction input'), Date.now());
  process.stdout.write(JSON.stringify({ id: job?.id ?? null }));
} finally { store.close(); }
