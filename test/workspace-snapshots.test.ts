import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { git } from '../src/repository.js';
import { WorkspaceSnapshots } from '../src/workspace-snapshots.js';
import { verifyWorkspaceRepair } from '../src/verification.js';

test('private snapshots reproduce an uncommitted repair without touching user HEAD, index or files', async () => {
  const f = await fixture(); const snapshots = new WorkspaceSnapshots(join(f.home, 'snapshots.git'), f.repo);
  const base = snapshots.capture(); const index = await readFile(join(f.repo, '.git', 'index'));
  const original = await readFile(join(f.repo, 'ledger.py'), 'utf8');
  const corrected = original.replace('        raise ValueError', '        state["balance"] = before\n        raise ValueError');
  await writeFile(join(f.repo, 'ledger.py'), corrected); const fixed = snapshots.capture(base.commit);
  const report = await verifyWorkspaceRepair(f.repo, crypto.randomUUID(), base, fixed, snapshots, {
    trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000,
  });
  assert.equal(report.verified, true); assert.equal(report.base.failures, 1); assert.equal(report.fixed.failures, 0);
  assert.equal(report.environment.captureMethod, 'tracked-python-snapshot-v1'); assert.equal(report.environment.repositoryHead, f.base);
  assert.deepEqual(await readFile(join(f.repo, '.git', 'index')), index); assert.equal(git(f.repo, ['rev-parse', 'HEAD']), f.base);
  assert.equal(await readFile(join(f.repo, 'ledger.py'), 'utf8'), corrected);
  assert.equal(snapshots.capture(fixed.commit).commit, fixed.commit, 'identical snapshots do not manufacture a new repair');
  await writeFile(join(f.repo, 'ledger.py'), corrected + '\n# later change\n'); assert.equal(snapshots.matches(fixed), false);
  await assert.rejects(verifyWorkspaceRepair(f.repo, crypto.randomUUID(), base, fixed, snapshots, {
    trusted: true, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000,
  }), /changed/i);
});

test('snapshot capture refuses uncovered changes, untracked Python and secret-bearing ignored files', async () => {
  const f = await fixture(); const snapshots = new WorkspaceSnapshots(join(f.home, 'snapshots.git'), f.repo);
  await writeFile(join(f.repo, 'new.py'), 'PRIVATE_UNTRACKED_TEXT'); assert.throws(() => snapshots.capture(), /untracked/i);
  await writeFile(join(f.repo, '.gitignore'), 'new.py\nprivate.py\n');
  await writeFile(join(f.repo, 'private.py'), 'PRIVATE_IGNORED_TEXT');
  const captured = snapshots.capture(); assert.ok(!snapshots.paths(captured.commit).includes('private.py'));
  await writeFile(join(f.repo, 'asset.json'), '{}'); git(f.repo, ['add', 'asset.json']); git(f.repo, ['commit', '-m', 'fixture asset']);
  await writeFile(join(f.repo, 'asset.json'), '{"changed":true}'); assert.throws(() => snapshots.capture(), /unsupported/i);
});

test('snapshot source rejects symlinks instead of copying their targets', async (t) => {
  const f = await fixture();
  try { await symlink(join(f.home, 'outside.py'), join(f.repo, 'link.py')); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Windows user lacks symlink privilege'); return; } throw e;
  }
  git(f.repo, ['add', 'link.py']); git(f.repo, ['commit', '-m', 'fixture unsafe link']);
  assert.throws(() => new WorkspaceSnapshots(join(f.home, 'snapshots.git'), f.repo).capture(), /unsupported|link/i);
});
