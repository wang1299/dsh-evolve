import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create } from 'tar';
import { auditArchive, parseReleaseTag, release, validateManifest, validateRegistry } from '../scripts/release-helpers.js';
import { environmentConfig } from '../src/config.js';
import { packageName } from '../src/identity.js';
async function workDir(prefix: string): Promise<string> { await mkdir('.probe-work', { recursive: true }); return mkdtemp(join('.probe-work', prefix)); }

test('release manifest, lock root, public bin and private file exclusions agree', async () => {
  const p = JSON.parse(await readFile('package.json', 'utf8')); validateManifest(p); assert.equal(packageName, p.name);
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(lock.name, p.name); assert.equal(lock.version, p.version);
  assert.equal(lock.packages[''].name, p.name); assert.equal(lock.packages[''].version, p.version);
  assert.throws(() => validateManifest({ ...p, bin: { 'dsh-evolve': './dist/src/cli.js' } }));
  assert.throws(() => validateManifest({ ...p, files: [...p.files, '.probe-work'] }));
});

test('configuration rename supports legacy files and fails closed on conflicting selections', async () => {
  const work = await workDir('config-rename-'); const file = join(work, 'config.json');
  const config = { repoRoot: process.cwd(), dataDir: join(work, 'unchanged-local-data') };
  await writeFile(file, JSON.stringify(config));
  const current = environmentConfig({ DSH_REFORGE_CONFIG: file }); const old = environmentConfig({ DSH_EVOLVE_CONFIG: file });
  assert.deepEqual(current, old); assert.equal(current.dataDir, config.dataDir); assert.equal(current.automaticLearning, false);
  assert.deepEqual(environmentConfig({ DSH_REFORGE_CONFIG: file, DSH_EVOLVE_CONFIG: join(work, '.', 'config.json') }), current);
  const other = join(work, 'other.json'); await writeFile(other, JSON.stringify(config));
  assert.throws(() => environmentConfig({ DSH_REFORGE_CONFIG: file, DSH_EVOLVE_CONFIG: other }), /different files/);
  assert.deepEqual(environmentConfig({}), { repoRoot: process.cwd() });
});

test('publication audit accepts required files and rejects unintended private data', async () => {
  const work = await workDir('archive-audit-'); const root = join(work, 'package');
  await mkdir(join(root, 'dist/src'), { recursive: true }); await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'package.json'), await readFile('package.json'));
  for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', 'docs/installation.md', 'cordis.patch.yml', 'dist/src/cli.js', 'dist/src/dsh.js', 'dist/src/client.js', 'dist/src/service.js']) await writeFile(join(root, file), 'synthetic release fixture\n');
  const contents = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'docs/installation.md', 'cordis.patch.yml', 'dist/src/cli.js', 'dist/src/dsh.js', 'dist/src/client.js', 'dist/src/service.js'].map(p => 'package/' + p);
  const good = join(work, 'good.tgz'); await create({ file: good, cwd: work, gzip: true }, contents);
  const result = await auditArchive(good); assert.equal(result.files.length, 10); assert.match(result.integrity, /^sha512-/);
  await mkdir(join(root, '.probe-work')); await writeFile(join(root, '.probe-work', 'private.json'), '{}');
  const bad = join(work, 'bad.tgz'); await create({ file: bad, cwd: work, gzip: true }, [...contents, 'package/.probe-work/private.json']);
  await assert.rejects(auditArchive(bad), /whitelist/);
});

test('release annotation and registry bind owner, source, version and exact artifact', () => {
  const annotation = 'DSH-Reforge ' + release.tag + '\n\npackage: dsh-reforge\nversion: ' + release.version + '\nsource-commit: ' + 'a'.repeat(40) + '\nnpm-integrity: sha512-' + 'A'.repeat(86) + '==\nnpm-shasum: ' + 'b'.repeat(40) + '\nnpm-publisher: wang129\n';
  const tag = parseReleaseTag(annotation);
  assert.throws(() => parseReleaseTag(annotation + 'npm-publisher: wang129\n'), /Duplicate/);
  assert.throws(() => parseReleaseTag(annotation.replace('wang129\n', 'someone\n')));
  assert.throws(() => parseReleaseTag(annotation.replace('source-commit: ', 'unknown-field: ')));
  const metadata = { name: release.name, version: release.version, repository: { url: 'git+https://github.com/' + release.repository + '.git' }, _npmUser: { name: release.publisher },
    dist: { integrity: tag.integrity, shasum: tag.shasum, tarball: release.registry + '/' + release.name + '/-/' + release.name + '-' + release.version + '.tgz' } };
  assert.ok(validateRegistry(metadata, tag).startsWith(release.registry));
  assert.throws(() => validateRegistry({ ...metadata, _npmUser: { name: 'someone' } }, tag));
  assert.throws(() => validateRegistry({ ...metadata, dist: { ...metadata.dist, integrity: 'different' } }, tag));
  assert.throws(() => validateRegistry({ ...metadata, dist: { ...metadata.dist, tarball: 'https://example.invalid/package.tgz' } }, tag));
});
