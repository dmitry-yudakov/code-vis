import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { findChangedFile, parseGitStatus, readFileDiff, readWorkingTree } from '@/lib/server/gitRepository';

const execute = promisify(execFile);

describe('Git repository status', () => {
  it('distinguishes a non-Git directory from a clean repository', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'web2-not-git-'));
    await expect(readWorkingTree(outside)).resolves.toEqual({ isRepository: false, files: [] });

    const clean = await mkdtemp(path.join(os.tmpdir(), 'web2-clean-git-'));
    await execute('git', ['init', '-b', 'main'], { cwd: clean });
    await expect(readWorkingTree(clean)).resolves.toMatchObject({ isRepository: true, branch: 'main', files: [] });
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
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-git-'));
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
  });
});
