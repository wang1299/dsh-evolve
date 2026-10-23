import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';

test('shipped bundle inserts its plugin into the official empty profile composition', () => {
  const patches = loadOverlayPatches('dsh', resolve('cordis.patch.yml'));
  const entries = composeEntries([patches]);
  assert.equal(entries.filter((entry) => entry.id === 'dsh-evolve' && entry.name === 'dsh-reforge').length, 1);
});
