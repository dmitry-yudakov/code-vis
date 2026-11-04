import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findChangedFile, parseGitStatus, readFileDiff, readWorkingTree } from '@/server/repository/gitRepository';
import * as boundedText from '@/server/boundedTextFile';
import { runRegistry } from '@/server/runs/runRegistry';

const execute = promisify(execFile);
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-git-data-'));
  vi.stubEnv('CODEAI_DATA_DIR', dataDir);
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
  // No personal ignore file: the developer's own must not change these results.
  vi.stubEnv('XDG_CONFIG_HOME', dataDir);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

describe('Git repository status', () => {
  it('distinguishes a non-Git directory from a clean repository', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-not-git-'));
    await expect(readWorkingTree(outside)).resolves.toEqual({ isRepository: false, files: [] });

    const clean = await mkdtemp(path.join(os.tmpdir(), 'codeai-clean-git-'));
    await execute('git', ['init', '-b', 'main'], { cwd: clean });
    await expect(readWorkingTree(clean)).resolves.toMatchObject({ isRepository: true, branch: 'main', files: [] });
  });

  it('names the upstream, and says when the branch has no commits', () => {
    expect(parseGitStatus('## feature/x...origin/feature/x [ahead 2, behind 1]\0')).toMatchObject({
      branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1,
    });
    expect(parseGitStatus('## main...origin/main\0').upstream).toBe('origin/main');
    expect(parseGitStatus('## main...origin/main [gone]\0').upstream).toBe('origin/main');
    expect(parseGitStatus('## main\0').upstream).toBeUndefined();
    expect(parseGitStatus('## main\0').unborn).toBeUndefined();
    expect(parseGitStatus('## No commits yet on main\0')).toMatchObject({ branch: 'main', unborn: true });
  });

  it('parses branch metadata and staged, unstaged, untracked, and conflicted states', () => {
    const tree = parseGitStatus([
      '## feature/sidebar...origin/feature/sidebar [ahead 2, behind 1]',
      'M  staged.ts',
      ' M unstaged file.ts',
      'MM both.ts',
      '?? untracked note.md',
      'UU conflict.ts',
      '',
    ].join('\0'));

    expect(tree).toMatchObject({ isRepository: true, branch: 'feature/sidebar', ahead: 2, behind: 1 });
    expect(tree.files).toEqual([
      { path: 'both.ts', status: 'modified', staged: true, unstaged: true },
      { path: 'conflict.ts', status: 'conflicted', staged: true, unstaged: true },
      { path: 'staged.ts', status: 'modified', staged: true, unstaged: false },
      { path: 'unstaged file.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'untracked note.md', status: 'untracked', staged: false, unstaged: false },
    ]);
  });

  it('keeps NUL-delimited renamed paths and initial/detached branch labels intact', () => {
    const renamed = parseGitStatus('## No commits yet on main\0R  new name.ts\0old name.ts\0 D removed.ts\0');
    expect(renamed.branch).toBe('main');
    expect(renamed.files).toEqual([
      { path: 'new name.ts', previousPath: 'old name.ts', status: 'renamed', staged: true, unstaged: false },
      { path: 'removed.ts', status: 'deleted', staged: false, unstaged: true },
    ]);
    expect(parseGitStatus('## HEAD (no branch)\0').branch).toBe('Detached HEAD');
  });

  it('authorizes diff paths only by exact current change-set membership', () => {
    const tree = parseGitStatus('## main\0 M src/inside.ts\0');
    expect(findChangedFile(tree, 'src/inside.ts')?.path).toBe('src/inside.ts');
    expect(findChangedFile(tree, '../outside.ts')).toBeUndefined();
    expect(findChangedFile(tree, '/etc/passwd')).toBeUndefined();
  });

  it('reads bounded staged, working-tree, and untracked patches from a real repository', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-git-'));
    await execute('git', ['init', '-b', 'main'], { cwd: directory });
    await execute('git', ['config', 'user.name', 'Cartograph Test'], { cwd: directory });
    await execute('git', ['config', 'user.email', 'cartograph@example.invalid'], { cwd: directory });
    await execute('git', ['config', 'commit.gpgsign', 'false'], { cwd: directory });
    await writeFile(path.join(directory, 'tracked file.ts'), 'export const value = 1;\n');
    await execute('git', ['add', 'tracked file.ts'], { cwd: directory });
    await execute('git', ['commit', '-m', 'fixture'], { cwd: directory });

    await writeFile(path.join(directory, 'tracked file.ts'), 'export const value = 2; // staged\n');
    await execute('git', ['add', 'tracked file.ts'], { cwd: directory });
    await writeFile(path.join(directory, 'tracked file.ts'), 'export const value = 3; // working\n');
    await writeFile(path.join(directory, 'new note.md'), '# untracked\n');

    const tree = await readWorkingTree(directory);
    expect(tree).toMatchObject({ isRepository: true, branch: 'main' });
    const tracked = findChangedFile(tree, 'tracked file.ts');
    const untracked = findChangedFile(tree, 'new note.md');
    expect(tracked).toMatchObject({ staged: true, unstaged: true, status: 'modified' });
    expect(untracked).toMatchObject({ staged: false, status: 'untracked' });

    const trackedDiff = await readFileDiff(directory, tracked!);
    expect(trackedDiff.staged).toContain('+export const value = 2; // staged');
    expect(trackedDiff.unstaged).toContain('+export const value = 3; // working');
    const untrackedDiff = await readFileDiff(directory, untracked!);
    expect(untrackedDiff.unstaged).toContain('+# untracked');
    expect(untrackedDiff.preview).toEqual({ markdown: '# untracked\n' });
    expect(trackedDiff.preview).toBeUndefined();
  });

  it('previews the complete working Markdown, including unchanged text and unstaged changes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-'));
    const original = '# Full document\n\n' + 'Unchanged paragraph.\n\n'.repeat(20);
    await execute('git', ['init', '-b', 'main'], { cwd: directory });
    await writeFile(path.join(directory, 'Review.MD'), original + 'Staged ending.\n');
    await execute('git', ['add', 'Review.MD'], { cwd: directory });
    const current = original + 'Working ending.\n';
    await writeFile(path.join(directory, 'Review.MD'), current);
    const file = findChangedFile(await readWorkingTree(directory), 'Review.MD')!;
    const diff = await readFileDiff(directory, file);
    expect(diff.staged).toContain('+Staged ending.');
    expect(diff.unstaged).toContain('+Working ending.');
    expect(diff.preview).toEqual({ markdown: current });
  });

  it('retains patches when Markdown cannot be previewed and recovers after refresh', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-errors-'));
    await execute('git', ['init', '-b', 'main'], { cwd: directory });
    const read = async (name: string) => readFileDiff(directory, findChangedFile(await readWorkingTree(directory), name)!);
    await writeFile(path.join(directory, 'large.md'), 'a'.repeat(512 * 1024 + 1));
    expect((await read('large.md')).preview).toEqual({ error: expect.stringContaining('512 KiB') });
    await writeFile(path.join(directory, 'binary.md'), Buffer.from([0, 1, 2]));
    const binary = await read('binary.md');
    expect(binary.unstaged).toContain('Binary files');
    expect(binary.preview).toEqual({ error: expect.stringContaining('UTF-8') });
    await writeFile(path.join(directory, 'empty.markdown'), '');
    expect((await read('empty.markdown')).preview).toEqual({ markdown: '' });
    await writeFile(path.join(directory, 'large.md'), '# Readable now\n');
    expect((await read('large.md')).preview).toEqual({ markdown: '# Readable now\n' });
    await execute('git', ['add', 'large.md'], { cwd: directory });
    await rm(path.join(directory, 'large.md'));
    const deleted = await read('large.md');
    expect(deleted.unstaged).toContain('-# Readable now');
    expect(deleted.preview).toEqual({ error: expect.stringContaining('no longer exists') });
  });

  it('does not preview symbolic links or paths outside the checkout', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-links-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-outside-'));
    await execute('git', ['init', '-b', 'main'], { cwd: directory });
    await writeFile(path.join(outside, 'secret.md'), '# Outside secret\n');
    await symlink(path.join(outside, 'secret.md'), path.join(directory, 'linked.md'));
    const linked = await readFileDiff(directory, findChangedFile(await readWorkingTree(directory), 'linked.md')!);
    expect(linked.preview).toEqual({ error: expect.stringContaining('symbolic links') });
    expect(JSON.stringify(linked.preview)).not.toContain('Outside secret');
    // Defend the reader independently of route membership, including linked parent directories.
    await mkdir(path.join(directory, 'notes'));
    await writeFile(path.join(directory, 'notes', 'inside.md'), '# Inside\n');
    await symlink(path.join(directory, 'notes'), path.join(directory, 'alias'));
    for (const name of [path.join(outside, 'secret.md'), '../outside.md', 'alias/inside.md']) {
      const diff = await readFileDiff(directory, { path: name, status: 'modified', staged: false, unstaged: false });
      expect(diff.preview).toEqual({ error: expect.any(String) });
      expect(JSON.stringify(diff.preview)).not.toContain('# Outside secret');
    }
  });

  it('withholds Markdown when the platform cannot prove which file was opened', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-platform-'));
    await execute('git', ['init', '-b', 'main'], { cwd: directory });
    await writeFile(path.join(directory, 'review.md'), '# Current document\n');
    const proof = vi.spyOn(boundedText, 'namesOpenFiles').mockReturnValue(false);
    const read = vi.spyOn(boundedText, 'readBoundedTextFile');
    try {
      const diff = await readFileDiff(directory, findChangedFile(await readWorkingTree(directory), 'review.md')!);
      expect(diff.unstaged).toContain('+# Current document');
      expect(diff.preview).toEqual({ error: expect.stringContaining('Linux') });
      expect(read).not.toHaveBeenCalledWith(path.join(directory, 'review.md'), 512 * 1024, { exactly: true });
    } finally {
      proof.mockRestore();
      read.mockRestore();
    }
  });

  it('does not reauthorize a checkout root replaced by a symbolic link', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-secret-'));
    await writeFile(path.join(outside, 'review.md'), '# Private outside document\n');
    await rename(directory, directory + '-original');
    await symlink(outside, directory);
    const diff = await readFileDiff(directory, { path: 'review.md', status: 'modified', staged: false, unstaged: false });
    expect(diff.preview).toEqual({ error: expect.stringContaining('location changed') });
    expect(JSON.stringify(diff)).not.toContain('Private outside document');
  });

  it('honors checkout recovery ownership and releases preview reads for subsequent recovery', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-markdown-busy-'));
    await writeFile(path.join(directory, 'review.md'), '# Current document\n');
    const file = { path: 'review.md', status: 'modified' as const, staged: false, unstaged: false };
    const release = runRegistry.acquireCheckoutWrite(directory)!;
    try {
      expect((await readFileDiff(directory, file)).preview).toEqual({ error: expect.stringContaining('busy') });
    } finally { release(); }
    expect((await readFileDiff(directory, file)).preview).toEqual({ markdown: '# Current document\n' });
    const recover = runRegistry.acquireCheckoutWrite(directory);
    expect(recover).toBeTypeOf('function');
    recover?.();
  });
});
