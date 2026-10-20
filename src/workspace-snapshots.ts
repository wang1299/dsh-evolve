import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { digest, hashSchema, relativePath, shaSchema } from './domain.js';
import { git, safeFile, snapshot } from './repository.js';

const dependencies = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'poetry.lock', 'uv.lock', 'Pipfile.lock'];
const supported = (p: string): boolean => p.endsWith('.py') || dependencies.includes(p);
export const workspaceVersionSchema = z.object({ commit: shaSchema, digest: hashSchema, sourceHead: shaSchema, dependencyDigest: hashSchema }).strict();
export type WorkspaceVersion = z.infer<typeof workspaceVersionSchema>;
interface File { path: string; mode: string; bytes: Buffer }
const fingerprint = (files: File[]): string => digest(files.map(f => `${f.mode}:${f.path}:${digest(f.bytes)}`).join('\n'));
function bounded(files: File[]): File[] {
  if (!files.length || files.length > 500 || files.some(f => f.bytes.length > 512 * 1024) || files.reduce((n, f) => n + f.bytes.length, 0) > 8 * 1024 * 1024) throw new Error('Snapshot size limit exceeded');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Private immutable Git objects; the user's Git index, refs and worktree are never written. */
export class WorkspaceSnapshots {
  constructor(readonly directory: string, readonly root: string) {
    const gitDirectory = resolve(root, git(root, ['rev-parse', '--git-common-dir']));
    const withinGit = relative(gitDirectory, resolve(directory));
    if (withinGit === '' || !isAbsolute(withinGit) && withinGit !== '..' && !withinGit.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Private snapshot store must be outside repository Git');
  }
  private environment(): NodeJS.ProcessEnv { return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_AUTHOR_NAME: 'DSH-Evolve', GIT_AUTHOR_EMAIL: 'local@example.invalid', GIT_COMMITTER_NAME: 'DSH-Evolve', GIT_COMMITTER_EMAIL: 'local@example.invalid' }; }
  private command(args: string[], input?: Buffer | string): Buffer {
    return execFileSync('git', ['--git-dir=' + resolve(this.directory), ...args], { input, maxBuffer: 12 * 1024 * 1024, windowsHide: true,
      env: this.environment() });
  }
  private workspace(): { files: File[]; sourceHead: string; dependencyDigest: string } {
    const version = snapshot(this.root);
    const unsafeNew = git(this.root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(p => p.endsWith('.py'));
    if (unsafeNew.length) throw new Error('Untracked Python files require an explicit capture design');
    const changed = git(this.root, ['diff', '--name-only', '-z', 'HEAD', '--']).split('\0').filter(Boolean);
    if (changed.some(p => !supported(p))) throw new Error('Unsupported file change in automatic capture');
    const ignored = new Set(git(this.root, ['ls-files', '-ci', '--exclude-standard', '-z']).split('\0'));
    const files: File[] = [];
    for (const line of git(this.root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
      const match = line.match(/^(100644|100755) [a-f0-9]{40} 0\t(.+)$/);
      if (!match) throw new Error('Unsupported index entry or symlink');
      const path = relativePath.parse(match[2]); if (!supported(path)) continue;
      if (ignored.has(path)) throw new Error('Ignored tracked Python files cannot enter snapshots');
      const parts = path.split('/'); for (let n = 1; n <= parts.length; n++) if (lstatSync(join(this.root, ...parts.slice(0, n))).isSymbolicLink()) throw new Error('Snapshot symlink rejected');
      const full = safeFile(this.root, path); if (lstatSync(full).isSymbolicLink()) throw new Error('Snapshot symlink rejected');
      const stat = lstatSync(full); if (stat.size > 512 * 1024) throw new Error('Snapshot file too large');
      files.push({ path, mode: match[1]!, bytes: readFileSync(full) });
    }
    return { files: bounded(files), sourceHead: version.commit, dependencyDigest: version.scope.dependencyDigest };
  }
  capture(parent?: string): WorkspaceVersion {
    const before = this.workspace();
    if (existsSync(this.directory)) {
      if (lstatSync(this.directory).isSymbolicLink()) throw new Error('Private snapshot store symlink');
      const size = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
        const full = join(dir, e.name); if (e.isSymbolicLink()) throw new Error('Private snapshot store symlink');
        return n + (e.isDirectory() ? size(full) : lstatSync(full).size);
      }, 0);
      if (size(this.directory) > 128 * 1024 * 1024) throw new Error('Private snapshot storage limit reached');
    } else {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      execFileSync('git', ['init', '--bare', this.directory], { windowsHide: true, stdio: 'ignore', env: this.environment() });
    }
    const contentDigest = fingerprint(before.files);
    const after = this.workspace();
    if (fingerprint(after.files) !== contentDigest || after.sourceHead !== before.sourceHead || after.dependencyDigest !== before.dependencyDigest) throw new Error('Workspace changed during capture');
    if (parent && fingerprint(this.files(parent)) === contentDigest) return { commit: parent, digest: contentDigest, sourceHead: before.sourceHead, dependencyDigest: before.dependencyDigest };
    const entries = before.files.map(f => ({ ...f, sha: this.command(['hash-object', '-w', '--stdin'], f.bytes).toString().trim() }));
    const tree = (prefix: string): string => {
      const lines: string[] = []; const dirs = new Set<string>();
      for (const f of entries.filter(f => f.path.startsWith(prefix))) {
        const name = f.path.slice(prefix.length); const split = name.indexOf('/');
        if (split === -1) lines.push(`${f.mode} blob ${f.sha}\t${name}\0`); else dirs.add(name.slice(0, split));
      }
      for (const dir of dirs) lines.push(`040000 tree ${tree(prefix + dir + '/')}\t${dir}\0`);
      return this.command(['mktree', '-z'], lines.join('')).toString().trim();
    };
    const commit = this.command(['commit-tree', tree(''), ...(parent ? ['-p', shaSchema.parse(parent)] : [])], `Local workspace snapshot ${contentDigest}\nRepository HEAD ${before.sourceHead}\n`).toString().trim();
    return workspaceVersionSchema.parse({ commit, digest: contentDigest, sourceHead: before.sourceHead, dependencyDigest: before.dependencyDigest });
  }
  files(commit: string): File[] {
    const files = this.command(['ls-tree', '-r', '-z', '--full-tree', shaSchema.parse(commit)]).toString().split('\0').filter(Boolean).map(line => {
      const m = line.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/); if (!m) throw new Error('Unsupported private snapshot entry');
      const path = relativePath.parse(m[3]); if (!supported(path)) throw new Error('Unsupported private snapshot file');
      return { path, mode: m[1]!, bytes: this.command(['cat-file', 'blob', m[2]!]) };
    });
    return bounded(files);
  }
  validate(version: WorkspaceVersion): void { workspaceVersionSchema.parse(version); if (fingerprint(this.files(version.commit)) !== version.digest) throw new Error('Private snapshot changed'); }
  matches(version: WorkspaceVersion): boolean {
    try { this.validate(version); const current = this.workspace(); return fingerprint(current.files) === version.digest && current.sourceHead === version.sourceHead && current.dependencyDigest === version.dependencyDigest; } catch { return false; }
  }
  paths(commit: string): string[] { return this.files(commit).map(f => f.path); }
  changedFiles(base: string, fixed: string): string[] { return this.command(['diff', '--name-only', '-z', '--diff-filter=ACMR', shaSchema.parse(base), shaSchema.parse(fixed), '--', '*.py']).toString().split('\0').filter(Boolean); }
  diff(base: string, fixed: string): string { return this.command(['diff', '--no-ext-diff', '--no-textconv', shaSchema.parse(base), shaSchema.parse(fixed), '--', '*.py']).toString(); }
  assertExternalAcceptance(directory: string): void {
    const rel = relative(resolve(this.root), resolve(directory));
    if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Acceptance tests must be outside the Agent repository');
  }
}
