import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { digest, relativePath, shaSchema, type Scope } from './domain.js';

export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true }).trim();
}
export function safeFile(root: string, input: string): string {
  const path = relativePath.parse(input);
  const full = resolve(root, path);
  const normalizedRoot = realpathSync(root);
  const actual = realpathSync(full);
  const rel = relative(normalizedRoot, actual);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error('Path escapes repository');
  }
  if (!lstatSync(full).isFile()) throw new Error('Expected a regular file');
  return full;
}
const dependencyFiles = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'poetry.lock', 'uv.lock', 'Pipfile.lock'];
export function snapshot(root: string, requiredFiles: string[] = []): { scope: Scope; commit: string; root: string } {
  const actualRoot = realpathSync(git(root, ['rev-parse', '--show-toplevel']));
  // Windows' legacy realpath can retain an 8.3 alias while Git returns the long name.
  // Native resolution compares the same directory without changing persisted repository IDs.
  if (realpathSync.native(root) !== realpathSync.native(actualRoot)) throw new Error('Configure the exact Git repository root');
  const dependencyParts = dependencyFiles.filter((p) => existsSync(join(root, p)))
    .map((p) => `${p}:${digest(readFileSync(safeFile(root, p)))}`);
  const files = Object.fromEntries(requiredFiles.map((p) => [p, digest(readFileSync(safeFile(root, p)))]));
  return {
    root: actualRoot, commit: shaSchema.parse(git(root, ['rev-parse', 'HEAD'])),
    scope: { repoId: digest(actualRoot), dependencyDigest: digest(dependencyParts.join('\n')), requiredFiles: files },
  };
}
export function applicability(experience: Scope, current: Scope): string | null {
  if (experience.repoId !== current.repoId) return 'different_repository';
  if (experience.dependencyDigest !== current.dependencyDigest) return 'dependencies_changed';
  for (const [path, hash] of Object.entries(experience.requiredFiles)) {
    if (current.requiredFiles[path] !== hash) return 'code_condition_changed:' + path;
  }
  return null;
}
