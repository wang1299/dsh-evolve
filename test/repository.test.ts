import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { snapshot } from '../src/repository.js';
import { fixture } from './fixture.js';

test('repository identity accepts Windows short aliases while rejecting a repository subdirectory', async () => {
  const f = await fixture();
  assert.throws(() => snapshot(join(f.repo, 'tests')), /exact Git repository root/);
  if (process.platform !== 'win32') return;
  const alias = execFileSync(process.env.EVOLVE_PYTHON ?? 'python', ['-c',
    'import ctypes,sys; b=ctypes.create_unicode_buffer(32768); n=ctypes.windll.kernel32.GetShortPathNameW(sys.argv[1],b,len(b)); assert n>0; print(b.value)', f.repo],
  { encoding: 'utf8', windowsHide: true }).trim();
  assert.deepEqual(snapshot(alias), snapshot(f.repo));
});
